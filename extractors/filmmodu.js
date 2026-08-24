import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';

export async function extractFilmModu(pageUrl) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const title = $('h1').text().trim() || 'FilmModu_Movie';

    let iframeSrc = $('iframe').attr('src');
    if (iframeSrc && iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;

    if (iframeSrc) {
      const pRes = await gotScraping({
        url: iframeSrc,
        headers: { 'Referer': pageUrl }
      });

      const m3u8Match = pRes.body.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
      if (m3u8Match) {
        return {
          title,
          source: 'filmmodu',
          url: m3u8Match[0],
          directUrl: m3u8Match[0],
          isHls: true
        };
      }
    }

    throw new Error('FilmModu video bağlantısı bulunamadı.');
  } catch (err) {
    throw new Error(`FilmModu extraction error: ${err.message}`);
  }
}
