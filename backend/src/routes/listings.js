const express = require('express');
const pool = require('../db');
const { requireAuth, optionalAuth } = require('../auth');
const { bad, notFound, wrap } = require('../errors');
const { isUuid, parseIso, num, validateListingInput, validateAvailability, validateLocationInput, validateBookingWindow } = require('../lib/validate');
const { loadListing, loadOwnedListing, isOwnerOrAdmin, canView } = require('../lib/listing-access');
const { checkSlot } = require('../lib/booking-check');
const { listListingPhotos, photosForListings } = require('../lib/photos');
const { distanceSql, freeSql } = require('../lib/geo.sql');
const { recommendParking } = require('../lib/parking-rescue');

const router = express.Router();
const PUBLIC_COLS = 'l.id, l.title, l.address, l.location_label, l.location_verified, l.latitude, l.longitude, l.price_per_hour, l.updated_at, l.last_confirmed_at, l.is_demo';

// GET /api/listings  (public search: approved + active only)
router.get('/', wrap(async (req, res) => {
  const q = req.query;
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  const where = [`l.status = 'approved'`, `l.is_active = true`];
  if (q.query !== undefined) {
    if (typeof q.query !== 'string') throw bad('query must be a string');
    const query = q.query.trim();
    if (query.length > 120) throw bad('query must be 120 characters or fewer');
    if (query) {
      where.push(`strpos(lower(concat_ws(' ', l.title, l.address, l.description, l.vehicle_type)), lower(${add(query)})) > 0`);
    }
  }
  if (q.vehicle_type !== undefined) {
    if (typeof q.vehicle_type !== 'string') throw bad('vehicle_type must be a string');
    const vehicleType = q.vehicle_type.trim();
    if (vehicleType.length > 50) throw bad('vehicle_type must be 50 characters or fewer');
    if (vehicleType) where.push(`strpos(lower(coalesce(l.vehicle_type, '')), lower(${add(vehicleType)})) > 0`);
  }

  const hasGeo = q.lat !== undefined || q.lng !== undefined;
  let lat, lng;
  if (hasGeo) {
    if (q.lat === undefined || q.lng === undefined) throw bad('lat and lng must be given together');
    lat = num(q.lat, 'lat', { min: -90, max: 90, allowString: true });
    lng = num(q.lng, 'lng', { min: -180, max: 180, allowString: true });
  }
  if (q.max_price !== undefined) where.push(`l.price_per_hour <= ${add(num(q.max_price, 'max_price', { min: 0, allowString: true }))}`);
  if ((q.start === undefined) !== (q.end === undefined)) throw bad('start and end must be given together');
  let start, end;
  if (q.start !== undefined) {
    start = parseIso(q.start, 'start');
    end = parseIso(q.end, 'end');
    if (end <= start) throw bad('end must be after start');
    where.push(freeSql(add(start.toISOString()), add(end.toISOString())));
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
  if (rows.length === 0 && hasGeo && q.start !== undefined) {
    const radiusKm = q.max_distance_km === undefined
      ? 5
      : num(q.max_distance_km, 'max_distance_km', { min: 0, allowString: true });
    const fallbackParams = [lat, lng, start.toISOString(), end.toISOString(), radiusKm];
    const fallbackWhere = [
      `l.status = 'approved'`,
      `l.is_active = true`,
      freeSql('$3', '$4'),
      `${distanceSql('$1', '$2')} <= $5`,
    ];
    if (q.vehicle_type !== undefined && String(q.vehicle_type).trim()) {
      fallbackParams.push(String(q.vehicle_type).trim());
      fallbackWhere.push(`strpos(lower(coalesce(l.vehicle_type, '')), lower($${fallbackParams.length})) > 0`);
    }
    const { rows: candidates } = await pool.query(
      `SELECT ${PUBLIC_COLS}, l.status, l.is_active, TRUE AS is_available
       FROM listings l
       WHERE ${fallbackWhere.join(' AND ')}`,
      fallbackParams,
    );
    const { recommendations } = recommendParking(candidates.map((row) => ({
      ...row,
      price_per_hour: Number(row.price_per_hour),
    })), { limit: 5 });
    const candidatesById = new Map(candidates.map((row) => [row.id, row]));
    const data = recommendations.map((recommendation) => {
      const row = candidatesById.get(recommendation.id);
      return {
        ...row,
        price_per_hour: Number(row.price_per_hour),
        is_available: true,
        search_fallback: true,
        confidence: recommendation.confidence,
        freshness: recommendation.freshness,
        confirmation: recommendation.confirmation,
        recommendation_reasons: [
          'Available for the requested time window',
          ...recommendation.reasons,
        ],
      };
    });
    return res.json({ data });
  }
  res.json({ data: rows.map((r) => (hasGeo ? r : (({ distance_km, ...rest }) => rest)(r))) });
}));

// GET /api/listings/mine  (owner: all my listings, any status; each one carries ALL its photos incl. pending/rejected,
// with review_status, so My spaces -> Parking photos can show the "In review" chip without one request per listing)
router.get('/mine', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM listings WHERE owner_id = $1 ORDER BY created_at DESC', [req.user.id]);
  let photos = new Map();
  try {
    photos = await photosForListings(rows, { privileged: true });
  } catch (e) {
    console.error('Listing photos unavailable:', e.message); // the listings themselves must still load
  }
  res.json({ data: rows.map((l) => ({ ...l, photos: photos.get(l.id) || [] })) });
}));

// GET /api/listings/:id   (includes the approved photos for consumers; owner/admin also get pending/rejected ones)
router.get('/:id', optionalAuth, wrap(async (req, res) => {
  const l = await loadListing(req.params.id);
  if (!canView(l, req.user)) throw notFound('Listing not found');
  const av = await pool.query(
    'SELECT day_of_week, open_time, close_time FROM availability WHERE listing_id = $1 ORDER BY day_of_week, open_time', [l.id]);
  const privileged = isOwnerOrAdmin(l, req.user);
  let photos = [];
  try {
    photos = await listListingPhotos(l, { privileged });
  } catch (e) {
    console.error('Listing photos unavailable:', e.message); // the listing itself must still load
  }
  const out = {
    id: l.id, title: l.title, description: l.description, rules: l.rules, address: l.address,
    location_label: l.location_label, location_verified: l.location_verified, location_updated_at: l.location_updated_at,
    latitude: l.latitude, longitude: l.longitude, price_per_hour: l.price_per_hour,
    vehicle_type: l.vehicle_type, is_active: l.is_active, status: l.status,
    updated_at: l.updated_at, last_confirmed_at: l.last_confirmed_at, is_demo: l.is_demo, availability: av.rows, photos,
  };
  if (privileged) { out.owner_id = l.owner_id; out.review_note = l.review_note; out.evidence_urls = l.evidence_urls || []; }
  res.json({ data: out });
}));

// GET /api/listings/:id/availability-check?start=&end=   (read-only answer; POST /api/bookings re-checks it on the server)
// 200 { data: { listing_id, start_time, end_time, available, reason, message, estimated_total_price } }
// reason is null when available, otherwise LISTING_NOT_APPROVED | LISTING_PAUSED | OWN_LISTING | OUTSIDE_AVAILABLE_HOURS | SLOT_TAKEN
router.get('/:id/availability-check', optionalAuth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('Listing not found');
  const { start, end } = validateBookingWindow(req.query.start, req.query.end, new Date(), { start: 'start', end: 'end' });
  const r = await checkSlot(pool, { listingId: req.params.id, start, end, userId: req.user ? req.user.id : null });
  if (!r.listing || !canView(r.listing, req.user)) throw notFound('Listing not found'); // pending/rejected stay invisible
  res.json({ data: {
    listing_id: r.listing.id, start_time: start.toISOString(), end_time: end.toISOString(),
    available: r.available, reason: r.reason, message: r.message, estimated_total_price: r.estimatedTotalPrice,
  } });
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

const loadOwned = loadOwnedListing;

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

// PUT /api/listings/:id/location  (owner only; saves the coordinates the provider picked on the map)
// Required: latitude, longitude. Optional: address, location_label. The database stamps location_updated_at and clears
// location_verified; moving an APPROVED listing also sends it back to pending (re-review), see the response status.
router.put('/:id/location', requireAuth, wrap(async (req, res) => {
  const l = await loadOwned(req);
  const v = validateLocationInput(req.body);
  const keys = Object.keys(v);
  const { rows } = await pool.query(
    `UPDATE listings SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING *`,
    [...Object.values(v), l.id]);
  res.json({ data: rows[0] });
}));

// POST /api/listings/:id/confirm  (owner says "this spot is still available"; sets last_confirmed_at = now)
router.post('/:id/confirm', requireAuth, wrap(async (req, res) => {
  const l = await loadOwned(req);
  const { rows } = await pool.query('UPDATE listings SET last_confirmed_at = now() WHERE id = $1 RETURNING *', [l.id]);
  res.json({ data: rows[0] });
}));

module.exports = router;
