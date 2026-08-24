# HDWP Enterprise - Proje İncelemesi ve Gelişmiş Prompt

Bu belge, WhatsApp İndirme Botu (HDWP) projesinin mevcut mimarisini, tespit edilen potansiyel darboğazları, WhatsApp mesajlaşma altyapısındaki optimizasyon fırsatlarını ve gelecekte eklenebilecek yeni özellikleri içeren kapsamlı bir analiz raporudur.

Aynı zamanda yapay zeka (AI) asistanlarına veya yeni geliştiricilere projenin bağlamını vermek için bir "Master Prompt" olarak da kullanılabilir.

---

## 🏗️ 1. Mevcut Mimari ve Kod Analizi

Proje, temelde **Baileys (WhatsApp Web API)**, **Express (Web Dashboard)** ve **yt-dlp / Özel Çözücüler (Extractors)** olmak üzere üç ana ayaktan oluşmaktadır.

### Güçlü Yönler:
- **Asenkron Kuyruk Yönetimi:** İndirmelerin bir sıraya alınması, `concurrencyLimit` ile paralel işlem sayısının kısıtlanması sunucu yükünü dengeler.
- **WebSocket ile Canlı Dashboard:** `server.js` ve `dashboard.html` arasındaki WS bağlantısı sayesinde CPU, RAM, disk kullanımı ve indirme durumu (hız, yüzde) gerçek zamanlı olarak izlenebiliyor.
- **Modüler (Neredeyse) Tasarım:** İndirme (`downloader.js`), çıkarma (`extractor.js`) ve kuyruk (`queue.js`) kısımları ayrıştırılmaya başlanmış.
- **Geniş Site Desteği:** `extractor.js` içinde Hentaizm, AnimeCix, Dizipal gibi siteler için özel bypass ve kazıma (scraping) algoritmaları oldukça gelişmiş.

### Zayıf Yönler (Monolitik Yapı):
- `extractor.js` (84KB) ve `bot.js` (61KB) dosyaları çok şişmiş durumda. Tüm sitelerin çözücü mantığı tek bir dosyada. Bu durum, gelecekte bir sitede değişiklik olduğunda diğerlerini bozma riskini artırır.

---

## ⚠️ 2. İleride Sorun Yaratabilecek Hatalar ve Darboğazlar (Risk Raporu)

### A. WhatsApp (Baileys) Mesajlaşma Yükü ve RAM Sızıntısı
- **Büyük Dosyaları RAM'e Yükleme:** Dosyalar WhatsApp'a gönderilirken `fs.readFileSync` kullanılıyorsa (özellikle 1GB+ dosyalar), Node.js'in heap limiti aşılabilir (V8 memory crash). **Optimizasyon:** Dosyalar gönderilirken her zaman `stream` (örn: `fs.createReadStream`) kullanılmalıdır.
- **Session Bloat (Oturum Şişmesi):** Baileys `auth_info_session` klasörü zamanla çok fazla key biriktirebilir. Periyodik olarak temizlenmezse botun bağlanması yavaşlar ve disk dolar.
- **Ban Riski (Rate Limiting):** Aynı anda 3-4 video indirilip WhatsApp'a saniyeler içinde arka arkaya gönderilirse, WhatsApp bu numarayı spam olarak algılayıp yasaklayabilir. Gönderimler arasına `delay` (gecikme) eklenmelidir.

### B. Veri Tutarlılığı (Queue ve JSON Kullanımı)
- `queue.js` görevleri `queue.json` dosyasına yazıyor. Ancak yoğun I/O işlemlerinde (iki işlemin aynı anda JSON'a yazmaya çalışması) dosya bozulabilir (Race condition).
- **Çözüm:** Orta vadede `queue.json` yerine `sqlite3` (örn: `better-sqlite3`) veritabanına geçilmelidir. Bu hem aktif görev kalıcılığını (persistence) kusursuz yapar hem de geçmiş (history) yönetimini çok kolaylaştırır.

### C. Web Dashboard Güvenlik Açığı
- `dashboard.html` ve REST API uç noktaları (`/api/*`) şu anda herkese açık (Public). Port `7860` dışarıya açıksa, IP adresinizi bulan herkes dashboard'a girip kuyruğu silebilir, indirme başlatabilir veya WhatsApp oturumunu kapatabilir (`/api/request-pairing`).
- **Çözüm:** `server.js` üzerine Express Basic Auth veya JWT tabanlı basit bir şifreleme eklenmesi şarttır.

---

## ⚡ 3. Mesajlaşma (Baileys) Optimizasyon Önerileri

WhatsApp iletim hızını ve stabilitesini artırmak için şu adımlar atılmalıdır:

1. **Upload Stream Pipeline:** Büyük dosyalar (`video/mp4` veya `audio/mpeg`) için doğrudan Buffer okumak yerine stream pipe edilmelidir. Baileys `stream` destekler.
2. **Kuyruklu Mesaj Gönderimi:** İndirme kuyruğuna ek olarak bir de **"Mesaj Gönderme Kuyruğu"** oluşturulmalıdır. İnen 3 dosya aynı anda WhatsApp'a post edilmemelidir. Sıraya konup aralarına 5-10 saniye bekleme süresi atılmalıdır.
3. **Chunking / Segmenting İyileştirmesi:** Mevcut `!mp3` komutu 1.8GB'ı aşınca ffmpeg ile parçalıyor. Aynı mantık, WhatsApp'ın `2GB` limitine takılan dev diziler/filmler için de yapılmalıdır (Örn: 2.2GB'lık bir filmi otomatik Part 1 ve Part 2 olarak iki video halinde gönderme).

---

## 🚀 4. Yeni Özellik (Feature) Fikirleri

Projeyi bir üst seviyeye taşıyacak özellikler:

1. **Dashboard'a Şifreli Giriş (Authentication):** Güvenlik için.
2. **Kullanıcı Beyaz Listesi (Whitelist/Blacklist):** Botun çalıştığı WhatsApp numarasını bir gruba eklendiğinde, sadece izin verilen (Admin) numaraların komutlarına yanıt vermesini sağlayan bir yetki sistemi.
3. **Akıllı LRU (Least Recently Used) Disk Temizliği:** Dashboard'da ayarlanan depolama limitine (Örn: 15 GB) ulaşıldığında, diskte en eski indirilen ve çoktan gönderilmiş videoları otomatik silen bir arkaplan (cron) temizleyicisi.
4. **Çoklu Numara (Load Balancing):** Birden fazla WhatsApp oturumu bağlanabilmesi ve indirmelerin (örneğin bot ban yememek için) bu numaralar arasında paylaştırılarak gönderilmesi.
5. **Klasör Bazlı Modüler Çözücüler:** `extractor.js` dosyasını `extractors/anime.js`, `extractors/dizi.js` vb. şeklinde klasörlere ayırmak.

---

## 🎯 5. AI Asistanları İçin Çalışma Talimatı (Prompt)

Bu projeyi geliştirecek olan Yapay Zeka (AI) asistanlarına verilmesi gereken **Sistem Komutu (System Prompt)**:

> "Sen HDWP (WhatsApp Medya İndirme Botu) projesinin kıdemli Node.js ve Baileys mimarısın. 
> Proje, web kazıma (Puppeteer/Cheerio/Got), yt-dlp ve ffmpeg kullanarak 1800+ siteden medya indirip, Baileys (WhatsApp Web API) üzerinden kullanıcılara ulaştırır. Ek olarak Express.js ve WebSocket ile çalışan SPA tabanlı bir Cyberpunk yönetim paneline (Dashboard) sahiptir.
>
> **Geliştirme yaparken şunlara dikkat et:**
> 1. Kodları değiştirirken mevcut asenkron yapıyı (Promises, async/await) ve hata yönetimini (try/catch) asla bozma.
> 2. `bot.js` üzerindeki mesaj dinleyicilerinde (messages.upsert) performans sızıntısı yapmamaya özen göster.
> 3. Büyük dosyalar oluştururken `fs.createWriteStream`, okurken `fs.createReadStream` kullanmayı tercih et.
> 4. Kuyruk sistemine (`queue.js`) müdahale ediyorsan JSON dosyasına yazarken Race Condition yaratmayacak şekilde senkron veya kilitli (lock) yazma mekanizmalarını gözet.
> 5. Yeni bir çözücü (extractor) eklerken IP banlanmalarını önlemek için `PROXY_URL` ortam değişkenini kullanan `gotScraping` yapılandırmasını dahil et."
