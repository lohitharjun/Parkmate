import AuthMap from './AuthMap.jsx';

/** Same two-column layout as the sign-in page: a card on the left, the illustrative map on the right. */
export default function AuthShell({ icon: Icon, eyebrow, title, lead, children }) {
  return (
    <section className="auth-page page-wrap">
      <div className="auth-card">
        <div className="auth-card__eyebrow"><span className="auth-card__icon"><Icon size={17} /></span><span>{eyebrow}</span></div>
        <h1>{title}</h1>
        {lead && <p className="auth-card__lead">{lead}</p>}
        {children}
      </div>
      <AuthMap />
    </section>
  );
}
