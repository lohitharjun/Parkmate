// Geo-tagged listing photos. Mounted at /api/listings/:id/photos
//   GET    /                 approved photos for everyone who can see the listing (owner/admin see all, with review state)
//   POST   /                 owner uploads ONE image as the raw request body (Content-Type image/jpeg or image/png)
//                            query: capture_latitude, capture_longitude, captured_at (all optional, sent with the user's permission)
//   PATCH  /:photoId         owner makes this photo the main one: { "is_primary": true }
//   DELETE /:photoId         owner deletes the photo
// Files live in a private Supabase Storage bucket; metadata lives in listing_photos. Embedded EXIF/XMP/IPTC is stripped
// before storing and is never used as proof of ownership or presence.
const crypto = require('crypto');
const express = require('express');
const pool = require('../db');
const { requireAuth, optionalAuth } = require('../auth');
const { ApiError, bad, notFound, forbidden, tooLarge, unsupportedType, wrap } = require('../errors');
const { isUuid, validateCaptureMeta } = require('../lib/validate');
const { loadListing, loadOwnedListing, isOwnerOrAdmin, canView } = require('../lib/listing-access');
const { processImage } = require('../lib/image');
const storage = require('../lib/storage');
const { listListingPhotos, serializePhoto, promotePrimary } = require('../lib/photos');

const router = express.Router({ mergeParams: true });

const MAX_BYTES = Number(process.env.MAX_PHOTO_BYTES) || 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];

const parseRaw = express.raw({ type: ALLOWED_TYPES, limit: MAX_BYTES });
const rawBody = (req, res, next) => parseRaw(req, res, (err) => {
  if (err && err.type === 'entity.too.large') {
    return next(tooLarge(`The photo must be ${Math.round((MAX_BYTES / 1048576) * 10) / 10} MB or smaller`));
  }
  return next(err);
});

async function loadPhoto(listingId, photoId) {
  if (!isUuid(photoId)) throw notFound('Photo not found');
  const { rows } = await pool.query('SELECT * FROM listing_photos WHERE id = $1 AND listing_id = $2', [photoId, listingId]);
  if (!rows[0]) throw notFound('Photo not found');
  return rows[0];
}

// GET /api/listings/:id/photos
router.get('/', optionalAuth, wrap(async (req, res) => {
  const l = await loadListing(req.params.id);
  if (!canView(l, req.user)) throw notFound('Listing not found');
  res.json({ data: await listListingPhotos(l, { privileged: isOwnerOrAdmin(l, req.user) }) });
}));

// POST /api/listings/:id/photos
// Order matters: login -> ownership -> only then read the (up to 5 MB) body, so strangers cannot make us buffer uploads.
router.post('/', requireAuth,
  wrap(async (req, res, next) => { req.listing = await loadOwnedListing(req); next(); }),
  rawBody,
  wrap(async (req, res) => {
    const listing = req.listing;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw unsupportedType('Send the image as the request body with Content-Type image/jpeg or image/png');
    }
    const declared = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const img = processImage(req.body);                       // validates the real bytes, strips metadata
    if (img.contentType !== declared) throw unsupportedType('The file content does not match its Content-Type');
    const meta = validateCaptureMeta(req.query);

    const count = await pool.query('SELECT count(*)::int AS n FROM listing_photos WHERE listing_id = $1', [listing.id]);
    if (count.rows[0].n >= 10) throw new ApiError(422, 'PHOTO_LIMIT_REACHED', 'A listing can have at most 10 photos');

    const path = `${listing.id}/${crypto.randomUUID()}.${img.ext}`;
    await storage.uploadPhoto(path, img.buffer, img.contentType);
    let row;
    try {
      const ins = await pool.query(
        `INSERT INTO listing_photos (listing_id, uploaded_by, storage_path, content_type, size_bytes,
                                     capture_latitude, capture_longitude, captured_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [listing.id, req.user.id, path, img.contentType, img.buffer.length,
          meta.capture_latitude, meta.capture_longitude, meta.captured_at]);
      row = ins.rows[0];
    } catch (e) {
      await storage.removePhotos([path]);                       // do not leave an orphan file behind
      if (e.code === 'PH001') throw forbidden('Only the listing owner can add photos');
      if (e.code === 'PH002') throw new ApiError(422, 'PHOTO_LIMIT_REACHED', 'A listing can have at most 10 photos');
      if (e.code === 'P0002' || e.code === '23503') throw notFound('Listing not found');
      throw e;
    }
    let url = null;
    try { url = (await storage.signedUrls([path])).get(path) || null; } catch (e) { console.error('Could not sign new photo URL'); }
    res.status(201).json({ data: serializePhoto(row, url, { privileged: true, listing }) });
  }));

// PATCH /api/listings/:id/photos/:photoId   { "is_primary": true }
router.patch('/:photoId', requireAuth, wrap(async (req, res) => {
  const l = await loadOwnedListing(req);
  const photo = await loadPhoto(l.id, req.params.photoId);
  const body = req.body || {};
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'is_primary' || body.is_primary !== true) {
    throw bad('Only { "is_primary": true } is allowed; pick another photo to change the main one');
  }
  if (photo.review_status === 'rejected') throw bad('A rejected photo cannot be the main photo');

  const client = await pool.connect();
  let row;
  try {
    await client.query('BEGIN');
    await client.query('UPDATE listing_photos SET is_primary = false WHERE listing_id = $1 AND is_primary AND id <> $2', [l.id, photo.id]);
    row = (await client.query('UPDATE listing_photos SET is_primary = true WHERE id = $1 RETURNING *', [photo.id])).rows[0];
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') throw new ApiError(409, 'CONFLICT', 'The main photo was changed at the same time, please try again');
    throw e;
  } finally { client.release(); }
  let url = null;
  try { url = (await storage.signedUrls([row.storage_path])).get(row.storage_path) || null; } catch (e) { console.error('Could not sign photo URL'); }
  res.json({ data: serializePhoto(row, url, { privileged: true, listing: l }) });
}));

// DELETE /api/listings/:id/photos/:photoId
router.delete('/:photoId', requireAuth, wrap(async (req, res) => {
  const l = await loadOwnedListing(req);
  const photo = await loadPhoto(l.id, req.params.photoId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM listing_photos WHERE id = $1', [photo.id]);
    if (photo.is_primary) await promotePrimary(client, l.id);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await storage.removePhotos([photo.storage_path]);
  res.json({ data: { deleted: true } });
}));

module.exports = router;
