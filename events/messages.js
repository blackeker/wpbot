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
  downloadsDir,
  sentMessageIds
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

  if (sentMessageIds.has(msg.key.id)) return;

  const from = msg.key.remoteJid;
  const config = readConfig();

  if (msg.key.fromMe) {
    if (config.groupJid && from !== config.groupJid) {
      return;
    }
  }

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

  if (text.startsWith('!') || isSupportedLink || isTorrentUrl || isLink) {
    sock.sendPresenceUpdate('composing', from).catch(() => {});
  }

  // 0. Pending Quality Selection Handler
  if (pendingSelections[from]) {
    const selection = pendingSelections[from];
    
    if (selection.type === 'series') {
      const input = text.trim().toLowerCase();
      
      if (input === 'iptal' || input === 'vazgeç' || input === 'cancel') {
        delete pendingSelections[from];
        await sock.sendMessage(from, { text: '❌ Dizi indirme işlemi iptal edildi.' });
        return;
      }
      
      let selectedEpisodes = [];
      let label = '';
      
      if (input === 'hepsi' || input === '1' || input === 'tümü' || input === 'full' || input === 'sezon') {
        selectedEpisodes = selection.episodes;
        label = 'Tüm Sezon';
      } else {
        const rangeMatch = input.match(/^(\d+)-(\d+)$/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          
          if (start > 0 && end >= start && start <= selection.episodes.length) {
            const startIndex = start - 1;
            const endIndex = Math.min(end, selection.episodes.length);
            selectedEpisodes = selection.episodes.slice(startIndex, endIndex);
            label = `${start} ile ${endIndex} arası bölümler`;
          }
        }
      }
      
      if (selectedEpisodes.length > 0) {
        delete pendingSelections[from];
        await sock.sendMessage(from, { text: `🎬 *${selection.seriesName}* - *${label}* sıraya ekleniyor...\n📦 Toplam *${selectedEpisodes.length}* bölüm sıraya ekleniyor...` });
        
        let addedCount = 0;
        let skipCount = 0;
        for (const ep of selectedEpisodes) {
          try {
            addDownloadTask(ep.url, from, `${selection.seriesName} - ${ep.name}`, null, selection.priority);
            addedCount++;
          } catch (e) {
            skipCount++;
          }
        }
        
        let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
        if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
        if (selection.priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
        replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
        await sock.sendMessage(from, { text: replyMsg });
        return;
      } else {
        await sock.sendMessage(from, { 
          text: `⚠️ Geçersiz seçim! Lütfen şunlardan birini yazın:\n\n` +
                `- Tüm bölümler için: *hepsi* (veya *1*)\n` +
                `- Belirli bölüm aralığı için: *başlangıç-bitiş* (Örn: *10-20*)\n` +
                `- İptal etmek için: *iptal*`
        });
        return;
      }
    } else {
      const selectionIndex = parseInt(text, 10) - 1;
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
  }

  // 0.5. Hentaizm Auto-Login Captcha Handler
  if (pendingHentaizmLogins[from]) {
    const captchaText = text.trim();
    const loginState = pendingHentaizmLogins[from];
    delete pendingHentaizmLogins[from];

    await sock.sendMessage(from, { text: `⏳ Güvenlik kodu gönderiliyor, lütfen bekle...` });

    try {
      const gotScrapingModule = await import('got-scraping');
      const baseUrl = loginState.baseUrl || 'https://www.hentaizm2.com';
      
      const loginRes = await gotScrapingModule.gotScraping.post({
        url: `${baseUrl}/login.php`,
        cookieJar: loginState.cookieJar,
        form: {
          username: process.env.HENTAIZM_USERNAME || "blackeker@gmail.com",
          password: process.env.HENTAIZM_PASSWORD || "Yusufcuk1.",
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

      const cookies = loginState.cookieJar.getCookieStringSync(`${baseUrl}/`);
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
    const yardimCmd = commands.get('yardim');
    if (yardimCmd) {
      await yardimCmd.execute(sock, msg, from, [], { text: textMessage, sender });
    }
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
