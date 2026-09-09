export default {
  name: "hhelp",
  aliases: ["hentaihelp", "h-help", "hentaiyardim", "hyardim"],
  async execute(sock, msg, from, args, ctx) {
    const helpMessage = 
`🔞 *HENTAİZM VE ANİME PAKET SİSTEMİ REHBERİ* 🔞
━━━━━━━━━━━━━━━━━━━━

📋 *1. FAVORİLER LİSTESİNDE GEZİNME:*
• *hentaizmfav* ➔ Favorilerinizin 1. sayfasındaki animeleri afişiyle ve numaralandırılmış liste olarak gösterir.
• *hentaizmfav <sayfa>* ➔ Belirtilen sayfadaki animeleri listeler.
  _Örnek:_ \`hentaizmfav 2\` veya \`hentaizmfav 3\`

📥 *2. NUMARA VEYA YANITLA PAKET İNDİRME:*
Listeden beğendiğiniz animenin numarasını yazmanız veya afişe yanıt vermeniz yeterlidir. Bot o serinin *tüm bölümlerini* ve *kapak afişini* indirip tek paket halinde gönderir.
• ⚡ *Afişe Yanıtla:* Beğendiğiniz anime afişine WhatsApp'ta *yanıt/alıntı* verip sadece *\`.\`* yazarsanız otomatik indirilir!
• ⚡ *Öncelikli Yanıtla:* Afişi yanıtlayıp *\`. acil\`* yazarsanız kuyruğun en önüne alınır.
• *indirhentai <no>* ➔ Belirtilen numaradaki animeyi sıraya alır.
  _Örnek:_ \`indirhentai 12\`
• *indirhentai <no1>, <no2>* ➔ Birden fazla animeyi sıraya alır.
  _Örnek:_ \`indirhentai 1, 3, 5\`
• *indirhentai <başlangıç-bitiş>* ➔ Belirli bir aralıktaki animeleri sıraya alır.
  _Örnek:_ \`indirhentai 1-4\`
• *indirhentai <no> acil* ➔ Görevi kuyruğun en başına (öncelikli) ekler.
  _Örnek:_ \`indirhentai 12 acil\`

📦 *3. TOPLU LİNK VE SAYFA İNDİRME:*
• *!topluhentai <link>* ➔ Hentaizm liste, kategori veya favori linkini tarayıp tüm serileri kuyruğa alır.
  _Örnek:_ \`!topluhentai https://www.hentaizm2.com/?tab=fav&page=1 1-3\`
• *!topluhentai <link1> <link2>...* ➔ Birden fazla Hentaizm anime linkini aynı mesajda gönderip topluca indirmeye başlatır.

🎯 *4. HEDEF GRUP AYARLAMA:*
Paketlerin hangi WhatsApp grubuna gideceğini belirleyebilirsiniz:
• *!hentaigrup burası* ➔ Komutun yazıldığı grubu Hentai hedef grubu yapar.
• *!hentaigrup sil* ➔ Hedef grubu kaldırır (paketler linkin atıldığı yere gelir).
• *!hentaigrup* ➔ Mevcut ayarlı hedef grubu gösterir.

🖥️ *5. WEB DASHBOARD İLE KULLANIM:*
Web yönetim panelinde sol menüden *🔞 Hentai Toplu İndir* sekmesini kullanarak sayfaları görsel olarak tarayabilir, afişleri önizleyebilir ve tek tıkla seçtiğiniz animeleri kuyruğa ekleyebilirsiniz.

━━━━━━━━━━━━━━━━━━━━
💡 _Not: Tüm komutları başında ünlem işareti olmadan da (örn: \`hentaizmfav\`, \`indirhentai 12\`, \`hhelp\`) doğrudan yazabilirsiniz!_`;

    await sock.sendMessage(from, { text: helpMessage });
  }
};
