const express = require('express');
const pool = require('../db');
const { requireAuth, optionalAuth } = require('../auth');
const { bad, notFound, forbidden, wrap } = require('../errors');
const { isUuid, parseIso, num, validateListingInput, validateAvailability } = require('../lib/validate');
const { distanceSql, freeSql } = require('../lib/geo.sql');

const router = express.Router();
const PUBLIC_COLS = 'l.id, l.title, l.address, l.latitude, l.longitude, l.price_per_hour, l.last_confirmed_at, l.is_demo';

// GET /api/listings  (public search: approved + active only)
router.get('/', wrap(async (req, res) => {
  const q = req.query;
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  const where = [`l.status = 'approved'`, `l.is_active = true`];

  const hasGeo = q.lat !== undefined || q.lng !== undefined;
  let lat, lng;
  if (hasGeo) {
    if (q.lat === undefined || q.lng === undefined) throw bad('lat and lng must be given together');
    lat = num(q.lat, 'lat', { min: -90, max: 90, allowString: true });
    lng = num(q.lng, 'lng', { min: -180, max: 180, allowString: true });
  }
  if (q.max_price !== undefined) where.push(`l.price_per_hour <= ${add(num(q.max_price, 'max_price', { min: 0, allowString: true }))}`);
  if ((q.start === undefined) !== (q.end === undefined)) throw bad('start and end must be given together');
  if (q.start !== undefined) {
    const s = parseIso(q.start, 'start'), e = parseIso(q.end, 'end');
    if (e <= s) throw bad('end must be after start');
    where.push(freeSql(add(s.toISOString()), add(e.toISOString())));
  }

  let distExpr = 'NULL::numeric';
  if (hasGeo) distExpr = distanceSql(add(lat), add(lng));
  const sort = q.sort === undefined ? null : q.sort;
  if (sort !== null && !['recommended', 'price', 'distance'].includes(sort)) throw bad('sort must be recommended, price or distance');
  if ((sort === 'distance' || sort === 'recommended') && !hasGeo) throw bad(`lat and lng are required for sort=${sort}`);
  if (q.max_distance_km !== undefined && !hasGeo) throw bad('lat and lng are required for max_distance_km');

  let sql = `SELECT * FROM (SELECT ${PUBLIC_COLS}, ${distExpr} AS distance_km FROM listings l WHERE ${where.join(' AND ')}) t`;
  if (q.max_distance_km !== undefined) sql += ` WHERE t.distance_km <= ${add(num(q.max_distance_km, 'max_distance_km', { min: 0, allowString: true }))}`;
  const effective = sort || (hasGeo ? 'recommended' : 'price');
  const order = {
    price: 't.price_per_hour ASC, t.title ASC',
    distance: 't.distance_km ASC, t.price_per_hour ASC',
    recommended: '(t.price_per_hour + 5 * t.distance_km) ASC, t.title ASC', // cheap AND close
  }[effective];
  sql += ` ORDER BY ${order} LIMIT 100`;

  const { rows } = await pool.query(sql, params);
  res.json({ data: rows.map((r) => (hasGeo ? r : (({ distance_km, ...rest }) => rest)(r))) });
}));

// GET /api/listings/mine  (owner: all my listings, any status)
router.get('/mine', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM listings WHERE owner_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ data: rows });
}));

// GET /api/listings/:id
router.get('/:id', optionalAuth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('Listing not found');
  const { rows } = await pool.query('SELECT * FROM listings WHERE id = $1', [req.params.id]);
  const l = rows[0];
  const canSee = l && (l.status === 'approved' || (req.user && (req.user.id === l.owner_id || req.user.isAdmin)));
  if (!canSee) throw notFound('Listing not found');
  const av = await pool.query(
    'SELECT day_of_week, open_time, close_time FROM availability WHERE listing_id = $1 ORDER BY day_of_week, open_time', [l.id]);
  const isOwnerOrAdmin = req.user && (req.user.id === l.owner_id || req.user.isAdmin);
  const out = {
    id: l.id, title: l.title, description: l.description, rules: l.rules, address: l.address,
    latitude: l.latitude, longitude: l.longitude, price_per_hour: l.price_per_hour,
    vehicle_type: l.vehicle_type, is_active: l.is_active, status: l.status,
    last_confirmed_at: l.last_confirmed_at, is_demo: l.is_demo, availability: av.rows,
  };
  if (isOwnerOrAdmin) { out.owner_id = l.owner_id; out.review_note = l.review_note; out.evidence_urls = l.evidence_urls || []; }
  res.json({ data: out });
}));

// POST /api/listings  (optional inline "availability" windows; skipping it = open 24x7)
router.post('/', requireAuth, wrap(async (req, res) => {
  const { availability, ...v } = validateListingInput(req.body, { partial: false });
  const cols = ['owner_id', ...Object.keys(v)];
  const vals = [req.user.id, ...Object.values(v)];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO listings (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
    for (const w of availability || []) {
      await client.query('INSERT INTO availability (listing_id, day_of_week, open_time, close_time) VALUES ($1,$2,$3,$4)',
        [rows[0].id, w.day_of_week, w.open_time, w.close_time]);
    }
    await client.query('COMMIT');
    res.status(201).json({ data: { ...rows[0], availability: availability || [] } });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

async function loadOwned(req) {
  if (!isUuid(req.params.id)) throw notFound('Listing not found');
  const { rows } = await pool.query('SELECT * FROM listings WHERE id = $1', [req.params.id]);
  const l = rows[0];
  if (!l) throw notFound('Listing not found');
  if (l.owner_id !== req.user.id) {
    // someone else's approved listing is visible, so 403; someone else's pending/rejected is invisible, so 404
    if (l.status === 'approved' || req.user.isAdmin) throw forbidden('Only the owner can change this listing');
    throw notFound('Listing not found');
  }
  return l;
}

// PATCH /api/listings/:id  (owner only)
router.patch('/:id', requireAuth, wrap(async (req, res) => {
  const l = await loadOwned(req);
  const v = validateListingInput(req.body, { partial: true });
  const keys = Object.keys(v);
  const { rows } = await pool.query(
    `UPDATE listings SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING *`,
    [...Object.values(v), l.id]);
  res.json({ data: rows[0] });
}));

// PUT /api/listings/:id/availability  (owner only; replaces the weekly opening hours; [] = open 24x7)
router.put('/:id/availability', requireAuth, wrap(async (req, res) => {
  const l = await loadOwned(req);
  const windows = validateAvailability(req.body && req.body.windows);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM availability WHERE listing_id = $1', [l.id]);
    for (const w of windows) {
      await client.query('INSERT INTO availability (listing_id, day_of_week, open_time, close_time) VALUES ($1,$2,$3,$4)',
        [l.id, w.day_of_week, w.open_time, w.close_time]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  res.json({ data: { listing_id: l.id, windows } });
}));

// POST /api/listings/:id/confirm  (owner says "this spot is still available"; sets last_confirmed_at = now)
router.post('/:id/confirm', requireAuth, wrap(async (req, res) => {
  const l = await loadOwned(req);
  const { rows } = await pool.query('UPDATE listings SET last_confirmed_at = now() WHERE id = $1 RETURNING *', [l.id]);
  res.json({ data: rows[0] });
}));

module.exports = router;
