import { describe, expect, it } from 'vitest';
import { mockAvailabilityCheck } from './demoAvailability.js';

const listing = { id: 'L1', price_per_hour: 50, status: 'approved', is_active: true, availability: [] };
const start = '2030-01-07T10:00:00'; // a Monday, local time
const end = '2030-01-07T12:00:00';

describe('demo availability check', () => {
  it('is available and prices the window when nothing blocks it', () => {
    expect(mockAvailabilityCheck(listing, [], start, end)).toMatchObject({ available: true, estimated_total_price: 100 });
  });
  it('reports SLOT_TAKEN when an active booking overlaps, but not a cancelled one', () => {
    const booking = { listing_id: 'L1', status: 'confirmed', start_time: '2030-01-07T11:00:00', end_time: '2030-01-07T13:00:00' };
    expect(mockAvailabilityCheck(listing, [booking], start, end)).toMatchObject({ available: false, reason: 'SLOT_TAKEN' });
    expect(mockAvailabilityCheck(listing, [{ ...booking, status: 'cancelled' }], start, end).available).toBe(true);
  });
  it('reports hours outside the weekly windows', () => {
    const closed = { ...listing, availability: [{ day_of_week: 1, open_time: '08:00', close_time: '11:00' }] };
    expect(mockAvailabilityCheck(closed, [], start, end)).toMatchObject({ available: false, reason: 'OUTSIDE_AVAILABLE_HOURS' });
    const open = { ...listing, availability: [{ day_of_week: 1, open_time: '08:00', close_time: '12:00' }] };
    expect(mockAvailabilityCheck(open, [], start, end).available).toBe(true);
  });
  it('reports listings that are not bookable', () => {
    expect(mockAvailabilityCheck({ ...listing, status: 'pending' }, [], start, end)).toMatchObject({ available: false, reason: 'LISTING_NOT_BOOKABLE' });
  });
});
