import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../../app/ThemeContext.jsx';
import { workspaceForRole } from '../../lib/authRoutes.js';
import '../../styles/landing.css';

const LOGO = '/assets/landing/logo.png';
const SPLASH_KEY = 'parkmate.splash.v1';

function splashAlreadySeen() {
  try { return window.sessionStorage.getItem(SPLASH_KEY) === '1'; } catch { return false; }
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, setViewRole } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const rootRef = useRef(null);
  const artRef = useRef(null);
  const timers = useRef([]);
  const [skipped, setSkipped] = useState(splashAlreadySeen);
  const [themeAnim, setThemeAnim] = useState(false);
  const [ripple, setRipple] = useState(null);

  // Play the intro once per browser session, not every time someone returns to "/".
  useEffect(() => {
    try { window.sessionStorage.setItem(SPLASH_KEY, '1'); } catch { /* optional */ }
    return () => timers.current.forEach((id) => window.clearTimeout(id));
  }, []);

  // Scroll-reveal
  useEffect(() => {
    const els = rootRef.current ? Array.from(rootRef.current.querySelectorAll('.reveal')) : [];
    els.forEach((el, i) => el.style.setProperty('--rd', `${(i % 4) * 0.08}s`));
    if (!('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('in')); return undefined; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); } });
    }, { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  function replayCar() {
    const art = artRef.current;
    if (!art) return;
    art.classList.remove('play');
    art.style.setProperty('--base', '0s');
    void art.offsetWidth;
    art.classList.add('play');
  }

  function toggle() {
    setThemeAnim(true);
    timers.current.push(window.setTimeout(() => setThemeAnim(false), 450));
    toggleTheme();
  }

  function scrollTo(id) {
    return (event) => {
      event.preventDefault();
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  // Where a side button leads: straight to the workspace if signed in, otherwise
  // to sign-in with the chosen role pre-selected (sign-in then opens that workspace).
  function destination(role) {
    return user ? workspaceForRole(role) : `/auth/sign-in?role=${role}`;
  }

  function choose(role) {
    return (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      setViewRole(role);
      const go = () => navigate(destination(role));
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { go(); return; }
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX || rect.left + rect.width / 2;
      const y = event.clientY || rect.top + rect.height / 2;
      const d = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) * 2.6;
      setRipple({ x, y, d });
      timers.current.push(window.setTimeout(go, 950));
    };
  }

  const consumerHref = destination('consumer');
  const providerHref = destination('provider');
  const light = theme === 'light';

  return (
    <div ref={rootRef} className={`pm-landing js${skipped ? ' skipped' : ''}${themeAnim ? ' theme-anim' : ''}`}>
      <div className="splash" aria-hidden="true" onClick={() => setSkipped(true)}>
        <div className="logo-wrap"><img src={LOGO} alt="" /></div>
      </div>

      <header className="nav">
        <a className="brand rise" href="#top" aria-label="ParkMate home" onClick={scrollTo('top')}>
          <img src={LOGO} alt="" />
          <span>ParkMate</span>
        </a>
        <div className="nav-r rise" style={{ '--d': '.1s' }}>
          <a className="jump" href="#sides" onClick={scrollTo('sides')}>Choose your side</a>
          <button className="theme-btn" type="button" onClick={toggle} aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}>
            <svg className="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            <svg className="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" /></svg>
          </button>
        </div>
      </header>

      <main id="top">
        <div className="hero">
          <div>
            <h1 className="rise" style={{ '--d': '.05s' }}>
              <span>A better place to <em className="hl">leave the car</em></span>
              <span>or park in <em className="hl">someone’s garage</em></span>
            </h1>
            <p className="lead rise" style={{ '--d': '.2s' }}>ParkMate connects people who need a parking spot with people who have one to spare: a garage, a driveway, or a space in an apartment block.</p>
            <div className="cta rise" style={{ '--d': '.35s' }}>
              <a className="btn btn-fill" href={consumerHref} onClick={choose('consumer')}>Find a space</a>
              <a className="btn btn-line" href={providerHref} onClick={choose('provider')}>List your space</a>
            </div>
          </div>

          <div className="window rise" style={{ '--d': '.3s' }} aria-label="A car parking in front of a garage">
            <div ref={artRef} className="art play" title="Click to replay" onClick={replayCar}>
              <img className="arches" src="/assets/landing/arches.png" alt="" />
              <div className="mover"><img src="/assets/landing/car.png" alt="" /></div>
            </div>
          </div>
        </div>

        <section id="sides">
          <h2 className="reveal">Choose how you’ll use ParkMate</h2>
          <p className="sect-sub reveal">Each side has its own dashboard. Some people will use both.</p>
          <div className="sides">
            <div className="side reveal">
              <h3>I need parking</h3>
              <div className="dash">Consumer dashboard</div>
              <ul className="pts">
                <li className="reveal"><span>Search for spaces near where you’re headed.</span></li>
                <li className="reveal"><span>Compare prices, distances and listing details.</span></li>
                <li className="reveal"><span>Book a time slot. It’s checked before it’s confirmed.</span></li>
              </ul>
              <a className="btn btn-fill" href={consumerHref} onClick={choose('consumer')}>Find a space</a>
            </div>
            <div className="side reveal">
              <h3>I have a space</h3>
              <div className="dash">Provider dashboard</div>
              <ul className="pts">
                <li className="reveal"><span>Add your garage, driveway or apartment spot.</span></li>
                <li className="reveal"><span>Set your price and the hours it’s free to rent.</span></li>
                <li className="reveal"><span>Submit it for review, then track every booking once it’s approved.</span></li>
              </ul>
              <a className="btn btn-line" href={providerHref} onClick={choose('provider')}>List your space</a>
            </div>
          </div>
          <p className="one-account reveal">One account works on both sides. Switch whenever you like.</p>
        </section>

        <section id="rescue">
          <h2 className="reveal">What is Parking Rescue?</h2>
          <p className="sect-sub reveal">When the space you wanted is taken, you don’t start over. ParkMate suggests other spaces that fit your time, and tells you why each one is suggested.</p>
          <ul className="pts grid cols2">
            <li className="reveal"><h3>Free for your time</h3><p>A must. If it can’t take your booking, it isn’t shown.</p></li>
            <li className="reveal"><h3>Within your distance</h3><p>Closer spaces are preferred, when location data is available.</p></li>
            <li className="reveal"><h3>Fair price</h3><p>A lower hourly price helps a space rank higher.</p></li>
            <li className="reveal"><h3>Fresh listing data</h3><p>Recently updated listings are preferred.</p></li>
          </ul>
          <p className="note reveal">Rescue uses real booking availability, location, price and listing freshness. It does not claim live street-crowd data. You can browse every alternative, not just the top one, and availability is rechecked before you confirm.</p>
        </section>

        <section>
          <h2 className="reveal">Built to be trusted</h2>
          <ul className="pts grid cols3">
            <li className="reveal"><h3>Every listing is reviewed</h3><p>A new space stays pending until a reviewer approves it. Only approved, active spaces can be booked.</p></li>
            <li className="reveal"><h3>The server does the maths</h3><p>The total price is calculated on the server, never trusted from the browser.</p></li>
            <li className="reveal"><h3>No made-up numbers</h3><p>Availability comes from real bookings. There are no invented trust scores or crowd data.</p></li>
          </ul>
        </section>

        <section>
          <h2 className="reveal">Bookings you can rely on</h2>
          <ul className="pts grid cols3 ico">
            <li className="reveal"><svg viewBox="0 0 24 24" fill="none" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg><h3>Clear, factual listings</h3><p>Each space shows its review status, location, photos and when it was last updated.</p></li>
            <li className="reveal"><svg viewBox="0 0 24 24" fill="none" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5L15.5 10" /></svg><h3>No double bookings</h3><p>The server and database check every request, so a slot can’t be booked twice.</p></li>
            <li className="reveal"><svg viewBox="0 0 24 24" fill="none" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0115.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 01-15.5 6.2L3 16" /><path d="M3 21v-5h5" /></svg><h3>A backup if it falls through</h3><p>If your space is taken, Parking Rescue suggests alternatives ranked by availability, distance and price.</p></li>
          </ul>
        </section>
      </main>

      <footer>
        <a className="brand" href="#top" aria-label="Back to top" onClick={scrollTo('top')}><img src={LOGO} alt="" /><span>ParkMate</span></a>
        <span>Prototype built for DEXATHON 2026</span>
      </footer>

      {ripple && (
        <div className="ripple" aria-hidden="true" style={{ '--x': `${ripple.x}px`, '--y': `${ripple.y}px`, '--d': `${ripple.d}px` }}>
          <i /><i /><i /><b />
        </div>
      )}
    </div>
  );
}
