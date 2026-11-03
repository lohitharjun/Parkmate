// One place that answers "can this user book this listing for this window?". Used by
//   GET  /api/listings/:id/availability-check  (read-only answer for the UI)
//   POST /api/bookings                          (re-check on the server right before inserting)
// The checks and their ORDER mirror the database trigger (bookings_before_insert) and the EXCLUDE constraint, which
// stay the final authority: if two requests race past this check, the database still lets exactly one win.
const { ApiError } = require('../errors');

const MESSAGES = {
  LISTING_NOT_FOUND: 'Listing not found',
  LISTING_NOT_APPROVED: 'This listing has not been approved yet',
  LISTING_PAUSED: 'This listing is paused by its owner',
  OWN_LISTING: 'You cannot book your own listing',
  OUTSIDE_AVAILABLE_HOURS: "The requested time is outside the listing's available hours",
  SLOT_TAKEN: 'Slot already booked',
};
// reason -> [HTTP status, contract error code]
const HTTP = {
  LISTING_NOT_FOUND: [404, 'NOT_FOUND'],
  LISTING_NOT_APPROVED: [422, 'LISTING_NOT_BOOKABLE'],
  LISTING_PAUSED: [422, 'LISTING_NOT_BOOKABLE'],
  OWN_LISTING: [403, 'FORBIDDEN'],
  OUTSIDE_AVAILABLE_HOURS: [422, 'LISTING_NOT_BOOKABLE'],
  SLOT_TAKEN: [409, 'BOOKING_CONFLICT'],
};

const SQL = `
  SELECT l.id, l.owner_id, l.status, l.is_active, l.price_per_hour, l.latitude, l.longitude,
         public.listing_is_open(l.id, $2::timestamptz, $3::timestamptz) AS is_open,
         EXISTS (SELECT 1 FROM bookings b
                 WHERE b.listing_id = l.id AND b.status = 'confirmed'
                   AND tstzrange(b.start_time, b.end_time) && tstzrange($2::timestamptz, $3::timestamptz)) AS is_taken
  FROM listings l WHERE l.id = $1`;

// db: pg Pool/Client. start/end: Date objects (already validated). userId: null for anonymous callers.
async function checkSlot(db, { listingId, start, end, userId = null }) {
  const { rows } = await db.query(SQL, [listingId, start.toISOString(), end.toISOString()]);
  const l = rows[0];
  let reason = null;
  if (!l) reason = 'LISTING_NOT_FOUND';
  else if (l.status !== 'approved') reason = 'LISTING_NOT_APPROVED';
  else if (!l.is_active) reason = 'LISTING_PAUSED';
  else if (userId && l.owner_id === userId) reason = 'OWN_LISTING';
  else if (!l.is_open) reason = 'OUTSIDE_AVAILABLE_HOURS';
  else if (l.is_taken) reason = 'SLOT_TAKEN';

  const available = reason === null;
  const hours = (end - start) / 3600000;
  return {
    available,
    reason,
    message: available ? null : MESSAGES[reason],
    listing: l || null,
    estimatedTotalPrice: available ? Math.round(Number(l.price_per_hour) * hours * 100) / 100 : null,
    toError() {
      const [status, code] = HTTP[reason];
      return new ApiError(status, code, MESSAGES[reason], reason);
    },
  };
}

module.exports = { checkSlot, MESSAGES };
