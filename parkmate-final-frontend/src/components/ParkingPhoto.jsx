import { useState } from 'react';
import { photoCandidates } from '../lib/parkingPhotos.js';

// Shows a parking photo; if one URL fails it tries the next, then falls back to a neutral surface.
export default function ParkingPhoto({ item, width = 1000, className = '', alt = '', loading = 'lazy', ...rest }) {
  const [index, setIndex] = useState(0);
  const candidates = photoCandidates(item, width);
  if (index >= candidates.length) return <span className={`parking-photo-fallback ${className}`} aria-hidden="true" />;
  return <img className={className} src={candidates[index]} alt={alt} loading={loading} onError={() => setIndex((i) => i + 1)} {...rest} />;
}
