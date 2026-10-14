// API checks for the ledger, party statement and day book against a FRESH
// product DB with OSUITE_LICENSE=off.   Usage: node e2e/ledger-api.mjs
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

const old = await invoice('10000', '2026-03-15'); // 11800, before the period
const pay = await post('account.payment', (await create('account.payment', { direction: 'inbound', partnerId: acme.id, amount: '3000', mode: 'bank', date: '2026-05-01' })).id);
const inv1 = await invoice('1000', '2026-05-10'); // 1180
const inv2 = await invoice('2000', '2026-06-01'); // 2360
const accounts = (await api('GET', '/records/account.account?limit=100')).body;
const list = accounts.rows ?? accounts.records ?? accounts;
const sales = list.find((a) => a.key === 'sales');
const debtors = list.find((a) => a.key === 'receivable');

// ---------------------------------------------------------------- party statement
let r = await api('GET', `/reports/ledger?partnerId=${acme.id}&from=2026-04-01&to=2026-12-31`);
check(r.status === 200 && r.body.partner.name === 'Acme Industries' && r.body.account === null, 'party statement names the party', r.body);
check(r.body.opening === '11800.00', 'opening balance carries the March invoice', r.body.opening);
check(r.body.rows.map((x) => x.reference).join() === [pay.number, inv1.number, inv2.number].join(), 'items in date order', r.body.rows);
check(r.body.rows.map((x) => x.balance).join() === '8800.00,9980.00,12340.00', 'running balance', r.body.rows.map((x) => x.balance));
check(r.body.totalDebit === '3540.00' && r.body.totalCredit === '3000.00' && r.body.closing === '12340.00', 'totals and closing', r.body);
check(r.body.rows[0].against.includes('Bank') && r.body.rows[1].against.includes('Sales'), 'against shows the other side', r.body.rows.map((x) => x.against));
check(r.body.rows[1].refModel === 'sales.invoice' && r.body.rows[1].refId === inv1.id, 'items point at their source document', r.body.rows[1]);

// ---------------------------------------------------------------- account ledger
r = await api('GET', `/reports/ledger?accountId=${sales.id}&from=2026-04-01&to=2026-12-31`);
check(r.body.account.id === sales.id && r.body.opening === '-10000.00' && r.body.closing === '-13000.00', 'sales ledger opening and closing (credit)', r.body);
check(r.body.rows.length === 2 && r.body.rows.every((x) => x.against.includes(debtors.name)), 'sales items are against debtors', r.body.rows);
r = await api('GET', `/reports/ledger?accountId=${debtors.id}&partnerId=${acme.id}&from=2026-05-05&to=2026-05-31`);
check(r.body.opening === '8800.00' && r.body.rows.length === 1 && r.body.closing === '9980.00', 'account + party with a narrow range', r.body);
// Default range is the financial year to date.
r = await api('GET', `/reports/ledger?accountId=${debtors.id}`);
check(r.body.from === '2026-04-01' && r.body.opening === '11800.00', 'defaults to the current financial year', { from: r.body.from, opening: r.body.opening });
check((await api('GET', '/reports/ledger')).status === 400, 'no account or party is refused');
check((await api('GET', '/reports/ledger?accountId=99999')).status === 404, 'unknown account is refused');
check((await api('GET', `/reports/ledger?accountId=${sales.id}&from=2026-06-01&to=2026-05-01`)).status === 400, 'inverted range is refused');

// ---------------------------------------------------------------- day book
r = await api('GET', '/reports/day-book?from=2026-05-01&to=2026-05-31');
check(r.body.entries.length === 2 && r.body.entries[0].reference === pay.number, 'day book lists the period entries in order', r.body.entries);
check(
  r.body.entries.every((e) => e.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) === 0),
  'every day book entry balances',
);
check(r.body.entries[1].amount === '1180.00' && r.body.total === '4180.00', 'entry amounts and total', r.body.entries.map((e) => e.amount));
check(r.body.entries[1].lines[0].debit !== '0.00', 'debits listed first');
r = await api('GET', '/reports/day-book');
check(r.status === 200 && r.body.from === r.body.to, 'day book defaults to today', r.body.from);
check(old.number.startsWith('INV/25-26/'), 'March invoice numbered in FY 2025-26', old.number);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
