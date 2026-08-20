import axios from 'axios';

const TERABOX_WORKER_APIS = [
  'https://terabox-dl.qtcloud.workers.dev/api',
  'https://terabox-dl.ashlynn.workers.dev/api',
  'https://terabox-api.samirxp.workers.dev/api'
];

export async function extractTerabox(pageUrl) {
  console.log(`[Terabox Extractor] Extracting URL: ${pageUrl}`);
  
  for (const api of TERABOX_WORKER_APIS) {
    console.log(`[Terabox Extractor] Querying worker: ${api}`);
    try {
      const res = await axios.get(`${api}?url=${encodeURIComponent(pageUrl)}`, { timeout: 10000 });
      
      let directUrl = null;
      let filename = 'terabox_file';
      
      // Handle various worker response schemas
      if (res.data) {
        if (res.data.downloadLink) {
          directUrl = res.data.downloadLink;
          filename = res.data.filename || filename;
        } else if (res.data.url) {
          directUrl = res.data.url;
          filename = res.data.filename || filename;
        } else if (res.data.direct_link) {
          directUrl = res.data.direct_link;
          filename = res.data.filename || filename;
        } else if (Array.isArray(res.data.data) && res.data.data[0]) {
          const fileData = res.data.data[0];
          directUrl = fileData.downloadLink || fileData.url || fileData.direct_link;
          filename = fileData.filename || fileData.name || filename;
        }
      }
      
      if (directUrl) {
        console.log(`[Terabox Extractor] Extraction successful. File: ${filename}`);
        return {
          title: filename,
          url: directUrl,
          referer: 'https://www.terabox.com/',
          source: 'Terabox'
        };
      }
    } catch (e) {
      console.warn(`[Terabox Extractor] Failed on worker ${api}: ${e.message}`);
    }
  }
  
  throw new Error('Terabox indirme bağlantısı alınamadı. Tüm bypass servisleri yanıt vermiyor.');
}
