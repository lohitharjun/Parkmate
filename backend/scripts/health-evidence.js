// Starts the API twice (DB connected, DB disconnected), calls /health and /api/health, writes docs/evidence/health-results.md
require('dotenv').config();
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(port, child, state) {
  for (let i = 0; i < 24; i++) {            // up to ~12 s
    if (state.exited) return false;
    try { await fetch(`http://localhost:${port}/`); return true; } catch (_) { await sleep(500); }
  }
  return false;
}

async function run(label, port, env) {
  const state = { exited: false, log: '' };
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => (state.log += d)); child.stderr.on('data', (d) => (state.log += d));
  child.on('exit', () => (state.exited = true));
  const up = await waitUp(port, child, state);
  const out = [];
  if (!up) out.push('SERVER DID NOT START. Output:\n' + (state.log.trim() || '(none)'));
  else for (const p of ['/health', '/api/health']) {
    const t = Date.now();
    try { const r = await fetch(`http://localhost:${port}${p}`); out.push(`GET ${p} -> ${r.status} ${JSON.stringify(await r.json())} (${Date.now() - t} ms)`); }
    catch (e) { out.push(`GET ${p} -> request failed: ${e.message}`); }
  }
  child.kill(); await sleep(300);
  return `### ${label}\n\`\`\`\n${out.join('\n')}\n\`\`\`\n`;
}
(async () => {
  const md = `# /health evidence\nGenerated ${new Date().toISOString()}\n\n` +
    await run('DB connected (real DATABASE_URL)', 5101, {}) +
    await run('DB disconnected (unreachable host)', 5102, { DATABASE_URL: 'postgresql://user:pass@127.0.0.1:1/postgres', DB_SSL: 'false' });
  fs.writeFileSync(path.join(__dirname, '../docs/evidence/health-results.md'), md); console.log(md);
})();
