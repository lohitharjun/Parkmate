'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recommendParking } = require('../src/lib/parking-rescue');

const NOW = new Date('2026-10-28T15:00:00.000Z');

function listing(overrides = {}) {
  return {
    id: 'lot-1',
    title: 'Sample parking',
    address: 'Sample address',
    status: 'approved',
    is_active: true,
    is_available: true,
    price_per_hour: 50,
    updated_at: '2026-10-28T14:00:00.000Z',
    last_confirmed_at: '2026-10-28T14:00:00.000Z',
    is_demo: false,
    ...overrides,
  };
}

function recommend(listings, options = {}) {
  return recommendParking(listings, { now: NOW, ...options });
}

test('excludes missing, unapproved, inactive, and unavailable listings', () => {
  const result = recommend([
    listing({ status: 'pending' }),
    listing({ id: 'rejected', status: 'rejected' }),
    listing({ id: 'inactive', is_active: false }),
    listing({ id: 'unavailable', is_available: false }),
    listing({ id: 'missing-status', status: undefined }),
    listing({ id: 'missing-active', is_active: undefined }),
    listing({ id: 'missing-availability', is_available: undefined }),
    listing({ id: 'invalid-price', price_per_hour: Number.NaN }),
  ]);
  assert.deepEqual(result.recommendations, []);
  assert.deepEqual(result.warnings, ['ineligible_or_invalid_listings_ignored']);
});

test('fresh update and recent provider confirmation support evidence independently', () => {
  const [result] = recommend([listing()]).recommendations;
  assert.equal(result.freshness, 'fresh');
  assert.equal(result.confirmation, 'recent');
  assert.equal(result.confidence, 'supported');
  assert.deepEqual(result.reasons, ['Recently confirmed']);
});

test('stale update remains separate from recent provider confirmation', () => {
  const [result] = recommend([listing({ updated_at: '2026-10-25T14:00:00Z' })]).recommendations;
  assert.equal(result.freshness, 'stale');
  assert.equal(result.confirmation, 'recent');
  assert.equal(result.confidence, 'limited');
  assert.deepEqual(result.reasons, ['Recently confirmed']);
});

test('fresh update without confirmation does not claim confirmation or confidence', () => {
  const [result] = recommend([listing({ last_confirmed_at: null })]).recommendations;
  assert.equal(result.freshness, 'fresh');
  assert.equal(result.confirmation, 'unconfirmed');
  assert.equal(result.confidence, 'unknown');
  assert.deepEqual(result.reasons, []);
});

test('missing, malformed, or future timestamps remain unknown', () => {
  const result = recommend([
    listing({ id: 'missing-update', updated_at: null }),
    listing({ id: 'invalid-update', updated_at: 'yesterday' }),
    listing({ id: 'impossible-update', updated_at: '2026-02-31T14:00:00Z' }),
    listing({ id: 'future-confirmation', last_confirmed_at: '2026-10-29T14:00:00Z' }),
  ], { limit: 5 });
  assert.ok(result.recommendations.every((item) => item.confidence === 'unknown'));
  for (const id of ['missing-update', 'invalid-update', 'impossible-update']) {
    assert.equal(result.recommendations.find((item) => item.id === id).freshness, 'unknown');
  }
  assert.equal(result.recommendations.find((item) => item.id === 'future-confirmation').confirmation, 'unknown');
});

test('eligible alternatives rank by confidence then trusted route distance then price', () => {
  const result = recommend([
    listing({ id: 'cheap-but-stale', price_per_hour: 10, updated_at: '2026-10-20T14:00:00Z' }),
    listing({ id: 'far', price_per_hour: 30, distance_km: 4, distance_source: 'routing_provider' }),
    listing({ id: 'near', price_per_hour: 50, distance_km: 1, distance_source: 'routing_provider' }),
  ]);
  assert.deepEqual(result.recommendations.map((item) => item.id), ['near', 'far', 'cheap-but-stale']);
  assert.ok(result.recommendations[0].reasons.includes('Closer to destination'));
  assert.ok(result.recommendations[1].reasons.includes('Lower price'));
});

test('straight-line, synthetic, invalid, and missing distances are omitted and do not rank', () => {
  const result = recommend([
    listing({ id: 'straight-line', distance_km: 0.1, distance_source: 'haversine' }),
    listing({ id: 'synthetic', distance_km: 0.2, distance_source: 'synthetic' }),
    listing({ id: 'invalid', distance_km: Number.NaN, distance_source: 'routing_provider' }),
    listing({ id: 'no-distance', distance_km: null }),
  ], { limit: 5 });
  assert.deepEqual(result.recommendations.map((item) => item.id), ['invalid', 'no-distance', 'straight-line', 'synthetic']);
  for (const item of result.recommendations) {
    assert.equal('distance_km' in item, false);
    assert.equal(item.reasons.includes('Closer to destination'), false);
  }
});

test('emits price, confirmation, and demo reasons only when supported by data', () => {
  const result = recommend([
    listing({ id: 'lower', price_per_hour: 20, is_demo: true }),
    listing({ id: 'higher', price_per_hour: 40, last_confirmed_at: null }),
  ]);
  assert.ok(result.recommendations[0].reasons.includes('Lower price'));
  assert.ok(result.recommendations[0].reasons.includes('Demo data — not live inventory'));
  assert.ok(!result.recommendations[1].reasons.includes('Recently confirmed'));
});

test('returns zero, one, or multiple alternatives with bounded result counts', () => {
  assert.equal(recommend([]).recommendations.length, 0);
  assert.equal(recommend([listing()]).recommendations.length, 1);
  assert.equal(recommend(Array.from({ length: 7 }, (_, index) => listing({ id: `lot-${index}` }))).recommendations.length, 3);
  assert.equal(recommend(Array.from({ length: 7 }, (_, index) => listing({ id: `lot-${index}` })), { limit: 99 }).recommendations.length, 5);
});

test('a listing becoming unavailable is excluded on the next search', () => {
  const candidate = listing();
  assert.equal(recommend([candidate]).recommendations.length, 1);
  assert.equal(recommend([{ ...candidate, is_available: false }]).recommendations.length, 0);
});

test('invalid input returns controlled empty result', () => {
  assert.deepEqual(recommend(null), {
    recommendations: [],
    warnings: ['invalid_listing_data'],
  });
  assert.equal(recommend([null, listing()]).recommendations.length, 1);
});
