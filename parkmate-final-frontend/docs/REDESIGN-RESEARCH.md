# ParkMate redesign research notes

## Sources reviewed

- **SiteReel:** The requested `https://sitereel.com/` opens a domain-sale page rather than an active visual research service. I did not claim to have used a SiteReel gallery.
- **Siteinspire:** `https://www.siteinspire.com/` returned a Vercel security checkpoint in the isolated browser, so its gallery could not be inspected.
- **Awwwards:** The public websites directory at `https://www.awwwards.com/websites/` was accessible and presents an award-gallery of varied website compositions. It is used only for broad art-direction cues such as confident typography, intentional negative space, and deliberate image framing; ParkMate will not copy a listed site's identity or layout.
- **Aceternity UI:** The official Card Spotlight page at `https://ui.aceternity.com/components/card-spotlight` describes a radial-gradient spotlight applied to a card. ParkMate adapts that idea narrowly for the leading Parking Rescue alternative; it does not adopt a full Tailwind/Framer component or add a dependency.

## Applied decisions

Use the existing deep-evergreen and warm-ivory identity with a fresh-lime action accent; improve hierarchy and spacing across the current React pages; keep status and data-source labels visible; and use original text-free generated urban-parking visuals on the landing hero and listing-detail screen, both explicitly illustrative. Keep map artwork and all sample data clearly fictional. Use small CSS transitions only. Rive is not added because CSS meets the motion need more accessibly and without an unnecessary runtime.

## Asset delivery check

The generated managed images rendered in the Webdev screenshot captures, but the actual public Preview browser returned the Vite SPA HTML (HTTP 200 `text/html`) for the same relative `/manus-storage/...` URLs. The generated assets remain referenced as the preferred hosted images; no second upload was made. Original, text-free SVG fallback scenes are included at `public/assets/parkmate-hero-fallback.svg` and `public/assets/parkmate-detail-fallback.svg`, so the public Preview and an ordinary local Vite run do not show empty image panels. Both versions are explicitly illustrative, not real listing photographs.
