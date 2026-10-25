// Runs tests/api.test.js, prints the output and saves it as UTF-8 evidence (PowerShell's ">" would write UTF-16).
const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', path.join(__dirname, '../tests/api.test.js')], { encoding: 'utf8' });
const out = `# API test results - ${new Date().toISOString()}\n` + r.stdout + (r.stderr || '');
console.log(out);
fs.mkdirSync(path.join(__dirname, '../docs/evidence'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '../docs/evidence/api-test-results.txt'), out, 'utf8');
process.exit(r.status || 0);
