import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

function toCitySlug(str) {
  if (!str) return 'elazig';
  return str
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

export default {
  name: 'eczane',
  aliases: ['nobetcieczane', 'nobetci'],
  async execute(sock, msg, from, args, ctx) {
    const cityInput = args && args.length > 0 ? args.join(' ').trim() : 'Elazığ';
    const citySlug = toCitySlug(cityInput);
    const targetUrl = `https://eczaneler.gen.tr/nobetci-${citySlug}`;

    try {
      const res = await gotScraping({
        url: targetUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      const $ = cheerio.load(res.body);
      const pharmacies = [];

      $('tr').each((_, tr) => {
        const name = $(tr).find('span.isim').text().trim();
        if (!name) return;

        const addressCol = $(tr).find('div.col-lg-6');
        const note = addressCol.find('span.font-italic').text().trim();
        addressCol.find('div').remove();
        const address = addressCol.text().replace(/\s+/g, ' ').trim();

        const phone = $(tr).find('div.col-lg-3').last().text().trim();

        pharmacies.push({ name, address, note, phone });
      });

      if (pharmacies.length === 0) {
        await sock.sendMessage(from, { text: `❌ *${cityInput.toUpperCase()}* için nöbetçi eczane bilgisi bulunamadı.` });
        return;
      }

      let reply = `🏥 *NÖBETÇİ ECZANELER — ${cityInput.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

      pharmacies.forEach((p, idx) => {
        reply += `💊 *${idx + 1}. ${p.name}*\n`;
        reply += `📍 *Adres:* ${p.address}\n`;
        if (p.note) reply += `ℹ️ *Tarif:* _${p.note}_\n`;
        if (p.phone) reply += `📞 *Tel:* ${p.phone}\n`;
        reply += `\n`;
      });

      reply += `⏱️ _Tarih: ${new Date().toLocaleDateString('tr-TR')}_`;

      await sock.sendMessage(from, { text: reply.trim() });
    } catch (err) {
      console.error('[Nöbetçi Eczane] Hata:', err.message);
      await sock.sendMessage(from, { text: `❌ *Hata:* Nöbetçi eczane bilgisi çekilemedi (${cityInput}). Şehir adını kontrol edip tekrar deneyin.` });
    }
  }
};
