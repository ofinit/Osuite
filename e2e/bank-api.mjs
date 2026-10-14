// API checks for bank reconciliation against a FRESH product DB with
// OSUITE_LICENSE=off.   Usage: node e2e/bank-api.mjs
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
const create = async (model, values) => {
  const r = await api('POST', `/records/${model}`, values);
  if (r.status !== 201) throw new Error(`${model}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const post = async (model, id) => {
  const r = await api('POST', `/records/${model}/${id}/actions/post`);
  if (r.status !== 200) throw new Error(`${model} post: ${JSON.stringify(r.body)}`);
  return r.body;
};
const today = new Date().toLocaleDateString('en-CA');

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
const banks = (await api('GET', '/records/account.bank_account')).body.records;
check(banks.length === 1 && banks[0].ledgerAccountId.display === 'Bank account', 'a main bank account exists, booked to ledger 1200', banks);
const bank = banks[0];

const svc = await create('base.product', { name: 'Consulting', kind: 'service', hsnCode: '9983', salePrice: '1000' });
const acme = await create('base.contact', { name: 'Acme Industries', stateCode: '27' });
const kaveri = await create('base.contact', { name: 'Kaveri Agro Foods', stateCode: '27' });
const vendor = await create('base.contact', { name: 'Pune Steel Suppliers', isVendor: true, isCustomer: false, stateCode: '27' });
const line = { productId: svc.id, description: 'Consulting', qty: '1', unitPrice: '1000', gstRate: '18' }; // 1180
const sell = async (c) => post('sales.invoice', (await create('sales.invoice', { customerId: c.id, placeOfSupply: '27', lines: [line] })).id);
const i1 = await sell(acme);
const i2 = await sell(kaveri);
const i3 = await sell(kaveri);
const bill = await post('purchase.bill', (await create('purchase.bill', { vendorId: vendor.id, vendorState: '27', vendorBillNo: 'PSS-1', lines: [line] })).id);

// Two receipts of the same amount (the bank text tells them apart), a vendor payment, and a cheque not yet cleared.
const pay = async (direction, partner, amount, mode, reference, alloc) =>
  post('account.payment', (await create('account.payment', { direction, partnerId: partner.id, amount, mode, reference, lines: [alloc] })).id);
const rAcme = await pay('inbound', acme, '1180', 'upi', 'UTR4471002', { invoiceId: i1.id, amount: '1180' });
const rKaveri = await pay('inbound', kaveri, '1180', 'upi', 'UTR9900113', { invoiceId: i2.id, amount: '1180' });
await pay('outbound', vendor, '1180', 'bank', 'N278100', { billId: bill.id, amount: '1180' });
await pay('inbound', kaveri, '500', 'cheque', '000123', { invoiceId: i3.id, amount: '500' });
check(rAcme.bankAccountId?.display === 'Main bank account', 'non-cash payments default to the main bank account', rAcme.bankAccountId);

const rows = [
  { date: today, description: 'UPI-ACME INDUSTRIES-acme@okicici-UTR4471002', reference: 'UTR4471002', amount: '1180.00', balance: '1180.00' },
  { date: today, description: 'UPI-KAVERI AGRO-UTR9900113', reference: null, amount: '1180.00', balance: '2360.00' },
  { date: today, description: 'NEFT DR-PUNE STEEL SUPPLIERS-N278100', reference: 'N278100', amount: '-1180.00', balance: '1180.00' },
  { date: today, description: 'CHGS INCL GST', reference: null, amount: '-59.00', balance: '1121.00' },
  { date: today, description: 'INT.PD:01-07-2026 TO 30-09-2026', reference: null, amount: '12.50', balance: '1133.50' },
];
let r = await api('POST', '/bank/statements', { bankAccountId: bank.id, rows, closingBalance: '1133.50' });
check(r.status === 201 && r.body.imported === 5 && r.body.duplicates === 0, 'statement imported (5 lines)', r.body);
const stId = r.body.statementId;
r = await api('POST', '/bank/statements', { bankAccountId: bank.id, rows });
check(r.status === 409 && /All 5 lines were imported before/.test(r.body.error), 'the same statement cannot be imported twice', r.body);
r = await api('POST', '/bank/statements', { bankAccountId: bank.id, rows: [...rows.slice(3), { date: today, description: 'ATM WDL', reference: null, amount: '-200.00' }] });
check(r.status === 201 && r.body.imported === 1 && r.body.duplicates === 2, 'an overlapping statement imports only the new line', r.body);
const st2 = r.body.statementId;

// Suggestions and auto-match.
let view = (await api('GET', `/bank/statements/${stId}`)).body;
const l1 = view.lines[0];
check(l1.suggestions.length === 2 && l1.suggestions[0].referenceMatch && l1.suggestions[0].partner === 'Acme Industries', 'two same-amount receipts: the one whose UTR is in the bank text comes first', l1.suggestions);
r = await api('POST', `/bank/statements/${stId}/auto-match`);
check(r.body.matched === 3, 'auto-match pairs 3 lines (both UTR receipts and the vendor payment)', r.body);
view = (await api('GET', `/bank/statements/${stId}`)).body;
check(view.lines[0].matched?.reference === rAcme.number && view.lines[1].matched?.reference === rKaveri.number, 'each receipt matched to the right customer', view.lines.map((l) => l.matched?.reference));
check(view.lines[3].matched === null && view.lines[3].suggestions.length === 0, 'bank charges have no book entry yet');

// Book what the books don't have.
const charges = await create('account.account', { code: '6200', name: 'Bank charges', type: 'expense' });
const interest = await create('account.account', { code: '4200', name: 'Interest received', type: 'income' });
r = await api('POST', `/bank/lines/${view.lines[3].id}/book`, { accountId: charges.id });
check(r.status === 200 && r.body.entryId, 'bank charges booked from the statement', r.body);
await api('POST', `/bank/lines/${view.lines[4].id}/book`, { accountId: interest.id, narration: 'Savings interest Q2' });
r = await api('POST', `/bank/lines/${view.lines[2].id}/book`, { accountId: charges.id });
check(r.status === 409, 'an already-matched line cannot be booked again', r.body);

view = (await api('GET', `/bank/statements/${stId}`)).body;
// Books: 1180 + 1180 + 500 - 1180 - 59 + 12.50 - 200 (ATM line not booked) ... the ATM line is on statement 2, unbooked.
check(view.summary.matched === 5 && view.summary.total === 5, 'every line on the statement is reconciled', view.summary);
check(view.summary.bookBalance === '1633.50', 'book balance 1,633.50', view.summary);
check(view.summary.unreconciledBookItems === 1 && view.summary.unreconciledBookTotal === '500.00', 'the uncleared ₹500 cheque is the only book item not on the bank', view.summary);
check(view.summary.difference === '-500.00', 'bank vs books differ by exactly that cheque', view.summary);

// Unmatch, wrong match, re-match.
await api('POST', `/bank/lines/${view.lines[1].id}/unmatch`);
view = (await api('GET', `/bank/statements/${stId}`)).body;
check(view.lines[1].matched === null && view.lines[1].suggestions.some((s) => s.reference === rKaveri.number), 'unmatched line offers its receipt again', view.lines[1]);
r = await api('POST', `/bank/lines/${view.lines[1].id}/book`, { accountId: bank.ledgerAccountId.id });
check(r.status === 422 && /other than the bank/.test(r.body.error), 'cannot book a line against the bank itself', r.body);
const cheque = (await api('GET', `/bank/statements/${st2}`)).body; // statement 2 has only the ATM line
r = await api('POST', `/bank/lines/${view.lines[1].id}/match`, { entryLineId: 999999 });
check(r.status === 422, 'cannot match to an entry of a different amount or account', r.body);
r = await api('POST', `/bank/lines/${view.lines[1].id}/match`, { entryLineId: view.lines[1].suggestions[0].entryLineId });
check(r.status === 200, 'manual match accepted');
check(cheque.lines.length === 1 && cheque.lines[0].amount === '-200.00', 'the second statement holds the ATM withdrawal');

const tb = (await api('GET', '/reports/trial-balance')).body;
check(tb.balanced && tb.rows.some((x) => x.code === '6200' && x.balance === '59.00') && tb.rows.some((x) => x.code === '4200' && x.balance === '12.50'), 'charges and interest are in the books; trial balance balances', tb.rows.filter((x) => ['6200', '4200'].includes(x.code)));
r = await api('POST', '/records/account.statement', { name: 'x' });
check(r.status === 403, 'statements are only created by import', r.body);
const hist = (await api('GET', `/records/account.statement_line/${view.lines[1].id}/history`)).body;
check(hist.map((h) => h.action).join() === 'match,unmatch,match', 'match history is audited', hist.map((h) => h.action));
check((await api('GET', '/audit/verify')).body.ok, 'audit chain intact');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
