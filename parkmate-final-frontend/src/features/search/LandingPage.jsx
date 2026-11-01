import ParkingPhoto from '../../components/ParkingPhoto.jsx';
import { useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarCheck2, CarFront, Check, MapPin, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PrimaryLink, SecondaryLink } from '../../components/Buttons.jsx';

export default function LandingPage() {
  const [destination, setDestination] = useState('');
  const navigate = useNavigate();

  function submitSearch(event) {
    event.preventDefault();
    navigate(`/consumer/search${destination.trim() ? `?location=${encodeURIComponent(destination.trim())}` : ''}`);
  }

  return (
    <>
      <section className="home-hero page-wrap">
        <div className="home-hero__copy">
          <div className="eyebrow eyebrow--pill"><span className="eyebrow-dot" /> PARKING, SHARED MORE THOUGHTFULLY</div>
          <h1>A better place<br />to <em>leave the car.</em></h1>
          <p className="home-hero__lead">Find a nearby space shared by a neighbor — or make the space you have work a little harder.</p>
          <form className="hero-search" onSubmit={submitSearch}>
            <MapPin size={19} aria-hidden="true" />
            <label className="sr-only" htmlFor="hero-destination">Search by area, landmark or street</label>
            <input id="hero-destination" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Area, landmark or street" />
            <button className="button button--primary hero-search__submit" type="submit">Find a spot <ArrowRight size={16} /></button>
          </form>
          <div className="home-hero__trust"><span><Check size={14} /> Clear hourly prices</span><span><Check size={14} /> Neighbor-shared spaces</span><span><Check size={14} /> Demo data marked</span></div>
          <div className="home-hero__entry-links">
            <PrimaryLink to="/consumer/search">I’m looking to park <ArrowUpRight size={16} /></PrimaryLink>
            <SecondaryLink to="/provider/dashboard">I have a space <ArrowUpRight size={16} /></SecondaryLink>
          </div>
        </div>
        <figure className="home-hero__visual">
          <ParkingPhoto item={{ illustration: 'sage' }} width={1400} loading="eager" alt="Illustrative photograph of a parking area; not a specific ParkMate listing" />
          <span className="hero-photo__badge"><MapPin size={14} /> Illustrative scene</span>
          <figcaption className="hero-photo__caption">
            <strong>A space for the next arrival.</strong>
            <small>Sample visual only · not live inventory or a real listing photo</small>
          </figcaption>
        </figure>
      </section>

      <section className="home-search-band page-wrap">
        <div className="home-search-band__item"><span className="home-search-band__icon"><CarFront size={20} /></span><div><strong>For the next stop</strong><span>Browse price, place and vehicle fit.</span></div><Link to="/consumer/search" aria-label="Browse parking"><ArrowUpRight size={18} /></Link></div>
        <div className="home-search-band__item"><span className="home-search-band__icon"><UsersRound size={20} /></span><div><strong>For the spare space</strong><span>List your driveway or private bay.</span></div><Link to="/provider/dashboard" aria-label="Open provider dashboard"><ArrowUpRight size={18} /></Link></div>
        <div className="home-search-band__item"><span className="home-search-band__icon"><ShieldCheck size={20} /></span><div><strong>Clear by design</strong><span>See what’s sample and what’s live.</span></div><Link to="/auth/sign-up" aria-label="Create an account"><ArrowUpRight size={18} /></Link></div>
      </section>

      <section className="home-story page-wrap">
        <div className="home-story__intro">
          <div className="eyebrow">MADE FOR THE ARRIVAL</div>
          <h2>Find it. Book it.<br /><em>Get on with your day.</em></h2>
          <p>ParkMate brings local parking into one calm, clear view. Compare the hourly rate, check the details and choose the stop that fits.</p>
          <Link className="text-link" to="/consumer/search">Explore sample spaces <ArrowRight size={15} /></Link>
        </div>
        <div className="home-story__steps">
          <article><span>01</span><div><MapPin size={18} /><h3>Choose the area</h3><p>Search a street or nearby landmark. In demo mode, the inventory is fictional and labelled.</p></div><ArrowDownRight size={18} /></article>
          <article><span>02</span><div><CalendarCheck2 size={18} /><h3>Set your window</h3><p>Pick a start and end time, then compare clear hourly rates and listing details.</p></div><ArrowDownRight size={18} /></article>
          <article><span>03</span><div><Sparkles size={18} /><h3>Keep a Plan B</h3><p>If a real request conflicts, or you simulate one in demo mode, Parking Rescue shows alternatives.</p></div><ArrowDownRight size={18} /></article>
        </div>
      </section>

      <section className="home-rescue page-wrap">
        <div className="home-rescue__mark"><ArrowUpRight size={22} /></div>
        <div><div className="eyebrow">A PLAN B, WITH A CLEAR LABEL</div><h2>Hit a parking dead end?</h2><p>Parking Rescue keeps alternatives close. Demo suggestions are not live availability.</p></div>
        <Link to="/consumer/rescue" className="button button--light">Open Parking Rescue <ArrowRight size={15} /></Link>
      </section>

      <section className="home-bottom page-wrap"><div><span className="eyebrow">YOUR SPACE CAN HELP SOMEONE ARRIVE</span><h2>That empty driveway<br /><em>could be someone’s shortcut.</em></h2></div><Link className="button button--primary" to="/provider/dashboard">Become a provider <ArrowUpRight size={16} /></Link></section>
    </>
  );
}
