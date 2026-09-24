import { test, expect, type Page } from '@playwright/test';

/**
 * TRACE — end-to-end interaction tests against the served Euler contract.
 *
 * These reproduce the interactions verified by hand during the UI build:
 * single-selection sync across timeline / inspector / graph, keyboard-driven
 * evidence replay, follow-the-money, the below-threshold noise filter, and the
 * light/dark theme switch. All data is the committed fixture cache — no Nansen
 * key, no network, no credits. Selectors are accessible-name based, so they
 * assert behaviour rather than styling.
 */

const CASE_ID = 'case_euler_2023';
const CASE_PATH = `/cases/${CASE_ID}`;

const eventCards = (page: Page) => page.getByRole('button', { name: /^Select event / });
const currentEvents = (page: Page) => page.locator('button[aria-current="true"]');
const replaySlider = (page: Page) => page.getByRole('slider', { name: /^Replay position/ });

test('Command Center opens the Euler investigation', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: /^Something happened onchain\./ }),
  ).toBeVisible();
  await page.getByRole('link', { name: /^Open investigation:/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('Command Center lists and opens the second (FTX) investigation', async ({ page }) => {
  await page.goto('/');
  const links = page.getByRole('link', { name: /^Open investigation:/ });
  await expect(links).toHaveCount(2); // Euler + FTX are both served
  const ftx = page.getByRole('link', { name: /Open investigation:.*FTX/ });
  await expect(ftx).toBeVisible();
  await ftx.click();
  await expect(page).toHaveURL(/\/cases\/case_ftx_2022$/);
  await expect(page.getByText('INCIDENT · case_ftx_2022 · ethereum')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Timeline', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Evidence replay', exact: true })).toBeVisible();
  await expect(currentEvents(page)).toHaveCount(1); // a default selection exists on load
});

test.describe('case page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CASE_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('renders the reconstruction header and core regions', async ({ page }) => {
    await expect(page.getByText(`INCIDENT · ${CASE_ID} · ethereum`)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Timeline', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Evidence replay', exact: true })).toBeVisible();
    await expect(currentEvents(page)).toHaveCount(1); // a default selection exists on load
  });

  test('single-selection model: one timeline event is current, and it moves', async ({ page }) => {
    const cards = eventCards(page);
    expect(await cards.count()).toBeGreaterThan(1);
    await expect(cards.first()).toHaveAttribute('aria-current', 'true'); // first primary by default
    await cards.nth(1).click();
    await expect(currentEvents(page)).toHaveCount(1);
    await expect(cards.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(cards.first()).not.toHaveAttribute('aria-current', 'true');
  });

  test('an entity chip opens the entity inspector', async ({ page }) => {
    await page.getByRole('button', { name: /^Inspect entity / }).first().click();
    await expect(page.locator('aside[aria-label^="Entity "]')).toBeVisible();
    await expect(page.getByRole('heading', { name: /EVIDENCE INSPECTOR · ENTITY/ })).toBeVisible();
    await expect(currentEvents(page)).toHaveCount(0); // an entity selection is not an event
  });

  test('a graph edge opens the relationship inspector', async ({ page }) => {
    // The graph sits below the sticky inspector; activate via keyboard so the
    // pinned overlay can't intercept the click (same onSelectEdge path).
    const edge = page.getByRole('button', { name: /^Select relationship / }).first();
    await edge.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('aside[aria-label^="Relationship "]')).toBeVisible();
  });

  test('evidence replay steps with the keyboard', async ({ page }) => {
    const slider = replaySlider(page);
    const max = await slider.getAttribute('max');
    expect(max).not.toBeNull();
    await expect(slider).toHaveValue('0'); // cursor starts at the first event

    // Focus a control inside the replay region so its key handler receives keys.
    await page.getByRole('button', { name: 'Restart replay (Home)' }).focus();
    await page.keyboard.press('End');
    await expect(slider).toHaveValue(max as string);
    await page.keyboard.press('Home');
    await expect(slider).toHaveValue('0');
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveValue('1');
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveValue('0');
  });

  test('evidence replay plays and pauses', async ({ page }) => {
    await page.getByRole('button', { name: 'Play replay (Space)' }).click();
    await expect(page.getByRole('button', { name: 'Pause replay (Space)' })).toBeVisible();
    await page.getByRole('button', { name: 'Pause replay (Space)' }).click();
    await expect(page.getByRole('button', { name: 'Play replay (Space)' })).toBeVisible();

    // Space from the scrubber (an INPUT, no native activation) toggles via the
    // region key map — the hand-verified keyboard path.
    await replaySlider(page).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause replay (Space)' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Play replay (Space)' })).toBeVisible();
  });

  test('follow-the-money advances to the next observed movement', async ({ page }) => {
    const followBtn = page.getByRole('button', { name: /to next observed movement/ });
    // The default selection is followable; scan as a fallback should that change.
    if (!(await followBtn.isVisible().catch(() => false))) {
      const cards = eventCards(page);
      const n = await cards.count();
      for (let i = 0; i < n; i++) {
        await cards.nth(i).click();
        if (await followBtn.isVisible().catch(() => false)) break;
      }
    }
    await expect(followBtn).toBeVisible();
    const toId = (await followBtn.getAttribute('aria-label'))?.match(/movement (\S+)$/)?.[1];
    expect(toId, 'follow names an arrival event').toBeTruthy();

    await followBtn.click();
    await expect(page.locator(`aside[aria-label="Evidence for ${toId}"]`)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Back to / })).toBeVisible(); // trail back-ref
  });

  test('the noise filter reveals and hides below-threshold events', async ({ page }) => {
    const showAll = page.getByRole('button', { name: /^Show all \d+ below-threshold events$/ });
    await expect(showAll).toBeVisible();
    const hidden = Number((await showAll.textContent())?.match(/(\d+)/)?.[1]);
    expect(hidden).toBeGreaterThan(0);

    const cards = eventCards(page);
    const before = await cards.count();
    await showAll.click();
    await expect(cards).toHaveCount(before + hidden);

    const hide = page.getByRole('button', { name: /^Hide \d+ below-threshold events$/ });
    await hide.click();
    await expect(cards).toHaveCount(before);
  });

  test('theme toggle flips dark mode and persists the choice', async ({ page }) => {
    const html = page.locator('html');
    await expect(html).not.toHaveClass(/dark/); // SSR default is light
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(html).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
    const cookie = (await page.context().cookies()).find((c) => c.name === 'trace-theme');
    expect(cookie?.value).toBe('dark');
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(html).not.toHaveClass(/dark/);
  });
});
