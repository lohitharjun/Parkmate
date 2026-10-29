import { vehicleFitsListing } from './bookingRules.js';

export function searchListings(listings, filters = {}) {
  const needle = String(filters.query ?? '').trim().toLocaleLowerCase();
  const maxPrice = filters.maxPrice === '' || filters.maxPrice == null ? Infinity : Number(filters.maxPrice);
  const vehicle = String(filters.vehicleType ?? '').trim();
  const results = (Array.isArray(listings) ? listings : []).filter((listing) => {
    const searchable = [listing.title, listing.address, listing.description, listing.vehicle_type]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
    const price = Number(listing.price_per_hour);
    const matchesQuery = !needle || searchable.includes(needle);
    const matchesPrice = Number.isFinite(price) && price <= maxPrice;
    const matchesVehicle = !vehicle || vehicleFitsListing(vehicle, listing.vehicle_type);
    const matchesAvailable = listing.is_active !== false && (!listing.status || listing.status === 'approved');
    return matchesQuery && matchesPrice && matchesVehicle && matchesAvailable;
  });

  if (filters.sort === 'price') {
    results.sort((a, b) => Number(a.price_per_hour) - Number(b.price_per_hour));
  } else if (filters.sort === 'distance') {
    results.sort((a, b) => distanceValue(a) - distanceValue(b));
  } else if (filters.sort === 'recommended') {
    results.sort((a, b) => recommendationScore(a) - recommendationScore(b));
  }
  return results;
}

function distanceValue(listing) {
  if (listing.distance_km == null || listing.distance_km === '') return Number.POSITIVE_INFINITY;
  const value = Number(listing.distance_km);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function recommendationScore(listing) {
  return Number(listing.price_per_hour || 0) + distanceValue(listing) * 18;
}

export function validateBookingWindow({ start, end, now = new Date() } = {}) {
  if (!start || !end) return { ok: false, error: 'Choose a start and end time.' };
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { ok: false, error: 'Enter a valid start and end time.' };
  }
  if (startDate.getTime() < now.getTime()) return { ok: false, error: 'Start time cannot be in the past.' };
  if (endDate.getTime() <= startDate.getTime()) return { ok: false, error: 'End time must be after the start time.' };
  const hours = (endDate.getTime() - startDate.getTime()) / 3_600_000;
  if (hours > 24) return { ok: false, error: 'A booking can be no longer than 24 hours.' };
  return {
    ok: true,
    start: startDate,
    end: endDate,
    startISO: startDate.toISOString(),
    endISO: endDate.toISOString(),
    hours,
  };
}

export function toLocalDateTimeInput(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  const adjusted = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

export function getDefaultWindow(now = new Date()) {
  const start = new Date(now.getTime());
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { start: toLocalDateTimeInput(start), end: toLocalDateTimeInput(end) };
}

export function formatINR(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDateTime(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  }).format(date);
}
