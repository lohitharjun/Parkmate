require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const pool = require('./db');
const { unauth, forbidden, wrap } = require('./errors');

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
     RETURNING is_admin`, [data.user.id]);
  return { id: data.user.id, email: data.user.email, isAdmin: rows[0].is_admin };
}

// 401 when there is no / a bad token. User id ALWAYS comes from the token.
const requireAuth = wrap(async (req, res, next) => {
  const user = await resolveUser(req);
  if (!user) throw unauth();
  req.user = user;
  next();
});

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

module.exports = { requireAuth, optionalAuth, requireAdmin };
