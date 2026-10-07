import { gotScraping, unmix } from "../extractor.js";
import * as cheerio from 'cheerio';

function resolveUrl(url, base) {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return 'https:' + trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  try {
    return new URL(trimmed, base).href;
  } catch {
    return trimmed;
  }
}

/**
 * HDABLA & Fakitonye Video Extractor & Decrypter
 * @param {string} pageUrl - The URL of the HDABLA page
 * @returns {Promise<object>} - { title, source, url, headers, referer }
 */
export async function extractHdabla(pageUrl) {
  try {
    const pageRes = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(pageRes.body);
    const title = $('h1.entry-title').text().trim() ||
                  $('h1').first().text().trim() ||
                  $('meta[property="og:title"]').attr('content')?.trim() ||
                  $('title').text().replace(/izle/i, '').trim() ||
                  'HdAbla Video';

    // 1. Sniff direct video elements or iframe sources
    let playerUrl = null;
    
    // Direct source tags
    const directSource = $('video source').attr('src') || $('source').attr('src') || $('video').attr('src');
    if (directSource) {
      const resolvedDirect = resolveUrl(directSource, pageUrl);
      if (resolvedDirect && /\.(m3u8|mp4)(\?.*)?$/i.test(resolvedDirect)) {
        return {
          title,
          source: 'HdAbla',
          url: resolvedDirect,
          headers: { 'Referer': pageUrl },
          referer: pageUrl
        };
      }
    }

    // Sniff iFrame elements
    const iframeSources = [];
    $('iframe, amp-iframe').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
      if (src && !src.includes('facebook') && !src.includes('twitter') && !src.includes('google')) {
        iframeSources.push(resolveUrl(src, pageUrl));
      }
    });

    // Check script tags for embedded player URLs
    $('script').each((i, el) => {
      const scriptContent = $(el).html() || '';
      const iframeMatch = scriptContent.match(/(?:iframe|player|src)\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i);
      if (iframeMatch) {
        iframeSources.push(iframeMatch[1]);
      }
    });

    playerUrl = iframeSources.find(url => url && (url.includes('oynat') || url.includes('player') || url.includes('embed') || url.includes('fakitonye') || url.includes('hdabla'))) || iframeSources[0];

    if (!playerUrl) {
      // Direct regex fallback on page HTML body
      const rawMatch = pageRes.body.match(/https?:\/\/[^\s"',<>]+\.(?:m3u8|mp4)[^\s"',<>]*/i);
      if (rawMatch) {
        return {
          title,
          source: 'HdAbla',
          url: rawMatch[0],
          headers: { 'Referer': pageUrl },
          referer: pageUrl
        };
      }
      throw new Error("HdAbla video oynatıcı kaynağı bulunamadı.");
    }

    // 2. Fetch Player iFrame / Embedded page
    let finalVideoUrl = null;
    let refererUrl = pageUrl;

    try {
      const playerRes = await gotScraping.get({
        url: playerUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': pageUrl
        }
      });
      
      let bodyText = playerRes.body;
      refererUrl = playerUrl;

      // If script is packed with Dean Edwards eval(function(p,a,c,k,e,d)...), unpack it
      if (bodyText.includes('eval(function(p,a,c,k,e,d)')) {
        try {
          const unpacked = unmix(bodyText);
          if (unpacked) {
            bodyText += '\n' + unpacked;
          }
        } catch (e) {}
      }

      // Search for video source file in unpacked script or HTML
      const fileMatch = bodyText.match(/(?:file|src|source|hls)\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) ||
                        bodyText.match(/https?:\/\/[^\s"',<>]+\.(?:m3u8|mp4)[^\s"',<>]*/i) ||
                        bodyText.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
      
      if (fileMatch) {
        finalVideoUrl = fileMatch[1] || fileMatch[0];
      } else {
        // Nested secondary iframe check
        const sub$ = cheerio.load(bodyText);
        const subIframe = sub$('iframe').attr('src') || sub$('iframe').attr('data-src');
        if (subIframe) {
          const subUrl = resolveUrl(subIframe, playerUrl);
          const subRes = await gotScraping.get({
            url: subUrl,
            headers: { 'Referer': playerUrl }
          });
          const subMatch = subRes.body.match(/https?:\/\/[^\s"',<>]+\.(?:m3u8|mp4)[^\s"',<>]*/i);
          if (subMatch) {
            finalVideoUrl = subMatch[0];
            refererUrl = subUrl;
          }
        }
      }
    } catch (e) {
      console.error("[HDABLA] iFrame player fetch failed:", e.message);
    }

    if (!finalVideoUrl || (!finalVideoUrl.includes('.m3u8') && !finalVideoUrl.includes('.mp4'))) {
      throw new Error("Video akış linki bulunamadı veya video kaynak sunucudan silinmiş.");
    }

    return {
      title,
      source: 'HdAbla',
      url: finalVideoUrl,
      headers: {
        'Referer': refererUrl,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      referer: refererUrl
    };
  } catch (err) {
    throw new Error(`HdAbla ayıklama hatası: ${err.message}`);
  }
}