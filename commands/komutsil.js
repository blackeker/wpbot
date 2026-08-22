import { deleteSpamCommand } from '../discordApi.js';

export default {
  name: 'komutsil',
  async execute(sock, msg, from, args, ctx) {
    if (args.length < 2) {
      await sock.sendMessage(from, { text: '⚠️ *Kullanım:* `!komutsil <main|alt> <sira_no>`\n*Örn:* `!komutsil alt 1`' });
      return;
    }
    
    const type = args[0].toLowerCase();
    const index = parseInt(args[1], 10);
    
    if (type !== 'main' && type !== 'alt') {
      await sock.sendMessage(from, { text: '❌ Geçersiz tip. `main` veya `alt` kullanın.' });
      return;
    }
    if (isNaN(index) || index <= 0) {
      await sock.sendMessage(from, { text: '❌ Sıra numarası geçerli bir sayı olmalıdır.' });
      return;
    }
    
    try {
      const res = await deleteSpamCommand(type, index - 1);
      if (res.success) {
        await sock.sendMessage(from, { text: `✅ ${type === 'main' ? 'Ana Hesap' : 'Yan Hesaplar'} listesinden ${index}. sıradaki komut silindi.` });
      }
    } catch (e) {
      let errMsg = e.message;
      if (e.response && e.response.data && e.response.data.error) errMsg = e.response.data.error;
      await sock.sendMessage(from, { text: `❌ *Hata:* ${errMsg}` });
    }
  }
};
