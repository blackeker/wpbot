#!/bin/bash
# ==========================================================
# WhatsApp Bot - Linux (Ubuntu/Debian) Tek Tıkla Kurulum Scripti
# ==========================================================

echo "=========================================================="
echo "[+] WhatsApp Bot VDS Kurulumu Baslatiliyor..."
echo "=========================================================="

# 1. Sistem Paketlerini Güncelle ve Gerekli Araçları Yükle
echo "[1/5] Sistem paketleri guncelleniyor..."
sudo apt update && sudo apt upgrade -y

echo "[2/5] Temel paketler, FFmpeg ve Chromium bagimliliklari kuruluyor..."
sudo apt install -y curl wget git ffmpeg tar build-essential ca-certificates fonts-liberation \
  libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
  libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 \
  libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 \
  libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils

# 2. Node.js (v20 LTS) Kurulumu Kontrolü
if ! command -v node &> /dev/null; then
    echo "[3/5] Node.js bulunamadi, Node.js 20 LTS kuruluyor..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "[3/5] Node.js zaten kurulu: $(node -v)"
fi

# 3. PM2 Kurulumu (7/24 Arka Planda Calistirma Icin)
if ! command -v pm2 &> /dev/null; then
    echo "[+] PM2 process manager yukleniyor..."
    sudo npm install -g pm2
fi

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"
cd "$DIR"

# 4. yt-dlp Linux Binary Kurulumu
echo "[4/5] yt-dlp kontrol ediliyor..."
mkdir -p bin
if [ ! -f "./bin/yt-dlp" ]; then
    echo "[+] yt-dlp Linux surumu indiriliyor..."
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
    chmod +x bin/yt-dlp
    echo "[+] yt-dlp basariyla indirildi ve calistirma yetkisi verildi."
else
    chmod +x bin/yt-dlp
    echo "[+] Yerel bin/yt-dlp mevcut."
fi

# 5. NPM Paketlerini Kur
echo "[5/5] Proje bagimliliklari (npm install) kuruluyor..."
npm install

# İzinleri Ayarla
chmod +x baslat.sh 2>/dev/null || true

echo "=========================================================="
echo "✅ KURULUM BASARIYLA TAMAMLANDI!"
echo "=========================================================="
echo "Botu baslatmak icin:"
echo "  1) Direkt calistirmak: ./baslat.sh"
echo "  2) PM2 ile 7/24 arka planda calistirmak: pm2 start ecosystem.config.cjs"
echo "=========================================================="
