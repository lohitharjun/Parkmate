const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { bad, notFound, wrap } = require('../errors');
const { isUuid } = require('../lib/validate');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/listings?status=pending   (review queue; extra on top of contract v1)
router.get('/listings', wrap(async (req, res) => {
  const status = req.query.status || 'pending';
  if (!['pending', 'approved', 'rejected'].includes(status)) throw bad('status must be pending, approved or rejected');
  const { rows } = await pool.query('SELECT * FROM listings WHERE status = $1 ORDER BY created_at', [status]);
  res.json({ data: rows });
}));

// PATCH /api/admin/listings/:id/review
router.patch('/listings/:id/review', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('Listing not found');
  const { decision, review_note } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) throw bad('decision must be approved or rejected');
  if (review_note !== undefined && (typeof review_note !== 'string' || review_note.length > 1000)) throw bad('review_note must be a string up to 1000 chars');
  const { rows } = await pool.query(
    `UPDATE listings SET status = $1::listing_status, reviewed_by = $2, review_note = $3 WHERE id = $4 RETURNING *`,
    [decision, req.user.id, review_note || null, req.params.id]);
  if (!rows.length) throw notFound('Listing not found');
  res.json({ data: rows[0] });
}));

module.exports = router;
