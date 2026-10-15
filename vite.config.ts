import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_URL ?? 'http://localhost:4000';

export default defineConfig({
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
});
