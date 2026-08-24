@echo off
:: ====================================================================
:: VDS HIZLI VE SIFRESIZ BAGLANTI SCRIPT
:: ====================================================================
:: Lutfen asagidaki IP adresini kendi VDS IP adresinizle degistirin:
set VDS_IP=111.235.150.157
set VDS_USER=Administrator

:: SSH Klasorunu kontrol et ve anahtar yoksa uret
if not exist "%USERPROFILE%\.ssh\id_ed25519.pub" (
    echo [+] SSH anahtari bulunamadi. Yeni anahtar uretiliyor...
    ssh-keygen -t ed25519 -N "" -f "%USERPROFILE%\.ssh\id_ed25519"
)

echo.
echo ====================================================================
echo  VDS SIFRESIZ GIRIS AKTIFLESTIRME
echo ====================================================================
echo [*] Bu adimda sunucunun mevcut sifresini BIR DEFAYA MAHSUS girin.
echo [*] Giris yaptiktan sonra baglanti sonlanacak ve kurulum tamamlanacaktir.
echo ====================================================================
echo.

type "%USERPROFILE%\.ssh\id_ed25519.pub" | ssh %VDS_USER%@%VDS_IP% "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [x] Hata olustu! IP adresini dogru girdiginizden emin olun.
    pause
    exit /b
)

echo.
echo ====================================================================
echo [+][+][+] BASARILI! Artik sifre sormayacak. Sunucuya baglaniliyor...
echo ====================================================================
echo.
pause

ssh %VDS_USER%@%VDS_IP%
