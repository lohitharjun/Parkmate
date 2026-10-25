// Pure unit tests: no DB, no network. Run: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');
const v = require('../src/lib/validate');

const now = new Date('2026-10-24T10:00:00Z');
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

test('booking window: valid', () => {
  const r = v.validateBookingWindow('2026-10-25T09:00:00Z', '2026-10-25T11:00:00Z', now);
  assert.strictEqual(r.end - r.start, 2 * 3600 * 1000);
});
test('booking window: end before/equal start -> VALIDATION_ERROR', () => {
  assert.strictEqual(code(() => v.validateBookingWindow('2026-10-25T11:00:00Z', '2026-10-25T09:00:00Z', now)), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateBookingWindow('2026-10-25T09:00:00Z', '2026-10-25T09:00:00Z', now)), 'VALIDATION_ERROR');
});
test('booking window: in the past -> VALIDATION_ERROR', () => {
  assert.strictEqual(code(() => v.validateBookingWindow('2026-10-24T08:00:00Z', '2026-10-24T09:00:00Z', now)), 'VALIDATION_ERROR');
});
test('booking window: > 24h rejected', () => {
  assert.strictEqual(code(() => v.validateBookingWindow('2026-10-25T09:00:00Z', '2026-10-26T09:00:01Z', now)), 'VALIDATION_ERROR');
});
test('booking window: bad formats rejected (no timezone, junk, non-string)', () => {
  for (const bad of ['2026-10-25T09:00:00', 'tomorrow', '', null, 12345, '2026-13-45T99:00:00Z'])
    assert.strictEqual(code(() => v.parseIso(bad, 't')), 'VALIDATION_ERROR', String(bad));
});
test('uuid check', () => {
  assert.ok(v.isUuid('3f2b8c1e-6d4a-4b1e-9a3c-1b2c3d4e5f60'));
  assert.ok(!v.isUuid('123')); assert.ok(!v.isUuid(undefined));
});
test('listing create: valid, required fields, forbidden status/owner_id', () => {
  const ok = { title: 'Guindy Metro Lot', address: 'x', latitude: 13.0067, longitude: 80.2206, price_per_hour: 40 };
  assert.deepStrictEqual(v.validateListingInput(ok, { partial: false }), ok);
  assert.strictEqual(code(() => v.validateListingInput({ ...ok, status: 'approved' }, { partial: false })), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateListingInput({ ...ok, owner_id: 'x' }, { partial: false })), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateListingInput({ ...ok, price_per_hour: 0 }, { partial: false })), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateListingInput({ ...ok, price_per_hour: '40' }, { partial: false })), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateListingInput({ ...ok, latitude: 91 }, { partial: false })), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateListingInput({ title: 'x' }, { partial: false })), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateListingInput(null, { partial: false })), 'VALIDATION_ERROR');
});
test('listing update: allowed subset incl. is_active; status/empty rejected', () => {
  assert.deepStrictEqual(v.validateListingInput({ is_active: false }, { partial: true }), { is_active: false });
  assert.strictEqual(code(() => v.validateListingInput({ status: 'approved' }, { partial: true })), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateListingInput({}, { partial: true })), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateListingInput({ is_active: 'no' }, { partial: true })), 'VALIDATION_ERROR');
});
test('availability windows validation', () => {
  assert.strictEqual(v.validateAvailability([{ day_of_week: 1, open_time: '06:00', close_time: '22:00' }]).length, 1);
  assert.deepStrictEqual(v.validateAvailability([]), []);
  assert.strictEqual(code(() => v.validateAvailability([{ day_of_week: 7, open_time: '06:00', close_time: '22:00' }])), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateAvailability([{ day_of_week: 1, open_time: '22:00', close_time: '06:00' }])), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateAvailability('x')), 'VALIDATION_ERROR');
});

test('optional text: empty string / null accepted and stored as null', () => {
  const ok = { title: 'T', address: 'x', latitude: 1, longitude: 1, price_per_hour: 10 };
  const r = v.validateListingInput({ ...ok, description: '', rules: null, vehicle_type: '' }, { partial: false });
  assert.strictEqual(r.description, null); assert.strictEqual(r.rules, null); assert.strictEqual(r.vehicle_type, null);
  assert.deepStrictEqual(v.validateListingInput({ description: '' }, { partial: true }), { description: null });
});
test('evidence_urls: http(s) list accepted; junk / too many rejected', () => {
  const ok = { title: 'T', address: 'x', latitude: 1, longitude: 1, price_per_hour: 10 };
  assert.deepStrictEqual(v.validateListingInput({ ...ok, evidence_urls: ['https://a.com/x.jpg'] }, { partial: false }).evidence_urls, ['https://a.com/x.jpg']);
  assert.deepStrictEqual(v.validateListingInput({ evidence_urls: [] }, { partial: true }), { evidence_urls: [] });
  assert.strictEqual(code(() => v.validateListingInput({ ...ok, evidence_urls: ['javascript:alert(1)'] }, { partial: false })), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateListingInput({ ...ok, evidence_urls: 'https://a.com' }, { partial: false })), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateListingInput({ ...ok, evidence_urls: Array(11).fill('https://a.com') }, { partial: false })), 'VALIDATION_ERROR');
});
test('inline availability: allowed on create, validated, not allowed on update', () => {
  const ok = { title: 'T', address: 'x', latitude: 1, longitude: 1, price_per_hour: 10 };
  const w = [{ day_of_week: 1, open_time: '06:00', close_time: '22:00' }];
  assert.deepStrictEqual(v.validateListingInput({ ...ok, availability: w }, { partial: false }).availability, w);
  assert.strictEqual(code(() => v.validateListingInput({ ...ok, availability: [{ day_of_week: 9, open_time: '06:00', close_time: '22:00' }] }, { partial: false })), 'VALIDATION_ERROR');
  assert.strictEqual(code(() => v.validateListingInput({ availability: w }, { partial: true })), 'VALIDATION_ERROR');
});
