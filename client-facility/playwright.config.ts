import { defineConfig, devices } from '@playwright/test';

// Offline e2e. Runs against the *production build* served by `vite preview`,
// because the service worker (and thus offline capability) only exists in the
// built app, not the dev server.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
