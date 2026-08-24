import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
import * as cheerio from 'cheerio';
export
// ==========================================
// NEW EXTRACTORS FROM HONTI PROJECT
// ==========================================

// Helper functions for veev.to decoding
function veevDecode(encoded) {
  if (!encoded) return "";
  const result = [];
  const lut = {};
  let n = 256;
  let c = encoded[0];
  result.push(c);
  for (let i = 1; i < encoded.length; i++) {
    const char = encoded[i];
    const code = char.charCodeAt(0);
    const nc = code < 256 ? char : lut[code] || c + c[0];
    result.push(nc);
    lut[n] = c + nc[0];
    n++;
    c = nc;
  }
  return result.join("");
}
export function buildArray(encoded) {
  const d = [];
  const chars = encoded.split('');
  if (chars.length === 0) return d;
  let count = parseInt(chars.shift()) || 0;
  while (count > 0) {
    const currentArray = [];
    for (let i = 0; i < count; i++) {
      if (chars.length === 0) break;
      const charValue = chars.shift();
      const intValue = parseInt(charValue) || 0;
      currentArray.unshift(intValue);
    }
    d.push(currentArray);
    if (chars.length === 0) break;
    count = parseInt(chars.shift()) || 0;
  }
  return d;
}
export function hexToString(hex) {
  const cleanHex = hex.trim();
  const paddedHex = cleanHex.length % 2 !== 0 ? "0" + cleanHex : cleanHex;
  const bytes = [];
  for (let i = 0; i < paddedHex.length; i += 2) {
    bytes.push(parseInt(paddedHex.substring(i, i + 2), 16));
  }
  return Buffer.from(bytes).toString('utf8');
}
export function decodeUrl(encoded, tArray) {
  let ds = encoded;
  for (const t of tArray) {
    if (t === 1) {
      ds = ds.split('').reverse().join('');
    }
    ds = hexToString(ds);
    ds = ds.replace(/dXRmOA==/g, "");
  }
  return ds;
}

// Embed resolvers for TurkPorno
export async function resolveTurkPornoEmbed(url) {
  if (url.includes("plyr.upns.live")) {
    try {
      let id = "";
      if (url.includes("#")) {
        id = url.split("#").pop();
      } else if (url.includes("id=")) {
        id = url.split("id=")[1].split("&")[0];
      } else {
        id = url.split("/").pop();
      }
      const apiRes = await gotScraping.get({
        url: `https://plyr.upns.live/api/v1/video?id=${id}`,
        headers: {
          'Referer': 'https://plyr.upns.live/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        }
      });
      const cleanRes = apiRes.body.trim();
      const key = Buffer.from('kiemtienmua911ca');
      const iv = Buffer.from('1234567890oiuytr');
      const hexData = cleanRes.length % 2 !== 0 ? cleanRes.slice(0, -1) : cleanRes;
      const ct = Buffer.from(hexData, 'hex');
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      decipher.setAutoPadding(true);
      const decryptedText = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8').replace(/\x00/g, '').trim();
      const json = JSON.parse(decryptedText);
      const videoUrl = json.cf || json.source;
      if (videoUrl) {
        return {
          url: videoUrl,
          quality: '720p',
          name: 'UpnsLive HLS'
        };
      }
    } catch (e) {
      console.error("[TurkPorno UpnsLive Resolver Error]:", e.message);
    }
  } else if (url.includes("veev.to")) {
    try {
      const pageRes = await gotScraping.get({
        url: url,
        headers: {
          'Referer': 'https://veev.to/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        }
      });
      const pageHtml = pageRes.body;
      const mediaId = url.split("/").filter(Boolean).pop().split("?")[0];
      const regex = /[\.\s'](?:fc|_vvto\[[^\]]*)(?:['\]]*)?\s*[:=]\s*['"]([^'"]+)/g;
      const encodedStrings = [];
      let match;
      while ((match = regex.exec(pageHtml)) !== null) {
        encodedStrings.push(match[1]);
      }
      let ch = null;
      for (let i = encodedStrings.length - 1; i >= 0; i--) {
        const f = encodedStrings[i];
        const decoded = veevDecode(f);
        if (decoded !== f) {
          ch = decoded;
          break;
        }
      }
      if (ch) {
        const tArrays = buildArray(ch);
        if (tArrays.length > 0) {
          const tArray = tArrays[0];
          const apiUrl = `https://veev.to/dl?op=player_api&cmd=gi&file_code=${encodeURIComponent(mediaId)}&ch=${encodeURIComponent(ch)}&ie=1`;
          const apiRes = await gotScraping.get({
            url: apiUrl,
            headers: {
              'Referer': url,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            }
          });
          const jsonResponse = JSON.parse(apiRes.body);
          if (jsonResponse.status === "success" && jsonResponse.file && jsonResponse.file.file_status === "OK") {
            const dvArray = jsonResponse.file.dv;
            if (Array.isArray(dvArray) && dvArray.length > 0) {
              const sources = [];
              for (const source of dvArray) {
                const encodedUrl = source.s;
                if (encodedUrl) {
                  const firstDecode = veevDecode(encodedUrl);
                  const finalUrl = decodeUrl(firstDecode, tArray);
                  if (finalUrl.startsWith("http")) {
                    const quality = source.vid_title || "720p";
                    sources.push({
                      url: finalUrl,
                      quality: quality,
                      name: `VeevTo (${quality})`
                    });
                  }
                }
              }
              if (sources.length > 0) {
                return sources[0];
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("[TurkPorno VeevTo Resolver Error]:", e.message);
    }
  }
  return null;
}
export async function extractTurkporno(pageUrl) {
  try {
    const pageRes = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Referer': 'https://turkporno129.cfd/'
      }
    });
    const $ = cheerio.load(pageRes.body);
    const title = $('h1.entry-title').text().trim() || $('meta[property="og:title"]').attr('content') || 'TurkPorno Video';
    const iframeEl = $('iframe');
    let iframeUrl = null;
    if (iframeEl.length > 0) {
      const el = iframeEl.first();
      iframeUrl = el.attr('data-litespeed-src') || el.attr('data-src') || el.attr('data-lazy-src') || el.attr('src');
      if (iframeUrl === 'about:blank') {
        iframeUrl = el.attr('data-src') || el.attr('data-lazy-src');
      }
    }
    if (!iframeUrl) {
      iframeUrl = $('meta[itemprop="embedURL"]').attr('content');
    }
    if (!iframeUrl) {
      throw new Error("TurkPorno iframe/embed adresi bulunamadı.");
    }
    if (iframeUrl.startsWith('//')) {
      iframeUrl = 'https:' + iframeUrl;
    }
    let resolved = null;
    if (iframeUrl.includes("player.php")) {
      const url1Idx = iframeUrl.indexOf("url1=");
      const url2Idx = iframeUrl.indexOf("url2=");
      let video1 = "";
      let video2 = "";
      if (url1Idx !== -1) {
        video1 = iframeUrl.substring(url1Idx + 5).split("&")[0];
      }
      if (url2Idx !== -1) {
        video2 = iframeUrl.substring(url2Idx + 5);
      }
      if (video1) {
        resolved = await resolveTurkPornoEmbed(video1);
      }
      if (!resolved && video2) {
        resolved = await resolveTurkPornoEmbed(video2);
      }
    } else {
      resolved = await resolveTurkPornoEmbed(iframeUrl);
    }
    if (!resolved) {
      throw new Error("TurkPorno video embed adresi çözümlenemedi.");
    }
    return {
      title,
      source: resolved.name,
      url: resolved.url,
      referer: iframeUrl
    };
  } catch (err) {
    throw new Error(`TurkPorno çözme hatası: ${err.message}`);
  }
}