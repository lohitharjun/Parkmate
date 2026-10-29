import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu, UserRound, X } from 'lucide-react';
import { useAuth } from '../features/auth/AuthContext.jsx';
import BrandMark from './BrandMark.jsx';
import ThemeToggle from './ThemeToggle.jsx';

const consumerLinks = [
  { to: '/consumer/search', label: 'Find parking' },
  { to: '/consumer/bookings', label: 'My bookings' },
  { to: '/consumer/rescue', label: 'Parking Rescue' },
];
const providerLinks = [
  { to: '/provider/dashboard', label: 'Overview' },
  { to: '/provider/listings', label: 'My spaces' },
  { to: '/provider/reservations', label: 'Reservations' },
];

export default function SiteHeader() {
  const { user, viewRole, setViewRole, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerError, setHeaderError] = useState('');
  const navigate = useNavigate();
  const isAuthenticated = Boolean(user);
  const links = viewRole === 'provider' ? providerLinks : consumerLinks;

  async function handleSignOut() {
    try {
      await signOut();
      setHeaderError('');
      setMenuOpen(false);
      navigate(`/auth/sign-in?role=${viewRole || 'consumer'}`);
    } catch (error) {
      setHeaderError(error?.message || 'Sign out could not be completed. Please try again.');
    }
  }

  function chooseRole(role) {
    setViewRole(role);
    setMenuOpen(false);
    if (isAuthenticated) {
      navigate(role === 'provider' ? '/provider/dashboard' : '/consumer/search');
    } else {
      navigate(`/auth/sign-in?role=${role}`);
    }
  }

  return (
    <header className={`site-header${isAuthenticated ? '' : ' site-header--public'}`}>
      <div className="site-header__inner">
        <Link className="brand" to={isAuthenticated ? '/' : `/auth/sign-in?role=${viewRole || 'consumer'}`} aria-label="ParkMate home" onClick={() => setMenuOpen(false)}>
          <span className="brand__mark"><BrandMark /></span>
          <span className="brand__word">ParkMate<small>FIND YOUR SPACE</small></span>
        </Link>

        {isAuthenticated && (
          <nav className={`main-nav ${menuOpen ? 'main-nav--open' : ''}`} aria-label="Main navigation">
            {links.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={() => setMenuOpen(false)} className={({ isActive }) => `main-nav__link${isActive ? ' is-active' : ''}`}>
                {item.label}
              </NavLink>
            ))}
            <div className="mobile-nav-extra">
              <div className="mobile-role-switch" role="group" aria-label="Switch between Consumer and Provider views">
                <button type="button" aria-pressed={viewRole === 'consumer'} className={viewRole === 'consumer' ? 'is-selected' : ''} onClick={() => chooseRole('consumer')}>Consumer</button>
                <button type="button" aria-pressed={viewRole === 'provider'} className={viewRole === 'provider' ? 'is-selected' : ''} onClick={() => chooseRole('provider')}>Provider</button>
              </div>
              <button className="main-nav__link" type="button" onClick={handleSignOut}>Sign out</button>
            </div>
          </nav>
        )}

        <div className="header-actions">
          {isAuthenticated && (
            <div className="role-switch" role="group" aria-label="Switch between Consumer and Provider views">
              <button type="button" aria-pressed={viewRole === 'consumer'} className={viewRole === 'consumer' ? 'is-selected' : ''} onClick={() => chooseRole('consumer')}>Consumer</button>
              <button type="button" aria-pressed={viewRole === 'provider'} className={viewRole === 'provider' ? 'is-selected' : ''} onClick={() => chooseRole('provider')}>Provider</button>
            </div>
          )}
          <ThemeToggle />
          {user && (
            <div className="account-menu">
              <span className="account-menu__name"><UserRound size={15} /> {user.full_name || user.email?.split('@')[0] || 'Account'}{user.is_demo && <i>Demo</i>}</span>
              {headerError && <span className="account-menu__error" role="alert">{headerError}</span>}
              <button className="icon-button account-menu__exit" type="button" onClick={handleSignOut} aria-label="Sign out">Sign out</button>
            </div>
          )}
          {isAuthenticated && (
            <button className="mobile-menu-button" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen}>
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          )}
        </div>
      </div>
      <div className="site-header__rule" />
    </header>
  );
}
