import { test, expect } from '@playwright/test';

// Slice 1 exit criterion: the app shell loads and renders with no network,
// served from the service-worker precache.
test('app shell loads and renders while offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('dashboard-ready')).toBeVisible();

  // Wait for the service worker to control the page (precache in place).
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 15_000,
  });

  // Kill the network and reload — the shell must still come up from cache.
  await context.setOffline(true);
  await page.reload();

  await expect(page.getByTestId('dashboard-ready')).toBeVisible();
  await expect(page.getByTestId('net-status')).toHaveText('Offline');
});
