import { activeTask } from '../queue.js';

export default {
  name: 'hiz',
  aliases: ['hız', 'hız ne', 'nasıl gidiyor'],
  async execute(sock, msg, from, args, ctx) {
    if (activeTask.current && activeTask.current.speed) {
      const elapsed = activeTask.current.startTime ? Math.round((Date.now() - activeTask.current.startTime) / 1000) : 0;
      const elapsedStr = elapsed > 60 ? `${Math.floor(elapsed/60)}dk ${elapsed%60}sn` : `${elapsed}sn`;
      await sock.sendMessage(from, { text: `⚡ *Anlık hız: ~${activeTask.current.speed} MB/s*\n🎬 ${activeTask.current.title}\n⏳ ${elapsedStr} geçti\n📊 ${activeTask.current.status || 'Başlatılıyor...'}` });
    } else if (activeTask.current) {
      await sock.sendMessage(from, { text: `⏳ İndirme devam ediyor...\n🎬 ${activeTask.current.title}\n📊 ${activeTask.current.status || 'Başlatılıyor...'}` });
    } else {
      await sock.sendMessage(from, { text: '💤 Şu an aktif indirme yok.' });
    }
  }
};
