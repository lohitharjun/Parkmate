const { bad } = require('../errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_BOOKING_MS = 24 * 3600 * 1000;

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function parseIso(v, field) {
  if (typeof v !== 'string' || !ISO_RE.test(v)) throw bad(`${field} must be an ISO 8601 time with timezone, e.g. 2026-10-25T09:00:00Z`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw bad(`${field} is not a valid time`);
  return d;
}

function num(v, field, { min, max, allowString = false } = {}) {
  const n = typeof v === 'string' && allowString && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(`${field} must be a number`);
  if (min !== undefined && n < min) throw bad(`${field} must be >= ${min}`);
  if (max !== undefined && n > max) throw bad(`${field} must be <= ${max}`);
  return n;
}

function validateBookingWindow(startRaw, endRaw, now = new Date()) {
  const start = parseIso(startRaw, 'start_time');
  const end = parseIso(endRaw, 'end_time');
  if (end <= start) throw bad('end_time must be after start_time');
  if (start < now) throw bad('start_time cannot be in the past');
  if (end - start > MAX_BOOKING_MS) throw bad('A booking cannot be longer than 24 hours');
  return { start, end };
}

const LISTING_FIELDS = ['title', 'address', 'latitude', 'longitude', 'price_per_hour'];
const LISTING_OPTIONAL = ['description', 'rules', 'vehicle_type'];

function str(v, field, max) {
  if (typeof v !== 'string' || v.trim() === '') throw bad(`${field} must be a non-empty string`);
  if (v.length > max) throw bad(`${field} must be at most ${max} characters`);
  return v.trim();
}

// optional text: '' or null clears it (stored as NULL)
function optText(v, field, max) {
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw bad(`${field} must be a string`);
  if (v.length > max) throw bad(`${field} must be at most ${max} characters`);
  return v.trim() === '' ? null : v.trim();
}

function urlList(v, field) {
  if (v === null) return [];
  if (!Array.isArray(v) || v.length > 10) throw bad(`${field} must be an array of at most 10 URLs`);
  return v.map((u, i) => {
    if (typeof u !== 'string' || u.length > 500 || !/^https?:\/\/\S+$/i.test(u)) throw bad(`${field}[${i}] must be an http(s) URL (max 500 chars)`);
    return u;
  });
}

// create: all required fields (+ optional inline availability). update: any subset (+ is_active).
function validateListingInput(body, { partial }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Request body must be a JSON object');
  const allowed = new Set([...LISTING_FIELDS, ...LISTING_OPTIONAL, 'evidence_urls', ...(partial ? ['is_active'] : ['availability'])]);
  for (const k of Object.keys(body)) {
    if (k === 'status') throw bad('status cannot be set; it is controlled by admin review');
    if (!allowed.has(k)) throw bad(`Field not allowed: ${k}`);
  }
  if (!partial) for (const f of LISTING_FIELDS) if (body[f] === undefined) throw bad(`${f} is required`);
  const out = {};
  if (body.title !== undefined) out.title = str(body.title, 'title', 120);
  if (body.address !== undefined) out.address = str(body.address, 'address', 300);
  if (body.latitude !== undefined) out.latitude = num(body.latitude, 'latitude', { min: -90, max: 90 });
  if (body.longitude !== undefined) out.longitude = num(body.longitude, 'longitude', { min: -180, max: 180 });
  if (body.price_per_hour !== undefined) {
    out.price_per_hour = num(body.price_per_hour, 'price_per_hour', { min: 0.01, max: 100000 });
    if (Math.round(out.price_per_hour * 100) / 100 !== out.price_per_hour) throw bad('price_per_hour can have at most 2 decimals');
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') throw bad('is_active must be true or false');
    out.is_active = body.is_active;
  }
  for (const f of LISTING_OPTIONAL) if (body[f] !== undefined) out[f] = optText(body[f], f, f === 'vehicle_type' ? 50 : 1000);
  if (body.evidence_urls !== undefined) out.evidence_urls = urlList(body.evidence_urls, 'evidence_urls');
  if (body.availability !== undefined) out.availability = validateAvailability(body.availability);
  if (partial && Object.keys(out).length === 0) throw bad('No updatable fields supplied');
  return out;
}

function validateAvailability(windows) {
  if (!Array.isArray(windows) || windows.length > 21) throw bad('windows must be an array (max 21)');
  const t = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
  return windows.map((w, i) => {
    if (!w || typeof w !== 'object') throw bad(`windows[${i}] must be an object`);
    const d = w.day_of_week;
    if (!Number.isInteger(d) || d < 0 || d > 6) throw bad(`windows[${i}].day_of_week must be 0 (Sun) to 6 (Sat)`);
    if (typeof w.open_time !== 'string' || !t.test(w.open_time)) throw bad(`windows[${i}].open_time must be HH:MM`);
    if (typeof w.close_time !== 'string' || !t.test(w.close_time)) throw bad(`windows[${i}].close_time must be HH:MM`);
    if (w.close_time <= w.open_time) throw bad(`windows[${i}].close_time must be after open_time`);
    return { day_of_week: d, open_time: w.open_time, close_time: w.close_time };
  });
}

module.exports = { isUuid, parseIso, num, validateBookingWindow, validateListingInput, validateAvailability, MAX_BOOKING_MS };
