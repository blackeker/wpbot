import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
export async function extractTurkifsalar(pageUrl) {
  try {
    const pageRes = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15',
        'Referer': 'https://turkifsalar2.site/'
      }
    });
    const $ = cheerio.load(pageRes.body);
    const title = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || 'TurkIfsalar Video';
    let videoUrl = $('meta[property="og:video"]').attr('content');
    if (!videoUrl) {
      throw new Error("TurkIfsalar video stream URL bulunamadı.");
    }
    if (videoUrl.startsWith('/')) {
      videoUrl = 'https://turkifsalar2.site' + videoUrl;
    }
    return {
      title,
      source: 'TurkIfsalar M3U8',
      url: videoUrl,
      referer: 'https://turkifsalar2.site/'
    };
  } catch (err) {
    throw new Error(`TurkIfsalar çözme hatası: ${err.message}`);
  }
}