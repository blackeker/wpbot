import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
import * as cheerio from 'cheerio';
const mainUrl = "https://www.hdfilmcehennemi.nl";

// ROT13 for strings

export async function getHdfilmcehennemiSeasonEpisodes(seasonUrl) {
  try {
    const host = new URL(seasonUrl).origin;
    let targetUrl = seasonUrl;

    // Parse requested season if specified in seasonUrl (e.g. /sezon-2/)
    const seasonMatch = seasonUrl.match(/\/sezon-(\d+)/i);
    const requestedSeason = seasonMatch ? seasonMatch[1] : null;
    let res = await gotScraping.get({
      url: targetUrl
    });
    let $ = cheerio.load(res.body);
    if (($('title').text().includes('404') || res.body.includes('Sayfa Bulunamadı')) && seasonMatch) {
      targetUrl = seasonUrl.replace(/\/sezon-\d+\/?$/i, '/');
      console.log(`HDF 404 fallback: ${seasonUrl} -> ${targetUrl}`);
      res = await gotScraping.get({
        url: targetUrl
      });
      $ = cheerio.load(res.body);
    }
    const seriesName = $('h1.section-title').text().replace(/izle/i, '').trim() || $('title').text().split('|')[0].replace(/izle/i, '').trim() || 'HDfilmcehennemi Dizi';
    const episodes = [];
    const seenUrls = new Set();
    $('a[href*="/sezon-"][href*="/bolum-"]').each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const fullUrl = href.startsWith('http') ? href : `${host}${href}`;
      if (seenUrls.has(fullUrl)) return;
      const epSeasonMatch = fullUrl.match(/\/sezon-(\d+)\/bolum-(\d+)/i);
      if (epSeasonMatch) {
        const epSeason = epSeasonMatch[1];
        const epNum = epSeasonMatch[2];

        // If user asked for a specific season, filter for it
        if (requestedSeason && epSeason !== requestedSeason) {
          return;
        }
        seenUrls.add(fullUrl);
        episodes.push({
          season: epSeason,
          number: parseInt(epNum, 10),
          name: `Sezon ${epSeason} Bölüm ${epNum}`,
          url: fullUrl
        });
      }
    });
    episodes.sort((a, b) => a.number - b.number);
    return {
      seriesName,
      episodes
    };
  } catch (err) {
    throw new Error(`HDfilmcehennemi sezon bölümleri alınamadı: ${err.message}`);
  }
}

// ==========================================
// HDKORE1 EXTRACTOR AND RESOLVER FUNCTIONS
// ==========================================