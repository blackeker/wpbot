import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';
import { compileMangaPagesToPdf } from '../mangaPdfCompiler.js';

export async function extractMerlinScans(pageUrl) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const title = $('h1').text().trim() || $('title').text().trim() || 'MerlinScans_Chapter';

    const imageUrls = [];
    $('.uk-article img, #readerarea img, .rd-content img, .entry-content img, .webtoon-support img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && !src.includes('site-logo') && !src.includes('footer-logo') && !src.includes('banner')) {
        imageUrls.push(src.trim());
      }
    });

    if (imageUrls.length === 0) {
      throw new Error('MerlinScans bölüm resimleri bulunamadı.');
    }

    console.log(`[MerlinScans] ${imageUrls.length} sayfa bulundu, PDF oluşturuluyor...`);
    const pdfResult = await compileMangaPagesToPdf(imageUrls, title, { referer: pageUrl });

    return {
      title: `${title}.pdf`,
      source: 'merlinscans',
      url: pdfResult.pdfUrl,
      directUrl: pdfResult.pdfUrl,
      filePath: pdfResult.filePath,
      fileType: 'pdf'
    };
  } catch (err) {
    throw new Error(`MerlinScans extraction error: ${err.message}`);
  }
}
