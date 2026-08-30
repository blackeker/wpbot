import { gotScraping } from "../extractor.js";
import * as cheerio from 'cheerio';
import { getSharedBrowser } from '../utils/browser.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function extractDramadizilerim(pageUrl) {
  console.log(`[Dramadizilerim Extractor] ${pageUrl}`);
  
  const browser = await getSharedBrowser();
  let capturedVideoUrl = null;
  let showTitle = 'Dramadizilerim Video';
  let page = null;

  try {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });

    const urlObj = new URL(pageUrl);
    const requestedEpisode = urlObj.searchParams.get('e') || '1';

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const frame = req.frame();
      const frameUrl = frame ? frame.url() : '';

      const isVideo = (url.includes('.m3u8') || url.includes('.mp4')) &&
                      !url.includes('tr-TR') &&
                      !url.includes('init.mp4') &&
                      !/_[0-9]+\.mp4/.test(url);

      if (isVideo) {
        if (frameUrl.includes(`episode=${requestedEpisode}`)) {
          if (!capturedVideoUrl) {
            capturedVideoUrl = url;
            console.log(`[Dramadizilerim Extractor] Captured video URL: ${url}`);
          }
        }
      }
      req.continue();
    });

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    
    // Extract title
    showTitle = await page.title().catch(() => 'Dramadizilerim Video');
    showTitle = showTitle.replace(/\s*[-–|]\s*(İzle|izle|Türkçe|Dramadizilerim).*/i, '').trim();

    // Click lazy player if exists and url not captured yet
    if (!capturedVideoUrl) {
      try {
        const lazyPlayer = await page.$('.lazy-player');
        if (lazyPlayer) {
          await page.evaluate(el => el.click(), lazyPlayer).catch(() => {});
          
          for (let i = 0; i < 10; i++) {
            if (capturedVideoUrl) break;
            await sleep(1000);
          }
        }
      } catch (e) {
        console.log(`[Dramadizilerim Extractor] Lazy player click warning: ${e.message}`);
      }
    }

    if (capturedVideoUrl) {
      if (capturedVideoUrl.includes('?url=')) {
        try {
          const parsed = new URL(capturedVideoUrl);
          const innerUrl = parsed.searchParams.get('url');
          if (innerUrl) {
            capturedVideoUrl = decodeURIComponent(innerUrl);
            console.log(`[Dramadizilerim Extractor] Unwrapped direct M3U8 URL: ${capturedVideoUrl}`);
          }
        } catch (e) {}
      }

      return {
        title: showTitle,
        url: capturedVideoUrl,
        referer: 'https://dramadizilerim.com/',
        source: 'DramaDizilerim'
      };
    }
    
    throw new Error('Video kaynağı yakalanamadı.');
  } catch (err) {
    throw err;
  } finally {
    if (page) {
      try { await page.close(); } catch (e) {}
    }
  }
}

export async function getDramadizilerimSeasonEpisodes(pageUrl) {
  const res = await gotScraping.get({
    url: pageUrl,
    headerGeneratorOptions: {
      devices: ['desktop'],
      locales: ['tr-TR', 'en-US'],
      operatingSystems: ['windows']
    }
  });

  const $ = cheerio.load(res.body || res.data);
  const title = $('title').text().replace(/izle.*/i, '').trim() || 'Dramadizilerim';
  
  const episodesMap = new Map();
  
  const parsedUrl = new URL(pageUrl);
  const targetSeason = parsedUrl.searchParams.get('s') || '1';

  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('?s=') && href.includes('&e=')) {
      try {
        const fullUrl = href.startsWith('http') ? href : new URL(href, pageUrl).toString();
        const epUrlObj = new URL(fullUrl);
        const sParam = epUrlObj.searchParams.get('s');
        const eParam = epUrlObj.searchParams.get('e');
        
        if (sParam === targetSeason) {
          const epName = `Sezon ${sParam} Bölüm ${eParam}`;
          episodesMap.set(fullUrl, {
            url: fullUrl,
            name: epName,
            season: sParam,
            episode: eParam
          });
        }
      } catch (err) {}
    }
  });

  const episodes = Array.from(episodesMap.values()).sort((a, b) => {
    return parseInt(a.episode, 10) - parseInt(b.episode, 10);
  });

  return {
    seriesName: title,
    episodes
  };
}
