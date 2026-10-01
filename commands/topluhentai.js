import { readConfig } from '../config.js';
import { addDownloadTask } from '../queue.js';
import { extractHentaizmListingPage, cleanHentaizmTitle } from '../extractors/hentaizm.js';

export default {
  name: 'topluhentai',
  aliases: ['hentaitoplu', 'toplu-hentai', 'hentai-toplu', 'hentailiste', 'hentaitoplulink'],
  async execute(sock, msg, from, args, ctx) {
    const config = readConfig();
    const targetJid = config.hentaiGroupJid || from;
    const text = ctx.text || '';

    // Extract all URLs from the message
    const allUrls = text.match(/https?:\/\/[^\s]+/gi) || [];
    const hentaizmUrls = allUrls.filter(u => u.includes('hentaizm'));

    if (hentaizmUrls.length === 0) {
      const helpText = `🔞 *TOPLU HENTAİ İNDİRME SİSTEMİ*\n\n` +
        `Bu komut ile tek seferde onlarca hentai serisini (tüm bölümleri ve kapak resimleriyle) kuyruğa ekleyebilirsiniz.\n\n` +
        `📌 *1. Liste / Favori / Kategori Sayfasından Toplu Ekleme:*\n` +
        `\`!topluhentai https://www.hentaizm2.com/?tab=fav&page=1\`\n` +
        `\`!topluhentai https://www.hentaizm2.com/?tab=fav 1-3\` _(1 ile 3. sayfalar arası)_\n` +
        `\`!topluhentai https://www.hentaizm2.com/hentai-listesi 1-2\`\n\n` +
        `📌 *2. Birden Fazla Anime Linkini Alt Alta Yapıştırarak:*\n` +
        `\`!topluhentai\`\n` +
        `https://www.hentaizm2.com/anime/seri-1\n` +
        `https://www.hentaizm2.com/anime/seri-2\n` +
        `https://www.hentaizm2.com/anime/seri-3\n\n` +
        `🎯 *Mevcut Hedef Grubu:* ${config.hentaiGroupJid ? `\`${config.hentaiGroupJid}\`` : '_Ayarlanmamış (bu sohbete gelir)_'}\n` +
        `_(Hedef grubu değiştirmek için: \`!hentaigrup burası\`)_`;
      await sock.sendMessage(from, { text: helpText });
      return;
    }

    const isPriority = text.includes('--oncelikli') || text.includes('--öncelikli');

    // Case 1: First URL is a listing / archive / category / favorites page
    const firstUrl = hentaizmUrls[0];
    const isListingPage = firstUrl.includes('?tab=') || 
                          firstUrl.includes('tab=fav') || 
                          firstUrl.includes('/hentai-listesi') || 
                          firstUrl.includes('/kategori/') || 
                          firstUrl.includes('/etiket/') || 
                          firstUrl.includes('/arsiv/') ||
                          firstUrl.includes('/ara?') ||
                          firstUrl.includes('/page=') ||
                          firstUrl.includes('?page=');

    if (isListingPage && hentaizmUrls.length === 1) {
      // Check for page range, e.g. `1-3` or `1 3` or `2`
      let startPage = 1;
      let endPage = 1;

      // Check URL query param page
      try {
        const u = new URL(firstUrl);
        const pParam = u.searchParams.get('page');
        if (pParam && !isNaN(parseInt(pParam, 10))) {
          startPage = parseInt(pParam, 10);
          endPage = startPage;
        }
      } catch (e) {}

      // Check text for page range argument (e.g. `1-3`, `1 5`, `sayfa:1-3`)
      const nonUrlText = text.replace(firstUrl, '').replace(/!topluhentai|!hentaitoplu|--oncelikli|--öncelikli/gi, '').trim();
      const rangeMatch = nonUrlText.match(/(\d+)\s*[-to–—]\s*(\d+)/i) || nonUrlText.match(/(\d+)\s+(\d+)/);
      const singlePageMatch = nonUrlText.match(/(\d+)/);

      if (rangeMatch) {
        startPage = parseInt(rangeMatch[1], 10);
        endPage = parseInt(rangeMatch[2], 10);
      } else if (singlePageMatch && !firstUrl.includes('page=')) {
        startPage = 1;
        endPage = parseInt(singlePageMatch[1], 10);
      }

      try {
        const { pageTitle, animeList } = await extractHentaizmListingPage(firstUrl, startPage, endPage);

        if (!animeList || animeList.length === 0) {
          await sock.sendMessage(from, { text: `❌ Sayfada anime bulunamadı veya oturum gerekiyor.\nEğer giriş gerekiyorsa önce bir anime linki atıp gelen güvenlik kodunu yazın.` });
          return;
        }

        let addedCount = 0;
        let skippedCount = 0;

        for (const anime of animeList) {
          try {
            addDownloadTask(
              anime.url,
              targetJid,
              `🔞 ${anime.title} (Paket)`,
              null,
              isPriority,
              null,
              null,
              {
                type: 'hentai_pack',
                seriesName: anime.title,
                posterUrl: anime.posterUrl,
                episodes: [], // will be lazily fetched when task starts
                replyJid: from
              }
            );
            addedCount++;
          } catch (e) {
            skippedCount++;
          }
        }

        let successMsg = `✅ *Toplu Hentai Paketi Kuyruğa Eklendi!*\n\n` +
          `📑 *Liste:* ${pageTitle}\n` +
          `📦 *Eklenen Anime Serisi:* *${addedCount}* adet\n`;
        if (skippedCount > 0) {
          successMsg += `⚠️ *Atlanan (Zaten kuyrukta):* ${skippedCount} adet\n`;
        }
        if (targetJid !== from) {
          successMsg += `🎯 *Hedef Grup:* \`${targetJid}\`\n`;
        }
        successMsg += `\n_Her animenin tüm bölümleri sunucuya indirildikten sonra kapak resmi ve isim bilgisiyle topluca gönderilecektir._\n` +
          `Sırayı görmek için: \`!kuyruk\``;

        await sock.sendMessage(from, { text: successMsg });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Liste taranırken hata oluştu: ${err.message}` });
      }
      return;
    }

    // Case 2: Multiple individual anime links
    const animeUrls = hentaizmUrls.filter(u => u.includes('/anime/') || (!u.includes('/izle/') && !u.includes('/manga/')));
    const directWatchUrls = hentaizmUrls.filter(u => u.includes('/izle/'));

    let addedCount = 0;
    let skippedCount = 0;

    // Queue anime series packs
    for (const u of animeUrls) {
      try {
        const uObj = new URL(u);
        const slug = uObj.pathname.split('/').filter(Boolean)[1] || 'Hentai Seri';
        const rawTitle = slug.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        addDownloadTask(
          u,
          targetJid,
          `🔞 ${rawTitle} (Paket)`,
          null,
          isPriority,
          null,
          null,
          {
            type: 'hentai_pack',
            seriesName: rawTitle,
            posterUrl: null,
            episodes: [],
            replyJid: from
          }
        );
        addedCount++;
      } catch (e) {
        skippedCount++;
      }
    }

    // Queue individual episode watch URLs
    for (const u of directWatchUrls) {
      try {
        addDownloadTask(u, targetJid, 'Video Çözümleniyor...', null, isPriority);
        addedCount++;
      } catch (e) {
        skippedCount++;
      }
    }

    let summaryMsg = `✅ *Toplu Hentai Kuyruğa Eklendi!*\n\n` +
      `📦 *Eklenen Toplam:* *${addedCount}* adet seri/bölüm\n`;
    if (skippedCount > 0) {
      summaryMsg += `⚠️ *Atlanan (Zaten kuyrukta):* ${skippedCount} adet\n`;
    }
    if (targetJid !== from) {
      summaryMsg += `🎯 *Hedef Grup:* \`${targetJid}\`\n`;
    }
    summaryMsg += `\nSırayı görmek için: \`!kuyruk\``;

    await sock.sendMessage(from, { text: summaryMsg });
  }
};
