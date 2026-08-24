import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';

export async function extractAPKMirror(pageUrl) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const title = $('h1').text().trim() || 'APKMirror_App';

    let downloadPageUrl = '';
    $('.downloadButton').each((_, el) => {
      const href = $(el).attr('href');
      if (href) downloadPageUrl = 'https://www.apkmirror.com' + href;
    });

    if (!downloadPageUrl) {
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes('-download/')) {
          downloadPageUrl = href.startsWith('http') ? href : 'https://www.apkmirror.com' + href;
        }
      });
    }

    if (downloadPageUrl) {
      const step2Res = await gotScraping({
        url: downloadPageUrl,
        headers: { 'Referer': pageUrl }
      });
      const $2 = cheerio.load(step2Res.body);
      const finalLink = $2('a.downloadButton').attr('href') || $2('a[data-google-vignette="false"]').attr('href');

      if (finalLink) {
        const directUrl = finalLink.startsWith('http') ? finalLink : 'https://www.apkmirror.com' + finalLink;
        return {
          title: `${title}.apk`,
          source: 'apkmirror',
          url: directUrl,
          directUrl,
          fileType: 'apk'
        };
      }
    }

    throw new Error('APKMirror indirme bağlantısı bulunamadı.');
  } catch (err) {
    throw new Error(`APKMirror extraction error: ${err.message}`);
  }
}
