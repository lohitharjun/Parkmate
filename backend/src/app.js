require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Sentry = require('@sentry/node');
const pool = require('./db');
const supabaseAdmin = require('./supabaseAdmin');
const { requireAuth } = require('./auth');
const { ApiError, bad, notFound, wrap } = require('./errors');

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; without this every user shares one IP

// CORS_ORIGINS (or FRONTEND_URL): comma-separated list, e.g.
//   http://localhost:5173,https://parkmate.vercel.app,*.vercel.app   ("*.x" matches https subdomains of x)
// Empty = allow everything (local dev only; set it in production).
const origins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
const originAllowed = (origin) => origins.some((o) => (o.startsWith('*.')
  ? new RegExp(`^https://([a-z0-9-]+\\.)+${o.slice(2).replace(/\./g, '\\.')}$`, 'i').test(origin)
  : o === origin));
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || origins.length === 0 || originAllowed(origin)),
}));
app.use(express.json({ limit: '100kb' }));

app.get('/', (req, res) => res.json({ name: 'ParkMate API', version: '1.0.0' }));

// Health: served at BOTH /health and /api/health until the team agrees on one (see docs/BLOCKERS.md)
const health = async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
  } catch (err) {
    console.error('Health: DB error:', err.message);
    res.status(503).json({ status: 'error', db: 'down', time: new Date().toISOString() });
  }
};
app.get('/health', health);
app.get('/api/health', health);

// ---- Rate limiting (applies to everything under /api) ----
const limited = (message) => ({ error: { code: 'RATE_LIMITED', message } });

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_GENERAL) || 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limited('Too many requests, please try again in a few minutes'),
});

// stricter for anything that changes data (POST, PATCH, PUT, DELETE)
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_WRITE) || 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  message: limited('Too many changes in a short time, please slow down'),
});

app.use('/api', generalLimiter, writeLimiter);

const api = express.Router();
api.get('/me', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, full_name, phone, is_admin FROM profiles WHERE id = $1', [req.user.id]);
  res.json({ data: { ...rows[0], email: req.user.email } });
}));

// ---- Delete my account ----
api.delete('/me', requireAuth, wrap(async (req, res) => {
  if ((req.body || {}).confirm !== 'DELETE') throw bad('Send {"confirm":"DELETE"} to delete your account');
  if (!supabaseAdmin) throw new ApiError(503, 'NOT_CONFIGURED', 'Account deletion is not available right now');

  const uid = req.user.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // someone has a future confirmed booking on this user's listing -> do not delete yet
    const active = await client.query(
      `SELECT 1 FROM bookings b JOIN listings l ON l.id = b.listing_id
       WHERE l.owner_id = $1 AND b.status = 'confirmed' AND b.end_time > now() LIMIT 1`, [uid]);
    if (active.rowCount) {
      throw new ApiError(409, 'ACCOUNT_HAS_ACTIVE_BOOKINGS',
        'Other users have upcoming bookings on your listings. Pause the listings and try again after those bookings end.');
    }

    await client.query('DELETE FROM bookings WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM bookings WHERE listing_id IN (SELECT id FROM listings WHERE owner_id = $1)', [uid]);
    await client.query('UPDATE listings SET reviewed_by = NULL WHERE reviewed_by = $1', [uid]);
    await client.query('DELETE FROM listings WHERE owner_id = $1', [uid]); // availability cascades
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // removes the login; the profiles row is removed by ON DELETE CASCADE
  const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
  if (error) {
    console.error('deleteUser failed:', error.message);
    throw new ApiError(500, 'INTERNAL_ERROR', 'Could not finish deleting the account, please try again');
  }
  res.json({ data: { deleted: true } });
}));

api.use('/listings', require('./routes/listings'));
api.use('/bookings', require('./routes/bookings'));
api.use('/provider', require('./routes/provider'));
api.use('/admin', require('./routes/admin'));
api.use('/alternatives', require('./routes/alternatives'));
api.use((req, res, next) => next(notFound('Route not found')));
app.use('/api', api);
app.use((req, res, next) => next(notFound('Route not found')));

// Sentry: reports unexpected (500) errors. Must come after all routes and before the error handler below.
Sentry.setupExpressErrorHandler(app);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } });
  if (err.type === 'entity.too.large') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body too large' } });
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
});

module.exports = app;