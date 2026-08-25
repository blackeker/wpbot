import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';
import { extractGenericWebpage } from './generic_webpage.js';

export async function extractJavGuru(pageUrl) {
  console.log(`[JavGuru Extractor] Resolving: ${pageUrl}`);
  try {
    const res = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      }
    });
    const html = res.body;
    const $ = cheerio.load(html);
    const title = $('h1.entry-title').text().trim() || $('title').text().trim() || 'JavGuru Video';

    // Regex to match base64 encoded "iframe_url":"aHR0cHM6Ly..."
    const iframeRegex = /"iframe_url"\s*:\s*"([^"]+)"/gi;
    let match;
    const iframeUrls = [];
    while ((match = iframeRegex.exec(html)) !== null) {
      try {
        const decoded = Buffer.from(match[1], 'base64').toString('utf8');
        if (decoded && decoded.startsWith('http')) {
          iframeUrls.push(decoded);
        }
      } catch (e) {}
    }

    console.log(`[JavGuru Extractor] Decoded iframes:`, iframeUrls);

    // Try to resolve each iframe url
    for (const embedUrl of iframeUrls) {
      try {
        console.log(`[JavGuru Extractor] Attempting iframe: ${embedUrl}`);
        const result = await extractGenericWebpage(embedUrl, 'JavGuru Embed');
        if (result && result.url) {
          return {
            title,
            source: 'JavGuru',
            url: result.url,
            directUrl: result.url,
            referer: embedUrl
          };
        }
      } catch (err) {
        console.warn(`[JavGuru Extractor] Failed to extract iframe ${embedUrl}: ${err.message}`);
      }
    }

    // Fallback: try resolving the main page directly
    return extractGenericWebpage(pageUrl, 'JavGuru');
  } catch (err) {
    throw new Error(`JavGuru ayıklama hatası: ${err.message}`);
  }
}
