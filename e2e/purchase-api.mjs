// API checks for company settings and purchase bills against a FRESH product DB
// with OSUITE_LICENSE=off.   Usage: node e2e/purchase-api.mjs
const B = 'http://127.0.0.1:47800/api';
async function api(method, path, body, token) {
  const r = await fetch(B + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}
let failed = 0;
const check = (cond, msg, extra) => {
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}${cond || extra === undefined ? '' : `  -> ${JSON.stringify(extra).slice(0, 300)}`}`);
  if (!cond) failed++;
};

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
const admin = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
const as = (method, path, body) => api(method, path, body, admin);

// Company settings.
let r = await as('PUT', '/company', { name: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', pincode: '12', bankIfsc: 'nope' });
check(r.status === 422 && r.body.fieldErrors.pincode && r.body.fieldErrors.bankIfsc, 'invalid company details rejected per field', r.body);
const profile = {
  name: 'Ofin Demo Traders',
  gstin: '27AAPFU0939F1ZV',
  stateCode: '27',
  pan: 'AAPFU0939F',
  street: '21 Laxmi Road',
  city: 'Pune',
  pincode: '411030',
  phone: '020 2445 6677',
  email: 'accounts@ofindemo.in',
  bankAccountName: 'Ofin Demo Traders',
  bankAccountNumber: '50200012345678',
  bankIfsc: 'hdfc0000123',
  bankName: 'HDFC Bank',
  upiId: 'ofindemo@okhdfc',
  invoiceTerms: 'Goods once sold will not be taken back.\nInterest @18% p.a. on overdue bills.',
};
r = await as('PUT', '/company', profile);
check(r.status === 200 && r.body.bankIfsc === 'HDFC0000123', 'company profile saved and normalised', r.body);
check((await as('GET', '/bootstrap')).body.company.upiId === 'ofindemo@okhdfc', 'bootstrap returns the full profile');
const fullRole = (await as('GET', '/records/base.role?q=Full%20access')).body.records[0].id;
await as('POST', '/users', { name: 'Clerk', login: 'clerk', password: 'clerk1234', roleId: fullRole });
const clerk = (await api('POST', '/auth/login', { login: 'clerk', password: 'clerk1234' })).body.token;
r = await api('PUT', '/company', profile, clerk);
check(r.status === 403, 'only administrators change company details', r.body);

// Contacts and the vendor-only picker.
const local = (await as('POST', '/records/base.contact', { name: 'Pune Steel Suppliers', isVendor: true, isCustomer: false, stateCode: '27', gstin: '27AAPFU0939F1ZV' })).body;
const remote = (await as('POST', '/records/base.contact', { name: 'Karnataka Copper Co', isVendor: true, isCustomer: false, stateCode: '29' })).body;
await as('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27' });
r = await as('GET', '/records/base.contact/name-search?q=&f.isVendor=true');
check(r.body.length === 2 && r.body.every((c) => c.display !== 'Acme Industries'), 'vendor picker only offers vendors', r.body);
r = await as('GET', '/records/base.contact/name-search?q=&f.isCustomer=true');
check(r.body.length === 1 && r.body[0].display === 'Acme Industries', 'customer picker only offers customers', r.body);
r = await as('GET', '/records/base.contact/name-search?q=&f.password=1');
check(r.status === 400, 'unknown filter fields are rejected', r.body);

// Bills.
const line = (rate, qty = '10') => ({ description: 'Copper wire', hsnCode: '8544', qty, unitPrice: rate, gstRate: '18' });
r = await as('POST', '/records/purchase.bill', { vendorId: remote.id, vendorState: '29', vendorBillNo: 'KCC/118', lines: [line('2000')] });
check(r.status === 201, 'bill created', r.body);
const b1 = r.body;
check(b1.placeOfSupply === '27', 'place of supply defaults to the company state', b1.placeOfSupply);
check(b1.igstAmount === '3600.00' && b1.cgstAmount === '0.00' && b1.totalAmount === '23600.00', 'vendor in another state: IGST', b1);
r = await as('POST', '/records/purchase.bill', { vendorId: local.id, vendorState: '27', vendorBillNo: 'PSS-77', lines: [line('100')] });
const b2 = r.body;
check(b2.cgstAmount === '90.00' && b2.sgstAmount === '90.00' && b2.igstAmount === '0.00', 'vendor in the same state: CGST + SGST', b2);
r = await as('POST', '/records/purchase.bill', { vendorId: local.id, vendorState: '29', vendorGstin: '27AAPFU0939F1ZV', vendorBillNo: 'X1' });
check(r.status === 422 && r.body.fieldErrors.vendorState, "vendor GSTIN must match the vendor's state", r.body);
r = await as('POST', '/records/purchase.bill', { vendorId: local.id, vendorState: '27', lines: [line('1')] });
check(r.status === 422 && r.body.fieldErrors.vendorBillNo, 'vendor bill number is required', r.body);

r = await as('POST', `/records/purchase.bill/${b1.id}/actions/post`);
check(r.body.state === 'posted' && /^BILL\/\d{2}-\d{2}\/0001$/.test(r.body.number), 'bill posted with its own series', r.body);
const dup = (await as('POST', '/records/purchase.bill', { vendorId: remote.id, vendorState: '29', vendorBillNo: 'kcc/118', lines: [line('5')] })).body;
r = await as('POST', `/records/purchase.bill/${dup.id}/actions/post`);
check(r.status === 409 && r.body.error.includes('BILL/'), 'same vendor bill number cannot be booked twice', r.body);
const other = (await as('POST', '/records/purchase.bill', { vendorId: local.id, vendorState: '27', vendorBillNo: 'KCC/118', lines: [line('5')] })).body;
r = await as('POST', `/records/purchase.bill/${other.id}/actions/post`);
check(r.status === 200 && r.body.number.endsWith('/0002'), 'same number from a different vendor is fine', r.body);
const inv = (await as('POST', '/records/sales.invoice', { customerId: 3, placeOfSupply: '27', lines: [line('10', '1')] })).body;
r = await as('POST', `/records/sales.invoice/${inv.id}/actions/post`);
check(r.body.number?.startsWith('INV/') && r.body.number.endsWith('/0001'), 'invoice numbering is independent of bills', r.body);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
