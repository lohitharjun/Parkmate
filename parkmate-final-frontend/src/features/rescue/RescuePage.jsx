import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Navigation, Sparkles } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMarketplace } from '../../app/MarketplaceContext.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { EmptyState, ErrorState, InlineNotice, LoadingState, PageIntro, SourceBadge } from '../../components/Feedback.jsx';
import { Button, PrimaryLink } from '../../components/Buttons.jsx';
import ListingCard from '../../components/ListingCard.jsx';
import { formatINR, formatDateTime } from '../../lib/validation.js';

export default function RescuePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { getAlternatives, getListing, simulateConflict } = useMarketplace();
  const { isDemoMode } = useAuth();
  const [alternatives, setAlternatives] = useState(location.state?.alternatives || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(location.state?.alternativeError || '');
  const [conflict, setConflict] = useState(location.state || null);

  useEffect(() => {
    let active = true;
    const state = location.state;
    if (state?.listing && Array.isArray(state.alternatives)) {
      setConflict(state);
      setAlternatives(state.alternatives);
      setError(state.alternativeError || '');
      return () => { active = false; };
    }
    if (state?.listing && state.alternativeError) {
      setConflict(state);
      setAlternatives([]);
      setError(state.alternativeError);
      return () => { active = false; };
    }
    const listingId = params.get('listing_id');
    const source = state?.listing ? Promise.resolve(state.listing) : listingId ? getListing(listingId) : null;
    if (!source) {
      setAlternatives(null);
      setError('');
      return () => { active = false; };
    }
    setConflict(state || null);
    setAlternatives(null);
    setError('');
    setLoading(true);
    source
      .then(async (listing) => {
        if (!active) return;
        if (!listing) throw new Error('The original listing could not be loaded. Return to search and choose another space.');
        const startISO = state?.startISO || params.get('start');
        const endISO = state?.endISO || params.get('end');
        if (!startISO || !endISO) throw new Error('A booking time window is required to request alternatives.');
        const maxPrice = state?.maxPrice ?? params.get('max_price') ?? listing.price_per_hour;
        const next = await getAlternatives({ listing, startISO, endISO, maxPrice });
        if (active) {
          setConflict({ ...state, listing, startISO, endISO, maxPrice, simulated: Boolean(state?.simulated) });
          setAlternatives(next);
        }
      })
      .catch((loadError) => { if (active) setError(loadError?.message || 'Could not find alternatives.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [getAlternatives, getListing, location.state, params]);

  async function demoRescue() {
    if (!isDemoMode) return;
    const sample = (await getListing('sample-guindy-metro'));
    if (!sample) return;
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const startISO = now.toISOString();
    const endISO = end.toISOString();
    const simulated = simulateConflict(sample);
    navigate('/consumer/rescue', {
      replace: true,
      state: {
        listing: sample,
        startISO,
        endISO,
        maxPrice: sample.price_per_hour,
        simulated: true,
        conflictMessage: simulated.message,
      },
    });
  }

  function chooseAlternative(alternative) {
    const listing = alternative.listing || alternative;
    navigate(`/consumer/listings/${encodeURIComponent(listing.id)}`, {
      state: { startISO: conflict?.startISO, endISO: conflict?.endISO },
    });
  }

  function updateSpotlight(event) {
    if (event.pointerType !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--spot-x', `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty('--spot-y', `${event.clientY - bounds.top}px`);
  }

  function clearSpotlight(event) {
    event.currentTarget.style.removeProperty('--spot-x');
    event.currentTarget.style.removeProperty('--spot-y');
  }

  const items = alternatives || [];
  return (
    <section className="rescue-page page-wrap">
      <Link className="back-link" to="/consumer/search"><ArrowLeft size={16} /> Back to search</Link>
      <PageIntro eyebrow="A PLAN B FOR PARKING" title={<>Parking<br className="desktop-break" /> Rescue.</>} description="A booking conflict does not have to end the trip. Compare alternatives for the same destination and time window." />
      {conflict?.listing ? (
        <div className="rescue-conflict-card">
          <span className="rescue-conflict-card__icon"><AlertTriangle size={19} /></span>
          <div><strong>{conflict.simulated ? 'Simulated demo conflict' : 'Booking could not be completed'}</strong><p>{conflict.conflictMessage || 'The selected time is no longer bookable. Here are the alternatives returned for the same window.'}</p><small>{conflict.listing.title} · {conflict.startISO ? formatDateTime(conflict.startISO) : 'Window unavailable'}{conflict.endISO ? ` – ${formatDateTime(conflict.endISO)}` : ''}</small></div>
          <SourceBadge isDemo={Boolean(conflict.simulated || conflict.listing.is_demo)} />
        </div>
      ) : <InlineNotice tone="info">{isDemoMode ? 'Parking Rescue can open after a booking conflict. To preview the recovery path, simulate one using a sample listing.' : 'Live alternatives appear here after a booking conflict. Start a booking from search to reach the server-backed recovery flow.'}</InlineNotice>}
      {conflict?.simulated && <InlineNotice tone="info">Demo simulation only — no booking request or API call was made. Alternative availability is not checked against a server.</InlineNotice>}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {isDemoMode && !conflict?.listing && !error && <div className="rescue-start"><span><Sparkles size={20} /></span><div><strong>See how a Plan B works</strong><p>Choose a sample listing, then use its clearly labelled demo conflict action.</p></div><Button variant="primary" onClick={demoRescue}>Simulate a conflict (demo) <ArrowRight size={15} /></Button></div>}
      {loading ? <LoadingState label="Looking for alternatives…" /> : conflict?.listing && items.length === 0 && !error ? <EmptyState icon={Navigation} title="No alternatives returned" description={isDemoMode ? 'The sample inventory has no other matching space. Widen your search or return to the listing.' : 'The documented alternatives endpoint returned an empty list for this window.'} action={<Link className="button button--secondary" to="/consumer/search">Search all spaces</Link>} /> : null}
      {items.length > 0 && (
        <div className="rescue-results">
          <div className="rescue-results__heading"><div><span className="eyebrow">ALTERNATIVES FOR THE SAME WINDOW</span><h2>{items.length} {items.length === 1 ? 'space' : 'spaces'} to consider</h2></div><span className="rescue-results__rule" /></div>
          <div className="rescue-grid">
            {items.map((item, index) => {
              const listing = item.listing || item;
              return (
                <article
                  className={`rescue-card${index === 0 ? ' rescue-card--featured' : ''}`}
                  key={listing.id}
                  onPointerMove={index === 0 ? updateSpotlight : undefined}
                  onPointerLeave={index === 0 ? clearSpotlight : undefined}
                >
                  <ListingCard listing={{ ...listing, distance_km: item.distance_km ?? listing.distance_km }} />
                  {Array.isArray(item.reasons) && <div className="rescue-card__reasons"><strong>Why this appeared</strong>{item.reasons.map((reason) => <span key={reason}><span className="rescue-card__bullet" />{reason}</span>)}</div>}
                  <div className="rescue-card__foot"><SourceBadge isDemo={Boolean(item.is_demo || listing.is_demo)} /><strong>{formatINR(listing.price_per_hour)}<small> / hour</small></strong><Button variant="primary" onClick={() => chooseAlternative(item)}>Try this space <ArrowRight size={15} /></Button></div>
                </article>
              );
            })}
          </div>
        </div>
      )}
      <p className="rescue-footer-note">The booking API rechecks each selected alternative. A second conflict may still occur; payment is not part of this MVP.</p>
      <div className="rescue-actions"><PrimaryLink to="/consumer/search">Return to search <ArrowRight size={15} /></PrimaryLink><Link to="/consumer/bookings" className="text-link">View My Bookings</Link></div>
    </section>
  );
}
