// Who may see / change a listing. Shared by the listing, photo and admin routes.
const pool = require('../db');
const { isUuid } = require('./validate');
const { notFound, forbidden } = require('../errors');

async function loadListing(id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query('SELECT * FROM listings WHERE id = $1', [id]);
  return rows[0] || null;
}

const isOwnerOrAdmin = (listing, user) => !!user && (user.id === listing.owner_id || !!user.isAdmin);
const canView = (listing, user) => !!listing && (listing.status === 'approved' || isOwnerOrAdmin(listing, user));

// the logged-in user must own the listing (req.params.id)
async function loadOwnedListing(req) {
  const l = await loadListing(req.params.id);
  if (!l) throw notFound('Listing not found');
  if (l.owner_id !== req.user.id) {
    // someone else's approved listing is visible, so 403; someone else's pending/rejected is invisible, so 404
    if (l.status === 'approved' || req.user.isAdmin) throw forbidden('Only the owner can change this listing');
    throw notFound('Listing not found');
  }
  return l;
}

module.exports = { loadListing, loadOwnedListing, isOwnerOrAdmin, canView };
