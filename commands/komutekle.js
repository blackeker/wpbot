import { addSpamCommand } from '../discordApi.js';

export default {
  name: 'komutekle',
  async execute(sock, msg, from, args, ctx) {
    if (args.length < 4) {
      await sock.sendMessage(from, { text: '⚠️ *Kullanım:* `!komutekle <main|alt> <metin> <minDelay_saniye> <maxDelay_saniye>`\n*Örn:* `!komutekle alt +c 7 8`' });
      return;
    }
    
    const type = args[0].toLowerCase();
    const cmdMetin = args[1];
    const minS = parseFloat(args[2]);
    const maxS = parseFloat(args[3]);
    
    if (type !== 'main' && type !== 'alt') {
      await sock.sendMessage(from, { text: '❌ Geçersiz tip. `main` veya `alt` kullanın.' });
      return;
    }
    if (isNaN(minS) || isNaN(maxS)) {
      await sock.sendMessage(from, { text: '❌ Süreler sayısal olmalıdır.' });
      return;
    }
    
    try {
      const payload = {
        text: cmdMetin,
        minDelay: minS * 1000,
        maxDelay: maxS * 1000
      };
      
      const res = await addSpamCommand(type, payload);
      if (res.success) {
        await sock.sendMessage(from, { text: `✅ *Komut Eklendi (${type}):* \`${cmdMetin}\` (${minS}s - ${maxS}s)` });
      } else {
        await sock.sendMessage(from, { text: `❌ Komut eklenemedi.` });
      }
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ *Hata:* ${e.message}` });
    }
  }
};
