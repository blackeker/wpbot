import { exec } from 'child_process';

export default {
  name: 'guncelle',
  aliases: ['güncelle', 'update'],
  async execute(sock, msg, from, args, ctx) {
    await sock.sendMessage(from, { text: '🔄 Güncelleme kontrol ediliyor...' });
    exec('git pull', (err, stdout) => {
      if (err) {
        sock.sendMessage(from, { text: `❌ Güncelleme başarısız: ${err.message}` });
        return;
      }
      sock.sendMessage(from, { text: `✅ Güncellendi!\n${stdout || 'Zaten güncel.'}\n\nBot yeniden başlatılıyor...` }).then(() => {
        setTimeout(() => process.exit(0), 2000);
      });
    });
  }
};
