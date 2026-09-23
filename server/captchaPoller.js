import axios from 'axios';
import { botSocketRef, readConfig } from '../config.js';
import { getModuleLogger } from '../utils/logger.js';

const logger = getModuleLogger('captcha-poller');

export const activeCaptchasMap = new Map();
let captchaCounter = 0;
export const sentCaptchasSet = new Set();

export function startCaptchaPoller() {
  setInterval(async () => {
    try {
      if (!botSocketRef.current) return;

      const response = await axios.get('http://127.0.0.1:8181/api/captcha');
      const data = response.data;
      if (data.success && data.captchas && data.captchas.length > 0) {
        for (const cap of data.captchas) {
          if (!sentCaptchasSet.has(cap.messageId)) {
            sentCaptchasSet.add(cap.messageId);

            captchaCounter++;
            const durumKodu = String(captchaCounter);

            activeCaptchasMap.set(durumKodu, { 
              messageId: cap.messageId, 
              username: cap.username, 
              accountType: cap.account, 
              token: cap.token, 
              channelId: cap.channelId 
            });

            const cfg = readConfig();
            const adminNum = cfg.adminJids?.[0] || cfg.whatsappPhoneNumber;
            const targetJid = adminNum ? (adminNum.includes('@') ? adminNum : `${adminNum}@s.whatsapp.net`) : '';

            let infoText = `⚠️ *YENİ CAPTCHA BELİRDİ! (Poller)* ⚠️\n\n`;
            infoText += `👤 *Hesap:* ${cap.username} (${cap.account === 'main' ? 'Ana Hesap' : 'Yan Hesap'})\n`;
            infoText += `🔑 *Durum Kodu (Sıra No):* *${durumKodu}*\n\n`;
            infoText += `💬 *Çözmek için:* \n\`!çöz ${durumKodu} KOD\` yazıp gönderin.`;

            if (cap.localImageUrl) {
              const imgUrl = `http://127.0.0.1:8181${cap.localImageUrl}`;
              const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer' }).catch(() => null);
              if (imgRes && imgRes.status === 200) {
                await botSocketRef.current.sendMessage(targetJid, { 
                  image: Buffer.from(imgRes.data), 
                  caption: infoText 
                });
              } else {
                await botSocketRef.current.sendMessage(targetJid, { text: infoText + `\n\n⚠️ Resim indirilemedi.` });
              }
            } else {
              await botSocketRef.current.sendMessage(targetJid, { text: infoText });
            }
          }
        }
      }
    } catch (err) {
      // Ignore network errors with Discord bot offline
    }
  }, 19000);
}

