@echo off
title HDWP Bot - Yerel Push ve VDS Guncelleme
color 0A

echo ==============================================
echo       HDWP BOT YEREL YUKLEME VE VDS TETIKLEME
echo ==============================================
echo.

:: 1. GitHub'a Push
echo [*] Yerel degisiklikler Git'e ekleniyor...
git add .
set /p commit_msg="Commit mesaji girin (varsayilan: 'Otomatik Guncelleme'): "
if "%commit_msg%"=="" set commit_msg=Otomatik Guncelleme

git commit -m "%commit_msg%"
echo [*] GitHub'a gonderiliyor...
git push origin main
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [x] GitHub'a push yapilamadi!
    pause
    exit /b
)

:: 2. VDS'e Baglanip Pull & Restart
echo.
echo ==============================================
echo       VDS UZERINDE GUNCELLEME TETIKLENIYOR
echo ==============================================
echo.
set VDS_IP=111.235.150.157
set VDS_USER=Administrator

echo [*] VDS'e baglaniliyor ve git pull tetikleniyor...
ssh -i "%USERPROFILE%\.ssh\id_ed25519" -o StrictHostKeyChecking=no %VDS_USER%@%VDS_IP% "cd \"C:\Users\Administrator\Desktop\keke\wpbot\" && git pull && pm2 restart wp-bot || pm2 restart all || npm restart"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [x] VDS guncellemesi sirasinda hata olustu! SSH anahtarinizi veya VDS baglantinizi kontrol edin.
) else (
    echo.
    echo [+] Basarili! VDS guncellendi ve bot yeniden baslatildi.
)

pause
