import { extractVideoUrl } from './extractor.js';
import { downloadM3u8 } from './downloader.js';
import fs from 'fs';

(async () => {
  console.log('[TEST] Starting extraction test on VDS...');
  const res = await extractVideoUrl('https://dramadizilerim.com/izle/gi-zli-ejderha-kralla-evli-li-k?s=1&e=3');
  console.log('[TEST] Extracted title:', res.title);
  console.log('[TEST] Video URL:', res.url ? res.url.substring(0, 80) + '...' : 'NONE');

  if (res && res.url) {
    const testPath = './downloads/test_vds.mp4';
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);

    console.log('[TEST] Starting downloadM3u8 with FFmpeg...');
    let lastLog = 0;
    await downloadM3u8(
      res.url, 
      testPath, 
      null, 
      (completed, total) => {
        const now = Date.now();
        if (now - lastLog > 3000) {
          lastLog = now;
          console.log(`[TEST] Progress: ${(completed / (1024 * 1024)).toFixed(2)} MB downloaded`);
        }
      }, 
      res.referer, 
      res.cookies, 
      res.headers ? res.headers['User-Agent'] : null
    );

    if (fs.existsSync(testPath)) {
      const stats = fs.statSync(testPath);
      console.log(`[TEST SUCCESS] File created successfully! Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
    } else {
      console.error('[TEST ERROR] Output file does not exist after downloadM3u8!');
    }
  }
})().catch(err => {
  console.error('[TEST ERROR]:', err);
});
