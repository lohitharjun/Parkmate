import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES, photoReviewStatus, validatePhotoFile, visiblePhotos } from './photoUpload.js';

const file = (type, size = 10, name = 'p') => ({ type, size, name });

describe('photo checks', () => {
  it('accepts JPEG and PNG, rejects WEBP and other types', () => {
    expect(validatePhotoFile(file('image/jpeg'))).toBe('');
    expect(validatePhotoFile(file('image/png'))).toBe('');
    expect(validatePhotoFile(file('image/webp'))).toMatch(/JPG or PNG/);
    expect(validatePhotoFile(file('application/pdf'))).toMatch(/JPG or PNG/);
  });
  it('rejects photos over 5 MB', () => {
    expect(validatePhotoFile(file('image/jpeg', MAX_PHOTO_BYTES))).toBe('');
    expect(validatePhotoFile(file('image/jpeg', MAX_PHOTO_BYTES + 1))).toMatch(/5 MB/);
  });
  it('reads the review status, treating missing status as approved', () => {
    expect(photoReviewStatus({ review_status: 'pending' })).toBe('pending');
    expect(photoReviewStatus({ status: 'rejected' })).toBe('rejected');
    expect(photoReviewStatus({})).toBe('approved');
  });
  it('shows drivers only approved photos, main photo first', () => {
    const photos = [
      { id: 1, url: 'a', review_status: 'approved' },
      { id: 2, url: 'b', review_status: 'pending' },
      { id: 3, url: 'c', review_status: 'approved', is_primary: true },
      { id: 4, url: 'd', review_status: 'rejected' },
    ];
    expect(visiblePhotos({ photos }).map((p) => p.id)).toEqual([3, 1]);
  });
});
