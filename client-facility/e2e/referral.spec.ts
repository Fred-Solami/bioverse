import { test, expect } from '@playwright/test';

// Slice 3 e2e — the headline: create a referral with the network cut and have
// it persist. Requires the API + a seeded DB, so it's gated on E2E_API and
// wired into CI at Slice 6 (docs/PWA-PLAN.md) alongside the offline-shell suite.
const RUN = !!process.env.E2E_API;
const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!dev123';

test.describe(RUN ? 'offline referral creation' : 'offline referral (skipped: set E2E_API)', () => {
  test.skip(!RUN, 'needs a running API + seeded DB');

  test('a referral can be created offline and survives a reload', async ({ page, context }) => {
    // Sign in (online).
    await page.goto('/login');
    await page.fill('input[name="username"]', 'staff.a');
    await page.fill('input[name="password"]', PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('new-referral')).toBeVisible();

    // Ensure a patient exists and is cached locally (pick it once, online).
    const token = await page.evaluate(async (pw) => {
      const login = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: 'staff.a', password: pw }),
      });
      const { accessToken } = await login.json();
      await fetch('/api/v1/patients', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + accessToken },
        credentials: 'include',
        body: JSON.stringify({
          given_name: 'Mercy',
          family_name: 'Phiri',
          district: 'Lufwanyama',
          identifiers: [{ id_type: 'NRC', id_value: '990101/61/1' }],
        }),
      });
      return accessToken;
    }, PASSWORD);
    expect(token).toBeTruthy();

    await page.getByTestId('new-referral').click();
    await page.getByTestId('patient-search').fill('Phiri');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.locator('.picker-hit').first().click();
    await expect(page.getByTestId('patient-selected')).toBeVisible();

    // Cut the network — everything from here is offline.
    await context.setOffline(true);

    await page.getByTestId('reason').fill('Severe pre-eclampsia — airplane mode');
    await page.getByRole('button', { name: 'Emergency' }).click();
    await page.locator('.check input').first().check();
    await page.getByTestId('referral-submit').click();

    // It lands in the list with a pending-sync badge, with no network.
    await expect(page.getByTestId('referral-list')).toBeVisible();
    await expect(page.getByTestId('pending-badge')).toBeVisible();
    await expect(page.getByText('Severe pre-eclampsia — airplane mode')).toBeVisible();

    // Still offline — reload and confirm it persisted in IndexedDB.
    await page.reload();
    await expect(page.getByText('Severe pre-eclampsia — airplane mode')).toBeVisible();
  });
});
