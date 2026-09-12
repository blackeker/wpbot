import { botSocketRef } from '../config.js';

export default {
  name: 'mesaj',
  aliases: ['msg', 'sms', 'gonder', 'gönder', 'dm', 'ozelmesaj'],
  async execute(sock, msg, from, args, ctx) {
    if (args.length < 2) {
      await sock.sendMessage(from, {
        text: '⚠️ *KULLANIM:* `!mesaj <telefon_numarası> <mesaj_metni>`\n━━━━━━━━━━━━━━━━━━━━\n' +
              '💡 *Örnek:* `!mesaj 05551234567 Merhaba, bu bir test mesajıdır.`\n' +
              '💡 *Örnek 2:* `!mesaj 905551234567 Deneme mesajı`'
      });
      return;
    }

    const targetRaw = args[0].replace(/[^0-9]/g, '');
    const messageText = args.slice(1).join(' ').trim();

    if (!targetRaw || targetRaw.length < 10) {
      await sock.sendMessage(from, {
        text: '❌ *Hata:* Geçersiz telefon numarası. Lütfen en az 10 haneli geçerli bir numara girin (Örn: `05551234567`).'
      });
      return;
    }

    // Format number to 90XXXXXXXXXX@s.whatsapp.net
    let cleanedNumber = targetRaw;
    if (cleanedNumber.startsWith('0')) {
      cleanedNumber = '90' + cleanedNumber.slice(1);
    } else if (!cleanedNumber.startsWith('90') && cleanedNumber.length === 10) {
      cleanedNumber = '90' + cleanedNumber;
    }

    const targetJid = `${cleanedNumber}@s.whatsapp.net`;

    try {
      const activeSock = sock || botSocketRef.current;
      if (!activeSock) {
        throw new Error('WhatsApp bağlantısı bulunamadı.');
      }

      await activeSock.sendMessage(targetJid, { text: messageText });

      await activeSock.sendMessage(from, {
        text: `✅ *Başarılı!* Mesaj iletildi.\n━━━━━━━━━━━━━━━━━━━━\n👤 *Alıcı:* +${cleanedNumber}\n💬 *Mesaj:* ${messageText}`
      });
    } catch (err) {
      console.error('[Mesaj Gönder] Hata:', err.message);
      await sock.sendMessage(from, {
        text: `❌ *Hata:* Mesaj gönderilirken bir sorun oluştu: ${err.message}`
      });
    }
  }
};
