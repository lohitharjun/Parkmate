require('dotenv').config();
const { Pool, types } = require('pg');

// numeric -> JS number (contract: money/coordinates are numbers, not strings)
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const ssl = process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: 10,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
});
// a dropped idle connection must not crash the process
pool.on('error', (err) => console.error('pg pool error:', err.message));

module.exports = pool;
