const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  async function check(url, label, expectText) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      const text = await page.textContent('body');
      const pass = text && text.includes(expectText);
      results.push({ label, url, status: pass ? 'PASS' : 'FAIL', snippet: pass ? 'found' : 'missing' });
    } catch (e) {
      results.push({ label, url, status: 'ERROR', snippet: e.message });
    }
  }

  await check('https://qazakxolymp.vercel.app/', 'home', 'Олимпиадная');
  await check('https://qazakxolymp.vercel.app/olympiads', 'catalog', 'Олимпиада');
  await check('https://qazakxolymp.vercel.app/olympiads/geography-2026-6', 'geo-card', 'olympiad-detail');
  await check('https://qazakxolymp.vercel.app/olympiads/bad-id-999', 'bad-id', 'Олимпиада не найдена');

  await browser.close();
  console.table(results);
  const allPass = results.every(r => r.status === 'PASS');
  process.exit(allPass ? 0 : 1);
})();
