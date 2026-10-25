// Runs supabase/tests/db_tests.sql against DATABASE_URL, prints PASS/FAIL, and saves UTF-8 evidence.
require('dotenv').config();
const fs = require('fs'); const path = require('path'); const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false } });
  await c.connect();
  const res = await c.query(fs.readFileSync(path.join(__dirname, '../supabase/tests/db_tests.sql'), 'utf8'));
  const rows = (Array.isArray(res) ? res[res.length - 1] : res).rows;
  let failed = 0; const lines = [`# DB test results - ${new Date().toISOString()}`];
  for (const r of rows) { lines.push(`${r.passed ? 'PASS' : 'FAIL'}  ${r.name}${r.passed ? '' : '  -> ' + r.detail}`); if (!r.passed) failed++; }
  lines.push('', `${rows.length - failed}/${rows.length} passed`);
  const out = lines.join('\n');
  console.log(out);
  fs.mkdirSync(path.join(__dirname, '../docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../docs/evidence/db-test-results.txt'), out + '\n', 'utf8'); // always UTF-8
  await c.end(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('DB test run failed:', e.message); process.exit(2); });
