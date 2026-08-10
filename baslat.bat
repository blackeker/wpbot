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

:: 3. Yt-Dlp Kontrolü ve Otomatik Kurulumu
yt-dlp --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if not exist "yt-dlp.exe" (
        echo [!] 'yt-dlp' bulunamadi. Github uzerinden indiriliyor...
        curl -L -o yt-dlp.exe https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
        if exist "yt-dlp.exe" (
            echo [+] 'yt-dlp.exe' basariyla indirildi ve proje klasorune kaydedildi.
        ) else (
            echo [x] Hata: yt-dlp indirilemedi! Lutfen el ile indirin.
        )
    ) else (
        echo [+] Yerel 'yt-dlp.exe' mevcut, kullanilıyor.
    )
) else (
    echo [+] 'yt-dlp' sistemde kurulu.
)

:: 4. Logs Klasörü Kontrolü
if not exist "logs\" mkdir logs

for /f "tokens=2 delims==" %%i in ('wmic os get localdatetime /value') do set datetime=%%i
set TIMESTAMP=%datetime:~0,4%%datetime:~4,2%%datetime:~6,2%_%datetime:~8,2%%datetime:~10,2%%datetime:~12,2%
set LOG_FILE=logs\%TIMESTAMP%.json

:start
echo.
echo ====================================================
echo [*] Bot baslatiliyor... (%date% %time%)
echo [*] Log dosyasi: %LOG_FILE%
echo ====================================================
echo.

npm run dev > "%LOG_FILE%" 2>&1

echo.
echo ====================================================
echo [!] Bot kapandi veya çöktü! 5 saniye sonra yeniden baslatiliyor...
echo [!] Durdurmak icin Ctrl+C tuslarina basin.
echo ====================================================
timeout /t 5
goto start
