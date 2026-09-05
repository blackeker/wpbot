import axios from 'axios';

function toCitySlug(str) {
  if (!str) return 'Elazig';
  const slug = str
    .trim()
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export default {
  name: 'namaz',
  aliases: ['ezan', 'vakit', 'namazvakti'],
  async execute(sock, msg, from, args, ctx) {
    const cityInput = args && args.length > 0 ? args.join(' ').trim() : 'Elazığ';
    const citySlug = toCitySlug(cityInput);

    try {
      const response = await axios.get(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(citySlug)}&country=Turkey&method=13`, {
        timeout: 10000
      });

      const data = response.data?.data;
      if (!data || !data.timings) {
        await sock.sendMessage(from, { text: `❌ *${cityInput}* için namaz vakitleri alınamadı.` });
        return;
      }

      const t = data.timings;
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const prayerList = [
        { name: 'İmsak', time: t.Fajr },
        { name: 'Güneş', time: t.Sunrise },
        { name: 'Öğle', time: t.Dhuhr },
        { name: 'İkindi', time: t.Asr },
        { name: 'Akşam', time: t.Maghrib },
        { name: 'Yatsı', time: t.Isha }
      ];

      let nextInfo = '';
      for (const item of prayerList) {
        const [h, m] = item.time.split(':').map(Number);
        const itemMinutes = h * 60 + m;
        if (itemMinutes > currentMinutes) {
          const diff = itemMinutes - currentMinutes;
          const dh = Math.floor(diff / 60);
          const dm = diff % 60;
          const timeStr = dh > 0 ? `${dh} saat ${dm} dk` : `${dm} dk`;
          nextInfo = `⏳ *Sıradaki Vakit:* ${item.name} (${item.time}) — *${timeStr} kaldı*`;
          break;
        }
      }

      if (!nextInfo) {
        const [h, m] = prayerList[0].time.split(':').map(Number);
        const itemMinutes = (24 * 60) + (h * 60 + m);
        const diff = itemMinutes - currentMinutes;
        const dh = Math.floor(diff / 60);
        const dm = diff % 60;
        const timeStr = dh > 0 ? `${dh} saat ${dm} dk` : `${dm} dk`;
        nextInfo = `⏳ *Sıradaki Vakit:* İmsak (${prayerList[0].time}) — *${timeStr} kaldı*`;
      }

      const cityName = cityInput.toUpperCase();
      let reply = `🕌 *NAMAZ VAKİTLERİ — ${cityName}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      reply += `🌅 *İmsak:* ${t.Fajr}\n`;
      reply += `☀️ *Güneş:* ${t.Sunrise}\n`;
      reply += `🏙️ *Öğle:* ${t.Dhuhr}\n`;
      reply += `🌆 *İkindi:* ${t.Asr}\n`;
      reply += `🌇 *Akşam:* ${t.Maghrib}\n`;
      reply += `🌃 *Yatsı:* ${t.Isha}\n\n`;
      reply += `${nextInfo}\n\n`;
      reply += `⏱️ _Tarih: ${data.date?.gregorian?.date || new Date().toLocaleDateString('tr-TR')}_`;

      await sock.sendMessage(from, { text: reply.trim() });
    } catch (err) {
      console.error('[Namaz Vakitleri] Hata:', err.message);
      await sock.sendMessage(from, { text: `❌ *Hata:* Namaz vakitleri çekilemedi (${cityInput}). Şehir adını kontrol edin.` });
    }
  }
};
