import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';

export async function extractAPKPure(pageUrl) {
  try {
    let targetUrl = pageUrl;
    if (!targetUrl.includes('/download')) {
      targetUrl = targetUrl.endsWith('/') ? `${targetUrl}download` : `${targetUrl}/download`;
    }

    const response = await gotScraping({
      url: targetUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const title = $('.title-file').text().trim() || $('title').text().replace(/ APK.*/, '').trim() || 'APKPure_App';

    let directUrl = $('#download_link').attr('href') || $('a.download-btn').attr('href');

    if (!directUrl) {
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes('d.apkpure.com') || href.includes('.apk')) {
          directUrl = href;
        }
      });
    }

    if (directUrl) {
      return {
        title: `${title}.apk`,
        source: 'apkpure',
        url: directUrl,
        directUrl,
        fileType: 'apk'
      };
    }

    throw new Error('APKPure indirme bağlantısı bulunamadı.');
  } catch (err) {
    throw new Error(`APKPure extraction error: ${err.message}`);
  }
}
