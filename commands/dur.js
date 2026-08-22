import { pauseQueue } from '../queue.js';

export default {
  name: 'dur',
  aliases: ['durdur', 'bekle', 'pause'],
  async execute(sock, msg, from, args, ctx) {
    pauseQueue();
    await sock.sendMessage(from, { text: `⏸️ *Kuyruk duraklatıldı!*\nAktif indirme tamamlanacak ama yeni görev başlamayacak.\nDevam ettirmek için: *devam* yaz` });
  }
};
