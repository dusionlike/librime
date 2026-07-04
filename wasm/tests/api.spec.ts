import { test, expect } from '@playwright/test';

test.describe('Rime WASM Engine New API', () => {
  test('API test page: all tests pass', async ({ page }) => {
    // Capture all console messages for debugging
    const consoleMsgs: string[] = [];
    page.on('console', msg => {
      consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
      console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', err => {
      console.log(`[PAGE ERROR] ${err.message}`);
    });

    await page.goto('/api-test.html');

    // Wait for the test to complete
    await expect(page.locator('#result')).not.toHaveText('Running...', { timeout: 120000 });

    const text = await page.locator('#result').textContent();
    const detail = await page.locator('#detail').textContent();

    // Log test details for debugging
    console.log('Test results:');
    if (detail) {
      for (const line of detail.split('\n')) {
        if (line.includes('FAIL') || line.includes('PASS') || line.includes('===') || line.includes('exception')) {
          console.log(`  ${line}`);
        }
      }
    }

    // Log any console errors
    const errors = consoleMsgs.filter(m => m.startsWith('[error]') || m.startsWith('[PAGE ERROR]'));
    if (errors.length > 0) {
      console.log('=== BROWSER ERRORS ===');
      for (const e of errors) console.log(e);
    }

    expect(text).toBe('ALL PASSED');
  });
});