import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_URL ?? 'http://localhost:4000';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const privateFrontendKeys = Object.keys(env).filter(key => key.startsWith('VITE_') && /SECRET|PASSWORD|PRIVATE|SERVICE_ROLE|DATABASE_URL|DB_URL/i.test(key));
  if (privateFrontendKeys.length) throw new Error(`Remove private frontend environment variables: ${privateFrontendKeys.join(', ')}. Keep credentials server-only.`);
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': apiTarget,
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            charts: ['chart.js', 'react-chartjs-2'],
            react: ['react', 'react-dom'],
          },
        },
      },
    },
  };
});
