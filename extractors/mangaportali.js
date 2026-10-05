import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';
import { compileMangaPagesToPdf } from '../utils/mangaPdfCompiler.js';

export async function extractMangaPortali(pageUrl) {
  try {
    let targetUrl = pageUrl.trim();

    // If series page provided, find the first/latest chapter or list chapters
    if (targetUrl.includes('/series/')) {
      const seriesRes = await gotScraping({
        url: targetUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const $s = cheerio.load(seriesRes.body);
      const firstChapterLink = $s('a[href*="/reader/"]').first().attr('href');
      if (firstChapterLink) {
        targetUrl = firstChapterLink.startsWith('http') ? firstChapterLink : `https://mangaportali.com${firstChapterLink}`;
        console.log(`[MangaPortali] Seri linki tespit edildi, yönlendiriliyor: ${targetUrl}`);
      } else {
        throw new Error('MangaPortalı serisinde okunabilir bölüm bulunamadı. Lütfen doğrudan bölüm linki iletin (Örn: https://mangaportali.com/reader/seri-adi/bolum-1)');
      }
    }

    const response = await gotScraping({
      url: targetUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const html = response.body;
    const $ = cheerio.load(html);

    let rawTitle = $('title').text().trim() || $('h1').text().trim() || 'MangaPortali_Chapter';
    rawTitle = rawTitle.replace(/\|\s*Manga\s*Portalı/i, '').replace(/Oku\s*$/i, '').trim();
    const title = rawTitle || 'MangaPortali_Chapter';

    // Extract pages from reader page:
    // 1. API page endpoints: /api/reader/pages/...
    // 2. Direct reader image tags or Next.js payload
    const seen = new Set();
    const imageUrls = [];

    // Method A: /api/reader/pages/ matches in appearance order
    const regex = /\/api\/reader\/pages\/[a-zA-Z0-9_\-]+/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      if (!seen.has(m[0])) {
        seen.add(m[0]);
        imageUrls.push(`https://mangaportali.com${m[0]}`);
      }
    }

    // Method B: Fallback to any direct reader img elements if API regex missed
    if (imageUrls.length === 0) {
      $('img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !src.includes('logo') && !src.includes('avatar') && !src.includes('banner') && !src.includes('_next/image')) {
          const fullSrc = src.startsWith('http') ? src : `https://mangaportali.com${src}`;
          if (!seen.has(fullSrc)) {
            seen.add(fullSrc);
            imageUrls.push(fullSrc);
          }
        }
      });
    }

    if (imageUrls.length === 0) {
      throw new Error('MangaPortalı bölüm resimleri bulunamadı.');
    }

    console.log(`[MangaPortali] "${title}" için ${imageUrls.length} sayfa bulundu, PDF derleniyor...`);
    const pdfResult = await compileMangaPagesToPdf(imageUrls, title, { referer: targetUrl });

    return {
      title: `${title}.pdf`,
      source: 'mangaportali',
      url: pdfResult.pdfUrl,
      directUrl: pdfResult.pdfUrl,
      filePath: pdfResult.filePath,
      fileType: 'pdf'
    };
  } catch (err) {
    throw new Error(`MangaPortalı extraction error: ${err.message}`);
  }
}

/**
 * Fetches all available chapters for a MangaPortali series or reader URL.
 * 
 * @param {string} seriesOrChapterUrl
 * @returns {Promise<{ seriesTitle: string, chapters: Array<{ url: string, number: number|null, title: string, slug: string }> }>}
 */
export async function getMangaPortaliChapters(seriesOrChapterUrl) {
  try {
    let slug = '';
    const readerMatch = seriesOrChapterUrl.match(/\/reader\/([^/?#]+)/i);
    const seriesMatch = seriesOrChapterUrl.match(/\/series\/([^/?#]+)/i);
    if (readerMatch) slug = readerMatch[1];
    else if (seriesMatch) slug = seriesMatch[1];

    if (!slug) return { seriesTitle: '', chapters: [] };

    const seriesUrl = `https://mangaportali.com/series/${slug}`;
    const res = await gotScraping({
      url: seriesUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(res.body);
    const seriesTitle = $('title').text().trim().replace(/\|\s*Manga\s*Portalı/i, '').replace(/Türkçe Oku/i, '').trim() || slug;
    const chapters = [];
    const seen = new Set();

    $('a[href*="/reader/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !seen.has(href)) {
        seen.add(href);
        const match = href.match(/bolum-(\d+(?:\.\d+)?)/i);
        const num = match ? parseFloat(match[1]) : null;
        const fullUrl = href.startsWith('http') ? href : `https://mangaportali.com${href}`;
        chapters.push({
          url: fullUrl,
          number: num,
          title: `${seriesTitle} - Bölüm ${num !== null ? num : ''}`.trim(),
          slug
        });
      }
    });

    chapters.sort((a, b) => (a.number || 0) - (b.number || 0));
    return { seriesTitle, chapters };
  } catch (err) {
    console.error('[MangaPortali Chapters Error]:', err.message);
    return { seriesTitle: '', chapters: [] };
  }
}
