const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../auth');
const { bad, notFound, forbidden, conflict, notBookable, wrap } = require('../errors');
const { isUuid, validateBookingWindow } = require('../lib/validate');
const { checkSlot } = require('../lib/booking-check');

const router = express.Router();

// POST /api/bookings
// 1) validate the time window   2) re-check the listing on the server (approved, active, not yours, open hours, slot free)
// 3) insert. The database trigger + EXCLUDE constraint stay the final guard, so two simultaneous requests for the same
// slot can never both succeed. Payment is a separate state (payment_status) and always starts 'unpaid'.
router.post('/', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!isUuid(b.listing_id)) throw bad('listing_id must be a valid uuid');
  const { start, end } = validateBookingWindow(b.start_time, b.end_time);

  const check = await checkSlot(pool, { listingId: b.listing_id, start, end, userId: req.user.id });
  if (!check.available) throw check.toError();

  try {
    // total_price / status / payment_status are set by the DB trigger; anything the client sent is ignored.
    const { rows } = await pool.query(
      `INSERT INTO bookings (listing_id, user_id, start_time, end_time, total_price)
       VALUES ($1, $2, $3, $4, 0) RETURNING *`,
      [b.listing_id, req.user.id, start.toISOString(), end.toISOString()]);
    res.status(201).json({ data: rows[0] });
  } catch (e) {
    // only reached when something changed between the check above and the insert (a race)
    if (e.code === '23P01') throw conflict('Slot already booked', 'SLOT_TAKEN');
    if (e.code === 'P0001' && e.message === 'LISTING_NOT_BOOKABLE') {
      const outside = /available hours/i.test(e.hint || '');
      throw notBookable(e.hint || undefined, outside ? 'OUTSIDE_AVAILABLE_HOURS' : 'LISTING_NOT_APPROVED');
    }
    if (e.code === 'P0002') throw notFound('Listing not found');
    if (e.code === 'PK001') throw forbidden('You cannot book your own listing', 'OWN_LISTING');
    throw e;
  }
}));

// GET /api/bookings/mine?status=confirmed|cancelled
router.get('/mine', requireAuth, wrap(async (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !['confirmed', 'cancelled'].includes(status)) throw bad('status must be confirmed or cancelled');
  const params = [req.user.id];
  let sql = `SELECT b.id, b.listing_id, b.start_time, b.end_time, b.total_price, b.status, b.payment_status, b.created_at,
                    json_build_object('title', COALESCE(l.title, b.listing_snapshot->>'title'),
                                      'address', COALESCE(l.address, b.listing_snapshot->>'address'),
                                      'listing_removed', (b.listing_id IS NULL)) AS listing
             FROM bookings b LEFT JOIN listings l ON l.id = b.listing_id WHERE b.user_id = $1`;
  if (status) { params.push(status); sql += ` AND b.status = $2`; }
  sql += ' ORDER BY b.start_time DESC';
  const { rows } = await pool.query(sql, params);
  res.json({ data: rows });
}));

// GET /api/bookings/:id  (the person who booked, the owner of that listing, or an admin; everyone else gets 404)
router.get('/:id', requireAuth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('Booking not found');
  const { rows } = await pool.query(
    `SELECT b.id, b.listing_id, b.user_id, b.start_time, b.end_time, b.total_price, b.status, b.payment_status, b.created_at,
            l.owner_id AS listing_owner_id,
            json_build_object('title', COALESCE(l.title, b.listing_snapshot->>'title'),
                              'address', COALESCE(l.address, b.listing_snapshot->>'address'),
                              'listing_removed', (b.listing_id IS NULL)) AS listing,
            COALESCE(p.full_name, 'ParkMate user') AS consumer_name
     FROM bookings b LEFT JOIN listings l ON l.id = b.listing_id LEFT JOIN profiles p ON p.id = b.user_id
     WHERE b.id = $1`, [req.params.id]);
  const row = rows[0];
  if (!row) throw notFound('Booking not found');
  const mine = row.user_id === req.user.id;
  const provider = row.listing_owner_id === req.user.id;
  if (!mine && !provider && !req.user.isAdmin) throw notFound('Booking not found'); // do not reveal others' bookings
  const { listing_owner_id, consumer_name, user_id, ...out } = row;
  if (mine) out.user_id = user_id;
  else out.consumer = { display_name: consumer_name };
  res.json({ data: out });
}));

// PATCH /api/bookings/:id/cancel  (booking owner only; extra on top of contract v1)
router.patch('/:id/cancel', requireAuth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('Booking not found');
  const { rows } = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
  const bk = rows[0];
  if (!bk) throw notFound('Booking not found');
  if (bk.user_id !== req.user.id) throw notFound('Booking not found'); // do not reveal others' bookings
  if (bk.status === 'cancelled') return res.json({ data: bk }); // idempotent
  if (new Date(bk.start_time) <= new Date()) throw bad('A booking that has already started cannot be cancelled');
  const upd = await pool.query(
    `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'confirmed' RETURNING *`, [bk.id]);
  res.json({ data: upd.rows[0] || bk });
}));

module.exports = router;
