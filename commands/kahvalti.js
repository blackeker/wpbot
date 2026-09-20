import { getKahvaltiMessage } from '../utils/menuData.js';

export default {
  name: 'kahvalti',
  aliases: ['kahvaltı', 'sabah', 'sabahyemegi', 'sabahyemeği'],
  async execute(sock, msg, from, args, ctx) {
    try {
      const query = args && args.length > 0 ? args.join(' ').trim() : '';
      const replyText = getKahvaltiMessage(query);
      await sock.sendMessage(from, { text: replyText });
    } catch (err) {
      console.error('[Kahvaltı Komutu] Hata:', err.message);
      await sock.sendMessage(from, { text: `❌ *Hata:* Kahvaltı menüsü alınırken bir sorun oluştu: ${err.message}` });
    }
  }
};
