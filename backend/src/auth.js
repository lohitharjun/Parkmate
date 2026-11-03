require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const pool = require('./db');
const { unauth, forbidden, reauthRequired, wrap } = require('./errors');
const { decodeClaims, authTimeSeconds, isRecentLogin, writeAllowedWhilePending } = require('./lib/account-rules');

// How recent the login must be for dangerous actions (delete account). 0 turns the check off.
const REAUTH_WINDOW_SECONDS = process.env.REAUTH_WINDOW_SECONDS === undefined || process.env.REAUTH_WINDOW_SECONDS === ''
  ? 300 : Math.max(0, Number(process.env.REAUTH_WINDOW_SECONDS) || 0);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function resolveUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw unauth('Invalid or expired token');
  // make sure a profile row exists (listings/bookings reference it)
  const { rows } = await pool.query(
    `INSERT INTO profiles (id) VALUES ($1)
     ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
     RETURNING is_admin, deletion_requested_at`, [data.user.id]);
  return {
    id: data.user.id, email: data.user.email, isAdmin: rows[0].is_admin,
    deletionRequestedAt: rows[0].deletion_requested_at || null,       // set while the account waits for its deletion date
    authTime: authTimeSeconds(decodeClaims(token)),                    // when this session was last signed in with a password
  };
}

// 401 when there is no / a bad token. User id ALWAYS comes from the token.
const requireAuth = wrap(async (req, res, next) => {
  const user = await resolveUser(req);
  if (!user) throw unauth();
  req.user = user;
  // an account waiting for deletion can look at its data and cancel, but it cannot create or change anything
  if (user.deletionRequestedAt && !writeAllowedWhilePending(req.method, req.originalUrl)) {
    throw forbidden('This account is scheduled for deletion. Restore it first to make changes.', 'ACCOUNT_PENDING_DELETION');
  }
  next();
});

// use AFTER requireAuth on dangerous routes: the session must have been signed in within the last REAUTH_WINDOW_SECONDS.
// The frontend answers a 401 REAUTH_REQUIRED by asking for the password again (a new sign-in) and repeating the call.
const requireRecentLogin = (req, res, next) => {
  if (!isRecentLogin(req.user && req.user.authTime, REAUTH_WINDOW_SECONDS)) return next(reauthRequired());
  next();
};

// public route that behaves differently when logged in (e.g. owner viewing own pending listing).
// A missing, invalid or EXPIRED token is ignored: the caller is simply treated as anonymous.
const optionalAuth = wrap(async (req, res, next) => {
  try {
    req.user = await resolveUser(req);
  } catch (e) {
    if (e && e.status === 401) req.user = null; else throw e;
  }
  next();
});

const requireAdmin = (req, res, next) => {
  if (!req.user.isAdmin) return next(forbidden('Admin only'));
  next();
};

module.exports = { requireAuth, optionalAuth, requireAdmin, requireRecentLogin };
