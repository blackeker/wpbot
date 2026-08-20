import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
export async function extractDoeda(pageUrl) {
  try {
    const pageRes = await gotScraping.get({
      url: pageUrl
    });
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
    const response = await axios.post("https://jetplayer.net/jet/ajax_sources.php", new URLSearchParams({
      vid: vidHash,
      alternative: "0",
      ord: "0"
    }).toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Referer": new URL(pageUrl).origin + "/",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 15000
    });
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