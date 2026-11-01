import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import BrandMark from '../components/BrandMark.jsx';
import { ModeBanner } from '../components/Feedback.jsx';
import { useAuth } from '../features/auth/AuthContext.jsx';
import { safeAuthReturnPath, workspaceForRole } from '../lib/authRoutes.js';
import LandingPage from '../features/search/LandingPage.jsx';
import AuthPage from '../features/auth/AuthPage.jsx';
import SearchPage from '../features/search/SearchPage.jsx';
import ListingDetailsPage from '../features/search/ListingDetailsPage.jsx';
import BookingsPage from '../features/bookings/BookingsPage.jsx';
import RescuePage from '../features/rescue/RescuePage.jsx';
import ProviderDashboard from '../features/provider/ProviderDashboard.jsx';
import ProviderListingsPage from '../features/provider/ProviderListingsPage.jsx';
import ProviderReservationsPage from '../features/provider/ProviderReservationsPage.jsx';

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return null;
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link className="brand brand--footer" to="/" aria-label="ParkMate home">
        <span className="brand__mark"><BrandMark /></span>
        <span className="brand__word">ParkMate<small>FIND YOUR SPACE</small></span>
      </Link>
      <p>Less circling. More arriving.</p>
      <span className="site-footer__note">Demo listings and browser-only interactions are labelled throughout.</span>
    </footer>
  );
}

function NotFoundPage() {
  return <section className="not-found"><div className="eyebrow">404 · WRONG TURN</div><h1>That space isn’t here.</h1><p>Try heading back to the ParkMate home page.</p><Link className="button button--primary" to="/">Back to ParkMate</Link></section>;
}

function AuthLoading() {
  return <main className="auth-gate-loading" role="status" aria-live="polite">Checking your ParkMate sign-in…</main>;
}

export default function App() {
  const { user, authReady, viewRole } = useAuth();
  const location = useLocation();
  const isAuthPage = location.pathname === '/auth/sign-in' || location.pathname === '/auth/sign-up';

  if (!authReady) return <AuthLoading />;

  if (!user && !isAuthPage) {
    const requestedPath = `${location.pathname}${location.search}${location.hash}`;
    const query = new URLSearchParams({ role: viewRole || 'consumer', next: requestedPath || '/' });
    return <Navigate to={`/auth/sign-in?${query.toString()}`} replace />;
  }

  if (user && isAuthPage) {
    const requestedPath = safeAuthReturnPath(new URLSearchParams(location.search).get('next'), window.location.origin);
    return <Navigate to={requestedPath || workspaceForRole(viewRole)} replace />;
  }

  return (
    <div className="app-shell">
      <ScrollToTop />
      <SiteHeader />
      {user && <ModeBanner />}
      <main id="main-content">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/auth/sign-in" element={<AuthPage mode="sign-in" />} />
          <Route path="/auth/sign-up" element={<AuthPage mode="sign-up" />} />
          <Route path="/consumer/search" element={<SearchPage />} />
          <Route path="/consumer/listings/:listingId" element={<ListingDetailsPage />} />
          <Route path="/consumer/bookings" element={<BookingsPage />} />
          <Route path="/consumer/rescue" element={<RescuePage />} />
          <Route path="/provider/dashboard" element={<ProviderDashboard />} />
          <Route path="/provider/listings" element={<ProviderListingsPage />} />
          <Route path="/provider/reservations" element={<ProviderReservationsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      {user && <SiteFooter />}
    </div>
  );
}
