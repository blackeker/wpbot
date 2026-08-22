import { getDiscordStatus } from '../discordApi.js';

export default {
  name: 'komutlar',
  async execute(sock, msg, from, args, ctx) {
    try {
      const data = await getDiscordStatus();
      if (data.success) {
        let reply = `📋 *KAYITLI SPAM KOMUTLARI* 📋\n\n`;
        
        reply += `👑 *Ana Hesap Komutları:* \n`;
        const mainCmds = data.settings.commands || [];
        if (mainCmds.length === 0) {
          reply += ` _Komut bulunmuyor._\n`;
        } else {
          mainCmds.forEach((cmd, idx) => {
            reply += ` ${idx + 1}. \`${cmd.text}\` (Delay: ${cmd.minDelay / 1000}s - ${cmd.maxDelay / 1000}s)\n`;
          });
        }
        
        reply += `\n👥 *Yan Hesap Komutları:* \n`;
        const altCmds = data.settings.altCommands || [];
        if (altCmds.length === 0) {
          reply += ` _Komut bulunmuyor._\n`;
        } else {
          altCmds.forEach((cmd, idx) => {
            reply += ` ${idx + 1}. \`${cmd.text}\` (Delay: ${cmd.minDelay / 1000}s - ${cmd.maxDelay / 1000}s)\n`;
          });
        }
        
        await sock.sendMessage(from, { text: reply });
      }
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ *Hata:* ${e.message}` });
    }
  }
};
