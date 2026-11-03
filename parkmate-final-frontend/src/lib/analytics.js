// Product analytics for PostHog — no npm package needed (uses PostHog's HTTP capture API).
// Configure with VITE_POSTHOG_KEY (a public project key) and optionally VITE_POSTHOG_HOST.
// Nothing is sent until the visitor accepts analytics in the consent banner.
const KEY = String(import.meta.env?.VITE_POSTHOG_KEY || '').trim();
const HOST = String(import.meta.env?.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').trim().replace(/\/$/, '');
const CONSENT_KEY = 'parkmate.analyticsConsent.v1';
const ANON_KEY = 'parkmate.anonId.v1';

export const analyticsConfigured = Boolean(KEY);

function store(op, key, value) {
  try {
    if (op === 'get') return localStorage.getItem(key);
    if (op === 'set') localStorage.setItem(key, value);
    if (op === 'remove') localStorage.removeItem(key);
  } catch {
    // storage blocked: behave as "no consent" / anonymous
  }
  return null;
}

/** 'granted' | 'denied' | null (not asked yet) */
export function getConsent() {
  const value = store('get', CONSENT_KEY);
  return value === 'granted' || value === 'denied' ? value : null;
}

export function setConsent(value) {
  store('set', CONSENT_KEY, value);
  if (value !== 'granted') store('remove', ANON_KEY);
}

function distinctId() {
  let id = store('get', ANON_KEY);
  if (!id) {
    id = crypto?.randomUUID?.() || `anon-${Math.random().toString(36).slice(2)}`;
    store('set', ANON_KEY, id);
  }
  return id;
}

let identified = null;

export function identify(userId) {
  identified = userId || null;
}

export function buildCapture(event, properties = {}) {
  return {
    api_key: KEY,
    event,
    distinct_id: identified || distinctId(),
    timestamp: new Date().toISOString(),
    properties: {
      $current_url: typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : undefined,
      $lib: 'parkmate-web',
      ...properties,
    },
  };
}

export function track(event, properties) {
  if (!analyticsConfigured || getConsent() !== 'granted') return;
  try {
    fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildCapture(event, properties)),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // analytics must never break the app
  }
}

export function trackPageView(pathname) {
  // Only the path is sent. Listing ids are collapsed so URLs never carry personal data.
  track('$pageview', { path: pathname.replace(/\/listings\/[^/]+/, '/listings/:id') });
}
