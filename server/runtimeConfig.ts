type Environment = Record<string, string | undefined>;

export function clientOrigin(env: Environment = process.env) {
  return (env.CLIENT_ORIGIN || env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, '');
}

export function validateProductionEnvironment(env: Environment = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const required = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'JWT_SECRET'];
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing production environment variables: ${missing.join(', ')}.`);
  if (env.JWT_SECRET!.length < 32 || /replace|demo-secret|change-before/i.test(env.JWT_SECRET!)) {
    throw new Error('JWT_SECRET must be a private, randomly generated value of at least 32 characters.');
  }
  if (!env.CLIENT_ORIGIN && !env.RENDER_EXTERNAL_URL) throw new Error('Set CLIENT_ORIGIN to the deployed dashboard URL.');
  if (new URL(clientOrigin(env)).protocol !== 'https:') throw new Error('Production CLIENT_ORIGIN must use HTTPS.');
  if (env.AUTH_DEMO_DELIVERY === 'true') throw new Error('AUTH_DEMO_DELIVERY must be disabled in production.');
}

export function isDefaultDemoPassword(password: string, env: Environment = process.env) {
  return (env.NODE_ENV === 'production' || Boolean(env.SUPABASE_URL)) && password === 'BalikTelaDemo2026!';
}
