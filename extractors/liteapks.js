import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

export async function extractLiteapks(pageUrl) {
  console.log(`[LiteAPKs Extractor] Extracting URL: ${pageUrl}`);
  try {
    // 1. Fetch main page HTML
    const mainRes = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    
    let $ = cheerio.load(mainRes.body);
    const title = $('title').text().replace('Download', '').trim();
    
    // Find download button link containing "/download/"
    let downloadHref = null;
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/download/')) {
        downloadHref = href;
      }
    });
    
    if (!downloadHref) {
      throw new Error('İndirme sayfası bağlantısı bulunamadı.');
    }
    
    console.log(`[LiteAPKs Extractor] Intermediate download URL: ${downloadHref}`);
    
    // 2. Fetch intermediate download page
    const intermediateRes = await gotScraping.get({
      url: downloadHref,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    
    $ = cheerio.load(intermediateRes.body);
    let finalSubpageHref = null;
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      // Look for "/1" or "/2" subpages. We default to "/1" (usually the MOD file)
      if (href && href.match(/\/download\/.+\/\d+$/)) {
        if (!finalSubpageHref || href.endsWith('/1')) {
          finalSubpageHref = href;
        }
      }
    });
    
    if (!finalSubpageHref) {
      throw new Error('Alt indirme sayfası bağlantısı bulunamadı.');
    }
    
    console.log(`[LiteAPKs Extractor] Final subpage URL: ${finalSubpageHref}`);
    
    // 3. Fetch final subpage
    const finalRes = await gotScraping.get({
      url: finalSubpageHref,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    
    $ = cheerio.load(finalRes.body);
    const downloadContainer = $('#download');
    const encodedLink = downloadContainer.attr('data-link');
    
    if (!encodedLink) {
      throw new Error('Şifrelenmiş indirme bağlantısı (data-link) bulunamadı.');
    }
    
    // Decode link
    const decodedUrl = Buffer.from(encodedLink, 'base64').toString('utf-8');
    
    // Generate token (now + 3h)
    const timeToLive = Math.floor(Date.now() / 1000) + 3600 * 3;
    const b64_1 = Buffer.from(timeToLive.toString()).toString('base64');
    const token = Buffer.from(b64_1).toString('base64');
    
    const directUrl = `${decodedUrl}?token=${encodeURIComponent(token)}`;
    console.log(`[LiteAPKs Extractor] Extraction successful. Direct URL: ${directUrl}`);
    
    return {
      title: title || 'LiteAPKs_File',
      url: directUrl,
      referer: finalSubpageHref,
      source: 'LiteAPKs'
    };
  } catch (err) {
    console.error(`[LiteAPKs Extractor] Failed: ${err.message}`);
    throw err;
  }
}
