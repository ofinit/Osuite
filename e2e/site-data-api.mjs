// API checks that business details and plans edited in the admin panel reach
// the public GET /v1/site and the product app's licence screen data.
// FRESH admin + product DBs; product server with OSUITE_LICENSE=off.
// Usage: node e2e/site-data-api.mjs
const ADMIN = 'http://127.0.0.1:47900';
const PRODUCT = 'http://127.0.0.1:47800/api';
let cookie = '';
let token = '';
let failed = 0;
const check = (cond, msg, extra) => {
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}${cond || extra === undefined ? '' : `  -> ${JSON.stringify(extra).slice(0, 500)}`}`);
  if (!cond) failed++;
};
async function admin(method, path, body) {
  const r = await fetch(ADMIN + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const t = await r.text();
  return { status: r.status, headers: r.headers, body: t ? JSON.parse(t) : null };
}
async function product(method, path, body) {
  const r = await fetch(PRODUCT + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}

// ---------------------------------------------------------------- defaults before anything is set
let r = await admin('GET', '/v1/site');
check(r.status === 200 && r.body.business.brandName === 'OSuite' && r.body.business.gstNote, 'site data has safe defaults', r.body.business);
check(r.headers.get('access-control-allow-origin') === '*' && /max-age=60/.test(r.headers.get('cache-control') ?? ''), 'public, cacheable, readable from the website', Object.fromEntries(r.headers));
check(r.body.plans.map((p) => p.id).join() === 'trial,starter,business,enterprise', 'plans in display order', r.body.plans.map((p) => p.id));
check(!('active' in r.body.plans[0]) && !('modules' in r.body.plans[0]), 'only what the website needs is published', Object.keys(r.body.plans[0]));

// ---------------------------------------------------------------- editing in the admin panel
check((await admin('PUT', '/admin/business', { legalName: 'x' })).status === 401, 'editing needs a staff session');
await admin('POST', '/admin/auth/login', { email: 'owner@osuite.local', password: 'owner-password' });
r = await admin('GET', '/admin/business');
check(r.status === 200 && r.body.fields.gstin.label === 'GSTIN' && r.body.values.brandName === 'OSuite', 'admin form gets fields and values', r.body.fields.gstin);
r = await admin('PUT', '/admin/business', { gstin: '27AAPFU0939F1ZX', pincode: '4110' });
check(r.status === 422 && r.body.fieldErrors.gstin === 'Invalid GSTIN' && r.body.fieldErrors.pincode, 'invalid GSTIN and PIN refused with field errors', r.body);
r = await admin('PUT', '/admin/business', { legalName: '' });
check(r.status === 422 && r.body.fieldErrors.legalName, 'registered name is required', r.body);
r = await admin('PUT', '/admin/business', { gstin: '27AAPFU0939F1ZV', pan: 'AAAAA1111A' });
check(r.status === 422 && r.body.fieldErrors.pan === 'PAN does not match the GSTIN', 'PAN must match the GSTIN', r.body);
const details = {
  legalName: 'OfinIT Solutions Private Limited',
  gstin: '27aapfu0939f1zv',
  pan: 'AAPFU0939F',
  street: '14 MG Road',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411030',
  supportEmail: 'support@osuite.business',
  salesEmail: 'sales@osuite.business',
  phone: '+91 20 2445 6677',
  whatsapp: '+91 98220 12345',
  supportHours: 'Monday to Saturday, 10 am to 7 pm IST',
  grievanceOfficer: 'Priya Sharma',
  grievanceEmail: 'grievance@osuite.business',
};
r = await admin('PUT', '/admin/business', details);
check(r.status === 200 && r.body.gstin === '27AAPFU0939F1ZV' && r.body.brandName === 'OSuite', 'details saved, GSTIN normalised, untouched fields kept', r.body);
r = await admin('PATCH', '/admin/plans/business', { priceMonthly: '2999', tagline: 'For growing teams that bill every day.', includes: 'Five users, all features, priority support.', sortOrder: 1 });
check(r.status === 200 && r.body.tagline === 'For growing teams that bill every day.', 'plan price and website text saved', r.body);
await admin('PATCH', '/admin/plans/starter', { sortOrder: 2 });
check((await admin('PATCH', '/admin/plans/starter', { sortOrder: 500 })).status === 400, 'order must be 0 to 99');
r = await admin('GET', '/admin/events');
const events = Array.isArray(r.body) ? r.body : (r.body?.events ?? []);
check(r.status !== 200 || events.some((e) => e.action === 'business.updated'), 'business edits are recorded', events.slice(0, 3));

// ---------------------------------------------------------------- published
r = await admin('GET', '/v1/site');
check(r.body.business.legalName === 'OfinIT Solutions Private Limited' && r.body.business.supportEmail === 'support@osuite.business', 'website sees the new details at once', r.body.business);
check(r.body.plans.map((p) => p.id).join() === 'trial,business,starter,enterprise', 'website sees the new order', r.body.plans.map((p) => p.id));
check(r.body.plans.find((p) => p.id === 'business').priceMonthly === '2999.00', 'website sees the new price', r.body.plans);
await admin('PATCH', '/admin/plans/enterprise', { active: false });
r = await admin('GET', '/v1/site');
check(!r.body.plans.some((p) => p.id === 'enterprise'), 'a plan no longer offered disappears from the website');

// ---------------------------------------------------------------- in the product
await product('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await product('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
r = await product('GET', '/vendor');
check(r.status === 200 && r.body.business.supportEmail === 'support@osuite.business' && r.body.fetchedAt, 'the app gets the seller details', r.body);
check(r.body.plans.find((p) => p.id === 'business')?.priceMonthly === '2999.00', 'the app shows current prices', r.body.plans);
token = '';
check((await product('GET', '/vendor')).status === 401, 'the app route needs a signed-in user');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
