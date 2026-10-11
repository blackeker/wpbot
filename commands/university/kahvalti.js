import { getKahvaltiMessage, sendMenuResponse } from '../../utils/menuData.js';

export default {
  name: 'kahvalti',
  aliases: ['kahvaltı', 'sabah', 'sabahyemegi', 'sabahyemeği'],
  async execute(sock, msg, from, args, ctx) {
    try {
      const query = args && args.length > 0 ? args.join(' ').trim() : '';
      const replyText = getKahvaltiMessage(query);
      await sendMenuResponse(sock, msg, from, replyText);
    } catch (err) {
      console.error('[Kahvaltı Komutu] Hata:', err.message);
      await sendMenuResponse(sock, msg, from, `❌ *Hata:* Kahvaltı menüsü alınırken bir sorun oluştu: ${err.message}`);
    }
  }
};
