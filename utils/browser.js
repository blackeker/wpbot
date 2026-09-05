import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

let sharedBrowser = null;
let browserLaunchPromise = null;

export async function getSharedBrowser() {
  if (sharedBrowser) return sharedBrowser;

  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }

  browserLaunchPromise = (async () => {
    console.log('[Browser Manager] Launching shared Puppeteer browser instance...');
    sharedBrowser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    sharedBrowser.on('disconnected', () => {
      console.warn('[Browser Manager] Shared browser disconnected. Resetting references...');
      sharedBrowser = null;
      browserLaunchPromise = null;
    });

    return sharedBrowser;
  })();

  return browserLaunchPromise;
}

export async function getSharedPage() {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort().catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });
  } catch (e) {}
  return page;
}

export async function closeSharedBrowser() {
  if (sharedBrowser) {
    console.log('[Browser Manager] Closing shared Puppeteer browser...');
    try {
      await sharedBrowser.close();
    } catch (e) {
      console.error('[Browser Manager] Error closing shared browser:', e.message);
    }
    sharedBrowser = null;
    browserLaunchPromise = null;
  }
}
