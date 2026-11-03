import { Clock3, MapPin, ShieldCheck } from 'lucide-react';

// Decorative, non-interactive city map for the sign-in / sign-up side panel.
// It loads no tiles and calls no service, so it is instant and works offline.
// Streets, prices and positions are made up — the panel says so.
const PINS = [
  { x: 128, y: 604, price: '₹45' },
  { x: 338, y: 452, price: '₹55' },
  { x: 488, y: 392, price: '₹40' },
  { x: 236, y: 214, price: '₹75' },
  { x: 508, y: 650, price: '₹60' },
];

function Pin({ x, y, price }) {
  return (
    <g className="auth-map__pin" transform={`translate(${x} ${y})`}>
      <rect className="auth-map__chip" x="-25" y="-36" width="50" height="25" rx="12.5" />
      <path className="auth-map__chip-tail" d="M-5 -11 L0 -4 L5 -11 Z" />
      <text className="auth-map__chip-text" x="0" y="-23" textAnchor="middle" dominantBaseline="central">{price}</text>
      <circle className="auth-map__dot" cx="0" cy="0" r="4" />
    </g>
  );
}

export default function AuthMap() {
  return (
    <aside className="auth-map" aria-label="Illustrative map of nearby parking">
      <svg className="auth-map__svg" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustrative city map with a suggested route to a nearby parking space. Sample data, not a live map.">
        <defs>
          <filter id="auth-map-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7" /></filter>
        </defs>
        <rect className="auth-map__land" width="600" height="800" />

        {/* city blocks */}
        <g className="auth-map__blocks">
          <rect x="22" y="40" width="82" height="64" rx="8" /><rect x="190" y="30" width="96" height="70" rx="8" /><rect x="320" y="40" width="110" height="58" rx="8" /><rect x="506" y="46" width="76" height="76" rx="8" />
          <rect x="30" y="150" width="70" height="96" rx="8" /><rect x="188" y="136" width="108" height="84" rx="8" /><rect x="330" y="132" width="76" height="92" rx="8" /><rect x="452" y="160" width="100" height="70" rx="8" />
          <rect x="30" y="338" width="86" height="78" rx="8" /><rect x="206" y="344" width="86" height="74" rx="8" /><rect x="390" y="330" width="62" height="60" rx="8" /><rect x="500" y="320" width="82" height="80" rx="8" />
          <rect x="36" y="430" width="70" height="60" rx="8" /><rect x="372" y="480" width="86" height="64" rx="8" /><rect x="506" y="462" width="76" height="70" rx="8" />
          <rect x="28" y="656" width="76" height="92" rx="8" /><rect x="196" y="690" width="100" height="76" rx="8" /><rect x="372" y="700" width="92" height="70" rx="8" /><rect x="520" y="716" width="64" height="62" rx="8" />
        </g>

        {/* parks and river */}
        <path className="auth-map__park" d="M300 470 q40 -18 78 4 q22 30 -6 60 q-48 14 -80 -14 q-16 -26 8 -50 Z" />
        <path className="auth-map__park" d="M36 520 q36 -22 70 -4 q18 26 -4 48 q-44 10 -66 -12 q-6 -18 0 -32 Z" />
        <path className="auth-map__water" d="M-30 560 C 110 520, 210 604, 340 566 S 520 516, 640 560" />

        {/* minor streets */}
        <g className="auth-map__minor">
          <path d="M0 126 H600" /><path d="M0 238 H600" /><path d="M0 426 H600" /><path d="M0 512 H600" /><path d="M0 640 H600" /><path d="M0 770 H600" />
          <path d="M60 0 V800" /><path d="M308 0 V800" /><path d="M420 0 V800" /><path d="M560 0 V800" />
        </g>

        {/* main roads */}
        <g className="auth-map__roads">
          <path className="auth-map__road auth-map__road--wide" d="M-20 300 C 140 278, 260 342, 380 300 S 560 250, 640 272" />
          <path className="auth-map__road" d="M124 -20 C 148 160, 92 300, 172 440 S 262 700, 230 820" />
          <path className="auth-map__road" d="M470 -20 C 430 150, 522 282, 470 420 S 420 640, 500 820" />
          <path className="auth-map__road" d="M-20 724 C 160 690, 400 520, 640 396" />
        </g>

        {/* suggested route */}
        <path className="auth-map__route-glow" d="M62 724 C 142 640, 152 520, 232 470 S 332 362, 332 304 S 404 252, 432 236" filter="url(#auth-map-glow)" />
        <path className="auth-map__route" d="M62 724 C 142 640, 152 520, 232 470 S 332 362, 332 304 S 404 252, 432 236" />

        {/* area labels */}
        <g className="auth-map__labels">
          <text x="76" y="392">GUINDY</text><text x="232" y="596">ADYAR</text><text x="438" y="108">T. NAGAR</text><text x="402" y="560">MYLAPORE</text>
        </g>

        {PINS.map((pin) => <Pin key={pin.price + pin.x} {...pin} />)}

        {/* start */}
        <g transform="translate(62 724)"><circle className="auth-map__start-halo" r="15" /><circle className="auth-map__start" r="7" /></g>

        {/* best-fit destination */}
        <g className="auth-map__best" transform="translate(432 236)">
          <circle className="auth-map__pulse" r="12" />
          <rect className="auth-map__best-chip" x="-44" y="-50" width="88" height="31" rx="15.5" />
          <path className="auth-map__best-tail" d="M-6 -19 L0 -9 L6 -19 Z" />
          <text className="auth-map__best-text" x="0" y="-34" textAnchor="middle" dominantBaseline="central">Best fit · ₹45</text>
          <circle className="auth-map__best-dot" r="6" />
        </g>
      </svg>

      <span className="auth-map__badge"><MapPin size={13} aria-hidden="true" /> Chennai · illustrative map</span>

      <div className="auth-map__card">
        <p className="auth-map__quote">“Less circling. <em>More arriving.</em>”</p>
        <ul className="auth-map__chips">
          <li><ShieldCheck size={13} aria-hidden="true" /> Clear hourly prices</li>
          <li><MapPin size={13} aria-hidden="true" /> Spaces near you</li>
          <li><Clock3 size={13} aria-hidden="true" /> Book by the hour</li>
        </ul>
        <small>Sample streets, positions and prices — not a live map.</small>
      </div>
    </aside>
  );
}
