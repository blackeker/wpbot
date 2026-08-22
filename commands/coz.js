import axios from 'axios';
import { solveDiscordCaptcha } from '../discordApi.js';

export default {
  name: 'coz',
  aliases: ['çöz'],
  async execute(sock, msg, from, args, ctx) {
    // Reconstruct full text or original parts
    const parts = [ctx.text.split(/\s+/)[0], ...args];
    if (parts.length < 2) {
      await sock.sendMessage(from, { text: '⚠️ *Kullanım:* \n`!coz <KOD>` (Ana bot ise)\n`!coz <KANAL_ID> <KOD>`\n`!coz <TOKEN> <KANAL_ID> <KOD>`' });
      return;
    }
    
    try {
      let payload = {};
      if (parts.length === 2) {
        const statusRes = await axios.get('http://127.0.0.1:8181/api/captcha');
        const captchas = statusRes.data.captchas || [];
        const mainCap = captchas.find(c => c.account === 'main');
        if (!mainCap) {
          await sock.sendMessage(from, { text: '❌ Aktif ana hesap captchası bulunamadı. Lütfen kanal ID belirtin.' });
          return;
        }
        payload = {
          channelId: mainCap.channelId,
          code: parts[1]
        };
      } else if (parts.length === 3) {
        const durumKodu = parts[1];
        const code = parts[2];
        
        let capDetails = ctx.activeCaptchasMap.get(durumKodu);
        
        if (!capDetails) {
          const statusRes = await axios.get('http://127.0.0.1:8181/api/captcha').catch(() => null);
          const captchas = statusRes?.data?.captchas || [];
          const matchedCap = captchas.find(c => c.messageId === durumKodu);
          if (matchedCap) {
            capDetails = {
              channelId: matchedCap.channelId,
              token: matchedCap.token,
              accountType: matchedCap.account
            };
          }
        }
        
        if (capDetails) {
          payload = {
            token: capDetails.token || undefined,
            channelId: capDetails.channelId,
            code: code
          };
        } else {
          payload = {
            channelId: parts[1],
            code: parts[2]
          };
        }
      } else {
        payload = {
          token: parts[1],
          channelId: parts[2],
          code: parts[3]
        };
      }
      
      const solveRes = await solveDiscordCaptcha(payload);
      if (solveRes.success) {
        await sock.sendMessage(from, { text: `✅ *Çözüm Gönderildi:* \`${payload.code}\` başarıyla sıraya eklendi.` });
      } else {
        await sock.sendMessage(from, { text: `❌ *Hata:* Çözüm gönderilemedi. ${solveRes.error || ''}` });
      }
    } catch (e) {
      let errMsg = e.message;
      if (e.response && e.response.data && e.response.data.error) {
        errMsg = e.response.data.error;
      }
      await sock.sendMessage(from, { text: `❌ *Hata:* ${errMsg}` });
    }
  }
};
