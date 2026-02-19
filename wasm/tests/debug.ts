import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({
    args: ['--js-flags=--max-old-space-size=4096'],
  });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`[console.${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.log(`[page-error] ${err.message}`);
  });

  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`[http-error] ${response.status()} ${response.url()}`);
    }
  });

  page.on('crash', () => {
    console.log('[CRASH] Page crashed!');
  });

  console.log('Navigating...');

  try {
    await page.goto('http://localhost:5173/', { timeout: 10000 });
  } catch (e: any) {
    console.log(`[nav-error] ${e.message}`);
  }

  // Wait a bit and check status
  for (let i = 0; i < 20; i++) {
    try {
      const status = await page.locator('#status').textContent({ timeout: 3000 });
      console.log(`[${i}] Status: ${status}`);
      if (status?.includes('ready') || status?.includes('Error')) break;
    } catch {
      console.log(`[${i}] Page not responsive`);
      break;
    }
    await page.waitForTimeout(2000);
  }

  await browser.close();
})();
