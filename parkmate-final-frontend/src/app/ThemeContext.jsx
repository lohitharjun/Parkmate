import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'parkmate.theme.v1';

function readStoredTheme() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', theme === 'dark' ? '#000000' : '#f5f4ee');

  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) {
    favicon.setAttribute('href', theme === 'dark' ? '/assets/parkmate-mark-dark.svg' : '/assets/parkmate-mark.svg');
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readStoredTheme);
  const fadeTimer = useRef(null);

  useLayoutEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // The visual theme remains active for this page even when storage is unavailable.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    // Fade colours between themes. The class is added only for the switch itself, so normal
    // hover/focus transitions and first paint are unaffected, and it is skipped for reduced motion.
    const root = document.documentElement;
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* default to animating */ }
    if (!reduce) {
      root.classList.add('theme-transition');
      window.clearTimeout(fadeTimer.current);
      fadeTimer.current = window.setTimeout(() => root.classList.remove('theme-transition'), 550);
    }
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({ theme, isDark: theme === 'dark', toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider.');
  return context;
}
