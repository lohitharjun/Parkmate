// reason (optional) is a finer-grained machine-readable cause, e.g. SLOT_TAKEN or OUTSIDE_AVAILABLE_HOURS.
// The contract's `code` stays stable; clients that don't know `reason` can ignore it.
class ApiError extends Error {
  constructor(status, code, message, reason) {
    super(message);
    this.status = status;
    this.code = code;
    if (reason) this.reason = reason;
  }
}
const bad = (m) => new ApiError(400, 'VALIDATION_ERROR', m);
const unauth = (m = 'Missing or invalid token') => new ApiError(401, 'UNAUTHENTICATED', m);
const forbidden = (m = 'You are not allowed to do this', reason) => new ApiError(403, 'FORBIDDEN', m, reason);
const notFound = (m = 'Not found') => new ApiError(404, 'NOT_FOUND', m);
const conflict = (m = 'Slot already booked', reason) => new ApiError(409, 'BOOKING_CONFLICT', m, reason);
const notBookable = (m = 'Listing is not approved, or is paused', reason) => new ApiError(422, 'LISTING_NOT_BOOKABLE', m, reason);
const tooLarge = (m = 'File is too large') => new ApiError(413, 'FILE_TOO_LARGE', m);
const unsupportedType = (m = 'Unsupported file type') => new ApiError(415, 'UNSUPPORTED_FILE_TYPE', m);
const notConfigured = (m = 'This feature is not available right now') => new ApiError(503, 'NOT_CONFIGURED', m);
// 401, but NOT "your session expired": the user is logged in and only has to type the password again
const reauthRequired = (m = 'Please confirm your password again.') => new ApiError(401, 'REAUTH_REQUIRED', m);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, bad, unauth, forbidden, notFound, conflict, notBookable, tooLarge, unsupportedType, notConfigured, reauthRequired, wrap };
