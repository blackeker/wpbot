import { readErrorLog } from '../config.js';

export default {
  name: 'hatalar',
  aliases: ['hata', 'sorun', 'neden olmadı'],
  async execute(sock, msg, from, args, ctx) {
    const errors = readErrorLog().slice(0, 5);
    if (errors.length === 0) {
      await sock.sendMessage(from, { text: '✅ Hiç hata kayıdı yok, harika!' });
      return;
    }
    let reply = `❌ *Son Hatalar*\n\n`;
    errors.forEach((e, i) => {
      const date = new Date(e.timestamp).toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      reply += `${i+1}. *${(e.title || e.url)?.slice(0,35)}*\n   • ${e.error?.slice(0, 80)}\n   • ${date}\n`;
    });
    await sock.sendMessage(from, { text: reply });
  }
};
