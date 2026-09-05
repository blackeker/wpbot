import axios from 'axios';

function getMagEmoji(mag) {
  const m = parseFloat(mag);
  if (m >= 5.0) return '🚨';
  if (m >= 4.0) return '🔴';
  if (m >= 3.0) return '🟠';
  return '🟡';
}

export default {
  name: 'deprem',
  aliases: ['kandilli', 'afad', 'sondepremler'],
  async execute(sock, msg, from, args, ctx) {
    try {
      const response = await axios.get('https://api.orhanaydogdu.com.tr/deprem/kandilli/live', {
        timeout: 10000
      });

      const data = response.data;
      if (!data || !data.result || data.result.length === 0) {
        await sock.sendMessage(from, { text: '❌ Son deprem verileri alınamadı.' });
        return;
      }

      const list = data.result.slice(0, 6);
      let reply = `🌋 *SON DEPREMLER (KANDİLLİ RASATHANESİ)*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

      const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];

      list.forEach((item, idx) => {
        const magEmoji = getMagEmoji(item.mag);
        const timeStr = item.date_time ? item.date_time.split(' ')[1]?.substring(0, 5) : '';
        reply += `${numEmojis[idx] || '📌'} ${magEmoji} *${item.mag} M* — ${item.title}\n`;
        reply += `📍 *Derinlik:* ${item.depth} km | ⏱️ *Saat:* ${timeStr}\n\n`;
      });

      reply += `⏱️ _Güncellenme: ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}_`;

      await sock.sendMessage(from, { text: reply.trim() });
    } catch (err) {
      console.error('[Deprem] Hata:', err.message);
      await sock.sendMessage(from, { text: '❌ *Hata:* Son deprem verileri çekilirken bir sorun oluştu.' });
    }
  }
};
