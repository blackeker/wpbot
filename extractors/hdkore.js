import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
import * as cheerio from 'cheerio';
import axios from 'axios';
import crypto from 'crypto';
import { getSharedBrowser } from '../utils/browser.js';

// ==========================================
// HDKORE1 EXTRACTOR AND RESOLVER FUNCTIONS
// ==========================================

export async function getHdkoreSeasonEpisodes(seasonUrl) {
  try {
    const host = new URL(seasonUrl).origin;
    const res = await gotScraping.get({
      url: seasonUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
      }
    });
    const $ = cheerio.load(res.body);
    let showTitle = $('h1').first().text().trim() || $('title').text().trim();
    showTitle = showTitle.replace(/\s*[-–|]\s*(İzle|izle|Türkçe|HDKore|Watch).*/i, '').trim();

    // Check if the page has #toggle-api with total-eps
    const toggleApi = $('#toggle-api');
    let totalEps = parseInt(toggleApi.attr('data-total-eps') || '0', 10);

    const episodes = [];
    const seen = new Set();
    $('a[href*="/bolum/"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/bolum/')) {
        const fullUrl = href.startsWith('http') ? href : `${host}${href}`;
        if (!seen.has(fullUrl)) {
          seen.add(fullUrl);
          const name = $(el).closest('[id^="episode-card"]').find('h5 a').text().trim() || $(el).text().trim() || `Bölüm ${i + 1}`;
          episodes.push({
            url: fullUrl,
            name: name.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim()
          });
        }
      }
    });

    // If totalEps not found on dizi page but we have an episode link, inspect the first episode page
    if (!totalEps && episodes.length > 0) {
      try {
        const firstEpRes = await gotScraping.get({
          url: episodes[0].url,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
          }
        });
        const $ep = cheerio.load(firstEpRes.body);
        const epToggle = $ep('#toggle-api');
        if (epToggle.length) {
          totalEps = parseInt(epToggle.attr('data-total-eps') || '0', 10);
        }
      } catch (e) {}
    }

    // If totalEps is greater than 1 and either we only found 1 link or totalEps > episodes.length
    if (totalEps > 1 && (episodes.length <= 1 || totalEps > episodes.length)) {
      let baseBolumUrl = episodes.length > 0 ? episodes[0].url : seasonUrl.replace('/dizi/', '/bolum/');
      baseBolumUrl = baseBolumUrl.split('?')[0].split('#')[0];

      const apiEpisodes = [];
      for (let i = 1; i <= totalEps; i++) {
        apiEpisodes.push({
          url: `${baseBolumUrl}?ep=${i}`,
          name: `${i}. Bölüm`
        });
      }
      return {
        seriesName: showTitle,
        episodes: apiEpisodes
      };
    }

    return {
      seriesName: showTitle,
      episodes
    };
  } catch (err) {
    throw new Error(`HDKore dizisi bölümleri alınamadı: ${err.message}`);
  }
}

// Decrypt algorithm for dramaizle.site /api/v1/download responses
export async function decryptDramaizle(encryptedHex, videoId) {
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
export async function extractHdkorePuppeteer(pageUrl) {
  console.log(`\n[HDKore Puppeteer Fallback] ${pageUrl}`);
  let page;
  let capturedApiPayload = null;
  let capturedVideoUrl = null;
  let title = '';
  try {
    const browser = await getSharedBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setViewport({
      width: 1280,
      height: 800
    });
    await page.evaluateOnNewDocument(() => {
      try {
        delete Object.getPrototypeOf(navigator).webdriver;
        // @ts-ignore
        navigator.webdriver = false;
      } catch (e) {}
      window.chrome = { runtime: {} };
      window.__localHooks = [];
      window.__localVideoSrc = null;
      try {
        const orig = window.crypto.subtle.decrypt.bind(window.crypto.subtle);
        window.crypto.subtle.decrypt = async function (algorithm, key, data) {
          const result = orig(algorithm, key, data);
          try {
            window.crypto.subtle.exportKey('raw', key).then(kd => {
              const kHex = [...new Uint8Array(kd)].map(b => b.toString(16).padStart(2, '0')).join('');
              const ivSrc = algorithm.iv || algorithm.counter;
              let ivBytes = ivSrc ? new Uint8Array(ivSrc instanceof ArrayBuffer ? ivSrc : ivSrc.buffer || new ArrayBuffer(0)) : new Uint8Array(16);
              const ivHex = [...ivBytes].map(b => b.toString(16).padStart(2, '0')).join('');
              window.__localHooks.push({
                key: kHex,
                iv: ivHex,
                algo: algorithm.name || 'AES-CBC',
                t: Date.now()
              });
            }).catch(() => {});
          } catch (e) {}
          return result;
        };
      } catch (e) {}
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
            get: desc.get,
            configurable: true
          });
        }
      } catch (e) {}
    });
    await page.setRequestInterception(true);
    page.on('request', req => req.continue());
    page.on('response', async res => {
      const url = res.url();
      if ((url.includes('.m3u8') || url.includes('.mp4') || url.includes('/hls/')) && !url.includes('google') && !url.includes('imasdk') && res.status() < 400) {
        capturedVideoUrl = url;
        return;
      }
      if (url.includes('/api/v1/')) {
        try {
          const text = await res.text().catch(() => '');
          if (text && text.length > 10) {
            capturedApiPayload = text.trim();
          }
        } catch (e) {}
      }
    });
    try {
      await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });
    } catch (e) {}
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
        if (v) {
          v.muted = true;
          v.play().catch(() => {});
        }
      }).catch(() => {});
    } catch (e) {}
    try {
      const ifrEl = await page.$('iframe[src*="dramaizle"]');
      if (ifrEl) {
        const box = await ifrEl.boundingBox();
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
    } catch (e) {}
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
        } catch (e) {}
      }
      await sleep(1000);
    }
    if (!capturedVideoUrl && capturedApiPayload) {
      let hooks = [];
      try {
        hooks = await dramaFrame.evaluate(() => window.__localHooks || []).catch(() => []);
      } catch (e) {}
      for (const hook of hooks) {
        const dec = tryDecrypt(capturedApiPayload, hook.key, hook.iv, hook.algo);
        if (dec && (dec.includes('http') || dec.includes('{'))) {
          const urlMatch = dec.match(/https?:\/\/[^\s"'\\]+/);
          if (urlMatch) {
            capturedVideoUrl = urlMatch[0];
            break;
          }
        }
      }
    }
    if (capturedVideoUrl) {
      return {
        title: title.replace(/\s*[-–|]\s*(İzle|izle|Türkçe|HDKore).*/i, '').trim(),
        url: capturedVideoUrl,
        referer: pageUrl,
        source: 'HDKore (Puppeteer)'
      };
    }
    return null;
  } catch (err) {
    throw err;
  } finally {
    if (page) {
      try { await page.close(); } catch (e) {}
    }
  }
}
export async function extractHdkore(pageUrl) {
  try {
    const urlObj = new URL(pageUrl);
    const host = urlObj.origin;

    // Parse episode number from query params or slug
    let epNum = 1;
    if (urlObj.searchParams.get('ep')) {
      epNum = parseInt(urlObj.searchParams.get('ep'), 10) || 1;
    } else if (urlObj.searchParams.get('bolum')) {
      epNum = parseInt(urlObj.searchParams.get('bolum'), 10) || 1;
    } else {
      const matchSlug = urlObj.pathname.match(/[-_](\d+)[-_]bolum/i) || urlObj.pathname.match(/bolum[-_](\d+)/i);
      if (matchSlug) {
        epNum = parseInt(matchSlug[1], 10) || 1;
      }
    }

    const res = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
      }
    });
    const $ = cheerio.load(res.body);
    let showTitle = $('h1').first().text().trim() || $('title').text().trim();
    showTitle = showTitle.replace(/\s*[-–|]\s*(İzle|izle|Türkçe|HDKore|Watch).*/i, '').trim();

    // 1. Check if HDKore API Player (#toggle-api) is present
    const toggleApi = $('#toggle-api');
    if (toggleApi.length) {
      const entId = toggleApi.attr('data-entertainment-id');
      let pageToken = toggleApi.attr('data-api-pt') || '';
      if (!pageToken) {
        const ptMatch = res.body.match(/data-api-pt="([^"]+)"/) || res.body.match(/_pageToken\s*=\s*"([^"]+)"/);
        if (ptMatch) pageToken = ptMatch[1];
      }

      if (entId && pageToken) {
        try {
          const apiUrl = `${host}/api/api-player/episode-url/${entId}/${epNum}?pt=${encodeURIComponent(pageToken)}&force=1`;
          let apiRes = await axios.get(apiUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
              'Referer': pageUrl
            },
            timeout: 15000
          });

          // Check if pageToken expired or needs refresh
          if (apiRes.data && (apiRes.data.code === 'token_expired' || apiRes.data.code === 'token_required' || apiRes.data.error)) {
            const refreshUrl = `${host}/api/api-player/refresh-token/${entId}?pt=${encodeURIComponent(pageToken)}`;
            const refreshRes = await axios.get(refreshUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
                'Referer': pageUrl
              },
              timeout: 10000
            }).catch(() => null);

            if (refreshRes?.data?.page_token) {
              pageToken = refreshRes.data.page_token;
              const retryUrl = `${host}/api/api-player/episode-url/${entId}/${epNum}?pt=${encodeURIComponent(pageToken)}&force=1`;
              apiRes = await axios.get(retryUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
                  'Referer': pageUrl
                },
                timeout: 15000
              });
            }
          }

          if (apiRes.data && apiRes.data.video_url) {
            console.log(`[HDKore Extractor] Successfully resolved Ep ${epNum} via API Player`);
            const epTitle = showTitle.includes(`${epNum}. Bölüm`) ? showTitle : `${showTitle} - ${epNum}. Bölüm`;
            return {
              title: epTitle,
              source: `HDKore (${apiRes.data.platform || 'API Player'})`,
              url: apiRes.data.video_url,
              referer: pageUrl,
              subtitleUrl: apiRes.data.subtitle_url || null
            };
          }
        } catch (apiErr) {
          console.warn(`[HDKore Extractor] API Player fetch failed: ${apiErr.message}`);
        }
      }
    }

    // 2. Direct Dramaizle API check
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
      try {
        const videoApiUrl = `https://dramaizle.site/api/v1/video?id=${videoId}&w=1920&h=1080&r=hdkore1.com`;
        const videoRes = await axios.get(videoApiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
            'Referer': `https://dramaizle.site/#${videoId}`
          },
          timeout: 15000
        });
        if (videoRes.data) {
          const hex = typeof videoRes.data === 'string' ? videoRes.data.trim() : '';
          if (hex) {
            const key = Buffer.from('kiemtienmua911ca');
            const iv = Buffer.from('1234567890oiuytr');
            const ct = Buffer.from(hex, 'hex');
            const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
            decipher.setAutoPadding(true);
            const decryptedText = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8').replace(/\x00/g, '').trim();
            const parsed = JSON.parse(decryptedText);
            const streamUrl = parsed.file || parsed.url || parsed.hls || parsed.mp4 || parsed.stream || (parsed.cf && parsed.cf[0]?.src);
            if (streamUrl) {
              return {
                title: showTitle,
                source: 'HDKore (Dramaizle API)',
                url: streamUrl,
                referer: 'https://dramaizle.site/'
              };
            }
          }
        }
      } catch (e) {
        console.warn('[HDKore Extractor] Dramaizle direct video API failed:', e.message);
      }
    }

    // 3. Fallback if direct API decryption fails or videoId not found
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