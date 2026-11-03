import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { workspaceForRole } from '../../lib/authRoutes.js';

export default function NotFoundPage() {
  const { user, viewRole } = useAuth();
  const navigate = useNavigate();
  return (
    <section className="not-found-page page-wrap">
      <div className="not-found-card">
        <span className="not-found-card__icon"><Compass size={22} /></span>
        <div className="not-found-card__code" aria-hidden="true">404</div>
        <h1>That page isn’t here.</h1>
        <p>The link may be old, or the address may have a typo. Let’s get you back on the road.</p>
        <div className="not-found-card__actions">
          <Link className="button button--primary" to={user ? workspaceForRole(viewRole) : '/'}>{user ? 'Go to my dashboard' : 'Back to ParkMate'}</Link>
          <button className="button button--secondary" type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}><ArrowLeft size={15} /> Go back</button>
        </div>
      </div>
    </section>
  );
}
