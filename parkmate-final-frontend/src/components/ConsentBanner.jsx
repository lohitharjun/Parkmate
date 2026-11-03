import { useState } from 'react';
import { Link } from 'react-router-dom';
import { analyticsConfigured, getConsent, setConsent } from '../lib/analytics.js';

/** Asks once whether product analytics may run. Only appears when analytics is configured. */
export default function ConsentBanner() {
  const [choice, setChoice] = useState(getConsent);
  if (!analyticsConfigured || choice) return null;
  function decide(value) {
    setConsent(value);
    setChoice(value);
  }
  return (
    <div className="consent-banner" role="region" aria-label="Analytics choice">
      <p>Can we use privacy-friendly analytics to see which parts of ParkMate are useful? No names or emails are included. <Link to="/legal/privacy">Read how it works</Link>.</p>
      <div>
        <button className="button button--secondary button--small" type="button" onClick={() => decide('denied')}>No thanks</button>
        <button className="button button--primary button--small" type="button" onClick={() => decide('granted')}>Allow analytics</button>
      </div>
    </div>
  );
}
