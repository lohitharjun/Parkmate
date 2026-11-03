// OFFLINE route tests: the real Express app with a scripted fake database, fake auth and fake Storage.
// They prove routing, permissions, validation, upload handling and error mapping. They do NOT prove the SQL itself:
// that is covered by supabase/tests/db_tests.sql and tests/api.test.js (live, need a Supabase dev project).
process.env.MAX_PHOTO_BYTES = '60000';
process.env.RATE_LIMIT_GENERAL = '100000';
process.env.RATE_LIMIT_WRITE = '100000';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { ApiError } = require('../src/errors');
const { jpeg, png } = require('./helpers.image');

// ---- fakes (installed in require.cache before the app loads) ----
const state = { handler: () => ({ rows: [] }), queries: [], uploads: [], removed: [], signed: [] };
const fakeClient = { query: async (sql, p) => { state.queries.push({ sql, p }); return state.handler(sql, p) || { rows: [] }; }, release() {} };
const fakePool = { query: fakeClient.query, connect: async () => fakeClient };
const fakeAuth = {
  requireAuth: (req, res, next) => { try { req.user = JSON.parse(req.get('x-test-user')); next(); } catch (e) { next(new ApiError(401, 'UNAUTHENTICATED', 'Missing or invalid token')); } },
  optionalAuth: (req, res, next) => { try { req.user = JSON.parse(req.get('x-test-user')); } catch (e) { req.user = null; } next(); },
  requireAdmin: (req, res, next) => (req.user.isAdmin ? next() : next(new ApiError(403, 'FORBIDDEN', 'Admin only'))),
  // the real one reads the token's sign-in time; here a test user can simply be marked { stale: true }
  requireRecentLogin: (req, res, next) => (req.user && req.user.stale ? next(new ApiError(401, 'REAUTH_REQUIRED', 'Please confirm your password again.')) : next()),
};
const fakeStorageClient = {
  upload: async (p, buf, opts) => { state.uploads.push({ path: p, buf, opts }); return { error: state.uploadError || null }; },
  remove: async (paths) => { state.removed.push(...paths); return { error: null }; },
  createSignedUrls: async (paths) => { state.signed.push(...paths); return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?token=t` })), error: null }; },
};
const fakeSupabaseAdmin = { storage: { from: () => fakeStorageClient } };
const inject = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
inject('../src/db', fakePool);
inject('../src/auth', fakeAuth);
inject('../src/supabaseAdmin', fakeSupabaseAdmin);
const app = require('../src/app');

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(() => server.close());
test.beforeEach(() => { state.handler = () => ({ rows: [] }); state.queries = []; state.uploads = []; state.removed = []; state.signed = []; state.uploadError = null; });

const OWNER = { id: '11111111-1111-4111-8111-111111111111', isAdmin: false };
const OTHER = { id: '22222222-2222-4222-8222-222222222222', isAdmin: false };
const ADMIN = { id: '33333333-3333-4333-8333-333333333333', isAdmin: true };
const LID = '44444444-4444-4444-8444-444444444444';
const PID = '55555555-5555-4555-8555-555555555555';
const listing = (o = {}) => ({ id: LID, owner_id: OWNER.id, status: 'approved', is_active: true, title: 'T', address: 'A', latitude: 13.0, longitude: 80.2, price_per_hour: 40, ...o });
const as = (u) => (u ? { 'x-test-user': JSON.stringify(u) } : {});
async function call(method, p, { user, body, type, headers } = {}) {
  const h = { ...as(user), ...(headers || {}) };
  let payload;
  if (Buffer.isBuffer(body)) { h['Content-Type'] = type; payload = body; } else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + p, { method, headers: h, body: payload });
  let json = null; try { json = await r.json(); } catch (e) { /* no body */ }
  return { status: r.status, body: json };
}
const errCode = (r) => r.body && r.body.error && r.body.error.code;
const reason = (r) => r.body && r.body.error && r.body.error.reason;
const listingOnly = (l) => (sql) => (/FROM listings WHERE id = \$1/.test(sql) ? { rows: l ? [l] : [] } : undefined);

// ================= PHOTO UPLOAD =================
test('PHOTOS upload: needs login; non-owner cannot upload (403 on approved, 404 on pending); nothing is stored', async () => {
  state.handler = listingOnly(listing());
  assert.strictEqual((await call('POST', `/listings/${LID}/photos`, { body: jpeg(), type: 'image/jpeg' })).status, 401);
  let r = await call('POST', `/listings/${LID}/photos`, { user: OTHER, body: jpeg(), type: 'image/jpeg' });
  assert.strictEqual(r.status, 403);
  state.handler = listingOnly(listing({ status: 'pending' }));
  r = await call('POST', `/listings/${LID}/photos`, { user: OTHER, body: jpeg(), type: 'image/jpeg' });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(state.uploads.length, 0);
});

test('PHOTOS upload: owner gets 201, EXIF is stripped before storing, path is under the listing, metadata saved', async () => {
  state.handler = (sql, p) => {
    if (/FROM listings WHERE id = \$1/.test(sql)) return { rows: [listing()] };
    if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
    if (/INSERT INTO listing_photos/.test(sql)) return { rows: [{ id: PID, listing_id: p[0], storage_path: p[2], content_type: p[3], size_bytes: p[4], capture_latitude: p[5], capture_longitude: p[6], captured_at: p[7], review_status: 'pending', review_note: null, is_primary: true, uploaded_at: '2026-11-01T10:00:00Z' }] };
    return undefined;
  };
  const r = await call('POST', `/listings/${LID}/photos?capture_latitude=13.0005&capture_longitude=80.2003&captured_at=2026-11-01T09:59:00Z`, { user: OWNER, body: jpeg(), type: 'image/jpeg' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(state.uploads.length, 1);
  const up = state.uploads[0];
  assert.ok(up.path.startsWith(`${LID}/`) && up.path.endsWith('.jpg'));
  assert.strictEqual(up.opts.contentType, 'image/jpeg');
  assert.strictEqual(up.opts.upsert, false);
  for (const s of ['SECRETGPS', 'SECRETXMP', 'SECRETIPTC', 'TRAILING_SECRET']) assert.ok(!up.buf.includes(Buffer.from(s)), `${s} reached storage`);
  const ins = state.queries.find((q) => /INSERT INTO listing_photos/.test(q.sql));
  assert.strictEqual(ins.p[1], OWNER.id, 'uploaded_by comes from the token');
  assert.strictEqual(ins.p[5], 13.0005); assert.strictEqual(ins.p[6], 80.2003);
  assert.strictEqual(r.body.data.review_status, 'pending');
  assert.strictEqual(r.body.data.is_primary, true);
  assert.ok(r.body.data.url.startsWith('https://signed.example/'));
  assert.ok(!('storage_path' in r.body.data), 'storage path must not be exposed');
  assert.strictEqual(typeof r.body.data.distance_from_listing_m, 'number');
});

test('PHOTOS upload: PNG accepted; wrong/missing type 415; type/content mismatch 415; non-image bytes 415; too large 413', async () => {
  state.handler = (sql, p) => {
    if (/FROM listings WHERE id = \$1/.test(sql)) return { rows: [listing()] };
    if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
    if (/INSERT INTO listing_photos/.test(sql)) return { rows: [{ id: PID, listing_id: p[0], storage_path: p[2], review_status: 'pending', is_primary: false, uploaded_at: 'x' }] };
  };
  const u = `/listings/${LID}/photos`;
  assert.strictEqual((await call('POST', u, { user: OWNER, body: png(), type: 'image/png' })).status, 201);
  assert.ok(state.uploads[0].path.endsWith('.png'));
  state.uploads = [];
  let r = await call('POST', u, { user: OWNER, body: Buffer.from('hello'), type: 'text/plain' });
  assert.strictEqual(r.status, 415); assert.strictEqual(errCode(r), 'UNSUPPORTED_FILE_TYPE');
  r = await call('POST', u, { user: OWNER, body: png(), type: 'image/jpeg' });           // claims jpeg, is png
  assert.strictEqual(r.status, 415);
  r = await call('POST', u, { user: OWNER, body: Buffer.from('<?php evil ?>'.repeat(30)), type: 'image/jpeg' });
  assert.strictEqual(r.status, 415);
  r = await call('POST', u, { user: OWNER, body: Buffer.concat([jpeg(), Buffer.alloc(70000)]), type: 'image/jpeg' });
  assert.strictEqual(r.status, 413); assert.strictEqual(errCode(r), 'FILE_TOO_LARGE');
  r = await call('POST', u, { user: OWNER });                                              // empty body
  assert.strictEqual(r.status, 415);
  assert.strictEqual(state.uploads.length, 0, 'nothing may be stored for rejected uploads');
});

test('PHOTOS upload: bad capture metadata -> 400 and nothing stored; 11th photo -> 422', async () => {
  state.handler = (sql) => (/FROM listings WHERE id = \$1/.test(sql) ? { rows: [listing()] } : /count\(\*\)/.test(sql) ? { rows: [{ n: 10 }] } : undefined);
  const u = `/listings/${LID}/photos`;
  for (const q of ['?capture_latitude=13', '?capture_latitude=999&capture_longitude=1', '?capture_latitude=abc&capture_longitude=1', '?captured_at=2999-01-01T00:00:00Z', '?captured_at=yesterday']) {
    const r = await call('POST', u + q, { user: OWNER, body: jpeg(), type: 'image/jpeg' });
    assert.strictEqual(r.status, 400, q);
  }
  const r = await call('POST', u, { user: OWNER, body: jpeg(), type: 'image/jpeg' });
  assert.strictEqual(r.status, 422); assert.strictEqual(errCode(r), 'PHOTO_LIMIT_REACHED');
  assert.strictEqual(state.uploads.length, 0);
});

test('PHOTOS upload: if the DB insert fails the stored file is removed; DB guards map to clean errors', async () => {
  for (const [code, status] of [['PH002', 422], ['PH001', 403], ['P0002', 404], ['XX000', 500]]) {
    state.uploads = []; state.removed = [];
    state.handler = (sql) => {
      if (/FROM listings WHERE id = \$1/.test(sql)) return { rows: [listing()] };
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
      if (/INSERT INTO listing_photos/.test(sql)) { const e = new Error('db'); e.code = code; throw e; }
    };
    const r = await call('POST', `/listings/${LID}/photos`, { user: OWNER, body: jpeg(), type: 'image/jpeg' });
    assert.strictEqual(r.status, status, code);
    assert.deepStrictEqual(state.removed, [state.uploads[0].path], `orphan file left behind for ${code}`);
  }
});

test('PHOTOS upload: storage failure -> 502 and no DB row', async () => {
  state.uploadError = { message: 'boom' };
  state.handler = (sql) => (/FROM listings WHERE id = \$1/.test(sql) ? { rows: [listing()] } : /count\(\*\)/.test(sql) ? { rows: [{ n: 0 }] } : undefined);
  const r = await call('POST', `/listings/${LID}/photos`, { user: OWNER, body: jpeg(), type: 'image/jpeg' });
  assert.strictEqual(r.status, 502); assert.strictEqual(errCode(r), 'STORAGE_ERROR');
  assert.ok(!state.queries.some((q) => /INSERT INTO listing_photos/.test(q.sql)));
});

// ================= PHOTO READ / CHANGE / DELETE =================
const photoRow = (o = {}) => ({ id: PID, listing_id: LID, uploaded_by: OWNER.id, storage_path: `${LID}/a.jpg`, content_type: 'image/jpeg', size_bytes: 1000, capture_latitude: 13.0, capture_longitude: 80.2, captured_at: 't', uploaded_at: 'u', review_status: 'approved', review_note: null, is_primary: true, ...o });

test('PHOTOS read: consumers get approved photos only, with no capture data; owner/admin see everything', async () => {
  state.handler = (sql) => {
    if (/FROM listings WHERE id = \$1/.test(sql)) return { rows: [listing()] };
    if (/FROM listing_photos WHERE listing_id/.test(sql)) return { rows: /review_status = 'approved'/.test(sql) ? [photoRow()] : [photoRow(), photoRow({ id: 'x', review_status: 'pending', is_primary: false })] };
  };
  let r = await call('GET', `/listings/${LID}/photos`, {});
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.data.length, 1);
  assert.deepStrictEqual(Object.keys(r.body.data[0]).sort(), ['id', 'is_primary', 'uploaded_at', 'url']);
  r = await call('GET', `/listings/${LID}/photos`, { user: OWNER });
  assert.strictEqual(r.body.data.length, 2);
  assert.ok('capture_latitude' in r.body.data[0] && r.body.data[0].review_status);
  r = await call('GET', `/listings/${LID}/photos`, { user: OTHER });
  assert.strictEqual(r.body.data.length, 1);
  state.handler = listingOnly(listing({ status: 'pending' }));
  assert.strictEqual((await call('GET', `/listings/${LID}/photos`, { user: OTHER })).status, 404);
  assert.strictEqual((await call('GET', `/listings/${LID}/photos`, {})).status, 404);
});

test('PHOTOS change/delete: owner only; rejected photo cannot be main; bad body 400', async () => {
  state.handler = (sql) => {
    if (/FROM listings WHERE id = \$1/.test(sql)) return { rows: [listing()] };
    if (/FROM listing_photos WHERE id = \$1 AND listing_id/.test(sql)) return { rows: [photoRow({ is_primary: false })] };
    if (/UPDATE listing_photos SET is_primary = true/.test(sql)) return { rows: [photoRow()] };
  };
  const u = `/listings/${LID}/photos/${PID}`;
  assert.strictEqual((await call('PATCH', u, { body: { is_primary: true } })).status, 401);
  assert.strictEqual((await call('PATCH', u, { user: OTHER, body: { is_primary: true } })).status, 403);
  assert.strictEqual((await call('DELETE', u, { user: OTHER })).status, 403);
  assert.strictEqual((await call('PATCH', u, { user: OWNER, body: { is_primary: false } })).status, 400);
  assert.strictEqual((await call('PATCH', u, { user: OWNER, body: { review_status: 'approved' } })).status, 400);
  assert.strictEqual((await call('PATCH', `/listings/${LID}/photos/not-a-uuid`, { user: OWNER, body: { is_primary: true } })).status, 404);
  assert.strictEqual((await call('PATCH', u, { user: OWNER, body: { is_primary: true } })).status, 200);
  assert.strictEqual(state.removed.length, 0);
  const d = await call('DELETE', u, { user: OWNER });
  assert.strictEqual(d.status, 200);
  assert.deepStrictEqual(state.removed, [`${LID}/a.jpg`], 'file must be removed from Storage');
  state.handler = (sql) => (/FROM listings WHERE id = \$1/.test(sql) ? { rows: [listing()] } : /FROM listing_photos WHERE id/.test(sql) ? { rows: [photoRow({ review_status: 'rejected', is_primary: false })] } : undefined);
  assert.strictEqual((await call('PATCH', u, { user: OWNER, body: { is_primary: true } })).status, 400);
});

test('PHOTOS admin: review/list/delete are admin only; decision validated', async () => {
  state.handler = (sql) => (/UPDATE listing_photos SET review_status/.test(sql) ? { rows: [photoRow({ review_status: 'rejected', is_primary: false })] } : undefined);
  assert.strictEqual((await call('PATCH', `/admin/photos/${PID}/review`, { user: OWNER, body: { decision: 'approved' } })).status, 403);
  assert.strictEqual((await call('GET', '/admin/photos', { user: OTHER })).status, 403);
  assert.strictEqual((await call('DELETE', `/admin/photos/${PID}`, { user: OTHER })).status, 403);
  assert.strictEqual((await call('PATCH', `/admin/photos/${PID}/review`, { user: ADMIN, body: { decision: 'maybe' } })).status, 400);
  const r = await call('PATCH', `/admin/photos/${PID}/review`, { user: ADMIN, body: { decision: 'rejected', review_note: 'blurry' } });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.data.review_status, 'rejected');
  assert.ok(state.queries.some((q) => /UPDATE listing_photos SET is_primary = true/.test(q.sql)), 'next photo should be promoted');
});

// ================= LISTING DETAIL / LOCATION =================
test('LISTING detail: exposes location fields + approved photos; a storage outage does not break the page', async () => {
  const row = listing({ location_label: 'Gate 2', location_verified: true, location_updated_at: 't', owner_id: OWNER.id });
  state.handler = (sql) => {
    if (/FROM listings WHERE id = \$1/.test(sql)) return { rows: [row] };
    if (/FROM availability/.test(sql)) return { rows: [] };
    if (/FROM listing_photos WHERE listing_id/.test(sql)) return { rows: [photoRow()] };
  };
  let r = await call('GET', `/listings/${LID}`, {});
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.location_label, 'Gate 2'); assert.strictEqual(r.body.data.location_verified, true);
  assert.strictEqual(r.body.data.photos.length, 1); assert.ok(!('owner_id' in r.body.data));
  const orig = fakeStorageClient.createSignedUrls;
  fakeStorageClient.createSignedUrls = async () => ({ data: null, error: { message: 'down' } });
  r = await call('GET', `/listings/${LID}`, {});
  fakeStorageClient.createSignedUrls = orig;
  assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.body.data.photos, []);
});

test('LISTINGS mine: login required; every listing carries ALL its photos (incl. pending) with review_status; a storage outage does not break it', async () => {
  const L2 = '66666666-6666-4666-8666-666666666666';
  const mineHandler = (sql) => {
    if (/FROM listings WHERE owner_id = \$1/.test(sql)) return { rows: [listing(), listing({ id: L2, status: 'pending' })] };
    if (/FROM listing_photos WHERE listing_id = ANY/.test(sql)) {
      return { rows: [photoRow(), photoRow({ id: 'p2', review_status: 'pending', is_primary: false, storage_path: `${LID}/b.jpg` })] };
    }
  };
  state.handler = mineHandler;
  assert.strictEqual((await call('GET', '/listings/mine', {})).status, 401);
  let r = await call('GET', '/listings/mine', { user: OWNER });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.length, 2);
  const [first, second] = r.body.data;
  assert.deepStrictEqual(first.photos.map((p) => p.review_status), ['approved', 'pending']);
  assert.ok(first.photos.every((p) => p.url && p.url.startsWith('https://signed.example/')));
  assert.deepStrictEqual(second.photos, [], 'a listing without photos still gets photos: []');
  assert.ok(!('storage_path' in first.photos[0]));
  assert.strictEqual(state.queries.filter((q) => /FROM listing_photos/.test(q.sql)).length, 1, 'one photo query for all listings');
  const q = state.queries.find((x) => /FROM listing_photos/.test(x.sql));
  assert.ok(!/review_status = 'approved'/.test(q.sql), 'owner sees every review state');
  assert.deepStrictEqual(q.p[0], [LID, L2]);
  const orig = fakeStorageClient.createSignedUrls;
  fakeStorageClient.createSignedUrls = async () => ({ data: null, error: { message: 'down' } });
  r = await call('GET', '/listings/mine', { user: OWNER });
  fakeStorageClient.createSignedUrls = orig;
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.data.length, 2);
  assert.deepStrictEqual(r.body.data[0].photos, []);
  state.queries = [];
  state.handler = (sql) => (/FROM listings WHERE owner_id = \$1/.test(sql) ? { rows: [] } : undefined);
  r = await call('GET', '/listings/mine', { user: OWNER });
  assert.deepStrictEqual(r.body.data, []);
  assert.ok(!state.queries.some((x) => /FROM listing_photos/.test(x.sql)), 'no listings -> no photo query');
});

test('LOCATION: owner-only PUT with validation; only location columns are written', async () => {
  state.handler = (sql) => (/FROM listings WHERE id = \$1/.test(sql) ? { rows: [listing()] } : /UPDATE listings SET/.test(sql) ? { rows: [listing({ status: 'pending' })] } : undefined);
  const u = `/listings/${LID}/location`;
  assert.strictEqual((await call('PUT', u, { body: { latitude: 13, longitude: 80 } })).status, 401);
  assert.strictEqual((await call('PUT', u, { user: OTHER, body: { latitude: 13, longitude: 80 } })).status, 403);
  for (const b of [{}, { latitude: 13 }, { latitude: 91, longitude: 80 }, { latitude: 13, longitude: 181 }, { latitude: '13', longitude: 80 }, { latitude: 0, longitude: 0 },
    { latitude: 13, longitude: 80, status: 'approved' }, { latitude: 13, longitude: 80, location_verified: true }, { latitude: 13, longitude: 80, location_label: 'x'.repeat(121) }]) {
    assert.strictEqual((await call('PUT', u, { user: OWNER, body: b })).status, 400, JSON.stringify(b));
  }
  const r = await call('PUT', u, { user: OWNER, body: { latitude: 13.01, longitude: 80.21, address: 'New gate', location_label: 'Near Gate 2' } });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.data.status, 'pending');
  const upd = state.queries.find((q) => /UPDATE listings SET/.test(q.sql));
  assert.match(upd.sql, /latitude = \$1, longitude = \$2, address = \$3, location_label = \$4 WHERE id = \$5/);
});

test('LISTINGS create/patch: location_label accepted, location_verified / location_updated_at rejected', async () => {
  state.handler = (sql) => (/INSERT INTO listings/.test(sql) ? { rows: [listing({ status: 'pending' })] } : /FROM listings WHERE id = \$1/.test(sql) ? { rows: [listing()] } : /UPDATE listings/.test(sql) ? { rows: [listing()] } : undefined);
  const base0 = { title: 'x', address: 'y', latitude: 13, longitude: 80, price_per_hour: 10 };
  assert.strictEqual((await call('POST', '/listings', { user: OWNER, body: { ...base0, location_label: 'Gate' } })).status, 201);
  assert.strictEqual((await call('POST', '/listings', { user: OWNER, body: { ...base0, location_verified: true } })).status, 400);
  assert.strictEqual((await call('PATCH', `/listings/${LID}`, { user: OWNER, body: { location_updated_at: '2026-01-01T00:00:00Z' } })).status, 400);
  assert.strictEqual((await call('PATCH', `/listings/${LID}`, { user: OWNER, body: { location_label: 'Gate 3' } })).status, 200);
});

// ================= AVAILABILITY + BOOKING =================
const slotRow = (o = {}) => ({ id: LID, owner_id: OWNER.id, status: 'approved', is_active: true, price_per_hour: 40, is_open: true, is_taken: false, ...o });
const FUT = (h) => new Date(Date.now() + 48 * 3600000 + h * 3600000).toISOString();
const win = { start_time: FUT(0), end_time: FUT(2) };
const slotHandler = (o, extra) => (sql, p) => {
  if (/AS is_taken/.test(sql)) return { rows: o === null ? [] : [slotRow(o)] };
  if (extra) return extra(sql, p);
};

test('BOOKING recheck: every refusal has the right status, code and machine-readable reason', async () => {
  const cases = [
    [null, 404, 'NOT_FOUND', 'LISTING_NOT_FOUND'],
    [{ status: 'pending' }, 422, 'LISTING_NOT_BOOKABLE', 'LISTING_NOT_APPROVED'],
    [{ status: 'rejected' }, 422, 'LISTING_NOT_BOOKABLE', 'LISTING_NOT_APPROVED'],
    [{ is_active: false }, 422, 'LISTING_NOT_BOOKABLE', 'LISTING_PAUSED'],
    [{ owner_id: OTHER.id }, 403, 'FORBIDDEN', 'OWN_LISTING'],
    [{ is_open: false }, 422, 'LISTING_NOT_BOOKABLE', 'OUTSIDE_AVAILABLE_HOURS'],
    [{ is_taken: true }, 409, 'BOOKING_CONFLICT', 'SLOT_TAKEN'],
  ];
  for (const [o, status, code, why] of cases) {
    state.queries = [];
    state.handler = slotHandler(o);
    const r = await call('POST', '/bookings', { user: OTHER, body: { listing_id: LID, ...win } });
    assert.strictEqual(r.status, status, why); assert.strictEqual(errCode(r), code, why); assert.strictEqual(reason(r), why);
    assert.ok(!state.queries.some((q) => /INSERT INTO bookings/.test(q.sql)), `${why}: must not insert`);
  }
});

test('BOOKING validation: bad ids and times -> 400 before any DB lookup', async () => {
  state.handler = slotHandler({});
  const past = { start_time: '2020-01-01T09:00:00Z', end_time: '2020-01-01T10:00:00Z' };
  for (const b of [{ listing_id: 'nope', ...win }, { listing_id: LID, start_time: win.end_time, end_time: win.start_time }, { listing_id: LID, ...past },
    { listing_id: LID, start_time: win.start_time, end_time: FUT(30) }, { listing_id: LID, start_time: '2026-11-05T09:00', end_time: '2026-11-05T10:00' }, { listing_id: LID }]) {
    assert.strictEqual((await call('POST', '/bookings', { user: OTHER, body: b })).status, 400, JSON.stringify(b));
  }
  assert.strictEqual(state.queries.length, 0);
});

test('BOOKING create: available -> 201; client price/status/user/payment ignored; race lost at INSERT still -> clean 409', async () => {
  state.handler = slotHandler({}, (sql, p) => (/INSERT INTO bookings/.test(sql) ? { rows: [{ id: 'b1', listing_id: p[0], user_id: p[1], total_price: 80, status: 'confirmed', payment_status: 'unpaid' }] } : undefined));
  let r = await call('POST', '/bookings', { user: OTHER, body: { listing_id: LID, ...win, total_price: 1, user_id: 'x', status: 'cancelled', payment_status: 'paid' } });
  assert.strictEqual(r.status, 201); assert.strictEqual(r.body.data.payment_status, 'unpaid'); assert.strictEqual(r.body.data.user_id, OTHER.id);
  const ins = state.queries.find((q) => /INSERT INTO bookings/.test(q.sql));
  assert.strictEqual(ins.p.length, 4, 'only listing, user, start, end are sent');
  state.handler = slotHandler({}, (sql) => { if (/INSERT INTO bookings/.test(sql)) { const e = new Error('x'); e.code = '23P01'; throw e; } });
  r = await call('POST', '/bookings', { user: OTHER, body: { listing_id: LID, ...win } });
  assert.strictEqual(r.status, 409); assert.strictEqual(errCode(r), 'BOOKING_CONFLICT'); assert.strictEqual(reason(r), 'SLOT_TAKEN');
});

test('AVAILABILITY CHECK: public answer with reason and price; hidden listings stay 404; invalid windows 400', async () => {
  const u = (s, e) => `/listings/${LID}/availability-check?start=${encodeURIComponent(s)}&end=${encodeURIComponent(e)}`;
  state.handler = slotHandler({});
  let r = await call('GET', u(win.start_time, win.end_time), {});
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.body.data.available, r.body.data.reason, r.body.data.estimated_total_price], [true, null, 80]);
  state.handler = slotHandler({ is_taken: true });
  r = await call('GET', u(win.start_time, win.end_time), {});
  assert.deepStrictEqual([r.body.data.available, r.body.data.reason], [false, 'SLOT_TAKEN']);
  state.handler = slotHandler({ owner_id: OTHER.id });
  r = await call('GET', u(win.start_time, win.end_time), { user: OTHER });
  assert.strictEqual(r.body.data.reason, 'OWN_LISTING');
  state.handler = slotHandler({ status: 'pending' });
  assert.strictEqual((await call('GET', u(win.start_time, win.end_time), { user: ADMIN })).body.data.reason, 'LISTING_NOT_APPROVED');
  assert.strictEqual((await call('GET', u(win.start_time, win.end_time), { user: OTHER })).status, 404);
  assert.strictEqual((await call('GET', u(win.start_time, win.end_time), {})).status, 404);
  state.handler = slotHandler(null);
  assert.strictEqual((await call('GET', u(win.start_time, win.end_time), {})).status, 404);
  assert.strictEqual((await call('GET', `/listings/${LID}/availability-check`, {})).status, 400);
  assert.strictEqual((await call('GET', u(win.end_time, win.start_time), {})).status, 400);
});

test('BOOKING ownership: GET /bookings/:id only for the booker, the listing owner or an admin; cancel only for the booker', async () => {
  const bk = { id: PID, listing_id: LID, user_id: OTHER.id, start_time: FUT(0), end_time: FUT(2), total_price: 80, status: 'confirmed', payment_status: 'unpaid', created_at: 'c', listing_owner_id: OWNER.id, listing: { title: 'T', address: 'A' }, consumer_name: 'Sam' };
  state.handler = (sql) => (/FROM bookings b LEFT JOIN listings l/.test(sql) ? { rows: [bk] } : /SELECT \* FROM bookings/.test(sql) ? { rows: [bk] } : undefined);
  let r = await call('GET', `/bookings/${PID}`, { user: OTHER });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.data.user_id, OTHER.id); assert.ok(!('consumer' in r.body.data) && !('listing_owner_id' in r.body.data));
  r = await call('GET', `/bookings/${PID}`, { user: OWNER });
  assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.body.data.consumer, { display_name: 'Sam' }); assert.ok(!('user_id' in r.body.data));
  assert.strictEqual((await call('GET', `/bookings/${PID}`, { user: ADMIN })).status, 200);
  const stranger = { id: '66666666-6666-4666-8666-666666666666', isAdmin: false };
  assert.strictEqual((await call('GET', `/bookings/${PID}`, { user: stranger })).status, 404);
  assert.strictEqual((await call('GET', `/bookings/${PID}`, {})).status, 401);
  assert.strictEqual((await call('GET', '/bookings/not-a-uuid', { user: OTHER })).status, 404);
  assert.strictEqual((await call('PATCH', `/bookings/${PID}/cancel`, { user: stranger })).status, 404);
  assert.strictEqual((await call('PATCH', `/bookings/${PID}/cancel`, { user: OWNER })).status, 404, 'the listing owner cannot cancel a consumer booking');
});

test('ACCOUNT DELETE: stored photo files are removed too', async () => {
  state.handler = meHandler((sql) => (/FROM listing_photos p JOIN listings/.test(sql) ? { rows: [{ storage_path: `${LID}/a.jpg` }, { storage_path: `${LID}/b.png` }] } : undefined));
  const r = await call('DELETE', '/me', { user: OWNER, body: { confirm: 'DELETE' } });
  // supabaseAdmin fake has no auth.admin, so the final step fails with 500, but the photo cleanup runs before it
  assert.ok([200, 500].includes(r.status));
  assert.deepStrictEqual(state.removed.sort(), [`${LID}/a.jpg`, `${LID}/b.png`]);
});

// ================= ACCOUNT: re-login, grace period, export =================
const DEL = { confirm: 'DELETE' };
const profileRow = (o = {}) => ({ id: OWNER.id, deletion_requested_at: null, ...o });
const meHandler = (extra = () => undefined) => (sql, p) => {
  if (/FROM profiles WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [profileRow()] };
  if (/INSERT INTO account_deletion_log/.test(sql)) return { rows: [{ id: 1 }] };
  if (/UPDATE profiles SET deletion_requested_at = now\(\)/.test(sql)) return { rows: [{ deletion_requested_at: '2026-11-02T00:00:00.000Z' }] };
  return extra(sql, p);
};

test('ACCOUNT: delete / deletion-request need a fresh login (401 REAUTH_REQUIRED) and the confirm word; nothing runs before that', async () => {
  state.handler = meHandler();
  const stale = { ...OWNER, stale: true };
  for (const [m, p] of [['DELETE', '/me'], ['POST', '/me/deletion-request']]) {
    let r = await call(m, p, { user: stale, body: DEL });
    assert.strictEqual(r.status, 401); assert.strictEqual(errCode(r), 'REAUTH_REQUIRED');
    r = await call(m, p, { user: OWNER, body: {} });
    assert.strictEqual(r.status, 400); assert.strictEqual(errCode(r), 'VALIDATION_ERROR');
    assert.strictEqual((await call(m, p, { body: DEL })).status, 401);
  }
  assert.strictEqual(state.queries.length, 0, 'no SQL ran for any rejected call');
});

test('ACCOUNT: GET /me carries the deletion state; cancelling the request does not need a fresh login', async () => {
  state.handler = (sql) => (/FROM profiles WHERE id = \$1/.test(sql) && !/FOR UPDATE/.test(sql)
    ? { rows: [{ id: OWNER.id, full_name: 'Sam', phone: null, is_admin: false, deletion_requested_at: '2026-11-02T00:00:00.000Z' }] } : undefined);
  let r = await call('GET', '/me', { user: { ...OWNER, email: 'o@example.com', stale: true } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.deletion_requested_at, '2026-11-02T00:00:00.000Z');
  assert.ok(Date.parse(r.body.data.deletion_scheduled_for) > Date.parse(r.body.data.deletion_requested_at));
  state.handler = (sql) => (/FROM profiles WHERE id = \$1 FOR UPDATE/.test(sql) ? { rows: [profileRow({ deletion_requested_at: '2026-11-02T00:00:00.000Z' })] } : undefined);
  r = await call('DELETE', '/me/deletion-request', { user: { ...OWNER, stale: true } });
  assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.body.data, { restored: true });
});

test('ACCOUNT: POST /me/deletion-request pauses listings and returns the dates', async () => {
  state.handler = meHandler();
  const r = await call('POST', '/me/deletion-request', { user: OWNER, body: DEL });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.data.deletion_requested_at, '2026-11-02T00:00:00.000Z');
  assert.ok(r.body.data.deletion_scheduled_for);
  assert.ok(state.queries.some((q) => /paused_for_deletion = true/.test(q.sql)));
});

test('ACCOUNT: GET /me/export needs login and returns the sections', async () => {
  state.handler = (sql) => (/FROM profiles WHERE id = \$1/.test(sql) ? { rows: [{ id: OWNER.id, full_name: 'Sam' }] } : { rows: [] });
  assert.strictEqual((await call('GET', '/me/export', {})).status, 401);
  const r = await call('GET', '/me/export', { user: { ...OWNER, email: 'o@example.com' } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(Object.keys(r.body.data).sort(), ['availability', 'bookings', 'bookings_on_my_listings', 'exported_at', 'listings', 'photos', 'profile']);
  assert.strictEqual(r.body.data.profile.email, 'o@example.com');
});
