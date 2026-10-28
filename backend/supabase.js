require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
for (const key of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','TEACHER_EMAILS']) {
  if (!process.env[key]) throw new Error(`Missing ${key} in backend/.env`);
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
const auth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, opts);
module.exports = { admin, auth };
