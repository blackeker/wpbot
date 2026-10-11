import { getKahvaltiMessage, sendMenuResponse } from '../../utils/menuData.js';
import { checkMenuRateLimit } from '../../utils/menuRateLimiter.js';

export default {
  name: 'kahvalti',
  aliases: ['kahvaltı', 'sabah', 'sabahyemegi', 'sabahyemeği'],
  async execute(sock, msg, from, args, ctx) {
    try {
      // Rate limit kontrolü (DM: günde 1, Grup: son 20 mesajda 1)
      const allowed = await checkMenuRateLimit(sock, msg, from, 'kahvalti');
      if (!allowed) return;

      const query = args && args.length > 0 ? args.join(' ').trim() : '';
      const replyText = getKahvaltiMessage(query);
      await sendMenuResponse(sock, msg, from, replyText);
    } catch (err) {
      console.error('[Kahvaltı Komutu] Hata:', err.message);
      await sendMenuResponse(sock, msg, from, `❌ *Hata:* Kahvaltı menüsü alınırken bir sorun oluştu: ${err.message}`);
    }
  }
};

