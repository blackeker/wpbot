function parseDuration(str) {
  if (!str) return null;
  const m = str.match(/^(\d+)\s*(s|sec|sn|dk|m|min|saat|sa|h)$/i);
  if (!m) return null;
  const val = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (['s', 'sec', 'sn'].includes(unit)) return { ms: val * 1000, label: `${val} saniye` };
  if (['dk', 'm', 'min'].includes(unit)) return { ms: val * 60 * 1000, label: `${val} dakika` };
  if (['saat', 'sa', 'h'].includes(unit)) return { ms: val * 3600 * 1000, label: `${val} saat` };
  return null;
}

export default {
  name: 'hatirlat',
  aliases: ['alarm', 'remind', 'hatirlatma'],
  async execute(sock, msg, from, args, ctx) {
    if (!args || args.length < 2) {
      await sock.sendMessage(from, { text: '📌 Kullanım: `!hatirlat <süre> <mesaj>`\nÖrnek: `!hatirlat 10dk fırını kapat` veya `!hatirlat 30sn su iç`\nSüre birimleri: `sn`, `dk`, `saat`' });
      return;
    }

    const durationInput = args[0];
    const parsed = parseDuration(durationInput);

    if (!parsed) {
      await sock.sendMessage(from, { text: '❌ Geçersiz süre formatı! Örnek: `10dk`, `30sn`, `2saat`' });
      return;
    }

    const reminderText = args.slice(1).join(' ').trim();

    await sock.sendMessage(from, {
      text: `⏰ *HATIRLATICI KURULDU*\n━━━━━━━━━━━━━━━━━━━━\n⏱️ *Süre:* ${parsed.label}\n📝 *Not:* ${reminderText}\n\n_Süre dolduğunda size haber vereceğim!_`
    });

    setTimeout(async () => {
      try {
        await sock.sendMessage(from, {
          text: `🔔 *HATIRLATMA ZAMANI!* 🔔\n━━━━━━━━━━━━━━━━━━━━\n📝 *Notunuz:* ${reminderText}\n⏱️ *Geçen Süre:* ${parsed.label}`
        });
      } catch (err) {
        console.error('[Hatırlatıcı] Gönderim hatası:', err.message);
      }
    }, parsed.ms);
  }
};
