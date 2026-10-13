import { gotScraping, getAndUnpack } from '../extractor.js';
import * as cheerio from 'cheerio';
import vm from 'node:vm';

function decodeFullHDToken(token) {
  if (!token) return '';
  const rot13 = String(token).replace(/[a-z]/gi, (c) =>
    String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < 'n' ? 13 : -13))
  );
  try {
    return Buffer.from(rot13, 'base64').toString('utf-8');
  } catch (e) {
    return '';
  }
}

function decodeRapidvidP8(p8) {
  const rev = Buffer.from(String(p8 || '').split('').reverse().join(''), 'base64').toString('binary');
  let n = '';
  for (let i = 0; i < rev.length; i++) {
    const a = 'K9L'[i % 3];
    const code = rev.charCodeAt(i) - (a.charCodeAt(0) % 5 + 1);
    n += String.fromCharCode(code);
  }
  return JSON.parse(Buffer.from(n, 'base64').toString('utf-8'));
}

async function resolvePlayerUrl(playerUrl, pageUrl) {
  if (!playerUrl) return null;
  if (playerUrl.startsWith('//')) playerUrl = 'https:' + playerUrl;

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // Direct stream
  if (playerUrl.includes('.m3u8')) {
    return {
      url: playerUrl,
      isHls: true,
      headers: { 'Referer': pageUrl }
    };
  }

  // Rapidvid / Vidcloud / Rapid
  if (playerUrl.includes('rapidvid') || playerUrl.includes('rapid') || playerUrl.includes('cdnimg')) {
    try {
      const res = await gotScraping({
        url: playerUrl,
        headers: {
          'Referer': pageUrl,
          'User-Agent': userAgent
        }
      });
      const p8Match = res.body.match(/window\._p8\s*=\s*['"]([^'"]+)['"]/);
      if (p8Match) {
        const p8Data = decodeRapidvidP8(p8Match[1]);
        const streamUrl = p8Data.cm || p8Data.tm;
        if (streamUrl) {
          return {
            url: streamUrl,
            isHls: true,
            subtitles: p8Data.ct || null,
            headers: {
              'Referer': 'https://rapidvid.org/',
              'Origin': 'https://rapidvid.org',
              'User-Agent': userAgent
            }
          };
        }
      }

      const m3u8Match = res.body.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
      if (m3u8Match) {
        return {
          url: m3u8Match[0],
          isHls: true,
          headers: { 'Referer': playerUrl }
        };
      }
    } catch (e) {
      console.error('[FullHDFilmIzlesene] Rapidvid resolution error:', e.message);
    }
  }

  // Vidmoly
  if (playerUrl.includes('vidmoly')) {
    try {
      const res = await gotScraping({
        url: playerUrl,
        headers: {
          'Referer': pageUrl,
          'User-Agent': userAgent
        }
      });
      const m3u8Match = res.body.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/) || res.body.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
      if (m3u8Match) {
        return {
          url: m3u8Match[1] || m3u8Match[0],
          isHls: true,
          headers: { 'Referer': 'https://vidmoly.me/' }
        };
      }
    } catch (e) {
      console.error('[FullHDFilmIzlesene] Vidmoly resolution error:', e.message);
    }
  }

  // Filemoon
  if (playerUrl.includes('filemoon')) {
    try {
      const res = await gotScraping({
        url: playerUrl,
        headers: {
          'Referer': pageUrl,
          'User-Agent': userAgent
        }
      });
      const $ = cheerio.load(res.body);
      let packedScript = '';
      $('script').each((_, el) => {
        const text = $(el).html() || '';
        if (text.includes('eval(function(p,a,c,k,e,')) {
          packedScript = text;
        }
      });
      if (packedScript && typeof getAndUnpack === 'function') {
        const unpacked = getAndUnpack(packedScript);
        const m3u8Match = unpacked.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/) || unpacked.match(/file\s*:\s*'([^']+\.m3u8[^']*)'/);
        if (m3u8Match) {
          return {
            url: m3u8Match[1],
            isHls: true,
            headers: { 'Referer': 'https://filemoon.sx/' }
          };
        }
      }
    } catch (e) {
      console.error('[FullHDFilmIzlesene] Filemoon resolution error:', e.message);
    }
  }

  // Generic fallback
  try {
    const res = await gotScraping({
      url: playerUrl,
      headers: {
        'Referer': pageUrl,
        'User-Agent': userAgent
      }
    });
    const m3u8Match = res.body.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
    if (m3u8Match) {
      return {
        url: m3u8Match[0],
        isHls: true,
        headers: { 'Referer': playerUrl }
      };
    }
  } catch (e) {}

  return null;
}

export async function extractFullHDFilmIzlesene(pageUrl, recipientJid = null, selectedAudio = null) {
  try {
    const response = await gotScraping({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.body);
    const title = $('h1').text().trim() || $('title').text().replace(/Film izle.*/i, '').trim() || 'FullHDFilmIzlesene_Movie';

    const candidateUrls = [];

    // 1. Check scx in scripts
    const scxMatch = response.body.match(/var\s+scx\s*=\s*(\{[\s\S]*?\});/);
    if (scxMatch) {
      try {
        let scxObj = null;
        try {
          scxObj = JSON.parse(scxMatch[1]);
        } catch (e) {
          const script = new vm.Script('(' + scxMatch[1] + ')');
          scxObj = script.runInNewContext({});
        }

        if (scxObj && typeof scxObj === 'object') {
          for (const [sourceKey, sourceVal] of Object.entries(scxObj)) {
            if (!sourceVal || !sourceVal.sx) continue;
            const isTurbo = sourceVal.tt && Buffer.from(sourceVal.tt, 'base64').toString().toLowerCase().includes('turbo');

            const tokens = [];

            // Audio track preference
            if (sourceVal.sx.t && typeof sourceVal.sx.t === 'object') {
              if (selectedAudio === 'tr' && sourceVal.sx.t.tr) {
                tokens.push(sourceVal.sx.t.tr);
              } else if ((selectedAudio === 'en' || selectedAudio === 'altyazi') && sourceVal.sx.t.en) {
                tokens.push(sourceVal.sx.t.en);
              } else {
                tokens.push(...Object.values(sourceVal.sx.t));
              }
            }

            if (sourceVal.sx.p && typeof sourceVal.sx.p === 'object') {
              tokens.push(...Object.values(sourceVal.sx.p));
            }

            for (const token of tokens) {
              if (!token) continue;
              let decoded = decodeFullHDToken(token);
              if (!decoded) continue;

              if (decoded.includes('<iframe')) {
                const srcMatch = decoded.match(/src\s*=\s*["']([^"']+)["']/i);
                if (srcMatch) decoded = srcMatch[1];
              }

              if (isTurbo && (decoded.includes('/movie/') || decoded.includes('/watch/'))) {
                const id = decoded.split(/(movie|watch)/).pop().split('/')[1];
                decoded = `https://turbo.imgz.me/play/${id}`;
              }

              if (decoded.startsWith('//')) decoded = 'https:' + decoded;
              if (decoded.startsWith('/')) decoded = new URL(pageUrl).origin + decoded;

              if (!candidateUrls.includes(decoded)) {
                candidateUrls.push(decoded);
              }
            }
          }
        }
      } catch (e) {
        console.error('[FullHDFilmIzlesene] Error parsing scx:', e.message);
      }
    }

    // 2. Check iframes in HTML as fallback
    $('iframe').each((_, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;
        if (src.startsWith('/')) src = new URL(pageUrl).origin + src;
        if (!candidateUrls.includes(src)) candidateUrls.push(src);
      }
    });

    console.log(`[FullHDFilmIzlesene] Candidate player URLs count: ${candidateUrls.length}`);

    for (const playerUrl of candidateUrls) {
      const resolved = await resolvePlayerUrl(playerUrl, pageUrl);
      if (resolved && resolved.url) {
        return {
          title,
          source: 'fullhdfilmizlesene',
          url: resolved.url,
          directUrl: resolved.url,
          isHls: resolved.isHls !== undefined ? resolved.isHls : resolved.url.includes('.m3u8'),
          headers: resolved.headers || { 'Referer': playerUrl },
          referer: resolved.headers?.Referer || playerUrl
        };
      }
    }

    throw new Error('FullHDFilmIzlesene video kaynağı bulunamadı.');
  } catch (err) {
    if (err.message.includes('FullHDFilmIzlesene')) {
      throw err;
    }
    throw new Error(`FullHDFilmIzlesene extraction error: ${err.message}`);
  }
}
