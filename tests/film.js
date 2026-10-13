import { executeDownloadPipeline } from '../pipelines.js';
import { downloadsDir } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';

const TEST_URL = 'https://www.fullhdfilmizlesene.now/film/orumcek-adam-yepyeni-bir-gun-spider-man-brand-new-day/';

async function runTest() {
  console.log('🚀 Test başlatılıyor:', TEST_URL);
  console.time('Test Süresi');

  try {
    const taskObject = {
      title: 'Spider-Man: Brand New Day',
      format: 'mp4',
      status: 'Başlatıldı'
    };

    await executeDownloadPipeline(TEST_URL, null, async (message) => {
      console.log('\n[PROGRESS]', message);
    }, null, taskObject);

    const files = fs.readdirSync(downloadsDir)
      .filter(f => ['.mp4', '.mkv', '.webm', '.m4v', '.avi'].includes(path.extname(f).toLowerCase()))
      .sort((a, b) => fs.statSync(path.join(downloadsDir, b)).mtimeMs - fs.statSync(path.join(downloadsDir, a)).mtimeMs);

    if (files.length > 0) {
      const latest = path.join(downloadsDir, files[0]);
      console.log('\n✅ İNDİRME TAMAMLANDI');
      console.log('Dosya:', latest);
      console.log('Boyut:', fs.statSync(latest).size);
    } else {
      console.log('\n⚠️ İndirilen dosya bulunamadı, ama pipeline çalıştı.');
    }
  } catch (error) {
    console.error('\n❌ TEST BAŞARISIZ OLDU!');
    console.error('Hata Mesajı:', error.message);
    process.exit(1);
  } finally {
    console.timeEnd('Test Süresi');
    process.exit(0);
  }
}

runTest();