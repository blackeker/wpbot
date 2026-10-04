import * as cheerio from 'cheerio';
import { sendMenuResponse } from '../../utils/menuData.js';

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
        await sendMenuResponse(sock, msg, from, `⚠️ *Fırat Üniversitesi Yemek Menüsü*\n\nMenü bilgisi şu anda sitede bulunamadı veya henüz güncellenmedi.\n\n🌐 Kontrol etmek için: ${url}`);
        return;
      }

      const UNI_HEADERS = [
        '🍽️ *FIRAT ÜNİVERSİTESİ YEMEK MENÜSÜ*',
        '🎓 *Fırat Üniversitesi Günün Menüsü* 🍛',
        '🍲 *Üniversite Yemekhane Menüsü* ✨',
        '📋 *Fırat Üni Yemek Listesi*'
      ];
      const UNI_DIVIDERS = [
        '━━━━━━━━━━━━━━━━━━━━',
        '────────────────────',
        '····································',
        '════════════════════'
      ];
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const h = pick(UNI_HEADERS);
      const d = pick(UNI_DIVIDERS);

      let message = `${h}\n`;
      message += `📅 *Tarih:* ${foodDate}\n`;
      message += `${d}\n`;
      message += `🍲 *Günün Menüsü:*\n\n`;
      foodItems.forEach(item => {
        message += `• ${item}\n`;
      });
      message += `${d}\n`;
      message += `🌐 _Kaynak: ${url}_`;

      await sendMenuResponse(sock, msg, from, message.trim());
    } catch (err) {
      console.error('[uniyemek] Hata:', err.message);
      await sendMenuResponse(sock, msg, from, `❌ *Hata:* Üniversite yemek menüsü çekilemedi: ${err.message}`);
    }
  }
};
