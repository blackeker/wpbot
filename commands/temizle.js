import { getDiskUsage, cleanOldDownloads, formatBytes } from '../config.js';

export default {
  name: 'temizle',
  aliases: ['clear'],
  async execute(sock, msg, from, args, ctx) {
    const { files: before } = getDiskUsage();
    cleanOldDownloads();
    const { files: after, totalBytes } = getDiskUsage();
    const deleted = before.length - after.length;
    await sock.sendMessage(from, { text: `🧹 Temizlik tamam!\n🗑️ ${deleted} eski dosya silindi.\n💾 Kalan: ${formatBytes(totalBytes)} (${after.length} dosya)` });
  }
};
