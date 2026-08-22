import { writeConfig, setupPingTimer } from '../config.js';

export default {
  name: 'pingurl',
  async execute(sock, msg, from, args, ctx) {
    if (args.length < 1) {
      await sock.sendMessage(from, { text: `Mevcut Ping URL: \`${ctx.botState.pingUrl || 'Ayarlanmamış'}\`\n\nAyarlamak için: \`!pingurl https://linkiniz.com\`` });
      return;
    }

    const newUrl = args[0].trim();
    if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
      await sock.sendMessage(from, { text: '❌ Geçersiz URL. URL `http://` veya `https://` ile başlamalıdır.' });
      return;
    }

    ctx.botState.pingUrl = newUrl;
    writeConfig({ pingUrl: newUrl });
    setupPingTimer(newUrl);

    await sock.sendMessage(from, { text: `✅ Canlı tutma adresi güncellendi ve kaydedildi:\n\`${newUrl}\`` });
  }
};
