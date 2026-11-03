import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, ChevronRight, CircleHelp, CreditCard, Globe, LogOut, Moon, ShoppingBag, SlidersHorizontal, Sun, UserRound } from 'lucide-react';
import { useTheme } from '../app/ThemeContext.jsx';
import { LANGUAGES, MENU_TEXT, loadLanguage, saveLanguage } from '../lib/i18n.js';

const accountLinks = [
  { to: '/account/profile', key: 'profile', icon: UserRound },
  { to: '/account/orders', key: 'orders', icon: ShoppingBag },
  { to: '/account/payments', key: 'payments', icon: CreditCard },
  { to: '/account/settings', key: 'settings', icon: SlidersHorizontal },
];

function displayName(user) {
  return user?.full_name || user?.email?.split('@')[0] || 'Account';
}

/**
 * Profile button + account menu.
 * The button shows the first letter of the user's name. Opening it plays a ripple that
 * blurs/dims the page behind a frosted menu (same interaction as the dashboard prototype).
 */
export default function AccountMenu({ user, viewRole, onChooseRole, onSignOut, error }) {
  const { theme, toggleTheme } = useTheme();
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [geometry, setGeometry] = useState({ x: 0, y: 0, d: 0, top: 0, right: 12 });
  const [signingOut, setSigningOut] = useState(false);
  const [lang, setLang] = useState(loadLanguage);
  const [langOpen, setLangOpen] = useState(false);
  const t = MENU_TEXT[lang];

  const name = displayName(user);
  const initial = (name.trim().charAt(0) || 'P').toUpperCase();
  const isProvider = viewRole === 'provider';

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setLangOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  function openMenu() {
    const rect = buttonRef.current.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const d = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) * 2.1;
    const menuWidth = Math.min(330, w - 24);
    const right = Math.min(Math.max(12, w - rect.right), w - menuWidth - 12); // keep the menu fully on screen
    setGeometry({ x, y, d, top: rect.bottom + 10, right });
    setOpen(true);
  }

  // focus the first item once the menu is visible
  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => menuRef.current?.querySelector('[role="menuitem"]')?.focus(), 140);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Escape / resize / scroll lock
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    const onResize = () => close(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  function onMenuKeyDown(event) {
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length].focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
    else if (event.key === 'Home') { event.preventDefault(); items[0].focus(); }
    else if (event.key === 'End') { event.preventDefault(); items[items.length - 1].focus(); }
    else if (event.key === 'Tab') close(false);
  }

  function switchDashboard() {
    close(false);
    window.setTimeout(() => onChooseRole(isProvider ? 'consumer' : 'provider'), 200);
  }

  async function signOut() {
    setSigningOut(true);
    try {
      const ok = await onSignOut();
      if (ok) close(false);
    } finally {
      setSigningOut(false);
    }
  }

  const style = { '--x': `${geometry.x}px`, '--y': `${geometry.y}px`, '--d': `${geometry.d}px` };

  return (
    <>
      <button
        ref={buttonRef}
        className="profile-btn"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        title={name}
        onClick={() => (open ? close() : openMenu())}
      >
        {initial}
      </button>
      {createPortal(
        <>
          <div className={`acct-overlay${open ? ' open' : ''}`} style={style} onClick={() => close()} aria-hidden="true">
            <div className="acct-wave" />
            <div className="acct-ring" />
            <div className="acct-ring r2" />
          </div>
          <div
            ref={menuRef}
            className={`acct-menu${open ? ' open' : ''}`}
            style={{ top: geometry.top, right: geometry.right }}
            role="menu"
            aria-label="Account"
            aria-hidden={!open}
            onKeyDown={onMenuKeyDown}
          >
            <div className="am-head">
              <span className="am-avatar">{initial}</span>
              <div>
                <b>{name}</b>
                {user?.email && <span>{user.email}</span>}
                <span className="am-role">{isProvider ? t.providerView : t.consumerView}{user?.is_demo && <i>Demo</i>}</span>
              </div>
            </div>
            <div className="am-sep" />
            <button className="am-item" type="button" role="menuitem" onClick={switchDashboard}>
              <ArrowLeftRight size={19} aria-hidden="true" />
              <span>{isProvider ? t.toConsumer : t.toProvider}</span>
            </button>
            <div className="am-sep" />
            {accountLinks.map(({ to, key, icon: Icon }) => (
              <Link key={to} className="am-item" role="menuitem" to={to} onClick={() => close(false)}>
                <Icon size={19} aria-hidden="true" /><span>{t[key]}</span>
              </Link>
            ))}
            <button className="am-item" type="button" role="menuitem" aria-expanded={langOpen} onClick={() => setLangOpen((v) => !v)}>
              <Globe size={19} aria-hidden="true" /><span>{t.language}</span>
              <ChevronRight className="chev" size={15} aria-hidden="true" />
            </button>
            {langOpen && (
              <div className="am-lang" role="group" aria-label={t.language}>
                {Object.entries(LANGUAGES).map(([code, label]) => (
                  <button key={code} type="button" role="menuitemradio" aria-checked={lang === code} onClick={() => { setLang(code); saveLanguage(code); }}>
                    {label}{lang === code && <span className="ck">✓</span>}
                  </button>
                ))}
                {lang !== 'en' && <p className="am-lang-note">Only this menu is translated for now. Full-page translation is coming soon.</p>}
              </div>
            )}
            <Link className="am-item" role="menuitem" to="/account/help" onClick={() => close(false)}>
              <CircleHelp size={19} aria-hidden="true" /><span>{t.help}</span>
            </Link>
            <div className="am-sep" />
            <div className="am-seg">
              <span>{t.appearance}</span>
              <div className="seg" role="group" aria-label={t.appearance}>
                <button type="button" aria-pressed={theme === 'light'} onClick={() => theme !== 'light' && toggleTheme()}><Sun size={15} aria-hidden="true" />{t.light}</button>
                <button type="button" aria-pressed={theme === 'dark'} onClick={() => theme !== 'dark' && toggleTheme()}><Moon size={15} aria-hidden="true" />{t.dark}</button>
              </div>
            </div>
            <div className="am-sep" />
            <button className="am-item am-danger" type="button" role="menuitem" onClick={signOut} disabled={signingOut}>
              <LogOut size={19} aria-hidden="true" /><span>{signingOut ? t.signingOut : t.logout}</span>
            </button>
            {error && <p className="am-error" role="alert">{error}</p>}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
