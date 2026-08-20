import axios from 'axios';

export async function extractYandex(pageUrl) {
  console.log(`[Yandex Extractor] Extracting URL: ${pageUrl}`);
  
  try {
    // 1. Fetch file metadata & download link from Yandex API
    const apiUrl = `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(pageUrl)}`;
    const res = await axios.get(apiUrl, { timeout: 10000 });
    
    if (res.data && res.data.href) {
      console.log(`[Yandex Extractor] Extraction successful.`);
      
      // Attempt to extract filename from the download link URL parameters
      let filename = 'yandex_file';
      try {
        const urlObj = new URL(res.data.href);
        const nameParam = urlObj.searchParams.get('filename');
        if (nameParam) filename = nameParam;
      } catch (e) {}

      return {
        title: filename,
        url: res.data.href,
        referer: 'https://disk.yandex.com.tr/',
        source: 'Yandex Disk'
      };
    }
  } catch (err) {
    console.error(`[Yandex Extractor] Failed to extract: ${err.message}`);
  }

  throw new Error('Yandex Disk indirme bağlantısı alınamadı. Paylaşım bağlantısının herkese açık ve geçerli olduğundan emin olun.');
}
