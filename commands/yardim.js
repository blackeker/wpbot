export default {
  name: 'yardim',
  aliases: ['help', 'menu', 'menü', 'yardım', 'rehber'],
  async execute(sock, msg, from, args, ctx) {
    const helpText = 
`🤖 *WP-BOT KOMUT MERKEZİ*
━━━━━━━━━━━━━━━━━━━━

📥 *İndirme:*
• \`!indir <link>\` ➔ Video/Film/Dizi/MP3/Torrent indirir
• \`!kuyruk\` | \`!dur\` | \`!devam\` | \`!iptal <id>\` | \`!temizle\`

🎓 *Üniversite & Yurt:*
• \`!uniyemek\` ➔ Fırat Üni yemekhane menüsü
• \`!kahvalti\` | \`!aksam\` | \`!yemek\` ➔ KYK yemek menüsü
• \`!takvim\` | \`!vize\` | \`!final\` | \`!but\` | \`!tatil\` ➔ Sınav/Tatil sayaçları
• \`!22\` ➔ 22 numara otobüs saatleri & geri sayım
• \`!adres\` ➔ Ahmet Kabaklı KYK Yurdu konumu

🌤️ *Günlük & Finans:*
• \`!hava\` | \`!eczane\` | \`!namaz\` ➔ Şehir/Elazığ bilgileri
• \`!doviz\` | \`!altin\` | \`!btc\` | \`!haber\` | \`!deprem\`

🧰 *Araçlar & AI:*
• \`!otocoz\` | \`!captcha\` | \`!coz <kod>\` ➔ Captcha AI çözücü
• \`!hatirlat <süre> <not>\` | \`!qr <link>\` | \`!kisalt <link>\`
• \`!sozluk <kelime>\` | \`!wiki <konu>\` | \`!mesaj <no> <metin>\`

📊 *Sistem:*
• \`!durum\` | \`!disk\` | \`!hiz\` | \`!gecmis\` | \`!guncelle\`
━━━━━━━━━━━━━━━━━━━━
💡 _Desteklenen linkleri doğrudan göndererek de indirme başlatabilirsiniz._`;

    await sock.sendMessage(from, { text: helpText });
  }
};
