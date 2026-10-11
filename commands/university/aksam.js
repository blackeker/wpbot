import { getAksamMessage, sendMenuResponse } from '../../utils/menuData.js';
import { checkMenuRateLimit } from '../../utils/menuRateLimiter.js';

export default {
  name: 'aksam',
  aliases: ['akşam', 'aksamyemegi', 'akşamyemeği', 'aksam_yemegi'],
  async execute(sock, msg, from, args, ctx) {
    try {
      // Rate limit kontrolü (DM: günde 1, Grup: son 20 mesajda 1)
      const allowed = await checkMenuRateLimit(sock, msg, from, 'aksam');
      if (!allowed) return;

      const query = args && args.length > 0 ? args.join(' ').trim() : '';
      const replyText = getAksamMessage(query);
      await sendMenuResponse(sock, msg, from, replyText);
    } catch (err) {
      console.error('[Akşam Yemeği Komutu] Hata:', err.message);
      await sendMenuResponse(sock, msg, from, `❌ *Hata:* Akşam yemeği menüsü alınırken bir sorun oluştu: ${err.message}`);
    }
  }
};

