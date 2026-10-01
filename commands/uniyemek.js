import * as cheerio from 'cheerio';

export default {
  name: 'uniyemek',
  aliases: ['uniyemekleri', 'firatyemek', 'üniversiteyemek', 'üniversiteyemeği', 'universiteyemek', 'firatmenu', 'unimenu'],
  async execute(sock, msg, from, args, ctx) {
    try {
      const url = 'https://unievi.firat.edu.tr';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const html = await res.text();
      const $ = cheerio.load(html);
      const foodDate = $('.university-food .food-date').first().text().trim().replace(/\s+/g, ' ') || 'Günün Menüsü';
      
      const foodItems = [];
      $('.university-food .box .box__content p, .university-food .box p').each((_, el) => {
        const itemText = $(el).text().trim().replace(/\s+/g, ' ');
        if (itemText && !foodItems.includes(itemText)) {
          foodItems.push(itemText);
        }
      });

      if (foodItems.length === 0) {
        await sock.sendMessage(from, {
          text: `⚠️ *Fırat Üniversitesi Yemek Menüsü*\n\nMenü bilgisi şu anda sitede bulunamadı veya henüz güncellenmedi.\n\n🌐 Kontrol etmek için: ${url}`
        });
        return;
      }

      let message = `🍽️ *FIRAT ÜNİVERSİTESİ YEMEK MENÜSÜ*\n`;
      message += `📅 *Tarih:* ${foodDate}\n`;
      message += `━━━━━━━━━━━━━━━━━━━━\n`;
      message += `🍲 *Günün Menüsü:*\n\n`;
      foodItems.forEach(item => {
        message += `• ${item}\n`;
      });
      message += `━━━━━━━━━━━━━━━━━━━━\n`;
      message += `🌐 _Kaynak: ${url}_`;

      await sock.sendMessage(from, { text: message.trim() });
    } catch (err) {
      console.error('[uniyemek] Hata:', err.message);
      await sock.sendMessage(from, {
        text: `❌ *Hata:* Üniversite yemek menüsü çekilemedi: ${err.message}`
      });
    }
  }
};
