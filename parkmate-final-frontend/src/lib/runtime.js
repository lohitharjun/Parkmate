const env = import.meta.env || {};

export const runtimeConfig = Object.freeze({
  // Demo is the default for now. Set VITE_APP_MODE=live to use Supabase and the backend.
  requestedMode: env.VITE_APP_MODE === 'live' ? 'live' : 'demo',
  apiBaseUrl: String(env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '').replace(/\/api$/i, ''),
  supabaseUrl: String(env.VITE_SUPABASE_URL || '').trim(),
  supabaseAnonKey: String(env.VITE_SUPABASE_ANON_KEY || '').trim(),
});

// A Supabase "service role" key bypasses all security rules and must never ship in a browser app.
export function isServiceRoleKey(key) {
  try {
    const payload = String(key).split('.')[1];
    if (!payload) return false;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return json?.role === 'service_role';
  } catch {
    return false;
  }
}

export function getRuntimeReadiness(config = runtimeConfig) {
  if (config.requestedMode !== 'live') {
    return { mode: 'demo', ready: true, missing: [] };
  }
  const missing = [];
  if (!config.apiBaseUrl) missing.push('VITE_API_BASE_URL');
  if (!config.supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!config.supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY');
  if (config.apiBaseUrl && !/^https?:\/\//i.test(config.apiBaseUrl)) missing.push('a valid HTTP(S) API base URL');
  if (config.supabaseAnonKey && isServiceRoleKey(config.supabaseAnonKey)) missing.push('a public anon key (a service-role key must never be used in the browser)');
  return { mode: missing.length ? 'misconfigured' : 'live', ready: missing.length === 0, missing };
}
