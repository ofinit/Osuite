// API checks for credit notes, debit notes and manual journals against a FRESH
// product DB with OSUITE_LICENSE=off.   Usage: node e2e/notes-api.mjs
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
const act = (model, id, action) => api('POST', `/records/${model}/${id}/actions/${action}`);
const mustAct = async (model, id, action) => {
  const r = await act(model, id, action);
  if (r.status !== 200) throw new Error(`${model} ${action}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const create = async (model, values) => {
  const r = await api('POST', `/records/${model}`, values);
  if (r.status !== 201) throw new Error(`${model}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const get = async (model, id) => (await api('GET', `/records/${model}/${id}`)).body;
const stock = async (productId) => (await api('GET', `/records/stock.quant?f.productId=${productId}`)).body.records[0];
const books = async () => {
  const tb = (await api('GET', '/reports/trial-balance')).body;
  const inv = tb.rows.find((r) => r.code === '1400');
  return { tb, inventory: inv ? inv.balance : '0.00' };
};

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
const bolt = await create('base.product', { name: 'Steel bolt M8', hsnCode: '7318', salePrice: '9', costPrice: '4', kind: 'goods' });
const acme = await create('base.contact', { name: 'Acme Industries', stateCode: '27', gstin: '27AAPFU0939F1ZV' });
const kcc = await create('base.contact', { name: 'Karnataka Copper Co', isVendor: true, isCustomer: false, stateCode: '29' });
const opening = await create('stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '100', unitCost: '4' }] });
await mustAct('stock.adjustment', opening.id, 'post');

// Invoice: 30 bolts @ 9 -> 270 + CGST 24.30 + SGST 24.30 = 318.60 -> 319. Cost 30 x 4 = 120.
const inv = await create('sales.invoice', { customerId: acme.id, placeOfSupply: '27', lines: [{ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty: '30', unitPrice: '9', gstRate: '18' }] });
const invPosted = await mustAct('sales.invoice', inv.id, 'post');

// Credit note for a return of 10: 90 + 8.10 + 8.10 = 106.20 -> 106.
let r = await api('POST', '/records/sales.credit_note', {
  invoiceId: inv.id, customerId: acme.id, placeOfSupply: '27', reason: 'return',
  lines: [{ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty: '10', unitPrice: '9', gstRate: '18' }],
});
check(r.status === 201 && r.body.totalAmount === '106.00', 'credit note totals 106.00', r.body);
const cn1 = r.body;
r = await act('sales.credit_note', cn1.id, 'post');
check(r.status === 200 && /^CN\/\d{2}-\d{2}\/0001$/.test(r.body.number) && r.body.amountApplied === '106.00' && r.body.customerGstin === '27AAPFU0939F1ZV', 'credit note posted, applied in full, GSTIN frozen', r.body);
let i = await get('sales.invoice', inv.id);
check(i.amountDue === '213.00' && i.paymentState === 'partial', 'invoice due drops to 213', i);
let q = await stock(bolt.id);
check(q.qty === '80.000' && q.value === '320.00', 'returned goods back in stock at the original cost (4.00)', q);
const cnEntry = (await api('GET', `/records/account.entry?q=${encodeURIComponent(r.body.number)}`)).body.records[0];
check(cnEntry?.amount === '146.20', 'credit note journal: 106 + 0.20 round off + 40 stock = 146.20', cnEntry);

// Rate difference: no stock moves.
const cn2 = await create('sales.credit_note', { invoiceId: inv.id, customerId: acme.id, placeOfSupply: '27', reason: 'rate', lines: [{ description: 'Rate difference', qty: '1', unitPrice: '50', gstRate: '18' }] });
await mustAct('sales.credit_note', cn2.id, 'post');
check((await get('sales.invoice', inv.id)).amountDue === '154.00' && (await stock(bolt.id)).qty === '80.000', 'rate-difference note: due 154, stock untouched');

// Guards.
const big = await create('sales.credit_note', { invoiceId: inv.id, customerId: acme.id, placeOfSupply: '27', reason: 'discount', lines: [{ description: 'Discount', qty: '1', unitPrice: '300', gstRate: '18' }] });
r = await act('sales.credit_note', big.id, 'post');
check(r.status === 422 && /Only ₹154.00 of INV\//.test(r.body.error), 'cannot credit more than is left on the invoice', r.body);
r = await act('sales.credit_note', big.id, 'copyLines');
check(r.status === 200 && r.body.lines.length === 1 && r.body.lines[0].qty === '30.000' && r.body.totalAmount === '319.00', 'copy items from invoice fills the lines and totals', r.body);
await api('DELETE', `/records/sales.credit_note/${big.id}`);
r = await act('sales.invoice', inv.id, 'cancel');
check(r.status === 409 && /credit notes/.test(r.body.error), 'credited invoice cannot be cancelled', r.body);

// A credit on a fully paid invoice becomes customer credit (an advance in receivables).
const inv2 = await create('sales.invoice', { customerId: acme.id, placeOfSupply: '27', lines: [{ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty: '1', unitPrice: '9', gstRate: '18' }] });
await mustAct('sales.invoice', inv2.id, 'post'); // 10.62 -> 11
const rc = await create('account.payment', { direction: 'inbound', partnerId: acme.id, amount: '11', lines: [{ invoiceId: inv2.id, amount: '11' }] });
await mustAct('account.payment', rc.id, 'post');
const cn3 = await create('sales.credit_note', { invoiceId: inv2.id, customerId: acme.id, placeOfSupply: '27', reason: 'return', lines: [{ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty: '1', unitPrice: '9', gstRate: '18' }] });
r = await act('sales.credit_note', cn3.id, 'post');
check(r.body.amountApplied === '0.00' && r.body.unappliedAmount === '11.00', 'credit on a paid invoice is left as customer credit', r.body);
const age = (await api('GET', '/reports/ageing?direction=inbound')).body.rows.find((x) => x.partnerId === acme.id);
check(age.total === '154.00' && age.advance === '11.00' && age.net === '143.00', 'receivables: 154 due less 11 credit', age);

// Cancelling the return note restores the invoice, stock and books.
r = await act('sales.credit_note', cn1.id, 'cancel');
i = await get('sales.invoice', inv.id);
q = await stock(bolt.id);
check(r.body.state === 'cancelled' && i.amountDue === '260.00' && q.qty === '70.000', 'cancelled return: due back to 260, the 10 bolts leave stock again (100 - 30 - 1 + 1)', [i.amountDue, q.qty]);

// Debit note: bill 50 @ 5 from Karnataka (IGST): 250 + 45 = 295; return 20 @ 5 -> 100 + 18 = 118.
const bill = await create('purchase.bill', { vendorId: kcc.id, vendorState: '29', vendorBillNo: 'KCC/9', lines: [{ productId: bolt.id, description: 'Steel bolt M8', qty: '50', unitPrice: '5', gstRate: '18' }] });
await mustAct('purchase.bill', bill.id, 'post');
const before = await stock(bolt.id);
const dn = await create('purchase.debit_note', { billId: bill.id, vendorId: kcc.id, vendorState: '29', reason: 'return', lines: [{ productId: bolt.id, description: 'Steel bolt M8', qty: '20', unitPrice: '5', gstRate: '18' }] });
r = await act('purchase.debit_note', dn.id, 'post');
check(r.status === 200 && /^DN\//.test(r.body.number) && r.body.totalAmount === '118.00', 'debit note posted for 118', r.body);
q = await stock(bolt.id);
check(Number(q.qty) === Number(before.qty) - 20 && (Number(before.value) - Number(q.value)).toFixed(2) === '100.00', 'returned goods leave stock at the bill cost (20 x 5 = 100)', [before, q]);
check((await get('purchase.bill', bill.id)).amountDue === '177.00', 'bill due drops to 177');

// GST returns net the notes; books stay balanced and agree with stock.
const g3 = (await api('GET', '/reports/gstr-3b')).body;
// Outward: 270 + 9 (inv2) - 50 (rate) - 9 (cn3) = 220 taxable; ITC IGST 45 - 18 = 27.
check(g3.outward.taxable.taxable === '220.00' && g3.itc.igst === '27.00', 'GSTR-3B nets credit notes and debit notes', g3);
const g1 = (await api('GET', '/reports/gstr-1')).body;
check(g1.cdnr.length === 2 && g1.cdnr.every((n) => n.originalInvoice?.startsWith('INV/') && n.gstin === '27AAPFU0939F1ZV'), 'GSTR-1 CDNR lists posted credit notes with their invoices', g1.cdnr);
const h = g1.hsn.find((x) => x.hsn === '7318');
check(h.qty === '30' && h.taxable === '270.00', 'HSN summary is net of the returned bolt (31 sold - 1 returned)', h);
const { tb, inventory } = await books();
const quant = await stock(bolt.id);
check(tb.balanced && inventory === quant.value, `books balance and the stock account matches stock value (${inventory})`, [tb.totalDebit, tb.totalCredit, quant.value]);

// Manual journal: rent paid from the bank.
const rent = await create('account.account', { code: '6100', name: 'Rent', type: 'expense' });
const bank = (await api('GET', '/records/account.account?q=1200')).body.records[0];
r = await api('POST', '/records/account.manual', { narration: 'October rent', lines: [{ accountId: rent.id, debit: '25000', credit: '25000' }] });
check(r.status === 422 && r.body.fieldErrors?.['lines.0.credit'], 'a line cannot be both debit and credit', r.body);
const mj = await create('account.manual', { narration: 'October rent', lines: [{ accountId: rent.id, debit: '25000' }, { accountId: bank.id, credit: '24000' }] });
r = await act('account.manual', mj.id, 'post');
check(r.status === 422 && /must be equal/.test(r.body.error), 'unbalanced journal cannot be posted', r.body);
await api('PATCH', `/records/account.manual/${mj.id}`, { lines: [{ accountId: rent.id, debit: '25000', label: 'Shop rent' }, { accountId: bank.id, credit: '25000' }] });
r = await act('account.manual', mj.id, 'post');
check(r.status === 200 && /^MJ\//.test(r.body.number), 'balanced journal posts', r.body);
const pl = (await api('GET', '/reports/profit-loss')).body;
check(pl.expense.some((e) => e.code === '6100' && e.balance === '25000.00'), 'rent appears in the P&L', pl.expense);
await mustAct('account.manual', mj.id, 'cancel');
const pl2 = (await api('GET', '/reports/profit-loss')).body;
check(!pl2.expense.some((e) => e.code === '6100' && e.balance !== '0.00'), 'cancelled journal reverses the rent');
check((await api('GET', '/reports/trial-balance')).body.balanced, 'trial balance still balances');
check((await api('GET', '/audit/verify')).body.ok, 'audit chain intact');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
