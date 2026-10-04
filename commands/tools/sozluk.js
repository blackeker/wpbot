import axios from 'axios';

export default {
  name: 'sozluk',
  aliases: ['tdk', 'kelime', 'anlam'],
  async execute(sock, msg, from, args, ctx) {
    if (!args || args.length === 0) {
      await sock.sendMessage(from, { text: '📖 Lütfen anlamını öğrenmek istediğiniz kelimeyi yazın.\nÖrnek: `!sozluk müteşekkir` veya `!tdk araba`' });
      return;
    }

    const word = args.join(' ').trim();

    try {
      const response = await axios.get(`https://sozluk.gov.tr/gts?ara=${encodeURIComponent(word)}`, {
        timeout: 10000
      });

      const data = response.data;
      if (!data || !Array.isArray(data) || data.length === 0 || data.error) {
        await sock.sendMessage(from, { text: `❌ *${word}* kelimesi TDK sözlüğünde bulunamadı.` });
        return;
      }

      const item = data[0];
      const meanings = item.anlamlarListe ? item.anlamlarListe.map(a => a.anlam) : [];

      if (meanings.length === 0) {
        await sock.sendMessage(from, { text: `❌ *${word}* için anlam bilgisi alınamadı.` });
        return;
      }

      let reply = `📖 *TDK TÜRKÇE SÖZLÜK — ${item.madde.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      if (item.lisan) reply += `🔤 *Köken:* _${item.lisan}_\n\n`;

      meanings.forEach((m, idx) => {
        reply += `🔹 *${idx + 1}.* ${m}\n`;
      });

      await sock.sendMessage(from, { text: reply.trim() });
    } catch (err) {
      console.error('[TDK Sözlük] Hata:', err.message);
      await sock.sendMessage(from, { text: `❌ *Hata:* TDK sözlük sorgusu yapılamadı (${word}).` });
    }
  }
};
