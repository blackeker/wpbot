import { getSharedPage } from '../utils/browser.js';
import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';

export async function extractDizipal(pageUrl) {
  console.log(`[Dizipal Extractor] Resolving Dizipal page: ${pageUrl}`);
  
  // ── 1. Hızlı HTTP Çözümleme (Chrome / Puppeteer gerektirmez, 100ms) ──
  try {
    const res = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(res.body);
    const title = $('h1').text().replace(/izle/i, '').trim() || $('title').text().replace(/ - Dizipal.*/, '').trim() || 'Dizipal Video';

    let embedUrl = null;

    // Check for Base64 encoded cfg parameter in HTML
    const cfgMatch = res.body.match(/cfg\s*[:=]\s*["']?([^"'\s&>]+)["']?/i);
    if (cfgMatch) {
      try {
        const decoded = Buffer.from(cfgMatch[1], 'base64').toString('utf8');
        const json = JSON.parse(decoded);
        if (json.v) {
          embedUrl = json.v;
        }
      } catch (e) {}
    }

    // Check for direct iframe in HTML
    if (!embedUrl) {
      $('iframe').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && src.startsWith('http')) embedUrl = src;
      });
    }

    if (embedUrl) {
      console.log(`[Dizipal Extractor - HTTP Fast Path] Resolved embed player URL: ${embedUrl}`);
      const embedRes = await gotScraping.get({
        url: embedUrl,
        headers: {
          'Referer': res.url,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
      });

      const embedBody = embedRes.body;
      let m3u8Url = null;
      let subtitles = [];

      const m3u8Match = embedBody.match(/var\s+M3U8\s*=\s*["']([^"']+\.m3u8[^"']*)["']/) ||
                        embedBody.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/) ||
                        embedBody.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);

      if (m3u8Match) {
        m3u8Url = m3u8Match[1] || m3u8Match[0];
      }

      const subMatch = embedBody.match(/subtitle\s*:\s*["']([^"']+)["']/);
      if (subMatch) {
        const subStr = subMatch[1];
        const parts = subStr.split(',');
        for (const p of parts) {
          const m = p.match(/\[([^\]]+)\](https?:\/\/[^\s,]+)/);
          if (m) {
            const langLabel = m[1];
            const subUrl = m[2];
            subtitles.push({
              url: subUrl,
              language: (langLabel.toLowerCase().includes('türk') || langLabel.toLowerCase().includes('turkish')) ? 'tur' : 'eng',
              label: langLabel
            });
          }
        }
      }

      if (m3u8Url) {
        console.log(`[Dizipal Extractor - HTTP Fast Path] Success! Stream: ${m3u8Url}`);
        return {
          title,
          url: m3u8Url,
          referer: embedUrl,
          subtitles,
          source: 'Dizipal'
        };
      }
    }
  } catch (httpErr) {
    console.warn(`[Dizipal Extractor - HTTP Fast Path] Skipped/Failed (${httpErr.message}), falling back to Puppeteer...`);
  }

  // ── 2. Puppeteer İle Gelişmiş Çözümleme (Fallback) ──
  let page;
  try {
    page = await getSharedPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });

    let embedUrl = null;
    let directStreamUrl = null;

    // Listen to network responses to catch the player embed URL or stream URL instantly
    page.on('response', async res => {
      const u = res.url();
      if (u.includes('.m3u8') || u.includes('.mp4')) {
        if (!directStreamUrl) directStreamUrl = u;
      } else if (u.includes('/ajax') || u.includes('/player') || u.includes('/video/')) {
        try {
          const body = await res.text();
          if (body.includes('"v":')) {
            const json = JSON.parse(body);
            if (json.config && json.config.v) {
              embedUrl = json.config.v;
            }
          }
        } catch (e) {}
      }
    });

    console.log(`[Dizipal Extractor] Navigating with Puppeteer...`);
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 35000 });

    // Extract page title
    const title = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.innerText.replace(/izle/i, '').trim() : document.title.replace(/ - Dizipal.*/, '').trim();
    });

    // If direct stream URL was intercepted by Puppeteer
    if (directStreamUrl) {
      console.log(`[Dizipal Extractor] Direct stream intercepted: ${directStreamUrl}`);
      return {
        title: title || 'Dizipal Video',
        url: directStreamUrl,
        source: 'Dizipal'
      };
    }

    // If embedUrl was not captured via AJAX, search DOM iframes
    if (!embedUrl) {
      embedUrl = await page.evaluate(() => {
        const iframe = document.querySelector('iframe');
        return iframe ? (iframe.src || iframe.getAttribute('data-src')) : null;
      });
    }

    console.log(`[Dizipal Extractor] Resolved embed player URL: ${embedUrl}`);
    if (!embedUrl) {
      throw new Error("Dizipal oyuncu bağlantısı alınamadı.");
    }

    // Fetch the embed player page to extract M3U8 and Subtitles
    const embedRes = await gotScraping.get({
      url: embedUrl,
      headers: {
        'Referer': page.url(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });

    const embedBody = embedRes.body;
    let m3u8Url = null;
    let subtitles = [];

    // Match M3U8 playlist URL
    const m3u8Match = embedBody.match(/var\s+M3U8\s*=\s*["']([^"']+\.m3u8[^"']*)["']/) ||
                      embedBody.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/) ||
                      embedBody.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);

    if (m3u8Match) {
      m3u8Url = m3u8Match[1] || m3u8Match[0];
    }

    // Match Subtitles (VTT)
    const subMatch = embedBody.match(/subtitle\s*:\s*["']([^"']+)["']/);
    if (subMatch) {
      const subStr = subMatch[1];
      const parts = subStr.split(',');
      for (const p of parts) {
        const m = p.match(/\[([^\]]+)\](https?:\/\/[^\s,]+)/);
        if (m) {
          const langLabel = m[1];
          const subUrl = m[2];
          subtitles.push({
            url: subUrl,
            language: (langLabel.toLowerCase().includes('türk') || langLabel.toLowerCase().includes('turkish')) ? 'tur' : 'eng',
            label: langLabel
          });
        }
      }
    }

    if (m3u8Url) {
      console.log(`[Dizipal Extractor] Extraction successful! Stream: ${m3u8Url}`);
      return {
        title: title || 'Dizipal Video',
        url: m3u8Url,
        referer: embedUrl,
        subtitles,
        source: 'Dizipal'
      };
    }

    throw new Error("Dizipal M3U8 video akışı bulunamadı.");

  } catch (err) {
    console.error(`[Dizipal Extractor] Error: ${err.message}`);
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}
