const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const file = 'file://' + path.resolve(__dirname, 'paw-mobile-mock.html');
  const out = path.resolve(__dirname, '..', 'assets', 'paw-mobile-chat-mock.png');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 560, height: 1080, deviceScaleFactor: 2 });
  await page.goto(file, { waitUntil: 'networkidle0' });
  // Tight crop around the device
  const el = await page.$('.device');
  await el.screenshot({ path: out, omitBackground: false });
  await browser.close();
  console.log('wrote', out);
})().catch(e => { console.error(e); process.exit(1); });
