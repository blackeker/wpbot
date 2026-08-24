@echo off
title GoodbyeDPI Başlatıcı
tasklist /FI "IMAGENAME eq goodbyedpi.exe" 2>NUL | find /I /N "goodbyedpi.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [!] GoodbyeDPI zaten arka planda calisiyor!
    pause
    exit /b
)
cd /d "%~dp0..\goodbyedpi\goodbyedpi-0.2.3rc3-2\x86_64"
echo [+] GoodbyeDPI arka planda baslatiliyor...
start "" goodbyedpi.exe -9
echo [+] Basariyla baslatildi!
pause
