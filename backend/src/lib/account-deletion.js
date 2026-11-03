// Account deletion: instant delete, 30-day grace period (request / cancel / purge), and the data export.
// Everything that touches several tables runs in ONE transaction, and starts by locking the user's listings
// (SELECT ... FOR UPDATE). The booking trigger takes FOR SHARE on the listing, so nobody can book one of these
// listings between our "no active bookings" check and the delete.
const pool = require('../db');
const supabaseAdmin = require('../supabaseAdmin');
const storage = require('./storage');
const { ApiError, notConfigured } = require('../errors');

const GRACE_DAYS = Math.min(Math.max(parseInt(process.env.DELETION_GRACE_DAYS, 10) || 30, 1), 90);
const DAY_MS = 24 * 3600 * 1000;

const scheduledFor = (requestedAt) => (requestedAt ? new Date(new Date(requestedAt).getTime() + GRACE_DAYS * DAY_MS).toISOString() : null);

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

// lock the profile row (one deletion at a time per user) and the user's listings (no new bookings meanwhile)
async function lockAccount(client, uid) {
  const p = await client.query('SELECT id, deletion_requested_at FROM profiles WHERE id = $1 FOR UPDATE', [uid]);
  await client.query('SELECT id FROM listings WHERE owner_id = $1 ORDER BY id FOR UPDATE', [uid]);
  return p.rows[0] || null;
}

// someone has a future confirmed booking on one of this user's listings -> not allowed yet
async function assertNoActiveBookings(client, uid) {
  const active = await client.query(
    `SELECT 1 FROM bookings b JOIN listings l ON l.id = b.listing_id
     WHERE l.owner_id = $1 AND b.status = 'confirmed' AND b.end_time > now() LIMIT 1`, [uid]);
  if (active.rowCount) {
    throw new ApiError(409, 'ACCOUNT_HAS_ACTIVE_BOOKINGS',
      'Other users have upcoming bookings on your listings. Pause the listings and try again after those bookings end.');
  }
}

// ---- grace period -----------------------------------------------------------------------------------------------
async function requestDeletion(uid) {
  return withTransaction(async (client) => {
    const profile = await lockAccount(client, uid);
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Account not found');
    if (profile.deletion_requested_at) {                                  // already requested: idempotent
      return { deletion_requested_at: profile.deletion_requested_at, deletion_scheduled_for: scheduledFor(profile.deletion_requested_at) };
    }
    await assertNoActiveBookings(client, uid);
    // pause only what is active now, and remember it, so "restore" can switch exactly those back on
    await client.query('UPDATE listings SET is_active = false, paused_for_deletion = true WHERE owner_id = $1 AND is_active = true', [uid]);
    const upd = await client.query('UPDATE profiles SET deletion_requested_at = now() WHERE id = $1 RETURNING deletion_requested_at', [uid]);
    await client.query(`INSERT INTO account_deletion_log (user_id, method) VALUES ($1, 'grace_period')`, [uid]);
    const at = upd.rows[0].deletion_requested_at;
    return { deletion_requested_at: at, deletion_scheduled_for: scheduledFor(at) };
  });
}

async function cancelDeletion(uid) {
  return withTransaction(async (client) => {
    const profile = await lockAccount(client, uid);
    if (!profile || !profile.deletion_requested_at) return { restored: false };   // nothing to cancel: idempotent
    await client.query('UPDATE profiles SET deletion_requested_at = NULL WHERE id = $1', [uid]);
    await client.query('UPDATE listings SET is_active = true, paused_for_deletion = false WHERE owner_id = $1 AND paused_for_deletion', [uid]);
    await client.query(
      `UPDATE account_deletion_log SET cancelled_at = now()
       WHERE user_id = $1 AND completed_at IS NULL AND cancelled_at IS NULL`, [uid]);
    return { restored: true };
  });
}

// ---- the actual deletion ----------------------------------------------------------------------------------------
// method: 'immediate' (user pressed delete) | 'grace_period' (the daily job after the waiting time)
async function deleteAccount(uid, { method = 'immediate' } = {}) {
  if (!supabaseAdmin) throw notConfigured('Account deletion is not available right now');

  // photo files live in Storage, not in the database: remember their paths before the rows cascade away
  const photoPaths = (await pool.query(
    `SELECT p.storage_path FROM listing_photos p JOIN listings l ON l.id = p.listing_id WHERE l.owner_id = $1`, [uid]))
    .rows.map((r) => r.storage_path);

  const logId = await withTransaction(async (client) => {
    await lockAccount(client, uid);
    await assertNoActiveBookings(client, uid);

    // 1) the user's own bookings as a driver go away with them
    await client.query('DELETE FROM bookings WHERE user_id = $1', [uid]);
    // 2) other people's bookings on this user's listings STAY (their history, maybe their payment records):
    //    copy what the driver needs to recognise the booking, then the listing delete detaches them (ON DELETE SET NULL)
    await client.query(
      `UPDATE bookings b
       SET listing_snapshot = jsonb_build_object('title', l.title, 'address', l.address,
                                                 'price_per_hour', l.price_per_hour, 'listing_removed', true)
       FROM listings l
       WHERE b.listing_id = l.id AND l.owner_id = $1`, [uid]);
    await client.query('UPDATE listings SET reviewed_by = NULL WHERE reviewed_by = $1', [uid]);
    await client.query('DELETE FROM listings WHERE owner_id = $1', [uid]);        // availability and photo rows cascade

    // audit trail: reuse the row opened by the grace-period request, or create one for an instant delete
    const open = await client.query(
      `SELECT id FROM account_deletion_log WHERE user_id = $1 AND completed_at IS NULL AND cancelled_at IS NULL
       ORDER BY requested_at DESC LIMIT 1`, [uid]);
    if (open.rows[0]) {
      await client.query('UPDATE account_deletion_log SET method = $2 WHERE id = $1', [open.rows[0].id, method]);
      return open.rows[0].id;
    }
    const ins = await client.query(`INSERT INTO account_deletion_log (user_id, method) VALUES ($1, $2) RETURNING id`, [uid, method]);
    return ins.rows[0].id;
  });

  await storage.removePhotos(photoPaths); // best effort, never blocks the deletion

  // removes the login; the profiles row is removed by ON DELETE CASCADE
  const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
  if (error) {
    console.error('deleteUser failed:', error.message);
    throw new ApiError(500, 'INTERNAL_ERROR', 'Could not finish deleting the account, please try again');
  }
  try {
    await pool.query('UPDATE account_deletion_log SET completed_at = now() WHERE id = $1', [logId]);
  } catch (e) {
    console.error('deletion log update failed:', e.message);                    // the account IS gone; never turn that into an error
  }
  return { deleted: true };
}

// daily job: finish every account whose waiting time is over
async function purgeExpired({ limit = 50 } = {}) {
  const due = await pool.query(
    `SELECT id FROM profiles
     WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at < now() - make_interval(days => $1::int)
     ORDER BY deletion_requested_at LIMIT $2`, [GRACE_DAYS, limit]);
  const result = { due: due.rows.length, deleted: 0, skipped: [], failed: [] };
  for (const { id } of due.rows) {
    try {
      await deleteAccount(id, { method: 'grace_period' });
      result.deleted += 1;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) result.skipped.push({ id, reason: e.code });   // still has future bookings: try again tomorrow
      else { console.error('purge failed for', id, e.message); result.failed.push({ id, error: e.message }); }
    }
  }
  return result;
}

// ---- data export (everything the user can see about themselves) -------------------------------------------------
async function exportData(user) {
  const uid = user.id;
  const q = async (sql) => (await pool.query(sql, [uid])).rows;
  const [profile] = await q('SELECT id, full_name, phone, is_admin, created_at, deletion_requested_at FROM profiles WHERE id = $1');
  const listings = await q('SELECT * FROM listings WHERE owner_id = $1 ORDER BY created_at');
  const availability = await q(
    `SELECT a.listing_id, a.day_of_week, a.open_time, a.close_time FROM availability a
     JOIN listings l ON l.id = a.listing_id WHERE l.owner_id = $1 ORDER BY a.listing_id, a.day_of_week`);
  const photos = await q(                                   // metadata only: the files themselves are not included, storage paths are internal
    `SELECT p.id, p.listing_id, p.content_type, p.size_bytes, p.capture_latitude, p.capture_longitude, p.captured_at,
            p.uploaded_at, p.review_status, p.review_note, p.is_primary
     FROM listing_photos p JOIN listings l ON l.id = p.listing_id WHERE l.owner_id = $1 ORDER BY p.uploaded_at`);
  const myBookings = await q(
    `SELECT b.id, b.listing_id, b.start_time, b.end_time, b.total_price, b.status, b.payment_status, b.created_at,
            json_build_object('title', COALESCE(l.title, b.listing_snapshot->>'title'),
                              'address', COALESCE(l.address, b.listing_snapshot->>'address'),
                              'listing_removed', (b.listing_id IS NULL)) AS listing
     FROM bookings b LEFT JOIN listings l ON l.id = b.listing_id WHERE b.user_id = $1 ORDER BY b.start_time DESC`);
  const bookingsOnMyListings = await q(                      // other people appear only by display name
    `SELECT b.id, b.listing_id, b.start_time, b.end_time, b.total_price, b.status, b.payment_status,
            COALESCE(p.full_name, 'ParkMate user') AS consumer_display_name
     FROM bookings b JOIN listings l ON l.id = b.listing_id JOIN profiles p ON p.id = b.user_id
     WHERE l.owner_id = $1 ORDER BY b.start_time DESC`);
  return {
    exported_at: new Date().toISOString(),
    profile: { ...profile, email: user.email },
    listings, availability, photos,
    bookings: myBookings,
    bookings_on_my_listings: bookingsOnMyListings,
  };
}

module.exports = { GRACE_DAYS, scheduledFor, requestDeletion, cancelDeletion, deleteAccount, purgeExpired, exportData };
