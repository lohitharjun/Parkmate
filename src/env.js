require('dotenv').config();
// Fail fast with a clear message instead of a cryptic crash later.
const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missing = required.filter((k) => !process.env[k] || process.env[k].includes('YOUR_'));
if (missing.length) {
  console.error(`Missing or placeholder environment variables: ${missing.join(', ')}\nCopy .env.example to .env and fill them in (see docs/DEPLOYMENT.md).`);
  process.exit(1);
}
