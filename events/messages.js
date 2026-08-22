import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import { 
  botState, 
  pairingState, 
  formatBytes, 
  readConfig, 
  writeConfig, 
  cleanOldDownloads, 
  pendingHentaizmLogins, 
  downloadsDir 
} from '../config.js';
import { 
  downloadQueue, 
  activeTask, 
  pendingSelections, 
  addDownloadTask, 
  activeTasksList,
  clearQueue,
  cancelDownloadTask,
  queueState
} from '../queue.js';
import { getDiskUsage } from '../config.js';
import { commands } from '../bot.js';

export async function handleMessage(sock, m) {
  const msg = m.messages[0];
  if (!msg.message) return;

  const from = msg.key.remoteJid;
  const config = readConfig();

  // Whitelist check
  if (!msg.key.fromMe && config.adminJids) {
    const adminList = config.adminJids.split(',').map(num => num.trim().toLowerCase()).filter(Boolean);
    if (adminList.length > 0) {
      const sender = msg.key.participant || from;
      const senderNumber = sender.split('@')[0];
      const isAllowed = adminList.some(num => senderNumber.includes(num));
      if (!isAllowed) {
        return; // Ignore silently
      }
    }
  }

  const text = (msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    '').trim();
  const ltext = text.toLowerCase().trim();

  // Custom Commands
  const customCmds = config.customCommands || {};
  if (customCmds[ltext]) {
    let replyTemplate = customCmds[ltext];
    
    const uptimeMs = Date.now() - botState.uptime.getTime();
    const uptimeHours = (uptimeMs / (1000 * 60 * 60)).toFixed(1);
    const disk = getDiskUsage();
    const freeDiskGB = ((config.maxDownloadsCacheGB * 1024 * 1024 * 1024 - disk.totalBytes) / (1024 * 1024 * 1024)).toFixed(1);
    
    const placeholders = {
      '{uptime}': `${uptimeHours} saat`,
      '{tarih}': new Date().toLocaleDateString('tr-TR'),
      '{disk_kalan}': `${freeDiskGB} GB`,
      '{aktif_indirme_sayisi}': `${activeTasksList.length}`
    };
    
    for (const [placeholder, val] of Object.entries(placeholders)) {
      replyTemplate = replyTemplate.replaceAll(placeholder, val);
    }
    
    await sock.sendMessage(from, { text: replyTemplate });
    return;
  }

  // Supported Domains
  const SUPPORTED_DOMAINS = [
    'hdfilmcehennemi', 'animecix', 'ecchicix', 'hentaizm', 'anizm', 'aniuzm',
    'youtube.com', 'youtu.be', 'pornhub.com', 'doeda', 'hdabla', 'hdkore',
    'turkifsahub', 'turkifsalar', 'turkporno', 'cloud.mail.ru', 'cloidmail.ru',
    'dood', 'ds2play', 'streamtape', 'streamta.pe', 'stape.fun', 'filemoon', 'moonplayer',
    'vk.com', 'vkvideo', 'vk.ru', 'vidmoly', 'dizipal', 'dizibox', 'dizigom', 'diziroll', 'dramadizilerim', 'instagram.com', 'tiktok.com', 'disk.yandex', 'yadi.sk', 'drive.google.com', 'mega.nz', 'yabancidizi', 'sezonlukdizi', 'terabox.com', 'teraboxapp.com', 'nephobox.com', 'liteapks.com', 'modyolo.com', 'koreanturk', 'koreanizm',
    'filmmodu', 'fullhdfilmizlesene', 'rule34video', 'hanime.tv', 'jable.tv', 'missav',
    'erome.com', 'fapello.com', 'camwhores', 'hentaihaven', 'hentaimama', 'hentaiseason',
    'spankbang', 'xvideos', 'xnxx', 'eporner', 'xhamster', 'beeg', 'hqporner', 'youporn',
    'redtube', 'tnaflix', 'thumbzilla', 'tube8', 'txxx', 'youjizz', 'porntrex', 'pornone',
    'motherless', 'daftsex', 'veporno', 'brazzers3x', 'drtuber', 'heavy-r', 'xbabe',
    'empflix', 'sxyprn', 'sunporno', 'fuq', 'javforme', 'javhd', 'jav789', 'yerliifsa',
    'sikis', 'pornovakti', 'turkcealtyaziliporno', 'pornoizle', 'ifsadunyasi', 'guncelporno', 'yerliporno'
  ];
  const isLink = text.startsWith('http://') || text.startsWith('https://');
  const isDirectFileLink = isLink && /\.(mp4|mkv|avi|webm|apk|zip|rar|7z|pdf|exe)(\?.*)?$/i.test(text.split(' ')[0]);
  const isSupportedLink = (isLink && (SUPPORTED_DOMAINS.some(d => text.includes(d)) || text.includes('itch.io') || text.includes('9mod.com'))) || isDirectFileLink;
  const isTorrentUrl = text.startsWith('magnet:') || text.toLowerCase().includes('.torrent');

  // 0. Pending Quality Selection Handler
  if (pendingSelections[from]) {
    const selectionIndex = parseInt(text, 10) - 1;
    const selection = pendingSelections[from];
    if (!isNaN(selectionIndex) && selectionIndex >= 0 && selectionIndex < selection.formats.length) {
      const chosen = selection.formats[selectionIndex];
      delete pendingSelections[from];
      try {
        const task = addDownloadTask(selection.url, from, selection.title, chosen.format_id);
        await sock.sendMessage(from, { text: `✅ *${chosen.label}* kalitesi seçildi!\n\n📥 Sıraya eklendi, bekleme sırası çok olmadığı sürece kısa süre içinde başlayacak.\n\n🔢 Görev no: *${task.id}*  |  Kuyruk: *kuyruk* yaz` });
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

  // Help / Menu check
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

🎬 *DESTEKLENEN SİTELER VE KAYNAKLAR:*
• *Anime:* Anizm (Aniuzm), AnimeCix
• *Dizi / Film:* Dizipal, Dizibox, Dizigom, Diziroll, Filmmodu, FullHDFilmizlesene, HDFilmCehennemi, HDKore, HDabla, Dramadizilerim
• *Hosting Servisleri:* Doodstream, Streamtape, Filemoon, VK.com (VKVideo), Vidmoly, Cloud Mail.ru
• *Sosyal & Video:* YouTube, Youtu.be (Playlist & Format Seçimli)

────────────────────
_Sadece linki atın, gerisini ben hallederim!_ ✨`;
    await sock.sendMessage(from, { text: menuText });
    return;
  }

  // Route to commands Map
  let commandName = '';
  let args = [];

  if (text.startsWith('!')) {
    const parts = text.slice(1).trim().split(/\s+/);
    commandName = parts[0].toLowerCase();
    args = parts.slice(1);
  } else {
    // Shortcut commands (prefixless)
    if (['kuyruk', 'ne var', 'nerede', 'durum ne', 'kac tane', 'kaç tane'].includes(ltext) || ltext.startsWith('kuyruk temizle') || ltext.startsWith('kuyruğu temizle') || ltext.startsWith('kuyruktemizle') || ltext.startsWith('kuyruk sıfırla')) {
      commandName = 'kuyruk';
    } else if (['durum', 'status', 'bot durumu', 'durum?'].includes(ltext)) {
      commandName = 'durum';
    } else if (['disk', 'yer', 'depolama'].includes(ltext)) {
      commandName = 'disk';
    } else if (['geçmiş', 'gecmis', 'indirdim', 'son indirmeler'].includes(ltext)) {
      commandName = 'gecmis';
    } else if (['hatalar', 'hata', 'sorun', 'neden olmadı'].includes(ltext)) {
      commandName = 'hatalar';
    } else if (['hız', 'hiz', 'hız ne', 'nasıl gidiyor'].includes(ltext)) {
      commandName = 'hiz';
    } else if (['dur', 'durdur', 'bekle', 'pause'].includes(ltext)) {
      commandName = 'dur';
    } else if (['devam', 'başlat', 'resume'].includes(ltext)) {
      commandName = 'devam';
    } else if (['iptal', 'durdur aktif', 'aktifi iptal', 'cancel'].includes(ltext)) {
      commandName = 'iptal';
    } else if (['güncelle', 'guncelle', 'update'].includes(ltext)) {
      commandName = 'guncelle';
    } else if (ltext.startsWith('tekrar gönder') || ltext.startsWith('tekrar gonder')) {
      commandName = 'tekrargonder';
      args = text.split(' ').slice(2);
    } else if (ltext === 'temizle') {
      commandName = 'temizle';
    }
  }

  if (commandName && commands.has(commandName)) {
    const cmd = commands.get(commandName);
    try {
      await cmd.execute(sock, msg, from, args, {
        text,
        ltext,
        config,
        botState,
        activeCaptchasMap: global.activeCaptchasMap || new Map(),
        downloadsDir,
        formatBytes
      });
    } catch (err) {
      console.error(`Command error (${commandName}):`, err.message);
      await sock.sendMessage(from, { text: `⚠️ Komut hatası: ${err.message}` });
    }
    return;
  }

  // Treat as download if supported link
  if (isSupportedLink || isTorrentUrl) {
    const cmd = commands.get('indir');
    if (cmd) {
      try {
        await cmd.execute(sock, msg, from, [text], {
          text,
          ltext,
          config,
          botState,
          activeCaptchasMap: global.activeCaptchasMap || new Map(),
          downloadsDir,
          formatBytes
        });
      } catch (err) {
        console.error(`Download execution error:`, err.message);
        await sock.sendMessage(from, { text: `⚠️ İndirme hatası: ${err.message}` });
      }
    }
  }
}
