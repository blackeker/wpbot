import { sendMenuResponse } from '../utils/menuData.js';

export default {
  name: '22',
  aliases: ['otobus22', 'otobüs22', 'hat22', 'otobus', 'otobüs'],
  async execute(sock, msg, from, args, ctx) {
    const times = [
      '07:45',
      '08:30',
      '09:15',
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
      '17:00'
    ];

    // Calculate current Turkey local time
    const now = new Date();
    const trTimeStr = now.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false });
    const [currentHour, currentMinute] = trTimeStr.split(':').map(Number);
    const currentTotalMinutes = (currentHour * 60) + currentMinute;

    let nextBus = null;
    for (const t of times) {
      const [h, m] = t.split(':').map(Number);
      const busTotalMinutes = (h * 60) + m;
      if (busTotalMinutes >= currentTotalMinutes) {
        nextBus = t;
        break;
      }
    }

    let message = `🚌 *22 NUMARA OTOBÜS SAATLERİ*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    times.forEach(t => {
      if (t === nextBus) {
        message += `👉 *${t}* ⏳ _(Sıradaki Otobüs)_\n`;
      } else {
        message += `• ${t}\n`;
      }
    });
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    if (nextBus) {
      const [nh, nm] = nextBus.split(':').map(Number);
      const diffMinutes = (nh * 60 + nm) - currentTotalMinutes;
      message += `⏱️ *Sıradaki Sefer:* *${nextBus}* (${diffMinutes} dakika sonra)\n`;
    } else {
      message += `ℹ️ _Bugünkü seferler tamamlanmıştır. İlk sefer yarın sabah 07:45'te._\n`;
    }

    await sendMenuResponse(sock, msg, from, message.trim());
  }
};
