import { getBans } from '../discordApi.js';

export default {
  name: 'banlar',
  async execute(sock, msg, from, args, ctx) {
    try {
      const res = await getBans();
      const bans = res.bans || {};
      let reply = `📋 *KAYITLI BAN DURUMLARI* 📋\n\n`;
      const usernames = Object.keys(bans);
      if (usernames.length === 0) {
        reply += `_Kayıtlı herhangi bir banlı hesap bulunmuyor._`;
      } else {
        usernames.forEach(username => {
          const details = bans[username];
          const isBanned = details.status === 'Banned' || details.status === 'Banned (Kara Liste)';
          reply += `- *${username}:* ${isBanned ? '🔴 BANLI' : '🟢 Aktif'}\n`;
          if (isBanned) {
            reply += `  └ Süre: \`${details.unbanTime || 'Bilinmiyor'}\` | Sebep: \`${details.reason || 'Bilinmiyor'}\`\n`;
          }
        });
      }
      await sock.sendMessage(from, { text: reply });
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ *Hata:* Bağlantı sorunu.\n${e.message}` });
    }
  }
};
