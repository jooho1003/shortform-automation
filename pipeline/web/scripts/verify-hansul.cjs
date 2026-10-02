// Read-only browser checks. Pass an installed Playwright module path when it is not in this workspace.
const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  const evidence = path.resolve(__dirname, '../../../docs/verification/hansul-studio');
  await fs.mkdir(evidence, {recursive: true});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({width: 1440, height: 1000});
    await page.goto('http://localhost:3123/instatoon/hansul');
    await page.getByRole('heading', {name: '한술툰 작업실', exact: true}).waitFor();
    await page.locator('.hs-episode').first().click();
    await page.locator('.hs-steps button').nth(1).click();
    assert.equal(await page.locator('.hs-card').count(), 8);
    await page.screenshot({path: path.join(evidence, 'desktop.png')});
    await page.setViewportSize({width: 390, height: 844});
    for (const stage of [0, 1, 2]) {
      await page.locator('.hs-steps button').nth(stage).click();
      const dimensions = await page.evaluate(() => ({viewport: innerWidth, width: document.documentElement.scrollWidth}));
      assert.ok(dimensions.width <= dimensions.viewport, `stage ${stage}: ${JSON.stringify(dimensions)}`);
    }
    await page.locator('.hs-steps button').nth(1).click();
    await page.locator('.hs-section-heading').scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(evidence, 'mobile.png')});
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({desktop: '1440px, 8 cards', mobile: '390px, no horizontal overflow across all 3 steps', pageErrors: errors, evidence}));
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
