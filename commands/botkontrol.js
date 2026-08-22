import { controlMainBot, controlAltBots } from '../discordApi.js';

export default {
  name: 'botkontrol',
  async execute(sock, msg, from, args, ctx) {
    if (args.length < 2) {
      await sock.sendMessage(from, { text: '⚠️ *Kullanım:* `!botkontrol <main|alts> <start|stop|toggle>`' });
      return;
    }
    const target = args[0].toLowerCase();
    const action = args[1].toLowerCase();
    
    try {
      if (target === 'main') {
        const res = await controlMainBot(action);
        await sock.sendMessage(from, { text: `✅ Ana bot kontrolü gönderildi. Durum: ${res.isRunning ? '🟢 Çalışıyor' : '🔴 Durduruldu'}` });
      } else if (target === 'alts') {
        const actionMap = { start: 'startAll', stop: 'stopAll' };
        const act = actionMap[action] || action;
        const res = await controlAltBots(act);
        await sock.sendMessage(from, { text: `✅ Yan botlar kontrolü gönderildi. Aktif hesap: ${res.activeAltsCount}` });
      } else {
        await sock.sendMessage(from, { text: '❌ Geçersiz hedef. `main` veya `alts` seçin.' });
      }
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ *Hata:* Bağlantı sorunu.\n${e.message}` });
    }
  }
};
