import { MapPin, Navigation } from 'lucide-react';
import { Link } from 'react-router-dom';

const spots = [
  { x: '23%', y: '24%', rotate: '-8deg' },
  { x: '72%', y: '28%', rotate: '7deg' },
  { x: '46%', y: '54%', rotate: '-4deg' },
  { x: '79%', y: '72%', rotate: '9deg' },
  { x: '28%', y: '78%', rotate: '4deg' },
];

export default function MapPreview({ listings = [] }) {
  const pins = listings.slice(0, 5);
  return (
    <section className="map-preview" aria-label="Illustrative parking map">
      <div className="map-preview__top"><div><span className="eyebrow">AREA OVERVIEW</span><strong>Nearby spaces</strong></div><span className="map-preview__icon"><Navigation size={15} /></span></div>
      <div className="map-preview__canvas">
        <svg className="map-preview__streets" viewBox="0 0 420 340" preserveAspectRatio="none" aria-hidden="true">
          <path d="M-20 95 C80 58 112 170 217 144 S345 67 440 110" />
          <path d="M55 -20 C104 60 63 108 105 174 S171 277 149 365" />
          <path d="M290 -15 C250 72 312 122 279 181 S288 272 336 364" />
          <path d="M-5 246 C89 215 153 269 229 231 S356 211 430 244" />
          <path className="map-preview__main-road" d="M-20 183 C95 154 176 209 280 177 S365 168 440 187" />
          <path className="map-preview__main-road-line" d="M-20 183 C95 154 176 209 280 177 S365 168 440 187" />
        </svg>
        <span className="map-block map-block--one" /><span className="map-block map-block--two" /><span className="map-block map-block--three" /><span className="map-block map-block--four" />
        {pins.map((pin, index) => {
          const point = spots[index];
          return <Link key={pin.id} to={`/consumer/listings/${encodeURIComponent(pin.id)}`} className={`map-pin ${index === 0 ? 'map-pin--primary' : ''}`} style={{ left: point.x, top: point.y, '--pin-rotate': point.rotate }} title={`Open ${pin.title}`} aria-label={`Open ${pin.title}`}><MapPin size={17} /><span>{index === 0 ? 'Best fit' : `₹${Number(pin.price_per_hour)}`}</span></Link>;
        })}
        {pins.length === 0 && <div className="map-preview__empty">Pins appear here when parking matches your filters.</div>}
        <span className="map-preview__label">CHENNAI · ILLUSTRATIVE</span>
      </div>
      <p className="map-preview__foot">Illustration only — not a live map, navigation, or exact placement.</p>
    </section>
  );
}
