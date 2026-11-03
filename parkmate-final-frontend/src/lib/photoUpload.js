// Client-side checks for parking photos. The server is still the authority (it answers 413 / 415 /
// 422 PHOTO_LIMIT_REACHED and removes GPS/camera data); these just save people a round trip.
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MIN_PHOTO_SIDE = 200; // pixels, both width and height
export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png'];
export const ACCEPT_ATTR = ACCEPTED_PHOTO_TYPES.join(',');
export const MAX_PHOTOS_PER_LISTING = 10;

/** Quick checks that need no decoding: type and size. */
export function validatePhotoFile(file) {
  if (!file) return 'Choose a photo first.';
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) return `“${file.name}” isn’t a JPG or PNG photo.`;
  if (file.size > MAX_PHOTO_BYTES) return `“${file.name}” is larger than 5 MB. Try a smaller photo.`;
  return '';
}

export function readImageSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}

/** Full check: type, size and at least 200×200 pixels. Resolves to '' when the photo is fine. */
export async function validatePhotoImage(file) {
  const problem = validatePhotoFile(file);
  if (problem) return problem;
  try {
    const { width, height } = await readImageSize(file);
    if (width < MIN_PHOTO_SIDE || height < MIN_PHOTO_SIDE) {
      return `“${file.name}” is too small (${width}×${height}). Photos must be at least ${MIN_PHOTO_SIDE}×${MIN_PHOTO_SIDE} pixels.`;
    }
  } catch {
    return `We couldn’t read “${file.name}”. Try a different photo.`;
  }
  return '';
}

/** 'pending' | 'approved' | 'rejected'. Photos with no status (older data, demo) count as approved. */
export function photoReviewStatus(photo) {
  const value = photo?.review_status ?? photo?.status;
  return ['pending', 'approved', 'rejected'].includes(value) ? value : 'approved';
}

/** Photos a driver may see: approved only, main photo first. (The server already filters; this is a second guard.) */
export function visiblePhotos(listing) {
  const all = Array.isArray(listing?.photos) ? listing.photos : [];
  const shown = all.filter((photo) => photo?.url && photoReviewStatus(photo) === 'approved');
  return [...shown.filter((photo) => photo.is_primary), ...shown.filter((photo) => !photo.is_primary)];
}

/**
 * Where the photo was taken, only if the person allows browser location.
 * Resolves to { latitude, longitude } or null (denied, unavailable or too slow) — never rejects.
 */
export function getCaptureLocation(timeout = 4000) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout, maximumAge: 300000 },
    );
  });
}

/** Demo mode only: shrink to a small JPEG data URL. Re-drawing on a canvas also drops GPS/camera metadata. */
export function shrinkToDataUrl(file, maxSide = 1100, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('We couldn’t read that image. Try a different photo.')); };
    img.src = url;
  });
}
