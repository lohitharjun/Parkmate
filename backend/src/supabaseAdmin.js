require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
// null when the key is not set, so local dev still works without it
module.exports = key
  ? createClient(process.env.SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;