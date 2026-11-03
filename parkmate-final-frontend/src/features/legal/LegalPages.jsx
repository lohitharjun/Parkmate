import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LEGAL } from '../../lib/legal.js';

function LegalLayout({ eyebrow, title, intro, children }) {
  const navigate = useNavigate();
  return (
    <section className="legal-page page-wrap">
      <button className="back-link legal-back" type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}><ArrowLeft size={15} /> Back</button>
      <div className="page-intro">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <p>{intro}</p>
        </div>
      </div>
      <article className="legal-card surface-card">
        <p className="legal-updated">Last updated {LEGAL.lastUpdated}</p>
        {children}
        <p className="legal-contact">
          {LEGAL.contactEmail
            ? <>Questions about this page? Email <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.</>
            : <>Questions about this page? Use <Link to="/account/help">Help &amp; support</Link> in your account.</>}
        </p>
      </article>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout eyebrow="YOUR DATA" title={<>Privacy<br className="desktop-break" /> policy.</>} intro="What ParkMate collects, why we collect it, and the choices you have.">
      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your name, email address and chosen role (driver or space owner). Your password is handled by our sign-in provider and is never visible to us.</li>
        <li><strong>Listings you create:</strong> the title, address, coordinates, price, vehicle type, weekly hours and description you enter.</li>
        <li><strong>Bookings:</strong> the space, start and end time, status and the total calculated by the server.</li>
        <li><strong>Location:</strong> only the coordinates you type in. If you use “my location”, your browser asks permission first and we use it only to look for nearby spaces. We don’t track you in the background.</li>
        <li><strong>Technical data:</strong> basic error reports (what failed, your browser type and the page) so we can fix problems.</li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>To run ParkMate: sign you in, show spaces, take bookings and show owners their reservations.</li>
        <li>To keep it safe and working: prevent double bookings, detect abuse and fix errors.</li>
        <li>To improve the product, but only with your permission (see “Analytics” below).</li>
      </ul>
      <p>We don’t sell your personal data and we don’t use it for advertising. ParkMate doesn’t take payments, so we hold no card details.</p>

      <h2>3. Who sees what</h2>
      <ul>
        <li>A <strong>space owner</strong> sees the display name and booking times of drivers who book their space.</li>
        <li>A <strong>driver</strong> sees a space’s public details: title, address, price and hours.</li>
        <li>Nobody else can see your account email or bookings.</li>
      </ul>

      <h2>4. Service providers</h2>
      <p>We use trusted providers to run ParkMate. They process data only to provide their service:</p>
      <ul>
        <li><strong>Supabase</strong> for sign-in and our database.</li>
        <li><strong>Our hosting provider</strong> for the website and API.</li>
        <li><strong>Sentry</strong> for error reports (no names or emails are attached to them).</li>
        <li><strong>PostHog</strong> for product analytics, only if you accept analytics.</li>
        <li><strong>Unsplash</strong> serves illustrative photos. Your browser requests them directly.</li>
      </ul>

      <h2>5. Analytics and local storage</h2>
      <p>If analytics is switched on, we ask first. If you accept, we record which pages are used and key actions such as signing up, with a random identifier. We never put your name or email in analytics. You can change your mind at any time in <Link to="/account/settings">Settings</Link>.</p>
      <p>Your browser also stores small items so the app works: your sign-in session, light/dark theme, language and whether you’ve finished the welcome tour.</p>

      <h2>6. Keeping and deleting your data</h2>
      <p>We keep your data while your account is open. You can delete your account any time from <Link to="/account/profile">Profile</Link>. This removes your login, your listings and your bookings (including bookings on your spaces). Error reports are kept for a short period and contain no personal details.</p>

      <h2>7. Your rights</h2>
      <p>You can see your details in Profile, ask us to correct them, and delete your account yourself. If you’d like a copy of your data or have a concern, contact us using the details below and we’ll respond within a reasonable time.</p>

      <h2>8. Children</h2>
      <p>ParkMate is for people aged 18 and over, because it involves arranging use of property. Please don’t create an account if you’re younger.</p>

      <h2>9. Changes</h2>
      <p>If we change this policy in a meaningful way we’ll update the date above and, where it matters, tell you in the app.</p>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout eyebrow="THE GROUND RULES" title={<>Terms of<br className="desktop-break" /> service.</>} intro="The agreement between you and ParkMate when you use the service.">
      <h2>1. What ParkMate is</h2>
      <p>ParkMate is a marketplace that connects people who need parking (“drivers”) with people who have a space to share (“owners”). ParkMate isn’t a party to the arrangement between a driver and an owner, doesn’t own or operate any parking space, and doesn’t guarantee that a space will be available, suitable or safe.</p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be 18 or over and give accurate information.</li>
        <li>Keep your password private. You’re responsible for activity on your account.</li>
        <li>One account works as both a driver and an owner.</li>
      </ul>

      <h2>3. Owners</h2>
      <ul>
        <li>You must have the right to offer the space you list, and your listing must be accurate (address, price, hours, vehicle size).</li>
        <li>New listings are reviewed before drivers can book them. We may decline, pause or remove a listing that is inaccurate or unsafe.</li>
        <li>You’re responsible for honouring confirmed bookings and for any permissions needed for your property.</li>
      </ul>

      <h2>4. Drivers</h2>
      <ul>
        <li>Park only within the booked time, in the booked space, with a suitable vehicle.</li>
        <li>A booking is confirmed only when the app says so. Availability is checked again at that moment.</li>
        <li>You may cancel a booking from <em>My bookings</em>.</li>
      </ul>

      <h2>5. Prices and payments</h2>
      <p>ParkMate shows the price for your booking, calculated by the server from the hourly rate and your time. ParkMate doesn’t currently take payment. Any payment between a driver and an owner is arranged between them.</p>

      <h2>6. Parking Rescue</h2>
      <p>If the space you wanted is taken, Parking Rescue suggests alternatives based on availability, distance, price and listing freshness. Suggestions are a convenience, not a promise: availability is checked again when you book.</p>

      <h2>7. What you must not do</h2>
      <ul>
        <li>Post false, misleading or unlawful listings, or use someone else’s property without permission.</li>
        <li>Attempt to disrupt, scrape or break into the service, or bypass the booking checks.</li>
        <li>Harass or harm other users, or use ParkMate for anything illegal.</li>
      </ul>

      <h2>8. Our responsibility</h2>
      <p>We work to keep ParkMate running and accurate, but it’s provided “as is”. To the extent the law allows, ParkMate isn’t liable for loss, damage, theft or injury connected to a parked vehicle or a space, or for disputes between users. Nothing here limits rights you have by law that can’t be limited.</p>

      <h2>9. Ending your account</h2>
      <p>You can delete your account any time from <Link to="/account/profile">Profile</Link>. We may suspend or close accounts that break these terms.</p>

      <h2>10. Changes and governing law</h2>
      <p>We may update these terms and will change the date above when we do. Continuing to use ParkMate after a change means you accept it. These terms are governed by the laws of India.</p>
    </LegalLayout>
  );
}
