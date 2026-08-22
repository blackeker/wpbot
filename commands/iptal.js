import { cancelDownloadTask } from '../queue.js';

export default {
  name: 'iptal',
  aliases: ['cancel', 'durdur aktif', 'aktifi iptal'],
  async execute(sock, msg, from, args, ctx) {
    const isCancelActive = ctx.ltext === 'iptal' || ctx.ltext === 'durdur aktif' || ctx.ltext === 'aktifi iptal' || ctx.ltext === 'cancel';
    let query;
    if (isCancelActive || args.length === 0) {
      query = 'aktif';
    } else {
      query = args[0].trim();
    }

    const cancelledTask = cancelDownloadTask(query);

    if (cancelledTask) {
      await sock.sendMessage(from, { text: `✅ *"${cancelledTask.title}"* iptal edildi.` });
    } else {
      await sock.sendMessage(from, { text: `❌ Bu numarada bir görev bulunamadı. Görevleri görmek için *kuyruk* yaz.` });
    }
  }
};
