import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { checkBackendHealth, getMe } from '../../lib/apiClient.js';
import { loadDemoProfile, loadViewRole, saveDemoProfile, saveViewRole } from '../../lib/demoStorage.js';
import { getRuntimeReadiness, runtimeConfig } from '../../lib/runtime.js';
import { supabase } from '../../lib/supabaseClient.js';

const AuthContext = createContext(null);
const readiness = getRuntimeReadiness();

function normalizeRole(value) {
  return value === 'provider' ? 'provider' : 'consumer';
}

export function AuthProvider({ children }) {
  const isLiveMode = runtimeConfig.requestedMode === 'live';
  const [demoProfile, setDemoProfile] = useState(() => loadDemoProfile());
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(() => !isLiveMode || !supabase);
  const [viewRole, setViewRoleState] = useState(() => loadViewRole());
  const [backendStatus, setBackendStatus] = useState(() => {
    if (!isLiveMode) return 'demo';
    return readiness.ready ? 'checking' : 'misconfigured';
  });
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!isLiveMode || !readiness.ready) return undefined;
    let active = true;
    checkBackendHealth()
      .then(() => { if (active) setBackendStatus('connected'); })
      .catch(() => { if (active) setBackendStatus('offline'); });
    return () => { active = false; };
  }, [isLiveMode]);

  useEffect(() => {
    if (!isLiveMode || !supabase) {
      setAuthReady(true);
      return undefined;
    }
    let active = true;
    void supabase.auth.getSession()
      .then(({ data }) => { if (active) setSession(data.session || null); })
      .catch(() => { if (active) setSession(null); })
      .finally(() => { if (active) setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      if (!nextSession) setProfile(null);
      setAuthReady(true);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [isLiveMode]);

  useEffect(() => {
    if (!session?.access_token || backendStatus !== 'connected') return undefined;
    let active = true;
    getMe(session.access_token)
      .then((data) => { if (active) setProfile(data); })
      .catch(() => { if (active) setProfile(null); });
    return () => { active = false; };
  }, [session?.access_token, backendStatus]);

  const setViewRole = useCallback((role) => {
    const next = normalizeRole(role);
    setViewRoleState(next);
    saveViewRole(next);
  }, []);

  const signIn = useCallback(async ({ email, password, role = 'consumer' }) => {
    if (!isLiveMode) {
      const next = {
        id: normalizeRole(role) === 'provider' ? 'demo-provider' : 'demo-consumer',
        email: email.trim(),
        full_name: email.trim().split('@')[0] || 'ParkMate guest',
        role: normalizeRole(role),
        is_demo: true,
      };
      setDemoProfile(next);
      saveDemoProfile(next);
      setViewRole(next.role);
      return { ok: true, demo: true };
    }
    if (!supabase) throw new Error(`Live authentication is not configured: ${readiness.missing.join(', ')}.`);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    if (data.session) setSession(data.session);
    const userRole = normalizeRole(role || data.user?.user_metadata?.role);
    setViewRole(userRole);
    return { ok: true, demo: false, user: data.user };
  }, [isLiveMode, setViewRole]);

  const signUp = useCallback(async ({ fullName, email, password, role = 'consumer' }) => {
    if (!isLiveMode) {
      const next = {
        id: normalizeRole(role) === 'provider' ? 'demo-provider' : 'demo-consumer',
        email: email.trim(),
        full_name: fullName.trim(),
        role: normalizeRole(role),
        is_demo: true,
      };
      setDemoProfile(next);
      saveDemoProfile(next);
      setViewRole(next.role);
      return { ok: true, demo: true, user: next };
    }
    if (!supabase) throw new Error(`Live authentication is not configured: ${readiness.missing.join(', ')}.`);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), role: normalizeRole(role) } },
    });
    if (error) throw error;
    if (data.session) {
      setSession(data.session);
      setViewRole(normalizeRole(data.user?.user_metadata?.role || role));
    }
    return { ok: true, demo: false, user: data.user, needsEmailConfirmation: !data.session };
  }, [isLiveMode, setViewRole]);

  const signOut = useCallback(async () => {
    if (isLiveMode && supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSession(null);
      setProfile(null);
      return;
    }
    setDemoProfile(null);
    saveDemoProfile(null);
  }, [isLiveMode]);

  const getAccessToken = useCallback(async () => {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.access_token || null;
  }, []);

  const user = isLiveMode
    ? session?.user
      ? {
          ...session.user,
          id: session.user.id,
          email: session.user.email,
          full_name: profile?.full_name || session.user.user_metadata?.full_name || session.user.email,
          role: normalizeRole(session.user.user_metadata?.role || viewRole),
          is_demo: false,
        }
      : null
    : demoProfile;

  const value = useMemo(() => ({
    user,
    session,
    authReady,
    viewRole,
    setViewRole,
    signIn,
    signUp,
    signOut,
    getAccessToken,
    isDemoMode: !isLiveMode,
    isLiveMode,
    liveConfigured: readiness.ready,
    liveReady: isLiveMode && readiness.ready && backendStatus === 'connected',
    backendStatus,
    missingLiveSettings: readiness.missing,
  }), [user, session, authReady, viewRole, setViewRole, signIn, signUp, signOut, getAccessToken, isLiveMode, backendStatus]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
