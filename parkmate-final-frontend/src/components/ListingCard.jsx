import { ArrowUpRight, MapPin, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatINR } from '../lib/validation.js';
import { SourceBadge } from './Feedback.jsx';
import ParkingPhoto from './ParkingPhoto.jsx';

const artClass = (value) => `listing-art listing-art--${value || 'sage'}`;

export default function ListingCard({ listing, distanceLabel }) {
  const isDemo = Boolean(listing.is_demo);
  const status = listing.status === 'pending' ? 'Pending review' : listing.status === 'rejected' ? 'Needs changes' : listing.is_active === false ? 'Paused' : 'Approved';
  const distance = distanceLabel ?? (listing.distance_km == null ? null : `${Number(listing.distance_km).toFixed(1)} km`);
  return (
    <article className="listing-card">
      <Link className={artClass(listing.illustration)} to={`/consumer/listings/${encodeURIComponent(listing.id)}`} aria-label={`View ${listing.title}`}>
        <ParkingPhoto className="listing-art__photo" item={listing} alt="Illustrative parking space photograph; not verified as this exact listing" />
        <span className="listing-art__distance"><MapPin size={12} /> {distance || 'Distance not provided'}</span>
        {isDemo && <span className="listing-art__sample">SAMPLE SPACE</span>}
      </Link>
      <div className="listing-card__body">
        <div className="listing-card__topline">
          <span className="listing-card__kind"><ShieldCheck size={13} /> {status}</span>
          <SourceBadge isDemo={isDemo} />
        </div>
        <Link className="listing-card__title" to={`/consumer/listings/${encodeURIComponent(listing.id)}`}>{listing.title}</Link>
        <p className="listing-card__address"><MapPin size={14} /> <span>{listing.address}</span></p>
        <div className="listing-card__footer">
          <div className="listing-card__price"><strong>{formatINR(listing.price_per_hour)}</strong><span>/ hour</span></div>
          <Link className="round-arrow" to={`/consumer/listings/${encodeURIComponent(listing.id)}`} aria-label={`Open ${listing.title}`}><ArrowUpRight size={17} /></Link>
        </div>
      </div>
    </article>
  );
}
