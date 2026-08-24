import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
import * as cheerio from 'cheerio';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import fs from 'fs';
import path from 'path';
import { readConfig, writeConfig, pendingHentaizmLogins, botSocketRef, downloadsDir } from '../config.js';
export
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
export function cleanHentaizmTitle(rawTitle) {
  let title = rawTitle.trim();
  const suffixes = ["Türkçe Altyazılı Hentai İzle", "Türkçe Altyazılı Hentai Izle", "Turkce Altyazili Hentai Izle", "Türkçe Altyazılı", "Türkçe Dublaj", "Hentai İzle", "Hentai Izle", "İzle", "Izle", "| Hentaizm"];
  for (const suffix of suffixes) {
    if (title.toLowerCase().endsWith(suffix.toLowerCase())) {
      title = title.substring(0, title.length - suffix.length).trim();
    }
  }
  return title.trim().replace(/^[-|_|\s]+|[-|_|\s]+$/g, '').trim();
}

// Triggers a login captcha request to the user
export async function initiateHentaizmLogin(fromJid) {
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
    await sock.sendMessage(fromJid, {
      text: "🔑 *Hentaizm Oturum Açma Gerekli!*\nVideoları çekebilmek için üye girişi yapılması gerekiyor.\n\nSıradaki güvenlik kodunu gönderiyorum, lütfen kodu bu sohbete yazarak gönderin."
    });
    await sock.sendMessage(fromJid, {
      image: {
        url: captchaPath
      },
      caption: "Resimdeki 4 karakterli güvenlik kodunu yazın:"
    });
  } catch (err) {
    console.error("[Hentaizm Login] Error initiating login:", err.message);
  }
}
export async function extractHentaizm(pageUrl, fromJid = null) {
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
    if (html.includes('Videoları görmek için üye girişi yapmanız gerekiyor') || html.includes('login.php') && $('#player-area').text().includes('üye girişi')) {
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
            if (provider === 'videa') streamUrl = `https://videa.hu/player?v=${videoId}`;else if (provider === 'cloudmailru') streamUrl = `https://cloud.mail.ru/public/${videoId}`;else if (provider === 'okru') streamUrl = `https://ok.ru/videoembed/${videoId}`;
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
      } catch (e) {}
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
export async function resolvePlayerIframe(iframeUrl, referer) {
  try {
    const res = await gotScraping.get({
      url: iframeUrl,
      headers: {
        'Referer': referer
      },
      timeout: {
        request: 10000
      }
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
export async function resolvePlayerAjax(iframeUrl, pageUrl) {
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
        const response = await axios.post(ajaxUrl, new URLSearchParams({
          vid: vidHash,
          alternative: alt,
          ord: "0"
        }).toString(), {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Referer": iframeUrl,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          timeout: 10000
        });
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