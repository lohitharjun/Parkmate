// Mounted at /api/me
//   GET    /                    my profile (+ deletion state)
//   GET    /export              everything stored about me (JSON)
//   POST   /deletion-request    start the grace period: pause my listings, delete for good after DELETION_GRACE_DAYS (default 30)
//   DELETE /deletion-request    change my mind: restore the account
//   DELETE /                    delete the account right now
// The two "delete" actions need a login from the last REAUTH_WINDOW_SECONDS (default 5 minutes), see auth.requireRecentLogin.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRecentLogin } = require('../auth');
const { bad, wrap } = require('../errors');
const acct = require('../lib/account-deletion');

const router = express.Router();

const needConfirm = (req) => {
  if ((req.body || {}).confirm !== 'DELETE') throw bad('Send {"confirm":"DELETE"} to delete your account');
};

router.get('/', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, full_name, phone, is_admin, deletion_requested_at FROM profiles WHERE id = $1', [req.user.id]);
  const me = rows[0] || {};
  res.json({ data: { ...me, email: req.user.email, deletion_scheduled_for: acct.scheduledFor(me.deletion_requested_at) } });
}));

router.get('/export', requireAuth, wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await acct.exportData(req.user) });
}));

router.post('/deletion-request', requireAuth, requireRecentLogin, wrap(async (req, res) => {
  needConfirm(req);
  res.json({ data: await acct.requestDeletion(req.user.id) });
}));

router.delete('/deletion-request', requireAuth, wrap(async (req, res) => {
  res.json({ data: await acct.cancelDeletion(req.user.id) });
}));

router.delete('/', requireAuth, requireRecentLogin, wrap(async (req, res) => {
  needConfirm(req);
  res.json({ data: await acct.deleteAccount(req.user.id, { method: 'immediate' }) });
}));

module.exports = router;
