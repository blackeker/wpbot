import { gotScraping as originalGotScraping } from 'got-scraping';
export const gotScraping = new Proxy(originalGotScraping, {
  apply(target, thisArg, argumentsList) {
    const options = argumentsList[0] || {};
    if (typeof options === 'object' && process.env.PROXY_URL) {
      options.proxyUrl = process.env.PROXY_URL;
    }
    return Reflect.apply(target, thisArg, argumentsList);
  },
  get(target, prop, receiver) {
    if (['get', 'post', 'put', 'patch', 'delete', 'head'].includes(prop)) {
      return (url, options) => {
        let opt = {};
        if (typeof url === 'object') {
          opt = url;
        } else {
          opt = options || {};
          opt.url = url;
        }
        if (process.env.PROXY_URL) {
          opt.proxyUrl = process.env.PROXY_URL;
        }
        return originalGotScraping[prop](opt);
      };
    }
    return Reflect.get(target, prop, receiver);
  }
});
import * as cheerio from 'cheerio';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { CookieJar } from 'tough-cookie';
import { pendingHentaizmLogins, readConfig, writeConfig, botSocketRef, downloadsDir } from './config.js';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dns from 'dns';
puppeteer.use(StealthPlugin());
const originalLookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  originalLookup(hostname, options, (err, address, family) => {
    if (err && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || err.code === 'EREFUSED')) {
      const resolver = new dns.Resolver();
      resolver.setServers(['8.8.8.8', '1.1.1.1']);
      const isAll = options && options.all;
      resolver.resolve4(hostname, (err4, addresses) => {
        if (err4 || !addresses || addresses.length === 0) {
          resolver.resolve6(hostname, (err6, addresses6) => {
            if (err6 || !addresses6 || addresses6.length === 0) {
              return callback(err);
            }
            if (isAll) {
              return callback(null, [{
                address: addresses6[0],
                family: 6
              }]);
            }
            return callback(null, addresses6[0], 6);
          });
          return;
        }
        if (isAll) {
          return callback(null, [{
            address: addresses[0],
            family: 4
          }]);
        }
        return callback(null, addresses[0], 4);
      });
      return;
    }
    callback(err, address, family);
  });
};
// ROT13 for strings
export function rot13Str(str) {
  return str.replace(/[a-zA-Z]/g, c => {
    const code = c.charCodeAt(0);
    const start = code <= 90 ? 65 : 97;
    return String.fromCharCode((code - start + 13) % 26 + start);
  });
}

// ROT13 for Buffers
export function rot13Buffer(buf) {
  const res = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 97 && c <= 122) {
      res[i] = (c - 97 + 13) % 26 + 97;
    } else if (c >= 65 && c <= 90) {
      res[i] = (c - 65 + 13) % 26 + 65;
    } else {
      res[i] = c;
    }
  }
  return res;
}

// Unmix algorithm
export function unmix(buf) {
  const chars = [];
  for (let i = 0; i < buf.length; i++) {
    const charCode = buf[i];
    const newChar = (charCode - 399756995 % (i + 5) + 256) % 256;
    chars.push(String.fromCharCode(newChar));
  }
  return chars.join('');
}

// Decrypt base64 data using the custom strategies
export function dcHello(parts) {
  const s = parts.join('');
  const strategies = [
  // Strategy 1: s.rot13().reversed().b64()?.unmix()
  () => {
    const r13 = rot13Str(s);
    const reversed = r13.split('').reverse().join('');
    const buf = Buffer.from(reversed, 'base64');
    return unmix(buf);
  },
  // Strategy 2: s.rot13().b64()?.reversedArray()?.unmix()
  () => {
    const r13 = rot13Str(s);
    const buf = Buffer.from(r13, 'base64').reverse();
    return unmix(buf);
  },
  // Strategy 3: s.reversed().b64()?.rot13()?.unmix()
  () => {
    const reversed = s.split('').reverse().join('');
    const buf = Buffer.from(reversed, 'base64');
    const r13 = rot13Buffer(buf);
    return unmix(r13);
  },
  // Strategy 4: s.reversed().rot13().b64()?.unmix()
  () => {
    const reversed = s.split('').reverse().join('');
    const r13 = rot13Str(reversed);
    const buf = Buffer.from(r13, 'base64');
    return unmix(buf);
  },
  // Strategy 5: s.b64()?.rot13()?.reversedArray()?.unmix()
  () => {
    const buf = Buffer.from(s, 'base64');
    const r13 = rot13Buffer(buf).reverse();
    return unmix(r13);
  },
  // Strategy 6: s.reversed().b64()?.b64()?.unmix()
  () => {
    const reversed = s.split('').reverse().join('');
    const b64_1 = Buffer.from(reversed, 'base64').toString('utf-8');
    const buf = Buffer.from(b64_1, 'base64');
    return unmix(buf);
  },
  // Strategy 7: s.b64()?.reversedArray()?.rot13()?.unmix()
  () => {
    const buf = Buffer.from(s, 'base64').reverse();
    const r13 = rot13Buffer(buf);
    return unmix(r13);
  },
  // Strategy 8: s.rot13().reversed().b64()?.b64()?.unmix()
  () => {
    const r13 = rot13Str(s);
    const reversed = r13.split('').reverse().join('');
    const b64_1 = Buffer.from(reversed, 'base64').toString('utf-8');
    const buf = Buffer.from(b64_1, 'base64');
    return unmix(buf);
  }];
  for (const strategy of strategies) {
    try {
      const res = strategy();
      if (res && res.includes('http')) {
        const clean = res.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
        if (clean.startsWith("http")) {
          return clean;
        }
      }
    } catch (e) {
      // Ignore
    }
  }
  return null;
}

// Unpacker logic for eval-packed JS
export function getAndUnpack(script) {
  const match = script.match(/eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?return p\}[\s\S]*?\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!match) return script;
  let [_, p, a, c, k] = match;
  a = parseInt(a, 10);
  c = parseInt(c, 10);
  k = k.split('|');
  const e = c => {
    return (c < a ? '' : e(Math.floor(c / a))) + String.fromCharCode(c % a > 35 ? c % a + 29 : c % a + 87);
  };
  const d = {};
  for (let i = 0; i < k.length; i++) {
    if (k[i]) {
      d[e(i)] = k[i];
    }
  }
  return p.replace(/\b[0-9a-zA-Z_]+\b/g, w => d[w] || w);
}

// ==========================================
// HENTAIZM DECRYPTER AND RESOLVER FUNCTIONS
// ==========================================
// Main extract function
export async function extractVideoUrl(pageUrl, fromJid = null) {
  let targetUrl = pageUrl;
  if (targetUrl.includes('cloidmail.ru')) {
    targetUrl = targetUrl.replace('cloidmail.ru', 'cloud.mail.ru');
  }

  // Normalize AMP cache URLs
  if (pageUrl.includes('cdn.ampproject.org/c/')) {
    const match = pageUrl.match(/cdn\.ampproject\.org\/c\/(?:s\/)?([^\/]+)\/(.*)/);
    if (match) {
      const domain = match[1];
      const rest = match[2];
      targetUrl = `https://${domain}/${rest}`;
      console.log(`Normalized AMP URL: ${pageUrl} -> ${targetUrl}`);
    }
  }

  // Handle direct links (MP4, MKV, WebM, AVI, APK, ZIP, RAR, 7Z, PDF, EXE, etc.)
  const urlLower = targetUrl.toLowerCase().split('?')[0];
  if (urlLower.endsWith('.mp4') || urlLower.endsWith('.mkv') || urlLower.endsWith('.webm') || urlLower.endsWith('.avi') || urlLower.endsWith('.apk') || urlLower.endsWith('.zip') || urlLower.endsWith('.rar') || urlLower.endsWith('.7z') || urlLower.endsWith('.pdf') || urlLower.endsWith('.exe')) {
    const fileName = path.basename(urlLower);
    const decodedTitle = decodeURIComponent(fileName).trim();
    return {
      title: decodedTitle || 'Direct File',
      source: 'Direct Link',
      url: targetUrl,
      referer: targetUrl
    };
  }
  if (targetUrl.includes('animecix.') || targetUrl.includes('ecchicix.')) {
    return extractAnimecix(targetUrl);
  }
  if (targetUrl.includes('hentaizm')) {
    return extractHentaizm(targetUrl, fromJid);
  }
  if (/doeda/i.test(targetUrl)) {
    return extractDoeda(targetUrl);
  }
  if (/hdabla|fakitonye/i.test(targetUrl)) {
    return extractHdabla(targetUrl);
  }
  if (/hdkore/i.test(targetUrl)) {
    return extractHdkore(targetUrl);
  }
  if (targetUrl.includes('pornhub.com')) {
    return extractPornhub(targetUrl);
  }
  if (targetUrl.includes('turkifsahub.com')) {
    return extractTurkifsahub(targetUrl);
  }
  if (/turkifsalar/i.test(targetUrl)) {
    return extractTurkifsalar(targetUrl);
  }
  if (/turkporno/i.test(targetUrl)) {
    return extractTurkporno(targetUrl);
  }
  if (targetUrl.includes('cloud.mail.ru')) {
    return extractCloudMailRu(targetUrl);
  }
  if (targetUrl.includes('9mod.com')) {
    return extract9Mod(targetUrl);
  }
  if (targetUrl.includes('itch.io')) {
    return extractItch(targetUrl);
  }
  if (targetUrl.includes('dramadizilerim.com')) {
    return extractDramadizilerim(targetUrl);
  }
  if (targetUrl.includes('instagram.com')) {
    return extractInstagram(targetUrl);
  }
  if (targetUrl.includes('tiktok.com')) {
    return extractTikTok(targetUrl);
  }
  if (targetUrl.includes('disk.yandex') || targetUrl.includes('yadi.sk')) {
    return extractYandex(targetUrl);
  }
  if (targetUrl.includes('drive.google.com')) {
    return extractGDrive(targetUrl);
  }
  if (targetUrl.includes('mega.nz')) {
    return extractMega(targetUrl);
  }
  if (targetUrl.includes('yabancidizi.co') || targetUrl.includes('yabancidizi.pw') || targetUrl.includes('yabancidizi.vip') || targetUrl.includes('yabancidizi.fun') || targetUrl.includes('yabancidizi.com')) {
    return extractYabancidizi(targetUrl);
  }
  if (targetUrl.includes('sezonlukdizi.org') || targetUrl.includes('sezonlukdizi.pro') || targetUrl.includes('sezonlukdizi.co') || targetUrl.includes('sezonlukdizi.com')) {
    return extractSezonlukdizi(targetUrl);
  }
  if (targetUrl.includes('terabox.com') || targetUrl.includes('teraboxapp.com') || targetUrl.includes('nephobox.com') || targetUrl.includes('terabox')) {
    return extractTerabox(targetUrl);
  }
  if (targetUrl.includes('liteapks.com')) {
    return extractLiteapks(targetUrl);
  }
  if (targetUrl.includes('modyolo.com')) {
    return extractModyolo(targetUrl);
  }
  if (targetUrl.includes('dizigom') || targetUrl.includes('dizibox') || targetUrl.includes('koreanturk') || targetUrl.includes('koreanizm') || targetUrl.includes('dizipal') || targetUrl.includes('filmmodu') || targetUrl.includes('fullhdfilmizlesene')) {
    let siteName = 'Film/Dizi Sitesi';
    if (targetUrl.includes('dizigom')) siteName = 'Dizigom';
    else if (targetUrl.includes('koreanturk')) siteName = 'Koreanturk';
    else if (targetUrl.includes('dizipal')) siteName = 'Dizipal';
    else if (targetUrl.includes('filmmodu')) siteName = 'FilmModu';
    return extractDiziSitesi(targetUrl, siteName);
  }
  try {
    const pageRes = await gotScraping.get({
      url: pageUrl,
      headerGeneratorOptions: {
        devices: ['desktop'],
        locales: ['tr-TR', 'en-US'],
        operatingSystems: ['windows']
      }
    });
    const $ = cheerio.load(pageRes.body);
    const alternativeLinks = $('div.alternative-links');
    if (alternativeLinks.length === 0) {
      throw new Error("No alternative video sources found on this page.");
    }

    // Get movie/series title
    const title = $('h1.section-title').text().replace(/izle/i, '').trim() || 'video';

    // We look for a working link by traversing alternative link options
    for (let i = 0; i < alternativeLinks.length; i++) {
      const container = $(alternativeLinks[i]);
      const langCode = container.attr('data-lang')?.toUpperCase() || '';
      const buttons = container.find('button.alternative-link');
      for (let j = 0; j < buttons.length; j++) {
        const btn = $(buttons[j]);
        const sourceName = btn.text().replace("(HDrip Xbet)", "").trim() + " " + langCode;
        const videoID = btn.attr('data-video');
        if (!videoID) continue;
        try {
          // Fetch video player details
          const apiRes = await gotScraping.get({
            url: `${mainUrl}/video/${videoID}/`,
            headers: {
              "Content-Type": "application/json",
              "X-Requested-With": "fetch",
              "Referer": pageUrl
            }
          });
          const apiData = typeof apiRes.body === 'string' ? JSON.parse(apiRes.body) : apiRes.body;
          const html = apiData.data?.html || apiData.html || '';

          // Find iframe data-src
          let iframeMatch = html.match(/data-src="([^"]+)"/) || html.match(/data-src=\\?"([^"]+)\\?"/);
          if (!iframeMatch) continue;
          let iframe = iframeMatch[1].replace(/\\/g, '');
          if (iframe.includes('rapidrame')) {
            iframe = `${mainUrl}/rplayer/` + iframe.split('/rplayer/').pop().split('?').shift();
          } else if (iframe.includes('mobi')) {
            const sub$ = cheerio.load(html);
            iframe = sub$('iframe').attr('data-src') || iframe;
          }

          // Fetch iframe page
          const iframeRes = await gotScraping.get({
            url: iframe,
            headers: {
              "Referer": mainUrl + "/"
            }
          });
          const iframe$ = cheerio.load(iframeRes.body);
          let scriptText = '';
          iframe$('script').each((_, el) => {
            const content = $(el).html() || '';
            if (content.includes('sources:')) {
              scriptText = content;
            }
          });
          if (!scriptText) continue;
          const unpacked = getAndUnpack(scriptText);

          // Dynamically find the array of strings inside the unpacked script
          const arrayMatch = unpacked.match(/\[\s*"[^"]+"(?:\s*,\s*"[^"]+")*\s*\]/);
          if (!arrayMatch) continue;
          const base64List = [...arrayMatch[0].matchAll(/"([^"]+)"/g)].map(m => m[1]);
          if (base64List.length === 0) continue;
          const decryptedUrl = dcHello(base64List);
          if (decryptedUrl) {
            return {
              title,
              source: sourceName,
              url: decryptedUrl
            };
          }
        } catch (e) {
          console.error(`Error processing source ${sourceName}:`, e.message);
        }
      }
    }
    throw new Error("Could not extract any valid video URLs from available sources.");
  } catch (err) {
    throw new Error(`Extraction failed: ${err.message}`);
  }
}

// ==========================================
// ANIMECIX EXTRACTOR AND RESOLVER FUNCTIONS
// ==========================================

import crypto from 'crypto';
export async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
export function tryDecrypt(hexPayload, keyHex, ivHex, algo = 'AES-CBC') {
  try {
    const ct = Buffer.from(hexPayload, 'hex');
    const key = Buffer.from(keyHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const nodeAlgo = algo === 'AES-GCM' ? 'aes-128-gcm' : algo === 'AES-CTR' ? 'aes-128-ctr' : 'aes-128-cbc';
    const d = crypto.createDecipheriv(nodeAlgo, key, iv);
    d.setAutoPadding(true);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8').replace(/\x00/g, '').trim();
  } catch (e) {
    return null;
  }
}
import { resolveAnimecixSlug, extractAnimecix, resolveTauVideo, resolveSibNet, resolveOkRu, pickBestQuality, getAnimecixSeasonEpisodes  } from "./extractors/animecix.js";
export { resolveAnimecixSlug, extractAnimecix, resolveTauVideo, resolveSibNet, resolveOkRu, pickBestQuality, getAnimecixSeasonEpisodes  };
import { decryptHentaizmString, cleanHentaizmTitle, initiateHentaizmLogin, extractHentaizm, resolvePlayerIframe, resolvePlayerAjax  } from "./extractors/hentaizm.js";
export { decryptHentaizmString, cleanHentaizmTitle, initiateHentaizmLogin, extractHentaizm, resolvePlayerIframe, resolvePlayerAjax  };
import { extractDoeda  } from "./extractors/doeda.js";
export { extractDoeda  };
import { extractHdabla  } from "./extractors/hdabla.js";
export { extractHdabla  };
import { getHdkoreSeasonEpisodes, decryptDramaizle, extractHdkorePuppeteer, extractHdkore  } from "./extractors/hdkore.js";
export { getHdkoreSeasonEpisodes, decryptDramaizle, extractHdkorePuppeteer, extractHdkore  };
import { extractPornhub  } from "./extractors/pornhub.js";
export { extractPornhub  };
import { extractTurkifsahub  } from "./extractors/turkifsahub.js";
export { extractTurkifsahub  };
import { extractTurkifsalar  } from "./extractors/turkifsalar.js";
export { extractTurkifsalar  };
import { veevDecode, buildArray, hexToString, decodeUrl, resolveTurkPornoEmbed, extractTurkporno  } from "./extractors/turkporno.js";
export { veevDecode, buildArray, hexToString, decodeUrl, resolveTurkPornoEmbed, extractTurkporno  };
import { extractCloudMailRu  } from "./extractors/cloudmailru.js";
export { extractCloudMailRu  };
import { extract9Mod  } from "./extractors/ninemod.js";
export { extract9Mod  };
import { extractItch  } from "./extractors/itch.js";
export { extractItch  };
import { getHdfilmcehennemiSeasonEpisodes  } from "./extractors/hdfilmcehennemi.js";
export { getHdfilmcehennemiSeasonEpisodes  };
import { extractDramadizilerim } from "./extractors/dramadizilerim.js";
export { extractDramadizilerim };
import { extractInstagram } from "./extractors/instagram.js";
export { extractInstagram };
import { extractTikTok } from "./extractors/tiktok.js";
export { extractTikTok };
import { extractYandex } from "./extractors/yandex.js";
export { extractYandex };
import { extractGDrive } from "./extractors/gdrive.js";
export { extractGDrive };
import { extractMega } from "./extractors/mega.js";
export { extractMega };
import { extractYabancidizi } from "./extractors/yabancidizi.js";
export { extractYabancidizi };
import { extractSezonlukdizi } from "./extractors/sezonlukdizi.js";
export { extractSezonlukdizi };
import { extractTerabox } from "./extractors/terabox.js";
export { extractTerabox };
import { extractLiteapks } from "./extractors/liteapks.js";
export { extractLiteapks };
import { extractModyolo } from "./extractors/modyolo.js";
export { extractModyolo };
import { extractDiziSitesi } from "./extractors/dizisitesi.js";
export { extractDiziSitesi };