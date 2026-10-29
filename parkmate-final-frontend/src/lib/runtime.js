const env = import.meta.env || {};

export const runtimeConfig = Object.freeze({
  requestedMode: env.VITE_APP_MODE === 'live' ? 'live' : 'demo',
  apiBaseUrl: String(env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '').replace(/\/api$/i, ''),
  supabaseUrl: String(env.VITE_SUPABASE_URL || '').trim(),
  supabaseAnonKey: String(env.VITE_SUPABASE_ANON_KEY || '').trim(),
});

export function getRuntimeReadiness(config = runtimeConfig) {
  if (config.requestedMode !== 'live') {
    return { mode: 'demo', ready: true, missing: [] };
  }
  const missing = [];
  if (!config.apiBaseUrl) missing.push('VITE_API_BASE_URL');
  if (!config.supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!config.supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY');
  if (config.apiBaseUrl && !/^https?:\/\//i.test(config.apiBaseUrl)) missing.push('a valid HTTP(S) API base URL');
  return { mode: missing.length ? 'misconfigured' : 'live', ready: missing.length === 0, missing };
}
