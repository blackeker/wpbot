import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';
import { compileMangaPagesToPdf } from '../mangaPdfCompiler.js';

export async function extractAsuraScans(pageUrl) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const title = $('h1.entry-title').text().trim() || $('title').text().trim() || 'AsuraScans_Manhwa';

    const imageUrls = [];
    $('#readerarea img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && !src.includes('discord') && !src.includes('banner')) {
        imageUrls.push(src.trim());
      }
    });

    if (imageUrls.length === 0) {
      throw new Error('AsuraScans bölüm resimleri bulunamadı.');
    }

    console.log(`[AsuraScans] ${imageUrls.length} sayfa bulundu, PDF oluşturuluyor...`);
    const pdfResult = await compileMangaPagesToPdf(imageUrls, title, { referer: pageUrl });

    return {
      title: `${title}.pdf`,
      source: 'asurascans',
      url: pdfResult.pdfUrl,
      directUrl: pdfResult.pdfUrl,
      filePath: pdfResult.filePath,
      fileType: 'pdf'
    };
  } catch (err) {
    throw new Error(`AsuraScans extraction error: ${err.message}`);
  }
}
