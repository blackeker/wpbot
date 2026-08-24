import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';
import { compileMangaPagesToPdf } from '../mangaPdfCompiler.js';

export async function extractMangaDenizi(pageUrl) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const title = $('h1').text().trim() || $('title').text().trim() || 'MangaDenizi_Chapter';

    const imageUrls = [];
    $('.reader-content img, .entry-content img, #chapter_imgs img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && !src.includes('logo') && !src.includes('banner')) {
        imageUrls.push(src.trim());
      }
    });

    if (imageUrls.length === 0) {
      throw new Error('MangaDenizi bölüm resimleri bulunamadı.');
    }

    console.log(`[MangaDenizi] ${imageUrls.length} sayfa bulundu, PDF oluşturuluyor...`);
    const pdfResult = await compileMangaPagesToPdf(imageUrls, title, { referer: pageUrl });

    return {
      title: `${title}.pdf`,
      source: 'mangadenizi',
      url: pdfResult.pdfUrl,
      directUrl: pdfResult.pdfUrl,
      filePath: pdfResult.filePath,
      fileType: 'pdf'
    };
  } catch (err) {
    throw new Error(`MangaDenizi extraction error: ${err.message}`);
  }
}
