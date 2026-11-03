// Supabase Storage access for listing photos. Uses the SERVICE-ROLE client, so it only ever runs on the server.
// The bucket is private: files are reachable only through short-lived signed URLs this backend hands out.
const supabaseAdmin = require('../supabaseAdmin');
const { ApiError, notConfigured } = require('../errors');

const BUCKET = process.env.PHOTO_BUCKET || 'listing-photos';
const URL_TTL_SECONDS = Math.min(Math.max(Number(process.env.PHOTO_URL_TTL_SECONDS) || 3600, 60), 24 * 3600);

function bucket() {
  if (!supabaseAdmin) throw notConfigured('Photo storage is not configured on this server (SUPABASE_SERVICE_ROLE_KEY)');
  return supabaseAdmin.storage.from(BUCKET);
}

async function uploadPhoto(path, buffer, contentType) {
  const { error } = await bucket().upload(path, buffer, { contentType, upsert: false, cacheControl: '3600' });
  if (error) {
    console.error('Storage upload failed:', error.message);
    throw new ApiError(502, 'STORAGE_ERROR', 'Could not store the photo, please try again');
  }
}

// best effort: never throws (a leftover private file is harmless, a failed request is not)
async function removePhotos(paths) {
  if (!paths || paths.length === 0 || !supabaseAdmin) return;
  for (let i = 0; i < paths.length; i += 100) {
    try {
      const { error } = await supabaseAdmin.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      if (error) console.error('Storage remove failed:', error.message);
    } catch (e) {
      console.error('Storage remove failed:', e.message);
    }
  }
}

// paths -> Map(path -> signed URL). Missing/failed entries are simply absent from the map.
async function signedUrls(paths) {
  const map = new Map();
  if (!paths || paths.length === 0) return map;
  const { data, error } = await bucket().createSignedUrls(paths, URL_TTL_SECONDS);
  if (error) {
    console.error('Storage signing failed:', error.message);
    throw new ApiError(502, 'STORAGE_ERROR', 'Could not load photos, please try again');
  }
  for (const item of data || []) if (item && item.signedUrl && !item.error) map.set(item.path, item.signedUrl);
  return map;
}

module.exports = { uploadPhoto, removePhotos, signedUrls, BUCKET, URL_TTL_SECONDS };
