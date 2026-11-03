import { runtimeConfig } from './runtime.js';
import { friendlyApiError } from './errors.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = null, reason = null, context = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.reason = reason; // precise cause, e.g. SLOT_TAKEN; code and status never change
    this.context = context; // 'photo' for photo endpoints, so 502/503 can say "storage"
    this.details = details;
  }
}

function apiUrl(path, query) {
  if (!runtimeConfig.apiBaseUrl) throw new ApiError('The backend API base URL is not configured.', { code: 'CONFIGURATION_ERROR' });
  const url = new URL(`/api${path.startsWith('/') ? path : `/${path}`}`, runtimeConfig.apiBaseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request(path, { method = 'GET', token, body, query, signal } = {}) {
  const headers = { Accept: 'application/json' };
  // FormData (photo uploads) must go out untouched so the browser sets the multipart boundary itself.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  // A File/Blob goes out as the raw body with its own content type (photo upload).
  const isRaw = typeof Blob !== 'undefined' && body instanceof Blob;
  if (isRaw) headers['Content-Type'] = body.type || 'application/octet-stream';
  else if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const context = /\/photos(\/|$)/.test(path) ? 'photo' : null;
  let response;
  try {
    response = await fetch(apiUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : (isForm || isRaw) ? body : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('We couldn’t reach ParkMate. Check your internet connection and try again.', { code: 'NETWORK_ERROR' });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The contract expects JSON. Preserve the HTTP status if a proxy returns a non-JSON error.
  }
  if (!response.ok) {
    const problem = payload?.error || {};
    const info = { status: response.status, code: problem.code || 'HTTP_ERROR', reason: problem.reason || problem.details?.reason || null, context };
    // Same code and status as before; the message is now chosen from the precise reason when there is one.
    throw new ApiError(friendlyApiError({ ...info, message: problem.message }), { ...info, details: problem });
  }
  if (!payload || !Object.hasOwn(payload, 'data')) {
    throw new ApiError('The backend returned a response outside the documented data envelope.', {
      status: response.status,
      code: 'INVALID_RESPONSE',
    });
  }
  return payload.data;
}

export async function checkBackendHealth() {
  if (!runtimeConfig.apiBaseUrl) throw new ApiError('The backend API base URL is not configured.', { code: 'CONFIGURATION_ERROR' });
  let response;
  try {
    response = await fetch(new URL('/health', runtimeConfig.apiBaseUrl), { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError('Could not reach the ParkMate health endpoint.', { code: 'NETWORK_ERROR' });
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('The ParkMate health endpoint did not return JSON.', { status: response.status, code: 'INVALID_RESPONSE' });
  }
  if (!response.ok || payload?.status !== 'ok' || payload?.db !== 'up') {
    throw new ApiError('ParkMate backend or database health check failed.', {
      status: response.status,
      code: 'HEALTH_CHECK_FAILED',
      details: payload,
    });
  }
  return payload;
}

export function deleteMyAccount(token) {
  return request('/me', { method: 'DELETE', token, body: { confirm: 'DELETE' } });
}

export function getMe(token) {
  return request('/me', { token });
}

export function getListings({ query, vehicle_type, max_price, lat, lng, max_distance_km, start, end, sort, signal } = {}) {
  const hasCoordinates = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const params = {
    query,
    vehicle_type,
    max_price,
    start,
    end,
    ...(hasCoordinates ? { lat, lng, max_distance_km } : {}),
    ...(['price'].includes(sort) ? { sort } : {}),
    ...(['recommended', 'distance'].includes(sort) && hasCoordinates ? { sort } : {}),
  };
  return request('/listings', { query: params, signal });
}

export function getListing(id, token) {
  return request(`/listings/${encodeURIComponent(id)}`, { token });
}

export function createListing(token, payload) {
  return request('/listings', { method: 'POST', token, body: payload });
}

export function patchListing(token, id, payload) {
  return request(`/listings/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: payload });
}

export function getMyListings(token) {
  return request('/listings/mine', { token });
}

export function confirmListing(token, id) {
  return request(`/listings/${encodeURIComponent(id)}/confirm`, { method: 'POST', token });
}

export function updateListingAvailability(token, id, windows) {
  return request(`/listings/${encodeURIComponent(id)}/availability`, {
    method: 'PUT',
    token,
    body: { windows },
  });
}

export function createBooking(token, { listing_id, start_time, end_time }) {
  return request('/bookings', { method: 'POST', token, body: { listing_id, start_time, end_time } });
}

export function getMyBookings(token, status) {
  return request('/bookings/mine', { token, query: { status } });
}

export function cancelBooking(token, id) {
  return request(`/bookings/${encodeURIComponent(id)}/cancel`, { method: 'PATCH', token });
}

export function getProviderBookings(token, listingId) {
  return request('/provider/bookings', { token, query: { listing_id: listingId } });
}

export function getAlternatives(token, { lat, lng, start, end, exclude_listing_id, max_price, radius_km }) {
  return request('/alternatives', {
    token,
    query: { lat, lng, start, end, exclude_listing_id, max_price, radius_km },
  });
}

/** Hint only: can this window be booked, and for how much? The booking POST remains the authority. */
export function getAvailabilityCheck(id, { start, end }, token, signal) {
  return request(`/listings/${encodeURIComponent(id)}/availability-check`, { token, query: { start, end }, signal });
}

export function getBooking(token, id) {
  return request(`/bookings/${encodeURIComponent(id)}`, { token });
}

// Photo upload: the file itself is the request body (not FormData); Content-Type is the file's type.
// capture_latitude / capture_longitude are sent only when the person allowed browser location.
// Response: { id, url, review_status: 'pending' | 'approved' | 'rejected', review_note, is_primary }.
export function uploadListingPhoto(token, listingId, file, location) {
  const hasLocation = location && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude));
  return request(`/listings/${encodeURIComponent(listingId)}/photos`, {
    method: 'POST',
    token,
    body: file,
    query: hasLocation ? { capture_latitude: location.latitude, capture_longitude: location.longitude } : undefined,
  });
}

export function setPrimaryListingPhoto(token, listingId, photoId) {
  return request(`/listings/${encodeURIComponent(listingId)}/photos/${encodeURIComponent(photoId)}`, { method: 'PATCH', token, body: { is_primary: true } });
}

export function deleteListingPhoto(token, listingId, photoId) {
  return request(`/listings/${encodeURIComponent(listingId)}/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE', token });
}
