// API checks for the journal, financial statements and GST returns, against a
// FRESH product DB with OSUITE_LICENSE=off.   Usage: node e2e/accounting-api.mjs
// Expected figures are worked out by hand in the comments.
const B = 'http://127.0.0.1:47800/api';
let token;
async function api(method, path, body) {
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
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}${cond || extra === undefined ? '' : `  -> ${JSON.stringify(extra).slice(0, 500)}`}`);
  if (!cond) failed++;
};
const act = async (model, id, action) => {
  const r = await api('POST', `/records/${model}/${id}/actions/${action}`);
  if (r.status !== 200) throw new Error(`${model} ${action}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const create = async (model, values) => {
  const r = await api('POST', `/records/${model}`, values);
  if (r.status !== 201) throw new Error(`${model}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const tb = async () => (await api('GET', '/reports/trial-balance')).body;
const bal = (t, code) => {
  const r = t.rows.find((x) => x.code === code);
  return r ? r.balance : '0.00';
};

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;

const accounts = (await api('GET', '/records/account.account?limit=100')).body.records;
check(accounts.length === 19 && accounts.some((a) => a.key === 'receivable' && a.code === '1300'), 'chart of accounts seeded (19 accounts)', accounts.length);

const bolt = await create('base.product', { name: 'Steel bolt M8', hsnCode: '7318', salePrice: '9', costPrice: '4', kind: 'goods' });
const acme = await create('base.contact', { name: 'Acme Industries', stateCode: '27', gstin: '27AAPFU0939F1ZV' });
const kcc = await create('base.contact', { name: 'Karnataka Copper Co', isVendor: true, isCustomer: false, stateCode: '29' });

// Opening stock 100 @ 4 -> Dr Stock 400 / Cr Opening balance equity 400
const adj = await create('stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '100', unitCost: '4' }] });
await act('stock.adjustment', adj.id, 'post');

// Bill from Karnataka (IGST): bolts 50 x 5.50 -10% = 247.50, freight 100.00 -> taxable 347.50,
// IGST 62.55, total 410.05 -> 410.00 (round off -0.05).
// Dr Stock 247.50, Dr Purchases 100.00, Dr Input IGST 62.55 / Cr Round off 0.05, Cr Creditors 410.00
const bill = await create('purchase.bill', {
  vendorId: kcc.id, vendorState: '29', vendorBillNo: 'KCC/1',
  lines: [
    { productId: bolt.id, description: 'Steel bolt M8', qty: '50', unitPrice: '5.50', discountPct: '10', gstRate: '18' },
    { description: 'Freight', hsnCode: '9965', qty: '1', unitPrice: '100', gstRate: '18' },
  ],
});
const billPosted = await act('purchase.bill', bill.id, 'post');
check(billPosted.totalAmount === '410.00' && billPosted.roundOff === '-0.05', 'bill totals 410.00 after -0.05 round off', billPosted);

// Invoice to Acme (intra-state): 30 x 9 = 270, CGST 24.30 + SGST 24.30 = 318.60 -> 319 (+0.40).
// Cost at average (400 + 247.50) / 150 = 4.3167 -> 129.50.
const inv = await create('sales.invoice', {
  customerId: acme.id, placeOfSupply: '27', customerGstin: '27AAPFU0939F1ZV',
  lines: [{ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty: '30', unitPrice: '9', gstRate: '18' }],
});
const invPosted = await act('sales.invoice', inv.id, 'post');

const entries = (await api('GET', `/records/account.entry?q=${encodeURIComponent(invPosted.number)}`)).body.records;
check(entries.length === 1 && /^JV\//.test(entries[0].number) && entries[0].amount === '448.50', 'invoice journal: one entry worth 448.50 (319 + 129.50)', entries);
const entry = (await api('GET', `/records/account.entry/${entries[0].id}`)).body;
const line = (code) => entry.lines.find((l) => l.accountId.display === accounts.find((a) => a.code === code).name);
check(line('1300').debit === '319.00' && line('4100').credit === '270.00' && line('2210').credit === '24.30' && line('5900').credit === '0.40', 'invoice entry: Dr debtors 319 / Cr sales 270, CGST 24.30, round off 0.40', entry.lines);
check(line('5100').debit === '129.50' && line('1400').credit === '129.50', 'invoice entry: Dr COGS / Cr stock 129.50', entry.lines);
check(line('1300').partnerId?.id === acme.id, 'debtors line carries the customer');

// Payments: receipt 319 to bank, vendor paid 410 in cash.
const rcpt = await create('account.payment', { direction: 'inbound', partnerId: acme.id, amount: '319', mode: 'bank', lines: [{ invoiceId: inv.id, amount: '319' }] });
await act('account.payment', rcpt.id, 'post');
const pay = await create('account.payment', { direction: 'outbound', partnerId: kcc.id, amount: '410', mode: 'cash', lines: [{ billId: bill.id, amount: '410' }] });
await act('account.payment', pay.id, 'post');

let t = await tb();
check(t.balanced && t.totalDebit === '1129.05', 'trial balance balances at 1,129.05', t);
check(bal(t, '1400') === '518.00', 'stock account 518.00 equals stock on hand value', bal(t, '1400'));
const quant = (await api('GET', `/records/stock.quant?f.productId=${bolt.id}`)).body.records[0];
check(quant.value === bal(t, '1400'), 'ledger and stock valuation agree', quant.value);
check(bal(t, '1300') === '0.00' && bal(t, '2100') === '0.00', 'debtors and creditors settled to zero');
check(bal(t, '1100') === '-410.00' && bal(t, '1200') === '319.00', 'cash -410, bank 319');
check(bal(t, '5900') === '-0.45', 'round off nets to 0.45 gain');

const pl = (await api('GET', '/reports/profit-loss')).body;
check(pl.totalIncome === '270.00' && pl.totalExpense === '229.05' && pl.netProfit === '40.95', 'P&L: income 270, expenses 229.05, profit 40.95', pl);
const bs = (await api('GET', '/reports/balance-sheet')).body;
check(bs.balanced && bs.totalAssets === '489.55' && bs.totalLiabilities === '48.60' && bs.totalEquity === '440.95', 'balance sheet balances: 489.55 = 48.60 + 440.95', bs);

// GST returns for this month.
const g3 = (await api('GET', '/reports/gstr-3b')).body;
check(g3.outward.taxable.taxable === '270.00' && g3.outward.taxable.cgst === '24.30' && g3.itc.igst === '62.55', 'GSTR-3B: outward 270 (CGST 24.30), ITC IGST 62.55', g3);
check(g3.netPayable.cgst === '24.30' && g3.netPayable.igst === '-62.55', 'GSTR-3B: net per head', g3.netPayable);

// More sales for GSTR-1: a large inter-state B2C invoice (B2CL) and a small local one (B2CS).
const consult = await create('base.product', { name: 'Consulting', kind: 'service', hsnCode: '9983', salePrice: '1000' });
const walkIn = await create('base.contact', { name: 'Walk-in buyer', stateCode: '27' });
const blrBuyer = await create('base.contact', { name: 'Bengaluru buyer', stateCode: '29' });
const b2cl = await create('sales.invoice', { customerId: blrBuyer.id, placeOfSupply: '29', lines: [{ productId: consult.id, description: 'Consulting', hsnCode: '9983', qty: '1', unitPrice: '100000', gstRate: '18' }] });
await act('sales.invoice', b2cl.id, 'post');
const b2cs = await create('sales.invoice', { customerId: walkIn.id, placeOfSupply: '27', lines: [{ productId: consult.id, description: 'Consulting', hsnCode: '9983', qty: '2', unitPrice: '500', gstRate: '18' }] });
await act('sales.invoice', b2cs.id, 'post');

const g1 = (await api('GET', '/reports/gstr-1')).body;
check(g1.b2b.length === 1 && g1.b2b[0].gstin === '27AAPFU0939F1ZV' && g1.b2b[0].taxable === '270.00' && g1.b2b[0].placeOfSupply === '27-Maharashtra', 'GSTR-1 B2B: Acme 270 @18%', g1.b2b);
check(g1.b2cl.length === 1 && g1.b2cl[0].igst === '18000.00' && g1.b2cl[0].invoiceValue === '118000.00', 'GSTR-1 B2CL: inter-state B2C above ₹1 lakh listed invoice-wise', g1.b2cl);
check(g1.b2cs.length === 1 && g1.b2cs[0].taxable === '1000.00' && g1.b2cs[0].cgst === '90.00', 'GSTR-1 B2CS: local B2C summarised by state and rate', g1.b2cs);
const h9983 = g1.hsn.find((h) => h.hsn === '9983');
check(h9983 && h9983.qty === '3' && h9983.taxable === '101000.00', 'GSTR-1 HSN summary by code', g1.hsn);
check(g1.documents.issued === 3 && g1.documents.cancelled === 0, 'document summary counts invoices', g1.documents);

// Cancelling reverses the books: receipt first, then the invoice.
await act('account.payment', rcpt.id, 'cancel');
await act('sales.invoice', inv.id, 'cancel');
t = await tb();
check(t.balanced, 'trial balance still balances after cancellations', t);
check(bal(t, '1400') === '647.50' && bal(t, '5100') === '0.00', 'stock and COGS restored by the reversal', [bal(t, '1400'), bal(t, '5100')]);
const reversal = (await api('GET', `/records/account.entry?q=${encodeURIComponent(`Cancel ${invPosted.number}`)}`)).body.records;
check(reversal.length === 1 && reversal[0].amount === '448.50', 'invoice cancellation posted one mirror entry', reversal);
const g1after = (await api('GET', '/reports/gstr-1')).body;
check(g1after.b2b.length === 0 && g1after.documents.cancelled === 1, 'cancelled invoice leaves GSTR-1 B2B and is counted as cancelled', g1after.documents);

// The journal is read-only.
const w = await api('POST', '/records/account.entry', { number: 'X' });
check(w.status === 403, 'journal entries cannot be created by hand through the API', w.body);
check((await api('GET', '/audit/verify')).body.ok, 'audit chain intact');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
