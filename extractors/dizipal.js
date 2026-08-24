import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';

export async function extractDizipal(pageUrl) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const title = $('title').text().replace(/ - Dizipal.*/, '').trim() || 'Dizipal_Video';

    let iframeSrc = $('iframe').attr('src');
    if (!iframeSrc) {
      $('iframe').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src) iframeSrc = src;
      });
    }

    if (!iframeSrc) {
      throw new Error('Dizipal player iFrame bulunamadı.');
    }

    if (iframeSrc.startsWith('//')) {
      iframeSrc = 'https:' + iframeSrc;
    }

    // Process player iframe
    const playerRes = await gotScraping({
      url: iframeSrc,
      headers: {
        'Referer': pageUrl,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const playerBody = playerRes.body;
    const m3u8Match = playerBody.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);

    if (m3u8Match) {
      return {
        title,
        source: 'dizipal',
        url: m3u8Match[0],
        directUrl: m3u8Match[0],
        isHls: true
      };
    }

    const mp4Match = playerBody.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
    if (mp4Match) {
      return {
        title,
        source: 'dizipal',
        url: mp4Match[0],
        directUrl: mp4Match[0]
      };
    }

    return {
      title,
      source: 'dizipal',
      url: iframeSrc,
      directUrl: iframeSrc
    };
  } catch (err) {
    throw new Error(`Dizipal extraction error: ${err.message}`);
  }
}
