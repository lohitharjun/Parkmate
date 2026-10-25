const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../auth');
const { bad, notFound, forbidden, conflict, notBookable, wrap } = require('../errors');
const { isUuid, validateBookingWindow } = require('../lib/validate');

const router = express.Router();

// POST /api/bookings
router.post('/', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!isUuid(b.listing_id)) throw bad('listing_id must be a valid uuid');
  const { start, end } = validateBookingWindow(b.start_time, b.end_time);

  const found = await pool.query('SELECT 1 FROM listings WHERE id = $1', [b.listing_id]);
  if (!found.rowCount) throw notFound('Listing not found');

  try {
    // total_price/status are set by the DB trigger. The EXCLUDE constraint is the real overlap guard,
    // so two simultaneous requests cannot both succeed.
    const { rows } = await pool.query(
      `INSERT INTO bookings (listing_id, user_id, start_time, end_time, total_price)
       VALUES ($1, $2, $3, $4, 0) RETURNING *`,
      [b.listing_id, req.user.id, start.toISOString(), end.toISOString()]);
    res.status(201).json({ data: rows[0] });
  } catch (e) {
    if (e.code === '23P01') throw conflict('Slot already booked');
    if (e.code === 'P0001' && e.message === 'LISTING_NOT_BOOKABLE') throw notBookable(e.hint || undefined);
    if (e.code === 'P0002') throw notFound('Listing not found');
    if (e.code === 'PK001') throw forbidden('You cannot book your own listing');
    throw e;
  }
}));

// GET /api/bookings/mine?status=confirmed|cancelled
router.get('/mine', requireAuth, wrap(async (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !['confirmed', 'cancelled'].includes(status)) throw bad('status must be confirmed or cancelled');
  const params = [req.user.id];
  let sql = `SELECT b.id, b.listing_id, b.start_time, b.end_time, b.total_price, b.status, b.created_at,
                    json_build_object('title', l.title, 'address', l.address) AS listing
             FROM bookings b JOIN listings l ON l.id = b.listing_id WHERE b.user_id = $1`;
  if (status) { params.push(status); sql += ` AND b.status = $2`; }
  sql += ' ORDER BY b.start_time DESC';
  const { rows } = await pool.query(sql, params);
  res.json({ data: rows });
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