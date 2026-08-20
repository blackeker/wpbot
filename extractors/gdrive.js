import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

export async function extractGDrive(pageUrl) {
  console.log(`[Google Drive Extractor] Extracting URL: ${pageUrl}`);
  
  const match = pageUrl.match(/(?:id=|folders\/|file\/d\/)([a-zA-Z0-9_-]{25,})/);
  if (!match) {
    throw new Error('Geçersiz Google Drive bağlantısı.');
  }
  
  const fileId = match[1];
  const baseUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  
  try {
    const res = await gotScraping.get({
      url: baseUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });

    const body = res.body;
    
    // Check if the page is a virus warning page (Google Drive large file warning)
    if (body.includes('confirm=') || body.includes('uc-download-link')) {
      const confirmMatch = body.match(/confirm=([a-zA-Z0-9_-]+)/);
      if (confirmMatch) {
        const confirmToken = confirmMatch[1];
        const directUrl = `${baseUrl}&confirm=${confirmToken}`;
        
        // Extract title from HTML
        const $ = cheerio.load(body);
        let filename = $('title').text().replace(' - Google Drive', '').trim();
        if (filename.includes('Virus scan warning')) {
          filename = 'google_drive_file';
        }
        
        console.log(`[Google Drive Extractor] Bypass successful. File: ${filename}`);
        return {
          title: filename,
          url: directUrl,
          referer: 'https://drive.google.com/',
          source: 'Google Drive'
        };
      }
    }
    
    // If it did not need warning (small file or direct download trigger)
    // We can return the base url directly as the download link
    console.log(`[Google Drive Extractor] Direct link extraction successful.`);
    return {
      title: 'GDrive_File',
      url: baseUrl,
      referer: 'https://drive.google.com/',
      source: 'Google Drive'
    };
  } catch (err) {
    console.error(`[Google Drive Extractor] Failed: ${err.message}`);
    throw err;
  }
}
