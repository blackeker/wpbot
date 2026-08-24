import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';
import path from 'path';

export async function extractMediafire(pageUrl) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const downloadButton = $('#downloadButton');
    let directUrl = downloadButton.attr('href');

    if (!directUrl) {
      // Alternative fallback search
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes('download') && href.includes('mediafire.com')) {
          directUrl = href;
        }
      });
    }

    if (!directUrl) {
      throw new Error('MediaFire indirme bağlantısı bulunamadı.');
    }

    const title = $('.dl-btn-label').text().trim() || $('.filename').text().trim() || path.basename(directUrl.split('?')[0]);

    return {
      title,
      source: 'mediafire',
      url: directUrl,
      directUrl
    };
  } catch (err) {
    throw new Error(`MediaFire extraction error: ${err.message}`);
  }
}
