import { gotScraping as originalGotScraping } from 'got-scraping';
const gotScraping = new Proxy(originalGotScraping, {
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
dns.lookup = function(hostname, options, callback) {
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
              return callback(null, [{ address: addresses6[0], family: 6 }]);
            }
            return callback(null, addresses6[0], 6);
          });
          return;
        }
        if (isAll) {
          return callback(null, [{ address: addresses[0], family: 4 }]);
        }
        return callback(null, addresses[0], 4);
      });
      return;
    }
    callback(err, address, family);
  });
};

const mainUrl = "https://www.hdfilmcehennemi.nl";

// ROT13 for strings
function rot13Str(str) {
  return str.replace(/[a-zA-Z]/g, (c) => {
    const code = c.charCodeAt(0);
    const start = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - start + 13) % 26) + start);
  });
}

// ROT13 for Buffers
function rot13Buffer(buf) {
  const res = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 97 && c <= 122) {
      res[i] = ((c - 97 + 13) % 26) + 97;
    } else if (c >= 65 && c <= 90) {
      res[i] = ((c - 65 + 13) % 26) + 65;
    } else {
      res[i] = c;
    }
  }
  return res;
}

// Unmix algorithm
function unmix(buf) {
  const chars = [];
  for (let i = 0; i < buf.length; i++) {
    const charCode = buf[i];
    const newChar = (charCode - (399756995 % (i + 5)) + 256) % 256;
    chars.push(String.fromCharCode(newChar));
  }
  return chars.join('');
}

// Decrypt base64 data using the custom strategies
function dcHello(parts) {
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
    }
  ];

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
function getAndUnpack(script) {
  const match = script.match(/eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?return p\}[\s\S]*?\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!match) return script;

  let [_, p, a, c, k] = match;
  a = parseInt(a, 10);
  c = parseInt(c, 10);
  k = k.split('|');

  const e = (c) => {
    return (c < a ? '' : e(Math.floor(c / a))) + String.fromCharCode(c % a > 35 ? c % a + 29 : c % a + 87);
  };

  const d = {};
  for (let i = 0; i < k.length; i++) {
    if (k[i]) {
      d[e(i)] = k[i];
    }
  }

  return p.replace(/\b[0-9a-zA-Z_]+\b/g, (w) => d[w] || w);
}

// ==========================================
// HENTAIZM DECRYPTER AND RESOLVER FUNCTIONS
// ==========================================
function decryptHentaizmString(encoded) {
  try {
    if (!encoded) return "";
    let cleaned = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const mod = cleaned.length % 4;
    if (mod > 0) {
      cleaned += "=".repeat(4 - mod);
    }
    const decodedBytes = Buffer.from(cleaned, 'base64');
    const decodedStr = decodedBytes.toString('utf8');
    return decodedStr.split('').reverse().join('');
  } catch (e) {
    console.error("Error decrypting Hentaizm string:", e.message);
    return "";
  }
}

function cleanHentaizmTitle(rawTitle) {
  let title = rawTitle.trim();
  const suffixes = [
    "Türkçe Altyazılı Hentai İzle",
    "Türkçe Altyazılı Hentai Izle",
    "Turkce Altyazili Hentai Izle",
    "Türkçe Altyazılı",
    "Türkçe Dublaj",
    "Hentai İzle",
    "Hentai Izle",
    "İzle",
    "Izle",
    "| Hentaizm"
  ];
  for (const suffix of suffixes) {
    if (title.toLowerCase().endsWith(suffix.toLowerCase())) {
      title = title.substring(0, title.length - suffix.length).trim();
    }
  }
  return title.trim().replace(/^[-|_|\s]+|[-|_|\s]+$/g, '').trim();
}

// Triggers a login captcha request to the user
async function initiateHentaizmLogin(fromJid) {
  try {
    const sock = botSocketRef.current;
    if (!sock) {
      console.error("[Hentaizm Login] Socket not connected yet.");
      return;
    }

    console.log(`[Hentaizm Login] Initiating login for JID: ${fromJid}`);
    const cookieJar = new CookieJar();
    const headerOpts = {
      devices: ['desktop'],
      locales: ['tr-TR', 'en-US'],
      operatingSystems: ['windows']
    };

    // 1. Visit login page to establish session cookie
    const loginUrl = "https://www.hentaizm1.com/login.php";
    await gotScraping.get({
      url: loginUrl,
      cookieJar,
      headerGeneratorOptions: headerOpts
    });

    // 2. Fetch captcha image using same session cookies
    const captchaUrl = "https://www.hentaizm1.com/captcha.php";
    const captchaRes = await gotScraping.get({
      url: captchaUrl,
      cookieJar,
      responseType: 'buffer',
      headerGeneratorOptions: headerOpts
    });

    // 3. Save captcha image to disk
    const captchaPath = path.join(downloadsDir, `hentaizm_captcha_${fromJid.replace(/[^a-zA-Z0-9]/g, '')}.png`);
    fs.writeFileSync(captchaPath, captchaRes.rawBody || captchaRes.body);

    // 4. Register pending login state
    pendingHentaizmLogins[fromJid] = {
      cookieJar,
      captchaPath,
      attempts: 0
    };

    // 5. Send captcha image to the user via WhatsApp
    await sock.sendMessage(fromJid, { text: "🔑 *Hentaizm Oturum Açma Gerekli!*\nVideoları çekebilmek için üye girişi yapılması gerekiyor.\n\nSıradaki güvenlik kodunu gönderiyorum, lütfen kodu bu sohbete yazarak gönderin." });
    await sock.sendMessage(fromJid, { 
      image: { url: captchaPath }, 
      caption: "Resimdeki 4 karakterli güvenlik kodunu yazın:" 
    });
    
  } catch (err) {
    console.error("[Hentaizm Login] Error initiating login:", err.message);
  }
}

async function extractHentaizm(pageUrl, fromJid = null) {
  try {
    const config = readConfig();
    let cookieJar;
    if (config.hentaizmCookies) {
      try {
        cookieJar = CookieJar.fromJSON(config.hentaizmCookies);
      } catch (e) {
        cookieJar = new CookieJar();
      }
    } else {
      cookieJar = new CookieJar();
    }

    const pageRes = await gotScraping.get({
      url: pageUrl,
      cookieJar,
      headerGeneratorOptions: {
        devices: ['desktop'],
        locales: ['tr-TR', 'en-US'],
        operatingSystems: ['windows']
      }
    });
    const html = pageRes.body;
    const $ = cheerio.load(html);

    // Check if we hit the login warning wall
    if (html.includes('Videoları görmek için üye girişi yapmanız gerekiyor') || (html.includes('login.php') && $('#player-area').text().includes('üye girişi'))) {
      if (fromJid) {
        console.log(`[Hentaizm] Login required for task. Initiating auto-login trigger for ${fromJid}...`);
        await initiateHentaizmLogin(fromJid);
        throw new Error("Üye girişi gerekiyor. WhatsApp üzerinden gönderilen doğrulama kodunu yanıtlayın.");
      } else {
        throw new Error("Hentaizm videolarını izlemek için üye girişi yapılması gerekmektedir.");
      }
    }

    const rawTitle = $('h1').text().trim() || $('title').text().trim() || 'Hentai Video';
    const title = cleanHentaizmTitle(rawTitle);

    // 1. Try to find dynamic TA_PROVIDERS_ENC mapping
    const taProvidersEncMatch = html.match(/window\.__TA_PROVIDERS_ENC\s*=\s*'([^']+)'/);
    let taProvidersJson = "";
    if (taProvidersEncMatch) {
      taProvidersJson = decryptHentaizmString(taProvidersEncMatch[1]);
    }

    let streamUrl = "";
    let sourceName = "Hentaizm";

    // Sniff from new dynamic attributes
    const buttons = $('a.alt-btn, button.alt-btn, div.player-alternatives a');
    for (let i = 0; i < buttons.length; i++) {
      const btn = $(buttons[i]);
      const dataProvider = btn.attr('data-provider');
      const dataVideoId = btn.attr('data-videoid');

      if (dataProvider && dataVideoId) {
        const provider = decryptHentaizmString(dataProvider);
        const videoId = decryptHentaizmString(dataVideoId);

        if (provider && videoId) {
          sourceName = provider;
          if (taProvidersJson) {
            const reversedKey = provider.split('').reverse().join('');
            const match = taProvidersJson.match(new RegExp(`"${reversedKey}"\\s*:\\s*"([^"]+)"`));
            if (match) {
              const iframeTemplate = match[1].replace(/\\"/g, '"').replace(/\\\//g, '/');
              const srcMatch = iframeTemplate.match(/src=\\?"([^\\"]+)\\?"/);
              if (srcMatch) {
                streamUrl = srcMatch[1].replace("%VIDEOID%", videoId);
                break;
              }
            }
          }
          // Fallback static maps
          if (!streamUrl) {
            if (provider === 'videa') streamUrl = `https://videa.hu/player?v=${videoId}`;
            else if (provider === 'cloudmailru') streamUrl = `https://cloud.mail.ru/public/${videoId}`;
            else if (provider === 'okru') streamUrl = `https://ok.ru/videoembed/${videoId}`;
          }
        }
      }
    }

    // Fallback: Check for Playerjs file configuration in script tags
    if (!streamUrl) {
      $('script').each((i, el) => {
        const html = $(el).html() || '';
        const match = html.match(/file\s*:\s*["']([^"']+)["']/);
        if (match) {
          streamUrl = match[1];
          sourceName = "PlayerJS Script";
        }
      });
    }

    // Direct iframe fallback
    if (!streamUrl) {
      const iframeSrc = $('iframe').attr('src');
      if (iframeSrc) {
        streamUrl = iframeSrc;
      }
    }

    if (!streamUrl) {
      throw new Error("Video kaynak linki hentaizm sayfasından ayıklanamadı.");
    }

    if (streamUrl.startsWith('//')) {
      streamUrl = 'https:' + streamUrl;
    }

    // Handover to yt-dlp if Videa
    if (streamUrl.includes('videa.hu')) {
      return {
        title,
        source: 'Videa',
        url: streamUrl
      };
    }

    // Sniff CloudMailRu streams if matched
    if (streamUrl.includes('cloud.mail.ru')) {
      const mailRuJar = new CookieJar();
      const mailRes = await gotScraping.get({ 
        url: streamUrl,
        cookieJar: mailRuJar,
        headerGeneratorOptions: {
          devices: ['desktop'],
          locales: ['tr-TR', 'en-US'],
          operatingSystems: ['windows']
        }
      });
      const finalUrl = mailRes.url;
      // Normalize cookie domains so tough-cookie sends them to any mail.ru subdomain
      try {
        const cookies = mailRuJar.getCookiesSync(finalUrl);
        for (const c of cookies) {
          c.domain = "mail.ru";
          c.hostOnly = false;
          mailRuJar.setCookieSync(c, finalUrl);
        }
      } catch(e) {}

      let publicId = finalUrl.split('public/').pop();

      // Check if it's a folder link, if so we need to construct [folderId]/[filename] as publicId
      let isFolder = false;
      const publicIdx = mailRes.body.indexOf('"public"');
      if (publicIdx !== -1) {
        const prePublic = mailRes.body.slice(0, publicIdx);
        isFolder = prePublic.includes('"folder":true') || prePublic.includes('"folder": true') || prePublic.includes('"kind":"folder"') || prePublic.includes('"type":"folder"');
      } else {
        isFolder = mailRes.body.includes('"folder":true') || mailRes.body.includes('"folder": true') || mailRes.body.includes('"kind":"folder"') || mailRes.body.includes('"type":"folder"');
      }

      console.log(`[DEBUG CloudMailRu] publicId original: ${publicId}, isFolder: ${isFolder}`);
      if (isFolder) {
        const nameMatch = mailRes.body.match(new RegExp('"name"\\s*:\\s*"([^"]+)"\\s*,\\s*"weblink"\\s*:\\s*"' + publicId + '"', 'i'));
        if (nameMatch && nameMatch[1]) {
          publicId = `${publicId}/${nameMatch[1]}`;
          console.log(`[DEBUG CloudMailRu] publicId updated via weblink: ${publicId}`);
        } else {
          const listIdx = mailRes.body.indexOf('"list"');
          if (listIdx !== -1) {
            const sub = mailRes.body.slice(listIdx, listIdx + 1500);
            const fallbackMatch = sub.match(/"name"\s*:\s*"([^"]+)"/i);
            if (fallbackMatch && fallbackMatch[1]) {
              publicId = `${publicId}/${fallbackMatch[1]}`;
              console.log(`[DEBUG CloudMailRu] publicId updated via fallback: ${publicId}`);
            }
          }
        }
      }

      const vidIdEnc = Buffer.from(publicId).toString('base64');
      const userAgent = mailRes.request.options.headers['user-agent'];
      const videoMatch = mailRes.body.match(/videowl_view":\s*\{\s*"count"\s*:\s*"1"\s*,\s*"url"\s*:\s*"([^"]+)"\s*\}/i);

      if (videoMatch) {
        const streamBase = videoMatch[1];
        // Select master playlist (use raw base64 string, do NOT encodeURIComponent!)
        const m3u8Url = `${streamBase}/0p/${vidIdEnc}.m3u8?double_encode=1`;
        return {
          title,
          source: 'CloudMailRu',
          url: m3u8Url,
          referer: 'https://cloud.mail.ru/',
          cookies: mailRuJar.toJSON(),
          userAgent: userAgent,
          headers: mailRes.request.options.headers
        };
      }

      // Try direct weblink get
      const weblinkGetMatch = mailRes.body.match(/"weblink_get"\s*:\s*\{\s*"count"[^}]+"url"\s*:\s*"([^"]+)"/);
      const weblinkMatch = mailRes.body.match(/"weblink"\s*:\s*"([^"]+)"/);
      if (weblinkGetMatch && weblinkMatch) {
        const dlUrl = weblinkGetMatch[1].endsWith('/') ? `${weblinkGetMatch[1]}${weblinkMatch[1]}` : `${weblinkGetMatch[1]}/${weblinkMatch[1]}`;
        return {
          title,
          source: 'CloudMailRu Direct',
          url: dlUrl,
          referer: 'https://cloud.mail.ru/',
          cookies: mailRuJar.toJSON(),
          userAgent: userAgent
        };
      }
    }

    return {
      title,
      source: sourceName,
      url: streamUrl
    };
  } catch (err) {
    throw new Error(`Hentaizm ayıklama hatası: ${err.message}`);
  }
}

// ==========================================
// DOEDA DECRYPTER AND RESOLVER FUNCTIONS
// ==========================================
async function resolvePlayerIframe(iframeUrl, referer) {
  try {
    const res = await gotScraping.get({
      url: iframeUrl,
      headers: {
        'Referer': referer
      },
      timeout: { request: 10000 }
    });
    const html = res.body;
    console.log(`[Player Resolver] Fetched HTML length: ${html.length} for URL: ${iframeUrl}`);
    if (html.length < 500) {
      console.log(`[Player Resolver] Fetched short HTML: ${html}`);
    }
    
    // Search for Playerjs file property
    const fileMatch = html.match(/file\s*:\s*["']([^"']+)["']/);
    console.log(`[Player Resolver] fileMatch:`, fileMatch ? fileMatch[0] : 'null');
    if (fileMatch) {
      let fileVal = fileMatch[1];
      const parts = fileVal.split(',');
      let bestPart = parts[0];
      for (const part of parts) {
        if (part.includes('1080p') || part.includes('720p')) {
          bestPart = part;
          break;
        }
      }
      const cleanUrl = bestPart.replace(/\[[^\]]+\]/, '').trim();
      console.log(`[Player Resolver] cleanUrl: "${cleanUrl}"`);
      if (cleanUrl.startsWith('http')) {
        return cleanUrl;
      }
    }
  } catch (err) {
    console.error('[Player Resolver] Error:', err.message);
  }
  return null;
}

async function resolvePlayerAjax(iframeUrl, pageUrl) {
  try {
    if (iframeUrl.startsWith('//')) {
      iframeUrl = 'https:' + iframeUrl;
    }
    
    const vidMatch = iframeUrl.match(/[?&]vid=([a-f0-9]+)/);
    if (!vidMatch) {
      return null;
    }
    const vidHash = vidMatch[1];
    
    const urlObj = new URL(iframeUrl);
    const pathParts = urlObj.pathname.split('/');
    pathParts.pop();
    const basePath = pathParts.join('/') + '/';
    const ajaxUrl = `${urlObj.origin}${basePath}ajax_sources.php`;
    
    console.log(`[Player Resolver] Requesting sources from: ${ajaxUrl} with vid: ${vidHash}`);
    
    const alternatives = ["ankacdn", "0", "mp4", "alternative"];
    for (const alt of alternatives) {
      try {
        const response = await axios.post(
          ajaxUrl,
          new URLSearchParams({
            vid: vidHash,
            alternative: alt,
            ord: "0"
          }).toString(),
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
              "Referer": iframeUrl,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout: 10000
          }
        );
        
        const data = response.data;
        if (data && (data.status === "true" || data.status === true) && Array.isArray(data.source) && data.source.length > 0) {
          const bestSource = data.source.sort((a, b) => {
            const qA = parseInt(a.label) || 0;
            const qB = parseInt(b.label) || 0;
            return qB - qA;
          })[0];
          
          if (bestSource && bestSource.file) {
            console.log(`[Player Resolver] Successfully resolved source: ${bestSource.file} using alternative: ${alt}`);
            return bestSource.file;
          }
        }
      } catch (err) {
        console.error(`[Player Resolver] Alternative ${alt} failed:`, err.message);
      }
    }
  } catch (e) {
    console.error(`[Player Resolver] Ajax player resolution error:`, e.message);
  }
  return null;
}

async function extractDoeda(pageUrl) {
  try {
    const pageRes = await gotScraping.get({ url: pageUrl });
    const $ = cheerio.load(pageRes.body);

    let title = $('h1').first().text().trim() || $('title').text().trim() || 'Doeda Video';
    title = title.replace(/\s*-\s*(Astalavista|Doeda|JetPlayer|Player|Video).*$/i, '').trim();

    // Find JetPlayer or AMP iframe
    const iframe = $('iframe, amp-iframe');
    let iframeUrl = iframe.attr('src') || iframe.attr('data-src') || $('meta[property="og:video"]').attr('content');

    if (!iframeUrl) {
      throw new Error("Doeda JetPlayer video penceresi bulunamadı.");
    }

    if (iframeUrl.startsWith('//')) {
      iframeUrl = 'https:' + iframeUrl;
    }

    // Try resolving directly via PlayerJS iframe parser first
    console.log(`Attempting direct PlayerJS resolution for: ${iframeUrl}`);
    let directPlayerUrl = await resolvePlayerIframe(iframeUrl, pageUrl);
    
    // Try resolving dynamically via AJAX resolver
    if (!directPlayerUrl) {
      console.log(`Attempting dynamic AJAX resolution for: ${iframeUrl}`);
      directPlayerUrl = await resolvePlayerAjax(iframeUrl, pageUrl);
    }
    
    if (directPlayerUrl) {
      return {
        title,
        source: 'PlayerJS Direct',
        url: directPlayerUrl,
        referer: new URL(pageUrl).origin + '/'
      };
    }

    // Sniff the video ID (vid) for fallback ajax_sources.php
    const vidMatch = iframeUrl.match(/[?&]vid=([a-f0-9]+)/);
    if (!vidMatch) {
      throw new Error("JetPlayer video hash veya PlayerJS adresi çözümlenemedi.");
    }

    const vidHash = vidMatch[1];

    // POST directly to JetPlayer AJAX sources endpoint
    const response = await axios.post(
      "https://jetplayer.net/jet/ajax_sources.php",
      new URLSearchParams({
        vid: vidHash,
        alternative: "0",
        ord: "0"
      }).toString(),
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Referer": new URL(pageUrl).origin + "/",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 15000
      }
    );

    const data = response.data;
    if (data && data.status && Array.isArray(data.source) && data.source.length > 0) {
      // Find the highest quality source
      const bestSource = data.source.sort((a, b) => {
        const qA = parseInt(a.label) || 0;
        const qB = parseInt(b.label) || 0;
        return qB - qA;
      })[0];

      return {
        title,
        source: `JetPlayer (${bestSource.label})`,
        url: bestSource.file,
        referer: new URL(pageUrl).origin + '/'
      };
    }

    throw new Error("JetPlayer veya PlayerJS sunucusundan video dosyası çözümlenemedi.");
  } catch (err) {
    throw new Error(`Doeda ayıklama hatası: ${err.message}`);
  }
}

// ==========================================
// HDABLA DECRYPTER AND RESOLVER FUNCTIONS
// ==========================================
async function extractHdabla(pageUrl) {
  try {
    const pageRes = await gotScraping.get({ url: pageUrl });
    const $ = cheerio.load(pageRes.body);

    const title = $('h1.entry-title').text().trim() || 
                  $('meta[property="og:title"]').attr('content')?.trim() || 
                  $('title').text().replace(/izle/i, '').trim() || 
                  'HdAbla Video';

    // Sniff direct source elements or fallback to amp-iframe or iframe
    let videoUrl = $('video source').attr('src');
    if (!videoUrl) {
      videoUrl = $('amp-iframe').attr('src') || $('iframe').attr('src');
    }

    if (!videoUrl) {
      throw new Error("HdAbla video oynatıcı kaynağı bulunamadı.");
    }

    if (videoUrl.startsWith('//')) {
      videoUrl = 'https:' + videoUrl;
    }

    // If videoUrl points to an embedded player (e.g. oynat.php / fakitonye / player)
    if (videoUrl.includes('oynat.php') || videoUrl.includes('player') || videoUrl.includes('embed') || videoUrl.includes('fakitonye')) {
      try {
        const playerRes = await gotScraping.get({
          url: videoUrl,
          headers: { 'Referer': 'https://hdabla.net/' }
        });
        const bodyText = playerRes.body;
        const fileMatch = bodyText.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) ||
                          bodyText.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*/i);
        if (fileMatch) {
          videoUrl = fileMatch[1] || fileMatch[0];
        }
      } catch (e) {
        console.error("HdAbla iframe player fetch failed:", e.message);
      }
    }

    return {
      title,
      source: 'HdAbla',
      url: videoUrl,
      referer: 'https://hdabla.net/'
    };
  } catch (err) {
    throw new Error(`HdAbla ayıklama hatası: ${err.message}`);
  }
}


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

  // Handle direct video links (MP4, MKV, WebM, AVI, etc.)
  const urlLower = targetUrl.toLowerCase().split('?')[0];
  if (urlLower.endsWith('.mp4') || urlLower.endsWith('.mkv') || urlLower.endsWith('.webm') || urlLower.endsWith('.avi')) {
    const fileName = path.basename(urlLower, path.extname(urlLower));
    const decodedTitle = decodeURIComponent(fileName).replace(/[-_]+/g, ' ').trim();
    return {
      title: decodedTitle || 'Direct Video',
      source: 'Direct Link',
      url: targetUrl
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
async function resolveAnimecixSlug(slug, host = "https://animecix.tv") {
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9\-]/g, '');
  const words = cleanSlug.split('-');
  
  const SECURITY_TOKEN = "7Y2ozlO+QysR5w9Q6Tupmtvl9jJp7ThFH8SB+Lo7NvZjgjqRSqOgcT2v4ISM9sP10LmnlYI8WQ==.xrlyOBFS5BHjQ2Lk";
  const APP_HASH = "b849e8a9f6cceff267251a73644faacc801ad726cc8f22a9c323c56a203f5446";

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
    'X-Requested-With': 'com.kraptor.AnimeciX',
    'X-App-Version': '1.0.5',
    'x-e-h': SECURITY_TOKEN,
    'X-App-Hash': APP_HASH,
    'Referer': host + '/'
  };

  let items = [];
  // Fallback search loop from longest to shortest query
  for (let len = Math.min(words.length, 3); len >= 1; len--) {
    const query = words.slice(0, len).join(' ');
    try {
      const res = await axios.get(`${host}/secure/titles?query=${encodeURIComponent(query)}`, { headers, timeout: 10000 });
      items = res.data?.pagination?.data || [];
      if (items.length > 0) {
        break;
      }
    } catch(e) {
      // Fail silent
    }
  }
  
  if (items.length === 0) {
    throw new Error(`Animecix'te "${slug}" için sonuç bulunamadı.`);
  }

  let bestItem = null;
  let bestRatio = 0;
  const urlWords = cleanSlug.split('-');
  
  for (const item of items) {
    const names = [item.name, item.name_romanji, item.name_english, item.original_title].filter(Boolean);
    for (const name of names) {
      const nameWords = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
      if (nameWords.length === 0) continue;
      
      const overlap = nameWords.filter(w => urlWords.includes(w)).length;
      const ratio = overlap / nameWords.length;
      
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestItem = item;
      }
    }
  }

  if (!bestItem || bestRatio < 0.2) {
    return items[0].id;
  }

  return bestItem.id;
}

async function extractAnimecix(pageUrl) {
  try {
    const host = new URL(pageUrl).origin;
    const parts = pageUrl.split('/');
    
    let titleId = null;
    const titlesIdx = parts.indexOf('titles');
    if (titlesIdx !== -1) {
      titleId = parts[titlesIdx + 1];
    } else {
      const diziMatch = pageUrl.match(/\/dizi\/([^/]+)/);
      if (diziMatch) {
        titleId = await resolveAnimecixSlug(diziMatch[1], host);
      }
    }

    // Parse season and episode number
    let season = null;
    const seasonIdx = parts.findIndex(p => p.toLowerCase().startsWith('season') || p.toLowerCase().startsWith('sezon'));
    if (seasonIdx !== -1) {
      const sPart = parts[seasonIdx];
      const sMatch = sPart.match(/\d+/);
      if (sMatch) {
        season = sMatch[0];
      } else if (seasonIdx + 1 < parts.length) {
        season = parts[seasonIdx + 1];
      }
    }

    let episode = null;
    const episodeIdx = parts.findIndex(p => p.toLowerCase().startsWith('episode') || p.toLowerCase().startsWith('bolum') || p.toLowerCase().startsWith('bölüm'));
    if (episodeIdx !== -1) {
      const ePart = parts[episodeIdx];
      const eMatch = ePart.match(/\d+/);
      if (eMatch) {
        episode = eMatch[0];
      } else if (episodeIdx + 1 < parts.length) {
        episode = parts[episodeIdx + 1];
      }
    }

    if (!titleId) {
      throw new Error("Geçersiz Animecix URL formatı.");
    }

    if (!season) season = "1";
    if (!episode) episode = "1";

    const SECURITY_TOKEN = "7Y2ozlO+QysR5w9Q6Tupmtvl9jJp7ThFH8SB+Lo7NvZjgjqRSqOgcT2v4ISM9sP10LmnlYI8WQ==.xrlyOBFS5BHjQ2Lk";
    const APP_HASH = "b849e8a9f6cceff267251a73644faacc801ad726cc8f22a9c323c56a203f5446";

    const apiHeaders = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
      'X-Requested-With': 'com.kraptor.AnimeciX',
      'X-App-Version': '1.0.5',
      'x-e-h': SECURITY_TOKEN,
      'X-App-Hash': APP_HASH,
      'Referer': host + '/'
    };

    // ── Başlığı Title Detail API'den çek (anime adı + bölüm adı) ──
    let title = `Animecix_${titleId}_S${season}_E${episode}`;
    try {
      const titleApiUrl = `${host}/secure/titles/${titleId}?titleId=${titleId}&seasonNumber=${season}&page=1&perPage=100`;
      const titleRes = await axios.get(titleApiUrl, { headers: apiHeaders, timeout: 15000 });
      const titleData = titleRes.data?.data || titleRes.data;
      const animeName = titleData?.title?.name;
      if (animeName) {
        // Türkçe karakterleri ve özel karakterleri temizleyip boşlukları alt çizgi yapıyoruz
        const cleanAnimeName = animeName
          .replace(/[^a-zA-Z0-9\s]/g, '')
          .trim()
          .replace(/\s+/g, '_');
        title = `${cleanAnimeName}_S${season}_E${episode}`;
      }
    } catch (e) {
      console.error('Animecix başlık API hatası (devam ediyor):', e.message);
    }

    // ── Video kaynaklarını çek ──
    const apiUrl = `${host}/secure/episode-videos?titleId=${titleId}&season=${season}&episode=${episode}`;
    const response = await axios.get(apiUrl, { headers: apiHeaders, timeout: 15000 });

    const sources = response.data.data || response.data;
    if (Array.isArray(sources) && sources.length > 0) {
      let providerUrl = null;
      let sourceName = '';

      // Priority: SibNet > Tau > Ok.ru > Generic
      const sibnet = sources.find(s => s.url && s.url.includes('sibnet.ru'));
      if (sibnet) {
        providerUrl = await resolveSibNet(sibnet.url);
        if (providerUrl) sourceName = 'SibNet';
      }

      if (!providerUrl) {
        const tau = sources.find(s => s.url && (s.url.includes('tau-video.xyz') || s.url.includes('tau')));
        if (tau) {
          providerUrl = await resolveTauVideo(tau.url);
          if (providerUrl) sourceName = 'Tau Video';
        }
      }

      if (!providerUrl) {
        const okru = sources.find(s => s.url && s.url.includes('ok.ru'));
        if (okru) {
          providerUrl = await resolveOkRu(okru.url);
          if (providerUrl) sourceName = 'Ok.ru';
        }
      }

      // Generic fallback: check all sources for direct links or other embeds
      if (!providerUrl) {
        for (const s of sources) {
          if (!s.url) continue;
          if (s.url.includes('sibnet.ru')) {
            providerUrl = await resolveSibNet(s.url);
            if (providerUrl) { sourceName = 'SibNet'; break; }
          } else if (s.url.includes('tau-video.xyz') || s.url.includes('tau')) {
            providerUrl = await resolveTauVideo(s.url);
            if (providerUrl) { sourceName = 'Tau Video'; break; }
          } else if (s.url.includes('ok.ru')) {
            providerUrl = await resolveOkRu(s.url);
            if (providerUrl) { sourceName = 'Ok.ru'; break; }
          } else if (s.url.startsWith('http://') || s.url.startsWith('https://')) {
            providerUrl = s.url;
            sourceName = s.name || s.extra || 'Direkt Video';
            break;
          }
        }
      }

      if (providerUrl) {
        if (providerUrl.includes('.m3u8')) {
          providerUrl = await pickBestQuality(providerUrl);
        }
        return {
          title,
          source: sourceName,
          url: providerUrl,
          referer: host + '/'
        };
      }
    }
    throw new Error("Çözümlenebilir video kaynağı bulunamadı.");
  } catch (err) {
    throw new Error(`Animecix çözme hatası: ${err.message}`);
  }
}

async function resolveTauVideo(embedUrl) {
  try {
    const videoId = embedUrl.split('/').pop().split('?')[0];
    const vidParam = new URL(embedUrl).searchParams.get('vid');
    const apiUrl = `https://tau-video.xyz/api/video/${videoId}${vidParam ? `?vid=${vidParam}` : ''}`;

    const response = await axios.get(apiUrl, {
      headers: {
        'Referer': 'https://animecix.tv/',
        'X-Requested-With': 'com.kraptor.AnimeciX',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      timeout: 15000
    });
    if (response.data && response.data.urls && response.data.urls.length > 0) {
      const best = response.data.urls.sort((a, b) => (parseInt(b.label) || 0) - (parseInt(a.label) || 0))[0];
      return best.url;
    }
  } catch (e) { }
  return null;
}

async function resolveSibNet(embedUrl) {
  try {
    const response = await axios.get(embedUrl, { 
      headers: { 
        'Referer': 'https://animecix.tv/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      responseType: 'text',
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024
    });
    const html = typeof response.data === 'string' ? response.data : response.data.toString('utf8');
    const match = html.match(/src:\s*["']([^"']+)["']/) || html.match(/source\s+src=["']([^"']+)["']/);
    if (match) {
      let videoPath = match[1];
      if (videoPath.startsWith('//')) videoPath = 'https:' + videoPath;
      return videoPath.startsWith('http') ? videoPath : `https://video.sibnet.ru${videoPath}`;
    }
  } catch (e) { }
  return null;
}

async function resolveOkRu(embedUrl) {
  try {
    const response = await axios.get(embedUrl, {
      headers: { 'Referer': 'https://animecix.tv/' },
      responseType: 'text',
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024
    });
    const html = typeof response.data === 'string' ? response.data : response.data.toString('utf8');
    const match = html.match(/hlsManifestUrl\\":\\"(.*?)\\"/);
    if (match) {
      return match[1].replace(/\\u0026/g, '&');
    }
  } catch (e) { }
  return null;
}

async function pickBestQuality(masterUrl) {
  try {
    const response = await axios.get(masterUrl, {
      responseType: 'text',
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024
    });
    const content = typeof response.data === 'string' ? response.data : response.data.toString('utf8');
    if (content.includes('#EXT-X-STREAM-INF')) {
      const lines = content.split('\n');
      let bestBandwidth = 0;
      let bestUri = '';
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('BANDWIDTH=')) {
          const match = lines[i].match(/BANDWIDTH=(\d+)/);
          if (match) {
            const bw = parseInt(match[1]);
            // Find next non-empty, non-comment line
            for (let j = i + 1; j < lines.length; j++) {
              const nextLine = lines[j].trim();
              if (nextLine && !nextLine.startsWith('#')) {
                if (bw > bestBandwidth) {
                  bestBandwidth = bw;
                  bestUri = nextLine;
                }
                break;
              }
            }
          }
        }
      }
      if (bestUri) {
        if (bestUri.startsWith('http://') || bestUri.startsWith('https://')) {
          return bestUri;
        }
        // Resolve relative URL against master URL base
        const base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
        return base + bestUri;
      }
    }
  } catch (e) { }
  return masterUrl;
}

export async function getAnimecixSeasonEpisodes(seasonUrl) {
  try {
    const host = new URL(seasonUrl).origin;
    const parts = seasonUrl.split('/');
    
    let titleId = null;
    const titlesIdx = parts.indexOf('titles');
    if (titlesIdx !== -1) {
      titleId = parts[titlesIdx + 1];
    } else {
      const diziMatch = seasonUrl.match(/\/dizi\/([^/]+)/);
      if (diziMatch) {
        titleId = await resolveAnimecixSlug(diziMatch[1], host);
      }
    }

    // Parse season (default to "1" if show main page URL is provided)
    let season = null;
    const seasonIdx = parts.findIndex(p => p.toLowerCase().startsWith('season') || p.toLowerCase().startsWith('sezon'));
    if (seasonIdx !== -1) {
      const sPart = parts[seasonIdx];
      const sMatch = sPart.match(/\d+/);
      if (sMatch) {
        season = sMatch[0];
      } else if (seasonIdx + 1 < parts.length) {
        season = parts[seasonIdx + 1];
      }
    }
    if (!season) {
      season = "1";
    }

    if (!titleId) {
      throw new Error("Geçersiz Animecix Sezon URL formatı.");
    }

    const apiUrl = `${host}/secure/titles/${titleId}?titleId=${titleId}&seasonNumber=${season}&page=1&perPage=100`;

    const SECURITY_TOKEN = "7Y2ozlO+QysR5w9Q6Tupmtvl9jJp7ThFH8SB+Lo7NvZjgjqRSqOgcT2v4ISM9sP10LmnlYI8WQ==.xrlyOBFS5BHjQ2Lk";
    const APP_HASH = "b849e8a9f6cceff267251a73644faacc801ad726cc8f22a9c323c56a203f5446";

    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
        'X-Requested-With': 'com.kraptor.AnimeciX',
        'X-App-Version': '1.0.5',
        'x-e-h': SECURITY_TOKEN,
        'X-App-Hash': APP_HASH,
        'Referer': host + '/'
      },
      timeout: 15000
    });

    const data = response.data.data || response.data;
    if (!data || !data.title || !data.title.seasons) {
        throw new Error('API yanıtı geçersiz.');
    }

    const seasonObj = data.title.seasons.find(s => s.number == season);
    if (!seasonObj || !seasonObj.episodePagination || !seasonObj.episodePagination.data) {
        throw new Error(`Sezon ${season} için bölüm listesi bulunamadı.`);
    }

    // Get candidate episodes (not in future)
    const candidates = seasonObj.episodePagination.data
      .filter(ep => {
        if (ep.release_date) {
          const relDate = new Date(ep.release_date);
          if (relDate > new Date()) return false; // Skip future episodes
        }
        return true;
      });

    // Pre-check: verify each episode actually has video sources (parallel, max 5 at a time)
    const apiHeaders = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
      'X-Requested-With': 'com.kraptor.AnimeciX',
      'X-App-Version': '1.0.5',
      'x-e-h': SECURITY_TOKEN,
      'X-App-Hash': APP_HASH,
      'Referer': host + '/'
    };

    const CHUNK_SIZE = 5;
    const episodesWithSources = [];
    let skippedCount = 0;

    for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
      const chunk = candidates.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map(ep =>
          axios.get(
            `${host}/secure/episode-videos?titleId=${titleId}&season=${season}&episode=${ep.episode_number}`,
            { headers: apiHeaders, timeout: 10000 }
          ).then(r => ({ ep, sources: r.data?.data || r.data || [] }))
        )
      );
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.sources.length > 0) {
          episodesWithSources.push(result.value.ep);
        } else {
          skippedCount++;
          console.log(`[Season Filter] Bölüm ${result.value?.ep?.episode_number ?? '?'} atlandı - video kaynağı yok`);
        }
      }
    }

    const episodes = episodesWithSources.map(ep => ({
      number: ep.episode_number,
      name: ep.name || `${ep.episode_number}. Bölüm`,
      url: `${host}/titles/${titleId}/season/${season}/episode/${ep.episode_number}`
    }));

    episodes.sort((a, b) => a.number - b.number);

    return {
        animeName: data.title.name,
        episodes,
        skippedCount
    };
  } catch (err) {
    throw new Error(`Bölümler alınamadı: ${err.message}`);
  }
}

export async function getHdfilmcehennemiSeasonEpisodes(seasonUrl) {
  try {
    const host = new URL(seasonUrl).origin;
    let targetUrl = seasonUrl;

    // Parse requested season if specified in seasonUrl (e.g. /sezon-2/)
    const seasonMatch = seasonUrl.match(/\/sezon-(\d+)/i);
    const requestedSeason = seasonMatch ? seasonMatch[1] : null;

    let res = await gotScraping.get({ url: targetUrl });
    let $ = cheerio.load(res.body);

    if (($('title').text().includes('404') || res.body.includes('Sayfa Bulunamadı')) && seasonMatch) {
      targetUrl = seasonUrl.replace(/\/sezon-\d+\/?$/i, '/');
      console.log(`HDF 404 fallback: ${seasonUrl} -> ${targetUrl}`);
      res = await gotScraping.get({ url: targetUrl });
      $ = cheerio.load(res.body);
    }

    const seriesName = $('h1.section-title').text().replace(/izle/i, '').trim() ||
                       $('title').text().split('|')[0].replace(/izle/i, '').trim() ||
                       'HDfilmcehennemi Dizi';

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

export async function getHdkoreSeasonEpisodes(seasonUrl) {
  try {
    const host = new URL(seasonUrl).origin;
    const res = await gotScraping.get({
      url: seasonUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121 Safari/537.36',
      }
    });
    const $ = cheerio.load(res.body);
    
    const showTitle = $('h1').first().text().trim() || $('title').text().trim();
    const episodes = [];
    const seen = new Set();

    $('a[href*="/bolum/"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/bolum/')) {
        const fullUrl = href.startsWith('http') ? href : `${host}${href}`;
        if (!seen.has(fullUrl)) {
          seen.add(fullUrl);
          const name = $(el).closest('[id^="episode-card"]').find('h5 a').text().trim() 
                    || $(el).text().trim() 
                    || `Bölüm ${i+1}`;
          episodes.push({
            url: fullUrl,
            name: name.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim()
          });
        }
      }
    });

    return {
      seriesName: showTitle,
      episodes
    };
  } catch (err) {
    throw new Error(`HDKore dizisi bölümleri alınamadı: ${err.message}`);
  }
}

// Decrypt algorithm for dramaizle.site /api/v1/download responses
async function decryptDramaizle(encryptedHex, videoId) {
  // Static key and IV derived via VM emulation from dramaizle index bundle
  // KEY_HEX = '110f0b13740f0b6e6d75100c0d0d6361'
  // IV_HEX = '313233343536373839306fc4b875797472'
  const KEY_HEX = '110f0b13740f0b6e6d75100c0d0d6361';
  const IV_HEX = '313233343536373839306fc4b875797472';

  const key = Buffer.from(KEY_HEX, 'hex');
  const iv = Buffer.from(IV_HEX, 'hex').slice(0, 16); // Node.js accepts strictly 16 byte IV

  const encryptedBytes = Buffer.from(encryptedHex.match(/[\da-f]{2}/gi).map(p => parseInt(p, 16)));
  
  // Try standard decipher first
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    let decrypted = decipher.update(encryptedBytes);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    const text = decrypted.toString('utf8');
    
    // Check if valid JSON returned (cleaning null bytes and padding)
    const cleanJson = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    if (cleanJson) {
      const parsed = JSON.parse(cleanJson);
      if (parsed.url || parsed.hls || parsed.mp4) return parsed;
    }
  } catch (e) {
    console.error('[Dramaizle CBC Decryption Error]', e.message);
  }
  return null;
}

import crypto from 'crypto';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tryDecrypt(hexPayload, keyHex, ivHex, algo = 'AES-CBC') {
  try {
    const ct = Buffer.from(hexPayload, 'hex');
    const key = Buffer.from(keyHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const nodeAlgo = algo === 'AES-GCM' ? 'aes-128-gcm' : algo === 'AES-CTR' ? 'aes-128-ctr' : 'aes-128-cbc';
    const d = crypto.createDecipheriv(nodeAlgo, key, iv);
    d.setAutoPadding(true);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8').replace(/\x00/g, '').trim();
  } catch(e) { return null; }
}

export async function extractHdkorePuppeteer(pageUrl) {
  console.log(`\n[HDKore Puppeteer Fallback] ${pageUrl}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--autoplay-policy=no-user-gesture-required',
    ]
  });

  let capturedApiPayload = null;
  let capturedVideoUrl = null;
  let title = '';

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    await page.evaluateOnNewDocument(() => {
      window.__localHooks = [];
      window.__localVideoSrc = null;

      try {
        const orig = window.crypto.subtle.decrypt.bind(window.crypto.subtle);
        window.crypto.subtle.decrypt = async function(algorithm, key, data) {
          const result = orig(algorithm, key, data);
          try {
            window.crypto.subtle.exportKey('raw', key).then(kd => {
              const kHex = [...new Uint8Array(kd)].map(b => b.toString(16).padStart(2,'0')).join('');
              const ivSrc = algorithm.iv || algorithm.counter;
              let ivBytes = ivSrc ? new Uint8Array(ivSrc instanceof ArrayBuffer ? ivSrc : ivSrc.buffer || new ArrayBuffer(0)) : new Uint8Array(16);
              const ivHex = [...ivBytes].map(b => b.toString(16).padStart(2,'0')).join('');
              window.__localHooks.push({ key: kHex, iv: ivHex, algo: algorithm.name || 'AES-CBC', t: Date.now() });
            }).catch(() => {});
          } catch(e) {}
          return result;
        };
      } catch(e) {}

      try {
        const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        if (desc?.set) {
          Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            set(val) {
              if (val && val.length > 10 && !val.startsWith('data:')) {
                window.__localVideoSrc = val;
              }
              desc.set.call(this, val);
            },
            get: desc.get, configurable: true
          });
        }
      } catch(e) {}
    });

    await page.setRequestInterception(true);
    page.on('request', req => req.continue());

    page.on('response', async res => {
      const url = res.url();
      if ((url.includes('.m3u8') || url.includes('.mp4') || url.includes('/hls/')) &&
          !url.includes('google') && !url.includes('imasdk') && res.status() < 400) {
        capturedVideoUrl = url;
        return;
      }

      if (url.includes('/api/v1/')) {
        try {
          const text = await res.text().catch(() => '');
          if (text && text.length > 10) {
            capturedApiPayload = text.trim();
          }
        } catch(e) {}
      }
    });

    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch(e) {}

    title = await page.title().catch(() => '');

    let dramaFrame = null;
    for (let i = 0; i < 15; i++) {
      dramaFrame = page.frames().find(f => f.url().includes('dramaizle'));
      if (dramaFrame) break;
      await sleep(1000);
    }
    if (!dramaFrame) throw new Error('dramaizle frame yok');

    await sleep(8000);

    try {
      await dramaFrame.evaluate(() => {
        const btn = document.querySelector('media-play-button') || document.querySelector('.vds-play-button');
        if (btn) btn.click();
        const v = document.querySelector('video');
        if (v) { v.muted = true; v.play().catch(() => {}); }
      }).catch(() => {});
    } catch(e) {}

    try {
      const ifrEl = await page.$('iframe[src*="dramaizle"]');
      if (ifrEl) {
        const box = await ifrEl.boundingBox();
        if (box) await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
      }
    } catch(e) {}

    for (let i = 0; i < 30; i++) {
      if (capturedVideoUrl) break;

      if (!dramaFrame.isDetached()) {
        try {
          const frameData = await dramaFrame.evaluate(() => ({
            hooks: window.__localHooks || [],
            videoSrc: window.__localVideoSrc || null
          })).catch(() => null);

          if (frameData && frameData.videoSrc) {
            capturedVideoUrl = frameData.videoSrc;
            break;
          }
        } catch(e) {}
      }
      await sleep(1000);
    }

    if (!capturedVideoUrl && capturedApiPayload) {
      let hooks = [];
      try {
        hooks = await dramaFrame.evaluate(() => window.__localHooks || []).catch(() => []);
      } catch(e) {}

      for (const hook of hooks) {
        const dec = tryDecrypt(capturedApiPayload, hook.key, hook.iv, hook.algo);
        if (dec && (dec.includes('http') || dec.includes('{'))) {
          const urlMatch = dec.match(/https?:\/\/[^\s"'\\]+/);
          if (urlMatch) { capturedVideoUrl = urlMatch[0]; break; }
        }
      }
    }

    await browser.close();

    if (capturedVideoUrl) {
      return {
        title: title.replace(/\s*[-–|]\s*(İzle|izle|Türkçe|HDKore).*/i, '').trim(),
        url: capturedVideoUrl,
        referer: pageUrl,
        source: 'HDKore (Puppeteer)'
      };
    }
    return null;
  } catch(err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

export async function extractHdkore(pageUrl) {
  try {
    const host = new URL(pageUrl).origin;
    const res = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      }
    });
    const $ = cheerio.load(res.body);
    
    let showTitle = $('h1').first().text().trim() || $('title').text().trim();
    showTitle = showTitle.replace(/\s*[-–|]\s*(İzle|izle|Türkçe|HDKore|Watch).*/i, '').trim();

    // Find dramaizle player iframe ID
    let iframeUrl = $('#embed-native-iframe').attr('src');
    let videoId = null;

    if (iframeUrl && iframeUrl.includes('dramaizle.site')) {
      videoId = iframeUrl.split('#')[1] || iframeUrl.split('/').pop();
    }

    if (!videoId) {
      const embedRaw = $('#embed-native-wrap').attr('data-embed-raw');
      if (embedRaw) {
        let decoded = embedRaw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const match = decoded.match(/dramaizle\.site\/#([a-zA-Z0-9]+)/);
        if (match) videoId = match[1];
      }
    }

    if (videoId) {
      console.log(`[HDKore Extractor] Found videoId: ${videoId}`);
      const infoUrl = `https://dramaizle.site/api/v1/info?id=${videoId}`;
      const infoRes = await axios.get(infoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
          'Referer': 'https://hdkore1.com/'
        }
      });

      if (infoRes.data) {
        const hex = infoRes.data.trim();
        const key = Buffer.from('kiemtienmua911ca');
        const iv  = Buffer.from('1234567890oiuytr');
        
        try {
          const ct = Buffer.from(hex, 'hex');
          const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
          decipher.setAutoPadding(true);
          const decryptedText = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8').replace(/\x00/g, '').trim();
          
          const parsed = JSON.parse(decryptedText);
          console.log('[HDKore Extractor] Decrypted payload keys:', Object.keys(parsed));
          
          const streamUrl = parsed.file || parsed.url || parsed.hls || parsed.mp4 || parsed.stream;
          if (streamUrl) {
            return {
              title: showTitle,
              source: 'HDKore (Dramaizle API)',
              url: streamUrl,
              referer: 'https://dramaizle.site/'
            };
          }
        } catch(e) {
          console.error('[HDKore Extractor Decrypt Error]:', e.message);
        }
      }
    }

    // Fallback if direct API decryption fails or videoId not found
    console.log('[HDKore Extractor] Direct API failed, trying Puppeteer fallback...');
    const pptrResult = await extractHdkorePuppeteer(pageUrl);
    if (pptrResult) return pptrResult;

    throw new Error('Video URL çıkarılamadı.');
  } catch (err) {
    throw new Error(`HDKore çözme hatası: ${err.message}`);
  }
}

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
    const nc = code < 256 ? char : (lut[code] || (c + c[0]));
    result.push(nc);
    lut[n] = c + nc[0];
    n++;
    c = nc;
  }
  return result.join("");
}

function buildArray(encoded) {
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

function hexToString(hex) {
  const cleanHex = hex.trim();
  const paddedHex = cleanHex.length % 2 !== 0 ? "0" + cleanHex : cleanHex;
  const bytes = [];
  for (let i = 0; i < paddedHex.length; i += 2) {
    bytes.push(parseInt(paddedHex.substring(i, i + 2), 16));
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeUrl(encoded, tArray) {
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
async function resolveTurkPornoEmbed(url) {
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
        return { url: videoUrl, quality: '720p', name: 'UpnsLive HLS' };
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

export async function extractPornhub(pageUrl) {
  try {
    const pageRes = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Cookie': 'hasVisited=1; accessAgeDisclaimerPH=1; platform=pc; bs=1; cookiesBannerSeen=1'
      }
    });
    const html = pageRes.body;
    const $ = cheerio.load(html);
    
    let title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || 'Pornhub Video';
    title = title.replace(/\s*-\s*Pornhub\.com/i, '').trim();

    let videoUrl = null;
    let format = 'Direct';

    const scripts = $('script');
    let flashvarsJson = null;
    scripts.each((_, el) => {
      const data = $(el).html() || '';
      if (data.includes('flashvars') || data.includes('mediaDefinitions')) {
        const match = data.match(/flashvars_\d+\s*=\s*(\{.*?\});/) ||
                      data.match(/flashvars\s*=\s*(\{.*?\});/) ||
                      data.match(/var\s+flashvars\s*=\s*(\{.*?\});/) ||
                      data.match(/var\s+flashvars_[\w]+\s*=\s*(\{[\s\S]+?\})\s*;/);
        if (match) {
          try {
            flashvarsJson = JSON.parse(match[1]);
          } catch (e) {}
        }
      }
    });

    if (flashvarsJson && flashvarsJson.mediaDefinitions) {
      const sources = [];
      for (const media of flashvarsJson.mediaDefinitions) {
        const streamUrl = media.videoUrl;
        const formatType = media.format;
        const quality = String(media.quality || 'Auto');
        if (streamUrl) {
          sources.push({
            url: streamUrl,
            format: formatType,
            quality: quality,
            qualityNum: parseInt(quality.replace(/[^0-9]/g, '')) || 0
          });
        }
      }
      
      if (sources.length > 0) {
        const validSources = sources.filter(s => !s.url.includes('get_media'));
        if (validSources.length > 0) {
          validSources.sort((a, b) => {
            if (a.format === 'mp4' && b.format !== 'mp4') return -1;
            if (a.format !== 'mp4' && b.format === 'mp4') return 1;
            return b.qualityNum - a.qualityNum;
          });
          videoUrl = validSources[0].url;
          format = validSources[0].format;
        }
      }
    }

    if (!videoUrl) {
      console.log('[Pornhub Extractor] Flashvars not found or failed, trying yt-dlp fallback...');
      const ytDlpCmd = fs.existsSync('./yt-dlp.exe') ? '.\\yt-dlp.exe' : 'yt-dlp';
      const dump = await new Promise((resolve, reject) => {
        const proxyArg = process.env.PROXY_URL ? ` --proxy "${process.env.PROXY_URL}"` : '';
        exec(`"${ytDlpCmd}" --dump-json --no-playlist${proxyArg} --add-header "Cookie:hasVisited=1; accessAgeDisclaimerPH=1; platform=pc; bs=1; cookiesBannerSeen=1" "${pageUrl}"`, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout.trim());
        });
      });
      const parsed = JSON.parse(dump);
      videoUrl = parsed.url;
      if (parsed.title) {
        title = parsed.title;
      }
    }

    if (!videoUrl) {
      throw new Error('Pornhub video URL could not be resolved.');
    }

    return {
      title,
      source: `Pornhub (${format})`,
      url: videoUrl,
      referer: 'https://www.pornhub.com/',
      cookies: 'hasVisited=1; accessAgeDisclaimerPH=1; platform=pc; bs=1; cookiesBannerSeen=1'
    };
  } catch (err) {
    throw new Error(`Pornhub çözme hatası: ${err.message}`);
  }
}

export async function extractTurkifsahub(pageUrl) {
  try {
    const pageRes = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Referer': 'https://turkifsahub.com/',
        'Origin': 'https://turkifsahub.com'
      }
    });
    const $ = cheerio.load(pageRes.body);
    
    const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || 'Turkifsahub Video';
    
    let videoUrl = $('video.vjs-tech').attr('src') || $('meta[itemprop="contentUrl"]').attr('content') || $('video source').attr('src');
    if (!videoUrl) {
      throw new Error("Turkifsahub video dosyası bulunamadı.");
    }
    
    if (videoUrl.startsWith('/')) {
      videoUrl = 'https://turkifsahub.com' + videoUrl;
    }

    return {
      title,
      source: 'Turkifsahub Direct',
      url: videoUrl,
      referer: 'https://turkifsahub.com/'
    };
  } catch (err) {
    throw new Error(`Turkifsahub çözme hatası: ${err.message}`);
  }
}

export async function extractTurkifsalar(pageUrl) {
  try {
    const pageRes = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15',
        'Referer': 'https://turkifsalar2.site/'
      }
    });
    const $ = cheerio.load(pageRes.body);
    
    const title = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || 'TurkIfsalar Video';
    
    let videoUrl = $('meta[property="og:video"]').attr('content');
    if (!videoUrl) {
      throw new Error("TurkIfsalar video stream URL bulunamadı.");
    }
    
    if (videoUrl.startsWith('/')) {
      videoUrl = 'https://turkifsalar2.site' + videoUrl;
    }

    return {
      title,
      source: 'TurkIfsalar M3U8',
      url: videoUrl,
      referer: 'https://turkifsalar2.site/'
    };
  } catch (err) {
    throw new Error(`TurkIfsalar çözme hatası: ${err.message}`);
  }
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

export async function extractCloudMailRu(pageUrl) {
  try {
    let cleanUrl = pageUrl;
    if (cleanUrl.includes('cloidmail.ru')) {
      cleanUrl = cleanUrl.replace('cloidmail.ru', 'cloud.mail.ru');
    }

    const pageRes = await gotScraping.get({
      url: cleanUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      }
    });
    const html = pageRes.body;
    
    // Extract base URL using regex
    const weblinkGetMatch = html.match(/"weblink_get"\s*:\s*\{[\s\S]*?"url"\s*:\s*"([^"]+)"/);
    if (!weblinkGetMatch) {
      throw new Error("weblink_get indirme sunucusu adresi bulunamadı.");
    }
    const baseUrl = weblinkGetMatch[1];
    
    // Extract file ID
    const weblinkMatch = html.match(/"weblink"\s*:\s*"([^"]+)"/);
    let fileId = weblinkMatch ? weblinkMatch[1] : null;
    if (!fileId) {
      const urlObj = new URL(cleanUrl);
      const parts = urlObj.pathname.split('/public/')[1];
      if (parts) {
        fileId = parts;
      }
    }
    
    if (!fileId) {
      throw new Error("Dosya kimliği (weblink) çözümlenemedi.");
    }
    
    // Extract file name
    const nameMatch = html.match(/"name"\s*:\s*"([^"]+)"/);
    let title = nameMatch ? nameMatch[1] : "CloudMail_Video";
    if (title === "CloudMail_Video") {
      const matchTitle = html.match(/<title>([\s\S]*?)<\/title>/i);
      if (matchTitle) {
        title = matchTitle[1].replace(/—[\s\S]*$/i, '').trim();
      }
    }
    
    const videoUrl = `${baseUrl}/${fileId}`;
    
    return {
      title: title || "CloudMail Video",
      source: 'Cloud Mail.ru',
      url: videoUrl,
      referer: cleanUrl
    };
  } catch (err) {
    throw new Error(`Cloud Mail.ru çözme hatası: ${err.message}`);
  }
}



