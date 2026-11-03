import { describe, expect, it } from 'vitest';
import { ACCEPT_ATTR, MAX_PHOTOS_PER_LISTING, MAX_PHOTO_BYTES, photoStatus, validatePhotoFile, visiblePhotos } from './photoUpload.js';
import { demoAvailabilityCheck } from './demoAvailability.js';
import { photoCandidates } from './parkingPhotos.js';

const file = (name, type, size = 10) => ({ name, type, size });

describe('photo rules', () => {
  it('accepts JPEG and PNG only', () => {
    expect(validatePhotoFile(file('a.jpg', 'image/jpeg'))).toBe('');
    expect(validatePhotoFile(file('a.png', 'image/png'))).toBe('');
    expect(validatePhotoFile(file('a.webp', 'image/webp'))).toMatch(/JPEG or PNG/);
    expect(validatePhotoFile(file('a.gif', 'image/gif'))).toMatch(/JPEG or PNG/);
    expect(ACCEPT_ATTR).toBe('image/jpeg,image/png');
  });
  it('limits: 5 MB and 10 photos', () => {
    expect(MAX_PHOTO_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_PHOTOS_PER_LISTING).toBe(10);
    expect(validatePhotoFile(file('big.jpg', 'image/jpeg', MAX_PHOTO_BYTES + 1))).toMatch(/5 MB/);
    expect(validatePhotoFile(file('ok.jpg', 'image/jpeg', MAX_PHOTO_BYTES))).toBe('');
  });
  it('reads review_status (and the older status)', () => {
    expect(photoStatus({ review_status: 'rejected' })).toBe('rejected');
    expect(photoStatus({ status: 'pending' })).toBe('pending');
  });
  it('drivers only ever see approved photos, main first', () => {
    const listing = { photos: [
      { id: 1, url: 'a', review_status: 'pending' },
      { id: 2, url: 'b', review_status: 'approved' },
      { id: 3, url: 'c', review_status: 'rejected', review_note: 'blurry' },
      { id: 4, url: 'd', review_status: 'approved', is_primary: true },
    ] };
    expect(visiblePhotos(listing).map((p) => p.id)).toEqual([4, 2]);
    expect(photoCandidates(listing)[0]).toBe('d');
    expect(photoCandidates(listing)).not.toContain('a');
  });
});

describe('demo availability-check mirrors the live reasons', () => {
  const listing = { id: 'L', owner_id: 'o', status: 'approved', is_active: true, price_per_hour: 50, availability: [] };
  const win = { startISO: '2030-01-07T04:30:00.000Z', endISO: '2030-01-07T06:30:00.000Z' }; // Mon 10:00–12:00 IST
  it('available with a total', () => expect(demoAvailabilityCheck(listing, win)).toEqual({ available: true, estimated_total_price: 100 }));
  it('own listing', () => expect(demoAvailabilityCheck(listing, win, { userId: 'o' }).reason).toBe('OWN_LISTING'));
  it('not approved', () => expect(demoAvailabilityCheck({ ...listing, status: 'pending' }, win).reason).toBe('LISTING_NOT_APPROVED'));
  it('paused', () => expect(demoAvailabilityCheck({ ...listing, is_active: false }, win).reason).toBe('LISTING_PAUSED'));
  it('outside opening hours', () => {
    const hours = [{ day_of_week: 1, open_time: '13:00', close_time: '18:00' }];
    expect(demoAvailabilityCheck({ ...listing, availability: hours }, win).reason).toBe('OUTSIDE_AVAILABLE_HOURS');
    const open = [{ day_of_week: 1, open_time: '09:00', close_time: '18:00' }];
    expect(demoAvailabilityCheck({ ...listing, availability: open }, win).available).toBe(true);
  });
  it('slot taken, ignoring cancelled bookings', () => {
    const taken = [{ listing_id: 'L', status: 'confirmed', start_time: '2030-01-07T05:00:00.000Z', end_time: '2030-01-07T07:00:00.000Z' }];
    expect(demoAvailabilityCheck(listing, win, { bookings: taken }).reason).toBe('SLOT_TAKEN');
    expect(demoAvailabilityCheck(listing, win, { bookings: [{ ...taken[0], status: 'cancelled' }] }).available).toBe(true);
  });
});
