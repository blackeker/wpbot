import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';
import { compileMangaPagesToPdf } from '../mangaPdfCompiler.js';

export async function extractWebtoonTR(pageUrl) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const title = $('h1').text().trim() || $('title').text().trim() || 'WebtoonTR_Chapter';

    const imageUrls = [];
    $('.reading-content img, #chapter-container img, .page-break img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && !src.includes('logo') && !src.includes('ads')) {
        imageUrls.push(src.trim());
      }
    });

    if (imageUrls.length === 0) {
      throw new Error('WebtoonTR bölüm resimleri bulunamadı.');
    }

    console.log(`[WebtoonTR] ${imageUrls.length} sayfa bulundu, PDF oluşturuluyor...`);
    const pdfResult = await compileMangaPagesToPdf(imageUrls, title, { referer: pageUrl });

    return {
      title: `${title}.pdf`,
      source: 'webtoontr',
      url: pdfResult.pdfUrl,
      directUrl: pdfResult.pdfUrl,
      filePath: pdfResult.filePath,
      fileType: 'pdf'
    };
  } catch (err) {
    throw new Error(`WebtoonTR extraction error: ${err.message}`);
  }
}
