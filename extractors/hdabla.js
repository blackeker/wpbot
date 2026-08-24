import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
import * as cheerio from 'cheerio';
export
// ==========================================
// HDABLA DECRYPTER AND RESOLVER FUNCTIONS
// ==========================================
async function extractHdabla(pageUrl) {
  try {
    const pageRes = await gotScraping.get({
      url: pageUrl
    });
    const $ = cheerio.load(pageRes.body);
    const title = $('h1.entry-title').text().trim() || $('meta[property="og:title"]').attr('content')?.trim() || $('title').text().replace(/izle/i, '').trim() || 'HdAbla Video';

    // Sniff direct source elements or fallback to amp-iframe or iframe
    let videoUrl = $('video source').attr('src');
    if (!videoUrl) {
      videoUrl = $('amp-iframe').attr('src') || $('iframe').attr('src');
    }
    if (!videoUrl) {
      throw new Error("HdAbla video oynatıcı kaynağı bulunamadı.");
    }
    if (videoUrl.startsWith('//')) {
      videoUrl = 'https:' + videoUrl;
    }

    // If videoUrl points to an embedded player (e.g. oynat.php / fakitonye / player)
    if (videoUrl.includes('oynat.php') || videoUrl.includes('player') || videoUrl.includes('embed') || videoUrl.includes('fakitonye')) {
      try {
        const playerRes = await gotScraping.get({
          url: videoUrl,
          headers: {
            'Referer': 'https://hdabla.net/'
          }
        });
        const bodyText = playerRes.body;
        const fileMatch = bodyText.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || bodyText.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*/i);
        if (fileMatch) {
          videoUrl = fileMatch[1] || fileMatch[0];
        }
      } catch (e) {
        console.error("HdAbla iframe player fetch failed:", e.message);
      }
    }
    return {
      title,
      source: 'HdAbla',
      url: videoUrl,
      referer: 'https://hdabla.net/'
    };
  } catch (err) {
    throw new Error(`HdAbla ayıklama hatası: ${err.message}`);
  }
}

// Main extract function