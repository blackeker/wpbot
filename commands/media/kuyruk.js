import { downloadQueue, activeTask, activeTasksList, clearQueue, queueState, getEstimatedWaitTime } from '../../queue.js';
import { readConfig, getProgressBar } from '../../config.js';


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

    const config = readConfig();
    const limit = Math.max(1, Number(config.concurrencyLimit) || 1);

    let responseText = `📋 *SİSTEM DURUMU VE İNDİRME KUYRUĞU*\n`;
    responseText += `⚙️ *Paralel Limit:* ${limit} Görev\n`;
    if (queueState.isPaused) responseText += `\n⏸️ *Kuyruk duraklatıldı.* Devam ettirmek için *devam* yaz.\n`;
    responseText += '\n';

    if (activeTasksList.length > 0) {
      responseText += `🚀 *Şu An Aktif Olanlar (${activeTasksList.length}/${limit}):*\n`;
      activeTasksList.forEach((task, idx) => {
        const elapsedMs = task.startTime ? Date.now() - task.startTime : 0;
        const elapsedStr = elapsedMs > 60000 ? `${Math.floor(elapsedMs/60000)}dk ${Math.floor((elapsedMs%60000)/1000)}sn` : `${Math.floor(elapsedMs/1000)}sn`;

        // Extract percent from status (e.g., "45% [████░░] - ...")
        const percentMatch = task.status?.match(/(\d+)%/);
        const percent = percentMatch ? parseInt(percentMatch[1], 10) : 0;
        const bar = getProgressBar(percent);

        responseText += `${idx + 1}. 🎬 *${task.title}*\n`;
        responseText += `   └ 📊 *İlerleme:* %${percent} \`${bar}\`\n`;
        responseText += `   └ ⚙️ *Durum:* ${task.status || 'İşleniyor...'}\n`;
        if (task.speed) responseText += `   └ ⚡ *Hız:* ~${task.speed} MB/s\n`;
        responseText += `   └ ⏱️ *Geçen Süre:* ${elapsedStr}\n`;
      });
      responseText += '\n';
    } else {
      responseText += `💤 *Şu an aktif indirme yok.*\n\n`;
    }

    if (downloadQueue.length > 0) {
      responseText += `⏳ *Sıradakiler (${downloadQueue.length} adet):*\n`;
      downloadQueue.forEach((t, i) => {
        const waitEst = getEstimatedWaitTime(i);
        const priorityTag = t.priority ? '🔴 [ÖNCELİKLİ] ' : '';
        responseText += `${i + 1}. ${priorityTag}*${t.title}*\n   └ 🕒 Tahmini Başlangıç: ${waitEst}\n`;
      });
    } else {
      responseText += `✨ *Kuyrukta bekleyen görev yok.*`;
    }

    responseText += `\n\n💡 *Hızlı Komutlar:*\n`;
    responseText += `• \`!onceliklendir <id>\` ➔ Görevi başa al\n`;
    responseText += `• \`!iptal <id>\` ➔ Görevi sil\n`;
    responseText += `• \`!kuyruk temizle\` ➔ Her şeyi sıfırla`;

    await sock.sendMessage(from, { text: responseText });
  }
};
