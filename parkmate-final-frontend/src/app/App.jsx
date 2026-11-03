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
import BookingDetailPage from '../features/bookings/BookingDetailPage.jsx';
import RescuePage from '../features/rescue/RescuePage.jsx';
import NotFoundPage from '../features/misc/NotFoundPage.jsx';
import OnboardingTour from '../features/onboarding/OnboardingTour.jsx';
import ConsentBanner from '../components/ConsentBanner.jsx';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from '../features/auth/RecoveryPages.jsx';
import { PrivacyPage, TermsPage } from '../features/legal/LegalPages.jsx';
import { trackPageView } from '../lib/analytics.js';
import ProviderDashboard from '../features/provider/ProviderDashboard.jsx';
import ProviderListingsPage from '../features/provider/ProviderListingsPage.jsx';
import ProviderReservationsPage from '../features/provider/ProviderReservationsPage.jsx';
import { HelpPage, OrdersRedirect, PaymentsPage, ProfilePage, SettingsPage } from '../features/account/AccountPages.jsx';

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    trackPageView(location.pathname);
  }, [location.pathname]);
  return null;
}

function SiteFooter() {
  const { isDemoMode } = useAuth();
  return (
    <footer className="site-footer">
      <Link className="brand brand--footer" to="/" aria-label="ParkMate home">
        <span className="brand__mark"><BrandMark /></span>
        <span className="brand__word">ParkMate<small>FIND YOUR SPACE</small></span>
      </Link>
      <p>Less circling. More arriving.</p>
      <nav className="site-footer__legal" aria-label="Legal"><Link to="/legal/privacy">Privacy</Link><Link to="/legal/terms">Terms</Link></nav>
      {isDemoMode && <span className="site-footer__note">Demo listings and browser-only interactions are labelled throughout.</span>}
    </footer>
  );
}

function AuthLoading() {
  return <main className="auth-gate-loading" role="status" aria-live="polite">Checking your ParkMate sign-in…</main>;
}

export default function App() {
  const { user, authReady, viewRole } = useAuth();
  const location = useLocation();
  const isAuthPage = ['/auth/sign-in', '/auth/sign-up', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email'].includes(location.pathname);
  // Legal pages are open to everyone. The reset-password and verify-email pages must not bounce a
  // signed-in person elsewhere (the emailed reset link signs people in temporarily).
  const isPublicInfoPage = location.pathname.startsWith('/legal/');
  const keepsSignedInUser = location.pathname === '/auth/reset-password' || location.pathname === '/auth/verify-email';
  // Only real app areas require sign-in; unknown addresses just show the 404 page.
  const isProtectedPath = /^\/(consumer|provider|account)(\/|$)/.test(location.pathname);
  // The landing page is the one public page besides sign-in/sign-up; its buttons lead into sign-in.
  const isLanding = location.pathname === '/';

  if (!authReady) return <AuthLoading />;

  if (!user && isProtectedPath) {
    const requestedPath = `${location.pathname}${location.search}${location.hash}`;
    const query = new URLSearchParams({ role: viewRole || 'consumer', next: requestedPath || '/' });
    return <Navigate to={`/auth/sign-in?${query.toString()}`} replace />;
  }

  if (user && isAuthPage && !keepsSignedInUser) {
    const requestedPath = safeAuthReturnPath(new URLSearchParams(location.search).get('next'), window.location.origin);
    return <Navigate to={requestedPath || workspaceForRole(viewRole)} replace />;
  }

  // Landing has its own nav, theme toggle and footer, so it renders outside the app shell.
  if (isLanding) return <><ScrollToTop /><LandingPage /></>;

  return (
    <div className="app-shell">
      <ScrollToTop />
      <SiteHeader />
      {user && !isPublicInfoPage && <ModeBanner />}
      <main id="main-content">
        <Routes>
          <Route path="/auth/sign-in" element={<AuthPage mode="sign-in" />} />
          <Route path="/auth/sign-up" element={<AuthPage mode="sign-up" />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth/verify-email" element={<VerifyEmailPage />} />
          <Route path="/legal/privacy" element={<PrivacyPage />} />
          <Route path="/legal/terms" element={<TermsPage />} />
          <Route path="/consumer/search" element={<SearchPage />} />
          <Route path="/consumer/listings/:listingId" element={<ListingDetailsPage />} />
          <Route path="/consumer/bookings" element={<BookingsPage />} />
          <Route path="/consumer/bookings/:bookingId" element={<BookingDetailPage />} />
          <Route path="/consumer/rescue" element={<RescuePage />} />
          <Route path="/account/profile" element={<ProfilePage />} />
          <Route path="/account/orders" element={<OrdersRedirect />} />
          <Route path="/account/payments" element={<PaymentsPage />} />
          <Route path="/account/settings" element={<SettingsPage />} />
          <Route path="/account/help" element={<HelpPage />} />
          <Route path="/provider/dashboard" element={<ProviderDashboard />} />
          <Route path="/provider/listings" element={<ProviderListingsPage />} />
          <Route path="/provider/reservations" element={<ProviderReservationsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      {user && <SiteFooter />}
      {!user && !isAuthPage && <nav className="public-legal-links" aria-label="Legal"><Link to="/legal/privacy">Privacy</Link><Link to="/legal/terms">Terms</Link></nav>}
      {user && <OnboardingTour />}
      <ConsentBanner />
    </div>
  );
}
