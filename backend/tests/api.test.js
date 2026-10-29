// LIVE integration tests: real Supabase Auth + real Postgres + running API.
// Prereqs (see docs/VERIFICATION.md): server running at API_URL, 3 test users exist in Supabase Auth
// (owner, consumer, admin) and the admin user has profiles.is_admin = true.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const { createClient } = require('@supabase/supabase-js');

const API = (process.env.API_URL || 'http://localhost:5000') + '/api';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const tokens = {};
let listing, offsetDays = 30 + Math.floor(Math.random() * 300); // random far-future day => reruns don't collide

async function login(role) {
  const { data, error } = await sb.auth.signInWithPassword({
    email: process.env[`TEST_${role}_EMAIL`], password: process.env.TEST_PASSWORD });
  if (error) throw new Error(`login ${role}: ${error.message}`);
  tokens[role] = data.session.access_token;
}
async function call(method, path, role, body) {
  const r = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) },
    body: body && !['GET', 'HEAD'].includes(method) ? JSON.stringify(body) : undefined }); // fetch forbids a body on GET/HEAD
  let json = null; try { json = await r.json(); } catch (_) {}
  return { status: r.status, body: json };
}
const slot = (hStart, hEnd, day = 0) => {
  const d = new Date(Date.UTC(2027, 0, 1) + (offsetDays + day) * 86400000);
  const at = (h) => new Date(d.getTime() + h * 3600000).toISOString();
  return { start_time: at(hStart), end_time: at(hEnd) };
};
const errCode = (r) => r.body && r.body.error && r.body.error.code;

test.before(async () => { await login('OWNER'); await login('CONSUMER'); await login('ADMIN'); });

test('AUTH: protected routes reject missing/invalid token with 401 UNAUTHENTICATED', async () => {
  for (const [m, p] of [['POST', '/listings'], ['POST', '/bookings'], ['GET', '/bookings/mine'], ['GET', '/provider/bookings'], ['PATCH', '/admin/listings/x/review'], ['GET', '/alternatives']]) {
    const r = await call(m, p, null, {}); assert.strictEqual(r.status, 401, `${m} ${p}`); assert.strictEqual(errCode(r), 'UNAUTHENTICATED');
  }
  const r = await fetch(API + '/bookings/mine', { headers: { Authorization: 'Bearer not.a.token' } });
  assert.strictEqual(r.status, 401);
});

test('LISTINGS: create -> 201 pending; owner forced from token; status in body rejected', async () => {
  const body = { title: 'TEST Guindy Metro Lot', address: 'Guindy, Chennai', latitude: 13.0067, longitude: 80.2206, price_per_hour: 40, vehicle_type: 'fallback-api-test-vehicle' };
  let r = await call('POST', '/listings', 'OWNER', { ...body, status: 'approved' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/listings', 'OWNER', { ...body, owner_id: '00000000-0000-0000-0000-000000000000' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/listings', 'OWNER', body);
  assert.strictEqual(r.status, 201); assert.strictEqual(r.body.data.status, 'pending');
  listing = r.body.data;
});

test('LISTINGS: pending is hidden from public/other users, visible to owner & admin', async () => {
  assert.strictEqual((await call('GET', `/listings/${listing.id}`, null)).status, 404);
  assert.strictEqual((await call('GET', `/listings/${listing.id}`, 'CONSUMER')).status, 404);
  assert.strictEqual((await call('GET', `/listings/${listing.id}`, 'OWNER')).status, 200);
  assert.strictEqual((await call('GET', `/listings/${listing.id}`, 'ADMIN')).status, 200);
  const s = await call('GET', '/listings', null);
  assert.ok(!s.body.data.some((l) => l.id === listing.id), 'pending listing leaked into search');
});

test('BOOKING: pending listing is not bookable -> 422 LISTING_NOT_BOOKABLE', async () => {
  const r = await call('POST', '/bookings', 'CONSUMER', { listing_id: listing.id, ...slot(9, 11) });
  assert.strictEqual(r.status, 422); assert.strictEqual(errCode(r), 'LISTING_NOT_BOOKABLE');
});

test('PERMISSIONS: consumer cannot edit others listing / review; owner cannot self-approve', async () => {
  assert.strictEqual((await call('PATCH', `/listings/${listing.id}/review`, 'OWNER', {})).status, 404);
  let r = await call('PATCH', `/admin/listings/${listing.id}/review`, 'OWNER', { decision: 'approved' });
  assert.strictEqual(r.status, 403); assert.strictEqual(errCode(r), 'FORBIDDEN');
  r = await call('PATCH', `/admin/listings/${listing.id}/review`, 'CONSUMER', { decision: 'approved' });
  assert.strictEqual(r.status, 403);
  r = await call('PATCH', `/listings/${listing.id}`, 'OWNER', { status: 'approved' });
  assert.strictEqual(r.status, 400);
  r = await call('PATCH', `/listings/${listing.id}`, 'OWNER', { price_per_hour: 50 });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.data.price_per_hour, 50);
  await call('PATCH', `/listings/${listing.id}`, 'OWNER', { price_per_hour: 40 });
});

test('ADMIN: invalid decision 400; approve -> 200 approved; now public', async () => {
  let r = await call('PATCH', `/admin/listings/${listing.id}/review`, 'ADMIN', { decision: 'maybe' });
  assert.strictEqual(r.status, 400);
  r = await call('PATCH', `/admin/listings/${listing.id}/review`, 'ADMIN', { decision: 'approved' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.data.status, 'approved');
  assert.strictEqual((await call('GET', `/listings/${listing.id}`, null)).status, 200);
  r = await call('PATCH', `/listings/${listing.id}`, 'CONSUMER', { title: 'hijack' });
  assert.strictEqual(r.status, 403);
});

test('BOOKING: validation errors -> 400; unknown listing -> 404', async () => {
  const ok = slot(9, 11);
  assert.strictEqual((await call('POST', '/bookings', 'CONSUMER', { listing_id: listing.id, start_time: ok.end_time, end_time: ok.start_time })).status, 400);
  assert.strictEqual((await call('POST', '/bookings', 'CONSUMER', { listing_id: listing.id, start_time: '2020-01-01T09:00:00Z', end_time: '2020-01-01T10:00:00Z' })).status, 400);
  assert.strictEqual((await call('POST', '/bookings', 'CONSUMER', { listing_id: 'nope', ...ok })).status, 400);
  assert.strictEqual((await call('POST', '/bookings', 'CONSUMER', { listing_id: '00000000-0000-4000-8000-000000000000', ...ok })).status, 404);
});

let booking;
test('BOOKING: create -> 201 confirmed, price computed by server (2h x 40 = 80), client price ignored', async () => {
  const r = await call('POST', '/bookings', 'CONSUMER', { listing_id: listing.id, ...slot(9, 11), total_price: 1, user_id: 'x', status: 'cancelled' });
  assert.strictEqual(r.status, 201); assert.strictEqual(r.body.data.status, 'confirmed');
  assert.strictEqual(r.body.data.total_price, 80);
  booking = r.body.data;
});

test('BOOKING: overlapping -> 409 BOOKING_CONFLICT; adjacent (back-to-back) allowed', async () => {
  for (const [a, b] of [[9, 11], [10, 12], [8, 10], [9.5, 10.5], [8, 12]]) {
    const r = await call('POST', '/bookings', 'ADMIN', { listing_id: listing.id, ...slot(a, b) });
    assert.strictEqual(r.status, 409, `[${a},${b}]`); assert.strictEqual(errCode(r), 'BOOKING_CONFLICT');
  }
  assert.strictEqual((await call('POST', '/bookings', 'ADMIN', { listing_id: listing.id, ...slot(11, 12) })).status, 201);
  assert.strictEqual((await call('POST', '/bookings', 'ADMIN', { listing_id: listing.id, ...slot(7, 9) })).status, 201);
});

test('BOOKING: 10 SIMULTANEOUS requests for the same slot -> exactly one 201, nine 409', async () => {
  const body = { listing_id: listing.id, ...slot(14, 16) };
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => call('POST', '/bookings', i % 2 ? 'ADMIN' : 'CONSUMER', body)));
  const statuses = results.map((r) => r.status).sort();
  assert.strictEqual(statuses.filter((s) => s === 201).length, 1, JSON.stringify(statuses));
  assert.strictEqual(statuses.filter((s) => s === 409).length, 9, JSON.stringify(statuses));
});

test('SEARCH: booked window excluded, free window included; filters & sorts work', async () => {
  const w = slot(9, 11), f = slot(18, 19);
  let r = await call('GET', `/listings?start=${w.start_time}&end=${w.end_time}`, null);
  assert.strictEqual(r.status, 200); assert.ok(!r.body.data.some((l) => l.id === listing.id));
  r = await call('GET', `/listings?start=${f.start_time}&end=${f.end_time}&lat=13.0&lng=80.2&sort=distance`, null);
  const mine = r.body.data.find((l) => l.id === listing.id);
  assert.ok(mine && typeof mine.distance_km === 'number');
  assert.strictEqual((await call('GET', '/listings?max_price=1', null)).body.data.some((l) => l.id === listing.id), false);
  r = await call('GET', `/listings?max_price=1&vehicle_type=fallback-api-test-vehicle&start=${f.start_time}&end=${f.end_time}&lat=13.0067&lng=80.2206&max_distance_km=0.1`, null);
  const fallback = r.body.data.find((l) => l.id === listing.id);
  assert.ok(fallback, 'empty exact search should fall back to eligible nearby listings');
  assert.strictEqual(fallback.search_fallback, true);
  assert.ok(fallback.recommendation_reasons.includes('Available for the requested time window'));
  assert.ok(['supported', 'limited', 'unknown'].includes(fallback.confidence));
  assert.strictEqual('distance_km' in fallback, false, 'fallback must not present Haversine distance as route distance');
  assert.strictEqual((await call('GET', '/listings?sort=distance', null)).status, 400);
  assert.strictEqual((await call('GET', '/listings?sort=bogus', null)).status, 400);
  assert.strictEqual((await call('GET', '/listings?start=2027-01-01T10:00:00Z', null)).status, 400);
});

test('ALTERNATIVES: excludes the conflicted listing, requires login + params', async () => {
  const w = slot(9, 11);
  const q = `lat=13.0&lng=80.2&start=${w.start_time}&end=${w.end_time}&exclude_listing_id=${listing.id}`;
  assert.strictEqual((await call('GET', `/alternatives?${q}`, null)).status, 401);
  const r = await call('GET', `/alternatives?${q}`, 'CONSUMER');
  assert.strictEqual(r.status, 200); assert.ok(Array.isArray(r.body.data));
  assert.ok(!r.body.data.some((a) => a.listing.id === listing.id));
  assert.strictEqual((await call('GET', '/alternatives?lat=1', 'CONSUMER')).status, 400);
});

test('MY BOOKINGS / PROVIDER BOOKINGS: each sees only their own', async () => {
  let r = await call('GET', '/bookings/mine', 'CONSUMER');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.data.some((b) => b.id === booking.id && b.listing.title === listing.title));
  assert.ok(r.body.data.every((b) => b.listing && 'address' in b.listing));
  assert.strictEqual((await call('GET', '/bookings/mine?status=bogus', 'CONSUMER')).status, 400);
  r = await call('GET', '/provider/bookings', 'OWNER');
  assert.ok(r.body.data.some((b) => b.id === booking.id && 'display_name' in b.consumer));
  r = await call('GET', '/provider/bookings', 'CONSUMER'); // consumer owns no listing
  assert.strictEqual(r.body.data.length, 0);
});

test('CANCEL: only booking owner; frees the slot; idempotent', async () => {
  assert.strictEqual((await call('PATCH', `/bookings/${booking.id}/cancel`, 'OWNER')).status, 404);
  let r = await call('PATCH', `/bookings/${booking.id}/cancel`, 'CONSUMER');
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.data.status, 'cancelled');
  assert.strictEqual((await call('PATCH', `/bookings/${booking.id}/cancel`, 'CONSUMER')).status, 200);
  r = await call('POST', '/bookings', 'ADMIN', { listing_id: listing.id, ...slot(9, 11) });
  assert.strictEqual(r.status, 201, 'cancelled slot should be bookable again');
});

test('PAUSE: is_active=false -> 422 and hidden from search; reactivate restores', async () => {
  await call('PATCH', `/listings/${listing.id}`, 'OWNER', { is_active: false });
  const r = await call('POST', '/bookings', 'CONSUMER', { listing_id: listing.id, ...slot(20, 21) });
  assert.strictEqual(r.status, 422); assert.strictEqual(errCode(r), 'LISTING_NOT_BOOKABLE');
  assert.ok(!(await call('GET', '/listings', null)).body.data.some((l) => l.id === listing.id));
  await call('PATCH', `/listings/${listing.id}`, 'OWNER', { is_active: true });
});

test('REJECT: rejected listing is not bookable', async () => {
  await call('PATCH', `/admin/listings/${listing.id}/review`, 'ADMIN', { decision: 'rejected', review_note: 'test' });
  const r = await call('POST', '/bookings', 'CONSUMER', { listing_id: listing.id, ...slot(22, 23) });
  assert.strictEqual(r.status, 422);
  await call('PATCH', `/admin/listings/${listing.id}/review`, 'ADMIN', { decision: 'approved' });
});

test('AVAILABILITY: opening hours enforced (IST); owner only', async () => {
  assert.strictEqual((await call('PUT', `/listings/${listing.id}/availability`, 'CONSUMER', { windows: [] })).status, 403);
  // window 10:00-12:00 IST on every day = 04:30-06:30 UTC
  const windows = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '10:00', close_time: '12:00' }));
  assert.strictEqual((await call('PUT', `/listings/${listing.id}/availability`, 'OWNER', { windows })).status, 200);
  const d = slot(4.5, 5.5, 3), out = slot(8, 9, 3);
  assert.strictEqual((await call('POST', '/bookings', 'CONSUMER', { listing_id: listing.id, ...d })).status, 201);
  const r = await call('POST', '/bookings', 'CONSUMER', { listing_id: listing.id, ...out });
  assert.strictEqual(r.status, 422);
  await call('PUT', `/listings/${listing.id}/availability`, 'OWNER', { windows: [] });
});

test('RULES: booking your own listing -> 403 FORBIDDEN', async () => {
  const r = await call('POST', '/bookings', 'OWNER', { listing_id: listing.id, ...slot(2, 3, 5) });
  assert.strictEqual(r.status, 403); assert.strictEqual(errCode(r), 'FORBIDDEN');
});

test('PUBLIC PAGES: an invalid/expired token on GET /listings/:id is ignored (200), not 401', async () => {
  const r = await fetch(API + `/listings/${listing.id}`, { headers: { Authorization: 'Bearer expired.or.invalid' } });
  assert.strictEqual(r.status, 200);
});

let l2;
test('LISTINGS: create with evidence_urls, empty description/rules and inline availability', async () => {
  const base = { title: 'TEST Second Spot', address: 'Tambaram, Chennai', latitude: 12.9249, longitude: 80.1, price_per_hour: 30 };
  assert.strictEqual((await call('POST', '/listings', 'OWNER', { ...base, evidence_urls: ['not-a-url'] })).status, 400);
  const r = await call('POST', '/listings', 'OWNER', { ...base, description: '', rules: '',
    evidence_urls: ['https://example.com/gate.jpg'], availability: [{ day_of_week: 1, open_time: '06:00', close_time: '22:00' }] });
  assert.strictEqual(r.status, 201); assert.strictEqual(r.body.data.status, 'pending');
  l2 = r.body.data;
  const d = await call('GET', `/listings/${l2.id}`, 'OWNER');
  assert.strictEqual(d.body.data.evidence_urls.length, 1); assert.strictEqual(d.body.data.availability.length, 1);
  assert.strictEqual(d.body.data.is_demo, false);
});

test('APPROVAL BYPASS: moving an approved listing -> pending; price edit keeps approved; rejected edit resubmits', async () => {
  await call('PATCH', `/admin/listings/${l2.id}/review`, 'ADMIN', { decision: 'approved' });
  let r = await call('PATCH', `/listings/${l2.id}`, 'OWNER', { price_per_hour: 35 });
  assert.strictEqual(r.body.data.status, 'approved');
  r = await call('PATCH', `/listings/${l2.id}`, 'OWNER', { latitude: 12.95 });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.data.status, 'pending');
  assert.strictEqual((await call('POST', '/bookings', 'CONSUMER', { listing_id: l2.id, ...slot(2, 3, 6) })).status, 422);
  await call('PATCH', `/admin/listings/${l2.id}/review`, 'ADMIN', { decision: 'rejected', review_note: 'blurry photo' });
  r = await call('PATCH', `/listings/${l2.id}`, 'OWNER', { is_active: false });
  assert.strictEqual(r.body.data.status, 'rejected');
  r = await call('PATCH', `/listings/${l2.id}`, 'OWNER', { title: 'TEST Second Spot (fixed)', is_active: true });
  assert.strictEqual(r.body.data.status, 'pending');
  await call('PATCH', `/admin/listings/${l2.id}/review`, 'ADMIN', { decision: 'approved' });
});

test('CONFIDENCE: confirm sets last_confirmed_at (owner only); search/details/alternatives expose freshness + is_demo', async () => {
  await call('PUT', `/listings/${l2.id}/availability`, 'OWNER', { windows: [] }); // open 24x7 so the alternatives window is always free
  assert.strictEqual((await call('POST', `/listings/${l2.id}/confirm`, 'CONSUMER')).status, 403);
  assert.strictEqual((await call('POST', `/listings/${l2.id}/confirm`, null)).status, 401);
  const c = await call('POST', `/listings/${l2.id}/confirm`, 'OWNER');
  assert.strictEqual(c.status, 200); assert.ok(c.body.data.last_confirmed_at);
  const s = await call('GET', '/listings?lat=12.9&lng=80.1', null);
  const hit = s.body.data.find((x) => x.id === l2.id);
  assert.ok(hit && hit.last_confirmed_at && hit.is_demo === false);
  const d = await call('GET', `/listings/${l2.id}`, null);
  assert.ok(d.body.data.last_confirmed_at && d.body.data.is_demo === false);
  const w = slot(6, 7, 7);
  const a = await call('GET', `/alternatives?lat=12.95&lng=80.1&start=${w.start_time}&end=${w.end_time}`, 'CONSUMER');
  const alt = a.body.data.find((x) => x.listing.id === l2.id);
  assert.ok(alt, 'confirmed listing should be an alternative');
  assert.ok('last_confirmed_at' in alt.listing && 'updated_at' in alt.listing && alt.listing.is_demo === false);
  assert.equal(alt.listing.confirmation, 'recent');
  assert.ok(['supported', 'limited', 'unknown'].includes(alt.listing.confidence));
  assert.ok(alt.reasons.includes('Recently confirmed'), JSON.stringify(alt.reasons));
  assert.equal('distance_km' in alt, false, 'straight-line distance must not be presented as route distance');
});

test('RESCUE: alternatives never include my own listings', async () => {
  const w = slot(6, 7, 7);
  const a = await call('GET', `/alternatives?lat=12.95&lng=80.1&start=${w.start_time}&end=${w.end_time}`, 'OWNER');
  assert.strictEqual(a.status, 200);
  assert.ok(!a.body.data.some((x) => x.listing.id === l2.id || x.listing.id === listing.id));
});

test('HEALTH: both routes OK with DB connected', async () => {
  for (const p of ['/health', '/api/health']) {
    const r = await fetch(API.replace('/api', '') + p); const j = await r.json();
    assert.strictEqual(r.status, 200); assert.strictEqual(j.db, 'up');
  }
});