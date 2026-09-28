import { test, expect, type Page } from '@playwright/test';

/**
 * TRACE — end-to-end smoke tests against the served library.
 *
 * The investigation now renders as a docked workspace: a metrics header, a
 * replayable event timeline (a progressbar + accessible replay controls), a
 * per-event evidence receipt, and the Nansen authority panel. The landing page,
 * the /reconstruct scope form, and the client-side /verify drop-in are covered
 * too. Assertions are behaviour- and data-driven (accessible names, roles, and
 * contract-backed text), not styling-bound, so they survive cosmetic change.
 *
 * All data is the committed fixture library — no Nansen key, no network, no
 * credits. The /verify test round-trips a served contract through the API and
 * back into the client verifier; the /reconstruct test never fires a paid run.
 */

const EULER_ID = 'case_euler_2023';
const FTX_ID = 'case_ftx_2022';
const EULER_PATH = `/cases/${EULER_ID}`;

const progressbar = (page: Page) => page.getByRole('progressbar');
const receipt = (page: Page) => page.getByRole('complementary', { name: 'Evidence receipt' });
const receiptTitle = (page: Page) => receipt(page).getByRole('heading', { level: 2 });

test.describe('case workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EULER_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('renders header, coverage verdict and step metrics', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Cases' })).toBeVisible();
    // The Euler fixture cache is structurally incomplete by design.
    await expect(page.getByText('Incomplete', { exact: true }).first()).toBeVisible();
    // The eyebrow identifies the chain the incident lives on.
    await expect(page.getByText(/ethereum/i).first()).toBeVisible();
    // The replay cursor starts on the first event.
    await expect(progressbar(page)).toHaveAttribute('aria-valuenow', '1');
  });

  test('“select next” advances the cursor and re-binds the receipt', async ({ page }) => {
    const bar = progressbar(page);
    await expect(bar).toHaveAttribute('aria-valuenow', '1');
    const firstTitle = (await receiptTitle(page).textContent())?.trim() ?? '';
    expect(firstTitle.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Select next event' }).click();

    await expect(bar).toHaveAttribute('aria-valuenow', '2');
    // Exactly one receipt — it re-binds to the new event, it does not stack.
    await expect(receiptTitle(page)).toHaveCount(1);
    await expect(receiptTitle(page)).not.toHaveText(firstTitle);
  });

  test('reset returns the cursor to the first step', async ({ page }) => {
    const bar = progressbar(page);
    await page.getByRole('button', { name: 'Select next event' }).click();
    await page.getByRole('button', { name: 'Select next event' }).click();
    await expect(bar).toHaveAttribute('aria-valuenow', '3');

    await page.getByRole('button', { name: 'Reset replay' }).click();
    await expect(bar).toHaveAttribute('aria-valuenow', '1');
  });

  test('the trail ends at the last step, where “select next” is disabled', async ({ page }) => {
    const steps = page.getByRole('list').getByRole('listitem');
    const total = await steps.count();
    expect(total).toBeGreaterThan(1);

    // Jump straight to the final event by selecting it in the timeline.
    await steps.last().getByRole('button').click();
    await expect(progressbar(page)).toHaveAttribute('aria-valuenow', String(total));
    await expect(page.getByRole('button', { name: 'Select next event' })).toBeDisabled();
  });

  test('the Nansen authority panel accounts for what was resolved', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'What Nansen resolved' })).toBeVisible();
    await expect(page.getByText('NANSEN AUTHORITY')).toBeVisible();
    await expect(page.getByText(/\d+ citations/).first()).toBeVisible();
  });
});

test('the FTX built-in also serves its workspace', async ({ page }) => {
  await page.goto(`/cases/${FTX_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/ethereum/i).first()).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
});

test('the FTX workspace surfaces open leads, fenced as not-evidence, that jump the cursor', async ({ page }) => {
  await page.goto(`/cases/${FTX_ID}`);
  // The leads channel is its own section, explicitly marked NOT evidence.
  const leads = page.getByRole('region', { name: 'Where the trail could go next' });
  await expect(leads.getByRole('heading', { name: 'Where the trail could go next' })).toBeVisible();
  await expect(leads.getByText('NOT EVIDENCE').first()).toBeVisible();

  const bar = page.getByRole('progressbar');
  await expect(bar).toHaveAttribute('aria-valuenow', '1');
  // Clicking a supporting-event chip re-binds the replay cursor to that event.
  await leads.getByRole('button').first().click();
  await expect(bar).not.toHaveAttribute('aria-valuenow', '1');
});

test('an unknown case id renders the friendly 404', async ({ page }) => {
  await page.goto('/cases/case_does_not_exist');
  await expect(page.getByRole('heading', { level: 1, name: /No such case/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Back to cases/i })).toBeVisible();
});

test('the landing page presents the library and primary actions', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /Follow the evidence/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Investigations' })).toBeVisible();
  // The built-in Euler case is always in the library and links to its workspace.
  await expect(page.getByRole('link', { name: /Euler Finance exploit/i })).toBeVisible();
  // The two live surfaces are reachable from the primary nav.
  await expect(page.getByRole('link', { name: 'Reconstruct', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Verify', exact: true })).toBeVisible();
});

test('the reconstruct form renders scoped, and stays inert without a key', async ({ page }) => {
  await page.goto('/reconstruct');
  await expect(page.getByRole('heading', { level: 1, name: /Reconstruct from an address/i })).toBeVisible();
  await expect(page.getByText(/This spends Nansen credits/i)).toBeVisible();
  // With no address, window, or key the run cannot fire — nothing can spend credits.
  await expect(page.getByRole('button', { name: /Run reconstruction/i })).toBeDisabled();
});

test('the verify page re-verifies a served case entirely client-side', async ({ page }) => {
  await page.goto('/verify');
  await expect(page.getByRole('heading', { level: 1, name: /Verify a case file/i })).toBeVisible();

  // Pull a real served contract, then feed it back into the client verifier.
  const resp = await page.request.get(`/api/cases/${EULER_ID}`);
  expect(resp.ok()).toBeTruthy();
  const json = await resp.text();

  await page.locator('input[type="file"]').setInputFiles({
    name: `${EULER_ID}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(json, 'utf-8'),
  });

  // The served artifact re-derives clean: verdict holds and a fingerprint is shown.
  await expect(page.getByText('Artifact verified')).toBeVisible();
  await expect(page.getByText(/Content fingerprint/i)).toBeVisible();
});
