import { describe, expect, it } from 'vitest';
import { searchListings, validateBookingWindow } from './validation.js';

const listings = [
  { id: 'a', title: 'Guindy Metro Courtyard', address: 'Race Course Road', price_per_hour: 45, status: 'approved', is_active: true, vehicle_type: 'Sedan' },
  { id: 'b', title: 'Adyar Garden Lane', address: 'LB Road', price_per_hour: 55, status: 'approved', is_active: true, vehicle_type: 'Hatchback' },
];

describe('searchListings', () => {
  it('matches title and area case-insensitively', () => {
    expect(searchListings(listings, { query: 'gUiNdY' }).map((item) => item.id)).toEqual(['a']);
    expect(searchListings(listings, { query: 'lB ROAD' }).map((item) => item.id)).toEqual(['b']);
  });

  it('combines price, vehicle fit, and availability filters', () => {
    expect(searchListings(listings, { maxPrice: 50, vehicleType: 'sedan', availableOnly: true }).map((item) => item.id)).toEqual(['a']);
    expect(searchListings(listings, { vehicleType: 'suv' })).toHaveLength(0);
  });

  it('never exposes pending or paused listings in consumer results', () => {
    const rows = [
      ...listings,
      { id: 'pending', title: 'Pending driveway', price_per_hour: 10, status: 'pending', is_active: true },
      { id: 'paused', title: 'Paused driveway', price_per_hour: 10, status: 'approved', is_active: false },
    ];
    expect(searchListings(rows).map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('validateBookingWindow', () => {
  const now = new Date('2026-10-26T10:00:00Z');
  it('returns UTC ISO values for a valid window', () => {
    const result = validateBookingWindow({ start: '2026-10-26T12:00:00Z', end: '2026-10-26T14:00:00Z', now });
    expect(result.ok).toBe(true);
    expect(result.hours).toBe(2);
    expect(result.startISO).toBe('2026-10-26T12:00:00.000Z');
  });

  it('rejects past, reversed, and over-24-hour windows', () => {
    expect(validateBookingWindow({ start: '2026-10-26T09:00:00Z', end: '2026-10-26T11:00:00Z', now }).error).toMatch(/past/i);
    expect(validateBookingWindow({ start: '2026-10-26T12:00:00Z', end: '2026-10-26T11:00:00Z', now }).error).toMatch(/after/i);
    expect(validateBookingWindow({ start: '2026-10-26T12:00:00Z', end: '2026-10-27T13:00:00Z', now }).error).toMatch(/24 hours/i);
  });
});
