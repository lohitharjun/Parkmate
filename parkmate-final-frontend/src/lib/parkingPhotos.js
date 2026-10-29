// Parking photography used across ParkMate (illustrative, not verified listing photos).
// To guarantee the photos always load offline, download them into /public/assets/photos
// and replace the URLs below with '/assets/photos/<name>.jpg'.
const u = (id, w = 1000) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

export const PARKING_PHOTO_IDS = {
  sage: 'photo-1506521781263-d8422e82f27a',   // open parking lot
  clay: 'photo-1590674899484-d5640e854abe',   // covered garage
  blue: 'photo-1600661653561-629509216228',   // residential driveway
  sand: 'photo-1597766353939-c6a7e8e0a3b6',   // street parking
  forest: 'photo-1573348722427-f1d6819fdf98', // multi-level garage
};

const KEYS = Object.keys(PARKING_PHOTO_IDS);

// Ordered list of candidates: preferred photo first, then the rest as fallbacks.
export function photoCandidates(item, width = 1000) {
  const own = item?.image_url ? [item.image_url] : [];
  const pref = KEYS.includes(item?.illustration) ? item.illustration : KEYS[Math.abs(hash(String(item?.id || item?.listing_id || ''))) % KEYS.length];
  const ordered = [pref, ...KEYS.filter((k) => k !== pref)].map((k) => u(PARKING_PHOTO_IDS[k], width));
  return [...own, ...ordered];
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
