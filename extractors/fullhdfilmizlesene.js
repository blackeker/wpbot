import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';

export async function extractFullHDFilmIzlesene(pageUrl) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const title = $('h1').text().trim() || $('title').text().trim() || 'FullHDFilmIzlesene_Movie';

    let playerUrl = '';
    $('iframe').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && (src.includes('player') || src.includes('embed') || src.includes('rapid') || src.includes('vidmoly'))) {
        playerUrl = src;
      }
    });

    if (playerUrl.startsWith('//')) playerUrl = 'https:' + playerUrl;

    if (playerUrl) {
      const pRes = await gotScraping({
        url: playerUrl,
        headers: { 'Referer': pageUrl }
      });
      const pBody = pRes.body;
      const m3u8Match = pBody.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
      if (m3u8Match) {
        return {
          title,
          source: 'fullhdfilmizlesene',
          url: m3u8Match[0],
          directUrl: m3u8Match[0],
          isHls: true
        };
      }
    }

    throw new Error('FullHDFilmIzlesene video kaynağı bulunamadı.');
  } catch (err) {
    throw new Error(`FullHDFilmIzlesene extraction error: ${err.message}`);
  }
}
