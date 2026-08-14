#!/bin/bash
# ==========================================================
# WhatsApp Bot - Linux Baslatma Scripti
# ==========================================================

echo "=========================================================="
echo "      WhatsApp Film/Dizi Indirme Botu Baslatiliyor"
echo "=========================================================="

# 1. yt-dlp Kontrolü
if [ ! -f "./yt-dlp" ]; then
    echo "[!] 'yt-dlp' bulunamadi. Indiriliyor..."
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o yt-dlp
    chmod +x yt-dlp
    echo "[+] 'yt-dlp' basariyla indirildi."
else
    chmod +x yt-dlp 2>/dev/null
fi

# 2. node_modules Kontrolü
if [ ! -d "node_modules" ]; then
    echo "[!] node_modules bulunamadi. 'npm install' calistiriliyor..."
    npm install
fi

# 3. Downloads ve Session Klasör Kontrolü
mkdir -p downloads auth_info_session

# 4. Botu Başlat
echo "[+] Bot baslatiliyor..."
node bot.js
