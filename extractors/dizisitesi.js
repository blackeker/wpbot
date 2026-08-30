import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';
import { getAndUnpack } from '../extractor.js';
import { getSharedBrowser } from '../utils/browser.js';

async function resolveEmbedUrl(embedUrl) {
  console.log(`[Embed Resolver] Attempting to resolve: ${embedUrl}`);
  try {
    if (embedUrl.includes('vidmoly')) {
      const res = await gotScraping.get({ url: embedUrl, timeout: { request: 10000 } });
      const m3u8Match = res.body.match(/file\s*:\s*"([^"]+\.m3u8[^"]*)"/) || res.body.match(/"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/);
      if (m3u8Match) {
        return m3u8Match[1];
      }
    } else if (embedUrl.includes('filemoon')) {
      const res = await gotScraping.get({ url: embedUrl, timeout: { request: 10000 } });
      const $ = cheerio.load(res.body);
      let packedScript = '';
      $('script').each((_, el) => {
        const text = $(el).html() || '';
        if (text.includes('eval(function(p,a,c,k,e,')) {
          packedScript = text;
        }
      });
      if (packedScript) {
        const unpacked = getAndUnpack(packedScript);
        const m3u8Match = unpacked.match(/file\s*:\s*"([^"]+\.m3u8[^"]*)"/) || unpacked.match(/file\s*:\s*'([^']+\.m3u8[^']*)'/) || unpacked.match(/src\s*:\s*"([^"]+\.m3u8[^"]*)"/);
        if (m3u8Match) {
          return m3u8Match[1];
        }
      }
    }
  } catch (err) {
    console.error(`[Embed Resolver] Failed for ${embedUrl}: ${err.message}`);
  }
  return null;
}

export async function extractDiziSitesi(pageUrl, siteName = 'Film/Dizi Sitesi') {
  console.log(`[${siteName} Extractor] Using shared browser for: ${pageUrl}`);
  let page;
  try {
    const browser = await getSharedBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });

    console.log(`[${siteName} Extractor] Navigating to page...`);
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    // Click all source/player tabs/buttons to force iframes to render
    await page.evaluate(() => {
      const selectors = [
        'a', 'button', 'li', 'span', 'div.player-option', 
        '.source-item', '.play-btn', '.video-tab'
      ];
      const buttons = Array.from(document.querySelectorAll(selectors.join(',')))
        .filter(el => {
          const text = el.innerText?.toLowerCase() || '';
          return text.includes('vidmoly') || text.includes('filemoon') || text.includes('player') || text.includes('tab') || text.includes('moly') || text.includes('moon');
        });
      buttons.forEach(btn => {
        try { btn.click(); } catch(e) {}
      });
    });
    
    // Wait briefly for elements to render
    await new Promise(r => setTimeout(r, 4000));

    // Extract page title
    const pageTitle = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.innerText.replace(/izle/i, '').trim() : document.title;
    });

    // Scrape all iframe URLs
    const iframes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe'))
        .map(iframe => iframe.src || iframe.getAttribute('data-src') || '')
        .filter(src => src.startsWith('http'));
    });

    console.log(`[${siteName} Extractor] Found ${iframes.length} iframes.`, iframes);

    // Prioritize Vidmoly and Filemoon iframes
    const supportedIframes = iframes.filter(src => src.includes('vidmoly') || src.includes('filemoon'));
    
    for (const embedUrl of supportedIframes) {
      const videoUrl = await resolveEmbedUrl(embedUrl);
      if (videoUrl) {
        console.log(`[${siteName} Extractor] Successfully extracted video: ${videoUrl}`);
        return {
          title: pageTitle,
          url: videoUrl,
          referer: embedUrl,
          source: siteName
        };
      }
    }
  } catch (err) {
    console.error(`[${siteName} Extractor] Error: ${err.message}`);
  } finally {
    if (page) {
      try { await page.close(); } catch (e) {}
    }
  }

  throw new Error(`${siteName} indirme bağlantısı alınamadı. Desteklenen bir video kaynağı (Vidmoly/Filemoon) bulunamadı.`);
}
