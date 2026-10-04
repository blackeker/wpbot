import { getYemekMessage, sendMenuResponse } from '../utils/menuData.js';

export default {
  name: 'yemek',
  aliases: ['gunlukyemek', 'tabldot', 'yemekhane'],
  async execute(sock, msg, from, args, ctx) {
    try {
      const query = args && args.length > 0 ? args.join(' ').trim() : '';
      const replyText = getYemekMessage(query);
      await sendMenuResponse(sock, msg, from, replyText);
    } catch (err) {
      console.error('[Yemek Komutu] Hata:', err.message);
      await sendMenuResponse(sock, msg, from, `❌ *Hata:* Yemek menüsü alınırken bir sorun oluştu: ${err.message}`);
    }
  }
};
