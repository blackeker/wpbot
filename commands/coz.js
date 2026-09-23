import axios from 'axios';
import { solveDiscordCaptcha } from '../discordApi.js';

export default {
  name: 'coz',
  aliases: ['çöz'],
  async execute(sock, msg, from, args, ctx) {
    const parts = [ctx.text.split(/\s+/)[0], ...args];
    if (parts.length < 2) {
      await sock.sendMessage(from, { 
        text: '⚠️ *Kullanım:* \n`!coz <KOD>` (Varsayılan hesaba gönderir)\n`!coz <KANAL_ID> <KOD>`' 
      });
      return;
    }
    
    try {
      let payload = {};
      if (parts.length === 2) {
        // Fetch accounts from 7w7 server (port 3000)
        const settingsRes = await axios.get('http://127.0.0.1:3000/api/settings').catch(() => null);
        const accounts = settingsRes?.data?.accounts || [];
        const activeAcc = accounts.find(a => a.enabled && a.channelId) || accounts[0];
        
        if (!activeAcc || !activeAcc.channelId) {
          await sock.sendMessage(from, { text: '❌ Aktif kanal ID bulunamadı. Lütfen `!coz <KANAL_ID> <KOD>` şeklinde kullanın.' });
          return;
        }
        payload = {
          channelId: activeAcc.channelId,
          code: parts[1]
        };
      } else {
        payload = {
          channelId: parts[1],
          code: parts[2]
        };
      }
      
      const solveRes = await solveDiscordCaptcha(payload);
      if (solveRes.success) {
        await sock.sendMessage(from, { text: `✅ *Discord'a Gönderildi:* \`+captcha ${payload.code}\` (Kanal ID: ${payload.channelId})` });
      } else {
        await sock.sendMessage(from, { text: `❌ *Hata:* ${solveRes.message || solveRes.error || 'İletilemedi'}` });
      }
    } catch (e) {
      let errMsg = e.message;
      if (e.response && e.response.data && e.response.data.message) {
        errMsg = e.response.data.message;
      }
      await sock.sendMessage(from, { text: `❌ *Hata:* ${errMsg}` });
    }
  }
};
