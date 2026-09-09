import { exec } from 'child_process';
import { addDownloadTask, pendingSelections } from '../queue.js';
import { getYtDlpCommand, getProxyUrl } from '../config.js';

function parseAnimecixEpisodeInfo(url) {
  try {
    const host = new URL(url).origin;
    let titleId = null;
    let slug = null;

    const tMatch = url.match(/\/titles\/(\d+)/i);
    if (tMatch) titleId = tMatch[1];
    const dMatch = url.match(/\/dizi\/([^/?#]+)/i);
    if (dMatch) slug = dMatch[1];

    let season = "1";
    const sPreMatch = url.match(/(\d+)[-_.]?(?:season|sezon)/i);
    const sPostMatch = url.match(/(?:season|sezon)[-_/](\d+)/i);
    const sParamMatch = url.match(/[?&]s(?:eason)?=(\d+)/i);
    if (sPreMatch) {
      season = sPreMatch[1];
    } else if (sPostMatch) {
      season = sPostMatch[1];
    } else if (sParamMatch) {
      season = sParamMatch[1];
    }

    let episode = null;
    const ePreMatch = url.match(/(\d+)[-_.]?(?:episode|bolum|bölüm)/i);
    const ePostMatch = url.match(/(?:episode|bolum|bölüm)[-_/]?(\d+)/i);
    const eParamMatch = url.match(/[?&]e(?:pisode)?=(\d+)/i);
    if (ePreMatch) {
      episode = parseInt(ePreMatch[1], 10);
    } else if (ePostMatch) {
      episode = parseInt(ePostMatch[1], 10);
    } else if (eParamMatch) {
      episode = parseInt(eParamMatch[1], 10);
    }

    return { host, titleId, slug, season, episode };
  } catch (e) {
    return null;
  }
}

function buildAnimecixEpisodeUrl(origUrl, titleId, season, slug, ep) {
  const host = new URL(origUrl).origin;
  if (titleId) {
    return `${host}/titles/${titleId}/season/${season}/episode/${ep}`;
  }
  if (/(?:episode|bolum|bölüm)[/-]\d+/i.test(origUrl)) {
    return origUrl.replace(/(episode|bolum|bölüm)([/-])\d+/i, `$1$2${ep}`);
  }
  if (/(?:episode|bolum|bölüm)\d+/i.test(origUrl)) {
    return origUrl.replace(/(episode|bolum|bölüm)\d+/i, `$1${ep}`);
  }
  if (/\d+-(?:episode|bolum|bölüm)/i.test(origUrl)) {
    return origUrl.replace(/\d+(-(?:episode|bolum|bölüm))/i, `${ep}$1`);
  }
  if (slug) {
    return `${host}/dizi/${slug}/sezon-${season}/bolum-${ep}`;
  }
  return `${origUrl}#ep=${ep}`;
}

export default {
  name: 'indir',
  aliases: ['download'],
  async execute(sock, msg, from, args, ctx) {
    const isMp3Cmd = ctx.text.startsWith('!mp3');
    const isIndir = ctx.text.startsWith('!indir') || ctx.text.startsWith('!download') || isMp3Cmd;

    const parts = ctx.text.trim().split(/\s+/);
    if (isIndir && parts.length < 2) {
      await sock.sendMessage(from, { text: '📢 Link gönder, hemen indir! Sıramı görmek için *kuyruk* yaz.' });
      return;
    }

    const priority = parts.includes('--oncelikli') || parts.includes('--öncelikli');
    let urls = parts.filter(p => p.startsWith('http://') || p.startsWith('https://') || p.startsWith('magnet:'));
    if (urls.length === 0) {
      await sock.sendMessage(from, { text: 'Lütfen geçerli bir link belirtin. Örnek: `!indir https://animecix.net/...`' });
      return;
    }

    // Check if arguments specify an episode range (e.g. `!indir <url> 10 15` or `!indir <url> 10-15`)
    let numRange = null;
    const nonUrlParts = parts.filter(p => !p.startsWith('http://') && !p.startsWith('https://') && !p.startsWith('magnet:') && !p.startsWith('!') && !p.startsWith('--'));
    const joinedNonUrls = nonUrlParts.join(' ').trim();
    const rangeMatch = joinedNonUrls.match(/^(\d+)\s*[-to–—]\s*(\d+)$/i) || joinedNonUrls.match(/^(\d+)\s+(\d+)$/);
    if (rangeMatch) {
      numRange = {
        start: parseInt(rangeMatch[1], 10),
        end: parseInt(rangeMatch[2], 10)
      };
    }

    const supportedDomains = [
      'hdfilmcehennemi', 'animecix', 'ecchicix', 'hentaizm',
      'youtube.com', 'youtu.be', 'pornhub.com', 'doeda', 'hdabla', 'hdkore',
      'turkifsahub', 'turkifsalar', 'turkporno', 'cloud.mail.ru', 'cloidmail.ru', 'instagram.com',
      'tiktok.com', 'disk.yandex', 'yadi.sk', 'drive.google.com', 'mega.nz', 'yabancidizi', 'sezonlukdizi', 'terabox.com', 'teraboxapp.com', 'nephobox.com', 'liteapks.com', 'modyolo.com', 'koreanturk', 'koreanizm', 'dizigom', 'dizibox', 'dizipal', 'filmmodu', 'fullhdfilmizlesene', 'dramadizilerim', 'filmmakinesi'
    ];

    // ─── Aralık İndirme (2 link varsa) ───
    if (urls.length === 2) {
      if (urls[0].includes('hdfilmcehennemi') && urls[1].includes('hdfilmcehennemi')) {
        const match1 = urls[0].match(/\/sezon-(\d+)\/bolum-(\d+)\/?$/);
        const match2 = urls[1].match(/\/sezon-(\d+)\/bolum-(\d+)\/?$/);

        if (match1 && match2 && match1[1] === match2[1]) {
          const season = match1[1];
          const startEp = Math.min(parseInt(match1[2], 10), parseInt(match2[2], 10));
          const endEp = Math.max(parseInt(match1[2], 10), parseInt(match2[2], 10));
          const baseUrl = urls[0].split(`/sezon-${season}/`)[0];

          await sock.sendMessage(from, { text: `🎬 *HDfilmcehennemi Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

          let addedCount = 0;
          let skipCount = 0;
          for (let ep = startEp; ep <= endEp; ep++) {
            const epUrl = `${baseUrl}/sezon-${season}/bolum-${ep}/`;
            try {
              addDownloadTask(epUrl, from, `Sezon ${season} Bölüm ${ep}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }

      if ((urls[0].includes('animecix') || urls[0].includes('ecchicix')) && 
          (urls[1].includes('animecix') || urls[1].includes('ecchicix'))) {
        const epInfo1 = parseAnimecixEpisodeInfo(urls[0]);
        const epInfo2 = parseAnimecixEpisodeInfo(urls[1]);

        if (epInfo1 && epInfo2 && epInfo1.episode !== null && epInfo2.episode !== null && epInfo1.season === epInfo2.season) {
          const season = epInfo1.season;
          const startEp = Math.min(epInfo1.episode, epInfo2.episode);
          const endEp = Math.max(epInfo1.episode, epInfo2.episode);
          const host = epInfo1.host;

          let titleId = epInfo1.titleId || epInfo2.titleId;
          const slug = epInfo1.slug || epInfo2.slug;
          let animeName = '';

          try {
            if (!titleId && slug) {
              const { resolveAnimecixSlug } = await import('../extractor.js');
              titleId = await resolveAnimecixSlug(slug, host);
            }
            if (titleId) {
              const { gotScraping } = await import('../extractor.js');
              const res = await gotScraping.get(`${host}/secure/titles/${titleId}?titleId=${titleId}&seasonNumber=${season}&page=1&perPage=1`, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
                  'X-Requested-With': 'com.kraptor.AnimeciX',
                  'X-App-Version': '1.0.5',
                  'x-e-h': "7Y2ozlO+QysR5w9Q6Tupmtvl9jJp7ThFH8SB+Lo7NvZjgjqRSqOgcT2v4ISM9sP10LmnlYI8WQ==.xrlyOBFS5BHjQ2Lk",
                  'X-App-Hash': "b849e8a9f6cceff267251a73644faacc801ad726cc8f22a9c323c56a203f5446"
                },
                timeout: 5000
              });
              const d = JSON.parse(res.body);
              animeName = d?.data?.title?.name || d?.title?.name || '';
            }
          } catch (e) {}

          const titlePrefix = animeName ? `${animeName} - ` : '';
          await sock.sendMessage(from, { text: `🎬 *${animeName || 'Animecix'} Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

          let addedCount = 0;
          let skipCount = 0;
          for (let ep = startEp; ep <= endEp; ep++) {
            const epUrl = buildAnimecixEpisodeUrl(urls[0], titleId, season, slug, ep);
            try {
              addDownloadTask(epUrl, from, `${titlePrefix}Sezon ${season} Bölüm ${ep}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }

      if (urls[0].includes('hentaizm') && urls[1].includes('hentaizm')) {
        const match1 = urls[0].match(/sezon-(\d+)-bolum-(\d+)/i) || urls[0].match(/\/sezon-(\d+)\/bolum-(\d+)/i);
        const match2 = urls[1].match(/sezon-(\d+)-bolum-(\d+)/i) || urls[1].match(/\/sezon-(\d+)\/bolum-(\d+)/i);

        if (match1 && match2 && match1[1] === match2[1]) {
          const season = match1[1];
          const startEp = Math.min(parseInt(match1[2], 10), parseInt(match2[2], 10));
          const endEp = Math.max(parseInt(match1[2], 10), parseInt(match2[2], 10));

          await sock.sendMessage(from, { text: `🎬 *Hentaizm Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

          let addedCount = 0;
          let skipCount = 0;
          for (let ep = startEp; ep <= endEp; ep++) {
            const epUrl = urls[0].replace(/sezon-\d+-bolum-\d+/i, `sezon-${season}-bolum-${ep}`);
            try {
              addDownloadTask(epUrl, from, `Hentaizm Sezon ${season} Bölüm ${ep}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }

      if (urls[0].includes('dizipal') && urls[1].includes('dizipal')) {
        const match1 = urls[0].match(/\/bolum\/(.+?)-(\d+)-sezon-(\d+)-bolum\/?$/i);
        const match2 = urls[1].match(/\/bolum\/(.+?)-(\d+)-sezon-(\d+)-bolum\/?$/i);

        if (match1 && match2 && match1[1] === match2[1] && match1[2] === match2[2]) {
          const slug = match1[1];
          const season = match1[2];
          const startEp = Math.min(parseInt(match1[3], 10), parseInt(match2[3], 10));
          const endEp = Math.max(parseInt(match1[3], 10), parseInt(match2[3], 10));
          const origin = new URL(urls[0]).origin;

          await sock.sendMessage(from, { text: `🎬 *Dizipal Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

          let addedCount = 0;
          let skipCount = 0;
          for (let ep = startEp; ep <= endEp; ep++) {
            const epUrl = `${origin}/bolum/${slug}-${season}-sezon-${ep}-bolum`;
            try {
              addDownloadTask(epUrl, from, `Sezon ${season} Bölüm ${ep}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }

      // HDKore 2 link aralığı
      if (urls[0].includes('hdkore') && urls[1].includes('hdkore')) {
        const getHdkoreEp = (u) => {
          try {
            const parsed = new URL(u);
            if (parsed.searchParams.get('ep')) return parseInt(parsed.searchParams.get('ep'), 10);
            const m = parsed.pathname.match(/[-_](\d+)[-_]bolum/i) || parsed.pathname.match(/bolum[-_](\d+)/i);
            if (m) return parseInt(m[1], 10);
          } catch (e) {}
          return null;
        };

        const ep1 = getHdkoreEp(urls[0]);
        const ep2 = getHdkoreEp(urls[1]);

        if (ep1 && ep2) {
          const startEp = Math.min(ep1, ep2);
          const endEp = Math.max(ep1, ep2);
          const baseUrl = urls[0].split('?')[0].replace(/[-_]\d+[-_]bolum.*/i, '');

          await sock.sendMessage(from, { text: `🎬 *HDKore Dizi Aralığı Algılandı!*\nBölümler: ${startEp} ile ${endEp} arası 10'arlı paketler halinde sıraya ekleniyor...` });

          const allEps = [];
          for (let ep = startEp; ep <= endEp; ep++) {
            allEps.push({
              url: `${baseUrl}?ep=${ep}`,
              name: `${ep}. Bölüm`,
              episode: ep
            });
          }

          const chunks = [];
          for (let i = 0; i < allEps.length; i += 10) {
            chunks.push(allEps.slice(i, i + 10));
          }

          let addedCount = 0;
          let skipCount = 0;

          for (const chunk of chunks) {
            const sNum = chunk[0].episode;
            const eNum = chunk[chunk.length - 1].episode;
            const bTitle = sNum === eNum ? `HDKore - Bölüm ${sNum}` : `HDKore - Bölüm ${sNum}-${eNum}`;
            const bUrl = `${chunk[0].url}#batch=${sNum}-${eNum}`;

            try {
              if (chunk.length > 1) {
                addDownloadTask(bUrl, from, bTitle, null, priority, null, chunk);
              } else {
                addDownloadTask(chunk[0].url, from, bTitle, null, priority);
              }
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* paket (${allEps.length} bölüm) başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer paket atlandı.`;
          replyMsg += `\n\n_Her paket 10 bölümü tek parça video olarak birleştirip gönderecektir._`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }

      // DramaDizilerim 2 link aralığı
      if (urls[0].includes('dramadizilerim') && urls[1].includes('dramadizilerim')) {
        const getDramaEp = (u) => {
          try {
            const parsed = new URL(u);
            const e = parsed.searchParams.get('e');
            const s = parsed.searchParams.get('s') || '1';
            if (e) return { s: parseInt(s, 10), e: parseInt(e, 10) };
          } catch (e) {}
          return null;
        };

        const info1 = getDramaEp(urls[0]);
        const info2 = getDramaEp(urls[1]);

        if (info1 && info2 && info1.s === info2.s) {
          const season = info1.s;
          const startEp = Math.min(info1.e, info2.e);
          const endEp = Math.max(info1.e, info2.e);
          const baseUrl = urls[0].split('?')[0];

          await sock.sendMessage(from, { text: `🎬 *DramaDizilerim Dizi Aralığı Algılandı!*\nSezon: ${season}, Bölümler: ${startEp} ile ${endEp} arası 10'arlı paketler halinde sıraya ekleniyor...` });

          const allEps = [];
          for (let ep = startEp; ep <= endEp; ep++) {
            allEps.push({
              url: `${baseUrl}?s=${season}&e=${ep}`,
              name: `Sezon ${season} Bölüm ${ep}`,
              episode: ep
            });
          }

          const chunks = [];
          for (let i = 0; i < allEps.length; i += 10) {
            chunks.push(allEps.slice(i, i + 10));
          }

          let addedCount = 0;
          let skipCount = 0;

          for (const chunk of chunks) {
            const sNum = chunk[0].episode;
            const eNum = chunk[chunk.length - 1].episode;
            const bTitle = sNum === eNum ? `DramaDizilerim - Bölüm ${sNum}` : `DramaDizilerim - Bölüm ${sNum}-${eNum}`;
            const bUrl = `${chunk[0].url}#batch=${sNum}-${eNum}`;

            try {
              if (chunk.length > 1) {
                addDownloadTask(bUrl, from, bTitle, null, priority, null, chunk);
              } else {
                addDownloadTask(chunk[0].url, from, bTitle, null, priority);
              }
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* paket (${allEps.length} bölüm) başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer paket atlandı.`;
          replyMsg += `\n\n_Her paket 10 bölümü tek parça video olarak birleştirip gönderecektir._`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }
    }

    // ─── Tek Link + Sayısal Bölüm Aralığı (Örn: !indir <url> 10 15 veya 10-15) ───
    if (urls.length === 1 && numRange) {
      if (urls[0].includes('animecix') || urls[0].includes('ecchicix')) {
        const epInfo = parseAnimecixEpisodeInfo(urls[0]);
        if (epInfo) {
          const season = epInfo.season || "1";
          const startEp = Math.min(numRange.start, numRange.end);
          const endEp = Math.max(numRange.start, numRange.end);
          const host = epInfo.host;

          let titleId = epInfo.titleId;
          const slug = epInfo.slug;
          let animeName = '';

          try {
            if (!titleId && slug) {
              const { resolveAnimecixSlug } = await import('../extractor.js');
              titleId = await resolveAnimecixSlug(slug, host);
            }
            if (titleId) {
              const { gotScraping } = await import('../extractor.js');
              const res = await gotScraping.get(`${host}/secure/titles/${titleId}?titleId=${titleId}&seasonNumber=${season}&page=1&perPage=1`, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
                  'X-Requested-With': 'com.kraptor.AnimeciX',
                  'X-App-Version': '1.0.5',
                  'x-e-h': "7Y2ozlO+QysR5w9Q6Tupmtvl9jJp7ThFH8SB+Lo7NvZjgjqRSqOgcT2v4ISM9sP10LmnlYI8WQ==.xrlyOBFS5BHjQ2Lk",
                  'X-App-Hash': "b849e8a9f6cceff267251a73644faacc801ad726cc8f22a9c323c56a203f5446"
                },
                timeout: 5000
              });
              const d = JSON.parse(res.body);
              animeName = d?.data?.title?.name || d?.title?.name || '';
            }
          } catch (e) {}

          const titlePrefix = animeName ? `${animeName} - ` : '';
          await sock.sendMessage(from, { text: `🎬 *${animeName || 'Animecix'} Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

          let addedCount = 0;
          let skipCount = 0;
          for (let ep = startEp; ep <= endEp; ep++) {
            const epUrl = buildAnimecixEpisodeUrl(urls[0], titleId, season, slug, ep);
            try {
              addDownloadTask(epUrl, from, `${titlePrefix}Sezon ${season} Bölüm ${ep}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }

      if (urls[0].includes('hdfilmcehennemi')) {
        const match = urls[0].match(/\/sezon-(\d+)\/bolum-(\d+)/i) || urls[0].match(/\/sezon-(\d+)/i);
        if (match) {
          const season = match[1];
          const startEp = Math.min(numRange.start, numRange.end);
          const endEp = Math.max(numRange.start, numRange.end);
          const baseUrl = urls[0].split(`/sezon-${season}/`)[0];

          await sock.sendMessage(from, { text: `🎬 *HDfilmcehennemi Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

          let addedCount = 0;
          let skipCount = 0;
          for (let ep = startEp; ep <= endEp; ep++) {
            const epUrl = `${baseUrl}/sezon-${season}/bolum-${ep}/`;
            try {
              addDownloadTask(epUrl, from, `Sezon ${season} Bölüm ${ep}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }
    }

    // ─── Çoklu Bağımsız Link (2+) ───
    if (urls.length > 1) {
      const hentaizmLinks = urls.filter(u => u.includes('hentaizm'));
      if (hentaizmLinks.length === urls.length && hentaizmLinks.some(u => u.includes('/anime/') || (!u.includes('/izle/') && !u.includes('/manga/')))) {
        const topluCmd = (await import('./topluhentai.js')).default;
        return await topluCmd.execute(sock, msg, from, urls, ctx);
      }

      let addedCount = 0;
      let skipCount = 0;
      let unsupportedCount = 0;
      for (const u of urls) {
        const isSupported = u.startsWith('magnet:') || supportedDomains.some(d => u.includes(d));
        if (!isSupported) { unsupportedCount++; continue; }
        try {
          addDownloadTask(u, from, 'Video Çözümleniyor...', null, priority);
          addedCount++;
        } catch (e) {
          skipCount++;
        }
      }
      let replyMsg = `✅ *${addedCount}* link sıraya eklendi.`;
      if (skipCount > 0) replyMsg += `\n⚠️ ${skipCount} mükerrer atlandı.`;
      if (unsupportedCount > 0) replyMsg += `\n❌ ${unsupportedCount} desteklenmeyen link.`;
      if (priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
      replyMsg += `\n\n\`!kuyruk\` ile durumu takip edin.`;
      await sock.sendMessage(from, { text: replyMsg });
      return;
    }

    // ─── Tekil Link ───
    const singleUrl = urls[0];
    const isYouTubeUrl = /youtube\.com|youtu\.be/i.test(singleUrl);
    const isAnimecix = singleUrl.includes('animecix') || singleUrl.includes('ecchicix');
    const isHentaizm = singleUrl.includes('hentaizm');
    const isPornhub = singleUrl.includes('pornhub.com');
    const isDoeda = /doeda/i.test(singleUrl);
    const isHdabla = /hdabla/i.test(singleUrl);
    const isHdkore = singleUrl.includes('hdkore');
    const isTurkifsahub = singleUrl.includes('turkifsahub.com');
    const isTurkifsalar = /turkifsalar/i.test(singleUrl);
    const isTurkporno = /turkporno/i.test(singleUrl);
    const isCloudMailRu = singleUrl.includes('cloud.mail.ru') || singleUrl.includes('cloidmail.ru');
    const isInstagramUrl = singleUrl.includes('instagram.com');
    const isTikTokUrl = singleUrl.includes('tiktok.com');
    const isYandexUrl = singleUrl.includes('disk.yandex') || singleUrl.includes('yadi.sk');
    const isGDriveUrl = singleUrl.includes('drive.google.com');
    const isMegaUrl = singleUrl.includes('mega.nz');
    const isYabancidiziUrl = singleUrl.includes('yabancidizi.co') || singleUrl.includes('yabancidizi.pw') || singleUrl.includes('yabancidizi.vip') || singleUrl.includes('yabancidizi.fun') || singleUrl.includes('yabancidizi.com');
    const isSezonlukdiziUrl = singleUrl.includes('sezonlukdizi.org') || singleUrl.includes('sezonlukdizi.pro') || singleUrl.includes('sezonlukdizi.co') || singleUrl.includes('sezonlukdizi.com');
    const isTeraboxUrl = singleUrl.includes('terabox.com') || singleUrl.includes('teraboxapp.com') || singleUrl.includes('nephobox.com') || singleUrl.includes('terabox');
    const isLiteapksUrl = singleUrl.includes('liteapks.com');
    const isModyoloUrl = singleUrl.includes('modyolo.com');
    const isDiziSitesiUrl = singleUrl.includes('dizigom') || singleUrl.includes('dizibox') || singleUrl.includes('koreanturk') || singleUrl.includes('koreanizm') || singleUrl.includes('dizipal') || singleUrl.includes('filmmodu') || singleUrl.includes('fullhdfilmizlesene') || singleUrl.includes('filmmakinesi');
    const isDramadizilerim = singleUrl.includes('dramadizilerim.com');
    const isTorrentUrl = singleUrl.startsWith('magnet:') || singleUrl.toLowerCase().includes('.torrent');

    if (!singleUrl.includes('hdfilmcehennemi') && !isAnimecix && !isYouTubeUrl && !isHentaizm && !isPornhub && !isDoeda && !isHdabla && !isHdkore && !isTurkifsahub && !isTurkifsalar && !isTurkporno && !isCloudMailRu && !isInstagramUrl && !isTikTokUrl && !isYandexUrl && !isGDriveUrl && !isMegaUrl && !isYabancidiziUrl && !isSezonlukdiziUrl && !isTeraboxUrl && !isLiteapksUrl && !isModyoloUrl && !isDiziSitesiUrl && !isTorrentUrl && !isDramadizilerim) {
      await sock.sendMessage(from, { text: 'Lütfen geçerli bir desteklenen medya linki gönderin.' });
      return;
    }

    // Animecix Sezon/Dizi kontrolü
    const isAnimecixSingleEp = singleUrl.includes('/episode/') || singleUrl.includes('/bolum/') || singleUrl.includes('/bölüm/');
    const isAnimecixSeasonOrShow = isAnimecix && !isAnimecixSingleEp;

    if (isAnimecixSeasonOrShow) {
      const { getAnimecixSeasonEpisodes } = await import('../extractor.js');
      await sock.sendMessage(from, { text: '🔍 Sezon bölümleri alınıyor, lütfen bekleyin...' });
      try {
        const result = await getAnimecixSeasonEpisodes(singleUrl);
        const { animeName, episodes, skippedCount: preSkipped, isMultiSeason, seasons } = result;

        if (episodes.length === 0) {
          const emptyMsg = preSkipped > 0
            ? `❌ Bu sezondaki *${preSkipped}* bölümün tamamı henüz platforma yüklenmemiş.`
            : '❌ Bu sezonda hiçbir bölüm bulunamadı.';
          await sock.sendMessage(from, { text: emptyMsg });
          return;
        }

        // Direct auto-download if user specified 'hepsi', 'tümü', 'full', 'all', 'oto'
        const wantsAll = nonUrlParts.some(p => ['hepsi', 'tümü', 'tumu', 'all', 'full', 'oto', 'tamamı'].includes(p.toLowerCase()));
        if (wantsAll) {
          await sock.sendMessage(from, {
            text: `🎬 *${animeName}* - *Tüm Sezonlar & Bölümler*\n📦 Toplam *${episodes.length}* bölüm doğrudan sıraya ekleniyor...`
          });
          let addedCount = 0;
          let skipCount = 0;
          for (const ep of episodes) {
            try {
              addDownloadTask(ep.url, from, `${animeName} - ${ep.name}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }
          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          if (priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }

        // Direct auto-download if user specified a range like "1-12"
        if (numRange) {
          const rangeEps = episodes.filter(ep => {
            const epNum = ep.number || parseInt(ep.name?.match(/\d+/)?.[0], 10);
            return epNum >= numRange.start && epNum <= numRange.end;
          });
          if (rangeEps.length > 0) {
            await sock.sendMessage(from, {
              text: `🎬 *${animeName}* - Bölüm ${numRange.start}-${numRange.end}\n📦 Toplam *${rangeEps.length}* bölüm sıraya ekleniyor...`
            });
            let addedCount = 0;
            for (const ep of rangeEps) {
              try {
                addDownloadTask(ep.url, from, `${animeName} - ${ep.name}`, null, priority);
                addedCount++;
              } catch (e) {}
            }
            await sock.sendMessage(from, { text: `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.` });
            return;
          }
        }

        if (isMultiSeason && seasons && seasons.length > 1) {
          pendingSelections[from] = {
            type: 'multi_season',
            seriesName: animeName,
            seasons: seasons,
            allEpisodes: episodes,
            priority: priority
          };

          let prompt = `🎬 *${animeName}* animesi algılandı!\n` +
            `✨ Toplam *${seasons.length}* sezon bulundu:\n\n`;

          seasons.forEach((s) => {
            prompt += `  • *${s.name || `${s.season}. Sezon`}*: ${s.episodes.length} Bölüm\n`;
          });
          prompt += `  *(Toplam ${episodes.length} Bölüm)*\n\n`;

          prompt += `Lütfen indirmek istediğiniz seçeneği yazın:\n\n` +
            `🌟 *Tüm Sezonları İndir:* *hepsi* (veya *tümü*)\n`;

          seasons.forEach((s) => {
            prompt += `${s.season}️⃣ *${s.name || `${s.season}. Sezon`}u İndir:* *${s.season}* (veya *s${s.season}*)\n`;
          });

          prompt += `\n🔢 *Bölüm Aralığı İndir:* (Örn: *s1 1-5* veya *s2 1-12*)\n` +
            `❌ İptal etmek için *iptal* yazın.`;

          await sock.sendMessage(from, { text: prompt });
          return;
        }

        pendingSelections[from] = {
          type: 'series',
          seriesName: animeName,
          episodes: episodes,
          priority: priority
        };

        let seasonPrompt = `🎬 *${animeName}* dizisi algılandı!\n📦 Toplam *${episodes.length}* hazır bölüm bulundu.\n\n` +
          `Lütfen indirmek istediğiniz seçeneği yazın:\n\n` +
          `1️⃣ *Tüm Sezonu İndir* (Hepsini indirmek için: *hepsi* veya *1* yazın)\n` +
          `2️⃣ *Bölüm Aralığı İndir* (Örn: *10-20* veya *5-15* yazarak belirli bölümleri indirebilirsiniz)\n\n` +
          `❌ İptal etmek için *iptal* yazın.`;
        if (preSkipped > 0) {
          seasonPrompt += `\n\n*(Not: Platforma henüz yüklenmemiş ${preSkipped} bölüm otomatik atlandı)*`;
        }
        await sock.sendMessage(from, { text: seasonPrompt });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Sezon bölümleri alınırken hata oluştu: ${err.message}` });
      }
      return;
    }

    // Hentaizm Liste/Kategori/Favori kontrolü
    const isHentaizmListing = isHentaizm && (
      singleUrl.includes('?tab=') || 
      singleUrl.includes('tab=fav') || 
      singleUrl.includes('/hentai-listesi') || 
      singleUrl.includes('/kategori/') || 
      singleUrl.includes('/etiket/') || 
      singleUrl.includes('/arsiv/') ||
      singleUrl.includes('/ara?')
    );

    if (isHentaizmListing) {
      const topluCmd = (await import('./topluhentai.js')).default;
      return await topluCmd.execute(sock, msg, from, urls, ctx);
    }

    // Hentaizm Sezon/Anime kontrolü
    const isHentaizmAnime = isHentaizm && (
      singleUrl.includes('/anime/') || 
      (!singleUrl.includes('/izle/') && !singleUrl.includes('/manga/') && !singleUrl.includes('/manga-oku/'))
    );

    if (isHentaizmAnime) {
      const { getHentaizmSeasonEpisodes } = await import('../extractor.js');
      await sock.sendMessage(from, { text: '🔍 Hentaizm anime bölümleri taranıyor, lütfen bekleyin...' });
      try {
        const { seriesName, posterUrl, description, episodes } = await getHentaizmSeasonEpisodes(singleUrl);

        if (!episodes || episodes.length === 0) {
          await sock.sendMessage(from, { text: '❌ Bu animede hiçbir bölüm bulunamadı.' });
          return;
        }

        const config = (await import('../config.js')).readConfig();
        const targetJid = config.hentaiGroupJid || from;

        // Otomatik tüm bölümleri paket olarak sıraya ekle:
        // Önce tüm bölümleri sunucuya indirecek, sonra kapak resmi + ismi + videoları sırayla gönderecek.
        addDownloadTask(
          singleUrl,
          targetJid,
          `🔞 ${seriesName} (${episodes.length} Bölüm Paket)`,
          null,
          priority,
          null,
          null,
          {
            type: 'hentai_pack',
            seriesName,
            posterUrl,
            description,
            episodes,
            replyJid: from
          }
        );

        let startMsg = `🎬 *${seriesName}* paketi sıraya eklendi!\n` +
          `📦 Toplam *${episodes.length}* bölüm bulundu.\n` +
          `⏳ *İşlem:* Önce tüm bölümler sunucuya indirilecek, ardından kapak resmi ve isim bilgisiyle birlikte topluca gönderilecektir.`;
        if (targetJid !== from) {
          startMsg += `\n🎯 *Hedef Grup:* \`${targetJid}\``;
        }
        startMsg += `\n\nSırayı görmek için: \`!kuyruk\``;
        await sock.sendMessage(from, { text: startMsg });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Anime bölümleri alınırken hata oluştu: ${err.message}` });
      }
      return;
    }

    // HDfilmcehennemi Sezon/Dizi kontrolü
    const isHdfSeries = singleUrl.includes('hdfilmcehennemi') && singleUrl.includes('/dizi/') && !/\/bolum-\d+/i.test(singleUrl);

    if (isHdfSeries) {
      const { getHdfilmcehennemiSeasonEpisodes } = await import('../extractor.js');
      await sock.sendMessage(from, { text: '🔍 HDfilmcehennemi yayınlanan sezon bölümleri taranıyor...' });
      try {
        const { seriesName, episodes } = await getHdfilmcehennemiSeasonEpisodes(singleUrl);

        if (episodes.length === 0) {
          await sock.sendMessage(from, { text: '❌ Bu sezonda/dizide hiçbir bölüm bulunamadı.' });
          return;
        }

        pendingSelections[from] = {
          type: 'series',
          seriesName: seriesName,
          episodes: episodes,
          priority: priority
        };

        let seasonPrompt = `🎬 *${seriesName}* dizisi algılandı!\n📦 Toplam *${episodes.length}* bölüm bulundu.\n\n` +
          `Lütfen indirmek istediğiniz seçeneği yazın:\n\n` +
          `1️⃣ *Tüm Sezonu İndir* (Hepsini indirmek için: *hepsi* veya *1* yazın)\n` +
          `2️⃣ *Bölüm Aralığı İndir* (Örn: *10-20* veya *5-15* yazarak belirli bölümleri indirebilirsiniz)\n\n` +
          `❌ İptal etmek için *iptal* yazın.`;
        await sock.sendMessage(from, { text: seasonPrompt });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Dizi bölümleri alınırken hata oluştu: ${err.message}` });
      }
      return;
    }

    // HDKore Dizi kontrolü
    const isHdkoreSeriesCandidate = singleUrl.includes('hdkore') && (
      (singleUrl.includes('/dizi/') && !/\/bolum\//i.test(singleUrl)) ||
      (singleUrl.includes('/bolum/') && !/-\d+-bolum/i.test(singleUrl) && !/[?&]ep=/i.test(singleUrl))
    );

    if (isHdkoreSeriesCandidate) {
      const { getHdkoreSeasonEpisodes } = await import('../extractor.js');
      await sock.sendMessage(from, { text: '🔍 HDKore yayınlanan dizi bölümleri taranıyor...' });
      try {
        const { seriesName, episodes } = await getHdkoreSeasonEpisodes(singleUrl);

        if (!episodes || episodes.length === 0) {
          if (singleUrl.includes('/dizi/')) {
            await sock.sendMessage(from, { text: '❌ Bu dizide hiçbir bölüm bulunamadı.' });
            return;
          }
        } else if (episodes.length > 1 || singleUrl.includes('/dizi/')) {
          pendingSelections[from] = {
            type: 'series',
            source: 'hdkore',
            mergeBatchSize: 10,
            seriesName: seriesName,
            episodes: episodes,
            priority: priority
          };

          let seasonPrompt = `🎬 *${seriesName}* dizisi algılandı!\n📦 Toplam *${episodes.length}* bölüm bulundu.\n\n` +
            `Lütfen indirmek istediğiniz seçeneği yazın:\n\n` +
            `1️⃣ *Tüm Sezonu İndir* (Hepsini indirmek için: *hepsi* veya *1* yazın)\n` +
            `2️⃣ *Bölüm Aralığı İndir* (Örn: *10-20* veya *1-50* yazarak belirli bölümleri indirebilirsiniz)\n\n` +
            `ℹ️ _Bölümler 10'arlı paketler halinde birleştirilerek tek parça video olarak indirilecektir._\n` +
            `❌ İptal etmek için *iptal* yazın.`;
          await sock.sendMessage(from, { text: seasonPrompt });
          return;
        }
      } catch (err) {
        if (singleUrl.includes('/dizi/')) {
          await sock.sendMessage(from, { text: `❌ Dizi bölümleri alınırken hata oluştu: ${err.message}` });
          return;
        }
      }
    }

    // Dramadizilerim Dizi/Sezon kontrolü
    const isDramadizilerimSeries = isDramadizilerim && 
      (singleUrl.includes('/dizi/') || (!singleUrl.includes('&e=') && !singleUrl.includes('?e=')));

    if (isDramadizilerimSeries) {
      let targetDiziUrl = singleUrl;
      if (targetDiziUrl.includes('/izle/')) {
        targetDiziUrl = targetDiziUrl.replace('/izle/', '/dizi/');
      }
      
      const { getDramadizilerimSeasonEpisodes } = await import('../extractor.js');
      await sock.sendMessage(from, { text: '🔍 Dramadizilerim yayınlanan dizi bölümleri taranıyor...' });
      try {
        const { seriesName, episodes } = await getDramadizilerimSeasonEpisodes(targetDiziUrl);

        if (episodes.length === 0) {
          await sock.sendMessage(from, { text: '❌ Bu dizide hiçbir bölüm bulunamadı.' });
          return;
        }

        pendingSelections[from] = {
          type: 'series',
          source: 'dramadizilerim',
          mergeBatchSize: 10,
          seriesName: seriesName,
          episodes: episodes,
          priority: priority
        };

        let seasonPrompt = `🎬 *${seriesName}* dizisi algılandı!\n📦 Toplam *${episodes.length}* bölüm bulundu.\n\n` +
          `Lütfen indirmek istediğiniz seçeneği yazın:\n\n` +
          `1️⃣ *Tüm Sezonu İndir* (Hepsini indirmek için: *hepsi* veya *1* yazın)\n` +
          `2️⃣ *Bölüm Aralığı İndir* (Örn: *10-20* veya *1-50* yazarak belirli bölümleri indirebilirsiniz)\n\n` +
          `ℹ️ _Bölümler 10'arlı paketler halinde birleştirilerek tek parça video olarak indirilecektir._\n` +
          `❌ İptal etmek için *iptal* yazın.`;
        await sock.sendMessage(from, { text: seasonPrompt });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Dizi bölümleri alınırken hata oluştu: ${err.message}` });
      }
      return;
    }

    // Tekil Video / Link İndirme
    try {
      const isPlaylist = /[?&]list=/.test(singleUrl) && !/[?&]v=/.test(singleUrl);
      
      if (isYouTubeUrl && !isPlaylist && !isMp3Cmd) {
        const activeProxy = getProxyUrl();
        const proxyArg = activeProxy ? ` --proxy "${activeProxy}"` : '';
        const ytDlpCmd = getYtDlpCommand();

        exec(`"${ytDlpCmd}" ${proxyArg} -J --no-playlist "${singleUrl}"`, { maxBuffer: 10 * 1024 * 1024 }, async (err, stdout) => {
          let ytTitle = 'YouTube Video';
          let availableFormats = [];

          if (!err && stdout) {
            try {
              const info = JSON.parse(stdout);
              ytTitle = info.title || 'YouTube Video';
              const formats = info.formats || [];
              const targets = [
                { height: 1080, label: '1080p (FHD)' },
                { height: 720, label: '720p (HD)' },
                { height: 480, label: '480p (SD)' },
                { height: 360, label: '360p (Mobil)' }
              ];

              for (const target of targets) {
                const matched = formats.find(f => f.height === target.height && f.vcodec !== 'none');
                if (matched) {
                  const bytes = matched.filesize || matched.filesize_approx || 0;
                  const sizeStr = bytes > 0 ? ctx.formatBytes(bytes) : 'Bilinmiyor';
                  availableFormats.push({
                    format_id: matched.format_id,
                    label: `${target.label} [${sizeStr}]`,
                    height: target.height
                  });
                }
              }
            } catch (e) {}
          }

          if (availableFormats.length === 0) {
            availableFormats.push({
              format_id: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
              label: 'Varsayılan En İyi Kalite',
              height: 0
            });
          }

          availableFormats.push({
            format_id: 'mp3',
            label: '🎵 Sadece Ses (MP3 olarak indir)',
            height: -1
          });

          pendingSelections[from] = {
            url: singleUrl,
            title: ytTitle,
            formats: availableFormats
          };

          let optionsText = `🎬 *YOUTUBE KALİTE SEÇİMİ*\n\n🎥 *Video:* ${ytTitle}\n\nLütfen indirmek istediğiniz kaliteyi seçin:\n\n`;
          availableFormats.forEach((f, idx) => {
            optionsText += `${idx + 1}️⃣ ${f.label}\n`;
          });
          optionsText += `\n*Seçmek için bu mesaja doğrudan sadece seçeneğin numarasını (Ör: 1) yazarak yanıt verin.*`;

          await sock.sendMessage(from, { text: optionsText });
        });
        return;
      }

      const task = addDownloadTask(singleUrl, from, 'Video Çözümleniyor...', isMp3Cmd ? 'mp3' : null, priority);
      const priorityTag = priority ? '🔴 *ÖNCELİKLİ* ' : '';
      await sock.sendMessage(from, { text: `📥 ${priorityTag}Görev Sıraya Eklendi!\n🎬 *Link:* ${singleUrl}\n🆔 *Görev Numarası:* \`${task.id}\`\n\nKuyruk durumu: \`!kuyruk\`\nİptal etmek için: \`!iptal ${task.id}\`` });
    } catch (err) {
      await sock.sendMessage(from, { text: `⚠️ *Hata:* ${err.message}` });
    }
  }
};
