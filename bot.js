import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import QRCodeImage from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import axios from 'axios';

import { 
  botSocketRef, 
  sessionPath, 
  botState, 
  pairingState, 
  setupPingTimer,
  formatBytes,
  readConfig,
  writeConfig,
  cleanOldDownloads,
  pendingHentaizmLogins,
  readHistory,
  readErrorLog,
  getDiskUsage,
  backupSession,
  restoreSession
} from './config.js';

import { 
  downloadQueue, 
  activeTask, 
  pendingSelections, 
  addDownloadTask, 
  cancelDownloadTask,
  clearQueue,
  queueState,
  pauseQueue,
  resumeQueue,
  getEstimatedWaitTime
} from './queue.js';

import { 
  startServer, 
  startCaptchaPoller, 
  activeCaptchasMap 
} from './server.js';

import {
  solveDiscordCaptcha,
  getDiscordStatus,
  controlMainBot,
  controlAltBots,
  updateSystemSettings,
  checkBans,
  getBans,
  addSpamCommand,
  deleteSpamCommand,
  triggerPotato
} from './discordApi.js';

const logger = pino({ level: 'silent' });
const PORT = process.env.PORT || 7860;

// Setup keep-alive ping
setupPingTimer(botState.pingUrl);

async function startBot() {
  restoreSession();
  let version = [2, 3000, 1037641644];
  try {
    const { version: latestVersion } = await fetchLatestBaileysVersion();
    version = latestVersion;
  } catch (err) {
    // Fail silent
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: logger,
    browser: Browsers.macOS('Desktop'),
    printQRInTerminal: false
  });

  botSocketRef.current = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !sock.authState.creds.registered) {
      if (!pairingState.isPairingMode) {
        botState.status = 'qr';
        try {
          botState.qrCodeUrl = await QRCodeImage.toDataURL(qr);
        } catch (err) {
          console.error('QR code generation error:', err);
        }
        console.clear();
        console.log('====================================');
        console.log('--- WhatsApp Bot QR Code ---');
        console.log('Scan the QR code below using your WhatsApp Linked Devices:');
        console.log('====================================');
        qrcode.generate(qr, { small: true });
      } else {
        botState.status = 'connecting';
        console.log('[PAIRING] QR baskı atlandı, pairing code bekleniyor...');
      }
    }

    if (connection === 'connecting' && pairingState.isPairingMode && pairingState.pairingPhoneNumber) {
      const cleanPhone = pairingState.pairingPhoneNumber.replace(/[^0-9]/g, '');
      console.log(`[PAIRING] Bağlantı kuruluyor, kod isteniyor: ${cleanPhone}`);
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(cleanPhone);
          botState.pairingCode = code;
          botState.pairingMode = true;
          botState.status = 'pairing';
          console.log(`\n🔑 PAIRING CODE: ${code}\n`);
        } catch (err) {
          console.error('[PAIRING] Hata:', err.message);
          pairingState.isPairingMode = false;
          botState.pairingMode = false;
        }
      }, 3000);
    }

    if (connection === 'close') {
      botState.status = 'disconnected';
      botState.qrCodeUrl = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || lastDisconnect?.error || 'Bilinmeyen Hata';
      
      console.log(`Connection closed (Sebep: ${reason}, Code: ${statusCode}).`);

      // Status 401: Logged out (session reset required)
      if (statusCode === 401) {
        console.log('[BOT] Oturum kapatıldı (401), oturum verileri temizleniyor...');
        try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch(e) {}
      }

      // Status 440/428/Conflict: Stream Errored (Avoid rapid reconnect loop)
      const delay = (statusCode === 428 || statusCode === 440 || String(reason).includes('conflict')) ? 10000 : 5000;
      console.log(`Reconnecting in ${delay/1000}s...`);
      setTimeout(() => startBot(), delay);
    } else if (connection === 'open') {
      botState.status = 'connected';
      botState.qrCodeUrl = null;
      botState.pairingCode = null;
      botState.pairingMode = false;
      pairingState.isPairingMode = false; // Reset pairing mode flag
      backupSession();
      console.clear();
      console.log('====================================');
      console.log('WhatsApp Bot is successfully connected and online!');
      console.log('====================================');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = (msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '').trim();
    const ltext = text.toLowerCase().trim();

    // ─── Desteklenen domain listesi (URL algılama için) ───
    const SUPPORTED_DOMAINS = [
      'hdfilmcehennemi', 'animecix', 'ecchicix', 'hentaizm',
      'youtube.com', 'youtu.be', 'pornhub.com', 'doeda', 'hdabla', 'hdkore',
      'turkifsahub', 'turkifsalar', 'turkporno', 'cloud.mail.ru', 'cloidmail.ru'
    ];
    const isLink = text.startsWith('http://') || text.startsWith('https://');
    const isSupportedLink = isLink && SUPPORTED_DOMAINS.some(d => text.includes(d));

    // 0. Pending Quality Selection Handler
    if (pendingSelections[from]) {
      const selectionIndex = parseInt(text, 10) - 1;
      const selection = pendingSelections[from];
      if (!isNaN(selectionIndex) && selectionIndex >= 0 && selectionIndex < selection.formats.length) {
        const chosen = selection.formats[selectionIndex];
        delete pendingSelections[from];
        try {
          const task = addDownloadTask(selection.url, from, selection.title, chosen.format_id);
          await sock.sendMessage(from, { text: `✅ *${chosen.label}* kalitesi seçildi!\n
📥 Sıraya eklendi, bekleme sırası çok olmadığı sürece kısa süre içinde başlayacak.\n
🔢 Görev no: *${task.id}*  |  Kuyruk: *kuyruk* yaz` });
        } catch (err) {
          await sock.sendMessage(from, { text: `⚠️ Bir sorun oluştu: ${err.message}` });
        }
        return;
      } else if (ltext === 'iptal' || ltext === 'vazgeç' || ltext === 'cancel') {
        delete pendingSelections[from];
        await sock.sendMessage(from, { text: '❌ Kalite seçimi iptal edildi.' });
        return;
      }
    }

    // 0.5. Hentaizm Auto-Login Captcha Handler
    if (pendingHentaizmLogins[from]) {
      const captchaText = text.trim();
      const loginState = pendingHentaizmLogins[from];
      delete pendingHentaizmLogins[from];

      await sock.sendMessage(from, { text: `⏳ Güvenlik kodu gönderiliyor, lütfen bekle...` });

      try {
        const gotScrapingModule = await import('got-scraping');
        
        const loginRes = await gotScrapingModule.gotScraping.post({
          url: "https://www.hentaizm1.com/login.php",
          cookieJar: loginState.cookieJar,
          form: {
            username: "blackeker@gmail.com",
            password: "Yusufcuk1.",
            remember_me: "1",
            captcha: captchaText,
            login: "Giriş"
          },
          followRedirect: true,
          headerGeneratorOptions: {
            devices: ['desktop'],
            locales: ['tr-TR', 'en-US'],
            operatingSystems: ['windows']
          }
        });

        const cookies = loginState.cookieJar.getCookieStringSync("https://www.hentaizm1.com/");
        const isLogged = cookies.includes('wordpress_logged_in') || loginRes.body.includes('Profil') || loginRes.body.includes('Çıkış');

        if (isLogged) {
          writeConfig({ hentaizmCookies: loginState.cookieJar.toJSON() });
          await sock.sendMessage(from, { text: "✅ Hentaizm girişi başarılı! Şimdi linki tekrar gönderebilirsin." });
          try {
            if (fs.existsSync(loginState.captchaPath)) fs.unlinkSync(loginState.captchaPath);
          } catch (e) {}
        } else {
          await sock.sendMessage(from, { text: `❌ Güvenlik kodu yanlış. Linki tekrar gönder, yeni bir kod üreteyim.` });
        }
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Giriş sırasında hata oluştu: ${err.message}` });
      }
      return;
    }

    // 1. Menü / Yardım
    const isMenuRequest = [
      'menü', 'menu', 'merhaba', 'selam', 'sa', 'hey', 'hi',
      'ne yapabilirsin', 'ne yaparsın', 'yardım', 'yardim',
      '!yardım', '!yardim', '!help', 'help', '!menu', '!menü'
    ].includes(ltext);

    if (isMenuRequest) {
      const menuText =
`🤖 *İndirme Botu Gelişmiş Komut Paneli*

Herhangi bir link gönderdiğinizde otomatik indirmeyi başlatırım. Alternatif olarak aşağıdaki komutları kullanabilirsiniz:

📥 *İNDİRME VE KUYRUK KOMUTLARI:*
• *!indir <link>* veya direkt link → İndirmeyi başlatır.
• *kuyruk* veya *!kuyruk* → Sıradaki ve aktif görevleri listeler.
• *iptal* veya *!iptal* → Aktif olarak inen görevi iptal eder.
• *dur* / *durdur* → İndirme kuyruğunu duraklatır.
• *devam* → Duraklatılmış kuyruğu devam ettirir.

📊 *SİSTEM VE DURUM KOMUTLARI:*
• *durum* veya *!durum* → Botun aktiflik ve bağlantı durumunu gösterir.
• *geçmiş* veya *!geçmiş* → Tamamlanan son 10 indirmeyi listeler.
• *disk* veya *!disk* → Sunucu disk doluluk oranını gösterir.
• *hız* veya *!hız* → Aktif indirme hızını raporlar.
• *hatalar* veya *!hatalar* → Son oluşan hataları listeler.
• *güncelle* → Bot dosyalarını en son sürüme günceller.

⚙️ *YÖNETİCİ VE GELİŞMİŞ KOMUTLAR:*
• *!tekrargönder <görevNo>* → İndirilmiş dosyayı WhatsApp'a tekrar atar.
• *!çöz <durumKodu> <kod>* → Captcha doğrulamasını çözer.
• *!çerez <veri>* → Çerez ayarlarını günceller.
• *!komutekle <tetikleyici> <cevap>* → Bota özel komut ekler.
• *!komutsil <tetikleyici>* → Eklenen özel komutu siler.
• *!pingurl <link>* → Sunucudan o linke erişim testi yapar.
• *!botkontrol* → Botun çalışma durumunu test eder.

🎬 *DESTEKLENEN SİTELER:*
• Cloud Mail.ru / CloidMail.ru 🆕 (Zipped & Split)
• YouTube / Youtu.be
• AnimeCix / EcchiCix
• HDFilmCehennemi
• Ve diğer popüler siteler...

────────────────────
_Sadece linki atın, gerisini ben hallederim!_ ✨`;
      await sock.sendMessage(from, { text: menuText });
      return;
    }

    // 2. Kuyruk / durum kısayolları (komut öneksiz)
    const isQueueCheck = ['kuyruk', '!kuyruk', 'ne var', 'nerede', 'durum ne', 'kac tane', 'kaç tane'].includes(ltext);
    const isStatusCheck = ['durum', 'status', '!durum', 'bot durumu', 'durum?'].includes(ltext);
    const isDiskCheck = ['disk', '!disk', 'yer', 'depolama'].includes(ltext);
    const isHistoryCheck = ['geçmiş', 'gecmis', '!gecmis', '!geçmiş', 'indirdim', 'son indirmeler'].includes(ltext);
    const isErrorCheck = ['hatalar', 'hata', '!hatalar', 'sorun', 'neden olmadı'].includes(ltext);
    const isSpeedCheck = ['hız', 'hiz', '!hız', '!hiz', 'hız ne', 'nasıl gidiyor'].includes(ltext);
    const isPauseCmd = ['dur', 'durdur', '!dur', 'bekle', 'pause'].includes(ltext);
    const isResumeCmd = ['devam', '!devam', 'başlat', 'resume'].includes(ltext);
    const isCancelActive = ['iptal', 'durdur aktif', 'aktifi iptal', 'cancel'].includes(ltext);
    const isUpdateCmd = ['güncelle', 'guncelle', '!güncelle', '!guncelle', 'update'].includes(ltext);

    // ─── Update Command ───
    if (isUpdateCmd) {
      await sock.sendMessage(from, { text: '🔄 Güncelleme kontrol ediliyor...' });
      exec('git pull', (err, stdout) => {
        if (err) {
          sock.sendMessage(from, { text: `❌ Güncelleme başarısız: ${err.message}` });
          return;
        }
        sock.sendMessage(from, { text: `✅ Güncellendi!\n${stdout || 'Zaten güncel.'}\n\nBot yeniden başlatılıyor...` }).then(() => {
          setTimeout(() => process.exit(0), 2000);
        });
      });
      return;
    }

    // ─── !dur / !devam — Kuyruğu Duraklat / Devam Et ───
    if (text.startsWith('!dur') || text.startsWith('!durdur') || isPauseCmd) {
      pauseQueue();
      await sock.sendMessage(from, { text: `⏸️ *Kuyruk duraklatıldı!*\nAktif indirme tamamlanacak ama yeni görev başlamayacak.\nDevam ettirmek için: *devam* yaz` });
      return;
    }

    if (text === '!devam' || isResumeCmd) {
      resumeQueue();
      await sock.sendMessage(from, { text: `▶️ *Kuyruk devam ediyor!*\n${downloadQueue.length > 0 ? `Sırada ${downloadQueue.length} görev var.` : 'Kuyruk boş.'}` });
      return;
    }

    // ─── !hız — Anlık İndirme Hızı ───
    if (text === '!hiz' || text === '!hız' || isSpeedCheck) {
      if (activeTask.current && activeTask.current.speed) {
        const elapsed = activeTask.current.startTime ? Math.round((Date.now() - activeTask.current.startTime) / 1000) : 0;
        const elapsedStr = elapsed > 60 ? `${Math.floor(elapsed/60)}dk ${elapsed%60}sn` : `${elapsed}sn`;
        await sock.sendMessage(from, { text: `⚡ *Anlık hız: ~${activeTask.current.speed} MB/s*\n🎬 ${activeTask.current.title}\n⏳ ${elapsedStr} geçti\n📊 ${activeTask.current.status || 'Başlatılıyor...'}` });
      } else if (activeTask.current) {
        await sock.sendMessage(from, { text: `⏳ İndirme devam ediyor...\n🎬 ${activeTask.current.title}\n📊 ${activeTask.current.status || 'Başlatılıyor...'}` });
      } else {
        await sock.sendMessage(from, { text: '💤 Şu an aktif indirme yok.' });
      }
      return;
    }

    // ─── !durum — Bot Sağlık Durumu ───
    if (text === '!durum' || text === '!status' || isStatusCheck) {
      const uptimeMs = Date.now() - botState.uptime.getTime();
      const uptimeSec = Math.round(uptimeMs / 1000);
      const uptimeStr = `${Math.floor(uptimeSec/3600)}sa ${Math.floor((uptimeSec%3600)/60)}dk ${uptimeSec%60}sn`;
      const memUsage = process.memoryUsage();
      const { totalBytes } = getDiskUsage();
      const statusEmoji = botState.status === 'connected' ? '🟢' : '🔴';
      const queueEmoji = queueState.isPaused ? '⏸️ Beklemede' : '▶️ Aktif';

      const reply =
        `🖥️ *Bot Durum Raporu*\n\n` +
        `${statusEmoji} Bağlantı: ${botState.status}\n` +
        `⏱️ Çalışma: ${uptimeStr}\n` +
        `🧠 RAM: ${formatBytes(memUsage.rss)}\n` +
        `💾 Disk: ${formatBytes(totalBytes)}\n` +
        `📋 Kuyruk: ${queueEmoji} (${downloadQueue.length} bekliyor)\n` +
        `🎬 Aktif: ${activeTask.current ? activeTask.current.title : 'Yok'}`;
      await sock.sendMessage(from, { text: reply });
      return;
    }

    // ─── !disk — Disk Kullanımı ───
    if (text === '!disk' || isDiskCheck) {
      const { totalBytes, files } = getDiskUsage();
      let reply = `💾 *Disk Kullanımı*\n\n📦 Toplam: *${formatBytes(totalBytes)}*\n📂 Dosya: *${files.length} adet*\n`;
      if (files.length > 0) {
        reply += `\n🏆 *En büyük 5 dosya:*\n`;
        files.slice(0, 5).forEach((f, i) => {
          const age = Math.round((Date.now() - f.mtime) / 3600000);
          reply += `${i+1}. ${f.name.slice(0,35)} — ${formatBytes(f.size)} (${age}sa önce)\n`;
        });
      } else {
        reply += '\n_Klasör boş._';
      }
      await sock.sendMessage(from, { text: reply });
      return;
    }

    // ─── !gecmis — İndirme Geçmişi ───
    if (text === '!gecmis' || text === '!geçmiş' || isHistoryCheck) {
      const history = readHistory().slice(0, 10);
      if (history.length === 0) {
        await sock.sendMessage(from, { text: '📋 Henüz tamamlanmış bir indirme yok.' });
        return;
      }
      let reply = `📋 *Son İndirmelerim*\n\n`;
      history.forEach((h, i) => {
        const date = new Date(h.timestamp).toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        reply += `${i+1}. *${h.title?.slice(0, 35) || 'Bilinmiyor'}*\n   • ${h.sizeMB}MB • ${h.duration} • ${date}\n`;
      });
      await sock.sendMessage(from, { text: reply });
      return;
    }

    // ─── !hatalar — Hata Geçmişi ───
    if (text === '!hatalar' || text === '!errors' || isErrorCheck) {
      const errors = readErrorLog().slice(0, 5);
      if (errors.length === 0) {
        await sock.sendMessage(from, { text: '✅ Hiç hata kayıdı yok, harika!' });
        return;
      }
      let reply = `❌ *Son Hatalar*\n\n`;
      errors.forEach((e, i) => {
        const date = new Date(e.timestamp).toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        reply += `${i+1}. *${(e.title || e.url)?.slice(0,35)}*\n   • ${e.error?.slice(0, 80)}\n   • ${date}\n`;
      });
      await sock.sendMessage(from, { text: reply });
      return;
    }

    // ─── !temizle — Manuel Temizleme ───
    if (text === '!temizle' || ltext === 'temizle') {
      const { files: before } = getDiskUsage();
      cleanOldDownloads();
      const { files: after, totalBytes } = getDiskUsage();
      const deleted = before.length - after.length;
      await sock.sendMessage(from, { text: `🧹 Temizlik tamam!\n🗑️ ${deleted} eski dosya silindi.\n💾 Kalan: ${formatBytes(totalBytes)} (${after.length} dosya)` });
      return;
    }

    // ─── !tekrargonder — Dosya Tekrar Gönder ───
    if (text.startsWith('!tekrargonder') || text.startsWith('!tekrargönder') || ltext.startsWith('tekrar gönder') || ltext.startsWith('tekrar gonder')) {
      const fileName = text.split(' ').slice(1).join(' ').trim();
      if (!fileName) {
        const { files } = getDiskUsage();
        if (files.length === 0) {
          await sock.sendMessage(from, { text: '📂 Klasörde hiç dosya yok.' });
          return;
        }
        let reply = '📂 *Mevcut dosyalar:*\n\n';
        files.slice(0, 10).forEach((f, i) => {
          reply += `${i+1}. ${f.name} (${formatBytes(f.size)})\n`;
        });
        reply += `\nGöndermek için:\n*!tekrargonder <dosya adı>*`;
        await sock.sendMessage(from, { text: reply });
        return;
      }

      const { downloadsDir: dlDir } = await import('./config.js');
      const filePath = path.join(dlDir, fileName);
      if (!fs.existsSync(filePath)) {
        await sock.sendMessage(from, { text: `❌ "${fileName}" bulunamadı.\n\n*!tekrargonder* yaz, mevcut dosyaları listelerim.` });
        return;
      }
      const stat = fs.statSync(filePath);
      await sock.sendMessage(from, { text: `📤 Gönderiliyor: ${fileName} (${formatBytes(stat.size)})` });
      try {
        await sock.sendMessage(from, {
          document: { stream: fs.createReadStream(filePath) },
          mimetype: 'video/mp4',
          fileName
        });
        await sock.sendMessage(from, { text: `✅ Gönderildi!` });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Gönderemedi: ${err.message}` });
      }
      return;
    }

    // 3. Ping URL Setup Command
    if (text.startsWith('!pingurl')) {
      const parts = text.split(' ');
      if (parts.length < 2) {
        await sock.sendMessage(from, { text: `Mevcut Ping URL: \`${botState.pingUrl || 'Ayarlanmamış'}\`\n\nAyarlamak için: \`!pingurl https://linkiniz.com\`` });
        return;
      }

      const newUrl = parts[1].trim();
      if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
        await sock.sendMessage(from, { text: '❌ Geçersiz URL. URL `http://` veya `https://` ile başlamalıdır.' });
        return;
      }

      botState.pingUrl = newUrl;
      writeConfig({ pingUrl: newUrl });
      setupPingTimer(newUrl);

      await sock.sendMessage(from, { text: `✅ Canlı tutma adresi güncellendi ve kaydedildi:\n\`${newUrl}\`` });
      return;
    }

    // ─── Discord Bot & Captcha Commands ───
    if (text === '!captcha') {
      try {
        const data = await getDiscordStatus();
        // Since we want raw active captchas, check the Discord captcha endpoint
        const response = await axios.get('http://127.0.0.1:8181/api/captcha');
        const captchaData = response.data;
        if (captchaData.success && captchaData.captchas && captchaData.captchas.length > 0) {
          for (const cap of captchaData.captchas) {
            let infoText = `⚠️ *CAPTCHA BELİRDİ!* ⚠️\n\n`;
            infoText += `👤 *Hesap:* ${cap.username} (${cap.account === 'main' ? 'Ana Hesap' : 'Yan Hesap'})\n`;
            infoText += `🆔 *Mesaj ID:* \`${cap.messageId}\`\n`;
            infoText += `📺 *Kanal ID:* \`${cap.channelId}\`\n`;
            infoText += `🌐 *Sunucu ID:* \`${cap.guildId}\`\n\n`;
            infoText += `💬 *Çözmek için komut:* \n\`!coz ${cap.account === 'main' ? '' : cap.token + ' '}${cap.channelId} KOD\`\n`;
            
            const imgUrl = `http://127.0.0.1:8181${cap.localImageUrl}`;
            try {
              const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer' });
              if (imgRes.status === 200) {
                await sock.sendMessage(from, { 
                  image: Buffer.from(imgRes.data), 
                  caption: infoText 
                });
              } else {
                await sock.sendMessage(from, { text: infoText + `⚠️ Resim indirilemedi (HTTP ${imgRes.status})` });
              }
            } catch (imgErr) {
              await sock.sendMessage(from, { text: infoText + `⚠️ Resim indirilemedi: ${imgErr.message}` });
            }
          }
        } else {
          await sock.sendMessage(from, { text: '✅ *Harika!* Şu anda kilitli veya çözülmeyi bekleyen bir captcha bulunmuyor.' });
        }
      } catch (e) {
        await sock.sendMessage(from, { text: `❌ *Hata:* Discord API ile bağlantı kurulamadı.\n${e.message}` });
      }
      return;
    }

    if (text.startsWith('!coz') || text.startsWith('!çöz')) {
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        await sock.sendMessage(from, { text: '⚠️ *Kullanım:* \n`!coz <KOD>` (Ana bot ise)\n`!coz <KANAL_ID> <KOD>`\n`!coz <TOKEN> <KANAL_ID> <KOD>`' });
        return;
      }
      
      try {
        let payload = {};
        if (parts.length === 2) {
          const statusRes = await axios.get('http://127.0.0.1:8181/api/captcha');
          const captchas = statusRes.data.captchas || [];
          const mainCap = captchas.find(c => c.account === 'main');
          if (!mainCap) {
            await sock.sendMessage(from, { text: '❌ Aktif ana hesap captchası bulunamadı. Lütfen kanal ID belirtin.' });
            return;
          }
          payload = {
            channelId: mainCap.channelId,
            code: parts[1]
          };
        } else if (parts.length === 3) {
          const durumKodu = parts[1];
          const code = parts[2];
          
          let capDetails = activeCaptchasMap.get(durumKodu);
          
          if (!capDetails) {
            const statusRes = await axios.get('http://127.0.0.1:8181/api/captcha').catch(() => null);
            const captchas = statusRes?.data?.captchas || [];
            const matchedCap = captchas.find(c => c.messageId === durumKodu);
            if (matchedCap) {
              capDetails = {
                channelId: matchedCap.channelId,
                token: matchedCap.token,
                accountType: matchedCap.account
              };
            }
          }
          
          if (capDetails) {
            payload = {
              token: capDetails.token || undefined,
              channelId: capDetails.channelId,
              code: code
            };
          } else {
            payload = {
              channelId: parts[1],
              code: parts[2]
            };
          }
        } else {
          payload = {
            token: parts[1],
            channelId: parts[2],
            code: parts[3]
          };
        }
        
        const solveRes = await solveDiscordCaptcha(payload);
        if (solveRes.success) {
          await sock.sendMessage(from, { text: `✅ *Çözüm Gönderildi:* \`${payload.code}\` başarıyla sıraya eklendi.` });
        } else {
          await sock.sendMessage(from, { text: `❌ *Hata:* Çözüm gönderilemedi. ${solveRes.error || ''}` });
        }
      } catch (e) {
        let errMsg = e.message;
        if (e.response && e.response.data && e.response.data.error) {
          errMsg = e.response.data.error;
        }
        await sock.sendMessage(from, { text: `❌ *Hata:* ${errMsg}` });
      }
      return;
    }

    if (text === '!bots' || text === '!botlar') {
      try {
        const data = await getDiscordStatus();
        if (data.success) {
          let statusText = `🤖 *BOT DURUMU & AYARLAR* 🤖\n\n`;
          statusText += `👑 *Ana Bot:* ${data.botState.isRunning ? '🟢 Çalışıyor' : '🔴 Durduruldu'}\n`;
          statusText += `👤 *Kullanıcı:* ${data.botState.user || 'Giriş yapılmamış'}\n`;
          statusText += `🔒 *Kilitli mi:* ${data.botState.isCaptchaBlocked ? '⚠️ EVET (Captcha)' : '✅ Hayır'}\n\n`;
          
          statusText += `👥 *Yan Hesaplar (Farm):* \n`;
          if (data.botState.alts && data.botState.alts.length > 0) {
            data.botState.alts.forEach(alt => {
              statusText += `- ${alt.username}: ${alt.isRunning ? '🟢' : '🔴'} ${alt.isCaptchaBlocked ? '(⚠️ Captcha)' : ''}\n`;
            });
          } else {
            statusText += `_Aktif yan hesap yok._\n`;
          }
          
          statusText += `\n⚙️ *Genel Ayarlar:* \n`;
          statusText += `- Otomatik Çözüm: ${data.settings.autoSolveCaptcha ? '🟢 Açık' : '🔴 Kapalı'}\n`;
          statusText += `- Captcha Sistemi: ${data.settings.captchaEnabled ? '🟢 Açık' : '🔴 Kapalı'}\n`;
          statusText += `- Günlük Ödül: ${data.settings.dailyEnabled ? '🟢 Açık' : '🔴 Kapalı'}\n`;
          statusText += `- Patates Gönderimi: ${data.settings.potatoEnabled ? '🟢 Açık' : '🔴 Kapalı'}\n`;
          
          await sock.sendMessage(from, { text: statusText });
        }
      } catch (e) {
        await sock.sendMessage(from, { text: `❌ *Hata:* Bağlantı sorunu.\n${e.message}` });
      }
      return;
    }

    if (text.startsWith('!botkontrol')) {
      const parts = text.split(/\s+/);
      if (parts.length < 3) {
        await sock.sendMessage(from, { text: '⚠️ *Kullanım:* `!botkontrol <main|alts> <start|stop|toggle>`' });
        return;
      }
      const target = parts[1].toLowerCase();
      const action = parts[2].toLowerCase();
      
      try {
        if (target === 'main') {
          const res = await controlMainBot(action);
          await sock.sendMessage(from, { text: `✅ Ana bot kontrolü gönderildi. Durum: ${res.isRunning ? '🟢 Çalışıyor' : '🔴 Durduruldu'}` });
        } else if (target === 'alts') {
          const actionMap = { start: 'startAll', stop: 'stopAll' };
          const act = actionMap[action] || action;
          const res = await controlAltBots(act);
          await sock.sendMessage(from, { text: `✅ Yan botlar kontrolü gönderildi. Aktif hesap: ${res.activeAltsCount}` });
        } else {
          await sock.sendMessage(from, { text: '❌ Geçersiz hedef. `main` veya `alts` seçin.' });
        }
      } catch (e) {
        await sock.sendMessage(from, { text: `❌ *Hata:* Bağlantı sorunu.\n${e.message}` });
      }
      return;
    }

    if (text.startsWith('!gem')) {
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        await sock.sendMessage(from, { text: '⚠️ *Kullanım:* `!gem <ac|kapat>` veya `!gem <aç|kapat>`' });
        return;
      }
      const action = parts[1].toLowerCase();
      const enabled = (action === 'ac' || action === 'aç' || action === 'on' || action === 'true');
      
      try {
        const res = await updateSystemSettings('gem', enabled);
        if (res.success) {
          await sock.sendMessage(from, { text: `💎 *Auto Gem Sistemi:* ${enabled ? '🟢 AKTİF (Açık)' : '🔴 PASİF (Kapalı)'}` });
        } else {
          await sock.sendMessage(from, { text: `❌ Sistem güncellenemedi.` });
        }
      } catch (e) {
        await sock.sendMessage(from, { text: `❌ *Hata:* Bağlantı sorunu.\n${e.message}` });
      }
      return;
    }

    if (text === '!bancheck' || text === '!bankontrol') {
      try {
        await sock.sendMessage(from, { text: '⏳ Yan hesaplar ban durumu taranıyor...' });
        const res = await checkBans();
        const results = res.results || {};
        let reply = `📋 *BAN TARAMA SONUÇLARI* 📋\n\n`;
        Object.keys(results).forEach(username => {
          const details = results[username];
          reply += `- *${username}:* ${details.status === 'Active' ? '🟢 Aktif' : '🔴 BANLI'}\n`;
          if (details.reason) reply += `  └ Sebep: \`${details.reason}\` | Süre: \`${details.unbanTime}\`\n`;
        });
        await sock.sendMessage(from, { text: reply });
      } catch (e) {
        await sock.sendMessage(from, { text: `❌ *Hata:* Bağlantı sorunu.\n${e.message}` });
      }
      return;
    }

    if (text === '!banlar') {
      try {
        const res = await getBans();
        const bans = res.bans || {};
        let reply = `📋 *KAYITLI BAN DURUMLARI* 📋\n\n`;
        const usernames = Object.keys(bans);
        if (usernames.length === 0) {
          reply += `_Kayıtlı herhangi bir banlı hesap bulunmuyor._`;
        } else {
          usernames.forEach(username => {
            const details = bans[username];
            const isBanned = details.status === 'Banned' || details.status === 'Banned (Kara Liste)';
            reply += `- *${username}:* ${isBanned ? '🔴 BANLI' : '🟢 Aktif'}\n`;
            if (isBanned) {
              reply += `  └ Süre: \`${details.unbanTime || 'Bilinmiyor'}\` | Sebep: \`${details.reason || 'Bilinmiyor'}\`\n`;
            }
          });
        }
        await sock.sendMessage(from, { text: reply });
      } catch (e) {
        await sock.sendMessage(from, { text: `❌ *Hata:* Bağlantı sorunu.\n${e.message}` });
      }
      return;
    }

    if (text === '!komutlar') {
      try {
        const data = await getDiscordStatus();
        if (data.success) {
          let reply = `📋 *KAYITLI SPAM KOMUTLARI* 📋\n\n`;
          
          reply += `👑 *Ana Hesap Komutları:* \n`;
          const mainCmds = data.settings.commands || [];
          if (mainCmds.length === 0) {
            reply += ` _Komut bulunmuyor._\n`;
          } else {
            mainCmds.forEach((cmd, idx) => {
              reply += ` ${idx + 1}. \`${cmd.text}\` (Delay: ${cmd.minDelay / 1000}s - ${cmd.maxDelay / 1000}s)\n`;
            });
          }
          
          reply += `\n👥 *Yan Hesap Komutları:* \n`;
          const altCmds = data.settings.altCommands || [];
          if (altCmds.length === 0) {
            reply += ` _Komut bulunmuyor._\n`;
          } else {
            altCmds.forEach((cmd, idx) => {
              reply += ` ${idx + 1}. \`${cmd.text}\` (Delay: ${cmd.minDelay / 1000}s - ${cmd.maxDelay / 1000}s)\n`;
            });
          }
          
          await sock.sendMessage(from, { text: reply });
        }
      } catch (e) {
        await sock.sendMessage(from, { text: `❌ *Hata:* ${e.message}` });
      }
      return;
    }

    if (text.startsWith('!komutekle')) {
      const parts = text.split(/\s+/);
      if (parts.length < 5) {
        await sock.sendMessage(from, { text: '⚠️ *Kullanım:* `!komutekle <main|alt> <metin> <minDelay_saniye> <maxDelay_saniye>`\n*Örn:* `!komutekle alt +c 7 8`' });
        return;
      }
      
      const type = parts[1].toLowerCase();
      const cmdText = parts[2];
      const minS = parseFloat(parts[3]);
      const maxS = parseFloat(parts[4]);
      
      if (type !== 'main' && type !== 'alt') {
        await sock.sendMessage(from, { text: '❌ Geçersiz tip. `main` veya `alt` kullanın.' });
        return;
      }
      if (isNaN(minS) || isNaN(maxS)) {
        await sock.sendMessage(from, { text: '❌ Süreler sayısal olmalıdır.' });
        return;
      }
      
      try {
        const res = await addSpamCommand({
          text: cmdText,
          minDelay: minS * 1000,
          maxDelay: maxS * 1000,
          isAlt: type === 'alt'
        });
        if (res.success) {
          await sock.sendMessage(from, { text: `✅ \`${cmdText}\` komutu (${minS}s - ${maxS}s) ${type === 'main' ? 'Ana Hesap' : 'Yan Hesaplar'} listesine eklendi.` });
        }
      } catch (e) {
        let errMsg = e.message;
        if (e.response && e.response.data && e.response.data.error) errMsg = e.response.data.error;
        await sock.sendMessage(from, { text: `❌ *Hata:* ${errMsg}` });
      }
      return;
    }

    if (text.startsWith('!komutsil')) {
      const parts = text.split(/\s+/);
      if (parts.length < 3) {
        await sock.sendMessage(from, { text: '⚠️ *Kullanım:* `!komutsil <main|alt> <sira_no>`\n*Örn:* `!komutsil alt 1`' });
        return;
      }
      
      const type = parts[1].toLowerCase();
      const index = parseInt(parts[2], 10);
      
      if (type !== 'main' && type !== 'alt') {
        await sock.sendMessage(from, { text: '❌ Geçersiz tip. `main` veya `alt` kullanın.' });
        return;
      }
      if (isNaN(index) || index <= 0) {
        await sock.sendMessage(from, { text: '❌ Sıra numarası geçerli bir sayı olmalıdır.' });
        return;
      }
      
      try {
        const res = await deleteSpamCommand(type, index - 1);
        if (res.success) {
          await sock.sendMessage(from, { text: `✅ ${type === 'main' ? 'Ana Hesap' : 'Yan Hesaplar'} listesinden ${index}. sıradaki komut silindi.` });
        }
      } catch (e) {
        let errMsg = e.message;
        if (e.response && e.response.data && e.response.data.error) errMsg = e.response.data.error;
        await sock.sendMessage(from, { text: `❌ *Hata:* ${errMsg}` });
      }
      return;
    }

    if (text === '!patates' || text === '!patatesat') {
      try {
        await sock.sendMessage(from, { text: '⏳ Yan hesaplardan patates gönderimi tetikleniyor...' });
        const res = await triggerPotato();
        if (res.success) {
          await sock.sendMessage(from, { text: '🥔 Patates gönderimi başarıyla başlatıldı!' });
        }
      } catch (e) {
        await sock.sendMessage(from, { text: `❌ *Hata:* ${e.message}` });
      }
      return;
    }

    if (text.startsWith('!cerez') || text.startsWith('!çerez')) {
      const cookieText = text.substring(6).trim();
      if (!cookieText) {
        await sock.sendMessage(from, { text: '⚠️ *Kullanım:* `!cerez <Netscape formatındaki çerez metniniz>`\n(Tarayıcı eklentisinden kopyaladığınız tüm metni tek seferde gönderin)' });
        return;
      }

      try {
        const { CookieJar, Cookie } = await import('tough-cookie');
        const jar = new CookieJar();

        const lines = cookieText.split('\n');
        let parsedCount = 0;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          const parts = trimmed.split(/\s+/);
          if (parts.length >= 7) {
            const domain = parts[0];
            const path = parts[2];
            const secure = parts[3].toUpperCase() === 'TRUE';
            const expiresSeconds = parseInt(parts[4], 10);
            const name = parts[5];
            const value = parts[6];

            const cookieString = `${name}=${value}; Domain=${domain}; Path=${path}${secure ? '; Secure' : ''}${expiresSeconds > 0 ? `; Expires=${new Date(expiresSeconds * 1000).toUTCString()}` : ''}`;
            const cookie = Cookie.parse(cookieString);
            if (cookie) {
              await jar.setCookie(cookie, "https://www.hentaizm1.com/");
              parsedCount++;
            }
          }
        }

        if (parsedCount > 0) {
          writeConfig({
            hentaizmCookies: jar.toJSON()
          });
          await sock.sendMessage(from, { text: `✅ *Başarılı!* Toplam *${parsedCount}* adet Hentaizm çerezi başarıyla kaydedildi. Artık giriş engeli olmadan indirmeleri yapabilirsiniz!` });
        } else {
          await sock.sendMessage(from, { text: '❌ *Hata:* Gönderilen metin geçerli bir Netscape çerez formatında değil veya çözümlenemedi.' });
        }
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ *Hata:* Çerezler kaydedilirken bir sorun oluştu: ${err.message}` });
      }
      return;
    }

    // ─── Downloader Commands ───
    // Tetikleyici: !indir komutu VEYA direkt desteklenen link
    const isIndir = text.startsWith('!indir') || text.startsWith('!download');

    if (isIndir || isSupportedLink) {
      // Link direk atıldıysa parts = ['<link>'], değilse !indir <link>
      let parts;
      if (isSupportedLink) {
        parts = ['!indir', text]; // text = link
      } else {
        parts = text.split(/\s+/);
        if (parts.length < 2) {
          await sock.sendMessage(from, { text: '📢 Link gönder, hemen indir!çinlerimi görmek için *kuyruk* yaz.' });
          return;
        }
      }

      // Check if it is a range download
      if (parts.length >= 3) {
        const url1 = parts[1].trim();
        const url2 = parts[2].trim();

        if (url1.includes('hdfilmcehennemi.nl') && url2.includes('hdfilmcehennemi.nl')) {
          const match1 = url1.match(/\/sezon-(\d+)\/bolum-(\d+)\/?$/);
          const match2 = url2.match(/\/sezon-(\d+)\/bolum-(\d+)\/?$/);

          if (match1 && match2 && match1[1] === match2[1]) {
            const season = match1[1];
            const startEp = Math.min(parseInt(match1[2], 10), parseInt(match2[2], 10));
            const endEp = Math.max(parseInt(match1[2], 10), parseInt(match2[2], 10));
            const baseUrl = url1.split(`/sezon-${season}/`)[0];

            await sock.sendMessage(from, { text: `🎬 *Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

            let addedCount = 0;
            let skipCount = 0;
            for (let ep = startEp; ep <= endEp; ep++) {
              const epUrl = `${baseUrl}/sezon-${season}/bolum-${ep}/`;
              try {
                addDownloadTask(epUrl, from, `Sezon ${season} Bölüm ${ep}`);
                addedCount++;
              } catch (e) {
                skipCount++;
              }
            }

            let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
            if (skipCount > 0) {
              replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
            }
            replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
            await sock.sendMessage(from, { text: replyMsg });
            return;
          }
        }
      }

      const targetUrl = parts[1].trim();
      const isPriority = targetUrl === '--oncelikli' || targetUrl === '--öncelikli';

      // ─── Çoklu Link: !indir --oncelikli <link> VEYA !indir <link1> <link2> ...
      let urls = [];
      let priority = false;

      if (isPriority && parts.length >= 3) {
        // !indir --oncelikli <link>
        priority = true;
        urls = [parts[2].trim()];
      } else {
        // Tüm linkleri topla (http ile başlayanlar)
        urls = parts.slice(1).filter(p => p.startsWith('http'));
        if (urls.length === 0) {
          await sock.sendMessage(from, { text: 'Lütfen geçerli bir link belirtin. Örnek: `!indir https://www.hdfilmcehennemi.nl/dizi/...`' });
          return;
        }
      }

      const supportedDomains = [
        'hdfilmcehennemi', 'animecix', 'ecchicix', 'hentaizm',
        'youtube.com', 'youtu.be', 'pornhub.com', 'doeda', 'hdabla', 'hdkore',
        'turkifsahub', 'turkifsalar', 'turkporno', 'cloud.mail.ru', 'cloidmail.ru'
      ];

      // ─── Aralık İndirme (sadece 2 hdfilmcehennemi veya 2 animecix linki varsa)
      if (urls.length === 2) {
        // HDfilmcehennemi aralık kontrolü
        if (urls[0].includes('hdfilmcehennemi') && urls[1].includes('hdfilmcehennemi')) {
          const match1 = urls[0].match(/\/sezon-(\d+)\/bolum-(\d+)\/?$/);
          const match2 = urls[1].match(/\/sezon-(\d+)\/bolum-(\d+)\/?$/);

          if (match1 && match2 && match1[1] === match2[1]) {
            const season = match1[1];
            const startEp = Math.min(parseInt(match1[2], 10), parseInt(match2[2], 10));
            const endEp = Math.max(parseInt(match1[2], 10), parseInt(match2[2], 10));
            const baseUrl = urls[0].split(`/sezon-${season}/`)[0];

            await sock.sendMessage(from, { text: `🎬 *HDfilmcehennemi Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

            let addedCount = 0;
            let skipCount = 0;
            for (let ep = startEp; ep <= endEp; ep++) {
              const epUrl = `${baseUrl}/sezon-${season}/bolum-${ep}/`;
              try {
                addDownloadTask(epUrl, from, `Sezon ${season} Bölüm ${ep}`, null, priority);
                addedCount++;
              } catch (e) {
                skipCount++;
              }
            }

            let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
            if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
            replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
            await sock.sendMessage(from, { text: replyMsg });
            return;
          }
        }

        // Animecix aralık kontrolü
        if ((urls[0].includes('animecix') || urls[0].includes('ecchicix')) && 
            (urls[1].includes('animecix') || urls[1].includes('ecchicix'))) {
          const match1 = urls[0].match(/\/season\/(\d+)\/episode\/(\d+)/i);
          const match2 = urls[1].match(/\/season\/(\d+)\/episode\/(\d+)/i);

          if (match1 && match2 && match1[1] === match2[1]) {
            const season = match1[1];
            const startEp = Math.min(parseInt(match1[2], 10), parseInt(match2[2], 10));
            const endEp = Math.max(parseInt(match1[2], 10), parseInt(match2[2], 10));
            const baseUrl = urls[0].split(`/season/${season}/`)[0];

            await sock.sendMessage(from, { text: `🎬 *Animecix Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

            let addedCount = 0;
            let skipCount = 0;
            for (let ep = startEp; ep <= endEp; ep++) {
              const epUrl = `${baseUrl}/season/${season}/episode/${ep}`;
              try {
                addDownloadTask(epUrl, from, `Sezon ${season} Bölüm ${ep}`, null, priority);
                addedCount++;
              } catch (e) {
                skipCount++;
              }
            }

            let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
            if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
            replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
            await sock.sendMessage(from, { text: replyMsg });
            return;
          }
        }
      }

      // ─── Çoklu Bağımsız Link (2+)
      if (urls.length > 1) {
        let addedCount = 0;
        let skipCount = 0;
        let unsupportedCount = 0;
        for (const u of urls) {
          const isSupported = supportedDomains.some(d => u.includes(d));
          if (!isSupported) { unsupportedCount++; continue; }
          try {
            addDownloadTask(u, from, 'Video Çözümleniyor...', null, priority);
            addedCount++;
          } catch (e) {
            skipCount++;
          }
        }
        let replyMsg = `✅ *${addedCount}* link sıraya eklendi.`;
        if (skipCount > 0) replyMsg += `\n⚠️ ${skipCount} mükerrer atlandı.`;
        if (unsupportedCount > 0) replyMsg += `\n❌ ${unsupportedCount} desteklenmeyen link.`;
        if (priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
        replyMsg += `\n\n\`!kuyruk\` ile durumu takip edin.`;
        await sock.sendMessage(from, { text: replyMsg });
        return;
      }

      // ─── Tekil Link ───
      const singleUrl = urls[0];
      const isYouTubeUrl = /youtube\.com|youtu\.be/i.test(singleUrl);
      const isAnimecix = singleUrl.includes('animecix') || singleUrl.includes('ecchicix');
      const isHentaizm = singleUrl.includes('hentaizm');
      const isPornhub = singleUrl.includes('pornhub.com');
      const isDoeda = /doeda/i.test(singleUrl);
      const isHdabla = /hdabla/i.test(singleUrl);

      const isHdkore = singleUrl.includes('hdkore');
      const isTurkifsahub = singleUrl.includes('turkifsahub.com');
      const isTurkifsalar = /turkifsalar/i.test(singleUrl);
      const isTurkporno = /turkporno/i.test(singleUrl);
      const isCloudMailRu = singleUrl.includes('cloud.mail.ru') || singleUrl.includes('cloidmail.ru');

      if (!singleUrl.includes('hdfilmcehennemi') && !isAnimecix && !isYouTubeUrl && !isHentaizm && !isPornhub && !isDoeda && !isHdabla && !isHdkore && !isTurkifsahub && !isTurkifsalar && !isTurkporno && !isCloudMailRu) {
        await sock.sendMessage(from, { text: 'Lütfen geçerli bir desteklenen medya linki gönderin.' });
        return;
      }

      // Check if it is an Animecix/Ecchicix Season or Show Main Page URL (not a single episode)
      const isAnimecixSingleEp = singleUrl.includes('/episode/') || singleUrl.includes('/bolum/') || singleUrl.includes('/bölüm/');
      const isAnimecixSeasonOrShow = isAnimecix && !isAnimecixSingleEp;

      if (isAnimecixSeasonOrShow) {
        const { getAnimecixSeasonEpisodes } = await import('./extractor.js');
        await sock.sendMessage(from, { text: '🔍 Sezon bölümleri alınıyor, lütfen bekleyin...' });
        try {
          const { animeName, episodes, skippedCount: preSkipped } = await getAnimecixSeasonEpisodes(singleUrl);

          if (episodes.length === 0) {
            const emptyMsg = preSkipped > 0
              ? `❌ Bu sezondaki *${preSkipped}* bölümün tamamı henüz platforma yüklenmemiş.`
              : '❌ Bu sezonda hiçbir bölüm bulunamadı.';
            await sock.sendMessage(from, { text: emptyMsg });
            return;
          }

          let seasonMsg = `🎬 *${animeName}* Sezonu Bulundu!\n📦 Toplam *${episodes.length}* hazır bölüm sıraya ekleniyor...`;
          if (preSkipped > 0) seasonMsg += `\n⏩ *${preSkipped}* bölüm henüz yüklenmemiş, otomatik atlandı.`;
          await sock.sendMessage(from, { text: seasonMsg });

          let addedCount = 0;
          let skipCount = 0;
          for (const ep of episodes) {
            try {
              addDownloadTask(ep.url, from, `${animeName} - ${ep.name}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (preSkipped > 0) replyMsg += `\n⏩ *${preSkipped}* bölüm platforma yüklenmediği için atlandı.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          if (priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
        } catch (err) {
          await sock.sendMessage(from, { text: `❌ Sezon bölümleri alınırken hata oluştu: ${err.message}` });
        }
        return;
      }

      // Check if it is a HDfilmcehennemi Series / Season URL (not a single episode)
      const isHdfSeries = singleUrl.includes('hdfilmcehennemi') && singleUrl.includes('/dizi/') && !/\/bolum-\d+/i.test(singleUrl);

      if (isHdfSeries) {
        const { getHdfilmcehennemiSeasonEpisodes } = await import('./extractor.js');
        await sock.sendMessage(from, { text: '🔍 HDfilmcehennemi yayınlanan sezon bölümleri taranıyor...' });
        try {
          const { seriesName, episodes } = await getHdfilmcehennemiSeasonEpisodes(singleUrl);

          if (episodes.length === 0) {
            await sock.sendMessage(from, { text: '❌ Bu sezonda/dizide hiçbir bölüm bulunamadı.' });
            return;
          }

          await sock.sendMessage(from, { text: `🎬 *${seriesName}* Dizi/Sezonu Bulundu!\n📦 Toplam *${episodes.length}* adet yayınlanmış bölüm sıraya ekleniyor...` });

          let addedCount = 0;
          let skipCount = 0;
          for (const ep of episodes) {
            try {
              addDownloadTask(ep.url, from, `${seriesName} - ${ep.name}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* yayınlanmış bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          if (priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
        } catch (err) {
          await sock.sendMessage(from, { text: `❌ Dizi bölümleri alınırken hata oluştu: ${err.message}` });
        }
        return;
      }
      // Check if it is a HDKore Series / Show URL (dizi, not bolum)
      const isHdkoreSeries = singleUrl.includes('hdkore') && singleUrl.includes('/dizi/') && !/\/bolum\//i.test(singleUrl);

      if (isHdkoreSeries) {
        const { getHdkoreSeasonEpisodes } = await import('./extractor.js');
        await sock.sendMessage(from, { text: '🔍 HDKore yayınlanan dizi bölümleri taranıyor...' });
        try {
          const { seriesName, episodes } = await getHdkoreSeasonEpisodes(singleUrl);

          if (episodes.length === 0) {
            await sock.sendMessage(from, { text: '❌ Bu dizide hiçbir bölüm bulunamadı.' });
            return;
          }

          await sock.sendMessage(from, { text: `🎬 *${seriesName}* Dizisi Bulundu!\n📦 Toplam *${episodes.length}* adet bölüm sıraya ekleniyor...` });

          let addedCount = 0;
          let skipCount = 0;
          for (const ep of episodes) {
            try {
              addDownloadTask(ep.url, from, `${seriesName} - ${ep.name}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          if (priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
        } catch (err) {
          await sock.sendMessage(from, { text: `❌ Dizi bölümleri alınırken hata oluştu: ${err.message}` });
        }
        return;
      }

      // Single episode / movie / video download
      try {
        const isPlaylist = /[?&]list=/.test(singleUrl) && !/[?&]v=/.test(singleUrl);
        
        if (isYouTubeUrl && !isPlaylist) {
          const proxyArg = process.env.PROXY_URL ? ` --proxy "${process.env.PROXY_URL}"` : '';
          exec(`yt-dlp ${proxyArg} -F --no-playlist "${singleUrl}"`, async (err, stdout) => {
            if (err) {
              await sock.sendMessage(from, { text: `❌ Format analizi başarısız oldu: ${err.message}` });
              return;
            }
            
            const lines = stdout.split('\n');
            const availableFormats = [];
            const targets = [
              { height: 1080, label: '1080p (FHD)' },
              { height: 720, label: '720p (HD)' },
              { height: 480, label: '480p (SD)' },
              { height: 360, label: '360p (Mobil)' }
            ];

            for (const target of targets) {
              const matchedLine = lines.find(l => {
                return l.includes(`${target.height}p`) || new RegExp(`x${target.height}\\b`).test(l);
              });

              if (matchedLine) {
                const partsLine = matchedLine.trim().split(/\s+/);
                const formatId = partsLine[0];
                let sizeStr = 'Bilinmiyor';
                const sizeMatch = matchedLine.match(/(\d+(?:\.\d+)?\s*[GMK]iB)/i);
                if (sizeMatch) sizeStr = sizeMatch[1];
                
                availableFormats.push({
                  format_id: formatId,
                  label: `${target.label} [${sizeStr}]`,
                  height: target.height
                });
              }
            }

            if (availableFormats.length === 0) {
              availableFormats.push({
                format_id: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
                label: 'Varsayılan En İyi Kalite',
                height: 0
              });
            }

            let ytTitle = 'YouTube Video';
            try {
              ytTitle = await new Promise((res) => {
                const proxyArg = process.env.PROXY_URL ? ` --proxy "${process.env.PROXY_URL}"` : '';
                exec(`yt-dlp ${proxyArg} --get-title --no-playlist "${singleUrl}"`, (e, o) => res(e ? 'YouTube Video' : o.trim()));
              });
            } catch {}

            pendingSelections[from] = {
              url: singleUrl,
              title: ytTitle,
              formats: availableFormats
            };

            let optionsText = `🎬 *YOUTUBE KALİTE SEÇİMİ*\n\n🎥 *Video:* ${ytTitle}\n\nLütfen indirmek istediğiniz kaliteyi seçin:\n\n`;
            availableFormats.forEach((f, idx) => {
              optionsText += `${idx + 1}️⃣ ${f.label}\n`;
            });
            optionsText += `\n*Seçmek için bu mesaja doğrudan sadece seçeneğin numarasını (Ör: 1) yazarak yanıt verin.*`;

            await sock.sendMessage(from, { text: optionsText });
          });
          return;
        }

        const task = addDownloadTask(singleUrl, from, 'Video Çözümleniyor...', null, priority);
        const priorityTag = priority ? '🔴 *ÖNCELİKLİ* ' : '';
        await sock.sendMessage(from, { text: `📥 ${priorityTag}Görev Sıraya Eklendi!\n🎬 *Link:* ${singleUrl}\n🆔 *Görev Numarası:* \`${task.id}\`\n\nKuyruk durumu: \`!kuyruk\`\nİptal etmek için: \`!iptal ${task.id}\`` });
      } catch (err) {
        await sock.sendMessage(from, { text: `⚠️ *Hata:* ${err.message}` });
      }
      return;
    }

    if (text.startsWith('!kuyruk') || isQueueCheck) {
      let responseText = `📋 *İNDİRME KUYRUĞU VE CANLI DURUM*\n`;
      if (queueState.isPaused) responseText += `\n⏸️ *Kuyruk duraklatıldı.* Devam ettirmek için *devam* yaz.\n`;
      responseText += '\n';

      if (activeTask.current) {
        const elapsedMs = activeTask.current.startTime ? Date.now() - activeTask.current.startTime : 0;
        const elapsedStr = elapsedMs > 60000 ? `${Math.floor(elapsedMs/60000)}dk ${Math.floor((elapsedMs%60000)/1000)}sn` : `${Math.floor(elapsedMs/1000)}sn`;
        responseText += `🚀 *Şu An İndiriliyor:*\n🎬 *${activeTask.current.title}*\n📊 *Durum:* ${activeTask.current.status || 'İşleniyor...'}\n`;
        if (activeTask.current.speed) responseText += `⚡ *Hız:* ~${activeTask.current.speed} MB/s\n`;
        responseText += `⏱️ *Süre:* ${elapsedStr} geçti\n\n`;
      } else {
        responseText += `💤 *Şu an aktif indirme yok.*\n\n`;
      }

      if (downloadQueue.length > 0) {
        responseText += `⏳ *Bekleyen Görevler (${downloadQueue.length} adet):*\n`;
        downloadQueue.forEach((t, i) => {
          const waitEst = getEstimatedWaitTime(i);
          const priorityTag = t.priority ? '🔴 [ÖNCELİKLİ] ' : '';
          responseText += `${i + 1}. ${priorityTag}*${t.title}*\n   └ Tahmini Bekleme: ${waitEst}\n`;
        });
      } else {
        responseText += `✨ *Kuyrukta bekleyen görev yok.*`;
      }

      await sock.sendMessage(from, { text: responseText });
      return;
    }

    const isClearQueueCmd = ['kuyruk temizle', 'kuyruğu temizle', 'kuyruktemizle', '!kuyruktemizle', '!kuyruk-temizle', 'kuyruk sıfırla'].includes(ltext);

    if (isClearQueueCmd) {
      const removedCount = clearQueue();
      await sock.sendMessage(from, { text: `🧹 *Kuyruk Temizlendi!*\nKuyruktaki *${removedCount}* adet bekleyen görev ve varsa aktif indirme iptal edildi.` });
      return;
    }

    if (text.startsWith('!iptal') || isCancelActive) {
      let query;
      if (isCancelActive) {
        query = 'aktif';
      } else {
        const parts = text.split(' ');
        if (parts.length < 2) {
          await sock.sendMessage(from, { text: 'Hangi görevi iptal etmek istiyorsun? Örnek: *iptal 1* veya *iptal aktif*' });
          return;
        }
        query = parts[1].trim();
      }

      const cancelledTask = cancelDownloadTask(query);

      if (cancelledTask) {
        await sock.sendMessage(from, { text: `✅ *"${cancelledTask.title}"* iptal edildi.` });
      } else {
        await sock.sendMessage(from, { text: `❌ Bu numarada bir görev bulunamadı. Görevleri görmek için *kuyruk* yaz.` });
      }
      return;
    }
  });
}

// Start Express and Captcha Poller
startServer(PORT, startBot);
startCaptchaPoller();

// Start Baileys WhatsApp Bot
startBot().catch(err => console.error("Error starting bot:", err));

// Run cleanup at startup and then every 30 minutes
cleanOldDownloads();
setInterval(cleanOldDownloads, 30 * 60 * 1000);
