import { getDiskUsage, formatBytes } from '../config.js';

export default {
  name: 'disk',
  aliases: ['yer', 'depolama'],
  async execute(sock, msg, from, args, ctx) {
    const { totalBytes, files } = getDiskUsage();
    let reply = `💾 *Disk Kullanımı*\n\n📦 Toplam: *${formatBytes(totalBytes)}*\n📂 Dosya: *${files.length} adet*\n`;
    if (files.length > 0) {
      reply += `\n🏆 *En büyük 5 dosya:*\n`;
      files.slice(0, 5).forEach((f, i) => {
        const age = Math.round((Date.now() - f.mtime) / 3600000);
        reply += `${i+1}. ${f.name.slice(0,35)} — ${formatBytes(f.size)} (${age}sa önce)\n`;
      });
    } else {
      reply += '\n_Klasör boş._';
    }
    await sock.sendMessage(from, { text: reply });
  }
};
