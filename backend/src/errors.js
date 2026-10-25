class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (m) => new ApiError(400, 'VALIDATION_ERROR', m);
const unauth = (m = 'Missing or invalid token') => new ApiError(401, 'UNAUTHENTICATED', m);
const forbidden = (m = 'You are not allowed to do this') => new ApiError(403, 'FORBIDDEN', m);
const notFound = (m = 'Not found') => new ApiError(404, 'NOT_FOUND', m);
const conflict = (m = 'Slot already booked') => new ApiError(409, 'BOOKING_CONFLICT', m);
const notBookable = (m = 'Listing is not approved, or is paused') => new ApiError(422, 'LISTING_NOT_BOOKABLE', m);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, bad, unauth, forbidden, notFound, conflict, notBookable, wrap };
