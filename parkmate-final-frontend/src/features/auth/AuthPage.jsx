import ParkingPhoto from '../../components/ParkingPhoto.jsx';
import { useEffect, useState } from 'react';
import { ArrowRight, Clock3, Eye, EyeOff, KeyRound, MapPin, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { InlineNotice } from '../../components/Feedback.jsx';
import { returnPathMatchesRole, safeAuthReturnPath, workspaceForRole } from '../../lib/authRoutes.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthPage({ mode = 'sign-in' }) {
  const isSignUp = mode === 'sign-up';
  const { signIn, signUp, setViewRole, isDemoMode, isLiveMode, backendStatus, liveConfigured, missingLiveSettings, viewRole } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const roleParam = searchParams.get('role');
  const initialRole = roleParam === 'provider' || roleParam === 'consumer' ? roleParam : viewRole || 'consumer';
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '', role: initialRole });
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setError('');
    setNotice('');
    setForm((current) => ({ ...current, role: initialRole }));
  }, [initialRole, mode]);

  const nextPath = safeAuthReturnPath(searchParams.get('next'), window.location.origin);
  const switchParams = new URLSearchParams({ role: form.role });
  if (nextPath) switchParams.set('next', nextPath);
  const switchHref = `${isSignUp ? '/auth/sign-in' : '/auth/sign-up'}?${switchParams.toString()}`;

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
    setNotice('');
  }

  function chooseRole(role) {
    update('role', role);
    setViewRole(role);
  }

  function validate() {
    if (isSignUp && !form.fullName.trim()) return 'Enter your full name.';
    if (!emailPattern.test(form.email.trim())) return 'Enter a valid email address.';
    if (form.password.length < 8) return 'Use a password with at least 8 characters.';
    if (isSignUp && form.password !== form.confirmPassword) return 'The passwords do not match.';
    return '';
  }

  async function submit(event) {
    event.preventDefault();
    const issue = validate();
    if (issue) { setError(issue); return; }
    setIsSubmitting(true); setError(''); setNotice('');
    try {
      if (isSignUp) {
        const result = await signUp(form);
        if (result.needsEmailConfirmation) {
          setNotice('Supabase accepted the sign-up request. Verify your email, then sign in before the rest of ParkMate becomes available.');
          return;
        }
        setNotice(result.demo ? 'Demo profile created in this browser only. No account was sent to a server.' : 'Your account is ready.');
      } else {
        const result = await signIn(form);
        setNotice(result.demo ? 'Demo sign-in only. Your password was not saved or sent to a server.' : 'Signed in with Supabase.');
      }
      const destination = nextPath && returnPathMatchesRole(nextPath, form.role) ? nextPath : workspaceForRole(form.role);
      window.setTimeout(() => navigate(destination, { replace: true }), 350);
    } catch (authError) {
      setError(authError?.message || 'We could not complete sign-in. Check your details and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-page page-wrap">
      <div className="auth-card">
        <div className="auth-card__eyebrow"><span className="auth-card__icon"><KeyRound size={17} /></span><span>{isSignUp ? 'JOIN THE NEIGHBORHOOD' : 'GOOD TO SEE YOU'}</span></div>
        <h1>{isSignUp ? <>Make room<br /><em>for easier arrivals.</em></> : <>Your next stop<br /><em>starts here.</em></>}</h1>
        <p className="auth-card__lead">{isSignUp ? 'Create a ParkMate profile to continue as a driver or a space provider.' : 'Sign in before entering ParkMate. Your Consumer or Provider choice takes you to the right workspace.'}</p>

        {isLiveMode && !liveConfigured && <InlineNotice tone="error">Live mode is selected, but required configuration is missing: {missingLiveSettings.join(', ')}. No demo session will be created.</InlineNotice>}
        {isLiveMode && liveConfigured && backendStatus === 'offline' && <InlineNotice tone="error">The backend health check failed. Supabase authentication can still be attempted, but API-backed marketplace actions remain unavailable.</InlineNotice>}
        {isDemoMode && <InlineNotice tone="info">Demo account only — use any valid email and an 8-character password. No account is created on a server, and the password is never stored.</InlineNotice>}
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        {notice && <InlineNotice tone="success">{notice}</InlineNotice>}

        <form className="auth-form" onSubmit={submit} noValidate>
          <fieldset className="role-choice">
            <legend>{isSignUp ? 'Choose your ParkMate mode' : 'Continue as'}</legend>
            <div className="auth-role-switch" role="group" aria-label="Switch between Consumer and Provider before sign-in">
              <button className={form.role === 'consumer' ? 'is-selected' : ''} type="button" aria-pressed={form.role === 'consumer'} onClick={() => chooseRole('consumer')}>
                <strong>Consumer</strong><small>Find a place to park</small>
              </button>
              <button className={form.role === 'provider' ? 'is-selected' : ''} type="button" aria-pressed={form.role === 'provider'} onClick={() => chooseRole('provider')}>
                <strong>Provider</strong><small>Share a parking space</small>
              </button>
            </div>
          </fieldset>
          {isSignUp && <label className="field"><span>Full name</span><input autoComplete="name" value={form.fullName} onChange={(event) => update('fullName', event.target.value)} placeholder="e.g. Mira Shah" required /></label>}
          <label className="field"><span>Email address</span><input type="email" autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="you@example.com" required /></label>
          <label className="field"><span>Password</span><span className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete={isSignUp ? 'new-password' : 'current-password'} value={form.password} onChange={(event) => update('password', event.target.value)} placeholder="At least 8 characters" required minLength={8} /><button type="button" onClick={() => setShowPassword((show) => !show)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
          {isSignUp && <label className="field"><span>Confirm password</span><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} placeholder="Repeat your password" required /></label>}
          <button className="button button--primary auth-submit" type="submit" disabled={isSubmitting || (isLiveMode && !liveConfigured)}>{isSubmitting ? 'Please wait…' : isSignUp ? 'Create profile' : 'Sign in'} <ArrowRight size={16} /></button>
          <p className="auth-form__switch">{isSignUp ? 'Already have a profile?' : 'New to ParkMate?'} <Link to={switchHref}>{isSignUp ? 'Sign in' : 'Create an account'}</Link></p>
        </form>
        <div className="auth-card__privacy"><ShieldCheck size={15} /><span>Only a signed-in user can open the site. Passwords are not written to local demo storage; live credentials are handled by Supabase Auth.</span></div>
      </div>
      <aside className="auth-aside"><ParkingPhoto className="auth-aside__photo" item={{ illustration: 'clay' }} width={1200} loading="eager" alt="Illustrative covered parking area; not a specific ParkMate listing" /><p>“Less circling.<br /><em>More arriving.</em>”</p><ul className="auth-aside__chips"><li><ShieldCheck size={13} /> Clear hourly prices</li><li><MapPin size={13} /> Spaces near you</li><li><Clock3 size={13} /> Book by the hour</li></ul><div className="auth-aside__foot"><span>THE PARKMATE WAY</span><strong>A clearer route to a better spot.</strong></div></aside>
    </section>
  );
}
