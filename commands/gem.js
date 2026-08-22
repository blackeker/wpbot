import { updateSystemSettings } from '../discordApi.js';

export default {
  name: 'gem',
  async execute(sock, msg, from, args, ctx) {
    if (args.length < 1) {
      await sock.sendMessage(from, { text: '⚠️ *Kullanım:* `!gem <ac|kapat>` veya `!gem <aç|kapat>`' });
      return;
    }
    const action = args[0].toLowerCase();
    const enabled = (action === 'ac' || action === 'aç' || action === 'on' || action === 'true');
    
    try {
      const res = await updateSystemSettings('gem', enabled);
      if (res.success) {
        await sock.sendMessage(from, { text: `💎 *Auto Gem Sistemi:* ${enabled ? '🟢 AKTİF (Açık)' : '🔴 PASİF (Kapalı)'}` });
      } else {
        await sock.sendMessage(from, { text: `❌ Sistem güncellenemedi.` });
      }
    } catch (e) {
      await sock.sendMessage(from, { text: `❌ *Hata:* Bağlantı sorunu.\n${e.message}` });
    }
  }
};
