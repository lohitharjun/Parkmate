require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Sentry = require('@sentry/node');
const pool = require('./db');
const { ApiError, notFound } = require('./errors');

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; without this every user shares one IP

// CORS_ORIGINS (or FRONTEND_URL): comma-separated list, e.g.
//   http://localhost:5173,https://parkmate.vercel.app,*.vercel.app   ("*.x" matches https subdomains of x)
// Empty = allow everything (local dev only; set it in production).
const origins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
console.log('CORS origins:', origins);
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
api.use('/me', require('./routes/me'));        // profile, data export, account deletion (see routes/me.js)
api.use('/listings/:id/photos', require('./routes/photos'));
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
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.reason ? { reason: err.reason } : {}) } });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } });
  if (err.type === 'entity.too.large') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body too large' } });
  if (err.expose && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
});

module.exports = app;