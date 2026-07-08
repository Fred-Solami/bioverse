import { test, expect } from '@playwright/test';

// Slice 2 e2e. Requires the API server + a seeded DB, so it's gated on E2E_API
// and wired into CI at Slice 6 (docs/PWA-PLAN.md) alongside the offline suite.
const RUN = !!process.env.E2E_API;

test.describe(RUN ? 'auth' : 'auth (skipped: set E2E_API)', () => {
  test.skip(!RUN, 'needs a running API + seeded DB');

  test('an unauthenticated visitor is sent to login', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('valid credentials reach the dashboard; bad ones show an error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'staff.a');
    await page.fill('input[name="password"]', 'wrong-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible();

    await page.fill('input[name="password"]', process.env.SEED_PASSWORD ?? 'ChangeMe!dev123');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('dashboard-ready')).toBeVisible();
    await expect(page.getByTestId('logout')).toBeVisible();
  });
});
