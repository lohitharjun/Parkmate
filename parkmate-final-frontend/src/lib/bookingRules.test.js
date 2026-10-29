import { describe, expect, it } from 'vitest';
import {
  blockedListingIds,
  dedupeActiveBookings,
  filterListingsByBookings,
  hasSameDayBooking,
  localDayKey,
  vehicleFitsListing,
} from './bookingRules.js';

const userBookings = [
  {
    id: 'booking-1',
    listing_id: 'space-a',
    user_id: 'consumer-a',
    start_time: '2026-10-27T10:00:00.000Z',
    end_time: '2026-10-27T12:00:00.000Z',
    status: 'confirmed',
  },
];

describe('vehicle fit preflight', () => {
  it('accepts a selected type explicitly supported by a listing', () => {
    expect(vehicleFitsListing('hatchback', 'Compact, hatchback')).toBe(true);
    expect(vehicleFitsListing('suv', 'Sedan, SUV')).toBe(true);
  });

  it('rejects a known class mismatch and requires a selection', () => {
    expect(vehicleFitsListing('suv', 'Compact, hatchback')).toBe(false);
    expect(vehicleFitsListing('', 'Sedan, SUV')).toBe(false);
  });

  it('does not block a listing whose fit is not specified in legacy free text', () => {
    expect(vehicleFitsListing('sedan', '')).toBe(true);
    expect(vehicleFitsListing('sedan', 'car fits; check host notes')).toBe(true);
  });
});

describe('local calendar day booking rules', () => {
  it('uses the consumer local calendar day for date-only and timestamp inputs', () => {
    expect(localDayKey('2026-10-27')).toBe('2026-10-27');
    const timestamp = new Date('2026-10-27T12:00:00.000Z');
    const localExpected = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}`;
    expect(localDayKey(timestamp)).toBe(localExpected);
  });

  it('blocks a second booking for the same listing and consumer on the same day only', () => {
    expect(hasSameDayBooking(userBookings, 'space-a', '2026-10-27T15:00', 'consumer-a')).toBe(true);
    expect(hasSameDayBooking(userBookings, 'space-a', '2026-10-28T15:00', 'consumer-a')).toBe(false);
    expect(hasSameDayBooking(userBookings, 'space-a', '2026-10-27T15:00', 'consumer-b')).toBe(false);
  });

  it('holds the listing from a matching-day search and from an undated search while the reservation is active', () => {
    expect([...blockedListingIds(userBookings, {
      selectedDate: '2026-10-27T15:00', userId: 'consumer-a', now: new Date('2026-10-26T12:00:00.000Z'),
    })]).toEqual(['space-a']);
    expect([...blockedListingIds(userBookings, {
      userId: 'consumer-a', now: new Date('2026-10-26T12:00:00.000Z'),
    })]).toEqual(['space-a']);
    expect([...blockedListingIds(userBookings, {
      selectedDate: '2026-10-28T15:00', userId: 'consumer-a', now: new Date('2026-10-26T12:00:00.000Z'),
    })]).toEqual([]);
  });

  it('releases canceled records from default availability while retaining the one-booking-per-day guard', () => {
    const canceled = [{ ...userBookings[0], status: 'cancelled' }];
    expect(hasSameDayBooking(canceled, 'space-a', '2026-10-27T15:00', 'consumer-a')).toBe(true);
    expect([...blockedListingIds(canceled, {
      selectedDate: '2026-10-27T15:00', userId: 'consumer-a', now: new Date('2026-10-26T12:00:00.000Z'),
    })]).toEqual(['space-a']);
    expect([...blockedListingIds(canceled, {
      userId: 'consumer-a', now: new Date('2026-10-26T12:00:00.000Z'),
    })]).toEqual([]);
  });

  it('filters listings without mutating the original inventory', () => {
    const inventory = [{ id: 'space-a' }, { id: 'space-b' }];
    expect(filterListingsByBookings(inventory, userBookings, {
      selectedDate: '2026-10-27T15:00', userId: 'consumer-a',
    }).map((row) => row.id)).toEqual(['space-b']);
    expect(inventory).toHaveLength(2);
  });
});

describe('My Bookings duplicate cleanup', () => {
  it('shows one active row per listing and local day while preserving canceled history', () => {
    const rows = [
      ...userBookings,
      { ...userBookings[0], id: 'duplicate-active', start_time: '2026-10-27T13:00:00.000Z' },
      { ...userBookings[0], id: 'canceled-history', status: 'cancelled' },
    ];
    const visible = dedupeActiveBookings(rows);
    expect(visible.map((row) => row.id)).toEqual(['booking-1', 'canceled-history']);
  });
});
