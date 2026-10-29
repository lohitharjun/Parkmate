import { runtimeConfig } from './runtime.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(apiUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the ParkMate backend. Check the API URL and network.', { code: 'NETWORK_ERROR' });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The contract expects JSON. Preserve the HTTP status if a proxy returns a non-JSON error.
  }
  if (!response.ok) {
    const problem = payload?.error || {};
    throw new ApiError(problem.message || `ParkMate API request failed (${response.status}).`, {
      status: response.status,
      code: problem.code || 'HTTP_ERROR',
      details: problem,
    });
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

export function getMe(token) {
  return request('/me', { token });
}

export function getListings({ max_price, lat, lng, max_distance_km, start, end, sort, signal } = {}) {
  const hasCoordinates = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const query = {
    max_price,
    start,
    end,
    ...(hasCoordinates ? { lat, lng, max_distance_km } : {}),
    ...(['price'].includes(sort) ? { sort } : {}),
    ...(['recommended', 'distance'].includes(sort) && hasCoordinates ? { sort } : {}),
  };
  return request('/listings', { query, signal });
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
