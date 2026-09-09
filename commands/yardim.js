export default {
  name: 'yardim',
  aliases: ['help', 'menu', 'menü', 'yardım', 'rehber'],
  async execute(sock, msg, from, args, ctx) {
    const helpText = 
`🤖 *WP-BOT KULLANIM VE KOMUT REHBERİ*
━━━━━━━━━━━━━━━━━━━━

📥 *İNDİRME VE KUYRUK:*
• *!indir <link>* ➔ Video/Film/Anime/Dosya indirir.
• *!indir <link1> <link2>* ➔ Otomatik dizi aralığı indirir.
• *!kuyruk* ➔ İndirme kuyruğunu ve kalan süreleri gösterir.
• *!iptal <id>* ➔ Belirtilen indirme görevini iptal eder.
• *!dur* / *!devam* ➔ İndirme kuyruğunu durdurur / devam ettirir.
• *!temizle* ➔ Tamamlanmış / iptal edilmiş kuyruğu temizler.

🌤️ *GÜNLÜK BİLGİ VE FİNANS:*
• *!hava [şehir]* ➔ Canlı hava durumu (Varsayılan: Elazığ).
• *!doviz* / *!dolar* / *!altin* / *!btc* ➔ Canlı kurlar & altın fiyatları.
• *!eczane [şehir]* ➔ Nöbetçi eczaneler (Varsayılan: Elazığ).
• *!haber* ➔ Son dakika gündem haberleri.
• *!namaz [şehir]* ➔ Namaz vakitleri & kalan zaman geri sayımı.
• *!deprem* ➔ Kandilli Rasathanesi son depremler.

🧰 *FAYDALI ARAÇLAR:*
• *!hatirlat <süre> <not>* ➔ Hatırlatıcı kurar (Örn: \`!hatirlat 10dk su iç\`).
• *!qr <metin/link>* ➔ Anında QR kod resmi oluşturur.
• *!kisalt <link>* ➔ Uzun linkleri kısaltır.
• *!sozluk <kelime>* ➔ TDK Türkçe sözlük anlamı.
• *!wiki <konu>* ➔ Vikipedi özet arama.

📊 *SİSTEM VE DURUM:*
• *!durum* ➔ Bot aktiflik ve sunucu durumu.
• *!disk* ➔ Sunucu disk ve depolama kullanımı.
• *!gecmis* ➔ Tamamlanan son 10 indirme kaydı.
• *!hiz* ➔ Anlık indirme hızı.
• *!hatalar* ➔ Son oluşan işlem hataları.
• *!guncelle* ➔ Bot dosyalarını en son sürüme günceller.

━━━━━━━━━━━━━━━━━━━━
💡 _İpucu: Herhangi bir desteklenen linki doğrudan mesaja yapıştırarak da indirmeyi başlatabilirsiniz!_`;

    await sock.sendMessage(from, { text: helpText });
  }
};
