const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../auth');
const { bad, wrap } = require('../errors');
const { isUuid, parseIso, num } = require('../lib/validate');
const { distanceSql, freeSql } = require('../lib/geo.sql');
const { recommendParking } = require('../lib/parking-rescue');

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
    `SELECT * FROM (SELECT l.id, l.title, l.address, l.latitude, l.longitude, l.price_per_hour,
                           l.status, l.is_active, TRUE AS is_available, l.updated_at, l.last_confirmed_at, l.is_demo,
                           ${distanceSql('$1', '$2')} AS distance_km
                    FROM listings l WHERE ${where.join(' AND ')}) t
     WHERE t.distance_km <= $5`, params);

  const { recommendations } = recommendParking(rows.map((row) => ({
    ...row,
    price_per_hour: Number(row.price_per_hour),
    distance_km: Number(row.distance_km),
    distance_source: 'haversine',
  }), { limit: 5 }));
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const data = recommendations.map((item) => {
    const row = rowsById.get(item.id);
    return {
      listing: {
        id: item.id,
        title: item.title,
        address: item.address,
        latitude: row.latitude,
        longitude: row.longitude,
        price_per_hour: item.price_per_hour,
        status: row.status,
        is_active: row.is_active,
        is_available: true,
        updated_at: item.updated_at,
        last_confirmed_at: item.last_confirmed_at,
        is_demo: item.is_demo,
        confidence: item.confidence,
        freshness: item.freshness,
        confirmation: item.confirmation,
      },
      reasons: ['Free for your whole time window', ...item.reasons],
    };
  });
  res.json({ data });
}));

module.exports = router;
