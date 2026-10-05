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
export async function initiateHentaizmLogin(fromJid, pageUrl = 'https://www.hentaizm2.com') {
  try {
    const sock = botSocketRef.current;
    if (!sock) {
      console.error("[Hentaizm Login] Socket not connected yet.");
      return;
    }

    let baseUrl = 'https://www.hentaizm2.com';
    try {
      if (pageUrl) {
        baseUrl = new URL(pageUrl).origin;
      }
    } catch (e) {}

    console.log(`[Hentaizm Login] Initiating login for JID: ${fromJid} on ${baseUrl}`);
    const cookieJar = new CookieJar();
    const headerOpts = {
      devices: ['desktop'],
      locales: ['tr-TR', 'en-US'],
      operatingSystems: ['windows']
    };

    // 1. Visit login page to establish session cookie
    const loginUrl = `${baseUrl}/login.php`;
    await gotScraping.get({
      url: loginUrl,
      cookieJar,
      headerGeneratorOptions: headerOpts
    });

    // 2. Fetch captcha image using same session cookies
    const captchaUrl = `${baseUrl}/captcha.php`;
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
      baseUrl,
      createdAt: Date.now(),
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

export async function extractHentaizmListingPage(pageUrl, startPage = 1, endPage = 1) {
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

  let baseUrl = 'https://www.hentaizm2.com';
  try { baseUrl = new URL(pageUrl).origin; } catch (e) {}

  const animeMap = new Map();
  let pageTitle = '';

  const sPage = Math.max(1, parseInt(startPage, 10) || 1);
  const ePage = Math.max(sPage, parseInt(endPage, 10) || sPage);

  for (let p = sPage; p <= ePage; p++) {
    let currentUrl = pageUrl;
    if (/([?&]page=)\d+/i.test(currentUrl)) {
      currentUrl = currentUrl.replace(/([?&]page=)\d+/i, `$1${p}`);
    } else if (p > 1 || currentUrl.includes('page=')) {
      currentUrl = currentUrl.includes('?') ? `${currentUrl}&page=${p}` : `${currentUrl}?page=${p}`;
    }

    try {
      let foundThisPage = 0;

      if (pageUrl.includes('tab=fav') || pageUrl.includes('top_favorites')) {
        const apiUrl = `${baseUrl}/api/top_favorites_list.php?page=${p}&_=${Date.now()}`;
        try {
          const apiRes = await gotScraping.get({
            url: apiUrl,
            cookieJar,
            headerGeneratorOptions: {
              devices: ['desktop'],
              locales: ['tr-TR', 'en-US'],
              operatingSystems: ['windows']
            },
            timeout: { request: 15000 }
          });

          let htmlData = '';
          try {
            const parsedJson = typeof apiRes.body === 'string' ? JSON.parse(apiRes.body) : apiRes.body;
            htmlData = parsedJson?.html || apiRes.body;
          } catch (e) {
            htmlData = apiRes.body;
          }

          if (htmlData) {
            const $fav = cheerio.load(htmlData);
            if (!pageTitle) pageTitle = 'Hentaizm Favorileri';

            $fav('.video-list-item').each((i, el) => {
              const titleLink = $fav(el).find('.title a, a[href*="/anime/"], a[href*="/izle/"]').first();
              let href = titleLink.attr('href');
              if (!href) return;
              if (href.startsWith('/')) href = `${baseUrl}${href}`;

              try {
                const u = new URL(href);
                const parts = u.pathname.split('/').filter(Boolean);
                if (!parts[1]) return;

                const animeSlug = parts[1];
                const cleanUrl = `${baseUrl}/anime/${animeSlug}`;

                const clone = titleLink.clone();
                clone.find('span, svg, i').remove();
                let rawTitle = clone.text().replace(/\s+/g, ' ').trim();

                const imgEl = $fav(el).find('img').first();
                const alt = imgEl.attr('alt') ? imgEl.attr('alt').replace(/\s+/g, ' ').trim() : null;
                if (!rawTitle || rawTitle === 'İncele' || rawTitle.endsWith('...')) {
                  if (alt && alt !== 'İncele') rawTitle = alt;
                }
                const title = cleanHentaizmTitle(rawTitle || animeSlug.replace(/-/g, ' '));

                let poster = imgEl.attr('data-src') || imgEl.attr('src') || imgEl.attr('data-original') || null;
                if (poster && poster.startsWith('/')) poster = `${baseUrl}${poster}`;
                if (!poster) poster = `${baseUrl}/uploads/afis/${animeSlug}.jpg`;

                if (!animeMap.has(cleanUrl)) {
                  animeMap.set(cleanUrl, {
                    url: cleanUrl,
                    title: title || animeSlug,
                    posterUrl: poster || null
                  });
                  foundThisPage++;
                }
              } catch (e) {}
            });
          }
        } catch (apiErr) {
          console.warn(`[Hentaizm Listing] Top fav API sayfa ${p} alınamadı:`, apiErr.message);
        }
      } else {
        const res = await gotScraping.get({
          url: currentUrl,
          cookieJar,
          headerGeneratorOptions: {
            devices: ['desktop'],
            locales: ['tr-TR', 'en-US'],
            operatingSystems: ['windows']
          },
          timeout: { request: 15000 }
        });

        const $ = cheerio.load(res.body);
        if (!pageTitle) {
          pageTitle = cleanHentaizmTitle($('title').text().trim() || 'Hentaizm Liste');
        }

        let scope = $('#top-favorites-content, #top-favorites-container, .col-md-8, .main-content, #main-content, .content-left, .left-content, main');
        if (scope.length === 0) scope = $('body');

        scope.find('a[href*="/anime/"], a[href*="/izle/"]').each((i, el) => {
          if ($(el).closest('.col-md-4, #sidebar, .sidebar, aside, .link-list-2, .sidebar-anime-item, .sidebar-section, .right-sidebar').length > 0) {
            return;
          }

          let href = $(el).attr('href');
          if (!href) return;
          if (href.startsWith('/')) href = `${baseUrl}${href}`;
          try {
            const u = new URL(href);
            const parts = u.pathname.split('/').filter(Boolean);
            if ((parts[0] === 'anime' || parts[0] === 'izle') && parts.length >= 2) {
              const animeSlug = parts[1];
              const cleanUrl = `${baseUrl}/anime/${animeSlug}`;

              let imgEl = $(el).find('img');
              if (imgEl.length === 0) {
                imgEl = $(el).parent().siblings().find('img');
              }
              if (imgEl.length === 0) {
                imgEl = $(el).closest('.video-list-item, .box, .item, .col, .post, .card, .anime-card, .film-item, div').find('img');
              }

              const altTitle = imgEl.attr('alt') ? cleanHentaizmTitle(imgEl.attr('alt').replace(/\s+/g, ' ').trim()) : null;
              let title = $(el).attr('title') || $(el).text().trim();
              title = cleanHentaizmTitle(title.replace(/\s+/g, ' ').trim());
              if (title === 'İncele' || !title || title.endsWith('...') || (altTitle && altTitle.length > title.length)) {
                if (altTitle && altTitle !== 'İncele') {
                  title = altTitle;
                }
              }
              const slugFormatted = animeSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              if (!title || title === 'İncele' || title.endsWith('...')) {
                title = slugFormatted;
              }

              let poster = imgEl.attr('data-src') || imgEl.attr('src') || imgEl.attr('data-original') || null;
              if (poster && poster.startsWith('/')) {
                poster = `${baseUrl}${poster}`;
              }
              if (!poster && animeSlug) {
                poster = `${baseUrl}/uploads/afis/${animeSlug}.jpg`;
              }

              if (!animeMap.has(cleanUrl)) {
                animeMap.set(cleanUrl, {
                  url: cleanUrl,
                  title: title || slugFormatted,
                  posterUrl: poster || null
                });
                foundThisPage++;
              }
            }
          } catch (e) {}
        });
      }

      console.log(`[Hentaizm Listing] Sayfa ${p}: ${foundThisPage} yeni anime bulundu. (Toplam: ${animeMap.size})`);
      if (foundThisPage === 0 && p > sPage) {
        break;
      }
    } catch (err) {
      console.warn(`[Hentaizm Listing] Sayfa ${p} alınamadı:`, err.message);
      if (p === sPage) throw err;
      break;
    }
  }

  const allAnimeler = Array.from(animeMap.values());
  return {
    pageTitle,
    animeList: allAnimeler,
    items: allAnimeler,
    totalFound: allAnimeler.length
  };
}

export async function getHentaizmSeasonEpisodes(animeUrl) {
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

    const host = new URL(animeUrl).origin;
    const res = await gotScraping.get({
      url: animeUrl,
      cookieJar,
      headerGeneratorOptions: {
        devices: ['desktop'],
        locales: ['tr-TR', 'en-US'],
        operatingSystems: ['windows']
      }
    });

    const html = res.body;
    const $ = cheerio.load(html);

    const rawTitle = $('title').text().trim() || $('h1').text().trim() || 'Hentaizm Anime';
    const seriesName = cleanHentaizmTitle(rawTitle);

    const episodes = [];
    const seenUrls = new Set();

    $('a.episode-list-item, a[href*="/izle/"], .episode-list-container a').each((i, el) => {
      let href = $(el).attr('href');
      if (!href) return;
      if (!href.startsWith('http')) {
        href = `${host}${href.startsWith('/') ? '' : '/'}${href}`;
      }
      if (seenUrls.has(href)) return;
      seenUrls.add(href);

      const rawText = $(el).text().trim().replace(/\s+/g, ' ');
      let season = '1';
      let number = episodes.length + 1;

      const urlMatch = href.match(/sezon-(\d+)-bolum-(\d+)/i) || href.match(/\/sezon-(\d+)\/bolum-(\d+)/i);
      if (urlMatch) {
        season = urlMatch[1];
        number = parseInt(urlMatch[2], 10);
      } else {
        const textMatch = rawText.match(/(?:(\d+)\.\s*sezon\s*)?(\d+)\.\s*bölüm/i);
        if (textMatch) {
          if (textMatch[1]) season = textMatch[1];
          if (textMatch[2]) number = parseInt(textMatch[2], 10);
        }
      }

      episodes.push({
        season,
        number,
        name: rawText || `Sezon ${season} Bölüm ${number}`,
        url: href
      });
    });

    episodes.sort((a, b) => {
      const sDiff = parseInt(a.season, 10) - parseInt(b.season, 10);
      if (sDiff !== 0) return sDiff;
      return a.number - b.number;
    });

    let posterUrl = $('meta[property="og:image"]').attr('content') || '';
    if (!posterUrl) {
      const imgEl = $('.poster img, .anime-poster img, .film-poster img, img[src*="/uploads/afis/"]').first();
      posterUrl = imgEl.attr('data-src') || imgEl.attr('src') || '';
    }
    if (posterUrl && !posterUrl.startsWith('http')) {
      posterUrl = `${host}${posterUrl.startsWith('/') ? '' : '/'}${posterUrl}`;
    }

    const description = $('meta[property="og:description"]').attr('content') || 
      $('.description, .anime-details, .summary, .story').first().text().trim() || '';

    return {
      seriesName,
      posterUrl,
      description,
      episodes
    };
  } catch (err) {
    throw new Error(`Hentaizm anime bölümleri alınamadı: ${err.message}`);
  }
}

export async function extractHentaizm(pageUrl, fromJid = null) {
  try {
    // If target URL is an anime overview page, automatically resolve the first episode as fallback
    if (pageUrl.includes('/anime/')) {
      const animeData = await getHentaizmSeasonEpisodes(pageUrl);
      if (animeData && animeData.episodes && animeData.episodes.length > 0) {
        const firstEp = animeData.episodes[0];
        console.log(`[Hentaizm] Anime overview link detected: "${animeData.seriesName}". Resolving 1st episode: ${firstEp.url}`);
        const result = await extractHentaizm(firstEp.url, fromJid);
        return {
          ...result,
          title: result.title || `${animeData.seriesName} - ${firstEp.name}`
        };
      }
    }

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
        await initiateHentaizmLogin(fromJid, pageUrl);
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
      const episodeLinks = $('a.episode-list-item, a[href*="/izle/"]');
      if (episodeLinks.length > 0) {
        const animeData = await getHentaizmSeasonEpisodes(pageUrl);
        if (animeData && animeData.episodes && animeData.episodes.length > 0) {
          const firstEp = animeData.episodes[0];
          console.log(`[Hentaizm] Video oynatıcı yerine bölüm listesi bulundu (${animeData.seriesName}). 1. bölüm çözümleniyor: ${firstEp.url}`);
          const result = await extractHentaizm(firstEp.url, fromJid);
          return {
            ...result,
            title: result.title || `${animeData.seriesName} - ${firstEp.name}`
          };
        }
      }
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
      const userAgent = mailRes.request.options.headers['user-agent'];

      // 1. Try direct weblink_get URL (fastest & most reliable MP4 download)
      const weblinkGetMatch = mailRes.body.match(/"weblink_get"\s*:\s*\{\s*"count"[^}]+"url"\s*:\s*"([^"]+)"/);
      if (weblinkGetMatch && weblinkGetMatch[1]) {
        const getBase = weblinkGetMatch[1].replace(/\/$/, '');
        const dlUrl = `${getBase}/${publicId}`;
        return {
          title,
          source: 'CloudMailRu Direct',
          url: dlUrl,
          referer: 'https://cloud.mail.ru/',
          cookies: mailRuJar.toJSON(),
          userAgent: userAgent
        };
      }

      // 2. Fallback to videowl_view stream
      const videoMatch = mailRes.body.match(/videowl_view":\s*\{\s*"count"\s*:\s*"1"\s*,\s*"url"\s*:\s*"([^"]+)"\s*\}/i);
      if (videoMatch) {
        const streamBase = videoMatch[1];
        const vidIdEnc = Buffer.from(publicId).toString('base64');
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

// Re-export Doeda PlayerJS resolver functions for backwards compatibility
export { resolvePlayerIframe, resolvePlayerAjax } from './doeda.js';