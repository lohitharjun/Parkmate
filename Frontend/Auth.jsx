import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ErrorBox } from '../components/States';

export default function Auth() {
  const { user, mode, setMode, login, signup } = useAuth();
  const [isSignup, setSignup] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={mode === 'consumer' ? '/search' : '/provider'} replace />;
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr('');
    if (isSignup && !f.name.trim()) return setErr('Please enter your name');
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return setErr('Enter a valid email address');
    if (f.password.length < 6) return setErr('Password must be at least 6 characters');
    setBusy(true);
    try { await (isSignup ? signup(f) : login(f)); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <section className="hero">
        <div className="logo"><i>P</i>ParkMate</div>
        <div>
          <h1>Parking reservations with certainty.</h1>
          <p>Log in to manage listings, review availability evidence, create temporary holds, and recover failed bookings automatically.</p>
          <div className="feat"><b>🚗 Consumers</b><span>Search, hold, confirm, and receive rescue alternatives.</span></div>
          <div className="feat"><b>🏢 Providers</b><span>Publish spaces, manage restrictions, and monitor bookings.</span></div>
        </div>
        <small>© 2026 ParkMate · Prototype</small>
      </section>
      <section className="right">
        <form className="acard" onSubmit={submit}>
          <h2>{isSignup ? 'Create your account' : 'Welcome back'}</h2>
          <p className="sub">{isSignup ? 'One account works as Consumer and Provider.' : 'Choose your account type and sign in.'}</p>
          <div className="tabs">
            {[['consumer', 'Consumer'], ['provider', 'Provider']].map(([m, t]) => (
              <button type="button" key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{t}</button>))}
          </div>
          {isSignup && <><label>Name</label><input value={f.name} onChange={on('name')} placeholder="Your name" /></>}
          <label>Email</label><input value={f.email} onChange={on('email')} placeholder="you@example.com" />
          <label>Password</label><input type="password" value={f.password} onChange={on('password')} placeholder="Enter your password" />
          {err && <ErrorBox msg={err} />}
          <button className="btn full" disabled={busy}>{busy ? 'Please wait…' : isSignup ? 'Sign up' : 'Log in'}</button>
          <a className="link" href="#" onClick={(e) => { e.preventDefault(); setSignup(!isSignup); setErr(''); }}>{isSignup ? 'Already have an account? Log in' : 'New here? Create an account'}</a>
          <div className="demo">Demo accounts (mock):<br />Consumer: <b>consumer@parkmate.com</b> / <b>demo123</b><br />Provider: <b>provider@parkmate.com</b> / <b>demo123</b></div>
        </form>
      </section>
    </div>
  );
}
