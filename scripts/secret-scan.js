// Scans TRACKED files only (git ls-files) so a local .env or node_modules never causes noise.
// Outside a git repo it scans all files except node_modules/.git/.env. Placeholders (YOUR_*) are allowed.
// Pure Node: works on Windows, Mac and Linux (no bash needed).
const { execSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
process.chdir(root);

function git(cmd) { return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name !== '.env') out.push(path.relative(root, p));
  }
  return out;
}

let files, mode, fail = false;
try {
  git('rev-parse --is-inside-work-tree');
  files = git('ls-files').split('\n').filter(Boolean); mode = 'tracked files';
  if (files.includes('.env')) { console.log('!! .env is tracked by git - remove it: git rm --cached .env'); process.exit(1); }
} catch (_) { files = walk(root); mode = 'all files (not a git repo)'; }

const skip = (f) => /secret-scan\.(js|sh)$|package-lock\.json$/.test(f);
const checks = [
  ['JWT-looking token', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9]+/],
  ['service_role key assignment', /SERVICE_ROLE[A-Z_]*=.+/],
  ['DB URL with real password', /postgres(ql)?:\/\/[^:@/\s]+:[^@\s]{6,}@[a-z0-9.-]+\.(supabase|pooler)/i],
];
const ignoreLine = /YOUR_|placeholder|example/i;

for (const f of files) {
  if (skip(f) || !fs.existsSync(f)) continue;
  let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  if (text.includes('\u0000')) continue; // binary
  text.split('\n').forEach((line, i) => {
    for (const [label, re] of checks) {
      if (re.test(line) && !ignoreLine.test(line)) { console.log(`${f}:${i + 1}: ${label}`); fail = true; }
    }
  });
}
const gi = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
if (!gi.includes('.env')) { console.log('!! .env is not in .gitignore'); fail = true; }

if (fail) { console.log('\nsecret-scan: PROBLEMS FOUND (see above)'); process.exit(1); }
console.log(`secret-scan: clean (${mode})`);
