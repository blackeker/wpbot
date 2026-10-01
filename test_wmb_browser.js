import { chromium } from 'playwright';

async function testFetchRoutes() {
  console.log('Launching browser to inspect ElazigKart wheremybus...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  let routesData = null;
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/wheremybus/routes') && res.status() === 200) {
      try {
        routesData = await res.json();
        console.log('Intercepted routes response!');
      } catch (e) {}
    }
  });

  try {
    await page.goto('https://elazigkart.elazig.bel.tr/wheremybus', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);

    if (routesData) {
      console.log('Routes Data Count:', routesData.data?.routes?.length || routesData.routes?.length || routesData.length);
      const list = routesData.data?.routes || routesData.routes || routesData;
      console.log('First 10 routes:', list.slice(0, 10).map(r => `${r.routeCode}: ${r.shortTitle || r.title}`));
    } else {
      console.log('Routes data not intercepted yet, evaluating in page...');
      const evalData = await page.evaluate(async () => {
        try {
          const res = await window.fetch('/api/wheremybus/routes');
          return await res.json();
        } catch (e) {
          return { error: e.message };
        }
      });
      console.log('Page eval data:', evalData);
    }
  } catch (err) {
    console.log('Browser err:', err.message);
  } finally {
    await browser.close();
  }
}

testFetchRoutes();
