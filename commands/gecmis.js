import { readHistory } from '../config.js';

export default {
  name: 'gecmis',
  aliases: ['geçmiş', 'indirdim', 'son indirmeler'],
  async execute(sock, msg, from, args, ctx) {
    const history = readHistory().slice(0, 10);
    if (history.length === 0) {
      await sock.sendMessage(from, { text: '📋 Henüz tamamlanmış bir indirme yok.' });
      return;
    }
    let reply = `📋 *Son İndirmelerim*\n\n`;
    history.forEach((h, i) => {
      const date = new Date(h.timestamp).toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      reply += `${i+1}. *${h.title?.slice(0, 35) || 'Bilinmiyor'}*\n   • ${h.sizeMB}MB • ${h.duration} • ${date}\n`;
    });
    await sock.sendMessage(from, { text: reply });
  }
};
