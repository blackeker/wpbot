# 🎬 HDWP İndirici & WhatsApp Bot (v3.0.17)

![Node.js](https://img.shields.io/badge/Node.js-v18%2B-brightgreen?style=for-the-badge&logo=nodedotjs)
![Express](https://img.shields.io/badge/Express.js-v5.2.1-blue?style=for-the-badge&logo=express)
![Baileys](https://img.shields.io/badge/Baileys-v6.7.9-green?style=for-the-badge&logo=whatsapp)
![License](https://img.shields.io/badge/License-MIT-orange?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Active-success?style=for-the-badge)

**HDWP İndirici**, WhatsApp üzerinden gönderilen veya REST API aracılığıyla iletilen film, dizi, sosyal medya ve dosya indirme bağlantılarını otomatik olarak ayıklayan, indiren, işleyen ve kullanıcılara sunan **gelişmiş bir WhatsApp Botu, REST API Servisi ve Web Yönetim Paneli** mimarisidir.

---

## 📋 İçindekiler
- [✨ Öne Çıkan Özellikler](#-öne-çıkan-özellikler)
- [🌐 Desteklenen Platformlar & Bağlantı Türleri](#-desteklenen-platformlar--bağlantı-türleri)
- [🛠️ Sistem Gereksinimleri](#️-sistem-gereksinimleri)
- [🚀 Kurulum ve Çalıştırma](#-kurulum-ve-çalıştırma)
- [⚙️ Çevre Değişkenleri (.env)](#️-çevre-değişkenleri-env)
- [📱 WhatsApp Bot Komutları](#-whatsapp-bot-komutları)
- [📡 REST API Dokümantasyonu](#-rest-api-dokümantasyonu)
- [🖥️ Web Yönetim Paneli & WebSocket](#️-web-yönetim-paneli--websocket)
- [📂 Proje Mimari Yapısı](#-proje-mimari-yapısı)
- [📄 Lisans](#-lisans)

---

## ✨ Öne Çıkan Özellikler

* 🤖 **Baileys v6 Tabanlı WhatsApp Botu:** QR kod veya Telefon Numarası (Pairing Code) ile hızlı ve kararlı oturum eşleşmesi.
* 🌐 **Kapsamlı REST API:** Bot bağımsız olarak medya linki ayıklama, indirme başlatma ve sistem durumunu sorgulama API'si.
* 📊 **Gerçek Zamanlı Web Dashboard:** Anlık CPU, RAM, disk kullanımı, canlı kuyruk durumu, dosya yöneticisi ve WebSocket canlı log takibi.
* ⚡ **Akıllı Kuyruk (Queue) Sistemi:** İndirmeleri duraklatma, devam ettirme, önceliklendirme, iptal etme ve eşzamanlı işlem limitleri.
* 🛡️ **Güvenlik & Brute-Force Koruması:** Web paneli için IP bazlı giriş denemesi sınırlaması ve otomatik engel mekanizması.
* 🧩 **Otomatik Captcha Poller:** Discord bot / harici servis entegrasyonuyla otomatik Captcha tespiti ve WhatsApp üzerinden çözüm bildirimleri.
* 🧹 **Otomatik Önbellek ve Disk Temizliği:** Belirlenen maksimum yaş ve disk boyutuna (`MAX_DOWNLOADS_CACHE_GB`) ulaşıldığında eski dosyaları otomatik temizleme.
* 🎬 **Gelişmiş Medya Çıkarıcılar (Extractors):** Instagram, TikTok, Mega, Yandex Disk, Google Drive, Terabox, Animecix, HD Film Cehennemi ve çok daha fazlası.

---

## 🌐 Desteklenen Platformlar & Bağlantı Türleri

| Platform / Servis | Açıklama |
| :--- | :--- |
| **Instagram** | Reel, Gönderi, Video indirmeleri |
| **TikTok** | Filogramsız (No-Watermark) video indirmeleri |
| **YouTube** | `yt-dlp` entegrasyonu ile MP4/MP3 indirmeleri |
| **Dizi / Film Siteleri** | Animecix, HD Film Cehennemi, HD Kore vb. (Sezon & Bölüm çekme desteği) |
| **Bulut Depolama** | Mega.nz, Yandex Disk, Google Drive, TeraBox |
| **APK Siteleri** | LiteAPKs, Modyolo |
| **Torrent & P2P** | WebTorrent protokolü desteği |

---

## 🛠️ Sistem Gereksinimleri

* **Node.js:** v18.0.0 veya üzeri
* **FFmpeg:** Sistemde yüklü ve PATH'e eklenmiş olmalı (`ffmpeg-static` desteği mevcut)
* **yt-dlp:** Sistemde yüklü veya proje kök dizininde `yt-dlp.exe` / `yt-dlp` çalıştırılabilir dosyası bulunmalı
* **İşletim Sistemi:** Windows / Linux (Ubuntu/Debian) / macOS

---

## 🚀 Kurulum ve Çalıştırma

### 1. Depoyu Klonlayın ve Bağımlılıkları Yükleyin
```bash
git clone https://github.com/kullanici/wpbot.git
cd wpbot
npm install
```

### 2. Yapılandırma Dosyasını Oluşturun
`.env.example` dosyasını `.env` olarak kopyalayın ve düzenleyin:
```bash
cp .env.example .env
```

### 3. Uygulamayı Başlatın

#### Normal Başlatma:
```bash
npm start
```

#### Geliştirici (Dev / Watch) Modu:
```bash
npm run dev
```

#### PM2 ile Arka Planda Başlatma (Production):
```bash
npm run pm2:start
```

---

## ⚙️ Çevre Değişkenleri (.env)

```ini
# WhatsApp Eşleşme Telefon Numarası
WHATSAPP_PHONE_NUMBER=905XXXXXXXXX

# Web Server & API Portu
PORT=7860

# Web Dashboard Giriş Şifresi
DASHBOARD_PASS=güçlü_şifreniz

# Maksimum İndirme Önbellek Boyutu (GB)
MAX_DOWNLOADS_CACHE_GB=15

# İndirilen Dosyaların Tutulacağı Maksimum Süre (Saat)
DOWNLOAD_MAX_AGE_HOURS=4
```

---

## 📱 WhatsApp Bot Komutları

Bot sohbetinde kullanabileceğiniz temel komutlar:

| Komut | Açıklama | Örnek |
| :--- | :--- | :--- |
| `!indir <URL>` | Belirtilen bağlantıdan medyayı indirir ve sohbetten gönderir | `!indir https://instagram.com/p/...` |
| `!durum` | Sunucu durumunu, aktif indirmeleri ve sistem kaynaklarını gösterir | `!durum` |
| `!kuyruk` | Mevcut indirme kuyruğunu listeler | `!kuyruk` |
| `!iptal <ID>` | Devam eden veya beklemedeki görevi iptal eder | `!iptal task_123` |
| `!dur` | İndirme kuyruğunu duraklatır | `!dur` |
| `!devam` | Duraklatılan kuyruğu devam ettirir | `!devam` |
| `!temizle` | Bekleyen kuyruğu temizler | `!temizle` |
| `!çöz <ID> <KOD>`| Bekleyen captcha doğrulamasını çözer | `!çöz 1 45892` |
| `!disk` | Sunucu disk kullanım alanını ve kalan yeri görüntüler | `!disk` |

---

## 📡 REST API Dokümantasyonu

Sunucu başladığında `http://localhost:PORT` (Varsayılan: `7860`) adresi üzerinden REST API hizmeti sunar.

### 1. Medya Bağlantısı Ayıklama (Extract API)
Verilen URL'den doğrudan indirilebilir medya bağlantısını döndürür.
* **HTTP Metodu:** `GET`
* **Endpoint:** `/api/extract`
* **Parametreler:** `url` (Query string)

**Örnek cURL:**
```bash
curl -X GET "http://localhost:7860/api/extract?url=https://www.instagram.com/reel/C_xxxxxx"
```

---

### 2. İndirme Görevi Ekleme (Download Request API)
İndirme isteğini sunucu kuyruğuna ekler.
* **HTTP Metodu:** `POST`
* **Endpoint:** `/api/indir`
* **Headers:** `Content-Type: application/json`
* **Body:**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "jid": "905XXXXXXXXX@s.whatsapp.net"
}
```

---

### 3. Dizi / Bölüm Çekme (Fetch Episodes API)
Desteklenen platformlardaki dizi ve sezon bölümlerini listeler.
* **HTTP Metodu:** `GET`
* **Endpoint:** `/api/fetch-episodes`
* **Parametreler:** `url` (Query string)

---

### 4. Sistem Durumu ve Metrikler
* **HTTP Metodu:** `GET`
* **Endpoint:** `/api/status`
* **Açıklama:** Bot durumunu, WhatsApp bağlantısını, bellek/CPU kullanımını ve indirme listesini döner.

---

### 5. Dosya Yönetimi
* `GET /api/files`: İndirilmiş ve sunucuda tutulan dosyaları listeler.
* `POST /api/files/delete`: Belirtilen dosyayı sunucudan siler.
* `GET /downloads/<dosya_adi>`: Dosyayı tarayıcı üzerinden doğrudan indirir veya oynatır.

---

## 🖥️ Web Yönetim Paneli & WebSocket

Sunucu çalıştığında `http://localhost:7860` adresinden yönetim paneline erişilebilir.

* **Web Paneli Özellikleri:**
  * İndirme kuyruğunu canlı olarak izleme, duraklatma ve önceliklendirme
  * Sistem loglarını **WebSocket** kanalı üzerinden anlık görüntüleme
  * Sunucu dosyalarını yönetme (Silme, indirme, ZIP yapma)
  * QR koda ihtiyaç duymadan Telefon Numarası ile WhatsApp Pair Code alma

---

## 📂 Proje Mimari Yapısı

```
wpbot/
├── commands/             # Dinamik yüklenen WhatsApp komut işleyicileri
├── extractors/            # Özel site ve servis çıkarıcıları (Instagram, TikTok, Mega vb.)
├── events/               # Baileys WhatsApp olay dinleyicileri (mesajlar, bağlantı durumu)
├── downloads/            # İndirilen dosyaların geçici tutulduğu dizin
├── auth_info_session/    # WhatsApp oturum verileri ve geçmiş kayıtları
├── bot.js                # Ana bot başlatıcı ve Baileys yapılandırması
├── server.js             # Express.js REST API ve WebSocket sunucusu
├── extractor.js          # Genel medya çıkarıcı ana modülü
├── pipelines.js          # Medya indirme ve işleme boru hattı (Pipelines)
├── queue.js              # Gelişmiş indirme kuyruğu yönetimi
├── config.js             # Genel yapılandırma, ortam değişkenleri ve yardımcı işlevler
├── package.json          # Bağımlılıklar ve npm betikleri
└── README.md             # Proje dokümantasyonu
```

---

## 📄 Lisans

Bu proje **MIT** lisansı ile lisanslanmıştır. Detaylar için projedeki lisans dosyasını inceleyebilirsiniz.
