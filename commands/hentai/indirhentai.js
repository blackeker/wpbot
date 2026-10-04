import { readConfig } from "../../config.js";
import { addDownloadTask } from "../../queue.js";
import { extractHentaizmListingPage } from "../../extractor.js";
import { hentaiFavStore } from "../../utils/hentaiFavStore.js";

export default {
  name: "indirhentai",
  aliases: ["hentaiindir", "hentaipack", "hentaicek", "indir-hentai", "hentai-indir"],
  async execute(sock, msg, from, args, ctx) {
    if (!args || args.length === 0) {
      await sock.sendMessage(from, {
        text: `⚠️ *Kullanım:* \`indirhentai <numara>\`\n\n` +
              `Örnekler:\n` +
              `👉 \`indirhentai 12\` _(12 numaralı seriyi indirir)_\n` +
              `👉 \`indirhentai 1, 3, 5\` _(Birden fazla seriyi indirir)_\n` +
              `👉 \`indirhentai 1-4\` _(1'den 4'e kadar serileri indirir)_\n` +
              `👉 \`indirhentai 12 acil\` _(Kuyruğun en başına alır)_\n\n` +
              `📋 *Favori listesini görmek için:* \`hentaizmfav\``
      });
      return;
    }

    const config = readConfig();
    const targetJid = config.hentaiGroupJid || config.depotGroupJid || from;
    const isTargetGroup = targetJid.endsWith('@g.us');

    // Check for priority keywords
    const priorityKeywords = ['öncelik', 'oncelik', 'acil', 'priority', 'p'];
    const isPriority = args.some(a => priorityKeywords.includes(a.toLowerCase().replace(/[^a-zöçşığü]/g, '')));

    const cleanArgs = args.filter(a => !priorityKeywords.includes(a.toLowerCase().replace(/[^a-zöçşığü]/g, '')));
    const inputStr = cleanArgs.join(' ');

    const requestedNumbers = new Set();
    const directUrls = [];

    // Parse direct URLs
    const urlMatches = inputStr.match(/https?:\/\/[^\s"',]+/gi) || [];
    for (const u of urlMatches) {
      if (u.includes('hentaizm')) {
        directUrls.push(u);
      }
    }

    // Parse ranges like 1-5 or 1..5
    const rangeMatches = inputStr.matchAll(/(\d+)\s*[-..–—]\s*(\d+)/g);
    for (const rm of rangeMatches) {
      const s = parseInt(rm[1], 10);
      const e = parseInt(rm[2], 10);
      const min = Math.min(s, e);
      const max = Math.max(s, e);
      for (let i = min; i <= max; i++) {
        requestedNumbers.add(i);
      }
    }

    // Parse individual numbers like 1, 2, 12
    const numTokens = inputStr.replace(/https?:\/\/[^\s"',]+/gi, '').replace(/\d+\s*[-..–—]\s*\d+/g, '').match(/\d+/g) || [];
    for (const t of numTokens) {
      const n = parseInt(t, 10);
      if (!isNaN(n)) requestedNumbers.add(n);
    }

    if (requestedNumbers.size === 0 && directUrls.length === 0) {
      await sock.sendMessage(from, {
        text: `⚠️ Geçerli bir anime numarası veya linki bulunamadı.\nÖrnek: \`indirhentai 12\``
      });
      return;
    }

    // If numbers requested but store is empty, auto-fetch page 1 of favorites
    if (requestedNumbers.size > 0 && hentaiFavStore.size() === 0) {
      try {
        const res = await extractHentaizmListingPage('https://www.hentaizm2.com/?tab=fav&page=1', 1, 1);
        const items = res.items || res.animeList || [];
        if (items.length > 0) {
          hentaiFavStore.savePage(1, items, from);
        }
      } catch (e) {
        console.warn('[indirhentai] Otomatik sayfa 1 taraması başarısız:', e.message);
      }
    }

    const itemsToQueue = [];
    const notFoundNumbers = [];

    // Resolve numbers
    for (const num of requestedNumbers) {
      let item = hentaiFavStore.getItem(num, from);
      // If not found in current cache and number is > 20, check if we should auto-fetch that page
      if (!item && num > 20) {
        const estimatedPage = Math.ceil(num / 20);
        try {
          const res = await extractHentaizmListingPage(`https://www.hentaizm2.com/?tab=fav&page=${estimatedPage}`, estimatedPage, estimatedPage);
          const pItems = res.items || res.animeList || [];
          if (pItems.length > 0) {
            hentaiFavStore.savePage(estimatedPage, pItems, from);
            item = hentaiFavStore.getItem(num, from);
          }
        } catch (e) {}
      }

      if (item) {
        itemsToQueue.push(item);
      } else {
        notFoundNumbers.push(num);
      }
    }

    // Resolve direct URLs
    for (const u of directUrls) {
      const slugMatch = u.match(/\/anime\/([^/?#]+)/i);
      let title = 'Hentai Seri';
      if (slugMatch) {
        title = slugMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
      itemsToQueue.push({
        url: u,
        title,
        posterUrl: null
      });
    }

    if (itemsToQueue.length === 0) {
      await sock.sendMessage(from, {
        text: `❌ Belirtilen numaralar (${notFoundNumbers.join(', ')}) favori listesinde bulunamadı.\n\nÖnce listeyi görmek için: \`hentaizmfav\``
      });
      return;
    }

    // Deduplicate by URL
    const uniqueMap = new Map();
    for (const it of itemsToQueue) {
      if (!uniqueMap.has(it.url)) {
        uniqueMap.set(it.url, it);
      }
    }
    const finalQueue = Array.from(uniqueMap.values());

    let addedCount = 0;
    let skippedCount = 0;

    for (const anime of finalQueue) {
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
            episodes: [],
            replyJid: targetJid
          }
        );
        addedCount++;
      } catch (err) {
        skippedCount++;
      }
    }

    // Send confirmation message
    const destName = isTargetGroup ? 'Hentai Grubu' : 'Bu Sohbet';

    if (finalQueue.length === 1) {
      const a = finalQueue[0];
      let msgText = `✅ *Hentai Paket Kuyruğa Eklendi!*\n\n` +
        `🎬 *Seri:* ${a.title}\n` +
        `🎯 *Hedef:* ${destName}\n` +
        `📦 *Mod:* Tüm Bölümler + Kapak Resmi + Açıklama\n`;
      if (isPriority) {
        msgText += `⚡ *Öncelik:* Kuyruğun en başına alındı.\n`;
      }
      msgText += `\n_Tüm bölümler ve afişi sunucuya indikten sonra tek seferde gönderilecektir._\n` +
        `Sırayı görmek için: \`!kuyruk\``;

      await sock.sendMessage(from, { text: msgText });
    } else {
      let msgText = `✅ *${addedCount} Adet Hentai Paketi Kuyruğa Eklendi!*\n\n` +
        finalQueue.map((a, idx) => `*${idx + 1}.* ${a.title}`).join('\n') +
        `\n\n🎯 *Hedef:* ${destName}\n` +
        `📦 *Mod:* Her serinin tüm bölümleri ve kapak resmi topluca iletilecek.\n`;
      if (isPriority) {
        msgText += `⚡ *Öncelik:* Kuyruğun en başına alındı.\n`;
      }
      if (skippedCount > 0) {
        msgText += `⚠️ *${skippedCount}* adet mükerrer görev atlandı.\n`;
      }
      if (notFoundNumbers.length > 0) {
        msgText += `ℹ️ Bulunamayanlar: ${notFoundNumbers.join(', ')}\n`;
      }
      msgText += `\nSırayı görmek için: \`!kuyruk\``;

      await sock.sendMessage(from, { text: msgText });
    }
  }
};
