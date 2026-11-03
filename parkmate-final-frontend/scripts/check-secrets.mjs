#!/usr/bin/env node
// Fails if anything that looks like a server-side secret is about to ship in the browser bundle.
// Run automatically before and after `build`; also: `pnpm check:secrets`.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const targets = process.argv.includes('--dist') ? ['dist'] : ['src', 'index.html', '.env', '.env.local', '.env.production', '.env.development'];
const TEXT = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.html', '.css', '.json', '.map', '']);

const rules = [
  ['Supabase service-role key', /SUPABASE_SERVICE_ROLE|service_role_key/i],
  ['VITE_ variable holding a secret', /VITE_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD)[A-Z0-9_]*\s*=\s*\S+/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Stripe secret key', /\bsk_(?:live|test)_[0-9A-Za-z]{16,}/],
  ['AWS secret/access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[0-9A-Za-z]{30,}/],
];

function jwtRole(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role; } catch { return null; }
}

function* walk(path) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isFile()) { yield path; return; }
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules') continue;
    yield* walk(join(path, entry));
  }
}

const problems = [];
for (const target of targets) {
  for (const file of walk(join(root, target))) {
    if (!TEXT.has(extname(file))) continue;
    const text = readFileSync(file, 'utf8');
    const shown = file.replace(root, '');
    for (const [label, re] of rules) if (re.test(text)) problems.push(`${shown}: ${label}`);
    for (const m of text.matchAll(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g)) {
      if (jwtRole(m[0]) === 'service_role') problems.push(`${shown}: a Supabase service_role JWT`);
    }
  }
}

if (problems.length) {
  console.error('\n✖ Secret check failed. Remove these before building or deploying:\n');
  for (const p of [...new Set(problems)]) console.error('  - ' + p);
  console.error('\nOnly the Supabase anon (public) key may be used in the frontend. Keep secrets on the backend.\n');
  process.exit(1);
}
console.log('✔ Secret check passed: no server-side secrets found in the frontend.');
