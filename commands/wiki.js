import axios from 'axios';

export default {
  name: 'wiki',
  aliases: ['wikipedia', 'vikipedi'],
  async execute(sock, msg, from, args, ctx) {
    if (!args || args.length === 0) {
      await sock.sendMessage(from, { text: '📚 Lütfen aratmak istediğiniz konuyu yazın.\nÖrnek: `!wiki Elazığ` veya `!wikipedia Görelilik Teorisi`' });
      return;
    }

    const query = args.join(' ').trim();

    try {
      const response = await axios.get(`https://tr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      const data = response.data;
      if (!data || !data.extract) {
        await sock.sendMessage(from, { text: `❌ *${query}* hakkında Vikipedi bilgisi bulunamadı.` });
        return;
      }

      let reply = `📚 *VİKİPEDİ — ${data.title.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      reply += `${data.extract}\n\n`;
      if (data.content_urls && data.content_urls.desktop) {
        reply += `🔗 *Detaylı Oku:* ${data.content_urls.desktop.page}`;
      }

      await sock.sendMessage(from, { text: reply.trim() });
    } catch (err) {
      console.error('[Vikipedi] Hata:', err.message);
      await sock.sendMessage(from, { text: `❌ *Hata:* Vikipedi'de *${query}* başlığı bulunamadı veya bir sorun oluştu.` });
    }
  }
};
