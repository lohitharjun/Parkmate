// Daily job: permanently deletes every account whose grace period (DELETION_GRACE_DAYS, default 30) is over.
// Run it as a Render Cron Job:  npm run purge:accounts   (needs the same env vars as the web service)
// Exit code 1 when an account could not be deleted, so Render shows the run as failed.
// Accounts that still have future bookings on their listings are skipped and retried the next day.
require('dotenv').config();
const pool = require('../src/db');
const { purgeExpired, GRACE_DAYS } = require('../src/lib/account-deletion');

(async () => {
  try {
    const r = await purgeExpired({ limit: Number(process.env.PURGE_BATCH) || 50 });
    console.log(JSON.stringify({ job: 'purge-deleted-accounts', grace_days: GRACE_DAYS, ...r, at: new Date().toISOString() }));
    process.exitCode = r.failed.length ? 1 : 0;
  } catch (e) {
    console.error('purge-deleted-accounts failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
