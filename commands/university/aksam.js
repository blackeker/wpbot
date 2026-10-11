import { getAksamMessage, sendMenuResponse } from '../../utils/menuData.js';

export default {
  name: 'aksam',
  aliases: ['akşam', 'aksamyemegi', 'akşamyemeği', 'aksam_yemegi'],
  async execute(sock, msg, from, args, ctx) {
    try {
      const query = args && args.length > 0 ? args.join(' ').trim() : '';
      const replyText = getAksamMessage(query);
      await sendMenuResponse(sock, msg, from, replyText);
    } catch (err) {
      console.error('[Akşam Yemeği Komutu] Hata:', err.message);
      await sendMenuResponse(sock, msg, from, `❌ *Hata:* Akşam yemeği menüsü alınırken bir sorun oluştu: ${err.message}`);
    }
  }
};
