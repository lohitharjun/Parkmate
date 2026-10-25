const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../auth');
const { bad, wrap } = require('../errors');
const { isUuid, parseIso, num } = require('../lib/validate');
const { distanceSql, freeSql } = require('../lib/geo.sql');

const router = express.Router();

// GET /api/alternatives?lat&lng&start&end&exclude_listing_id&max_price&radius_km   (Parking Rescue)
router.get('/', requireAuth, wrap(async (req, res) => {
  const q = req.query;
  for (const f of ['lat', 'lng', 'start', 'end']) if (q[f] === undefined) throw bad(`${f} is required`);
  const lat = num(q.lat, 'lat', { min: -90, max: 90, allowString: true });
  const lng = num(q.lng, 'lng', { min: -180, max: 180, allowString: true });
  const s = parseIso(q.start, 'start'), e = parseIso(q.end, 'end');
  if (e <= s) throw bad('end must be after start');
  const radius = q.radius_km === undefined ? 5 : num(q.radius_km, 'radius_km', { min: 0.1, max: 50, allowString: true });

  const params = [lat, lng, s.toISOString(), e.toISOString(), radius];
  const where = [`l.status = 'approved'`, `l.is_active = true`, freeSql('$3', '$4')];
  params.push(req.user.id); where.push(`l.owner_id <> $${params.length}`); // never suggest my own listings
  if (q.exclude_listing_id !== undefined) {
    if (!isUuid(q.exclude_listing_id)) throw bad('exclude_listing_id must be a valid uuid');
    params.push(q.exclude_listing_id); where.push(`l.id <> $${params.length}`);
  }
  if (q.max_price !== undefined) {
    params.push(num(q.max_price, 'max_price', { min: 0, allowString: true })); where.push(`l.price_per_hour <= $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT * FROM (SELECT l.id, l.title, l.address, l.latitude, l.longitude, l.price_per_hour, l.last_confirmed_at, l.is_demo,
                           ${distanceSql('$1', '$2')} AS distance_km
                    FROM listings l WHERE ${where.join(' AND ')}) t
     WHERE t.distance_km <= $5 ORDER BY t.distance_km ASC, t.price_per_hour ASC LIMIT 10`, params);

  const cheapest = rows.length ? Math.min(...rows.map((r) => r.price_per_hour)) : null;
  const data = rows.map((r, i) => {
    const reasons = ['Free for your whole time window'];
    if (i === 0) reasons.push('Closest available option');
    if (r.price_per_hour === cheapest) reasons.push('Lowest price among alternatives');
    if (r.distance_km <= 1) reasons.push('Within 1 km of your destination');
    const ageDays = r.last_confirmed_at ? (Date.now() - new Date(r.last_confirmed_at).getTime()) / 86400000 : Infinity;
    if (ageDays <= 7) reasons.push('Availability confirmed by the owner in the last 7 days');
    else if (ageDays > 30) reasons.push('Owner has not confirmed availability recently');
    const { distance_km, ...listing } = r;
    return { listing, distance_km, reasons };
  });
  res.json({ data });
}));

module.exports = router;
