// Demo-mode stand-in for GET /listings/:id/availability-check, so the booking panel behaves the same
// as in live mode. It uses only data held in this browser; the real server stays the authority.
const STEP_MS = 15 * 60 * 1000;
const toMinutes = (value) => { const [h, m] = String(value || '0:0').split(':'); return Number(h) * 60 + Number(m || 0); };

function insideOpeningHours(windows, start, end) {
  if (!Array.isArray(windows) || windows.length === 0) return true; // no windows means open 24×7
  for (let t = start.getTime(); t < end.getTime(); t += STEP_MS) {
    const moment = new Date(t);
    const minutes = moment.getHours() * 60 + moment.getMinutes();
    const open = windows.some((w) => Number(w.day_of_week) === moment.getDay() && minutes >= toMinutes(w.open_time) && minutes < toMinutes(w.close_time));
    if (!open) return false;
  }
  return true;
}

export function mockAvailabilityCheck(listing, bookings, startISO, endISO) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const hours = (end - start) / 3_600_000;
  const base = { hours, estimated_total_price: Number((Number(listing.price_per_hour) * hours).toFixed(2)), is_demo: true };
  if ((listing.status && listing.status !== 'approved') || listing.is_active === false) return { ...base, available: false, reason: 'LISTING_NOT_BOOKABLE' };
  if (!insideOpeningHours(listing.availability, start, end)) return { ...base, available: false, reason: 'OUTSIDE_AVAILABLE_HOURS' };
  const taken = (Array.isArray(bookings) ? bookings : []).some((booking) => (
    String(booking.listing_id) === String(listing.id)
    && !['cancelled', 'canceled', 'rejected', 'failed'].includes(String(booking.status).toLowerCase())
    && start < new Date(booking.end_time) && end > new Date(booking.start_time)
  ));
  if (taken) return { ...base, available: false, reason: 'SLOT_TAKEN' };
  return { ...base, available: true };
}
