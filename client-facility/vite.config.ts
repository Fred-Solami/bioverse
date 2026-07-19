import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Offline-first PWA (DESIGN.md §13). vite-plugin-pwa (Workbox) precaches the
// built app shell so the app *loads* with no network; the outbox/sync engine
// handles data offline.
//
// Updates are PROMPTED, not automatic. With autoUpdate + skipWaiting a new
// worker takes over live tabs mid-session: the running page keeps executing the
// old JS while the new precache serves new assets, so lazy chunks from the old
// build 404 (the classic stale-shell failure). In a clinical field app that can
// break a half-finished referral. Instead the new worker stays in `waiting`
// until the user accepts (see components/UpdatePrompt.tsx).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
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
        // Claim uncontrolled clients on FIRST install so an immediate offline
        // reload is already served from cache (no second visit required).
        clientsClaim: true,
        // But never displace an already-running worker: an update waits for the
        // user. UpdatePrompt calls updateServiceWorker(true) to skip waiting.
        skipWaiting: false,
      },
      devOptions: { enabled: true },
    }),
  ],
  // Force a single React instance — Vite's dep pre-bundling can otherwise load
  // two copies (one optimized, one not) and trigger "invalid hook call".
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    // Dev: proxy API calls to the local server (see server/.env, port 3000).
    proxy: { '/api': 'http://localhost:3000' },
  },
});
