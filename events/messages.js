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
import { isReplyDownloadTrigger, handleReplyDownload } from '../utils/quotedHandler.js';

export async function handleMessage(sock, m) {
  const msg = m.messages[0];
  if (!msg.message) return;

  if (sentMessageIds.has(msg.key.id)) return;

  const from = msg.key.remoteJid;
  const config = readConfig();

  const text = (msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    '').trim();
  const ltext = text.toLowerCase().trim();

  console.log(`[MSG INCOMING] From: ${from} | fromMe: ${Boolean(msg.key.fromMe)} | Text: "${text}"`);

  // --- WhatsApp Captcha Resmine Yanıt Verme (Reply) Yakalayıcı ---
  const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quotedMsg && text) {
    const quotedCaption = (quotedMsg.conversation || quotedMsg.imageMessage?.caption || quotedMsg.extendedTextMessage?.text || '').toLowerCase();
    if (quotedCaption.includes('captcha') || quotedCaption.includes('durduruldu') || quotedCaption.includes('hesap')) {
      const code = text.replace(/^!coz\s*/i, '').trim();
      if (code) {
        console.log(`[CAPTCHA REPLIED] Captcha görseline yanıt verildi. Gönderilen kod: "${code}"`);
        const cozCmd = commands.get('coz');
        if (cozCmd) {
          await cozCmd.execute(sock, msg, from, [code], { text: `!coz ${code}`, ltext: `!coz ${code}` });
          return;
        }
      }
    }
  }

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
    'filmmodu', 'fullhdfilmizlesene', 'filmmakinesi', 'rule34video', 'hanime.tv', 'jable.tv', 'missav',
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
    
    if (selection.type === 'audio_selection') {
      const input = text.trim().toLowerCase();

      if (input === 'iptal' || input === 'vazgeç' || input === 'cancel') {
        delete pendingSelections[from];
        await sock.sendMessage(from, { text: '❌ Ses seçimi ve indirme işlemi iptal edildi.' });
        return;
      }

      let chosenAudio = null;

      // 1. Check number selection (1, 2, 3...)
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= selection.availableAudios.length) {
        chosenAudio = selection.availableAudios[num - 1];
      }

      // 2. Check keyword matching
      if (!chosenAudio) {
        if (['dublaj', 'tr', 'turkce', 'türkçe', 'tur'].includes(input)) {
          chosenAudio = selection.availableAudios.find(a => a.id === 'tr' || a.id === 'dublaj') || selection.availableAudios[0];
        } else if (['altyazi', 'altyazı', 'altyazili', 'altyazılı', 'orijinal', 'original', 'orig', 'en', 'eng'].includes(input)) {
          chosenAudio = selection.availableAudios.find(a => a.id === 'orig' || a.id === 'en' || a.id === 'altyazi') || selection.availableAudios[1];
        } else if (['dual', 'cift', 'çift', 'ikisi', 'hepsi'].includes(input)) {
          chosenAudio = selection.availableAudios.find(a => a.id === 'dual') || selection.availableAudios[selection.availableAudios.length - 1];
        } else {
          chosenAudio = selection.availableAudios.find(a => a.label && a.label.toLowerCase().includes(input));
        }
      }

      if (chosenAudio) {
        delete pendingSelections[from];
        try {
          const task = addDownloadTask(
            selection.url,
            from,
            selection.title,
            null,
            selection.priority || false,
            null,
            null,
            null,
            chosenAudio.id,
            selection.burnSubtitles || false
          );

          const priorityTag = selection.priority ? '🔴 *ÖNCELİKLİ* ' : '';
          const hardsubNote = selection.burnSubtitles ? '\n✍️ *Altyazı:* Videoya kalıcı gömülecek (Hardsub)' : '';
          await sock.sendMessage(from, {
            text: `✅ *${chosenAudio.label}* seçildi!\n\n📥 ${priorityTag}Görev Sıraya Eklendi!\n🎬 *Film/Video:* ${selection.title}${hardsubNote}\n🆔 *Görev Numarası:* \`${task.id}\`\n\nKuyruk durumu: \`!kuyruk\`\nİptal etmek için: \`!iptal ${task.id}\``
          });
        } catch (err) {
          await sock.sendMessage(from, { text: `⚠️ Bir sorun oluştu: ${err.message}` });
        }
        return;
      } else {
        const numEmoji = (idx) => {
          const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
          return emojis[idx] || `[${idx + 1}]`;
        };
        let prompt = `⚠️ Geçersiz seçim! Lütfen listedeki ses seçeneklerinden birini seçin:\n\n`;
        selection.availableAudios.forEach((a, idx) => {
          prompt += `${numEmoji(idx)} *${a.label}*\n`;
        });
        prompt += `\n*Seçmek için bu mesaja doğrudan seçeneğin numarasını (Ör: 1) veya adını (dublaj, altyazı, dual) yazarak yanıt verin.*\n❌ İptal etmek için: *iptal*`;
        await sock.sendMessage(from, { text: prompt });
        return;
      }
    }

    if (selection.type === 'multi_season') {
      const input = text.trim().toLowerCase();

      if (input === 'iptal' || input === 'vazgeç' || input === 'cancel') {
        delete pendingSelections[from];
        await sock.sendMessage(from, { text: '❌ Dizi indirme işlemi iptal edildi.' });
        return;
      }

      let selectedEpisodes = [];
      let label = '';

      // 1. All seasons
      if (input === 'hepsi' || input === 'tümü' || input === 'full' || input === 'all' || input === 'sezonlar') {
        selectedEpisodes = selection.allEpisodes;
        label = `Tüm Sezonlar (${selectedEpisodes.length} Bölüm)`;
      } else {
        // 2. Season + Episode Range (e.g. `s1 1-5`, `s2 1-12`, `1 1-5`, `2 5-10`, `sezon 1 1-5`)
        const sRangeMatch = input.match(/^(?:s|sezon\s*)?(\d+)[\s,]+(\d+)\s*[-to–—\s]\s*(\d+)$/i) || input.match(/^(?:s|sezon\s*)?(\d+)[\s,]+(\d+)\s+(\d+)$/i);
        if (sRangeMatch) {
          const sNum = parseInt(sRangeMatch[1], 10);
          const start = parseInt(sRangeMatch[2], 10);
          const end = parseInt(sRangeMatch[3], 10);
          const targetSeason = selection.seasons.find(s => s.season == sNum);
          if (targetSeason && targetSeason.episodes.length > 0) {
            const minNum = Math.min(start, end);
            const maxNum = Math.max(start, end);
            selectedEpisodes = targetSeason.episodes.filter(ep => ep.number >= minNum && ep.number <= maxNum);
            if (selectedEpisodes.length > 0) {
              label = `${sNum}. Sezon ${minNum}-${maxNum} arası bölümler`;
            }
          }
        }

        // 3. Single Season selected (e.g. `1`, `2`, `s1`, `s2`, `sezon 1`, `sezon 2`)
        if (selectedEpisodes.length === 0) {
          const sSelectMatch = input.match(/^(?:s|sezon\s*)?(\d+)$/i);
          if (sSelectMatch) {
            const sNum = parseInt(sSelectMatch[1], 10);
            const targetSeason = selection.seasons.find(s => s.season == sNum);
            if (targetSeason) {
              selectedEpisodes = targetSeason.episodes;
              label = `${targetSeason.name || `${sNum}. Sezon`} (Tümü)`;
            }
          }
        }

        // 4. Episode range without season (e.g. `1-5`) -> defaults to Season 1
        if (selectedEpisodes.length === 0) {
          const rangeMatch = input.match(/^(\d+)\s*[-to–—\s]\s*(\d+)$/i) || input.match(/^(\d+)\s+(\d+)$/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            const s1 = selection.seasons[0];
            if (s1 && s1.episodes.length > 0) {
              const minNum = Math.min(start, end);
              const maxNum = Math.max(start, end);
              selectedEpisodes = s1.episodes.filter(ep => ep.number >= minNum && ep.number <= maxNum);
              if (selectedEpisodes.length > 0) {
                label = `${s1.name || `${s1.season}. Sezon`} ${minNum}-${maxNum} arası bölümler`;
              }
            }
          }
        }
      }

      if (selectedEpisodes.length > 0) {
        delete pendingSelections[from];

        await sock.sendMessage(from, {
          text: `🎬 *${selection.seriesName}* - *${label}* sıraya ekleniyor...\n📦 Toplam *${selectedEpisodes.length}* bölüm sıraya ekleniyor...`
        });

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
        let helpText = `⚠️ Geçersiz seçim! Lütfen şunlardan birini yazın:\n\n` +
          `• Tüm sezonlar için: *hepsi*\n`;
        selection.seasons.forEach(s => {
          helpText += `• ${s.season}. Sezon için: *${s.season}* (veya *s${s.season}*)\n`;
        });
        helpText += `• Belirli bölüm aralığı için: *s1 1-5* veya *s2 1-12*\n` +
          `• İptal etmek için: *iptal*`;
        await sock.sendMessage(from, { text: helpText });
        return;
      }
    }

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
        const rangeMatch = input.match(/^(\d+)\s*[-to–—\s]\s*(\d+)$/i) || input.match(/^(\d+)\s+(\d+)$/);
        const singleMatch = input.match(/^(\d+)$/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          const minNum = Math.min(start, end);
          const maxNum = Math.max(start, end);
          selectedEpisodes = selection.episodes.filter(ep => ep.number >= minNum && ep.number <= maxNum);
          if (selectedEpisodes.length > 0) {
            label = `${minNum} ile ${maxNum} arası bölümler`;
          }
        } else if (singleMatch) {
          const epNum = parseInt(singleMatch[1], 10);
          const foundEp = selection.episodes.find(ep => ep.number === epNum);
          if (foundEp) {
            selectedEpisodes = [foundEp];
            label = `${epNum}. Bölüm`;
          }
        }
      }
      
      if (selectedEpisodes.length > 0) {
        delete pendingSelections[from];

        const isDramadizilerim = selection.source === 'dramadizilerim';
        const batchSize = isDramadizilerim ? selectedEpisodes.length : (selection.mergeBatchSize || 1);
        const shouldBatchMerge = batchSize > 1 && selectedEpisodes.length > 1;

        if (shouldBatchMerge) {
          const chunks = [];
          for (let i = 0; i < selectedEpisodes.length; i += batchSize) {
            chunks.push(selectedEpisodes.slice(i, i + batchSize));
          }

          const queueIntro = chunks.length === 1
            ? `🎬 *${selection.seriesName}* - *${label}*\n📦 Toplam *${selectedEpisodes.length}* bölüm tek bir ZIP paketi olarak sıraya ekleniyor...`
            : `🎬 *${selection.seriesName}* - *${label}*\n📦 Toplam *${selectedEpisodes.length}* bölüm *${chunks.length}* paket halinde ZIP olarak sıraya ekleniyor...`;

          await sock.sendMessage(from, { text: queueIntro });

          const getEpNum = (ep, idx) => {
            if (ep.episode && !isNaN(parseInt(ep.episode, 10))) return parseInt(ep.episode, 10);
            const m = ep.name?.match(/(\d+)\s*\.?\s*bölüm/i) || ep.name?.match(/bölüm\s*(\d+)/i);
            if (m) return parseInt(m[1], 10);
            try {
              const u = new URL(ep.url);
              const p = u.searchParams.get('ep') || u.searchParams.get('e');
              if (p && !isNaN(parseInt(p, 10))) return parseInt(p, 10);
            } catch (e) {}
            return idx + 1;
          };

          let addedCount = 0;
          let skipCount = 0;

          for (const chunk of chunks) {
            const firstEp = chunk[0];
            const lastEp = chunk[chunk.length - 1];

            const startNum = getEpNum(firstEp, selectedEpisodes.indexOf(firstEp));
            const endNum = getEpNum(lastEp, selectedEpisodes.indexOf(lastEp));

            const batchTitle = startNum === endNum
              ? `${selection.seriesName} - Bölüm ${startNum}`
              : `${selection.seriesName} - Bölüm ${startNum}-${endNum}`;

            const batchUrl = `${firstEp.url}#batch=${startNum}-${endNum}`;

            try {
              addDownloadTask(batchUrl, from, batchTitle, null, selection.priority, null, chunk);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = chunks.length === 1
            ? `✅ Toplam *${selectedEpisodes.length}* bölüm tek bir ZIP paketi olarak başarıyla sıraya eklendi.`
            : `✅ Toplam *${addedCount}* paket (${selectedEpisodes.length} bölüm) başarıyla sıraya eklendi.`;

          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer paket atlandı.`;
          if (selection.priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
          replyMsg += `\n\n_Tüm bölümler tek klasörde toplanıp ZIP arşivi olarak gönderilecektir._`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }

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

  // Quoted / Reply-to-download Handler (e.g. replying to an anime poster or link with "." or ". acil")
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const hasQuoted = Boolean(contextInfo?.quotedMessage || contextInfo?.stanzaId);
  if (isReplyDownloadTrigger(text, hasQuoted)) {
    const handled = await handleReplyDownload(sock, msg, from, text, {
      text,
      ltext,
      config,
      botState,
      activeCaptchasMap: global.activeCaptchasMap || new Map(),
      downloadsDir,
      formatBytes
    });
    if (handled) return;
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
      await yardimCmd.execute(sock, msg, from, [], { text });
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
    } else if (/^(?:he[n]?taizmfav|he[n]?taizm\s+fav|he[n]?taifav|fav\s*he[n]?tai)(?:\s+.*)?$/i.test(ltext)) {
      commandName = 'hentaizmfav';
      args = text.trim().split(/\s+/).slice(1);
    } else if (/^(?:indir\s*he[n]?tai|indirhe[n]?tai|he[n]?tai\s*indir|he[n]?taiindir)(?:\s+.*)?$/i.test(ltext)) {
      commandName = 'indirhentai';
      args = text.trim().split(/\s+/).slice(1);
    } else if (/^(?:toplu\s*he[n]?tai|topluhe[n]?tai|he[n]?tai\s*toplu|he[n]?taitoplu)(?:\s+.*)?$/i.test(ltext)) {
      commandName = 'topluhentai';
      args = text.trim().split(/\s+/).slice(1);
    } else if (/^(?:he[n]?tai\s*grup|he[n]?taigrup)(?:\s+.*)?$/i.test(ltext)) {
      commandName = 'hentaigrup';
      args = text.trim().split(/\s+/).slice(1);
    } else if (['hhelp', 'hentaihelp', 'h-help', 'hyardim', 'hentaiyardim', 'hentai yardım', 'hentai yardim'].includes(ltext)) {
      commandName = 'hhelp';
    } else if (['kahvalti', 'kahvaltı', 'sabah', 'sabahyemegi', 'sabahyemeği'].includes(ltext) || ltext.startsWith('kahvalti ') || ltext.startsWith('kahvaltı ')) {
      commandName = 'kahvalti';
      args = text.trim().split(/\s+/).slice(1);
    } else if (['aksam', 'akşam', 'aksamyemegi', 'akşamyemeği'].includes(ltext) || ltext.startsWith('aksam ') || ltext.startsWith('akşam ')) {
      commandName = 'aksam';
      args = text.trim().split(/\s+/).slice(1);
    } else if (['yemek', 'yemekler', 'gunlukyemek', 'yemekhane'].includes(ltext) || ltext.startsWith('yemek ') || ltext.startsWith('yemekler ')) {
      commandName = 'yemek';
      args = text.trim().split(/\s+/).slice(1);
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
