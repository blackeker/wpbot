import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function extractDramadizilerim(pageUrl) {
  console.log(`[Dramadizilerim Extractor] ${pageUrl}`);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  let capturedVideoUrl = null;
  let showTitle = 'Dramadizilerim Video';

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });

    const urlObj = new URL(pageUrl);
    const requestedEpisode = urlObj.searchParams.get('e') || '1';

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const frame = req.frame();
      const frameUrl = frame ? frame.url() : '';

      const isVideo = (url.includes('.m3u8') || url.includes('.mp4')) &&
                      !url.includes('tr-TR') &&
                      !url.includes('init.mp4') &&
                      !/_[0-9]+\.mp4/.test(url);

      if (isVideo) {
        if (frameUrl.includes(`episode=${requestedEpisode}`)) {
          if (!capturedVideoUrl) {
            capturedVideoUrl = url;
            console.log(`[Dramadizilerim Extractor] Captured video URL: ${url}`);
          }
        }
      }
      req.continue();
    });

    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Extract title
    showTitle = await page.title().catch(() => 'Dramadizilerim Video');
    showTitle = showTitle.replace(/\s*[-–|]\s*(İzle|izle|Türkçe|Dramadizilerim).*/i, '').trim();

    // Click lazy player if exists
    const lazyPlayer = await page.$('.lazy-player');
    if (lazyPlayer) {
      await page.click('.lazy-player');
      
      // Wait for matching url (up to 20 seconds)
      for (let i = 0; i < 20; i++) {
        if (capturedVideoUrl) break;
        await sleep(1000);
      }
    }

    await browser.close();

    if (capturedVideoUrl) {
      return {
        title: showTitle,
        url: capturedVideoUrl,
        referer: 'https://dramadizilerim.com/',
        source: 'DramaDizilerim'
      };
    }
    
    throw new Error('Video kaynağı yakalanamadı.');
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}
