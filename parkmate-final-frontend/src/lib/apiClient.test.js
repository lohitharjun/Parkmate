import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let api;
let fetchMock;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_API_BASE_URL', 'https://parkmate-api.example');
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  api = await import('./apiClient.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastRequest() {
  const [url, options] = fetchMock.mock.calls.at(-1);
  return { url: new URL(url), options };
}

describe('ParkMate API contract adapter', () => {
  it('uses only documented listing search keys under the /api prefix', async () => {
    await api.getListings({
      query: 'Guindy',
      vehicle_type: 'sedan',
      max_price: 60,
      lat: 13.0067,
      lng: 80.2206,
      start: '2026-10-27T08:00:00.000Z',
      end: '2026-10-27T10:00:00.000Z',
      sort: 'price',
      signal: new AbortController().signal,
    });
    const { url, options } = lastRequest();
    expect(url.origin).toBe('https://parkmate-api.example');
    expect(url.pathname).toBe('/api/listings');
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      query: 'Guindy',
      vehicle_type: 'sedan',
      max_price: '60',
      lat: '13.0067',
      lng: '80.2206',
      start: '2026-10-27T08:00:00.000Z',
      end: '2026-10-27T10:00:00.000Z',
      sort: 'price',
    });
    expect(options.method).toBe('GET');
  });

  it('omits recommended sorting when the live search has no coordinates', async () => {
    await api.getListings({ sort: 'recommended' });
    const { url } = lastRequest();
    expect(url.pathname).toBe('/api/listings');
    expect(url.searchParams.has('sort')).toBe(false);
  });

  it('sends the exact documented booking body and Supabase bearer token', async () => {
    await api.createBooking('supabase-test-access-token', {
      listing_id: 'listing-uuid',
      start_time: '2026-10-27T08:00:00.000Z',
      end_time: '2026-10-27T10:00:00.000Z',
    });
    const { url, options } = lastRequest();
    expect(url.pathname).toBe('/api/bookings');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer supabase-test-access-token');
    expect(JSON.parse(options.body)).toEqual({
      listing_id: 'listing-uuid',
      start_time: '2026-10-27T08:00:00.000Z',
      end_time: '2026-10-27T10:00:00.000Z',
    });
  });

  it('sends only documented Parking Rescue query parameters', async () => {
    await api.getAlternatives('supabase-test-access-token', {
      lat: 13.0067,
      lng: 80.2206,
      start: '2026-10-27T08:00:00.000Z',
      end: '2026-10-27T10:00:00.000Z',
      exclude_listing_id: 'listing-uuid',
      max_price: 60,
      radius_km: 5,
    });
    const { url, options } = lastRequest();
    expect(url.pathname).toBe('/api/alternatives');
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      lat: '13.0067',
      lng: '80.2206',
      start: '2026-10-27T08:00:00.000Z',
      end: '2026-10-27T10:00:00.000Z',
      exclude_listing_id: 'listing-uuid',
      max_price: '60',
      radius_km: '5',
    });
    expect(options.headers.Authorization).toBe('Bearer supabase-test-access-token');
  });

  it('requests empty-search alternatives without inventing an excluded listing', async () => {
    await api.getAlternatives('supabase-test-access-token', {
      lat: 13.0067,
      lng: 80.2206,
      start: '2026-10-27T08:00:00.000Z',
      end: '2026-10-27T10:00:00.000Z',
    });
    const { url } = lastRequest();
    expect(url.pathname).toBe('/api/alternatives');
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      lat: '13.0067',
      lng: '80.2206',
      start: '2026-10-27T08:00:00.000Z',
      end: '2026-10-27T10:00:00.000Z',
    });
  });

  it('checks the flat /health payload documented by the Express app', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', db: 'up', time: '2026-10-27T00:00:00.000Z' }),
    });
    await expect(api.checkBackendHealth()).resolves.toMatchObject({ status: 'ok', db: 'up' });
    const { url, options } = lastRequest();
    expect(url.pathname).toBe('/health');
    expect(options.headers.Accept).toBe('application/json');
  });
});
