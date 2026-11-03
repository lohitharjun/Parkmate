// Lightweight error tracking for Sentry — no npm package needed.
// Reads the PUBLIC DSN from VITE_SENTRY_DSN (a DSN can only send events; it can't read anything).
// If you later install @sentry/react, keep these function names and swap the internals.
import { runtimeConfig } from './runtime.js';

const dsnRaw = String(import.meta.env?.VITE_SENTRY_DSN || '').trim();

export function parseDsn(dsn) {
  try {
    const url = new URL(dsn);
    const key = url.username;
    const projectId = url.pathname.replace(/^\//, '');
    if (!key || !projectId) return null;
    return { key, projectId, endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/?sentry_key=${key}&sentry_version=7` };
  } catch {
    return null;
  }
}

const dsn = parseDsn(dsnRaw);
let user = null;
const seen = new Map();

/** Parses a Chrome/Firefox/Safari stack string into Sentry frames (oldest first). */
export function parseStack(stack) {
  if (!stack) return [];
  const frames = [];
  for (const line of String(stack).split('\n')) {
    const chrome = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/);
    const gecko = line.match(/^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/);
    const m = chrome || gecko;
    if (m) frames.push({ function: m[1] || '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) });
  }
  return frames.reverse();
}

export function buildEvent(error, extra = {}) {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
  return {
    event_id: (crypto?.randomUUID?.() || String(Math.random()).slice(2)).replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: import.meta.env?.MODE || 'production',
    release: String(import.meta.env?.VITE_APP_VERSION || ''),
    request: { url: typeof location !== 'undefined' ? location.href.split('#')[0] : '', headers: { 'User-Agent': typeof navigator !== 'undefined' ? navigator.userAgent : '' } },
    tags: { mode: runtimeConfig.requestedMode, ...(extra.tags || {}) },
    extra: extra.extra || {},
    user: user ? { id: user } : undefined,
    exception: { values: [{ type: err.name || 'Error', value: err.message, stacktrace: { frames: parseStack(err.stack) } }] },
  };
}

function send(event) {
  if (!dsn) return;
  const header = JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: dsnRaw });
  const body = `${header}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
  try {
    fetch(dsn.endpoint, { method: 'POST', body, keepalive: true, mode: 'cors' }).catch(() => {});
  } catch {
    // reporting must never break the app
  }
}

export function captureException(error, extra) {
  if (!dsn) {
    if (import.meta.env?.DEV) console.error('[monitoring]', error);
    return;
  }
  // de-duplicate identical errors for 30 seconds so a render loop can't flood the quota
  const sig = `${error?.name}:${error?.message}`;
  const now = Date.now();
  if (now - (seen.get(sig) || 0) < 30000) return;
  seen.set(sig, now);
  send(buildEvent(error, extra));
}

/** Only an opaque user id is attached — never name, email or other personal details. */
export function setMonitoringUser(id) {
  user = id || null;
}

let started = false;
export function initMonitoring() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('error', (event) => {
    if (event.error) captureException(event.error, { tags: { source: 'window.onerror' } });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    // aborted fetches are normal (e.g. a search cancelled by typing again)
    if (reason?.name === 'AbortError') return;
    captureException(reason instanceof Error ? reason : new Error(String(reason)), { tags: { source: 'unhandledrejection' } });
  });
}

export const monitoringEnabled = Boolean(dsn);
