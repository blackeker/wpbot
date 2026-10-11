import axios from 'axios';

const FALLBACK_COBALT_APIS = [
  'https://cobaltapi.cjs.nz/',
  'https://cobaltapi.squair.xyz/',
  'https://bergung-api.hoffnungfuerdiezukunft.net/',
  'https://apicobalt.mgytr.top/',
  'https://cobalt-api.lamps-dev.dev/'
];

export async function extractInstagram(pageUrl) {
  console.log(`[Instagram Extractor] Extracting URL: ${pageUrl}`);
  
  let apiUrls = [...FALLBACK_COBALT_APIS];
  
  // 1. Try to dynamically fetch working Cobalt APIs
  try {
    const listRes = await axios.get('https://cobalt.directory/api/working?type=api', { timeout: 5000 });
    if (listRes.data && listRes.data.data && Array.isArray(listRes.data.data.instagram)) {
      apiUrls = [...listRes.data.data.instagram, ...FALLBACK_COBALT_APIS];
      // De-duplicate
      apiUrls = [...new Set(apiUrls)];
    }
  } catch (err) {
    console.warn(`[Instagram Extractor] Failed to fetch dynamic Cobalt API list: ${err.message}. Using fallbacks.`);
  }

  // 2. Query Cobalt APIs one by one until one succeeds
  for (const api of apiUrls) {
    const cleanApi = api.endsWith('/') ? api.slice(0, -1) : api;
    console.log(`[Instagram Extractor] Querying Cobalt API: ${cleanApi}`);
    try {
      const res = await axios.post(cleanApi, {
        url: pageUrl
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        timeout: 10000
      });

      if (res.data && res.data.url) {
        console.log(`[Instagram Extractor] Extraction successful using API: ${api}`);
        return {
          title: res.data.filename || 'Instagram_Video.mp4',
          url: res.data.url,
          referer: 'https://www.instagram.com/',
          source: 'Instagram'
        };
      }
    } catch (e) {
      console.warn(`[Instagram Extractor] Failed on API ${api}: ${e.message}`);
    }
  }

  throw new Error('İndirme bağlantısı alınamadı. Tüm Instagram indirme servisleri yanıt vermiyor.');
}
