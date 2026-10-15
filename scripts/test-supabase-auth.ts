import 'dotenv/config';

if (process.env.SUPABASE_AUTH_TEST !== 'true') throw new Error('Set SUPABASE_AUTH_TEST=true to authorize temporary Supabase test identities. No emails are sent.');
process.env.AUTH_ACCEPTANCE_TEST = 'true';
process.argv.push('--supabase');
await import('./test-authentication.js');
