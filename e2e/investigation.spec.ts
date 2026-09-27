import { test, expect, type Page } from '@playwright/test';

/**
 * TRACE — end-to-end smoke tests against the served fixture cases.
 *
 * The investigation is rendered as a walkable, Duolingo-style path: a header
 * with replay controls, a serpentine trail of event nodes, and a docked
 * evidence receipt. These assertions are deliberately behaviour- and
 * data-driven (accessible names + contract-backed text), not styling-bound, so
 * they survive cosmetic change. All data is the committed fixture cache — no
 * Nansen key, no network, no credits.
 *
 * The landing page (/) is intentionally a blank slate here and is covered once
 * its rebuild lands; these tests exercise the case surface directly.
 */

const CASE_ID = 'case_euler_2023';
const CASE_PATH = `/cases/${CASE_ID}`;

const stepCounter = (page: Page) => page.getByText(/^\d+\/\d+$/);

test.describe('case path', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CASE_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('renders the reconstruction header, hero and trail', async ({ page }) => {
    // Back-to-cases affordance and the completeness verdict.
    await expect(page.getByRole('link', { name: 'Cases' })).toBeVisible();
    // The Euler fixture cache is structurally incomplete by design.
    await expect(page.getByText('Incomplete', { exact: true }).first()).toBeVisible();
    // Hero identifies the chain the incident lives on.
    await expect(page.getByText(/ethereum/i).first()).toBeVisible();
    // The replay counter starts at the first of N steps.
    await expect(stepCounter(page)).toHaveText(/^1\/\d+$/);
  });

  test('replay controls step forward and back through the trail', async ({ page }) => {
    const counter = stepCounter(page);
    const total = Number((await counter.textContent())!.split('/')[1]);
    expect(total).toBeGreaterThan(1);

    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(counter).toHaveText(`2/${total}`);

    await page.getByRole('button', { name: 'Previous step' }).click();
    await expect(counter).toHaveText(`1/${total}`);

    // At the very first step there is nowhere further back.
    await expect(page.getByRole('button', { name: 'Previous step' })).toBeDisabled();
  });

  test('restart returns the cursor to the first step', async ({ page }) => {
    const counter = stepCounter(page);
    await page.getByRole('button', { name: 'Next step' }).click();
    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(counter).toHaveText(/^3\/\d+$/);

    await page.getByRole('button', { name: 'Restart' }).click();
    await expect(counter).toHaveText(/^1\/\d+$/);
  });

  test('the docked evidence receipt tracks the active step', async ({ page }) => {
    // "The receipt" panel is always present for the active event.
    await expect(page.getByRole('heading', { name: 'The receipt' })).toBeVisible();
    await page.getByRole('button', { name: 'Next step' }).click();
    // Still exactly one receipt after advancing — it re-binds, not stacks.
    await expect(page.getByRole('heading', { name: 'The receipt' })).toHaveCount(1);
  });
});

test('the second built-in (FTX) reconstruction also serves', async ({ page }) => {
  await page.goto('/cases/case_ftx_2022');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/ethereum/i).first()).toBeVisible();
});

test('an unknown case id renders the friendly 404', async ({ page }) => {
  await page.goto('/cases/case_does_not_exist');
  await expect(page.getByRole('heading', { level: 1, name: /No such case/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Back to cases/i })).toBeVisible();
});
