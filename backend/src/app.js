require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { requireAuth } = require('./auth');
const { ApiError, notFound, wrap } = require('./errors');

const app = express();
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

const api = express.Router();
api.get('/me', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, full_name, phone, is_admin FROM profiles WHERE id = $1', [req.user.id]);
  res.json({ data: { ...rows[0], email: req.user.email } });
}));
api.use('/listings', require('./routes/listings'));
api.use('/bookings', require('./routes/bookings'));
api.use('/provider', require('./routes/provider'));
api.use('/admin', require('./routes/admin'));
api.use('/alternatives', require('./routes/alternatives'));
api.use((req, res, next) => next(notFound('Route not found')));
app.use('/api', api);
app.use((req, res, next) => next(notFound('Route not found')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } });
  if (err.type === 'entity.too.large') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body too large' } });
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
});

module.exports = app;
