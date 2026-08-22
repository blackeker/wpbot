import { resumeQueue, downloadQueue } from '../queue.js';

export default {
  name: 'devam',
  aliases: ['başlat', 'resume'],
  async execute(sock, msg, from, args, ctx) {
    resumeQueue();
    await sock.sendMessage(from, { text: `▶️ *Kuyruk devam ediyor!*\n${downloadQueue.length > 0 ? `Sırada ${downloadQueue.length} görev var.` : 'Kuyruk boş.'}` });
  }
};
