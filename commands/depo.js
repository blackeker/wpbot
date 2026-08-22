import { writeConfig } from '../config.js';

export default {
  name: 'depo',
  async execute(sock, msg, from, args, ctx) {
    if (args.length < 1) {
      const currentDepot = ctx.config.depotGroupJid;
      if (currentDepot) {
        await sock.sendMessage(from, { text: `📦 *Mevcut Depo Grubu:*\n\`${currentDepot}\`\n\nDeğiştirmek: \`!depo burası\` (grupta yaz)\nSilmek: \`!depo sil\`\nManuel: \`!depo <grup JID>\`` });
      } else {
        await sock.sendMessage(from, { text: `📦 *Depo grubu ayarlanmamış.*\n\nBir grupta \`!depo burası\` yazarak o grubu depo yapabilirsin.\nVeya: \`!depo <grup JID>\`` });
      }
      return;
    }

    const arg = args[0].toLowerCase();
    if (arg === 'burası' || arg === 'burasi' || arg === 'bura' || arg === 'here') {
      if (!from.endsWith('@g.us')) {
        await sock.sendMessage(from, { text: '❌ Bu komut sadece grup sohbetlerinde çalışır. Lütfen bir grupta deneyin.' });
        return;
      }
      writeConfig({ depotGroupJid: from });
      await sock.sendMessage(from, { text: `✅ *Bu grup depo olarak ayarlandı!*\n\nBundan sonra indirilen tüm dosyalar bu gruba da gönderilecek.\nGrup JID: \`${from}\`` });
      return;
    }

    if (arg === 'sil' || arg === 'kaldır' || arg === 'kaldir' || arg === 'remove') {
      writeConfig({ depotGroupJid: '' });
      await sock.sendMessage(from, { text: '✅ Depo grubu ayarı kaldırıldı. Dosyalar artık sadece isteği yapana gönderilecek.' });
      return;
    }

    const jid = args[0].trim();
    writeConfig({ depotGroupJid: jid });
    await sock.sendMessage(from, { text: `✅ *Depo grubu ayarlandı:*\n\`${jid}\`\n\nTüm indirilen dosyalar bu gruba da gönderilecek.` });
  }
};
