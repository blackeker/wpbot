import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { execFile } from 'child_process';
import { solveDiscordCaptcha } from '../discordApi.js';

function solveCaptchaAI(imagePath) {
  return new Promise((resolve) => {
    const pyScript = 'C:/Users/keke/Desktop/projeler/ocr/cozucu.py';
    execFile('python', [pyScript, imagePath], { cwd: 'C:/Users/keke/Desktop/projeler/ocr' }, (error, stdout) => {
      if (error) {
        console.error("Python OCR Error:", error);
        return resolve(null);
      }
      const lines = stdout.trim().split('\n');
      let result = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line && !line.startsWith('WARNING') && !line.startsWith('I0000') && !line.startsWith('W0000') && !line.startsWith('[*]') && !line.startsWith('[OK]')) {
          result = line;
          break;
        }
      }
      resolve(result || null);
    });
  });
}

export default {
  name: 'otocoz',
  aliases: ['cozai', 'otocaptcha', 'aicoz'],
  async execute(sock, msg, from, args, ctx) {
    try {
      const response = await axios.get('http://127.0.0.1:3000/api/settings');
      const accounts = response.data?.accounts || [];

      if (accounts.length === 0) {
        await sock.sendMessage(from, { text: '❌ Kayıtlı Discord hesabı bulunamadı.' });
        return;
      }

      let solvedCount = 0;
      for (const acc of accounts) {
        const tempPath = `C:/Users/keke/Desktop/projeler/7w7/temp_captcha_${acc.id}.png`;
        if (fs.existsSync(tempPath)) {
          const aiResult = await solveCaptchaAI(tempPath);
          if (aiResult) {
            const solveRes = await solveDiscordCaptcha({
              channelId: acc.channelId,
              code: aiResult,
              accountId: acc.id
            });

            if (solveRes.success) {
              solvedCount++;
              await sock.sendMessage(from, { 
                text: `🤖 *AI CAPTCHA ÇÖZÜLDÜ*\n👤 *Hesap:* ${acc.name}\n🎯 *Kodu:* \`${aiResult}\`\n✅ Discord'a gönderildi: \`+captcha ${aiResult}\`` 
              });
            }
          }
        }
      }

      if (solvedCount === 0) {
        await sock.sendMessage(from, { text: '✅ Bekleyen veya çözülecek captcha bulunamadı.' });
      }
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ *Hata:* ${e.message}` });
    }
  }
};
