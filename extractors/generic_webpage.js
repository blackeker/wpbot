import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';

puppeteer.use(StealthPlugin());

export async function extractGenericWebpage(pageUrl, siteName = 'Video') {
  console.log(`[${siteName} Extractor] Launching browser for: ${pageUrl}`);
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });

    let detectedVideoUrl = null;

    // Sniff network requests for m3u8 or mp4 URLs
    page.on('request', request => {
      const url = request.url();
      const urlLower = url.toLowerCase();
      if (
        urlLower.includes('.m3u8') || 
        (urlLower.includes('.mp4') && !urlLower.includes('ad') && !urlLower.includes('banner'))
      ) {
        if (!detectedVideoUrl || urlLower.includes('.m3u8')) {
          detectedVideoUrl = url;
        }
      }
    });

    console.log(`[${siteName} Extractor] Loading page...`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Extract title
    const title = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.innerText.trim() : document.title.trim();
    });

    // Simulate clicking play buttons
    await page.evaluate(() => {
      const playSelectors = [
        'video', 'iframe', 'button.play', '.play-btn', '.player-button',
        '[class*="play"]', 'svg[class*="play"]', '.play-icon'
      ];
      for (const sel of playSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          els.forEach(el => {
            try { el.click(); } catch(e) {}
          });
        } catch (e) {}
      }
    });

    // Wait up to 10 seconds for the request to load and be captured
    for (let i = 0; i < 20; i++) {
      if (detectedVideoUrl) break;
      await new Promise(r => setTimeout(r, 500));
    }

    if (detectedVideoUrl) {
      console.log(`[${siteName} Extractor] Network request match: ${detectedVideoUrl}`);
      await browser.close();
      return {
        title: title || 'Video',
        source: siteName,
        url: detectedVideoUrl,
        directUrl: detectedVideoUrl,
        referer: pageUrl
      };
    }

    // DOM Fallback
    const domUrl = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video && video.src && video.src.startsWith('http')) return video.src;
      
      const source = document.querySelector('video source');
      if (source && source.src && source.src.startsWith('http')) return source.src;

      const iframe = document.querySelector('iframe');
      if (iframe && iframe.src && iframe.src.startsWith('http')) return iframe.src;

      return null;
    });

    if (domUrl) {
      console.log(`[${siteName} Extractor] DOM match: ${domUrl}`);
      await browser.close();
      return {
        title: title || 'Video',
        source: siteName,
        url: domUrl,
        directUrl: domUrl,
        referer: pageUrl
      };
    }

    // yt-dlp Fallback
    console.log(`[${siteName} Extractor] Trying yt-dlp fallback...`);
    try {
      const { exec } = await import('child_process');
      const { getYtDlpCommand, getProxyUrl } = await import('../config.js');
      const ytDlpCmd = getYtDlpCommand();
      const activeProxy = getProxyUrl();
      const proxyArg = activeProxy ? ` --proxy "${activeProxy}"` : '';
      const env = { ...process.env };
      const ytDlpDir = path.dirname(ytDlpCmd);
      const separator = process.platform === 'win32' ? ';' : ':';
      env.PATH = `${ytDlpDir}${separator}/usr/local/bin${separator}/usr/bin${separator}/bin${separator}${env.PATH || ''}`;

      const ytDlpUrl = await new Promise((resolve, reject) => {
        exec(`"${ytDlpCmd}" -g${proxyArg} "${pageUrl}"`, { env }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        });
      });
      if (ytDlpUrl) {
        await browser.close();
        return {
          title: title || 'Video',
          source: siteName,
          url: ytDlpUrl,
          directUrl: ytDlpUrl,
          referer: pageUrl
        };
      }
    } catch (ytDlpErr) {
      console.warn(`[${siteName} Extractor] yt-dlp fallback failed: ${ytDlpErr.message}`);
    }

    throw new Error('Video bağlantısı çözülemedi.');
  } catch (err) {
    if (browser) await browser.close();
    throw err;
  }
}
