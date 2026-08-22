import { botState, getDiskUsage, formatBytes } from '../config.js';
import { queueState, downloadQueue, activeTask } from '../queue.js';

export default {
  name: 'durum',
  aliases: ['status', 'bot durumu', 'durum?'],
  async execute(sock, msg, from, args, ctx) {
    const uptimeMs = Date.now() - botState.uptime.getTime();
    const uptimeSec = Math.round(uptimeMs / 1000);
    const uptimeStr = `${Math.floor(uptimeSec/3600)}sa ${Math.floor((uptimeSec%3600)/60)}dk ${uptimeSec%60}sn`;
    const memUsage = process.memoryUsage();
    const { totalBytes } = getDiskUsage();
    const statusEmoji = botState.status === 'connected' ? '🟢' : '🔴';
    const queueEmoji = queueState.isPaused ? '⏸️ Beklemede' : '▶️ Aktif';

    const reply =
      `🖥️ *Bot Durum Raporu*\n\n` +
      `${statusEmoji} Bağlantı: ${botState.status}\n` +
      `⏱️ Çalışma: ${uptimeStr}\n` +
      `🧠 RAM: ${formatBytes(memUsage.rss)}\n` +
      `💾 Disk: ${formatBytes(totalBytes)}\n` +
      `📋 Kuyruk: ${queueEmoji} (${downloadQueue.length} bekliyor)\n` +
      `🎬 Aktif: ${activeTask.current ? activeTask.current.title : 'Yok'}`;
    await sock.sendMessage(from, { text: reply });
  }
};
