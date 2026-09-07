import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { gotScraping } from '../extractor.js';

const results = [];

const sources = [
  // 1. Dizi & Video Platformları
  { name: 'YouTube', type: 'Video', domain: 'youtube.com', testUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
  { name: 'DramaDizilerim', type: 'Dizi', domain: 'dramadizilerim.com', testUrl: 'https://dramadizilerim.com/izle/dileklerin-efendisi?s=1&e=1' },
  { name: 'Animecix / Ecchicix', type: 'Anime', domain: 'ecchicix.com', testUrl: 'https://ecchicix.com/titles/7350/season/1/episode/5' },
  { name: 'HDFilmcehennemi', type: 'Film', domain: 'www.hdfilmcehennemi.nl', testUrl: 'https://www.hdfilmcehennemi.nl' },
  { name: 'Dizipal', type: 'Dizi/Film', domain: 'dizipal.com', testUrl: 'https://dizipal.com' },
  { name: 'FilmMakinesi', type: 'Film', domain: 'filmmakinesi.to', testUrl: 'https://filmmakinesi.to' },
  { name: 'FilmModu', type: 'Film', domain: 'filmmodu.org', testUrl: 'https://filmmodu.org' },
  { name: 'FullHDFilmIzlesene', type: 'Film', domain: 'fullhdfilmizlesene.pw', testUrl: 'https://fullhdfilmizlesene.pw' },
  { name: 'SezonlukDizi', type: 'Dizi', domain: 'sezonlukdizi.org', testUrl: 'https://sezonlukdizi.org' },
  { name: 'YabanciDizi', type: 'Dizi', domain: 'yabancidizi.co', testUrl: 'https://yabancidizi.co' },
  { name: 'DiziGom', type: 'Dizi', domain: 'dizigom1.pw', testUrl: 'https://dizigom1.pw' },
  { name: 'DiziBox', type: 'Dizi', domain: 'dizibox.tv', testUrl: 'https://dizibox.tv' },
  { name: 'Koreanturk', type: 'Dizi', domain: 'koreanturk.com', testUrl: 'https://koreanturk.com' },
  { name: 'HDKore', type: 'Dizi', domain: 'hdkore1.com', testUrl: 'https://hdkore1.com' },

  // 2. Sosyal Medya
  { name: 'TikTok', type: 'Sosyal Medya', domain: 'tiktok.com', testUrl: 'https://www.tiktok.com' },
  { name: 'Instagram', type: 'Sosyal Medya', domain: 'instagram.com', testUrl: 'https://www.instagram.com' },

  // 3. Bulut Depolama
  { name: 'Pixeldrain', type: 'Bulut', domain: 'pixeldrain.com', testUrl: 'https://pixeldrain.com/u/sample' },
  { name: 'Mediafire', type: 'Bulut', domain: 'mediafire.com', testUrl: 'https://www.mediafire.com' },
  { name: 'Mega.nz', type: 'Bulut', domain: 'mega.nz', testUrl: 'https://mega.nz' },
  { name: 'Google Drive', type: 'Bulut', domain: 'drive.google.com', testUrl: 'https://drive.google.com' },
  { name: 'Yandex Disk', type: 'Bulut', domain: 'disk.yandex.com.tr', testUrl: 'https://disk.yandex.com.tr' },
  { name: 'Dropbox', type: 'Bulut', domain: 'dropbox.com', testUrl: 'https://www.dropbox.com' },
  { name: 'WeTransfer', type: 'Bulut', domain: 'wetransfer.com', testUrl: 'https://wetransfer.com' },
  { name: 'Terabox', type: 'Bulut', domain: 'terabox.com', testUrl: 'https://www.terabox.com' },
  { name: 'Cloud Mail.ru', type: 'Bulut', domain: 'cloud.mail.ru', testUrl: 'https://cloud.mail.ru' },
  { name: 'Itch.io', type: 'Oyun/Dosya', domain: 'itch.io', testUrl: 'https://itch.io' },

  // 4. APK İndirme
  { name: 'APKPure', type: 'APK', domain: 'apkpure.net', testUrl: 'https://apkpure.net' },
  { name: 'APKMirror', type: 'APK', domain: 'apkmirror.com', testUrl: 'https://www.apkmirror.com' },
  { name: 'HappyMod', type: 'APK', domain: 'happymod.com', testUrl: 'https://www.happymod.com' },
  { name: 'LiteAPKs', type: 'APK', domain: 'liteapks.com', testUrl: 'https://liteapks.com' },
  { name: 'ModYolo', type: 'APK', domain: 'modyolo.com', testUrl: 'https://modyolo.com' },
  { name: '9Mod', type: 'APK', domain: '9mod.com', testUrl: 'https://9mod.com' },

  // 5. Manga & Webtoon
  { name: 'MangaDenizi', type: 'Manga', domain: 'mangadenizi.com', testUrl: 'https://mangadenizi.com' },
  { name: 'MangaTR', type: 'Manga', domain: 'mangatr.net', testUrl: 'https://mangatr.net' },
  { name: 'WebtoonTR', type: 'Webtoon', domain: 'webtoontr.com', testUrl: 'https://webtoontr.com' },
  { name: 'AsuraScans', type: 'Manga', domain: 'asuracomic.net', testUrl: 'https://asuracomic.net' },
  { name: 'MerlinScans', type: 'Manga', domain: 'merlinscans.org', testUrl: 'https://merlinscans.org' },

  // 6. Yetişkin / 18+
  { name: 'Hentaizm', type: '18+', domain: 'hentaizm2.com', testUrl: 'https://hentaizm2.com' },
  { name: 'Doeda', type: '18+', domain: 'doeda.com', testUrl: 'https://doeda.com' },
  { name: 'Pornhub', type: '18+', domain: 'pornhub.com', testUrl: 'https://www.pornhub.com' },
  { name: 'XHamster', type: '18+', domain: 'xhamster.com', testUrl: 'https://xhamster.com' },
  { name: 'TurkPorno', type: '18+', domain: 'turkporno.com', testUrl: 'https://turkporno.com' },
  { name: 'TurkIfsaHub', type: '18+', domain: 'turkifsahub.com', testUrl: 'https://turkifsahub.com' },
  { name: 'TurkIfsalar', type: '18+', domain: 'turkifsalar.site', testUrl: 'https://turkifsalar.site' },
  { name: 'HDAbla', type: '18+', domain: 'hdabla.net', testUrl: 'https://hdabla.net' },
  { name: 'JavGuru', type: '18+', domain: 'jav.guru', testUrl: 'https://jav.guru' },
  { name: 'Rule34Video', type: '18+', domain: 'rule34video.com', testUrl: 'https://rule34video.com' },
  { name: 'KoreanPornMovie', type: '18+', domain: 'koreanpornmovie.com', testUrl: 'https://koreanpornmovie.com' },
  { name: 'Kalite18', type: '18+', domain: 'kalite18.com', testUrl: 'https://kalite18.com' },
  { name: 'Kopeda', type: '18+', domain: 'kopeda.com', testUrl: 'https://kopeda.com' },
  { name: 'Maheir', type: '18+', domain: 'maheir.com', testUrl: 'https://maheir.com' },

  // 7. Doğrudan & Torrent
  { name: 'Doğrudan Web Medya (MP4/M3U8)', type: 'Doğrudan', domain: 'cdn', testUrl: 'https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/person-bicycle-car-detection.mp4' },
  { name: 'WebTorrent / Magnet', type: 'Torrent', domain: 'bittorrent', testUrl: 'magnet:?xt=urn:btih:test' }
];

console.log(`Checking ${sources.length} sources...`);

async function checkSource(src) {
  const start = Date.now();
  let status = 'OK';
  let httpCode = null;
  let detail = '';

  try {
    const res = await gotScraping.get({
      url: src.testUrl,
      timeout: { request: 8000 },
      throwHttpErrors: false,
      headerGeneratorOptions: {
        devices: ['desktop'],
        locales: ['tr-TR', 'en-US'],
        operatingSystems: ['windows']
      }
    });
    httpCode = res.statusCode;
    const ms = Date.now() - start;
    if (httpCode >= 200 && httpCode < 400) {
      status = 'ONLINE';
      detail = `${httpCode} OK (${ms}ms)`;
    } else if (httpCode === 403) {
      status = 'CLOUDFLARE_PROTECTED';
      detail = `HTTP 403 (Cloudflare/Anti-Bot)`;
    } else {
      status = `HTTP_${httpCode}`;
      detail = `HTTP ${httpCode} (${ms}ms)`;
    }
  } catch (err) {
    status = 'ERROR';
    detail = err.code || err.message;
  }

  return { ...src, status, httpCode, detail };
}

(async () => {
  const chunks = [];
  const chunkSize = 5;
  for (let i = 0; i < sources.length; i += chunkSize) {
    chunks.push(sources.slice(i, i + chunkSize));
  }

  const allChecked = [];
  for (const chunk of chunks) {
    const res = await Promise.all(chunk.map(checkSource));
    allChecked.push(...res);
  }

  console.log('\n--- EXTRACTOR PROBE RESULTS ---');
  let onlineCount = 0;
  for (const item of allChecked) {
    if (item.status === 'ONLINE' || item.status.includes('CLOUDFLARE')) onlineCount++;
    console.log(`[${item.type}]`.padEnd(15), item.name.padEnd(25), '->', item.status.padEnd(22), item.detail);
  }
  console.log(`\nTotal: ${allChecked.length}, Reachable/Active: ${onlineCount}`);

  fs.writeFileSync('scripts/probe_results.json', JSON.stringify(allChecked, null, 2), 'utf8');
})();
