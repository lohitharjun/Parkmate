import { describe, expect, it } from 'vitest';
import { friendlyAuthError, friendlyApiError, friendlyError } from './errors.js';
import { isServiceRoleKey } from './runtime.js';
import { parseDsn, buildEvent } from './monitoring.js';

const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (role) => `${b64({ alg: 'HS256' })}.${b64({ role })}.signature`;

describe('friendly errors', () => {
  it('explains wrong credentials', () => {
    expect(friendlyAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toMatch(/email and password/i);
  });
  it('explains unconfirmed email', () => {
    expect(friendlyAuthError({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toMatch(/confirm|verif/i);
  });
  it('never returns raw technical text or empty strings', () => {
    for (const e of [null, undefined, {}, new Error('TypeError: x is undefined'), { status: 500 }]) {
      const msg = friendlyError(e);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toMatch(/undefined|TypeError/);
    }
  });
  it('maps api codes', () => {
    expect(friendlyApiError({ code: 'ACCOUNT_HAS_ACTIVE_BOOKINGS' })).toMatch(/booking/i);
    expect(friendlyApiError({ code: 'NETWORK_ERROR' })).toMatch(/connect|internet|network/i);
  });
});

describe('service-role guard', () => {
  it('flags service-role keys', () => expect(isServiceRoleKey(jwt('service_role'))).toBe(true));
  it('accepts anon keys and junk', () => {
    expect(isServiceRoleKey(jwt('anon'))).toBe(false);
    expect(isServiceRoleKey('not-a-jwt')).toBe(false);
    expect(isServiceRoleKey('')).toBe(false);
  });
});

describe('monitoring', () => {
  it('parses a Sentry DSN', () => {
    const d = parseDsn('https://abc123@o1.ingest.sentry.io/4507');
    expect(d.key).toBe('abc123');
    expect(d.endpoint).toContain('/api/4507/envelope/');
  });
  it('rejects bad DSNs', () => {
    expect(parseDsn('')).toBeNull();
    expect(parseDsn('nope')).toBeNull();
  });
  it('builds an event without personal data', () => {
    const ev = buildEvent(new Error('boom'));
    expect(JSON.stringify(ev)).toContain('boom');
    expect(ev.user?.email).toBeUndefined();
  });
});
