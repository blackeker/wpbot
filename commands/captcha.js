import axios from 'axios';
import { getDiscordStatus } from '../discordApi.js';

export default {
  name: 'captcha',
  async execute(sock, msg, from, args, ctx) {
    try {
      const data = await getDiscordStatus();
      const response = await axios.get('http://127.0.0.1:8181/api/captcha');
      const captchaData = response.data;
      if (captchaData.success && captchaData.captchas && captchaData.captchas.length > 0) {
        for (const cap of captchaData.captchas) {
          let infoText = `⚠️ *CAPTCHA BELİRDİ!* ⚠️\n\n`;
          infoText += `👤 *Hesap:* ${cap.username} (${cap.account === 'main' ? 'Ana Hesap' : 'Yan Hesap'})\n`;
          infoText += `🆔 *Mesaj ID:* \`${cap.messageId}\`\n`;
          infoText += `📺 *Kanal ID:* \`${cap.channelId}\`\n`;
          infoText += `🌐 *Sunucu ID:* \`${cap.guildId}\`\n\n`;
          infoText += `💬 *Çözmek için komut:* \n\`!coz ${cap.account === 'main' ? '' : cap.token + ' '}${cap.channelId} KOD\`\n`;
          
          const imgUrl = `http://127.0.0.1:8181${cap.localImageUrl}`;
          try {
            const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer' });
            if (imgRes.status === 200) {
              await sock.sendMessage(from, { 
                image: Buffer.from(imgRes.data), 
                caption: infoText 
              });
            } else {
              await sock.sendMessage(from, { text: infoText + `⚠️ Resim indirilemedi (HTTP ${imgRes.status})` });
            }
          } catch (imgErr) {
            await sock.sendMessage(from, { text: infoText + `⚠️ Resim indirilemedi: ${imgErr.message}` });
          }
        }
      } else {
        await sock.sendMessage(from, { text: '✅ *Harika!* Şu anda kilitli veya çözülmeyi bekleyen bir captcha bulunmuyor.' });
      }
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ *Hata:* Discord API ile bağlantı kurulamadı.\n${e.message}` });
    }
  }
};
