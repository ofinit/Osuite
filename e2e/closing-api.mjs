// API checks for applying credit and year-end closing against a FRESH product
// DB with OSUITE_LICENSE=off.   Usage: node e2e/closing-api.mjs
// Assumes "today" is in FY 2026-27 or later, so FY 2025-26 has ended.
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
const due = async (id) => (await api('GET', `/records/sales.invoice/${id}`)).body.amountDue;

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
const svc = await create('base.product', { name: 'Consulting', kind: 'service', hsnCode: '9983', salePrice: '1000' });
const acme = await create('base.contact', { name: 'Acme Industries', stateCode: '27' });
const line = (rate) => ({ productId: svc.id, description: 'Consulting', qty: '1', unitPrice: rate, gstRate: '18' });
const invoice = async (rate, date) => post('sales.invoice', (await create('sales.invoice', { customerId: acme.id, placeOfSupply: '27', date, lines: [line(rate)] })).id);

// ---------------------------------------------------------------- applying credit
const advance = await post('account.payment', (await create('account.payment', { direction: 'inbound', partnerId: acme.id, amount: '2000', mode: 'bank' })).id);
const inv1 = await invoice('1000'); // 1180
let r = await api('GET', `/credits?direction=inbound&partnerId=${acme.id}`);
check(r.body.length === 1 && r.body[0].remaining === '2000.00', 'the advance shows as available credit', r.body);
r = await api('POST', '/credits/apply', { direction: 'inbound', partnerId: acme.id, docId: inv1.id });
check(r.body.applied === '1180.00' && (await due(inv1.id)) === '0.00', 'credit applied to one invoice settles it', r.body);
const inv2 = await invoice('1000');
r = await api('POST', '/credits/apply', { direction: 'inbound', partnerId: acme.id });
check(r.body.applied === '820.00' && (await due(inv2.id)) === '360.00', 'the remaining 820 goes to the next invoice', r.body);
r = await api('POST', '/credits/apply', { direction: 'inbound', partnerId: acme.id });
check(r.status === 422 && /no credit/.test(r.body.error), 'nothing more to apply', r.body);

// A credit note's leftover credit can be applied too.
const inv3 = await invoice('1000');
await post('account.payment', (await create('account.payment', { direction: 'inbound', partnerId: acme.id, amount: '1180', lines: [{ invoiceId: inv3.id, amount: '1180' }] })).id);
const cn = await post('sales.credit_note', (await create('sales.credit_note', { invoiceId: inv3.id, customerId: acme.id, placeOfSupply: '27', reason: 'discount', lines: [{ description: 'Discount', qty: '1', unitPrice: '100', gstRate: '18' }] })).id);
check(cn.unappliedAmount === '118.00', 'discount on a paid invoice leaves 118 credit', cn);
r = await api('POST', '/credits/apply', { direction: 'inbound', partnerId: acme.id, docId: inv2.id });
check(r.body.applied === '118.00' && (await due(inv2.id)) === '242.00', 'credit note credit applied: 360 - 118 = 242', r.body);
const age = (await api('GET', '/reports/ageing?direction=inbound')).body.rows.find((x) => x.partnerId === acme.id);
check(age.advance === '0.00' && age.total === '242.00', 'receivables no longer show the applied credit', age);

// Cancelling the advance gives its credit back from both invoices.
await api('POST', `/records/account.payment/${advance.id}/actions/cancel`);
check((await due(inv1.id)) === '1180.00' && (await due(inv2.id)) === '1062.00', 'cancelled advance: invoice 1 due 1180 again, invoice 2 due 1062', [await due(inv1.id), await due(inv2.id)]);
const apps = (await api('GET', '/records/account.settlement')).body.records;
check(apps.length === 3 && apps.filter((a) => a.state === 'reversed').length === 2, 'its two applications are marked reversed', apps.map((a) => a.state));
const cnApp = apps.find((a) => a.state === 'active');
await api('POST', `/credits/${cnApp.id}/reverse`);
check((await due(inv2.id)) === '1180.00' && (await api('GET', `/records/sales.credit_note/${cn.id}`)).body.unappliedAmount === '118.00', 'one application can be reversed on its own');

// ---------------------------------------------------------------- year-end closing (FY 2025-26)
const fyInv = await invoice('10000', '2026-03-15'); // sales 10,000 in FY 25-26
const rent = await create('account.account', { code: '6100', name: 'Rent', type: 'expense' });
const bank = (await api('GET', '/records/account.account?q=1200')).body.records[0];
await post('account.manual', (await create('account.manual', { date: '2026-03-20', narration: 'March rent', lines: [{ accountId: rent.id, debit: '3000' }, { accountId: bank.id, credit: '3000' }] })).id);
const draft = await create('sales.invoice', { customerId: acme.id, placeOfSupply: '27', date: '2026-03-25', lines: [line('500')] });

let years = (await api('GET', '/closing/years')).body;
const y25 = years.find((y) => y.fy === '25-26');
check(y25 && y25.profit === '7000.00' && y25.ended && !y25.closed && y25.blockers.join() === '1 draft invoices', 'FY 2025-26: profit 7,000, ended, one draft blocking', y25);
r = await api('POST', '/closing/years/25-26/close');
check(r.status === 422 && /1 draft invoices/.test(r.body.error), 'cannot close while drafts are dated in the year', r.body);
await api('DELETE', `/records/sales.invoice/${draft.id}`);
r = await api('POST', '/closing/years/26-27/close');
check(r.status === 422 && /has not ended/.test(r.body.error), 'the current year cannot be closed', r.body);
r = await api('POST', '/closing/years/25-26/close');
check(r.status === 200 && r.body.profit === '7000.00', 'FY 2025-26 closed with profit 7,000', r.body);

const pl = (await api('GET', '/reports/profit-loss?from=2025-04-01&to=2026-03-31')).body;
check(pl.netProfit === '7000.00', 'P&L of the closed year still shows its profit', pl.netProfit);
const bs = (await api('GET', '/reports/balance-sheet?asOf=2026-03-31')).body;
check(bs.balanced && bs.profit === '0.00' && bs.equity.some((a) => a.code === '3200' && a.balance === '7000.00'), 'balance sheet at year end: profit moved to Reserves & surplus', bs.equity);

const late = await create('sales.invoice', { customerId: acme.id, placeOfSupply: '27', date: '2026-03-28', lines: [line('500')] });
r = await api('POST', `/records/sales.invoice/${late.id}/actions/post`);
check(r.status === 409 && /2025-26 is closed/.test(r.body.error), 'posting into the closed year is refused', r.body);
check((await api('GET', `/records/sales.invoice/${late.id}`)).body.number === null, 'the refused invoice gets no number');
years = (await api('GET', '/closing/years')).body;
check(years.find((y) => y.fy === '25-26').closed, 'the year shows as closed');

r = await api('POST', '/closing/years/25-26/reopen');
check(r.status === 200, 'latest closed year reopened', r.body);
const bs2 = (await api('GET', '/reports/balance-sheet?asOf=2026-03-31')).body;
check(bs2.balanced && bs2.profit === '7000.00' && !bs2.equity.some((a) => a.code === '3200' && a.balance !== '0.00'), 'reopened: profit back in the year, reserves cleared', bs2);
const plNow = (await api('GET', '/reports/profit-loss')).body;
check(!plNow.income.some((a) => a.code === '4100' && Number(a.balance) > 10000), 'reopening does not touch the current year P&L', plNow.income);
r = await api('POST', `/records/sales.invoice/${late.id}/actions/post`);
check(r.status === 200, 'posting into the reopened year works again', r.body);
r = await api('POST', '/closing/years/25-26/close');
check(r.status === 200 && r.body.profit === '7500.00', 'closed again with the late invoice included (7,500)', r.body);
check((await api('GET', '/reports/trial-balance')).body.balanced, 'trial balance balances');
check((await api('GET', '/audit/verify')).body.ok, 'audit chain intact');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
