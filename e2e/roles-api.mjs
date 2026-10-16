// API checks for user roles against a FRESH product DB with OSUITE_LICENSE=off.
// Usage: node e2e/roles-api.mjs
const B = 'http://127.0.0.1:47800/api';
async function call(token, method, path, body) {
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
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}${cond || extra === undefined ? '' : `  -> ${JSON.stringify(extra).slice(0, 400)}`}`);
  if (!cond) failed++;
};
const login = async (l, p) => (await call(null, 'POST', '/auth/login', { login: l, password: p })).body.token;
const as = (token) => (method, path, body) => call(token, method, path, body);

await call(null, 'POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
const admin = as(await login('admin', 'admin1234'));
const me = (await admin('GET', '/bootstrap')).body.user;
check(me.isAdmin && me.access.accounts === 'full' && me.roleId === null, 'administrators may do everything', me);

// ---------------------------------------------------------------- roles and users
const roles = (await admin('GET', '/records/base.role?limit=50')).body.records;
const role = (name) => roles.find((r) => r.name === name)?.id;
check(['Full access', 'Accountant', 'Sales and billing', 'Purchase and stores', 'Read only'].every(role), 'five starter roles', roles.map((r) => r.name));
let r = await admin('POST', '/users', { name: 'No Role', login: 'norole', password: 'norole123' });
check(r.status === 422 && r.body.fieldErrors?.roleId, 'a user who is not an administrator needs a role', r.body);
for (const [name, login_, roleName] of [
  ['Sunita Clerk', 'sunita', 'Sales and billing'],
  ['Ravi Stores', 'ravi', 'Purchase and stores'],
  ['Meera Auditor', 'meera', 'Read only'],
]) {
  r = await admin('POST', '/users', { name, login: login_, password: `${login_}12345`, roleId: role(roleName) });
  check(r.status === 201 && r.body.roleName === roleName, `${name} added as ${roleName}`, r.body);
}
const users = (await admin('GET', '/users')).body.users;
check(users.find((u) => u.login === 'sunita')?.roleName === 'Sales and billing', 'user list shows each role');

// Data to work on.
const bolt = (await admin('POST', '/records/base.product', { name: 'Steel bolt M8', kind: 'goods', hsnCode: '7318', salePrice: '10', costPrice: '4' })).body;
const acme = (await admin('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27' })).body;
const opening = (await admin('POST', '/records/stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '100', unitCost: '4' }] })).body;
await admin('POST', `/records/stock.adjustment/${opening.id}/actions/post`);
const line = { productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty: '5', unitPrice: '10', gstRate: '18' };

// ---------------------------------------------------------------- sales and billing
const sunitaToken = await login('sunita', 'sunita12345');
const sunita = as(sunitaToken);
const su = (await sunita('GET', '/bootstrap')).body.user;
check(su.access.sales === 'edit' && su.access.accounts === 'none' && su.roleName === 'Sales and billing', 'clerk session carries her role', su);
const menus = (await sunita('GET', '/meta')).body.menus;
const labels = JSON.stringify(menus);
check(labels.includes('"Invoices"') && !labels.includes('Profit & loss') && !labels.includes('"Bills"') && !labels.includes('Trial balance'), 'menus show sales, hide accounts and purchases', menus.map((m) => m.label));
check(labels.includes('Payments received') && labels.includes('"Contacts"'), 'and keep payments and contacts');
r = await sunita('POST', '/records/sales.invoice', { customerId: acme.id, placeOfSupply: '27', lines: [line] });
check(r.status === 201, 'clerk creates an invoice', r.body);
const inv = r.body;
r = await sunita('POST', `/records/sales.invoice/${inv.id}/actions/post`);
check(r.status === 200 && r.body.state === 'posted', 'and posts it', r.body);
r = await sunita('POST', `/records/sales.invoice/${inv.id}/actions/cancel`);
check(r.status === 403 && /cancel documents in Sales/.test(r.body.error), 'but cannot cancel it', r.body);
check((await sunita('GET', '/reports/profit-loss')).status === 403, 'cannot see profit and loss');
check((await sunita('GET', '/reports/trial-balance')).status === 403, 'or the trial balance');
check((await sunita('GET', '/records/purchase.bill')).status === 403, 'or bills');
check((await sunita('POST', '/records/purchase.bill', { vendorId: acme.id, vendorState: '27', vendorBillNo: 'X1' })).status === 403, 'or create one');
check((await sunita('GET', '/records/base.contact')).status === 200 && (await sunita('POST', '/records/base.contact', { name: 'Walk-in customer' })).status === 201, 'reads and adds contacts');
check((await sunita('GET', '/records/stock.quant')).status === 200 && (await sunita('POST', '/records/stock.adjustment', { reason: 'count', lines: [] })).status === 403, 'sees stock, cannot adjust it');
check((await sunita('GET', '/records/base.contact/name-search?q=acme')).body.length === 1, 'picks customers on forms');
const dash = (await sunita('GET', '/dashboard')).body;
check(dash.sales && dash.receivable && dash.lowStock && dash.profitFy === null && dash.purchasesMonth === null, 'dashboard hides profit and purchases', dash);
check(dash.trend.every((t) => t.purchases === '0.00'), 'and purchases in the trend');
check((await sunita('GET', '/users')).status === 403 && (await sunita('GET', '/records/base.role')).status === 403, 'cannot manage users or roles');
const pay = await sunita('POST', '/records/account.payment', { direction: 'inbound', partnerId: acme.id, amount: '59', mode: 'cash', lines: [{ invoiceId: inv.id, amount: '59' }] });
check(pay.status === 201 && (await sunita('POST', `/records/account.payment/${pay.body.id}/actions/post`)).status === 200, 'records a payment received');

// ---------------------------------------------------------------- purchase and stores
const ravi = as(await login('ravi', 'ravi12345'));
check((await ravi('GET', '/records/sales.invoice')).status === 403, 'stores cannot see invoices');
check((await ravi('GET', '/records/account.payment')).status === 403, 'or payments');
const adj = await ravi('POST', '/records/stock.adjustment', { reason: 'count', lines: [{ productId: bolt.id, qty: '-1' }] });
check(adj.status === 201 && (await ravi('POST', `/records/stock.adjustment/${adj.body.id}/actions/post`)).status === 200, 'stores adjust stock');
check((await ravi('POST', `/records/stock.adjustment/${adj.body.id}/actions/cancel`)).status === 403, 'but cannot cancel an adjustment (edit, not full)');
const rd = (await ravi('GET', '/dashboard')).body;
check(rd.sales === null && rd.receivable === null && rd.lowStock && rd.purchasesMonth !== null, 'stores dashboard: stock and purchases only', rd);

// ---------------------------------------------------------------- read only
const meera = as(await login('meera', 'meera12345'));
check((await meera('GET', '/records/sales.invoice')).status === 200 && (await meera('GET', '/reports/profit-loss')).status === 200, 'read-only sees invoices and reports');
check((await meera('POST', '/records/sales.invoice', { customerId: acme.id, placeOfSupply: '27' })).status === 403, 'but cannot create');
check((await meera('PATCH', `/records/base.contact/${acme.id}`, { phone: '9999999999' })).status === 403, 'or edit contacts');
check((await meera('GET', '/reports/gstr-1')).status === 200, 'sees GST returns');

// ---------------------------------------------------------------- changing access
r = await admin('PUT', `/users/${users.find((u) => u.login === 'sunita').id}/access`, { isAdmin: false, roleId: role('Read only') });
check(r.status === 200, 'administrator moves the clerk to read only', r.body);
check((await sunita('POST', '/records/sales.invoice', { customerId: acme.id, placeOfSupply: '27' })).status === 403, 'takes effect on her next request');
check((await call(sunitaToken, 'GET', '/bootstrap')).body.user.roleName === 'Read only', 'and her session shows the new role');
r = await admin('PUT', `/users/${me.id}/access`, { isAdmin: false, roleId: role('Read only') });
check(r.status === 422, 'an administrator cannot remove their own administrator access', r.body);
r = await admin('PATCH', `/records/base.role/${role('Read only')}`, { gstAccess: 'none' });
check(r.status === 200 && r.body.gstAccess === 'none', 'administrator edits a role', r.body);
check((await meera('GET', '/reports/gstr-1')).status === 403, 'which changes what its users can see');
r = await admin('DELETE', `/records/base.role/${role('Read only')}`);
check(r.status === 409, 'a role in use cannot be deleted', r.body);
r = await admin('POST', '/records/base.role', { name: 'Field sales', salesAccess: 'edit', mastersAccess: 'view', paymentsAccess: 'none', accountsAccess: 'none', gstAccess: 'none', purchaseAccess: 'none', inventoryAccess: 'view' });
check(r.status === 201 && r.body.salesAccess === 'edit', 'administrator creates a role', r.body);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
