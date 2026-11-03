import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { friendlyApiError, isSlotTaken, reasonMessage } from './errors.js';

describe('reason messages', () => {
  const cases = {
    SLOT_TAKEN: /slot/i,
    OUTSIDE_AVAILABLE_HOURS: /opening hours/i,
    LISTING_PAUSED: /paused/i,
    LISTING_NOT_APPROVED: /approved/i,
    OWN_LISTING: /own listing/i,
  };
  for (const [reason, pattern] of Object.entries(cases)) {
    it(`${reason} has its own message, whatever the code or status`, () => {
      expect(friendlyApiError({ status: 409, code: 'BOOKING_CONFLICT', reason })).toMatch(pattern);
      expect(friendlyApiError({ status: 422, code: 'LISTING_NOT_BOOKABLE', reason })).toMatch(pattern);
      expect(reasonMessage(reason.toLowerCase())).toMatch(pattern);
    });
  }
  it('old handling (code/status only) still works', () => {
    expect(friendlyApiError({ status: 409, code: 'BOOKING_CONFLICT' })).toMatch(/slot/i);
    expect(friendlyApiError({ status: 422, code: 'LISTING_NOT_BOOKABLE' })).toMatch(/can’t be booked/i);
  });
  it('only a taken slot opens the rescue flow', () => {
    expect(isSlotTaken({ reason: 'SLOT_TAKEN' })).toBe(true);
    expect(isSlotTaken({ code: 'BOOKING_CONFLICT' })).toBe(true);
    expect(isSlotTaken({ reason: 'LISTING_PAUSED', code: 'LISTING_NOT_BOOKABLE' })).toBe(false);
  });
});

describe('photo and service statuses', () => {
  it('413 too large, 415 wrong type', () => {
    expect(friendlyApiError({ status: 413 })).toMatch(/too large|10 MB/i);
    expect(friendlyApiError({ status: 415 })).toMatch(/JPG, PNG or WEBP/);
  });
  it('422 PHOTO_LIMIT_REACHED', () => {
    expect(friendlyApiError({ status: 422, code: 'PHOTO_LIMIT_REACHED', message: 'x' })).toMatch(/maximum number of photos/i);
  });
  it('502 / 503 on photo endpoints talk about storage', () => {
    expect(friendlyApiError({ status: 502, context: 'photo' })).toMatch(/storage/i);
    expect(friendlyApiError({ status: 503, code: 'NOT_CONFIGURED', context: 'photo' })).toMatch(/aren’t available|not available|later/i);
    expect(friendlyApiError({ status: 503 })).toMatch(/temporarily unavailable/i);
  });
  it('429 RATE_LIMITED', () => {
    expect(friendlyApiError({ status: 429, code: 'RATE_LIMITED' })).toMatch(/too fast/i);
    expect(friendlyApiError({ status: 429 })).toMatch(/too fast/i);
  });
});

describe('request shapes', () => {
  let api; let fetchMock;
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', 'https://parkmate-api.example');
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }));
    vi.stubGlobal('fetch', fetchMock);
    api = await import('./apiClient.js');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('booking body contains only listing and times — never price, status or payment', async () => {
    await api.createBooking('t', { listing_id: 'L1', start_time: 'a', end_time: 'b', total_price: 1, status: 'confirmed', payment_status: 'paid' });
    const body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
    expect(Object.keys(body).sort()).toEqual(['end_time', 'listing_id', 'start_time']);
  });
  it('availability-check is a GET with start and end', async () => {
    await api.getAvailabilityCheck('L1', { start: 's', end: 'e' }, 't');
    const [url, options] = fetchMock.mock.calls.at(-1);
    expect(new URL(url).pathname).toBe('/api/listings/L1/availability-check');
    expect(new URL(url).searchParams.get('start')).toBe('s');
    expect(options.method).toBe('GET');
  });
  it('photo upload sends the file itself as the body with its own content type', async () => {
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await api.uploadListingPhoto('t', 'L1', file, { latitude: 13.01, longitude: 80.22 });
    const [url, options] = fetchMock.mock.calls.at(-1);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/listings/L1/photos');
    expect(parsed.searchParams.get('capture_latitude')).toBe('13.01');
    expect(parsed.searchParams.get('capture_longitude')).toBe('80.22');
    expect(options.method).toBe('POST');
    expect(options.body).toBe(file);
    expect(options.headers['Content-Type']).toBe('image/jpeg');
    expect(options.headers.Authorization).toBe('Bearer t');
  });
  it('photo upload leaves out coordinates when location was not allowed', async () => {
    await api.uploadListingPhoto('t', 'L1', new File(['x'], 'a.png', { type: 'image/png' }), null);
    const [url] = fetchMock.mock.calls.at(-1);
    expect(new URL(url).search).toBe('');
  });
  it('setting the main photo sends { is_primary: true } as JSON', async () => {
    await api.setPrimaryListingPhoto('t', 'L1', 'P9');
    const [url, options] = fetchMock.mock.calls.at(-1);
    expect(new URL(url).pathname).toBe('/api/listings/L1/photos/P9');
    expect(options.method).toBe('PATCH');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({ is_primary: true });
  });
  it('errors carry the reason and the message follows it', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: { code: 'BOOKING_CONFLICT', reason: 'SLOT_TAKEN', message: 'conflict' } }) });
    const error = await api.createBooking('t', { listing_id: 'L1', start_time: 'a', end_time: 'b' }).catch((e) => e);
    expect(error.status).toBe(409);
    expect(error.code).toBe('BOOKING_CONFLICT');
    expect(error.reason).toBe('SLOT_TAKEN');
    expect(error.message).toMatch(/slot/i);
  });
});
