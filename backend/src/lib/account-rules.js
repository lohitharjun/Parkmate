// Pure helpers for account deletion (no database, no network), so they can be unit-tested on their own.

// ---- "fresh login" check -------------------------------------------------------------------------------------------
// The access token was already verified by Supabase (auth.getUser) before these run, so it is safe to just read its claims.
function decodeClaims(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? claims : null;
  } catch (e) {
    return null;
  }
}

// Seconds since epoch of the last SIGN-IN. Supabase puts the time of each sign-in method in the `amr` claim and keeps it
// when the token is refreshed, so a stolen, silently refreshed session does not look "fresh". Falls back to `iat`
// (issue time of this token) when the claim is missing.
function authTimeSeconds(claims) {
  if (!claims) return null;
  const amr = Array.isArray(claims.amr) ? claims.amr.map((a) => Number(a && a.timestamp)).filter(Number.isFinite) : [];
  if (amr.length) return Math.max(...amr);
  const iat = Number(claims.iat);
  return Number.isFinite(iat) ? iat : null;
}

// windowSeconds <= 0 turns the check off
function isRecentLogin(authTime, windowSeconds, nowSeconds = Date.now() / 1000) {
  if (!(windowSeconds > 0)) return true;
  if (!Number.isFinite(authTime)) return false;
  const age = nowSeconds - authTime;
  return age <= windowSeconds && age > -60;          // tolerate a minute of clock skew, reject tokens "from the future"
}

// ---- what a user whose account is waiting for deletion may still do ------------------------------------------------
// Reads are always fine (they need /me and /me/export). Writes are blocked, except these.
function writeAllowedWhilePending(method, url) {
  const m = String(method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(m)) return true;
  const path = String(url || '').split('?')[0].replace(/\/+$/, '');
  if (m === 'DELETE' && (path === '/api/me/deletion-request' || path === '/api/me')) return true;      // cancel / delete now
  if (m === 'PATCH' && /^\/api\/bookings\/[^/]+\/cancel$/.test(path)) return true;                     // cancel my own bookings
  return false;
}

module.exports = { decodeClaims, authTimeSeconds, isRecentLogin, writeAllowedWhilePending };
