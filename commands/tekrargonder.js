import fs from 'fs';
import path from 'path';
import { getDiskUsage, formatBytes, downloadsDir } from '../config.js';
import { queueMediaSend } from '../pipelines.js';

export default {
  name: 'tekrargonder',
  aliases: ['tekrargönder', 'tekrar gönder', 'tekrar gonder'],
  async execute(sock, msg, from, args, ctx) {
    const fileName = args.join(' ').trim();
    if (!fileName) {
      const { files } = getDiskUsage();
      if (files.length === 0) {
        await sock.sendMessage(from, { text: '📂 Klasörde hiç dosya yok.' });
        return;
      }
      let reply = '📂 *Mevcut dosyalar:*\n\n';
      files.slice(0, 10).forEach((f, i) => {
        reply += `${i+1}. ${f.name} (${formatBytes(f.size)})\n`;
      });
      reply += `\nGöndermek için:\n*!tekrargonder <dosya adı>*`;
      await sock.sendMessage(from, { text: reply });
      return;
    }

    const filePath = path.join(downloadsDir, fileName);
    if (!fs.existsSync(filePath)) {
      await sock.sendMessage(from, { text: `❌ "${fileName}" bulunamadı.\n\n*!tekrargonder* yaz, mevcut dosyaları listelerim.` });
      return;
    }
    const stat = fs.statSync(filePath);
    await sock.sendMessage(from, { text: `📤 Gönderiliyor: ${fileName} (${formatBytes(stat.size)})` });
    try {
      await queueMediaSend(from, {
        document: { stream: fs.createReadStream(filePath) },
        mimetype: 'video/mp4',
        fileName
      });
      await sock.sendMessage(from, { text: `✅ Gönderildi!` });
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Gönderemedi: ${err.message}` });
    }
  }
};
