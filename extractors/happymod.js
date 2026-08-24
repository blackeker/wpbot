import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';

export async function extractHappyMod(pageUrl) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const title = $('h1').text().trim() || 'HappyMod_MOD_APK';

    let downloadUrl = $('a.btn_download').attr('href') || $('a.download-btn').attr('href');

    if (downloadUrl && !downloadUrl.startsWith('http')) {
      downloadUrl = 'https://www.happymod.com' + downloadUrl;
    }

    if (downloadUrl) {
      const step2Res = await gotScraping({
        url: downloadUrl,
        headers: { 'Referer': pageUrl }
      });
      const $2 = cheerio.load(step2Res.body);
      const directUrl = $2('a.download-btn').attr('href') || $2('a[href*=".apk"]').attr('href');

      if (directUrl) {
        return {
          title: `${title}.apk`,
          source: 'happymod',
          url: directUrl,
          directUrl,
          fileType: 'apk'
        };
      }
    }

    throw new Error('HappyMod indirme bağlantısı bulunamadı.');
  } catch (err) {
    throw new Error(`HappyMod extraction error: ${err.message}`);
  }
}
