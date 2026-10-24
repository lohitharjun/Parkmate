import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { USE_MOCK } from '../api/client';

export default function Layout() {
  const { user, mode, setMode, logout } = useAuth();
  const nav = useNavigate();
  const c = mode === 'consumer';
  const swap = () => { setMode(c ? 'provider' : 'consumer'); nav(c ? '/provider' : '/search'); };
  return (
    <>
      {USE_MOCK && <div className="mock">TEMPORARY MOCK DATA - not connected to the backend</div>}
      {!user ? <Outlet /> : (
        <>
          <header className="top">
            <div className="logo"><i>P</i>ParkMate</div>
            <nav className="nav">
              {c ? <><NavLink to="/search">Search</NavLink><NavLink to="/my-bookings">My Bookings</NavLink></>
                 : <NavLink to="/provider">Provider Listings</NavLink>}
            </nav>
            <div className="who">
              <span className="chip">{c ? 'Consumer' : 'Provider'} mode</span>
              <button className="btn ghost sm" onClick={swap}>Switch to {c ? 'Provider' : 'Consumer'}</button>
              <div className="avatar">{user.name[0].toUpperCase()}</div>
              <a className="mut" href="#" onClick={(e) => { e.preventDefault(); logout(); nav('/'); }}>Logout</a>
            </div>
          </header>
          <main><Outlet /></main>
        </>
      )}
    </>
  );
}
