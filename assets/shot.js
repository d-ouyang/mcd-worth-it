const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 2400 }, deviceScaleFactor: 2 });
  await page.goto('file:///Users/ouyangding/Desktop/M-Code/mcd-worth-it/assets/promo-poster.html');
  await page.waitForTimeout(400);
  await page.screenshot({
    path: '/Users/ouyangding/Desktop/M-Code/mcd-worth-it/assets/promo-poster.png',
    fullPage: true
  });
  await browser.close();
  console.log('shot done');
})().catch(e => { console.error(e); process.exit(1); });
