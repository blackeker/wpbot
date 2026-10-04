export default {
  name: 'yardim',
  aliases: ['help', 'menu', 'menü', 'yardım', 'rehber'],
  async execute(sock, msg, from, args = [], ctx = {}) {
    const rawCategory = (args[0] || '').toLowerCase().trim();

    // 1. İNDİRME & MEDYA
    if (['1', 'indir', 'indirme', 'medya', 'video'].includes(rawCategory)) {
      const text = 
`📥 *İNDİRME VE MEDYA KOMUTLARI*
━━━━━━━━━━━━━━━━━━━━
• *!indir <link>* ➔ Video, Dizi, Film, MP3 veya Torrent indirir.
• *!indir <link1> <link2>* ➔ Dizi/Anime bölüm aralığı indirir.
• *!kuyruk* ➔ İndirme sırasını ve durumunu gösterir.
• *!iptal <id>* ➔ Görevi iptal eder.
• *!dur* / *!devam* ➔ Kuyruğu duraklatır / devam ettirir.
• *!temizle* ➔ Tamamlanan/iptal olan kuyruğu temizler.
• *!tekrargonder <id>* ➔ İndirilen medyayı tekrar gönderir.
━━━━━━━━━━━━━━━━━━━━
💡 _Desteklenen linkleri doğrudan mesaja atarak da indirebilirsiniz._`;
      await sock.sendMessage(from, { text });
      return;
    }

    // 2. ÜNİVERSİTE & YURT
    if (['2', 'uni', 'üniversite', 'universite', 'okul', 'yurt', 'firat', 'fırat'].includes(rawCategory)) {
      const text = 
`🎓 *FIRAT ÜNİVERSİTESİ & YURT KOMUTLARI*
━━━━━━━━━━━━━━━━━━━━
• *!uniyemek* ➔ Fırat Üniversitesi yemekhane menüsü.
• *!kahvalti* ➔ KYK günün kahvaltı menüsü.
• *!aksam* ➔ KYK günün akşam yemeği menüsü.
• *!yemek* ➔ KYK tam gün menüsü.
• *!takvim* ➔ 2026-2027 Akademik Takvim & Önemli tarihler.
• *!vize* / *!final* / *!but* ➔ Sınav sayaçları & kalan gün.
• *!tatil* ➔ Resmi tatil ve bayramlar geri sayımı.
• *!22* ➔ 22 numara otobüs saatleri & sıradaki sefer sayacı.
• *!adres* ➔ Ahmet Kabaklı KYK Yurdu adresi ve konumu.
━━━━━━━━━━━━━━━━━━━━`;
      await sock.sendMessage(from, { text });
      return;
    }

    // 3. GÜNLÜK BİLGİ & FİNANS
    if (['3', 'bilgi', 'gunluk', 'günlük', 'finans', 'haber'].includes(rawCategory)) {
      const text = 
`🌤️ *GÜNLÜK BİLGİ VE FİNANS KOMUTLARI*
━━━━━━━━━━━━━━━━━━━━
• *!hava [şehir]* ➔ Anlık hava durumu (Varsayılan: Elazığ).
• *!doviz* / *!altin* / *!btc* ➔ Canlı piyasa kurları.
• *!eczane [şehir]* ➔ Nöbetçi eczaneler listesi.
• *!namaz [şehir]* ➔ Vakitler & sonraki vakte kalan süre.
• *!haber* ➔ Son dakika gündem başlıkları.
• *!deprem* ➔ Kandilli Rasathanesi son depremler.
━━━━━━━━━━━━━━━━━━━━`;
      await sock.sendMessage(from, { text });
      return;
    }

    // 4. ARAÇLAR & AI
    if (['4', 'arac', 'araç', 'araclar', 'araçlar', 'ai'].includes(rawCategory)) {
      const text = 
`🧰 *FAYDALI ARAÇLAR & YAPAY ZEKA*
━━━━━━━━━━━━━━━━━━━━
• *!ciz <açıklama>* ➔ Yapay zeka ile görsel üretir _(DM Only / Adım Adım Sihirbaz)_.
• *!hatirlat <süre> <not>* ➔ Hatırlatıcı kurar (Örn: \`!hatirlat 15dk fırını kapat\`).
• *!qr <metin/link>* ➔ Anında QR kod oluşturur.
• *!kisalt <link>* ➔ Link kısaltır.
• *!sozluk <kelime>* ➔ TDK sözlük anlamı.
• *!wiki <konu>* ➔ Vikipedi özeti.
━━━━━━━━━━━━━━━━━━━━`;
      await sock.sendMessage(from, { text });
      return;
    }

    // 5. SİSTEM & YÖNETİM
    if (['5', 'sistem', 'durum', 'sunucu', 'admin', 'yetki', 'izin'].includes(rawCategory)) {
      const text = 
`📊 *SİSTEM VE YÖNETİM KOMUTLARI*
━━━━━━━━━━━━━━━━━━━━
• *!izin* / *!yetki* ➔ Grup izinlerini ve kapalı komutları yönetir.
• *!izin kapat <komut|kategori>* ➔ Komutu/kategoriyi bu grupta kapatır.
• *!izin ac <komut|kategori>* ➔ Komutu/kategoriyi bu grupta açar.
• *!durum* ➔ Bot aktifliği ve çalışma süresi.
• *!disk* ➔ Sunucu depolama ve boş alan durumu.
• *!hiz* ➔ Anlık indirme hızı.
• *!gecmis* ➔ Tamamlanan son 10 indirme kaydı.
• *!hatalar* ➔ Son oluşan işlem hataları.
• *!guncelle* ➔ Bot kodlarını en son sürüme günceller.
━━━━━━━━━━━━━━━━━━━━`;
      await sock.sendMessage(from, { text });
      return;
    }

    // 6. TÜMÜ / HEPSİ
    if (['hepsi', 'tümü', 'tumu', 'full', 'all'].includes(rawCategory)) {
      const text = 
`🤖 *TÜM KOMUTLAR*
━━━━━━━━━━━━━━━━━━━━
📥 *İndirme:* \`!indir\`, \`!kuyruk\`, \`!dur\`, \`!devam\`, \`!iptal\`, \`!temizle\`, \`!tekrargonder\`
🎓 *Üniversite:* \`!uniyemek\`, \`!kahvalti\`, \`!aksam\`, \`!yemek\`, \`!takvim\`, \`!vize\`, \`!final\`, \`!but\`, \`!tatil\`, \`!22\`, \`!adres\`
🌤️ *Günlük:* \`!hava\`, \`!eczane\`, \`!namaz\`, \`!doviz\`, \`!altin\`, \`!btc\`, \`!haber\`, \`!deprem\`
🧰 *Araçlar & AI:* \`!ciz\`, \`!hatirlat\`, \`!qr\`, \`!kisalt\`, \`!sozluk\`, \`!wiki\`
📊 *Sistem & İzin:* \`!durum\`, \`!disk\`, \`!hiz\`, \`!gecmis\`, \`!hatalar\`, \`!izin\`, \`!guncelle\`
━━━━━━━━━━━━━━━━━━━━`;
      await sock.sendMessage(from, { text });
      return;
    }

    // 7. ANA KATEGORİ MENÜSÜ
    const helpMenu = 
`🤖 *WP-BOT KOMUT MERKEZİ*
━━━━━━━━━━━━━━━━━━━━
Detaylı komutlar için kategori numarasını veya adını yazın:
_(Örn: \`!yardim 1\` veya \`!yardim uni\`)_

1️⃣ *İndirme & Medya* (\`!yardim 1\`)
2️⃣ *Üniversite & Yurt* (\`!yardim 2\`)
3️⃣ *Günlük & Finans* (\`!yardim 3\`)
4️⃣ *Araçlar & Yapay Zeka* (\`!yardim 4\`)
5️⃣ *Sistem & Grup İzinleri* (\`!yardim 5\`)
━━━━━━━━━━━━━━━━━━━━
💡 _Hepsini tek seferde görmek için: \`!yardim hepsi\`_
🛡️ _Grup komut kısıtlamalarını yönetmek için: \`!izin\`_`;

    await sock.sendMessage(from, { text: helpMenu });
  }
};
