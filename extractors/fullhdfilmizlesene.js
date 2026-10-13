import { gotScraping, getAndUnpack } from '../extractor.js';
import * as cheerio from 'cheerio';

function rot13(str) {
  return (str + '').replace(/[a-z]/gi, (c) =>
    String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < 'n' ? 13 : -13))
  );
}

function decodeScxItem(enc) {
  try {
    const r = rot13(enc);
    return Buffer.from(r, 'base64').toString('utf8');
  } catch (e) {
    return null;
  }
}

function decodeP8(t) {
  let e = Buffer.from(String(t || '').split('').reverse().join(''), 'base64').toString('binary');
  let n = '';
  for (let i = 0; i < e.length; i++) {
    let a = 'K9L'[i % 3];
    let diff = e.charCodeAt(i) - (a.charCodeAt(0) % 5 + 1);
    n += String.fromCharCode(diff);
  }
  return Buffer.from(n, 'base64').toString('utf8');
}

async function resolvePlayerUrl(playerUrl, pageUrl) {
  if (playerUrl.startsWith('//')) playerUrl = 'https:' + playerUrl;

  // 1. Rapidvid Player (window._p8 obfuscation)
  if (playerUrl.includes('rapidvid')) {
    try {
      const pRes = await gotScraping({
        url: playerUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': pageUrl
        },
        timeout: { request: 15000 }
      });

      const p8Match = pRes.body.match(/window\._p8\s*=\s*['"]([^'"]+)['"]/);
      if (p8Match) {
        const decoded = decodeP8(p8Match[1]);
        const data = JSON.parse(decoded);
        const streamUrl = data.cm || data.tm;
        if (streamUrl) {
          const subtitles = (data.ct || []).map(c => ({
            url: c.file,
            language: c.label && c.label.toLowerCase().includes('türk') ? 'tur' : 'eng',
            label: c.label ? c.label.trim() : 'Altyazı'
          }));
          return {
            streamUrl,
            referer: playerUrl,
            subtitles,
            isHls: true
          };
        }
      }

      const m3u8Match = pRes.body.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
      if (m3u8Match) {
        return {
          streamUrl: m3u8Match[0],
          referer: playerUrl,
          isHls: true
        };
      }
    } catch (e) {
      console.error(`[FullHDFilmIzlesene] Rapidvid resolution error: ${e.message}`);
    }
  }

  // 2. Vidmoly
  if (playerUrl.includes('vidmoly')) {
    try {
      const pRes = await gotScraping({
        url: playerUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': pageUrl
        },
        timeout: { request: 15000 }
      });
      const m3u8Match = pRes.body.match(/file\s*:\s*"([^"]+\.m3u8[^"]*)"/) || pRes.body.match(/"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/);
      if (m3u8Match) {
        return {
          streamUrl: m3u8Match[1],
          referer: playerUrl,
          isHls: true
        };
      }
    } catch (e) {
      console.error(`[FullHDFilmIzlesene] Vidmoly resolution error: ${e.message}`);
    }
  }

  // 3. Filemoon
  if (playerUrl.includes('filemoon')) {
    try {
      const pRes = await gotScraping({
        url: playerUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': pageUrl
        },
        timeout: { request: 15000 }
      });
      const $ = cheerio.load(pRes.body);
      let packedScript = '';
      $('script').each((_, el) => {
        const text = $(el).html() || '';
        if (text.includes('eval(function(p,a,c,k,e,')) {
          packedScript = text;
        }
      });
      if (packedScript) {
        const unpacked = getAndUnpack(packedScript);
        const m3u8Match = unpacked.match(/file\s*:\s*"([^"]+\.m3u8[^"]*)"/) || unpacked.match(/file\s*:\s*'([^']+\.m3u8[^']*)'/) || unpacked.match(/src\s*:\s*"([^"]+\.m3u8[^"]*)"/);
        if (m3u8Match) {
          return {
            streamUrl: m3u8Match[1],
            referer: playerUrl,
            isHls: true
          };
        }
      }
    } catch (e) {
      console.error(`[FullHDFilmIzlesene] Filemoon resolution error: ${e.message}`);
    }
  }

  // 4. Generic fallback (HLS or direct video)
  try {
    const pRes = await gotScraping({
      url: playerUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': pageUrl
      },
      timeout: { request: 15000 }
    });
    const m3u8Match = pRes.body.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
    if (m3u8Match) {
      return {
        streamUrl: m3u8Match[0],
        referer: playerUrl,
        isHls: true
      };
    }
    const mp4Match = pRes.body.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
    if (mp4Match) {
      return {
        streamUrl: mp4Match[0],
        referer: playerUrl,
        isHls: false
      };
    }
  } catch (e) {}

  return null;
}

export async function extractFullHDFilmIzlesene(pageUrl, selectedAudio = null) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.fullhdfilmizlesene.now/'
      },
      timeout: { request: 15000 }
    });

    const $ = cheerio.load(response.body);
    let title = $('meta[property="og:title"]').attr('content') ||
      $('h1').first().text().trim() ||
      $('title').text().replace(/izle.*$/i, '').trim() ||
      'FullHDFilmIzlesene_Movie';

    title = title.replace(/\s+/g, ' ').trim();

    const candidates = [];

    // Parse scx JS variable
    const scxMatch = response.body.match(/var\s+scx\s*=\s*({[\s\S]*?});/);
    if (scxMatch) {
      try {
        const scx = JSON.parse(scxMatch[1]);
        for (const [key, val] of Object.entries(scx)) {
          let sourceName = key;
          if (val && val.tt) {
            try { sourceName = Buffer.from(val.tt, 'base64').toString('utf8'); } catch (e) {}
          }
          const links = [...(val.sx?.t || []), ...(val.sx?.p || [])];
          for (const enc of links) {
            let u = decodeScxItem(enc);
            if (u) {
              if (sourceName.toLowerCase().includes('turbo') && (u.includes('movie') || u.includes('watch'))) {
                const a = u.split(/(movie|watch)/).pop().split('/')[1];
                if (a) u = 'https://turbo.imgz.me/play/' + a;
              }
              candidates.push({ name: sourceName, url: u });
            }
          }
        }
      } catch (e) {
        console.error('[FullHDFilmIzlesene] scx parse error:', e.message);
      }
    }

    // Fallback: check iframes in DOM
    $('iframe').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && !src.includes('google') && !src.includes('facebook') && !src.includes('yandex')) {
        candidates.push({ name: 'Iframe', url: src });
      }
    });

    for (const cand of candidates) {
      const resolved = await resolvePlayerUrl(cand.url, pageUrl);
      if (resolved && resolved.streamUrl) {
        return {
          title,
          source: `fullhdfilmizlesene (${cand.name})`,
          url: resolved.streamUrl,
          directUrl: resolved.streamUrl,
          referer: resolved.referer || pageUrl,
          headers: {
            'Referer': resolved.referer || pageUrl
          },
          subtitles: resolved.subtitles || [],
          isHls: resolved.isHls ?? resolved.streamUrl.includes('.m3u8')
        };
      }
    }

    throw new Error('FullHDFilmIzlesene video kaynağı bulunamadı.');
  } catch (err) {
    throw new Error(`FullHDFilmIzlesene extraction error: ${err.message}`);
  }
}
