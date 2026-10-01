import { extractHentaizmListingPage } from "../extractor.js";
import { hentaiFavStore } from "../utils/hentaiFavStore.js";

export default {
  name: "hentaizmfav",
  aliases: ["hetaizmfav", "hentaifav", "favhentai", "hentai-fav", "fav-hentai"],
  async execute(sock, msg, from, args, ctx) {
    let page = 1;
    for (const arg of args) {
      const parsed = parseInt(arg, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        page = parsed;
        break;
      }
    }

    try {
      const pageUrl = `https://www.hentaizm2.com/?tab=fav&page=${page}`;
      const result = await extractHentaizmListingPage(pageUrl, page, page);
      const items = result.items || result.animeList || [];

      if (!items || items.length === 0) {
        await sock.sendMessage(from, {
          text: `⚠️ *Hentaizm Favoriler Sayfa ${page}* boş veya sayfa sonuna ulaşıldı.\n\nÖnceki sayfaya dönmek için:\n👉 \`hentaizmfav ${Math.max(1, page - 1)}\``
        });
        return;
      }

      // Numaralandır ve hafızaya kaydet
      const numberedItems = hentaiFavStore.savePage(page, items, from);

      // Başlangıç bildirimi
      await sock.sendMessage(from, {
        text: `🔞 *HENTAİZM FAVORİLERİ - SAYFA ${page}* 🔞\n━━━━━━━━━━━━━━━━━━━━\n📄 Toplam *${numberedItems.length}* anime bulundu.\nHer anime afişi ve indirme numarasıyla birlikte tek tek gönderiliyor:`
      });

      // Her animeyi ayrı bir mesaj olarak (resmi ve başlığıyla) gönder
      for (const item of numberedItems) {
        const itemCaption = 
          `🔞 *No: ${item.index}* - *${item.title}*\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📥 İndirmek için:\n` +
          `👉 Bu mesaja yanıt verip: *\`.\`*\n` +
          `👉 Veya: *\`indirhentai ${item.index}\`*`;

        let imageSent = false;
        if (item.posterUrl) {
          try {
            await sock.sendMessage(from, {
              image: { url: item.posterUrl },
              caption: itemCaption
            });
            imageSent = true;
          } catch (imgErr) {
            console.warn(`[hentaizmfav] Afiş gönderilemedi (#${item.index}): ${imgErr.message}`);
          }
        }

        if (!imageSent) {
          await sock.sendMessage(from, { text: itemCaption });
        }

        // WhatsApp hız sınırı ve mesaj sırasının korunması için kısa bekleme
        await new Promise(r => setTimeout(r, 600));
      }

      // Kapanış ve sayfa gezinme rehberi
      const firstNo = numberedItems[0]?.index || 1;
      const lastNo = numberedItems[numberedItems.length - 1]?.index || (firstNo + numberedItems.length - 1);

      let navText = `✅ *Sayfa ${page} Tamamlandı!* (${numberedItems.length} Anime)\n━━━━━━━━━━━━━━━━━━━━\n` +
        `📥 *İndirme Seçenekleri:*\n` +
        `• ⚡ *En Hızlı:* İstediğin anime afişini yanıtlayıp *\`.\`* yaz\n` +
        `• Tekli indirme: \`indirhentai ${firstNo}\`\n` +
        `• Çoklu indirme: \`indirhentai ${firstNo}, ${firstNo + 1}\`\n` +
        `• Aralık indirme: \`indirhentai ${firstNo}-${lastNo}\`\n` +
        `• Öncelikli: \`indirhentai ${firstNo} acil\` (veya yanıta: \`. acil\`)\n\n` +
        `🔄 *Sayfa Gezinme:*\n` +
        `👉 \`hentaizmfav ${page + 1}\` _(Sonraki sayfa)_\n`;

      if (page > 1) {
        navText += `👉 \`hentaizmfav ${page - 1}\` _(Önceki sayfa)_\n`;
      }

      await sock.sendMessage(from, { text: navText });
    } catch (err) {
      console.error('[hentaizmfav] Hata:', err.message);
      await sock.sendMessage(from, {
        text: `❌ Favori listesi taranırken hata oluştu: ${err.message}`
      });
    }
  }
};
