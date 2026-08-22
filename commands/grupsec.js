import { writeConfig, readConfig } from '../config.js';

export default {
  name: 'grupseç',
  aliases: ['grupsec', 'grup'],
  async execute(sock, msg, from, args, ctx) {
    if (args.length < 1) {
      const config = readConfig();
      const currentGroup = config.groupJid;
      if (currentGroup) {
        await sock.sendMessage(from, { text: `📢 *Kayıtlı Grup (Kendi mesajlarını algılamayacağı grup):*\n\`${currentGroup}\`\n\nDeğiştirmek: \`!grupseç burası\` (grupta yaz)\nSilmek: \`!grupseç sil\`\nManuel JID: \`!grupseç <grup JID>\`` });
      } else {
        await sock.sendMessage(from, { text: `📢 *Kayıtlı grup ayarlanmamış.*\n\nBir grupta \`!grupseç burası\` yazarak o grubu kaydedebilirsin.\nVeya: \`!grupseç <grup JID>\`` });
      }
      return;
    }

    const arg = args[0].toLowerCase();
    if (arg === 'burası' || arg === 'burasi' || arg === 'bura' || arg === 'here') {
      if (!from.endsWith('@g.us')) {
        await sock.sendMessage(from, { text: '❌ Bu komut sadece grup sohbetlerinde çalışır. Lütfen bir grupta deneyin.' });
        return;
      }
      writeConfig({ groupJid: from });
      await sock.sendMessage(from, { text: `✅ *Bu grup kayıtlı grup olarak ayarlandı!*\n\nBotun bu grupta kendi mesajlarını algılaması engellendi.\nGrup JID: \`${from}\`` });
      return;
    }

    if (arg === 'sil' || arg === 'kaldır' || arg === 'kaldir' || arg === 'remove') {
      writeConfig({ groupJid: '' });
      await sock.sendMessage(from, { text: '✅ Kayıtlı grup ayarı kaldırıldı.' });
      return;
    }

    const jid = args[0].trim();
    writeConfig({ groupJid: jid });
    await sock.sendMessage(from, { text: `✅ *Kayıtlı grup ayarlandı:*\n\`${jid}\`` });
  }
};
