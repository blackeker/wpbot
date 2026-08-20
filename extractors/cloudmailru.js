import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
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