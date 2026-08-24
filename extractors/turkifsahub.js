import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
import * as cheerio from 'cheerio';
export async function extractTurkifsahub(pageUrl) {
  try {
    const pageRes = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Referer': 'https://turkifsahub.com/',
        'Origin': 'https://turkifsahub.com'
      }
    });
    const $ = cheerio.load(pageRes.body);
    const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || 'Turkifsahub Video';
    let videoUrl = $('video.vjs-tech').attr('src') || $('meta[itemprop="contentUrl"]').attr('content') || $('video source').attr('src');
    if (!videoUrl) {
      throw new Error("Turkifsahub video dosyası bulunamadı.");
    }
    if (videoUrl.startsWith('/')) {
      videoUrl = 'https://turkifsahub.com' + videoUrl;
    }
    return {
      title,
      source: 'Turkifsahub Direct',
      url: videoUrl,
      referer: 'https://turkifsahub.com/'
    };
  } catch (err) {
    throw new Error(`Turkifsahub çözme hatası: ${err.message}`);
  }
}