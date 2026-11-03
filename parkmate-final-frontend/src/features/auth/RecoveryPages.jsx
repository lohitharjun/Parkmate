import { useEffect, useRef, useState } from 'react';
import { ArrowRight, KeyRound, MailCheck, MailQuestion } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import AuthShell from './AuthShell.jsx';
import { InlineNotice } from '../../components/Feedback.jsx';
import { friendlyAuthError } from '../../lib/errors.js';
import { workspaceForRole } from '../../lib/authRoutes.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Counts down from `seconds`; returns [remaining, restart]. */
function useCooldown(seconds) {
  const [remaining, setRemaining] = useState(0);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);
  function start() {
    clearInterval(timer.current);
    setRemaining(seconds);
    timer.current = setInterval(() => setRemaining((value) => { if (value <= 1) { clearInterval(timer.current); return 0; } return value - 1; }), 1000);
  }
  return [remaining, start];
}

export function ForgotPasswordPage() {
  const { requestPasswordReset, isDemoMode } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, startCooldown] = useCooldown(60);

  async function submit(event) {
    event.preventDefault();
    if (!emailPattern.test(email.trim())) { setError('Enter the email address you signed up with.'); return; }
    setBusy(true); setError('');
    try {
      await requestPasswordReset(email);
      setSent(true);
      startCooldown();
    } catch (problem) {
      setError(friendlyAuthError(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell icon={KeyRound} eyebrow="FORGOT YOUR PASSWORD?" title={<>Let’s get you<br /><em>back in.</em></>} lead="Enter your email and we’ll send you a link to choose a new password.">
      {isDemoMode && <InlineNotice tone="info">Demo mode: no email is actually sent.</InlineNotice>}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {sent ? (
        <div className="auth-form">
          <InlineNotice tone="success">If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way. It can take a minute, so check your spam folder too.</InlineNotice>
          <button className="button button--secondary" type="button" disabled={cooldown > 0 || busy} onClick={submit}>{cooldown > 0 ? `Send again in ${cooldown}s` : 'Send the link again'}</button>
          <p className="auth-form__switch"><Link to="/auth/sign-in">Back to sign in</Link></p>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <label className="field"><span>Email address</span><input type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} placeholder="you@example.com" required autoFocus /></label>
          <button className="button button--primary auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Send reset link'} <ArrowRight size={16} /></button>
          <p className="auth-form__switch">Remembered it? <Link to="/auth/sign-in">Sign in</Link></p>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { user, isRecovery, updatePassword, signOut, isDemoMode, viewRole, authReady } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Supabase signs the person in when they open the emailed link. No session = the link was invalid or expired.
  const linkOk = isRecovery || Boolean(user);

  async function submit(event) {
    event.preventDefault();
    if (password.length < 8) { setError('Use a password with at least 8 characters.'); return; }
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await updatePassword(password);
      await signOut().catch(() => {});
      navigate('/auth/sign-in?reset=1', { replace: true });
    } catch (problem) {
      setError(friendlyAuthError(problem));
    } finally {
      setBusy(false);
    }
  }

  if (isDemoMode) {
    return <AuthShell icon={KeyRound} eyebrow="RESET PASSWORD" title={<>Password reset<br /><em>isn’t available yet.</em></>} lead="Demo mode has no real accounts, so there’s no password to reset."><Link className="button button--primary" to="/auth/sign-in">Back to sign in</Link></AuthShell>;
  }
  if (authReady && !linkOk) {
    return (
      <AuthShell icon={MailQuestion} eyebrow="LINK PROBLEM" title={<>That link<br /><em>didn’t work.</em></>} lead="Reset links expire after a while and only work once. Request a fresh one and try again.">
        <Link className="button button--primary" to="/auth/forgot-password">Request a new link <ArrowRight size={16} /></Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell icon={KeyRound} eyebrow="CHOOSE A NEW PASSWORD" title={<>A fresh start,<br /><em>safely.</em></>} lead="Pick a password you haven’t used elsewhere. At least 8 characters.">
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <form className="auth-form" onSubmit={submit} noValidate>
        <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} placeholder="At least 8 characters" required minLength={8} autoFocus /></label>
        <label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" value={confirm} onChange={(event) => { setConfirm(event.target.value); setError(''); }} placeholder="Repeat your password" required /></label>
        <button className="button button--primary auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Update password'} <ArrowRight size={16} /></button>
      </form>
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const { resendVerification, isDemoMode } = useAuth();
  const [params] = useSearchParams();
  const email = params.get('email') || '';
  const role = params.get('role') === 'provider' ? 'provider' : 'consumer';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, startCooldown] = useCooldown(60);

  useEffect(() => { startCooldown(); /* the first email was just sent */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function resend() {
    setBusy(true); setError(''); setNotice('');
    try {
      await resendVerification(email);
      setNotice('We’ve sent a new verification email.');
      startCooldown();
    } catch (problem) {
      setError(friendlyAuthError(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell icon={MailCheck} eyebrow="ONE LAST STEP" title={<>Check your<br /><em>inbox.</em></>} lead={email ? `We sent a verification link to ${email}. Open it to activate your account, then come back and sign in.` : 'We sent you a verification link. Open it to activate your account, then come back and sign in.'}>
      {isDemoMode && <InlineNotice tone="info">Demo mode: no email is actually sent.</InlineNotice>}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {notice && <InlineNotice tone="success">{notice}</InlineNotice>}
      <div className="auth-form">
        <p className="auth-help">Can’t see it? Check your spam folder, and make sure the address above is right.</p>
        {email && <button className="button button--secondary" type="button" disabled={cooldown > 0 || busy} onClick={resend}>{busy ? 'Sending…' : cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend verification email'}</button>}
        <Link className="button button--primary" to={`/auth/sign-in?role=${role}`}>I’ve verified, sign in <ArrowRight size={16} /></Link>
        <p className="auth-form__switch">Wrong address? <Link to={`/auth/sign-up?role=${role}`}>Start again</Link></p>
      </div>
    </AuthShell>
  );
}
