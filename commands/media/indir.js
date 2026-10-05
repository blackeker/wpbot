import { exec } from 'child_process';
import { addDownloadTask, pendingSelections, setPendingSelection } from '../../queue.js';
import { getYtDlpCommand, getProxyUrl } from '../../config.js';
import { probeMediaAudioOptions } from '../../extractor.js';

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
    const burnSubtitles = parts.includes('--hardsub') || parts.includes('--gomulu') || parts.includes('--gömülü');
    let urls = parts.filter(p => p.startsWith('http://') || p.startsWith('https://') || p.startsWith('magnet:'));
    if (urls.length === 0) {
      await sock.sendMessage(from, { text: 'Lütfen geçerli bir link belirtin. Örnek: `!indir https://animecix.net/...`' });
      return;
    }

    // Check if arguments specify an episode range (e.g. `!indir <url> 10 15`, `!indir <url> 10-15`, `!indir <url> 50+`, `!indir <url> 50 son`, `!indir <url_230> 244`)
    let numRange = null;
    const nonUrlParts = parts.filter(p => !p.startsWith('http://') && !p.startsWith('https://') && !p.startsWith('magnet:') && !p.startsWith('!') && !p.startsWith('--'));
    const joinedNonUrls = nonUrlParts.join(' ').trim();
    const rangeMatch = joinedNonUrls.match(/^(\d+(?:\.\d+)?)\s*[-to–—]\s*(\d+(?:\.\d+)?)$/i) || joinedNonUrls.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
    const plusMatch = joinedNonUrls.match(/^(\d+(?:\.\d+)?)\s*(?:\+|son|sonrasi|sonrası|-)$/i);
    const singleNumMatch = joinedNonUrls.match(/^(\d+(?:\.\d+)?)$/);

    if (rangeMatch) {
      numRange = {
        start: parseFloat(rangeMatch[1]),
        end: parseFloat(rangeMatch[2])
      };
    } else if (plusMatch) {
      numRange = {
        start: parseFloat(plusMatch[1]),
        end: Infinity
      };
    } else if (singleNumMatch && urls.length === 1) {
      const targetNum = parseFloat(singleNumMatch[1]);
      const urlEpMatch = urls[0].match(/(?:bolum|bölüm|episode|chapter|sezon-\d+-bolum)[/-](\d+(?:\.\d+)?)/i);
      if (urlEpMatch) {
        const urlNum = parseFloat(urlEpMatch[1]);
        numRange = {
          start: Math.min(urlNum, targetNum),
          end: Math.max(urlNum, targetNum)
        };
      } else {
        numRange = {
          start: targetNum,
          end: Infinity
        };
      }
    }

    const supportedDomains = [
      'hdfilmcehennemi', 'animecix', 'ecchicix', 'hentaizm', 'mangaportali', 'mangadenizi', 'mangatr', 'asurascans', 'webtoontr', 'merlinscans',
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
              const { resolveAnimecixSlug } = await import('../../extractor.js');
              titleId = await resolveAnimecixSlug(slug, host);
            }
            if (titleId) {
              const { gotScraping } = await import('../../extractor.js');
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
          replyMsg += `\n\n_Her paket 10 bölümü bir klasörde toplayıp ZIP arşivi olarak gönderecektir._`;
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

          const sNum = startEp;
          const eNum = endEp;
          const bTitle = sNum === eNum ? `DramaDizilerim - Bölüm ${sNum}` : `DramaDizilerim - Bölüm ${sNum}-${eNum}`;
          const bUrl = `${allEps[0].url}#batch=${sNum}-${eNum}`;

          addDownloadTask(bUrl, from, bTitle, null, priority, null, allEps);

          let replyMsg = `✅ Toplam *${allEps.length}* bölüm tek bir ZIP paketi olarak başarıyla sıraya eklendi.`;
          if (priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
          replyMsg += `\n\n_Tüm bölümler tek klasörde toplanıp ZIP arşivi olarak gönderilecektir._`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }

      // MangaPortalı 2 link aralığı
      if (urls[0].includes('mangaportali.com') && urls[1].includes('mangaportali.com')) {
        const match1 = urls[0].match(/bolum-(\d+(?:\.\d+)?)/i);
        const match2 = urls[1].match(/bolum-(\d+(?:\.\d+)?)/i);
        const startEp = match1 && match2 ? Math.min(parseFloat(match1[1]), parseFloat(match2[1])) : 1;
        const endEp = match1 && match2 ? Math.max(parseFloat(match1[1]), parseFloat(match2[1])) : Infinity;

        const { getMangaPortaliChapters } = await import('../../extractors/mangaportali.js');
        const { seriesTitle, chapters } = await getMangaPortaliChapters(urls[0]);
        const targetChapters = chapters.filter(c => c.number !== null && c.number >= startEp && c.number <= endEp);

        if (targetChapters.length > 0) {
          await sock.sendMessage(from, { text: `📚 *${seriesTitle || 'MangaPortalı'} Toplu İndirme!*\nBölüm Aralığı: ${startEp} - ${endEp === Infinity ? 'Son' : endEp}\nToplam *${targetChapters.length}* bölüm PDF olarak sıraya ekleniyor...` });

          let addedCount = 0;
          for (const chap of targetChapters) {
            try {
              addDownloadTask(chap.url, from, chap.title, null, priority);
              addedCount++;
            } catch (e) {}
          }
          await sock.sendMessage(from, { text: `✅ *${addedCount}* manga bölümü başarıyla sıraya eklendi!\nKuyruk durumu için: \`!kuyruk\`` });
          return;
        }
      }
    }

    // ─── Tek Link + Sayısal Bölüm Aralığı (Örn: !indir <url> 10 15, 10-15 veya 50+) ───
    if (urls.length === 1 && numRange) {
      if (urls[0].includes('mangaportali.com')) {
        const startEp = Math.min(numRange.start, numRange.end);
        const endEp = Math.max(numRange.start, numRange.end);

        const { getMangaPortaliChapters } = await import('../../extractors/mangaportali.js');
        const { seriesTitle, chapters } = await getMangaPortaliChapters(urls[0]);
        const targetChapters = chapters.filter(c => c.number !== null && c.number >= startEp && (endEp === Infinity || c.number <= endEp));

        if (targetChapters.length > 0) {
          const endLabel = endEp === Infinity ? 'Son' : endEp;
          await sock.sendMessage(from, { text: `📚 *${seriesTitle || 'MangaPortalı'} Toplu İndirme!*\nBölüm Aralığı: ${startEp} - ${endLabel}\nToplam *${targetChapters.length}* bölüm PDF olarak sıraya ekleniyor...` });

          let addedCount = 0;
          for (const chap of targetChapters) {
            try {
              addDownloadTask(chap.url, from, chap.title, null, priority);
              addedCount++;
            } catch (e) {}
          }
          await sock.sendMessage(from, { text: `✅ *${addedCount}* manga bölümü başarıyla sıraya eklendi!\nKuyruk durumu için: \`!kuyruk\`` });
          return;
        } else {
          await sock.sendMessage(from, { text: `⚠️ Belirtilen aralıkta (${startEp} - ${endEp === Infinity ? 'Son' : endEp}) bölüm bulunamadı.` });
          return;
        }
      }

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
              const { resolveAnimecixSlug } = await import('../../extractor.js');
              titleId = await resolveAnimecixSlug(slug, host);
            }
            if (titleId) {
              const { gotScraping } = await import('../../extractor.js');
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
    const isMangaUrl = /mangaportali|mangadenizi|mangatr|asurascans|asuracomic|webtoontr|merlinscans|merlintoon/i.test(singleUrl);

    if (!singleUrl.includes('hdfilmcehennemi') && !isAnimecix && !isYouTubeUrl && !isHentaizm && !isPornhub && !isDoeda && !isHdabla && !isHdkore && !isTurkifsahub && !isTurkifsalar && !isTurkporno && !isCloudMailRu && !isInstagramUrl && !isTikTokUrl && !isYandexUrl && !isGDriveUrl && !isMegaUrl && !isYabancidiziUrl && !isSezonlukdiziUrl && !isTeraboxUrl && !isLiteapksUrl && !isModyoloUrl && !isDiziSitesiUrl && !isTorrentUrl && !isDramadizilerim && !isMangaUrl) {
      await sock.sendMessage(from, { text: 'Lütfen geçerli bir desteklenen medya linki gönderin.' });
      return;
    }

    // Animecix Sezon/Dizi kontrolü
    const isAnimecixSingleEp = singleUrl.includes('/episode/') || singleUrl.includes('/bolum/') || singleUrl.includes('/bölüm/');
    const isAnimecixSeasonOrShow = isAnimecix && !isAnimecixSingleEp;

    if (isAnimecixSeasonOrShow) {
      const { getAnimecixSeasonEpisodes } = await import('../../extractor.js');
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
          setPendingSelection(from, {
            type: 'multi_season',
            seriesName: animeName,
            seasons: seasons,
            allEpisodes: episodes,
            priority: priority
          });

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

        setPendingSelection(from, {
          type: 'series',
          seriesName: animeName,
          episodes: episodes,
          priority: priority
        });

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
      const { getHentaizmSeasonEpisodes } = await import('../../extractor.js');
      try {
        const { seriesName, posterUrl, description, episodes } = await getHentaizmSeasonEpisodes(singleUrl);

        if (!episodes || episodes.length === 0) {
          await sock.sendMessage(from, { text: '❌ Bu animede hiçbir bölüm bulunamadı.' });
          return;
        }

        const config = (await import('../../config.js')).readConfig();
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
      const { getHdfilmcehennemiSeasonEpisodes } = await import('../../extractor.js');
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
      const { getHdkoreSeasonEpisodes } = await import('../../extractor.js');
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
      
      const { getDramadizilerimSeasonEpisodes } = await import('../../extractor.js');
      try {
        const { seriesName, episodes } = await getDramadizilerimSeasonEpisodes(targetDiziUrl);

        if (episodes.length === 0) {
          await sock.sendMessage(from, { text: '❌ Bu dizide hiçbir bölüm bulunamadı.' });
          return;
        }

        const wantsAll = nonUrlParts.some(p => ['hepsi', 'tümü', 'tumu', 'all', 'full', 'oto', 'tamamı'].includes(p.toLowerCase()));

        if (wantsAll || numRange) {
          let selectedEpisodes = episodes;
          let label = 'Tüm Bölümler';
          if (numRange) {
            const startEp = Math.min(numRange.start, numRange.end);
            const endEp = Math.max(numRange.start, numRange.end);
            selectedEpisodes = episodes.filter(ep => {
              const n = parseInt(ep.episode, 10);
              return n >= startEp && n <= endEp;
            });
            label = `Bölüm ${startEp}-${endEp}`;
          }

          if (selectedEpisodes.length > 0) {
            const sNum = selectedEpisodes[0].episode;
            const eNum = selectedEpisodes[selectedEpisodes.length - 1].episode;
            const bTitle = sNum === eNum ? `${seriesName} - Bölüm ${sNum}` : `${seriesName} - Bölüm ${sNum}-${eNum}`;
            const bUrl = `${selectedEpisodes[0].url}#batch=${sNum}-${eNum}`;

            addDownloadTask(bUrl, from, bTitle, null, priority, null, selectedEpisodes);

            let replyMsg = `🎬 *${seriesName}* - *${label}*\n` +
              `📦 Toplam *${selectedEpisodes.length}* bölüm tek bir ZIP paketi olarak başarıyla sıraya eklendi.\n\n` +
              `_Tüm bölümler indirilip tek klasörde toplanacak ve ZIP arşivi olarak gönderilecektir._\n` +
              `Sırayı görmek için: \`!kuyruk\``;
            await sock.sendMessage(from, { text: replyMsg });
            return;
          }
        }

        pendingSelections[from] = {
          type: 'series',
          source: 'dramadizilerim',
          mergeBatchSize: episodes.length,
          seriesName: seriesName,
          episodes: episodes,
          priority: priority
        };

        let seasonPrompt = `🎬 *${seriesName}* dizisi algılandı!\n📦 Toplam *${episodes.length}* bölüm bulundu.\n\n` +
          `Lütfen indirmek istediğiniz seçeneği yazın:\n\n` +
          `1️⃣ *Tüm Sezonu İndir* (Hepsini tek ZIP olarak indirmek için: *hepsi* veya *1* yazın)\n` +
          `2️⃣ *Bölüm Aralığı İndir* (Örn: *10-20* veya *1-50* yazarak belirli bölümleri tek ZIP olarak indirebilirsiniz)\n\n` +
          `ℹ️ _Seçtiğiniz tüm bölümler tek bir klasörde toplanıp tek ZIP arşivi olarak indirilecektir._\n` +
          `❌ İptal etmek için *iptal* yazın.`;
        await sock.sendMessage(from, { text: seasonPrompt });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Dizi bölümleri alınırken hata oluştu: ${err.message}` });
      }
      return;
    }

    // Tekil Video / Link İndirme
    try {
      const isPlaylist = /[?&]list=([a-zA-Z0-9_-]+)/i.test(singleUrl);

      // ── YouTube Playlist Desteği ──
      if (isYouTubeUrl && isPlaylist) {
        const { getYouTubePlaylistVideos } = await import('../../extractor.js');
        try {
          const { playlistTitle, videos } = await getYouTubePlaylistVideos(singleUrl);
          if (!videos || videos.length === 0) {
            await sock.sendMessage(from, { text: '❌ Bu oynatma listesinde video bulunamadı veya liste gizli/boş.' });
            return;
          }

          // Direct auto-download if user specified 'hepsi', 'tümü', 'full', 'all', 'oto'
          const wantsAll = nonUrlParts.some(p => ['hepsi', 'tümü', 'tumu', 'all', 'full', 'oto', 'tamamı'].includes(p.toLowerCase()));
          if (wantsAll) {
            const formatLabel = isMp3Cmd ? '🎵 MP3 (Ses)' : '🎬 MP4 (Video)';
            await sock.sendMessage(from, {
              text: `🎵 *${playlistTitle}*\n📦 Toplam *${videos.length}* video doğrudan sıraya ekleniyor...\nFormat: ${formatLabel}`
            });
            let addedCount = 0;
            let skipCount = 0;
            for (const v of videos) {
              try {
                addDownloadTask(v.url, from, `${playlistTitle} - ${v.number}. ${v.title}`, isMp3Cmd ? 'mp3' : null, priority);
                addedCount++;
              } catch (e) {
                skipCount++;
              }
            }
            let replyMsg = `✅ Toplam *${addedCount}* video başarıyla sıraya eklendi.`;
            if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
            if (priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
            replyMsg += `\n\nSırayı görmek için: \`!kuyruk\``;
            await sock.sendMessage(from, { text: replyMsg });
            return;
          }

          // Direct auto-download if user specified a range like "1-12"
          if (numRange) {
            const rangeVideos = videos.filter(v => v.number >= numRange.start && v.number <= numRange.end);
            if (rangeVideos.length > 0) {
              const formatLabel = isMp3Cmd ? '🎵 MP3 (Ses)' : '🎬 MP4 (Video)';
              await sock.sendMessage(from, {
                text: `🎵 *${playlistTitle}* - Video ${numRange.start}-${numRange.end}\n📦 Toplam *${rangeVideos.length}* video sıraya ekleniyor...\nFormat: ${formatLabel}`
              });
              let addedCount = 0;
              for (const v of rangeVideos) {
                try {
                  addDownloadTask(v.url, from, `${playlistTitle} - ${v.number}. ${v.title}`, isMp3Cmd ? 'mp3' : null, priority);
                  addedCount++;
                } catch (e) {}
              }
              await sock.sendMessage(from, { text: `✅ Toplam *${addedCount}* video başarıyla sıraya eklendi.\nSırayı görmek için: \`!kuyruk\`` });
              return;
            }
          }

          pendingSelections[from] = {
            type: 'youtube_playlist',
            playlistTitle,
            videos,
            isMp3: isMp3Cmd,
            priority
          };

          const formatLabel = isMp3Cmd ? '🎵 *Format:* MP3 (Ses Dosyası)' : '🎬 *Format:* MP4 (Video)';
          let prompt = `🎵 *${playlistTitle}* (YouTube Oynatma Listesi)\n` +
            `📦 Toplam *${videos.length}* video bulundu.\n` +
            `${formatLabel}\n\n` +
            `Lütfen indirmek istediğiniz seçeneği yazın:\n\n` +
            `1️⃣ *Tüm Oynatma Listesini İndir:* *hepsi* (veya *1*)\n` +
            `2️⃣ *Video Aralığı İndir:* *başlangıç-bitiş* (Örn: *1-10* veya *5-25*)\n` +
            `3️⃣ *Tek Video İndir:* Sadece video numarasını yazın (Örn: *5*)\n\n` +
            `❌ İptal etmek için: *iptal*`;

          await sock.sendMessage(from, { text: prompt });
          return;
        } catch (err) {
          await sock.sendMessage(from, { text: `❌ YouTube oynatma listesi alınırken hata oluştu: ${err.message}` });
          return;
        }
      }
      
      if (isYouTubeUrl && !isMp3Cmd) {
        const activeProxy = getProxyUrl();
        const proxyArg = activeProxy ? ` --proxy "${activeProxy}"` : '';
        const ytDlpCmd = getYtDlpCommand();

        exec(`"${ytDlpCmd}" ${proxyArg} -J --no-playlist "${singleUrl}"`, { maxBuffer: 15 * 1024 * 1024 }, async (err, stdout) => {
          let ytTitle = 'YouTube Video';
          let availableFormats = [];

          if (!err && stdout) {
            try {
              const info = JSON.parse(stdout);
              ytTitle = (info.title || 'YouTube Video').replace(/[\r\n]+/g, ' ').trim();
              const formats = info.formats || [];
              const duration = info.duration || 0;

              // En yüksek ses akışının boyutunu veya süreden yaklaşık ses boyutunu hesapla
              const audioFormats = formats.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
              const bestAudioSize = audioFormats.reduce((max, f) => {
                const sz = f.filesize || f.filesize_approx || 0;
                return sz > max ? sz : max;
              }, 0);
              const approxAudioBytes = bestAudioSize > 0 ? bestAudioSize : (duration > 0 ? Math.round((128 * 1024 / 8) * duration) : 0);

              // Standart çözünürlük seviyeleri eşleyici
              const getStandardTier = (h) => {
                if (h >= 3800) return { tier: 4320, name: '8K (4320p)' };
                if (h >= 2000) return { tier: 2160, name: '4K (2160p)' };
                if (h >= 1350) return { tier: 1440, name: '2K (1440p)' };
                if (h >= 950)  return { tier: 1080, name: '1080p (FHD)' };
                if (h >= 650)  return { tier: 720,  name: '720p (HD)' };
                if (h >= 440)  return { tier: 480,  name: '480p (SD)' };
                if (h >= 320)  return { tier: 360,  name: '360p (Mobil)' };
                if (h >= 200)  return { tier: 240,  name: '240p' };
                return { tier: 144, name: '144p' };
              };

              const videoFormats = formats.filter(f => f.vcodec && f.vcodec !== 'none');
              const tierMap = new Map();

              for (const f of videoFormats) {
                // Hem yatay hem dikey (Shorts) videolar için gerçek çözünürlük kenarı
                const effectiveHeight = (f.height && f.width) ? Math.min(f.height, f.width) : (f.height || 0);
                if (!effectiveHeight || effectiveHeight <= 0) continue;

                const { tier, name } = getStandardTier(effectiveHeight);
                const fps = f.fps || 0;
                const is60 = fps >= 50;
                const isHdr = f.dynamic_range && /hdr/i.test(f.dynamic_range);

                if (!tierMap.has(tier)) {
                  tierMap.set(tier, {
                    tier,
                    name,
                    bestFormat: f,
                    has60fps: is60,
                    isHdr: isHdr
                  });
                } else {
                  const entry = tierMap.get(tier);
                  if (is60) entry.has60fps = true;
                  if (isHdr) entry.isHdr = true;
                  const currentBest = entry.bestFormat;
                  const currentScore = (currentBest.ext === 'mp4' ? 100000 : 0) + (currentBest.tbr || 0);
                  const newScore = (f.ext === 'mp4' ? 100000 : 0) + (f.tbr || 0);
                  if (newScore > currentScore) {
                    entry.bestFormat = f;
                  }
                }
              }

              const sortedTiers = Array.from(tierMap.keys()).sort((a, b) => b - a);

              for (const t of sortedTiers) {
                const entry = tierMap.get(t);
                const bf = entry.bestFormat;

                let label = entry.name;
                if (entry.has60fps && t >= 720) {
                  label = label.replace(/\b(1080p|720p|1440p|2160p|4K|2K)\b/, '$1 60fps');
                }
                if (entry.isHdr) label += ' HDR';

                let videoBytes = bf.filesize || bf.filesize_approx || 0;
                if (!videoBytes && bf.tbr && duration) {
                  videoBytes = Math.round((bf.tbr * 1024 / 8) * duration);
                }
                const totalBytes = videoBytes > 0 ? (videoBytes + approxAudioBytes) : 0;
                const sizeStr = totalBytes > 0 ? ctx.formatBytes(totalBytes) : (videoBytes > 0 ? `~${ctx.formatBytes(videoBytes)}` : 'Boyut bilinmiyor');

                availableFormats.push({
                  format_id: `bestvideo[vcodec^=avc][height<=${t}]+bestaudio[acodec^=mp4a]/bestvideo[height<=${t}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${t}]+bestaudio/best[height<=${t}]`,
                  label: `${label} [${sizeStr}]`,
                  height: t
                });
              }
            } catch (e) {
              console.error('[YouTube Quality Parse Error]:', e.message);
            }
          }

          if (availableFormats.length === 0) {
            availableFormats.push({
              format_id: 'bestvideo[vcodec^=avc][ext=mp4]+bestaudio[acodec^=mp4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
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

          const numEmoji = (idx) => {
            const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
            return emojis[idx] || `[${idx + 1}]`;
          };

          let optionsText = `🎬 *YOUTUBE KALİTE SEÇİMİ*\n\n🎥 *Video:* ${ytTitle}\n\nLütfen indirmek istediğiniz kaliteyi seçin:\n\n`;
          availableFormats.forEach((f, idx) => {
            optionsText += `${numEmoji(idx)} ${f.label}\n`;
          });
          optionsText += `\n*Seçmek için bu mesaja doğrudan seçeneğin numarasını (Ör: 1) yazarak yanıt verin.*`;

          await sock.sendMessage(from, { text: optionsText });
        });
        return;
      }

      // Check if user gave an explicit audio preference (e.g. `!indir <url> dublaj` or `tr` or `altyazi` or `dual`)
      let explicitAudio = null;
      for (const p of nonUrlParts) {
        const lp = p.toLowerCase();
        if (['dublaj', 'tr', 'turkce', 'türkçe', 'tur'].includes(lp)) {
          explicitAudio = 'tr';
          break;
        } else if (['altyazi', 'altyazı', 'altyazili', 'altyazılı', 'orijinal', 'original', 'orig', 'en', 'eng'].includes(lp)) {
          explicitAudio = 'orig';
          break;
        } else if (['dual', 'cift', 'çift', 'ikisi'].includes(lp)) {
          explicitAudio = 'dual';
          break;
        }
      }

      const isAudioCheckable = !isMp3Cmd && (
        singleUrl.includes('hdfilmcehennemi') ||
        singleUrl.includes('filmmodu') ||
        singleUrl.includes('filmmakinesi') ||
        singleUrl.includes('fullhdfilmizlesene') ||
        singleUrl.includes('dizipal') ||
        singleUrl.includes('yabancidizi') ||
        singleUrl.includes('sezonlukdizi') ||
        singleUrl.includes('dizigom') ||
        singleUrl.includes('dizibox') ||
        singleUrl.includes('.m3u8')
      );

      if (isAudioCheckable && !explicitAudio) {
        try {
          const probe = await probeMediaAudioOptions(singleUrl);
          if (probe && probe.hasMultipleAudios && probe.availableAudios && probe.availableAudios.length > 1) {
            pendingSelections[from] = {
              type: 'audio_selection',
              url: singleUrl,
              title: probe.title || 'Film/Video',
              availableAudios: probe.availableAudios,
              priority: priority,
              burnSubtitles: burnSubtitles
            };

            const numEmoji = (idx) => {
              const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
              return emojis[idx] || `[${idx + 1}]`;
            };

            let optionsText = `🎬 *${probe.title}*\n\n🔊 *Birden fazla ses seçeneği bulundu!*\nLütfen indirmek istediğiniz ses formatını seçin:\n\n`;
            probe.availableAudios.forEach((a, idx) => {
              optionsText += `${numEmoji(idx)} *${a.label}*${a.description ? ` - ${a.description}` : ''}\n`;
            });
            optionsText += `\n*Seçmek için bu mesaja doğrudan seçeneğin numarasını (Ör: 1) veya adını (dublaj, altyazı, dual) yazarak yanıt verin.*`;
            optionsText += `\n❌ İptal etmek için: *iptal*`;

            await sock.sendMessage(from, { text: optionsText });
            return;
          }
        } catch (probeErr) {
          console.warn('[indir.js] Audio probe failed, continuing standard download:', probeErr.message);
        }
      }

      const task = addDownloadTask(singleUrl, from, 'Video Çözümleniyor...', isMp3Cmd ? 'mp3' : null, priority, null, null, null, explicitAudio, burnSubtitles);
      const priorityTag = priority ? '🔴 *ÖNCELİKLİ* ' : '';
      let audioNote = '';
      if (explicitAudio) {
        const audioName = explicitAudio === 'tr' ? 'Türkçe Dublaj' : (explicitAudio === 'orig' ? 'Orijinal / Altyazılı' : 'Dual Ses');
        audioNote = `\n🔊 *Seçilen Ses:* ${audioName}`;
      }
      const hardsubNote = burnSubtitles ? '\n✍️ *Altyazı:* Videoya kalıcı gömülecek (Hardsub)' : '';
      await sock.sendMessage(from, { text: `📥 ${priorityTag}Görev Sıraya Eklendi!\n🎬 *Link:* ${singleUrl}${audioNote}${hardsubNote}\n🆔 *Görev Numarası:* \`${task.id}\`\n\nKuyruk durumu: \`!kuyruk\`\nİptal etmek için: \`!iptal ${task.id}\`` });
    } catch (err) {
      await sock.sendMessage(from, { text: `⚠️ *Hata:* ${err.message}` });
    }
  }
};
