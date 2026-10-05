import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';
import { compileMangaPagesToPdf } from '../utils/mangaPdfCompiler.js';

/**
 * Extracts chapter title and image URLs for a single MangaPortali reader page.
 * 
 * @param {string} chapterUrl 
 * @returns {Promise<{ title: string, imageUrls: string[] }>}
 */
export async function extractMangaPortaliChapterData(chapterUrl) {
  const cleanUrl = chapterUrl.split('#')[0];
  const response = await gotScraping({
    url: cleanUrl,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  const html = response.body;
  const $ = cheerio.load(html);

  let rawTitle = $('title').text().trim() || $('h1').text().trim() || 'MangaPortali_Chapter';
  rawTitle = rawTitle.replace(/\|\s*Manga\s*Portalı/i, '').replace(/Türkçe Oku\s*$/i, '').replace(/Oku\s*$/i, '').trim();
  const title = rawTitle || 'MangaPortali_Chapter';

  // Extract pages from reader page:
  // Method A: /api/reader/pages/ matches in appearance order
  const seen = new Set();
  const imageUrls = [];

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

  return { title, imageUrls };
}

export async function extractMangaPortali(pageUrl) {
  try {
    let targetUrl = pageUrl.trim();

    // Check if batch / range is requested (e.g. #batch=230-244 or #batch=230-end)
    const batchMatch = targetUrl.match(/#batch=([0-9.]+)(?:-([0-9.]+|end))?/i) || targetUrl.match(/#range=([0-9.]+)(?:-([0-9.]+|end))?/i);

    if (batchMatch) {
      const startEp = parseFloat(batchMatch[1]);
      const endEp = (!batchMatch[2] || batchMatch[2].toLowerCase() === 'end') ? Infinity : parseFloat(batchMatch[2]);

      console.log(`[MangaPortali Batch] Bölüm aralığı işleniyor: ${startEp} - ${endEp === Infinity ? 'Son' : endEp}`);

      const { seriesTitle, chapters } = await getMangaPortaliChapters(targetUrl);
      const targetChapters = chapters.filter(c => c.number !== null && c.number >= startEp && (endEp === Infinity || c.number <= endEp));

      if (targetChapters.length === 0) {
        throw new Error(`Belirtilen aralıkta (${startEp} - ${endEp === Infinity ? 'Son' : endEp}) bölüm bulunamadı.`);
      }

      console.log(`[MangaPortali Batch] Toplam ${targetChapters.length} bölümün sayfaları tek cilt PDF için taranıyor...`);
      const allImageUrls = [];
      const seenImages = new Set();

      for (let i = 0; i < targetChapters.length; i++) {
        const ch = targetChapters[i];
        console.log(`[MangaPortali Batch] Bölüm ${ch.number || (i + 1)} (${i + 1}/${targetChapters.length}) taranıyor...`);
        try {
          const { imageUrls } = await extractMangaPortaliChapterData(ch.url);
          for (const img of imageUrls) {
            if (!seenImages.has(img)) {
              seenImages.add(img);
              allImageUrls.push(img);
            }
          }
        } catch (chapErr) {
          console.error(`[MangaPortali Batch] Bölüm ${ch.number || (i + 1)} sayfaları alınamadı:`, chapErr.message);
        }
      }

      if (allImageUrls.length === 0) {
        throw new Error('Manga bölümlerinde sayfa resimleri bulunamadı.');
      }

      const endLabel = endEp === Infinity ? (targetChapters[targetChapters.length - 1].number || 'Son') : endEp;
      const combinedTitle = `${seriesTitle || 'Manga'} (Bölüm ${startEp} - ${endLabel})`;

      console.log(`[MangaPortali Batch] "${combinedTitle}" için toplam ${allImageUrls.length} sayfa bulundu, tek PDF derleniyor...`);
      const pdfResult = await compileMangaPagesToPdf(allImageUrls, combinedTitle, { referer: targetUrl.split('#')[0] });

      return {
        title: `${combinedTitle}.pdf`,
        source: 'mangaportali',
        url: pdfResult.pdfUrl,
        directUrl: pdfResult.pdfUrl,
        filePath: pdfResult.filePath,
        fileType: 'pdf'
      };
    }

    // If series page provided, find the first chapter or list chapters
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

    const { title, imageUrls } = await extractMangaPortaliChapterData(targetUrl);

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
    const cleanUrl = seriesOrChapterUrl.split('#')[0];
    const readerMatch = cleanUrl.match(/\/reader\/([^/?#]+)/i);
    const seriesMatch = cleanUrl.match(/\/series\/([^/?#]+)/i);
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
