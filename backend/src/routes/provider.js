const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../auth');
const { bad, wrap } = require('../errors');
const { isUuid } = require('../lib/validate');

const router = express.Router();

// GET /api/provider/bookings?listing_id=   (only bookings on listings I own)
router.get('/bookings', requireAuth, wrap(async (req, res) => {
  const params = [req.user.id];
  let sql = `SELECT b.id, b.listing_id, b.start_time, b.end_time, b.status, b.total_price,
                    json_build_object('display_name', COALESCE(p.full_name, 'ParkMate user')) AS consumer
             FROM bookings b
             JOIN listings l ON l.id = b.listing_id
             JOIN profiles p ON p.id = b.user_id
             WHERE l.owner_id = $1`;
  if (req.query.listing_id !== undefined) {
    if (!isUuid(req.query.listing_id)) throw bad('listing_id must be a valid uuid');
    params.push(req.query.listing_id);
    sql += ' AND b.listing_id = $2';
  }
  sql += ' ORDER BY b.start_time DESC';
  const { rows } = await pool.query(sql, params);
  res.json({ data: rows });
}));

module.exports = router;
