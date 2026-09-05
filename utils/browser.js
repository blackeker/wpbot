import fs from 'fs';
import puppeteer from 'puppeteer';

let sharedBrowser = null;
let browserLaunchPromise = null;

function findChromeExecutable() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const possiblePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium'
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return undefined;
}

export async function getSharedBrowser() {
  if (sharedBrowser) return sharedBrowser;

  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }

  browserLaunchPromise = (async () => {
    console.log('[Browser Manager] Launching shared Puppeteer browser instance...');
    const executablePath = findChromeExecutable();
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    };
    if (executablePath) {
      console.log(`[Browser Manager] Using system Chrome executable: ${executablePath}`);
      launchOptions.executablePath = executablePath;
    }

    try {
      sharedBrowser = await puppeteer.launch(launchOptions);
    } catch (launchErr) {
      if (launchOptions.executablePath) {
        console.warn('[Browser Manager] System executable launch failed, retrying default launch...', launchErr.message);
        delete launchOptions.executablePath;
        sharedBrowser = await puppeteer.launch(launchOptions);
      } else {
        throw launchErr;
      }
    }

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
