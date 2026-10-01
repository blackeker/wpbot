export default {
  name: 'takvim',
  aliases: ['akademik', 'akademiktakvim', 'sinav', 'sınav', 'vize', 'final', 'but', 'bütünleme', 'tatil', 'tatiller', 'sayac', 'sayaç'],
  async execute(sock, msg, from, args = [], ctx = {}) {
    const rawCmd = (ctx.text || '').trim().replace(/^!/, '').split(/\s+/)[0].toLowerCase();
    const arg0 = (args[0] || '').toLowerCase();
    const target = ['vize', 'final', 'but', 'büt', 'bütünleme', 'tatil', 'tatiller', 'sinav', 'sınav', 'sayac', 'sayaç'].includes(arg0) ? arg0 : rawCmd;
    
    // Academic events with start and end dates (YYYY-MM-DD)
    const events = [
      {
        id: 'ekle_birak_guz',
        name: 'Güz Dönemi Ders Ekle-Bırak',
        start: '2026-09-30',
        end: '2026-10-02',
        period: 'Güz',
        type: 'kayit'
      },
      {
        id: 'cumhuriyet_bayrami',
        name: 'Cumhuriyet Bayramı Tatili',
        start: '2026-10-28',
        end: '2026-10-29',
        period: 'Tatil',
        type: 'tatil'
      },
      {
        id: 'vize_guz',
        name: 'Güz Dönemi Vize Sınavları (8-9. Hafta)',
        start: '2026-11-09',
        end: '2026-11-20',
        period: 'Güz',
        type: 'sinav'
      },
      {
        id: 'ders_bitis_guz',
        name: 'Güz Dönemi Ders Sonu',
        start: '2026-12-31',
        end: '2026-12-31',
        period: 'Güz',
        type: 'ders'
      },
      {
        id: 'yilbasi',
        name: 'Yılbaşı Tatili',
        start: '2027-01-01',
        end: '2027-01-01',
        period: 'Tatil',
        type: 'tatil'
      },
      {
        id: 'final_guz',
        name: 'Güz Dönemi Final Sınavları',
        start: '2027-01-04',
        end: '2027-01-17',
        period: 'Güz',
        type: 'sinav'
      },
      {
        id: 'but_guz',
        name: 'Güz Dönemi Bütünleme Sınavları',
        start: '2027-01-25',
        end: '2027-01-31',
        period: 'Güz',
        type: 'sinav'
      },
      {
        id: 'tek_ders_guz',
        name: 'Tek Ders Sınavı',
        start: '2027-02-05',
        end: '2027-02-05',
        period: 'Güz',
        type: 'sinav'
      },
      {
        id: 'ders_kayit_bahar',
        name: 'Bahar Dönemi Ders Kayıtları',
        start: '2027-02-01',
        end: '2027-02-04',
        period: 'Bahar',
        type: 'kayit'
      },
      {
        id: 'ders_baslangic_bahar',
        name: 'Bahar Dönemi Ders Başlangıcı',
        start: '2027-02-08',
        end: '2027-02-08',
        period: 'Bahar',
        type: 'ders'
      },
      {
        id: 'ramazan_bayrami',
        name: 'Ramazan Bayramı Tatili',
        start: '2027-03-08',
        end: '2027-03-11',
        period: 'Tatil',
        type: 'tatil'
      },
      {
        id: 'vize_bahar',
        name: 'Bahar Dönemi Vize Sınavları (8-9. Hafta)',
        start: '2027-03-29',
        end: '2027-04-09',
        period: 'Bahar',
        type: 'sinav'
      },
      {
        id: '23_nisan',
        name: '23 Nisan Ulusal Egemenlik ve Çocuk Bayramı',
        start: '2027-04-23',
        end: '2027-04-23',
        period: 'Tatil',
        type: 'tatil'
      },
      {
        id: '1_mayis',
        name: '1 Mayıs Emek ve Dayanışma Günü',
        start: '2027-05-01',
        end: '2027-05-01',
        period: 'Tatil',
        type: 'tatil'
      },
      {
        id: 'kurban_bayrami',
        name: 'Kurban Bayramı Tatili',
        start: '2027-05-15',
        end: '2027-05-19',
        period: 'Tatil',
        type: 'tatil'
      },
      {
        id: '19_mayis',
        name: '19 Mayıs Atatürk\'ü Anma, Gençlik ve Spor Bayramı',
        start: '2027-05-19',
        end: '2027-05-19',
        period: 'Tatil',
        type: 'tatil'
      },
      {
        id: 'final_bahar',
        name: 'Bahar Dönemi Final Sınavları',
        start: '2027-05-31',
        end: '2027-06-13',
        period: 'Bahar',
        type: 'sinav'
      },
      {
        id: 'but_bahar',
        name: 'Bahar Dönemi Bütünleme Sınavları',
        start: '2027-06-21',
        end: '2027-06-27',
        period: 'Bahar',
        type: 'sinav'
      },
      {
        id: 'mezuniyet_sinavi',
        name: 'Mezuniyet Sınavı',
        start: '2027-07-05',
        end: '2027-07-06',
        period: 'Bahar',
        type: 'sinav'
      }
    ];

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const todayMs = new Date(todayStr).getTime();

    const getRemainingDays = (dateStr) => {
      const targetMs = new Date(dateStr).getTime();
      const diffMs = targetMs - todayMs;
      return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    };

    const formatDateTr = (dateStr) => {
      const [y, m, d] = dateStr.split('-');
      const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
      return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
    };

    // 1. Sadece Vize Sorgusu
    if (target === 'vize' || target === 'vizesayac') {
      const vizes = events.filter(e => e.id.startsWith('vize'));
      let reply = `📝 *FIRAT ÜNİVERSİTESİ VİZE SINAVLARI VE SAYAÇ*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      vizes.forEach(v => {
        const remaining = getRemainingDays(v.start);
        const endRemaining = getRemainingDays(v.end);
        let status = '';
        if (remaining > 0) {
          status = `⏳ *${remaining} gün kaldı*`;
        } else if (remaining <= 0 && endRemaining >= 0) {
          status = `🔥 *Şu anda yapılıyor!* (Bitişe ${endRemaining} gün)`;
        } else {
          status = `✅ _Tamamlandı_`;
        }
        reply += `📌 *${v.name}*\n📅 *Tarih:* ${formatDateTr(v.start)} - ${formatDateTr(v.end)}\n⏱️ *Durum:* ${status}\n\n`;
      });
      reply += `━━━━━━━━━━━━━━━━━━━━\n💡 _Daha fazlası için: \`!final\`, \`!but\`, \`!takvim\`_`;
      await sock.sendMessage(from, { text: reply.trim() });
      return;
    }

    // 2. Sadece Final Sorgusu
    if (target === 'final' || target === 'finalsınavı' || target === 'finalsayac') {
      const finals = events.filter(e => e.id.startsWith('final'));
      let reply = `🎓 *FIRAT ÜNİVERSİTESİ FİNAL SINAVLARI VE SAYAÇ*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      finals.forEach(f => {
        const remaining = getRemainingDays(f.start);
        const endRemaining = getRemainingDays(f.end);
        let status = '';
        if (remaining > 0) {
          status = `⏳ *${remaining} gün kaldı*`;
        } else if (remaining <= 0 && endRemaining >= 0) {
          status = `🔥 *Finaller devam ediyor!* (Bitişe ${endRemaining} gün)`;
        } else {
          status = `✅ _Tamamlandı_`;
        }
        reply += `📌 *${f.name}*\n📅 *Tarih:* ${formatDateTr(f.start)} - ${formatDateTr(f.end)}\n⏱️ *Durum:* ${status}\n\n`;
      });
      reply += `━━━━━━━━━━━━━━━━━━━━\n💡 _Daha fazlası için: \`!vize\`, \`!but\`, \`!takvim\`_`;
      await sock.sendMessage(from, { text: reply.trim() });
      return;
    }

    // 3. Sadece Bütünleme Sorgusu
    if (target === 'but' || target === 'bütünleme' || target === 'büt') {
      const buts = events.filter(e => e.id.startsWith('but'));
      let reply = `🔄 *FIRAT ÜNİVERSİTESİ BÜTÜNLEME SINAVLARI VE SAYAÇ*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      buts.forEach(b => {
        const remaining = getRemainingDays(b.start);
        const endRemaining = getRemainingDays(b.end);
        let status = '';
        if (remaining > 0) {
          status = `⏳ *${remaining} gün kaldı*`;
        } else if (remaining <= 0 && endRemaining >= 0) {
          status = `🔥 *Bütünleme haftası!* (Bitişe ${endRemaining} gün)`;
        } else {
          status = `✅ _Tamamlandı_`;
        }
        reply += `📌 *${b.name}*\n📅 *Tarih:* ${formatDateTr(b.start)} - ${formatDateTr(b.end)}\n⏱️ *Durum:* ${status}\n\n`;
      });
      reply += `━━━━━━━━━━━━━━━━━━━━\n💡 _Daha fazlası için: \`!vize\`, \`!final\`, \`!takvim\`_`;
      await sock.sendMessage(from, { text: reply.trim() });
      return;
    }

    // 4. Sadece Tatiller Sorgusu
    if (target === 'tatil' || target === 'tatiller') {
      const holidays = events.filter(e => e.type === 'tatil');
      let reply = `🏖️ *RESMİ TATİLLER VE BAYRAMLAR (2026-2027)*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      holidays.forEach(h => {
        const remaining = getRemainingDays(h.start);
        let status = '';
        if (remaining > 0) {
          status = `⏳ (${remaining} gün sonra)`;
        } else if (remaining === 0) {
          status = `🎉 *BUGÜN!*`;
        } else {
          status = `✅ _Geçti_`;
        }
        const dateText = h.start === h.end ? formatDateTr(h.start) : `${formatDateTr(h.start)} - ${formatDateTr(h.end)}`;
        reply += `• *${h.name}*\n  📅 ${dateText} ${status}\n\n`;
      });
      reply += `━━━━━━━━━━━━━━━━━━━━`;
      await sock.sendMessage(from, { text: reply.trim() });
      return;
    }

    // 5. Genel Sınav Sayacı ve Yaklaşanlar Özeti
    if (target === 'sinav' || target === 'sınav' || target === 'sayac' || target === 'sayaç') {
      const examEvents = events.filter(e => e.type === 'sinav');
      let reply = `⏱️ *FIRAT ÜNİVERSİTESİ SINAV GERİ SAYIM SAYACI*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      examEvents.forEach(e => {
        const remaining = getRemainingDays(e.start);
        const endRemaining = getRemainingDays(e.end);
        let badge = '';
        if (remaining > 0) {
          badge = `⏳ *${remaining} gün kaldı*`;
        } else if (remaining <= 0 && endRemaining >= 0) {
          badge = `🔥 *ŞU ANDA DEVAM EDİYOR!*`;
        } else {
          badge = `✅ _Tamamlandı_`;
        }
        const dateText = e.start === e.end ? formatDateTr(e.start) : `${formatDateTr(e.start)} - ${formatDateTr(e.end)}`;
        reply += `📝 *${e.name}*\n📅 ${dateText}\n👉 ${badge}\n\n`;
      });
      reply += `━━━━━━━━━━━━━━━━━━━━\n💡 _Ayrıntılı takvim için: \`!takvim\`_`;
      await sock.sendMessage(from, { text: reply.trim() });
      return;
    }

    // 6. Genel Akademik Takvim (Ana Rapor)
    let reply = `📅 *FIRAT ÜNİVERSİTESİ 2026-2027 AKADEMİK TAKVİM*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Yaklaşan en yakın 3 etkinlik
    const upcoming = events.filter(e => getRemainingDays(e.end) >= 0).slice(0, 3);
    if (upcoming.length > 0) {
      reply += `🔥 *YAKLAŞAN ÖNEMLİ TARİHLER:*\n`;
      upcoming.forEach(u => {
        const rem = getRemainingDays(u.start);
        const remText = rem > 0 ? `*${rem} gün kaldı*` : `*Şu anda aktif!*`;
        reply += `• *${u.name}:* ${remText} (${formatDateTr(u.start)})\n`;
      });
      reply += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    }

    reply += `🍂 *GÜZ YARIYILI:*\n` +
      `• *Ders Başlangıcı:* 21 Eylül 2026\n` +
      `• *Ders Ekle-Bırak:* 30 Eylül - 02 Ekim 2026\n` +
      `• *Vize Sınavları:* 09 - 20 Kasım 2026\n` +
      `• *Ders Sonu:* 31 Aralık 2026\n` +
      `• *Final Sınavları:* 04 - 17 Ocak 2027\n` +
      `• *Bütünleme Sınavları:* 25 - 31 Ocak 2027\n` +
      `• *Tek Ders Sınavı:* 05 Şubat 2027\n\n` +
      `🌸 *BAHAR YARIYILI:*\n` +
      `• *Ders Kayıtları:* 01 - 04 Şubat 2027\n` +
      `• *Ders Başlangıcı:* 08 Şubat 2027\n` +
      `• *Ders Ekle-Bırak:* 17 - 19 Şubat 2027\n` +
      `• *Vize Sınavları:* 29 Mart - 09 Nisan 2027\n` +
      `• *Ders Sonu:* 30 Mayıs 2027\n` +
      `• *Final Sınavları:* 31 Mayıs - 13 Haziran 2027\n` +
      `• *Bütünleme Sınavları:* 21 - 27 Haziran 2027\n` +
      `• *Mezuniyet Sınavı:* 05 - 06 Temmuz 2027\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📌 *Hızlı Komutlar:* \`!vize\`, \`!final\`, \`!but\`, \`!tatil\`, \`!sayac\``;

    await sock.sendMessage(from, { text: reply.trim() });
  }
};
