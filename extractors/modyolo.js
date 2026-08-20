import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

export async function extractModyolo(pageUrl) {
  console.log(`[Modyolo Extractor] Extracting URL: ${pageUrl}`);
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
    
    console.log(`[Modyolo Extractor] Intermediate download URL: ${downloadHref}`);
    
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
      if (href && href.match(/\/download\/.+\/\d+$/)) {
        if (!finalSubpageHref || href.endsWith('/1')) {
          finalSubpageHref = href;
        }
      }
    });
    
    if (!finalSubpageHref) {
      throw new Error('Alt indirme sayfası bağlantısı bulunamadı.');
    }
    
    console.log(`[Modyolo Extractor] Final subpage URL: ${finalSubpageHref}`);
    
    // 3. Post to WordPress admin-ajax using final subpage as referer
    const ajaxUrl = 'https://modyolo.com/wp-admin/admin-ajax.php';
    const ajaxRes = await gotScraping.post({
      url: ajaxUrl,
      headers: {
        'Referer': finalSubpageHref,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: 'action=k_get_download'
    });
    
    const ajax$ = cheerio.load(ajaxRes.body);
    let directUrl = ajax$('#download a.download').attr('href') || ajax$('#click-here').attr('href');
    
    if (!directUrl) {
      throw new Error('AJAX isteği üzerinden doğrudan APK bağlantısı alınamadı.');
    }
    
    console.log(`[Modyolo Extractor] Extraction successful. Direct URL: ${directUrl}`);
    
    return {
      title: title || 'Modyolo_File',
      url: directUrl,
      referer: finalSubpageHref,
      source: 'Modyolo'
    };
  } catch (err) {
    console.error(`[Modyolo Extractor] Failed: ${err.message}`);
    throw err;
  }
}
