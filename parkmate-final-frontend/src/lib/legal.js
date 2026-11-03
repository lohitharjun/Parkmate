// Shared by the Privacy Policy, Terms of Service and the sign-up consent checkboxes.
export const LEGAL = Object.freeze({
  service: 'ParkMate',
  version: '2026-11-02',
  lastUpdated: '2 November 2026',
  // Optional: set VITE_SUPPORT_EMAIL to show a contact address on the legal pages.
  contactEmail: String(import.meta.env?.VITE_SUPPORT_EMAIL || '').trim(),
});
