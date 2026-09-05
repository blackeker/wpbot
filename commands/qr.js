import QRCode from 'qrcode';

export default {
  name: 'qr',
  aliases: ['qrcode', 'qrolustur'],
  async execute(sock, msg, from, args, ctx) {
    if (!args || args.length === 0) {
      await sock.sendMessage(from, { text: '📱 Lütfen QR koda dönüştürmek istediğiniz metni veya linki yazın.\nÖrnek: `!qr https://google.com` veya `!qr Hoşgeldiniz` ' });
      return;
    }

    const inputData = args.join(' ').trim();

    try {
      const qrBuffer = await QRCode.toBuffer(inputData, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        margin: 2,
        scale: 8
      });

      await sock.sendMessage(from, {
        image: qrBuffer,
        caption: `📱 *QR KOD OLUŞTURULDU*\n━━━━━━━━━━━━━━━━━━━━\n📄 *İçerik:* \`${inputData}\``
      });
    } catch (err) {
      console.error('[QR Kod] Hata:', err.message);
      await sock.sendMessage(from, { text: '❌ *Hata:* QR kod oluşturulurken bir sorun oluştu.' });
    }
  }
};
