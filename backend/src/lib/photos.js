// Shared photo helpers: response shaping (what consumers may and may not see) and listing/photo queries.
const pool = require('../db');
const storage = require('./storage');

const EARTH_M = 6371000;
function distanceMeters(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * EARTH_M * Math.asin(Math.sqrt(a)));
}

// Consumers get: id, url, is_primary, uploaded_at. Owners/admins also get review state and the capture data.
// storage_path is never returned. The capture coordinates are what the provider's device reported with their
// permission; distance_from_listing_m is a hint for the reviewer, NOT proof of presence or ownership.
function serializePhoto(row, url, { privileged = false, listing = null } = {}) {
  const out = { id: row.id, url: url || null, is_primary: row.is_primary, uploaded_at: row.uploaded_at };
  if (!privileged) return out;
  out.listing_id = row.listing_id;
  out.review_status = row.review_status;
  out.review_note = row.review_note;
  out.captured_at = row.captured_at;
  out.capture_latitude = row.capture_latitude;
  out.capture_longitude = row.capture_longitude;
  out.content_type = row.content_type;
  out.size_bytes = row.size_bytes;
  out.distance_from_listing_m = null;
  if (listing && row.capture_latitude != null && row.capture_longitude != null) {
    out.distance_from_listing_m = distanceMeters(listing.latitude, listing.longitude, row.capture_latitude, row.capture_longitude);
  }
  return out;
}

// privileged = owner or admin (sees every photo); otherwise approved photos only.
async function listListingPhotos(listing, { privileged }) {
  const { rows } = await pool.query(
    `SELECT * FROM listing_photos WHERE listing_id = $1 ${privileged ? '' : "AND review_status = 'approved'"}
     ORDER BY is_primary DESC, uploaded_at ASC, id ASC`, [listing.id]);
  const urls = await storage.signedUrls(rows.map((r) => r.storage_path));
  return rows.map((r) => serializePhoto(r, urls.get(r.storage_path), { privileged, listing }));
}

// Several listings at once (used by GET /listings/mine): ONE query for all photos and ONE signing call, then grouped by
// listing. Returns Map(listing id -> serialized photos); every listing id has an entry, even when it has no photos.
async function photosForListings(listings, { privileged }) {
  const byId = new Map(listings.map((l) => [l.id, []]));
  if (listings.length === 0) return byId;
  const { rows } = await pool.query(
    `SELECT * FROM listing_photos WHERE listing_id = ANY($1::uuid[]) ${privileged ? '' : "AND review_status = 'approved'"}
     ORDER BY listing_id, is_primary DESC, uploaded_at ASC, id ASC`, [listings.map((l) => l.id)]);
  if (rows.length === 0) return byId;
  const urls = await storage.signedUrls(rows.map((r) => r.storage_path));
  const listingById = new Map(listings.map((l) => [l.id, l]));
  for (const r of rows) {
    byId.get(r.listing_id).push(serializePhoto(r, urls.get(r.storage_path), { privileged, listing: listingById.get(r.listing_id) }));
  }
  return byId;
}

// after the main photo is removed or rejected: pick the next best one (approved first, then oldest)
async function promotePrimary(db, listingId) {
  await db.query(
    `UPDATE listing_photos SET is_primary = true
     WHERE id = (SELECT id FROM listing_photos WHERE listing_id = $1 AND review_status <> 'rejected'
                 ORDER BY (review_status = 'approved') DESC, uploaded_at ASC, id ASC LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM listing_photos WHERE listing_id = $1 AND is_primary)`, [listingId]);
}

module.exports = { serializePhoto, listListingPhotos, photosForListings, promotePrimary, distanceMeters };
