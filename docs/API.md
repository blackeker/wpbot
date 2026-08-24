# 📡 HDWP İndirici REST API & WebSocket Dokümantasyonu

HDWP İndirici, medya indirme, doğrudan bağlantı ayıklama (extraction), kuyruk yönetimi, sunucu metrikleri ve dosya yönetimi için gelişmiş bir **REST API** ve **WebSocket** arayüzü sunar.

---

## 📑 İçindekiler
- [🛠️ Genel Bilgiler & Taban URL](#️-genel-bilgiler--taban-url)
- [🔐 Kimlik Doğrulama & Güvenlik](#-kimlik-doğrulama--güvenlik)
- [🎬 1. Medya Çıkarma (Extraction) API](#-1-medya-çıkarma-extraction-api)
- [⚡ 2. İndirme & Kuyruk Yönetimi API](#-2-indirme--kuyruk-yönetimi-api)
- [📺 3. Dizi & Bölüm Çekme API](#-3-dizi--bölüm-çekme-api)
- [📊 4. Sistem Durumu & Metrikler API](#-4-sistem-durumu--metrikler-api)
- [📁 5. Dosya Yönetimi API](#-5-dosya-yönetimi-api)
- [📱 6. WhatsApp Oturum & Eşleşme API](#-6-whatsapp-oturum--eşleşme-api)
- [⚙️ 7. Ayarlar & Geçmiş Log API](#-7-ayarlar--geçmiş-log-api)
- [🔌 8. Canlı Takip (WebSocket Protocol)](#-8-canlı-takip-websocket-protocol)
- [💻 9. Kod Örnekleri (Python & Node.js)](#-9-kod-örnekleri-python--nodejs)

---

## 🛠️ Genel Bilgiler & Taban URL

- **Taban URL:** `http://localhost:7860` *(Lokal veya VDS IP adresiniz)*
- **Varsayılan Port:** `7860` (Veya `.env` dosyasındaki `PORT` değişkeni)
- **İçerik Tipi (Content-Type):** `application/json`
- **Tüm Yanıtlar:** Standart JSON formatında döndürülür.

---

## 🔐 Kimlik Doğrulama & Güvenlik

* **Açık Endpoint'ler (Public):** Tüm `/api/` rotaları ve `/downloads/` statik dosya sunucusu kimlik doğrulaması olmadan erişilebilir.
* **Korumalı Rotalar:** Web paneli arayüzü `HTTP Basic Auth` ile korunmaktadır (Giriş bilgileri `.env` içerisindeki `DASHBOARD_PASS` ve config üzerinden yönetilir).
* **Brute-Force Koruması:** Üst üste 5 hatalı giriş denemesi yapan IP adresleri 15 dakika boyunca otomatik olarak engellenir (`HTTP 429 Too Many Requests`).

---

## 🎬 1. Medya Çıkarma (Extraction) API

Herhangi bir platformdaki medyayı indirmeden, doğrudan oynatılabilir/indirilebilir stream veya video bağlantılarını çıkartır.

### 1.1. Evrensel Bağlantı Çıkarıcı
* **Endpoint:** `GET /api/extract`
* **Query Parametreleri:**
  * `url` (String, Zorunlu): Çıkartılacak medyanın web adresi.

#### Başarılı Yanıt (200 OK):
```json
{
  "success": true,
  "result": {
    "title": "Örnek Video Başlığı",
    "videoUrl": "https://cdn.example.com/stream.mp4",
    "thumbnail": "https://cdn.example.com/thumb.jpg",
    "quality": "1080p",
    "source": "Instagram"
  }
}
```

#### Örnek cURL:
```bash
curl -X GET "http://localhost:7860/api/extract?url=https://www.instagram.com/reel/C_xxxxxx"
```

---

### 1.2. Platforma Özel Bağlantı Çıkarıcı
* **Endpoint:** `GET /api/extract/:site`
* **Path Parametresi (`:site`):** `instagram`, `tiktok`, `mega`, `yandex`, `gdrive`, `terabox`, `liteapks`, `modyolo`
* **Query Parametreleri:** `url` (String, Zorunlu)

#### Örnek cURL:
```bash
curl -X GET "http://localhost:7860/api/extract/tiktok?url=https://www.tiktok.com/@user/video/123456789"
```

---

## ⚡ 2. İndirme & Kuyruk Yönetimi API

### 2.1. İndirme Görevi Ekleme
İndirme isteğini sunucu kuyruğuna ekler.
* **Endpoint:** `POST /api/indir`
* **Body (JSON):**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "jid": "905XXXXXXXXX@s.whatsapp.net"
}
```
* **Yanıt (200 OK):**
```json
{
  "ok": true,
  "taskId": "task_1724500000000_1234",
  "message": "Görev kuyruğa eklendi."
}
```

---

### 2.2. Toplu İndirme Görevi Ekleme
* **Endpoint:** `POST /api/indir-multiple`
* **Body (JSON):**
```json
{
  "urls": [
    "https://example.com/video1.mp4",
    "https://example.com/video2.mp4"
  ],
  "jid": "905XXXXXXXXX@s.whatsapp.net"
}
```

---

### 2.3. İndirme Görevini İptal Etme
* **Endpoint:** `POST /api/indir/cancel`
* **Body (JSON):** `{ "id": "task_1724500000000_1234" }`
* **Yanıt:** `{ "success": true, "message": "Görev iptal edildi." }`

---

### 2.4. Görevi Öne Alma (Prioritize)
* **Endpoint:** `POST /api/indir/prioritize`
* **Body (JSON):** `{ "id": "task_1724500000000_1234" }`
* **Yanıt:** `{ "success": true, "message": "Görev önceliklendirildi." }`

---

### 2.5. Kuyruk Durum Kontrolleri
* **Kuyruğu Duraklat:** `POST /api/kuyruk-duraklat` -> `{ "ok": true, "message": "Kuyruk duraklatıldı." }`
* **Kuyruğu Devam Ettir:** `POST /api/kuyruk-devam` -> `{ "ok": true, "message": "Kuyruk devam ediyor." }`
* **Kuyruğu Temizle:** `POST /api/kuyruk-temizle` -> `{ "ok": true, "message": "X görev silindi." }`

---

## 📺 3. Dizi & Bölüm Çekme API

Desteklenen dizi/film sitelerinden (Animecix, HD Film Cehennemi, HD Kore vb.) sezon ve bölüm bilgilerini çekmek için kullanılır.

* **Endpoint:** `GET /api/fetch-episodes`
* **Query Parametreleri:** `url` (String, Zorunlu)

#### Başarılı Yanıt (200 OK):
```json
{
  "success": true,
  "title": "Dizi Adı",
  "seasons": [
    {
      "seasonNumber": 1,
      "episodes": [
        { "episodeNumber": 1, "title": "1. Bölüm", "url": "https://site.com/dizi/1-sezon-1-bolum" },
        { "episodeNumber": 2, "title": "2. Bölüm", "url": "https://site.com/dizi/1-sezon-2-bolum" }
      ]
    }
  ]
}
```

---

## 📊 4. Sistem Durumu & Metrikler API

### 4.1. Canlı Sistem ve Bot Durumu
* **Endpoint:** `GET /api/status`
* **Yanıt (200 OK):**
```json
{
  "botConnected": true,
  "activeTask": {
    "id": "task_123",
    "url": "https://...",
    "progress": 45.2,
    "speed": "3.5 MB/s"
  },
  "queue": [],
  "queueState": { "paused": false },
  "system": {
    "cpuUsagePercent": 12.4,
    "ramUsageMB": 245.8,
    "diskFreeGB": 84.5,
    "diskTotalGB": 120.0
  }
}
```

---

### 4.2. Sağlık Kontrolü (Health Check)
* **Endpoint:** `GET /api/system/health`
* **Yanıt (200 OK):**
```json
{
  "status": "ok",
  "ffmpeg": true,
  "ytDlp": true,
  "uptimeSeconds": 14200
}
```

---

### 4.3. Yeniden Başlatma & Güncelleme
* **`POST /api/system/git-pull`**: `git pull` çalıştırarak projeyi günceller.
* **`POST /api/system/restart`**: Uygulamayı yeniden başlatır.

---

## 📁 5. Dosya Yönetimi API

### 5.1. İndirilen Dosyaları Listeleme
* **Endpoint:** `GET /api/files`
* **Yanıt (200 OK):**
```json
{
  "success": true,
  "files": [
    {
      "name": "sample_video.mp4",
      "sizeBytes": 104857600,
      "sizeFormatted": "100.00 MB",
      "dateFormatted": "24.08.2026 15:30:00",
      "downloadUrl": "/downloads/sample_video.mp4"
    }
  ]
}
```

---

### 5.2. Doğrudan Dosya İndirme / Oynatma
* **Endpoint:** `GET /downloads/:filename`
* **Açıklama:** İndirilmiş medyalara doğrudan HTTP üzerinden erişim ve indirme bağlantısı.

---

### 5.3. Dosya Silme
* **Endpoint:** `POST /api/files/delete`
* **Body (JSON):** `{ "filename": "sample_video.mp4" }`

---

### 5.4. Toplu ZIP Arşivi Oluşturma
* **Endpoint:** `POST /api/files/zip`
* **Body (JSON):** `{ "fileNames": ["video1.mp4", "video2.mp4"] }`
* **Yanıt:** `{ "success": true, "zipUrl": "/downloads/archive_17245000.zip" }`

---

## 📱 6. WhatsApp Oturum & Eşleşme API

### 6.1. Telefon Numarası ile Eşleşme Kodu İsteği
* **Endpoint:** `POST /api/request-pairing`
* **Body (JSON):** `{ "phoneNumber": "905XXXXXXXXX" }`
* **Yanıt (200 OK):** `{ "success": true, "code": "ABC1-23XY" }`

---

### 6.2. Oturum Yedekleme & Geri Yükleme
* **`POST /api/session/backup`**: Mevcut WhatsApp oturumunu zip olarak yedekler.
* **`POST /api/session/restore`**: Yedekten oturumu geri yükler.
* **`POST /api/session/reset`**: Oturumu tamamen sıfırlar (Log-out).

---

## ⚙️ 7. Ayarlar & Geçmiş Log API

* **`GET /api/settings`**: Sistem ayarlarını getirir.
* **`POST /api/settings`**: Ayarları günceller.
* **`GET /api/history`**: Başarılı indirme geçmişini döner.
* **`GET /api/errors`**: Hata kayıtlarını döner.
* **`POST /api/history/clear`**: Geçmişi temizler.
* **`POST /api/errors/clear`**: Hata kayıtlarını temizler.

---

## 🔌 8. Canlı Takip (WebSocket Protocol)

Sistem canlı indirme ilerlemesini, kuyruk güncellemelerini ve sunucu loglarını WebSocket protokolü üzerinden yayınlar.

* **WebSocket Adresi:** `ws://localhost:7860`

### WebSocket Mesaj Formatı:
```json
{
  "type": "log",
  "data": "[DOWNLOAD] Video %45 indirildi... (Speed: 4.2 MB/s)"
}
```
veya kuyruk değişiminde:
```json
{
  "type": "queueUpdate",
  "activeTask": { "id": "task_123", "progress": 72 },
  "queue": []
}
```

---

## 💻 9. Kod Örnekleri (Python & Node.js)

### Python (requests) ile İndirme Görevi Başlatma:
```python
import requests

url = "http://localhost:7860/api/indir"
payload = {
    "url": "https://www.instagram.com/reel/C_xxxxxx",
    "jid": "905330000000@s.whatsapp.net"
}
headers = {"Content-Type": "application/json"}

response = requests.post(url, json=payload, headers=headers)
print(response.json())
```

---

### Node.js (fetch) ile Medya Bağlantısı Çıkarma:
```javascript
async function extractMedia(videoUrl) {
  const response = await fetch(`http://localhost:7860/api/extract?url=${encodeURIComponent(videoUrl)}`);
  const data = await response.json();
  if (data.success) {
    console.log("Direct Media URL:", data.result.videoUrl);
  } else {
    console.error("Extraction error:", data.error);
  }
}

extractMedia("https://www.tiktok.com/@user/video/123456789");
```
