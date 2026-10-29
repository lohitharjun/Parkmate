import { AlertCircle, ArrowRight, CheckCircle2, Info, LoaderCircle } from 'lucide-react';
import { useAuth } from '../features/auth/AuthContext.jsx';

export function SourceBadge({ isDemo = false, children }) {
  return (
    <span className={`source-badge ${isDemo ? 'source-badge--demo' : 'source-badge--live'}`}>
      <span className="source-badge__dot" />
      {children || (isDemo ? 'Demo data' : 'Live listing')}
    </span>
  );
}

export function ModeBanner() {
  const { isDemoMode, backendStatus, liveConfigured } = useAuth();
  if (isDemoMode) {
    return <div className="mode-banner mode-banner--demo"><Info size={15} /> <span><strong>Demo mode.</strong> Sample listings and local demo interactions only; no real booking is created.</span></div>;
  }
  if (!liveConfigured) {
    return <div className="mode-banner mode-banner--error"><AlertCircle size={15} /> <span><strong>Live mode is not configured.</strong> Add the required environment values; demo data is not substituted.</span></div>;
  }
  if (backendStatus === 'checking') {
    return <div className="mode-banner mode-banner--checking"><LoaderCircle size={15} className="spin" /> <span>Live mode selected — checking the documented backend health endpoint.</span></div>;
  }
  if (backendStatus === 'connected') {
    return <div className="mode-banner mode-banner--live"><CheckCircle2 size={15} /> <span><strong>Live backend health confirmed.</strong> Supabase sign-in is verified only when you complete authentication.</span></div>;
  }
  return <div className="mode-banner mode-banner--error"><AlertCircle size={15} /> <span><strong>Backend not reachable.</strong> Live data/actions are disabled; demo records are not shown as a fallback.</span></div>;
}

export function PageIntro({ eyebrow, title, description, action }) {
  return (
    <div className="page-intro">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-intro__action">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }) {
  return <div className="state-panel state-panel--loading" role="status"><LoaderCircle className="spin" size={21} /> <span>{label}</span></div>;
}

export function ErrorState({ title = 'We could not load this yet', message, action, onRetry }) {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <span className="state-panel__icon"><AlertCircle size={20} /></span>
      <div><strong>{title}</strong><p>{message || 'Please try again in a moment.'}</p></div>
      {onRetry && <button className="button button--small button--outline" onClick={onRetry}>Try again <ArrowRight size={14} /></button>}
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon size={22} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function InlineNotice({ tone = 'info', children, className = '' }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertCircle : Info;
  return <div className={`inline-notice inline-notice--${tone} ${className}`} role={tone === 'error' ? 'alert' : 'status'}><Icon size={16} /><div>{children}</div></div>;
}
