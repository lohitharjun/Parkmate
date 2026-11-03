export const BOOKING_VEHICLE_OPTIONS = [
  { value: 'two-wheeler', label: 'Two-wheeler' },
  { value: 'compact', label: 'Compact car' },
  { value: 'hatchback', label: 'Hatchback' },
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: 'van', label: 'Van / larger vehicle' },
];

const vehicleTerms = {
  'two-wheeler': ['two wheeler', 'two wheeled', 'motorcycle', 'motorbike', 'scooter', 'bike'],
  compact: ['compact', 'small car'],
  hatchback: ['hatchback'],
  sedan: ['sedan'],
  suv: ['suv', 'sport utility vehicle'],
  van: ['van', 'minivan', 'pickup', 'truck'],
};

function words(value) {
  return String(value ?? '').toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function containsPhrase(haystack, phrase) {
  const source = words(haystack);
  const target = words(phrase);
  return target.length > 0 && source.some((_, index) => target.every((word, offset) => source[index + offset] === word));
}

export function normalizeVehicleType(value) {
  const normalized = words(value).join(' ');
  if (!normalized) return '';
  for (const option of BOOKING_VEHICLE_OPTIONS) {
    if (option.value === normalized || vehicleTerms[option.value].some((term) => containsPhrase(normalized, term))) {
      return option.value;
    }
  }
  return '';
}

export function vehicleFitsListing(selectedVehicle, listingFit) {
  const selected = normalizeVehicleType(selectedVehicle);
  if (!selected) return false;
  const fitText = String(listingFit ?? '').trim();
  if (!fitText) return true;
  const supported = BOOKING_VEHICLE_OPTIONS
    .filter((option) => vehicleTerms[option.value].some((term) => containsPhrase(fitText, term)) || containsPhrase(fitText, option.value))
    .map((option) => option.value);
  // Older provider-entered fit notes may be free text. Do not reject a vehicle when no known class is stated.
  return supported.length === 0 || supported.includes(selected);
}

export function localDayKey(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function listingIdOf(booking) {
  const id = booking?.listing_id ?? booking?.listing?.id;
  return id == null ? '' : String(id);
}

function ownerIdOf(booking) {
  const id = booking?.consumer_id ?? booking?.user_id ?? booking?.consumer?.id ?? booking?.user?.id;
  return id == null ? '' : String(id);
}

function belongsToUser(booking, userId) {
  if (!userId) return true;
  const ownerId = ownerIdOf(booking);
  // Older local-demo rows were browser-scoped and do not contain a user ID.
  return !ownerId || ownerId === String(userId);
}

function statusOf(booking) {
  return String(booking?.status ?? '').trim().toLowerCase();
}

function isRejected(booking) {
  return ['rejected', 'declined', 'failed'].includes(statusOf(booking));
}

function isCurrentlyHolding(booking) {
  return !['cancelled', 'canceled', 'rejected', 'declined', 'failed', 'completed', 'complete'].includes(statusOf(booking));
}

export function hasSameDayBooking(bookings, listingId, dateValue, userId) {
  const targetDay = localDayKey(dateValue);
  if (!targetDay || listingId == null) return false;
  return (Array.isArray(bookings) ? bookings : []).some((booking) => (
    listingIdOf(booking) === String(listingId)
    && localDayKey(booking?.start_time) === targetDay
    && !isRejected(booking)
    && belongsToUser(booking, userId)
  ));
}

export function blockedListingIds(bookings, { selectedDate, userId, now = new Date() } = {}) {
  const selectedDay = localDayKey(selectedDate);
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const blocked = new Set();
  for (const booking of Array.isArray(bookings) ? bookings : []) {
    const id = listingIdOf(booking);
    if (!id || isRejected(booking) || !belongsToUser(booking, userId)) continue;
    if (selectedDay) {
      // A canceled attempt releases the space generally, but the same consumer still books a listing only once per day.
      if (localDayKey(booking.start_time) === selectedDay) blocked.add(id);
      continue;
    }
    if (!isCurrentlyHolding(booking)) continue;
    const end = new Date(booking.end_time ?? booking.start_time).getTime();
    if (Number.isFinite(end) && end >= nowTime) blocked.add(id);
  }
  return blocked;
}

export function filterListingsByBookings(listings, bookings, options = {}) {
  const blocked = blockedListingIds(bookings, options);
  return (Array.isArray(listings) ? listings : []).filter((listing) => !blocked.has(String(listing.id)));
}

export function dedupeActiveBookings(bookings) {
  const rows = Array.isArray(bookings) ? bookings : [];
  const seenIds = new Set();
  const seenActiveDays = new Set();
  const result = [];
  for (const booking of rows) {
    const id = booking?.id == null ? '' : String(booking.id);
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    const listingId = listingIdOf(booking);
    const day = localDayKey(booking?.start_time);
    if (listingId && day && isCurrentlyHolding(booking)) {
      const key = `${ownerIdOf(booking) || 'legacy'}|${listingId}|${day}`;
      if (seenActiveDays.has(key)) continue;
      seenActiveDays.add(key);
    }
    result.push(booking);
  }
  return result;
}
