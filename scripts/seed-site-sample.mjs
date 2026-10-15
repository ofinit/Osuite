// Fills the DEV admin panel with sample business details and plan text, so the
// website can be previewed with realistic content. Never run against production.
//   node scripts/seed-site-sample.mjs   (admin API running on 127.0.0.1:47900)
const A = 'http://127.0.0.1:47900';
const login = await fetch(`${A}/admin/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'owner@osuite.local', password: 'owner-password' }),
});
if (!login.ok) throw new Error('Dev owner login failed: is this the dev admin API?');
const cookie = login.headers.get('set-cookie').split(';')[0];
const send = async (method, path, body) => {
  const r = await fetch(`${A}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
};
// Undo anything tests changed: the seeded order, prices and plans on sale.
await send('PATCH', '/admin/plans/starter', { sortOrder: 1, active: true, priceMonthly: '799', priceYearly: '7990', cloudAddonMonthly: '499', seats: 1 });
await send('PATCH', '/admin/plans/business', { sortOrder: 2, active: true, priceMonthly: '2499', priceYearly: '24990', cloudAddonMonthly: '999', seats: 5 });
await send('PATCH', '/admin/plans/enterprise', { sortOrder: 3, active: true, priceMonthly: '7999', priceYearly: '79990', cloudAddonMonthly: '2999', seats: 25 });
await send('PATCH', '/admin/plans/starter', {
  tagline: 'For a shop or a one-person office.',
  includes: 'Everything in OSuite on one PC: invoicing, GST returns, stock, banking, reports and daily backups. Email support.',
});
await send('PATCH', '/admin/plans/business', {
  tagline: 'For a trading or service business with a small team.',
  includes: 'Everything in Starter for five people, plus e-invoicing and e-way bills, and priority help on phone and WhatsApp.',
});
await send('PATCH', '/admin/plans/enterprise', {
  tagline: 'For distributors and firms with several departments.',
  includes: 'Everything in Business for twenty-five people, with help moving your data in and a named contact.',
});
await send('PUT', '/admin/business', {
  legalName: 'OfinIT (sample name)',
  street: 'Sample address, set in the admin panel',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  supportEmail: 'support@osuite.business',
  salesEmail: 'sales@osuite.business',
  phone: '+91 20 0000 0000',
  supportHours: 'Monday to Saturday, 10 am to 7 pm',
  grievanceOfficer: 'Sample name',
  grievanceEmail: 'grievance@osuite.business',
});
console.log('sample site data set');
