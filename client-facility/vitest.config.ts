import { defineConfig } from 'vitest/config';

// Unit tests (store logic, reducers) run in Node with a fake IndexedDB. The
// Playwright offline suite lives in e2e/ and is run separately.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
