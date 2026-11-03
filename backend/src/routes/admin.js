const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { bad, notFound, wrap } = require('../errors');
const { isUuid } = require('../lib/validate');
const storage = require('../lib/storage');
const { serializePhoto, promotePrimary } = require('../lib/photos');

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

// ---- photo review (extra on top of contract v1) ----

// GET /api/admin/photos?status=pending&listing_id=   (review queue, newest last; includes a signed URL per photo)
router.get('/photos', wrap(async (req, res) => {
  const status = req.query.status || 'pending';
  if (!['pending', 'approved', 'rejected'].includes(status)) throw bad('status must be pending, approved or rejected');
  const params = [status];
  let sql = `SELECT p.*, json_build_object('id', l.id, 'title', l.title, 'address', l.address,
                                           'latitude', l.latitude, 'longitude', l.longitude) AS listing
             FROM listing_photos p JOIN listings l ON l.id = p.listing_id WHERE p.review_status = $1::photo_review_status`;
  if (req.query.listing_id !== undefined) {
    if (!isUuid(req.query.listing_id)) throw bad('listing_id must be a valid uuid');
    params.push(req.query.listing_id);
    sql += ' AND p.listing_id = $2';
  }
  sql += ' ORDER BY p.uploaded_at LIMIT 100';
  const { rows } = await pool.query(sql, params);
  const urls = await storage.signedUrls(rows.map((r) => r.storage_path));
  res.json({ data: rows.map((r) => ({ ...serializePhoto(r, urls.get(r.storage_path), { privileged: true, listing: r.listing }), listing: r.listing })) });
}));

// PATCH /api/admin/photos/:id/review   { decision: 'approved' | 'rejected', review_note? }
router.patch('/photos/:id/review', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('Photo not found');
  const { decision, review_note } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) throw bad('decision must be approved or rejected');
  if (review_note !== undefined && (typeof review_note !== 'string' || review_note.length > 1000)) throw bad('review_note must be a string up to 1000 chars');
  const client = await pool.connect();
  let row;
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE listing_photos SET review_status = $1::photo_review_status, reviewed_by = $2, reviewed_at = now(), review_note = $3
       WHERE id = $4 RETURNING *`, [decision, req.user.id, review_note || null, req.params.id]);
    row = upd.rows[0];
    if (row && decision === 'rejected') await promotePrimary(client, row.listing_id); // the DB already unset is_primary
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  if (!row) throw notFound('Photo not found');
  res.json({ data: serializePhoto(row, null, { privileged: true }) });
}));

// DELETE /api/admin/photos/:id   (remove an abusive photo)
router.delete('/photos/:id', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('Photo not found');
  const client = await pool.connect();
  let row;
  try {
    await client.query('BEGIN');
    row = (await client.query('DELETE FROM listing_photos WHERE id = $1 RETURNING *', [req.params.id])).rows[0];
    if (row && row.is_primary) await promotePrimary(client, row.listing_id);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  if (!row) throw notFound('Photo not found');
  await storage.removePhotos([row.storage_path]);
  res.json({ data: { deleted: true } });
}));

module.exports = router;
