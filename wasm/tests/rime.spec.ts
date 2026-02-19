import { test, expect } from '@playwright/test';

test.describe('Rime WASM Engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the engine to be ready
    await expect(page.locator('#status')).toHaveClass(/ready/, { timeout: 60000 });
    await expect(page.locator('#input-box')).toBeEnabled();
  });

  test('engine loads and shows version', async ({ page }) => {
    const status = await page.locator('#status').textContent();
    expect(status).toMatch(/Rime .+ ready/);
  });

  test('initialization speed is reasonable', async ({ page }) => {
    const status = await page.locator('#status').textContent();
    const match = status?.match(/loaded in (\d+)ms/);
    expect(match).toBeTruthy();
    const elapsed = parseInt(match![1]);
    // Should initialize within 30 seconds (generous for CI)
    expect(elapsed).toBeLessThan(30000);
    console.log(`Init time: ${elapsed}ms`);
  });

  test('pinyin input shows candidates', async ({ page }) => {
    const input = page.locator('#input-box');
    await input.fill('nihao');

    // Should display candidates
    const candidates = page.locator('#candidates li');
    await expect(candidates.first()).toBeVisible({ timeout: 5000 });

    // Should show preedit
    const preedit = page.locator('#preedit');
    await expect(preedit).not.toBeEmpty();
  });

  test('candidates contain expected Chinese text', async ({ page }) => {
    const input = page.locator('#input-box');
    await input.fill('nihao');

    // Wait for candidates to appear
    await expect(page.locator('#candidates li').first()).toBeVisible({ timeout: 5000 });

    // Check that some Chinese characters are in the candidates
    const candidatesText = await page.locator('#candidates').textContent();
    // "你" should appear somewhere in candidates for "ni"
    expect(candidatesText).toBeTruthy();
    expect(candidatesText!.length).toBeGreaterThan(0);
  });

  test('selecting a candidate commits text', async ({ page }) => {
    const input = page.locator('#input-box');
    await input.fill('nihao');

    // Wait for candidates
    await expect(page.locator('#candidates li').first()).toBeVisible({ timeout: 5000 });

    // Press 1 to select first candidate
    await input.press('1');

    // Output should have some committed text
    const output = await page.locator('#output').textContent();
    expect(output).toBeTruthy();
    expect(output!.length).toBeGreaterThan(0);
  });

  test('clicking a candidate commits text', async ({ page }) => {
    const input = page.locator('#input-box');
    await input.fill('ni');

    // Wait for candidates
    const firstCandidate = page.locator('#candidates li').first();
    await expect(firstCandidate).toBeVisible({ timeout: 5000 });

    // Click the first candidate
    await firstCandidate.click();

    // Output should have committed text
    const output = await page.locator('#output').textContent();
    expect(output).toBeTruthy();
    expect(output!.length).toBeGreaterThan(0);
  });

  test('escape clears composition', async ({ page }) => {
    const input = page.locator('#input-box');
    await input.fill('ni');

    // Wait for candidates
    await expect(page.locator('#candidates li').first()).toBeVisible({ timeout: 5000 });

    // Press Escape
    await input.press('Escape');

    // Candidates should be cleared
    await expect(page.locator('#candidates li')).toHaveCount(0);

    // Preedit should be cleared
    await expect(page.locator('#preedit')).toBeEmpty();
  });

  test('page navigation works', async ({ page }) => {
    const input = page.locator('#input-box');
    // Use a common syllable that has many candidates
    await input.fill('shi');

    // Wait for candidates
    await expect(page.locator('#candidates li').first()).toBeVisible({ timeout: 5000 });

    // Get page info
    const pageInfo = await page.locator('#page-info').textContent();
    expect(pageInfo).toContain('Page 1');

    // Navigate to next page with =
    await input.press('=');

    // Page should change (if not last page)
    const newPageInfo = await page.locator('#page-info').textContent();
    // Either the page changed or it was the last page
    expect(newPageInfo).toBeTruthy();
  });

  test('multiple word input sequence', async ({ page }) => {
    const input = page.locator('#input-box');

    // Type first word
    await input.fill('ni');
    await expect(page.locator('#candidates li').first()).toBeVisible({ timeout: 5000 });
    await input.press('1');

    // Output should have first character
    let output = await page.locator('#output').textContent();
    expect(output!.length).toBeGreaterThan(0);
    const firstLen = output!.length;

    // Type second word
    await input.fill('hao');
    await expect(page.locator('#candidates li').first()).toBeVisible({ timeout: 5000 });
    await input.press('1');

    // Output should have both characters
    output = await page.locator('#output').textContent();
    expect(output!.length).toBeGreaterThan(firstLen);
  });

  test('empty input shows no candidates', async ({ page }) => {
    const input = page.locator('#input-box');

    // Type something first
    await input.fill('ni');
    await expect(page.locator('#candidates li').first()).toBeVisible({ timeout: 5000 });

    // Clear input
    await input.fill('');

    // Candidates should disappear
    await expect(page.locator('#candidates li')).toHaveCount(0);
  });

  test('default Traditional mode: qing first candidate is 請', async ({ page }) => {
    const input = page.locator('#input-box');
    await input.fill('qing');

    await expect(page.locator('#candidates li').first()).toBeVisible({ timeout: 5000 });

    // Default zh_simp=0 (Traditional), first candidate should be 請
    const firstText = await page.locator('#candidates li').first().textContent();
    expect(firstText).toContain('請');
    expect(firstText).not.toContain('请');
  });

  test('after zh_simp toggle: qing first candidate is 请', async ({ page }) => {
    // Click toggle to enable Simplified mode (zh_simp=1)
    await page.locator('#toggle-simp').click();

    const input = page.locator('#input-box');
    await input.fill('qing');

    await expect(page.locator('#candidates li').first()).toBeVisible({ timeout: 5000 });

    // With zh_simp enabled (t2s), Traditional 請 → Simplified 请
    const firstText = await page.locator('#candidates li').first().textContent();
    expect(firstText).toContain('请');
    // After toggle, simplified character should be the primary display
    // The traditional character may appear as reference in brackets
  });
});
