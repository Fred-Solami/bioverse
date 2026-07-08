import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Offline-first PWA (DESIGN.md §13). vite-plugin-pwa (Workbox) precaches the
// built app shell so the app *loads* with no network; the outbox/sync engine
// (later slices) handle data offline. injectRegister:'auto' wires up service
// worker registration without touching app code.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'BioVerse Facility',
        short_name: 'BioVerse',
        description: 'Offline-first referral client for health facilities',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        // Take control of the page on first load so an immediate offline reload
        // is already served from cache (no second visit required).
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: true },
    }),
  ],
  server: {
    // Dev: proxy API calls to the local server (see server/.env, port 3000).
    proxy: { '/api': 'http://localhost:3000' },
  },
});
