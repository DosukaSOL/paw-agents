const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const file = 'file://' + path.resolve(__dirname, '..', 'dashboard-preview.html');
  const out = path.resolve(__dirname, '..', 'assets', 'dashboard-preview.png');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
  await page.goto(file, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log('wrote', out);
})().catch(e => { console.error(e); process.exit(1); });
