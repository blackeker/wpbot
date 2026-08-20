@echo off
title HDWP WhatsApp Bot - Windows VDS
color 0B

echo ====================================================
echo         HDWP WHATSAPP BOT - BASLATICI
echo ====================================================
echo [*] Calisma dizini: %CD%

:: 1. Node.js Kontrolü
node -v >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [x] Hata: Node.js kurulu degil! Lutfen Node.js yukleyin.
    pause
    exit /b
)

:: 2. Node Modules Kontrolü
if not exist "node_modules\" (
    echo [+] 'node_modules' bulunamadi. Bagimliliklar yukleniyor...
    npm install
)

:: 3. Yt-Dlp Kontrolü
yt-dlp --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [!] Uyari: 'yt-dlp' sistem PATH'inde bulunamadi!
    echo [!] YouTube ve diger bazi platform indirmeleri calismayabilir.
    echo [!] Lutfen yt-dlp.exe dosyasini sistem PATH'ine ekleyin veya proje klasorune atin.
    echo.
)

:start
echo.
echo ====================================================
echo [*] Bot baslatiliyor... (%date% %time%)
echo ====================================================
echo.

node bot.js

echo.
echo ====================================================
echo [!] Bot kapandi veya çöktü! 5 saniye sonra yeniden baslatiliyor...
echo [!] Durdurmak icin Ctrl+C tuslarina basin.
echo ====================================================
timeout /t 5
goto start
