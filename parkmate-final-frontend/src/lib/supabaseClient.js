import { createClient } from '@supabase/supabase-js';
import { getRuntimeReadiness, runtimeConfig } from './runtime.js';

const readiness = getRuntimeReadiness();
export const supabase = readiness.mode === 'live' && readiness.ready
  ? createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const isSupabaseConfigured = Boolean(supabase);
