import { checkBans } from '../discordApi.js';

export default {
  name: 'bancheck',
  aliases: ['bankontrol'],
  async execute(sock, msg, from, args, ctx) {
    try {
      await sock.sendMessage(from, { text: '⏳ Yan hesaplar ban durumu taranıyor...' });
      const res = await checkBans();
      const results = res.results || {};
      let reply = `📋 *BAN TARAMA SONUÇLARI* 📋\n\n`;
      Object.keys(results).forEach(username => {
        const details = results[username];
        reply += `- *${username}:* ${details.status === 'Active' ? '🟢 Aktif' : '🔴 BANLI'}\n`;
        if (details.reason) reply += `  └ Sebep: \`${details.reason}\` | Süre: \`${details.unbanTime}\`\n`;
      });
      await sock.sendMessage(from, { text: reply });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ *Hata:* Bağlantı sorunu.\n${e.message}` });
    }
  }
};
