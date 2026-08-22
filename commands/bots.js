import { getDiscordStatus } from '../discordApi.js';

export default {
  name: 'bots',
  aliases: ['botlar'],
  async execute(sock, msg, from, args, ctx) {
    try {
      const data = await getDiscordStatus();
      if (data.success) {
        let statusText = `🤖 *BOT DURUMU & AYARLAR* 🤖\n\n`;
        statusText += `👑 *Ana Bot:* ${data.botState.isRunning ? '🟢 Çalışıyor' : '🔴 Durduruldu'}\n`;
        statusText += `👤 *Kullanıcı:* ${data.botState.user || 'Giriş yapılmamış'}\n`;
        statusText += `🔒 *Kilitli mi:* ${data.botState.isCaptchaBlocked ? '⚠️ EVET (Captcha)' : '✅ Hayır'}\n\n`;
        
        statusText += `👥 *Yan Hesaplar (Farm):* \n`;
        if (data.botState.alts && data.botState.alts.length > 0) {
          data.botState.alts.forEach(alt => {
            statusText += `- ${alt.username}: ${alt.isRunning ? '🟢' : '🔴'} ${alt.isCaptchaBlocked ? '(⚠️ Captcha)' : ''}\n`;
          });
        } else {
          statusText += `_Aktif yan hesap yok._\n`;
        }
        
        statusText += `\n⚙️ *Genel Ayarlar:* \n`;
        statusText += `- Otomatik Çözüm: ${data.settings.autoSolveCaptcha ? '🟢 Açık' : '🔴 Kapalı'}\n`;
        statusText += `- Captcha Sistemi: ${data.settings.captchaEnabled ? '🟢 Açık' : '🔴 Kapalı'}\n`;
        statusText += `- Günlük Ödül: ${data.settings.dailyEnabled ? '🟢 Açık' : '🔴 Kapalı'}\n`;
        statusText += `- Patates Gönderimi: ${data.settings.potatoEnabled ? '🟢 Açık' : '🔴 Kapalı'}\n`;
        
        await sock.sendMessage(from, { text: statusText });
      }
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ *Hata:* Discord API ile bağlantı kurulamadı.\n${e.message}` });
    }
  }
};
