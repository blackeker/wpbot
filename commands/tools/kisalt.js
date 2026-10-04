import axios from 'axios';

export default {
  name: 'kisalt',
  aliases: ['shorten', 'shorturl', 'linkkisalt'],
  async execute(sock, msg, from, args, ctx) {
    if (!args || args.length === 0) {
      await sock.sendMessage(from, { text: '🔗 Lütfen kısaltmak istediğiniz uzun linki yazın.\nÖrnek: `!kisalt https://www.google.com/search?q=elazig`' });
      return;
    }

    let url = args[0].trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    try {
      const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {
        timeout: 10000
      });

      const shortUrl = response.data ? String(response.data).trim() : null;
      if (!shortUrl || !shortUrl.startsWith('http')) {
        await sock.sendMessage(from, { text: '❌ Link kısaltılamadı. Geçerli bir URL girdiğinizden emin olun.' });
        return;
      }

      let reply = `🔗 *LINK KISALTILDI*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      reply += `✂️ *Kısa Link:* ${shortUrl}\n`;
      reply += `🌐 *Orijinal Link:* _${url.slice(0, 60)}${url.length > 60 ? '...' : ''}_`;

      await sock.sendMessage(from, { text: reply.trim() });
    } catch (err) {
      console.error('[Link Kısalt] Hata:', err.message);
      await sock.sendMessage(from, { text: '❌ *Hata:* Link kısaltılırken bir sorun oluştu.' });
    }
  }
};
