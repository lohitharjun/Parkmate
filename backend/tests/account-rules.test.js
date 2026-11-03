// Pure rules for account deletion: no database, no network.
const test = require('node:test');
const assert = require('node:assert');
const { decodeClaims, authTimeSeconds, isRecentLogin, writeAllowedWhilePending } = require('../src/lib/account-rules');

const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const NOW = 1_800_000_000;

test('decodeClaims: reads the payload, returns null for junk', () => {
  assert.deepStrictEqual(decodeClaims(jwt({ iat: 5 })), { iat: 5 });
  assert.strictEqual(decodeClaims('not-a-token'), null);
  assert.strictEqual(decodeClaims(''), null);
  assert.strictEqual(decodeClaims(undefined), null);
  assert.strictEqual(decodeClaims('a.%%%.c'), null);
});

test('authTimeSeconds: newest amr timestamp wins, falls back to iat, null when nothing usable', () => {
  assert.strictEqual(authTimeSeconds({ iat: 100, amr: [{ method: 'password', timestamp: 90 }, { method: 'otp', timestamp: 95 }] }), 95);
  assert.strictEqual(authTimeSeconds({ iat: 100 }), 100);
  assert.strictEqual(authTimeSeconds({ iat: 100, amr: [] }), 100);
  assert.strictEqual(authTimeSeconds({ iat: 100, amr: [{ method: 'password' }] }), 100);
  assert.strictEqual(authTimeSeconds({}), null);
  assert.strictEqual(authTimeSeconds(null), null);
});

test('isRecentLogin: inside the window, outside it, window 0 = off, missing time = not recent', () => {
  assert.strictEqual(isRecentLogin(NOW - 30, 300, NOW), true);
  assert.strictEqual(isRecentLogin(NOW - 300, 300, NOW), true);
  assert.strictEqual(isRecentLogin(NOW - 301, 300, NOW), false);
  assert.strictEqual(isRecentLogin(NOW - 99999, 0, NOW), true, '0 turns the check off');
  assert.strictEqual(isRecentLogin(null, 300, NOW), false);
  assert.strictEqual(isRecentLogin(undefined, 300, NOW), false);
  assert.strictEqual(isRecentLogin(NOW + 30, 300, NOW), true, 'a little clock skew is fine');
  assert.strictEqual(isRecentLogin(NOW + 3600, 300, NOW), false, 'a token from the future is not');
});

test('writeAllowedWhilePending: reads and the three escape hatches only', () => {
  for (const m of ['GET', 'HEAD', 'OPTIONS']) assert.strictEqual(writeAllowedWhilePending(m, '/api/listings'), true);
  assert.strictEqual(writeAllowedWhilePending('DELETE', '/api/me/deletion-request'), true);
  assert.strictEqual(writeAllowedWhilePending('DELETE', '/api/me'), true);
  assert.strictEqual(writeAllowedWhilePending('DELETE', '/api/me/?x=1'), true);
  assert.strictEqual(writeAllowedWhilePending('PATCH', '/api/bookings/4f1c/cancel'), true);
  assert.strictEqual(writeAllowedWhilePending('POST', '/api/bookings'), false);
  assert.strictEqual(writeAllowedWhilePending('POST', '/api/listings'), false);
  assert.strictEqual(writeAllowedWhilePending('PATCH', '/api/listings/abc'), false);
  assert.strictEqual(writeAllowedWhilePending('POST', '/api/listings/abc/photos'), false);
  assert.strictEqual(writeAllowedWhilePending('DELETE', '/api/listings/abc/photos/x'), false);
  assert.strictEqual(writeAllowedWhilePending('POST', '/api/me/deletion-request'), false, 'already requested');
  assert.strictEqual(writeAllowedWhilePending('PATCH', '/api/bookings/4f1c/cancel/extra'), false);
});
