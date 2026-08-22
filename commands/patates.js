import { triggerPotato } from '../discordApi.js';

export default {
  name: 'patates',
  aliases: ['patatesat'],
  async execute(sock, msg, from, args, ctx) {
    try {
      await sock.sendMessage(from, { text: '⏳ Yan hesaplardan patates gönderimi tetikleniyor...' });
      const res = await triggerPotato();
      if (res.success) {
        await sock.sendMessage(from, { text: '🥔 Patates gönderimi başarıyla başlatıldı!' });
      }
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ *Hata:* ${e.message}` });
    }
  }
};
