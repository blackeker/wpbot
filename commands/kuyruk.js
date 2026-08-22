import { downloadQueue, activeTask, clearQueue, queueState, getEstimatedWaitTime } from '../queue.js';

export default {
  name: 'kuyruk',
  aliases: ['queue', 'ne var', 'nerede', 'durum ne', 'kac tane', 'kaç tane'],
  async execute(sock, msg, from, args, ctx) {
    const isClearQueueCmd = ['kuyruk temizle', 'kuyruğu temizle', 'kuyruktemizle', '!kuyruktemizle', '!kuyruk-temizle', 'kuyruk sıfırla'].includes(ctx.ltext);
    if (isClearQueueCmd) {
      const removedCount = clearQueue();
      await sock.sendMessage(from, { text: `🧹 *Kuyruk Temizlendi!*\nKuyruktaki *${removedCount}* adet bekleyen görev ve varsa aktif indirme iptal edildi.` });
      return;
    }

    let responseText = `📋 *İNDİRME KUYRUĞU VE CANLI DURUM*\n`;
    if (queueState.isPaused) responseText += `\n⏸️ *Kuyruk duraklatıldı.* Devam ettirmek için *devam* yaz.\n`;
    responseText += '\n';

    if (activeTask.current) {
      const elapsedMs = activeTask.current.startTime ? Date.now() - activeTask.current.startTime : 0;
      const elapsedStr = elapsedMs > 60000 ? `${Math.floor(elapsedMs/60000)}dk ${Math.floor((elapsedMs%60000)/1000)}sn` : `${Math.floor(elapsedMs/1000)}sn`;
      responseText += `🚀 *Şu An İndiriliyor:*\n🎬 *${activeTask.current.title}*\n📊 *Durum:* ${activeTask.current.status || 'İşleniyor...'}\n`;
      if (activeTask.current.speed) responseText += `⚡ *Hız:* ~${activeTask.current.speed} MB/s\n`;
      responseText += `⏱️ *Süre:* ${elapsedStr} geçti\n\n`;
    } else {
      responseText += `💤 *Şu an aktif indirme yok.*\n\n`;
    }

    if (downloadQueue.length > 0) {
      responseText += `⏳ *Bekleyen Görevler (${downloadQueue.length} adet):*\n`;
      downloadQueue.forEach((t, i) => {
        const waitEst = getEstimatedWaitTime(i);
        const priorityTag = t.priority ? '🔴 [ÖNCELİKLİ] ' : '';
        responseText += `${i + 1}. ${priorityTag}*${t.title}*\n   └ Tahmini Bekleme: ${waitEst}\n`;
      });
    } else {
      responseText += `✨ *Kuyrukta bekleyen görev yok.*`;
    }

    await sock.sendMessage(from, { text: responseText });
  }
};
