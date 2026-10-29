import ParkingPhoto from '../../components/ParkingPhoto.jsx';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Building2, CalendarDays, CircleDollarSign, Plus, ShieldCheck, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMarketplace } from '../../app/MarketplaceContext.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { EmptyState, ErrorState, LoadingState, PageIntro, SourceBadge } from '../../components/Feedback.jsx';
import { Button, PrimaryLink } from '../../components/Buttons.jsx';
import { formatDateTime, formatINR } from '../../lib/validation.js';

export default function ProviderDashboard() {
  const { getMyListings, getProviderReservations } = useMarketplace();
  const { isDemoMode, user } = useAuth();
  const [listings, setListings] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextListings, nextReservations] = await Promise.all([getMyListings(), getProviderReservations()]);
      setListings(nextListings);
      setReservations(nextReservations);
    } catch (loadError) {
      setListings([]);
      setReservations([]);
      setError(loadError?.message || 'Could not load the provider dashboard.');
    } finally {
      setLoading(false);
    }
  }, [getMyListings, getProviderReservations]);

  useEffect(() => { refresh(); }, [refresh]);
  const activeCount = listings.filter((item) => item.status === 'approved' && item.is_active !== false).length;
  const confirmedReservations = reservations.filter((item) => item.status === 'confirmed').length;
  const expectedDemoValue = reservations.filter((item) => item.status === 'confirmed').reduce((sum, item) => sum + Number(item.total_price || 0), 0);

  return (
    <section className="provider-page page-wrap">
      <PageIntro eyebrow="YOUR SPACE. YOUR RULES." title={<>Provider<br className="desktop-break" /> dashboard.</>} description={isDemoMode ? 'A local demo preview of the host experience. Sample listings and reservations are fictional.' : `Manage the signed-in account’s listings${user?.full_name ? `, ${user.full_name}` : ''}.`} action={<PrimaryLink to="/provider/listings"><Plus size={16} /> Add a space</PrimaryLink>} />
      {loading ? <LoadingState label="Loading provider overview…" /> : error ? <ErrorState title="Provider data unavailable" message={error} onRetry={refresh} action={<Link className="button button--secondary" to="/auth/sign-in?next=%2Fprovider%2Fdashboard">Sign in</Link>} /> : (
        <>
          <div className="provider-metrics">
            <article><span className="provider-metrics__label">Your spaces</span><strong>{listings.length}</strong><span><Building2 size={14} /> In this account</span></article>
            <article><span className="provider-metrics__label">Approved & active</span><strong>{activeCount}</strong><span><ShieldCheck size={14} /> Bookable status</span></article>
            <article><span className="provider-metrics__label">Reservations</span><strong>{confirmedReservations}</strong><span><CalendarDays size={14} /> Confirmed status</span></article>
            <article><span className="provider-metrics__label">Reservation value</span><strong>{formatINR(expectedDemoValue)}</strong><span><TrendingUp size={14} /> {isDemoMode ? 'Sample/demo total' : 'From API totals'}</span></article>
          </div>
          {isDemoMode && <div className="dashboard-demo-note"><CircleDollarSign size={16} /><span>All figures above are local sample data. No earnings, payments, or payout connection exists.</span></div>}
          <div className="provider-dashboard-grid">
            <section className="surface-card provider-dashboard-listings">
              <div className="section-heading"><div><span className="eyebrow">YOUR PARKING SPACES</span><h2>Listings</h2></div><Link className="text-link" to="/provider/listings">Manage all <ArrowRight size={14} /></Link></div>
              {listings.length === 0 ? <EmptyState icon={Building2} title="Your first space is waiting" description="Add a space with its address, coordinates, hourly rate and availability." action={<PrimaryLink to="/provider/listings">Create a listing</PrimaryLink>} /> : <div className="mini-listing-list">{listings.slice(0, 3).map((listing) => <article className="mini-listing" key={listing.id}><span className={`mini-listing__mark mini-listing__mark--${listing.illustration || 'sage'}`}><ParkingPhoto item={listing} width={200} alt="" /></span><div><strong>{listing.title}</strong><p>{listing.address}</p><span className={`status-chip status-chip--${listing.status}`}>{listing.status || 'status unavailable'}</span></div><div className="mini-listing__right"><SourceBadge isDemo={Boolean(listing.is_demo)} /><strong>{formatINR(listing.price_per_hour)}<small> / hr</small></strong></div></article>)}</div>}
            </section>
            <section className="provider-next-step">
              <div className="provider-next-step__icon"><CalendarDays size={21} /></div>
              <span className="eyebrow">KEEP IT CURRENT</span>
              <h2>Good details make a good arrival.</h2>
              <p>Confirm that a space is still available and keep weekly hours accurate.</p>
              <Link className="button button--secondary" to="/provider/listings">Manage availability <ArrowRight size={15} /></Link>
              <div className="provider-next-step__divider" />
              <strong>{reservations.length ? 'Reservations are ready to review.' : 'New reservations will appear here.'}</strong>
              <Link className="text-link" to="/provider/reservations">Open provider reservations <ArrowRight size={14} /></Link>
            </section>
          </div>
          <section className="provider-reservation-preview surface-card">
            <div className="section-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Upcoming reservations</h2></div><Link className="text-link" to="/provider/reservations">See all <ArrowRight size={14} /></Link></div>
            {reservations.length === 0 ? <p className="muted-note">No reservations yet. This is separate from the consumer’s “My Bookings” view.</p> : reservations.slice(0, 3).map((reservation) => <article className="reservation-preview-row" key={reservation.id}><span className="reservation-preview-row__avatar">{(reservation.consumer?.display_name || 'G').slice(0, 1).toUpperCase()}</span><div><strong>{reservation.consumer?.display_name || 'Consumer'}</strong><p>{reservation.listing?.title || 'Your space'} · {formatDateTime(reservation.start_time)}</p></div><strong>{formatINR(reservation.total_price)}</strong><SourceBadge isDemo={Boolean(reservation.is_demo)} /></article>)}
          </section>
        </>
      )}
    </section>
  );
}
