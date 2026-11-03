// Account deletion logic against a scripted fake database (no Express, no Supabase): checks WHAT is run and in WHICH ORDER.
// It does not prove the SQL itself; that is what migration 010 + a run against a dev project are for.
const test = require('node:test');
const assert = require('node:assert');

const state = { log: [], handler: () => undefined, removed: [], deleteUser: null, deleted: [] };
const run = async (sql, p) => {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  state.log.push({ sql: text, p });
  const r = state.handler(text, p);
  if (r instanceof Error) throw r;
  return r || { rows: [], rowCount: 0 };
};
const fakeClient = { query: run, release() {} };
const fakePool = { query: run, connect: async () => fakeClient };
const fakeAdmin = {
  storage: { from: () => ({ remove: async (paths) => { state.removed.push(...paths); return { error: null }; } }) },
  auth: { admin: { deleteUser: async (id) => { state.deleted.push(id); return { error: state.deleteUser }; } } },
};
const inject = (rel, exports) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
inject('../src/db', fakePool);
inject('../src/supabaseAdmin', fakeAdmin);
const acct = require('../src/lib/account-deletion');

const UID = '11111111-1111-4111-8111-111111111111';
const idx = (re) => state.log.findIndex((q) => re.test(q.sql));
test.beforeEach(() => { state.log = []; state.handler = () => undefined; state.removed = []; state.deleteUser = null; state.deleted = []; });

test('deleteAccount: keeps other people\'s bookings (snapshot BEFORE the listing delete), removes files, then the login, then logs completion', async () => {
  state.handler = (sql) => {
    if (/FROM listing_photos p JOIN listings/.test(sql)) return { rows: [{ storage_path: 'L/a.jpg' }] };
    if (/FROM profiles WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ id: UID, deletion_requested_at: null }] };
    if (/b\.status = 'confirmed'/.test(sql)) return { rows: [], rowCount: 0 };
    if (/FROM account_deletion_log WHERE user_id/.test(sql)) return { rows: [] };
    if (/INSERT INTO account_deletion_log/.test(sql)) return { rows: [{ id: 7 }] };
    return undefined;
  };
  assert.deepStrictEqual(await acct.deleteAccount(UID), { deleted: true });

  assert.ok(idx(/FOR UPDATE/) < idx(/b\.status = 'confirmed'/), 'listings are locked before the active-booking check');
  assert.ok(idx(/b\.status = 'confirmed'/) < idx(/DELETE FROM bookings WHERE user_id/), 'checked before anything is deleted');
  const snap = idx(/SET listing_snapshot/);
  const delListings = idx(/DELETE FROM listings WHERE owner_id/);
  assert.ok(snap > -1 && snap < delListings, 'snapshot is written before the listings are deleted');
  assert.strictEqual(idx(/DELETE FROM bookings WHERE listing_id/), -1, 'drivers\' bookings on my listings are NOT deleted any more');
  assert.ok(idx(/^COMMIT/) > delListings);
  assert.deepStrictEqual(state.removed, ['L/a.jpg']);
  assert.deepStrictEqual(state.deleted, [UID]);
  const completed = idx(/SET completed_at = now\(\) WHERE id = \$1/);
  assert.ok(completed > idx(/^COMMIT/), 'completion is logged after the commit');
  assert.deepStrictEqual(state.log[completed].p, [7]);
});

test('deleteAccount: future confirmed booking on my listing -> 409, rolled back, nothing deleted', async () => {
  state.handler = (sql) => {
    if (/FROM profiles WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ id: UID }] };
    if (/b\.status = 'confirmed'/.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    return undefined;
  };
  await assert.rejects(() => acct.deleteAccount(UID), (e) => e.status === 409 && e.code === 'ACCOUNT_HAS_ACTIVE_BOOKINGS');
  assert.ok(idx(/^ROLLBACK/) > -1);
  assert.strictEqual(idx(/DELETE FROM/), -1);
  assert.strictEqual(state.deleted.length, 0);
  assert.strictEqual(state.removed.length, 0);
});

test('deleteAccount: login removal failing is reported as 500 (data is already gone, retry is safe)', async () => {
  state.deleteUser = { message: 'boom' };
  state.handler = (sql) => (/INSERT INTO account_deletion_log/.test(sql) ? { rows: [{ id: 1 }] } : /FROM profiles WHERE id = \$1 FOR UPDATE/.test(sql) ? { rows: [{ id: UID }] } : undefined);
  await assert.rejects(() => acct.deleteAccount(UID), (e) => e.status === 500);
  assert.strictEqual(idx(/SET completed_at/), -1, 'not marked completed when the login still exists');
});

test('deleteAccount: reuses the open grace-period log row', async () => {
  state.handler = (sql) => {
    if (/FROM profiles WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ id: UID, deletion_requested_at: '2026-10-01T00:00:00Z' }] };
    if (/FROM account_deletion_log WHERE user_id/.test(sql)) return { rows: [{ id: 42 }] };
    return undefined;
  };
  await acct.deleteAccount(UID, { method: 'grace_period' });
  assert.strictEqual(idx(/INSERT INTO account_deletion_log/), -1);
  assert.deepStrictEqual(state.log[idx(/SET method = \$2/)].p, [42, 'grace_period']);
});

test('requestDeletion: pauses only active listings, remembers it, sets the date, logs; second call changes nothing', async () => {
  let requested = null;
  state.handler = (sql) => {
    if (/FROM profiles WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ id: UID, deletion_requested_at: requested }] };
    if (/b\.status = 'confirmed'/.test(sql)) return { rows: [], rowCount: 0 };
    if (/UPDATE profiles SET deletion_requested_at = now\(\)/.test(sql)) { requested = '2026-11-02T00:00:00.000Z'; return { rows: [{ deletion_requested_at: requested }] }; }
    return undefined;
  };
  const r = await acct.requestDeletion(UID);
  assert.strictEqual(r.deletion_requested_at, '2026-11-02T00:00:00.000Z');
  assert.strictEqual(r.deletion_scheduled_for, new Date(Date.parse('2026-11-02T00:00:00.000Z') + acct.GRACE_DAYS * 86400000).toISOString());
  assert.ok(/SET is_active = false, paused_for_deletion = true WHERE owner_id = \$1 AND is_active = true/.test(state.log[idx(/paused_for_deletion = true/)].sql));
  assert.ok(idx(/INSERT INTO account_deletion_log/) > -1);

  state.log = [];
  const again = await acct.requestDeletion(UID);
  assert.strictEqual(again.deletion_requested_at, '2026-11-02T00:00:00.000Z');
  assert.strictEqual(idx(/UPDATE listings/), -1, 'idempotent: nothing is paused twice');
});

test('requestDeletion: active booking -> 409 and nothing paused', async () => {
  state.handler = (sql) => {
    if (/FROM profiles WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ id: UID, deletion_requested_at: null }] };
    if (/b\.status = 'confirmed'/.test(sql)) return { rows: [{}], rowCount: 1 };
    return undefined;
  };
  await assert.rejects(() => acct.requestDeletion(UID), (e) => e.status === 409);
  assert.strictEqual(idx(/UPDATE listings/), -1);
});

test('cancelDeletion: restores only what the request paused; no request -> restored:false', async () => {
  state.handler = (sql) => (/FROM profiles WHERE id = \$1 FOR UPDATE/.test(sql) ? { rows: [{ id: UID, deletion_requested_at: '2026-10-01T00:00:00Z' }] } : undefined);
  assert.deepStrictEqual(await acct.cancelDeletion(UID), { restored: true });
  assert.ok(/WHERE owner_id = \$1 AND paused_for_deletion/.test(state.log[idx(/SET is_active = true, paused_for_deletion = false/)].sql));
  assert.ok(idx(/SET cancelled_at = now\(\)/) > -1);

  state.log = [];
  state.handler = (sql) => (/FROM profiles WHERE id = \$1 FOR UPDATE/.test(sql) ? { rows: [{ id: UID, deletion_requested_at: null }] } : undefined);
  assert.deepStrictEqual(await acct.cancelDeletion(UID), { restored: false });
  assert.strictEqual(idx(/UPDATE listings/), -1);
});

test('purgeExpired: deletes due accounts, skips (409) the ones with future bookings, reports failures', async () => {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  let current = null;
  state.handler = (sql, p) => {
    if (/FROM profiles WHERE deletion_requested_at IS NOT NULL/.test(sql)) return { rows: [{ id: A }, { id: B }, { id: C }] };
    if (/FROM profiles WHERE id = \$1 FOR UPDATE/.test(sql)) { current = p[0]; return { rows: [{ id: p[0] }] }; }
    if (/b\.status = 'confirmed'/.test(sql)) return current === B ? { rows: [{}], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (/INSERT INTO account_deletion_log/.test(sql)) return { rows: [{ id: 1 }] };
    if (/DELETE FROM listings/.test(sql) && current === C) return new Error('db down');
    return undefined;
  };
  const r = await acct.purgeExpired({ limit: 10 });
  assert.strictEqual(r.due, 3);
  assert.strictEqual(r.deleted, 1);
  assert.deepStrictEqual(r.skipped, [{ id: B, reason: 'ACCOUNT_HAS_ACTIVE_BOOKINGS' }]);
  assert.strictEqual(r.failed.length, 1);
  assert.strictEqual(r.failed[0].id, C);
  assert.deepStrictEqual(state.deleted, [A]);
});

test('exportData: returns the sections, joins bookings with the snapshot fallback, never selects storage_path', async () => {
  state.handler = (sql) => (/FROM profiles WHERE id = \$1/.test(sql) ? { rows: [{ id: UID, full_name: 'Sam' }] } : { rows: [] });
  const out = await acct.exportData({ id: UID, email: 's@example.com' });
  assert.deepStrictEqual(Object.keys(out).sort(), ['availability', 'bookings', 'bookings_on_my_listings', 'exported_at', 'listings', 'photos', 'profile']);
  assert.deepStrictEqual(out.profile, { id: UID, full_name: 'Sam', email: 's@example.com' });
  assert.ok(state.log.every((q) => !/storage_path/.test(q.sql)), 'internal storage paths are not exported');
  assert.ok(state.log.some((q) => /LEFT JOIN listings l/.test(q.sql) && /listing_snapshot/.test(q.sql)));
  assert.ok(state.log.every((q) => Array.isArray(q.p) && q.p[0] === UID), 'every query is scoped to the caller');
});
