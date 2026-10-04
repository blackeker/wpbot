import axios from 'axios';

export default {
  name: 'haber',
  aliases: ['sondakika', 'gundem', 'news'],
  async execute(sock, msg, from, args, ctx) {
    try {
      const response = await axios.get('https://api.rss2json.com/v1/api.json?rss_url=https://www.haberturk.com/rss/gundem.xml', {
        timeout: 10000
      });

      const data = response.data;
      if (!data || !data.items || data.items.length === 0) {
        await sock.sendMessage(from, { text: '❌ Son dakika haberleri alınamadı.' });
        return;
      }

      const items = data.items.slice(0, 7);
      let reply = `📰 *SON DAKİKA GÜNDEM HABERLERİ*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

      const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

      items.forEach((item, idx) => {
        const timeStr = item.pubDate ? item.pubDate.split(' ')[1]?.substring(0, 5) : '';
        reply += `${emojis[idx] || '📌'} *${item.title.trim()}*\n`;
        if (timeStr) reply += `⏱️ _Saat: ${timeStr}_\n`;
        reply += `\n`;
      });

      reply += `⏱️ _Güncellenme: ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}_`;

      await sock.sendMessage(from, { text: reply.trim() });
    } catch (err) {
      console.error('[Haberler] Hata:', err.message);
      await sock.sendMessage(from, { text: '❌ *Hata:* Son dakika haberleri çekilirken bir sorun oluştu.' });
    }
  }
};
