import { describe, expect, it } from 'vitest';
import { returnPathMatchesRole, safeAuthReturnPath, workspaceForRole } from './authRoutes.js';

describe('safeAuthReturnPath', () => {
  const origin = 'https://parkmate.example';

  it('keeps a safe same-site route with its query and fragment', () => {
    expect(safeAuthReturnPath('/consumer/bookings?tab=upcoming#today', origin)).toBe('/consumer/bookings?tab=upcoming#today');
  });

  it.each(['https://outside.example/path', '//outside.example/path', '/\\outside.example/path', '/auth/sign-in?next=/provider/dashboard'])('rejects unsafe or looping return path %s', (path) => {
    expect(safeAuthReturnPath(path, origin)).toBeNull();
  });

  it('keeps encoded slash segments on this origin rather than treating them as an off-site URL', () => {
    expect(safeAuthReturnPath('/%2f%2foutside.example/path', origin)).toBe('/%2f%2foutside.example/path');
  });
});

describe('role workspace routing', () => {
  it('uses the selected role for a default workspace', () => {
    expect(workspaceForRole('consumer')).toBe('/consumer/search');
    expect(workspaceForRole('provider')).toBe('/provider/dashboard');
    expect(workspaceForRole('unexpected')).toBe('/consumer/search');
  });

  it('does not resume a consumer route for a provider or vice versa', () => {
    expect(returnPathMatchesRole('/provider/reservations?sort=upcoming', 'provider')).toBe(true);
    expect(returnPathMatchesRole('/provider/reservations', 'consumer')).toBe(false);
    expect(returnPathMatchesRole('/consumer/bookings', 'provider')).toBe(false);
    expect(returnPathMatchesRole('/consumer/bookings', 'consumer')).toBe(true);
    expect(returnPathMatchesRole('/', 'provider')).toBe(true);
  });
});
