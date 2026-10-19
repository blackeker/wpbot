import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import { downloadContentFromMessage, downloadMediaMessage } from '@whiskeysockets/baileys';
import { 
  botState, 
  pairingState, 
  formatBytes, 
  readConfig, 
  writeConfig, 
  cleanOldDownloads, 
  pendingHentaizmLogins, 
  downloadsDir,
  sentMessageIds,
  getAiConfig
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
import { 
  checkCommandPermission, 
  checkLinkPermission, 
  isGroupAdminOrOwner, 
  isBotOwner,
  getCanonicalCommandName,
  getGroupConfig
} from '../utils/permissionManager.js';
import { simulateIncomingRead, isSenderThrottled } from '../utils/antiBan.js';
import { handleDownloadCommands } from '../ai/downloadCommands.js';

export function isViewOnceMessage(rawMsg) {
  if (!rawMsg || typeof rawMsg !== 'object') return false;
  if (
    rawMsg.viewOnceMessage || 
    rawMsg.viewOnceMessageV2 || 
    rawMsg.viewOnceMessageV2Extension ||
    rawMsg.imageMessage?.viewOnce ||
    rawMsg.videoMessage?.viewOnce ||
    rawMsg.audioMessage?.viewOnce ||
    rawMsg.documentMessage?.viewOnce ||
    rawMsg.ephemeralMessage?.message?.viewOnceMessage ||
    rawMsg.ephemeralMessage?.message?.viewOnceMessageV2 ||
    rawMsg.ephemeralMessage?.message?.viewOnceMessageV2Extension ||
    rawMsg.ephemeralMessage?.message?.imageMessage?.viewOnce ||
    rawMsg.ephemeralMessage?.message?.videoMessage?.viewOnce ||
    rawMsg.ephemeralMessage?.message?.audioMessage?.viewOnce
  ) return true;

  try {
    const jsonStr = JSON.stringify(rawMsg);
    if (
      jsonStr.includes('viewOnceMessage') || 
      jsonStr.includes('"viewOnce":true') || 
      jsonStr.includes('"viewOnce": true') || 
      jsonStr.includes('viewOnceMessageV2') ||
      jsonStr.includes('viewOnceMessageV2Extension')
    ) {
      return true;
    }
  } catch (e) {}

  return false;
}

export async function autoForwardViewOnceMedia(sock, msg, from) {
  try {
    const rawMsg = msg.message;
    if (!rawMsg) return;

    const content = unwrapMessage(rawMsg);
    const ctx = rawMsg.extendedTextMessage?.contextInfo || 
                rawMsg.imageMessage?.contextInfo || 
                rawMsg.videoMessage?.contextInfo || 
                rawMsg.documentMessage?.contextInfo ||
                content?.extendedTextMessage?.contextInfo ||
                content?.imageMessage?.contextInfo ||
                content?.videoMessage?.contextInfo;

    const isDirectViewOnce = isViewOnceMessage(rawMsg) || isViewOnceMessage(content);
    const isQuotedViewOnce = isViewOnceMessage(ctx?.quotedMessage);

    if (!isDirectViewOnce && !isQuotedViewOnce) return;

    const quoted = ctx?.quotedMessage ? unwrapMessage(ctx.quotedMessage) : null;

    const imgMsg = content?.imageMessage || 
                   rawMsg?.viewOnceMessage?.message?.imageMessage || 
                   rawMsg?.viewOnceMessageV2?.message?.imageMessage || 
                   rawMsg?.viewOnceMessageV2Extension?.message?.imageMessage || 
                   rawMsg?.ephemeralMessage?.message?.viewOnceMessage?.message?.imageMessage ||
                   rawMsg?.ephemeralMessage?.message?.viewOnceMessageV2?.message?.imageMessage ||
                   quoted?.imageMessage || 
                   ctx?.quotedMessage?.viewOnceMessage?.message?.imageMessage || 
                   ctx?.quotedMessage?.viewOnceMessageV2?.message?.imageMessage;

    const vidMsg = content?.videoMessage || 
                   rawMsg?.viewOnceMessage?.message?.videoMessage || 
                   rawMsg?.viewOnceMessageV2?.message?.videoMessage || 
                   rawMsg?.viewOnceMessageV2Extension?.message?.videoMessage || 
                   rawMsg?.ephemeralMessage?.message?.viewOnceMessage?.message?.videoMessage ||
                   rawMsg?.ephemeralMessage?.message?.viewOnceMessageV2?.message?.videoMessage ||
                   quoted?.videoMessage || 
                   ctx?.quotedMessage?.viewOnceMessage?.message?.videoMessage || 
                   ctx?.quotedMessage?.viewOnceMessageV2?.message?.videoMessage;

    const audMsg = content?.audioMessage || 
                   rawMsg?.viewOnceMessage?.message?.audioMessage || 
                   rawMsg?.viewOnceMessageV2?.message?.audioMessage || 
                   rawMsg?.viewOnceMessageV2Extension?.message?.audioMessage || 
                   rawMsg?.ephemeralMessage?.message?.viewOnceMessage?.message?.audioMessage ||
                   quoted?.audioMessage;

    const docMsg = content?.documentMessage || 
                   rawMsg?.viewOnceMessage?.message?.documentMessage || 
                   rawMsg?.viewOnceMessageV2?.message?.documentMessage || 
                   rawMsg?.viewOnceMessageV2Extension?.message?.documentMessage || 
                   content?.documentWithCaptionMessage?.message?.documentMessage || 
                   quoted?.documentMessage;

    const mediaObj = imgMsg || vidMsg || audMsg || docMsg;
    if (!mediaObj) return;

    const mediaType = imgMsg ? 'image' : (vidMsg ? 'video' : (audMsg ? 'audio' : 'document'));
    let buffer = null;

    try {
      const stream = await downloadContentFromMessage(mediaObj, mediaType);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      buffer = Buffer.concat(chunks);
    } catch (e1) {
      try {
        buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: () => Promise.resolve() });
      } catch (e2) {
        if (ctx?.quotedMessage) {
          try {
            const quotedObj = { key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage };
            buffer = await downloadMediaMessage(quotedObj, 'buffer', {}, { reuploadRequest: () => Promise.resolve() });
          } catch (e3) {}
        }
      }
    }

    if (!buffer || buffer.length === 0) {
      console.warn(`[VIEW-ONCE SNIPER] Failed to download media buffer for ${from}`);
      return;
    }

    // Diske arşivle
    const viewOnceDir = path.join(downloadsDir, 'view_once');
    if (!fs.existsSync(viewOnceDir)) {
      fs.mkdirSync(viewOnceDir, { recursive: true });
    }
    const sender = msg.key?.senderPn || ctx?.participant || msg.key?.participant || msg.participant || from;
    const senderNumber = (sender || '').split('@')[0].replace(/[^0-9]/g, '');
    const ext = mediaType === 'image' ? 'jpg' : (mediaType === 'video' ? 'mp4' : (mediaType === 'audio' ? 'mp3' : (docMsg?.fileName ? (path.extname(docMsg.fileName).replace('.', '') || 'bin') : 'bin')));
    const savedFilename = `viewonce_${Date.now()}_${senderNumber}.${ext}`;
    const savedPath = path.join(viewOnceDir, savedFilename);
    try { fs.writeFileSync(savedPath, buffer); } catch (e) {}

    const isGroup = from.endsWith('@g.us');
    let groupName = '';
    if (isGroup) {
      try {
        const metadata = await sock.groupMetadata(from);
        groupName = metadata?.subject || from;
      } catch (e) {
        groupName = from;
      }
    }

    const pushName = msg.pushName || senderNumber || 'Bilinmiyor';
    const captionText = mediaObj.caption || '';
    const typeLabel = mediaType === 'image' ? 'Fotoğraf' : (mediaType === 'video' ? 'Video' : (mediaType === 'audio' ? 'Ses Kaydı' : 'Belge/Dosya'));
    const timeStr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    // Metadata JSON dosyasını da kaydet (Web Dashboard için)
    const metaPath = `${savedPath}.meta.json`;
    const metaData = {
      id: msg.key?.id,
      mediaType,
      ext,
      filename: savedFilename,
      downloadUrl: `/downloads/view_once/${encodeURIComponent(savedFilename)}`,
      senderNumber,
      senderJid: sender,
      pushName,
      isGroup,
      groupName: isGroup ? groupName : null,
      chatJid: from,
      caption: captionText || '',
      timestamp: new Date().toISOString(),
      dateFormatted: timeStr,
      sizeBytes: buffer.length
    };
    try { fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2), 'utf8'); } catch (e) {}

    // Dinamik hedef JID belirleme
    const config = readConfig();
    if (config.viewOnceAutoForward === false) {
      console.log(`[VIEW-ONCE SNIPER] Medya yerel kasaya kaydedildi (${savedFilename}), otomatik iletim ayarlardan kapalı.`);
      return;
    }

    // Dinamik hedef JID belirleme:
    // 1. Kullanıcının seçtiği DEPO GRUBU (depotGroupJid)
    // 2. Özel View-Once Hedefi (viewOnceTargetJid)
    // 3. Bot Sahibi (ownerNumber / process.env.OWNER_NUMBER)
    // 4. Admin Numarası (adminNumber)
    // 5. Botun kendi numarası (sock.user.id)
    let targetJid = null;
    if (config.depotGroupJid && config.depotGroupJid.trim()) {
      targetJid = config.depotGroupJid.trim();
    } else if (config.viewOnceTargetJid && config.viewOnceTargetJid.trim()) {
      const clean = config.viewOnceTargetJid.trim();
      targetJid = clean.includes('@') ? clean : `${clean.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    } else if (config.ownerNumber || process.env.OWNER_NUMBER) {
      const num = (config.ownerNumber || process.env.OWNER_NUMBER).replace(/[^0-9]/g, '');
      if (num) targetJid = `${num}@s.whatsapp.net`;
    } else if (config.adminNumber) {
      const num = config.adminNumber.replace(/[^0-9]/g, '');
      if (num) targetJid = `${num}@s.whatsapp.net`;
    } else if (sock?.user?.id) {
      const selfNum = sock.user.id.split(':')[0].replace(/[^0-9]/g, '');
      if (selfNum) targetJid = `${selfNum}@s.whatsapp.net`;
    }

    if (!targetJid) {
      console.log(`[VIEW-ONCE STEALTH] Medya kasaya arşivlendi (${savedFilename}). Aktif depo grubu veya hedef JID ayarlanmadığı için sessizce saklandı.`);
      return;
    }

    let caption = `👁️ *Tek Gönderimlik ${typeLabel} Yakalandı!*\n━━━━━━━━━━━━━━━━━━━━\n👤 *Gönderen:* ${pushName} (+${senderNumber})\n📍 *Kaynak:* ${isGroup ? `Grup: ${groupName}` : 'Özel Sohbet'}\n🕒 *Zaman:* ${timeStr}`;
    if (docMsg?.fileName) {
      caption += `\n📁 *Dosya Adı:* ${docMsg.fileName}`;
    }
    if (captionText) {
      caption += `\n📝 *Açıklama:* ${captionText}`;
    }
    caption += `\n💾 *Sunucuda Kayıt Yeri:* ${savedFilename}\n━━━━━━━━━━━━━━━━━━━━`;

    console.log(`[VIEW-ONCE STEALTH] Intercepted ${mediaType} from ${senderNumber} in ${from}. Silently forwarding to DEPOT: ${targetJid}...`);

    try {
      if (mediaType === 'image') {
        await sock.sendMessage(targetJid, { image: buffer, caption }, { skipAntiBan: true });
      } else if (mediaType === 'video') {
        await sock.sendMessage(targetJid, { video: buffer, caption, mimetype: vidMsg?.mimetype || 'video/mp4' }, { skipAntiBan: true });
      } else if (mediaType === 'audio') {
        await sock.sendMessage(targetJid, { audio: buffer, mimetype: audMsg?.mimetype || 'audio/mp4', ptt: Boolean(audMsg?.ptt) }, { skipAntiBan: true });
        await sock.sendMessage(targetJid, { text: caption }, { skipAntiBan: true });
      } else if (mediaType === 'document') {
        await sock.sendMessage(targetJid, { 
          document: buffer, 
          caption, 
          fileName: docMsg?.fileName || `dosya_${Date.now()}.${ext}`, 
          mimetype: docMsg?.mimetype || 'application/octet-stream' 
        }, { skipAntiBan: true });
      }
      console.log(`[VIEW-ONCE STEALTH] Successfully forwarded view-once media to depot: ${targetJid}`);
    } catch (sendErr) {
      console.error(`[VIEW-ONCE STEALTH] Failed forwarding to depot ${targetJid}:`, sendErr.message);
    }
  } catch (err) {
    console.error('[VIEW-ONCE SNIPER ERROR]:', err?.message || err);
  }
}

export function unwrapMessage(message) {
  if (!message) return null;
  let current = message;
  let depth = 0;
  while (depth < 10) {
    depth++;
    if (current?.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
    } else if (current?.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message;
    } else if (current?.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message;
    } else if (current?.viewOnceMessageV2Extension?.message) {
      current = current.viewOnceMessageV2Extension.message;
    } else if (current?.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
    } else if (current?.templateMessage?.hydratedTemplate) {
      current = current.templateMessage.hydratedTemplate;
    } else if (current?.templateMessage?.fourRowTemplate) {
      current = current.templateMessage.fourRowTemplate;
    } else if (current?.interactiveMessage?.header) {
      current = current.interactiveMessage.header;
    } else {
      break;
    }
  }
  return current;
}

export async function handleMessage(sock, m) {
  if (!m?.messages || !Array.isArray(m.messages)) return;
  for (const msg of m.messages) {
    try {
      await processSingleMessage(sock, msg);
    } catch (err) {
      console.error('[MSG PROCESSING ERROR]:', err?.message || err);
    }
  }
}

async function processSingleMessage(sock, msg) {
  if (!msg) return;

  console.log('[DEBUG RAW MSG ARRIVED]', {
    id: msg.key?.id,
    from: msg.key?.remoteJid,
    fromMe: msg.key?.fromMe,
    hasMsg: Boolean(msg.message),
    msgKeys: msg.message ? Object.keys(msg.message) : []
  });

  if (!msg.message) {
    console.log('[DEBUG EMPTY MSG OBJECT]', JSON.stringify(msg, (k, v) => (Buffer.isBuffer(v) ? `<Buffer ${v.length}>` : v)));
    return;
  }

  if (sentMessageIds.has(msg.key?.id)) {
    return;
  }

  // 1. Ignore old/buffered messages (older than 180 seconds) to prevent spamming after reconnecting
  const nowSec = Math.floor(Date.now() / 1000);
  const msgTimestamp = typeof msg.messageTimestamp === 'number'
    ? msg.messageTimestamp
    : (msg.messageTimestamp?.low || Number(msg.messageTimestamp) || 0);
  if (msgTimestamp > 0 && (nowSec - msgTimestamp) > 180) {
    return;
  }

  const from = msg.key.remoteJid;
  const config = readConfig();

  // 🛡️ View-Once Sniper: Herhangi bir sohbetten gelen tek gönderimlik medyaları anında indirip hedefe ilet
  autoForwardViewOnceMedia(sock, msg, from).catch(err => {
    console.error('[AUTO FORWARD VIEW-ONCE ERROR]:', err?.message || err);
  });

  const content = unwrapMessage(msg.message);
  if (!content) return;

  const directImage = content.imageMessage || 
                      content.viewOnceMessage?.message?.imageMessage || 
                      content.viewOnceMessageV2?.message?.imageMessage || 
                      content.viewOnceMessageV2Extension?.message?.imageMessage;

  const text = (
    content.conversation ||
    content.extendedTextMessage?.text ||
    directImage?.caption ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  ).trim();
  const ltext = text.toLowerCase().trim();

  // Check if message contains media (image, view-once image, sticker, image-document) or quoted media
  const hasDirectMedia = Boolean(
    directImage || 
    content.stickerMessage || 
    (content.documentMessage?.mimetype?.startsWith('image/'))
  );
  const msgContext = content.extendedTextMessage?.contextInfo || 
                     content.imageMessage?.contextInfo || 
                     content.videoMessage?.contextInfo ||
                     content.documentMessage?.contextInfo ||
                     directImage?.contextInfo;
  
  const quotedContent = msgContext?.quotedMessage ? unwrapMessage(msgContext.quotedMessage) : null;
  const quotedImage = quotedContent?.imageMessage || 
                      quotedContent?.viewOnceMessage?.message?.imageMessage || 
                      quotedContent?.viewOnceMessageV2?.message?.imageMessage;

  const hasQuotedMedia = Boolean(
    quotedImage || 
    quotedContent?.stickerMessage || 
    (quotedContent?.documentMessage?.mimetype?.startsWith('image/'))
  );

  if (!text && !hasDirectMedia && !hasQuotedMedia) return;

  console.log(`[MSG INCOMING] From: ${from} | fromMe: ${Boolean(msg.key.fromMe)} | Text: "${text}" | Media: ${hasDirectMedia || hasQuotedMedia} (ViewOnce: ${isViewOnceMessage(msg.message)})`);

  const prefixes = ['!', '/', '.'];
  const matchedPrefix = prefixes.find(p => text.startsWith(p));
  const hasPrefix = Boolean(matchedPrefix);
  const isGroupChat = from.endsWith('@g.us');

  if (msg.key.fromMe) {
    const isDlLink = text.startsWith('http://') || text.startsWith('https://') || text.startsWith('magnet:') || text.toLowerCase().includes('.torrent');
    if (!hasPrefix && !isDlLink) {
      return;
    }
    // Ignore casual dots or multi-dots sent from self
    if (/^\.{1,}$/.test(ltext)) {
      return;
    }
    if (config.groupJid && from !== config.groupJid) {
      return;
    }
  }

  const sender = msg.key.participant || from;
  const senderNumber = sender.split('@')[0];
  const isOwner = isBotOwner(msg, senderNumber);
  let _isAdmin = null;
  const getIsAdmin = async () => {
    if (_isAdmin === null) {
      _isAdmin = await isGroupAdminOrOwner(sock, msg, from);
    }
    return _isAdmin;
  };

  // Anti-Ban: Mark incoming message as read (blue ticks) naturally & check inbound flood
  if (!msg.key.fromMe) {
    simulateIncomingRead(sock, msg);
    if (isSenderThrottled(sender)) {
      return; // Ignore spam burst to protect bot from flood bans
    }
  }

  // Private DM Whitelist check
  if (!msg.key.fromMe && config.adminJids && !isGroupChat) {
    if (!isOwner) {
      return; // Ignore silently in private messages if admin list is set
    }
  }

  // Custom Commands (Must be prefixed in groups to prevent accidental triggers)
  const customCmds = config.customCommands || {};
  let customTrigger = hasPrefix ? text.slice(matchedPrefix.length).toLowerCase().trim() : (isGroupChat ? null : ltext);
  if (customTrigger && customCmds[customTrigger]) {
    let replyTemplate = customCmds[customTrigger];
    
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
  const embeddedUrlMatch = text.match(/https?:\/\/[^\s"',<>]+/i);
  const firstUrl = embeddedUrlMatch ? embeddedUrlMatch[0] : '';
  const isLink = Boolean(firstUrl);
  const isDirectFileLink = isLink && /\.(mp4|mkv|avi|webm|apk|zip|rar|7z|pdf|exe)(\?.*)?$/i.test(firstUrl);
  const isSupportedLink = (isLink && (SUPPORTED_DOMAINS.some(d => firstUrl.toLowerCase().includes(d)) || firstUrl.includes('itch.io') || firstUrl.includes('9mod.com'))) || isDirectFileLink;
  const isTorrentUrl = text.includes('magnet:?') || (isLink && /\.torrent(\?.*)?$/i.test(firstUrl));

  // 0. Pending Quality Selection / Interactive Flow Handler
  if (pendingSelections[from]) {
    const selection = pendingSelections[from];
    const selectionTime = selection.createdAt || selection.timestamp || 0;

    // Auto-expire after 60 seconds of inactivity
    if (selectionTime && (Date.now() - selectionTime > 60000)) {
      delete pendingSelections[from];
    } else {
      const selectionSender = selection.sender || selection.initiator;
      const isAuthorizedSender = !isGroupChat || !selectionSender || selectionSender === sender || isOwner;

      if (isAuthorizedSender) {
        // --- Yapay Zeka Görsel Üretimi Adım Adım Sihirbazı (Prompt -> Kategori -> Boyut) ---
        if (selection.type === 'ciz_flow') {
      const input = text.trim().toLowerCase();

      if (input === 'iptal' || input === 'vazgeç' || input === 'cancel') {
        delete pendingSelections[from];
        await sock.sendMessage(from, { text: '❌ Görsel oluşturma işlemi iptal edildi.' });
        return;
      }

      if (selection.step === 'prompt') {
        if (!text.trim()) {
          await sock.sendMessage(from, { text: '⚠️ Lütfen çizilmesini istediğiniz görselin açıklamasını yazın.' });
          return;
        }
        selection.prompt = text.trim();
        selection.step = 'style';
        const { getStyleMenuText } = await import('../commands/tools/ciz.js');
        await sock.sendMessage(from, { text: getStyleMenuText(selection.prompt) });
        return;
      }

      if (selection.step === 'style') {
        const { resolveStyle, getShapeMenuText } = await import('../commands/tools/ciz.js');
        const chosenStyle = resolveStyle(input);
        selection.selectedStyle = chosenStyle;
        selection.step = 'shape';
        await sock.sendMessage(from, { text: getShapeMenuText(chosenStyle) });
        return;
      }

      if (selection.step === 'shape') {
        let shape = 'square';
        let shapeLabel = '1:1 Kare';
        if (['2', 'dikey', 'portrait', '9:16', 'hikaye', 'story'].includes(input)) {
          shape = 'portrait';
          shapeLabel = '9:16 Dikey';
        } else if (['3', 'yatay', 'landscape', '16:9', 'genis', 'geniş'].includes(input)) {
          shape = 'landscape';
          shapeLabel = '16:9 Yatay';
        } else {
          shape = 'square';
          shapeLabel = '1:1 Kare';
        }

        const prompt = selection.prompt;
        const styleObj = selection.selectedStyle;
        delete pendingSelections[from];

        await sock.sendMessage(from, {
          text: `⏳ *Görseliniz üretiliyor...*\n\n📝 *İstem:* ${prompt}\n🎨 *Stil:* ${styleObj.icon} ${styleObj.name}\n📐 *Boyut:* ${shapeLabel}\n\n_Lütfen bekleyin..._`
        });

        try {
          const { executeAiDraw } = await import('../commands/tools/ciz.js');
          const result = await executeAiDraw(prompt, styleObj, shape);

          if (!result || !result.buffer) {
            await sock.sendMessage(from, { text: '❌ Görsel üretilirken yanıt vermedi veya zaman aşımına uğradı. Lütfen birkaç saniye sonra tekrar deneyin.' });
            return;
          }

          let caption = `✨ *Görseliniz Hazır!*\n━━━━━━━━━━━━━━━━━━━━\n📝 *İstem:* ${prompt}\n🎨 *Stil:* ${styleObj.icon} ${styleObj.name}\n📐 *Boyut:* ${result.shapeLabel || shapeLabel}\n (${result.elapsed}s)\n━━━━━━━━━━━━━━━━━━━━`;

          await sock.sendMessage(from, {
            image: result.buffer,
            caption: caption.trim()
          });
        } catch (err) {
          await sock.sendMessage(from, { text: `❌ Görsel oluşturulurken bir hata oluştu: ${err.message}` });
        }
        return;
      }
    }

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

    if (selection.type === 'youtube_playlist') {
      const input = text.trim().toLowerCase();

      if (input === 'iptal' || input === 'vazgeç' || input === 'cancel') {
        delete pendingSelections[from];
        await sock.sendMessage(from, { text: '❌ YouTube oynatma listesi indirme işlemi iptal edildi.' });
        return;
      }

      let selectedVideos = [];
      let label = '';

      // 1. All videos
      if (input === 'hepsi' || input === '1' || input === 'tümü' || input === 'full' || input === 'all' || input === 'liste') {
        selectedVideos = selection.videos;
        label = `Tüm Liste (${selectedVideos.length} Video)`;
      } else {
        // 2. Video range (e.g. 1-10, 5 15, 1-50)
        const rangeMatch = input.match(/^(\d+)\s*[-to–—\s]\s*(\d+)$/i) || input.match(/^(\d+)\s+(\d+)$/);
        const singleMatch = input.match(/^(\d+)$/);

        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          const minNum = Math.min(start, end);
          const maxNum = Math.max(start, end);
          selectedVideos = selection.videos.filter(v => v.number >= minNum && v.number <= maxNum);
          if (selectedVideos.length > 0) {
            label = `${minNum} ile ${maxNum} arası videolar`;
          }
        } else if (singleMatch) {
          const vNum = parseInt(singleMatch[1], 10);
          const foundV = selection.videos.find(v => v.number === vNum);
          if (foundV) {
            selectedVideos = [foundV];
            label = `${vNum}. Video`;
          }
        }
      }

      if (selectedVideos.length > 0) {
        delete pendingSelections[from];
        const formatLabel = selection.isMp3 ? '🎵 MP3' : '🎬 MP4';
        await sock.sendMessage(from, {
          text: `🎵 *${selection.playlistTitle}* - *${label}*\n📦 Toplam *${selectedVideos.length}* video sıraya ekleniyor...\nFormat: ${formatLabel}`
        });

        let addedCount = 0;
        let skipCount = 0;
        for (const v of selectedVideos) {
          try {
            addDownloadTask(v.url, from, `${selection.playlistTitle} - ${v.number}. ${v.title}`, selection.isMp3 ? 'mp3' : null, selection.priority);
            addedCount++;
          } catch (e) {
            skipCount++;
          }
        }

        let replyMsg = `✅ Toplam *${addedCount}* video başarıyla sıraya eklendi.`;
        if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
        if (selection.priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
        replyMsg += `\n\nSırayı görmek için: \`!kuyruk\``;
        await sock.sendMessage(from, { text: replyMsg });
        return;
      } else {
        await sock.sendMessage(from, {
          text: `⚠️ Geçersiz seçim! Lütfen şunlardan birini yazın:\n\n` +
                `- Tüm videolar için: *hepsi* (veya *1*)\n` +
                `- Belirli video aralığı için: *başlangıç-bitiş* (Örn: *1-10* veya *5-25*)\n` +
                `- Tek video için: video numarasını yazın (Örn: *3*)\n` +
                `- İptal etmek için: *iptal*`
        });
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
          await sock.sendMessage(from, { text: `✅ *${chosen.label}* kalitesi seçildi!\n\n📥 Sıraya eklendi, bekleme sırası çok olmadığı sürece kısa süre içinde başlayacak.\n\n🔢 Görev no: *${task.id}*  |  Kuyruk: \`!kuyruk\`` });
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
    }
  }

  // 0.5. Hentaizm Auto-Login Captcha Handler
  if (pendingHentaizmLogins[from]) {
    const loginState = pendingHentaizmLogins[from];
    const loginTime = loginState.createdAt || 0;

    // Auto-expire captcha after 90 seconds
    if (loginTime && (Date.now() - loginTime > 90000)) {
      delete pendingHentaizmLogins[from];
    } else {
      const loginSender = loginState.sender || loginState.initiator;
      const isAuthorizedSender = !isGroupChat || !loginSender || loginSender === sender || isOwner;

      if (isAuthorizedSender) {
        const captchaText = text.trim();
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
          const isLogged = cookies.includes('remember_me') || 
                           cookies.includes('wordpress_logged_in') || 
                           loginRes.body.includes('Profil') || 
                           loginRes.body.includes('Çıkış') || 
                           loginRes.body.includes('çıkış') ||
                           !loginRes.body.includes('Güvenlik Kodu');

          if (isLogged) {
            writeConfig({ hentaizmCookies: loginState.cookieJar.toJSON() });
            await sock.sendMessage(from, { text: "✅ Hentaizm girişi başarılı! Oturum kaydedildi, şimdi dilediğin hentai linkini gönderebilirsin." });
            try {
              if (fs.existsSync(loginState.captchaPath)) fs.unlinkSync(loginState.captchaPath);
            } catch (e) {}
          } else {
            await sock.sendMessage(from, { text: `❌ Güvenlik kodu yanlış girildi. Lütfen yeni gelen kodu yazın.` });
          }
        } catch (err) {
          await sock.sendMessage(from, { text: `❌ Giriş sırasında hata oluştu: ${err.message}` });
        }
        return;
      }
    }
  }

  // Quoted / Reply-to-download Handler (e.g. replying to an anime poster or link with "." or ". acil")
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const hasQuoted = Boolean(contextInfo?.quotedMessage || contextInfo?.stanzaId);
  if (isReplyDownloadTrigger(text, hasQuoted)) {
    const perm = checkCommandPermission('indir', from, { isOwner, isAdmin: await getIsAdmin() });
    if (!perm.allowed) {
      if (!perm.silent && perm.message) {
        await sock.sendMessage(from, { text: perm.message });
      }
      return;
    }
    const handled = await handleReplyDownload(sock, msg, from, text, {
      text,
      ltext,
      config,
      botState,
      activeCaptchasMap: global.activeCaptchasMap || new Map(),
      downloadsDir,
      formatBytes,
      isOwner,
      isAdmin: await getIsAdmin()
    });
    if (handled) return;
  }

  // Help / Menu check (Guarded against casual chat triggering)
  let menuMatch = null;
  if (hasPrefix) {
    const cleanPrefixText = text.slice(matchedPrefix.length).trim();
    const lClean = cleanPrefixText.toLowerCase();
    menuMatch = lClean.match(/^(?:menü|menu|yardım|yardim|help|rehber)(?:\s+(.*))?$/i);
  } else if (!isGroupChat) {
    // In DMs only, allow explicit menu queries
    if (['menü', 'menu', 'yardım', 'yardim', 'help', 'rehber', 'ne yapabilirsin', 'ne yaparsın'].includes(ltext)) {
      menuMatch = [ltext, ''];
    }
  }

  if (menuMatch) {
    const perm = checkCommandPermission('yardim', from, { isOwner, isAdmin: await getIsAdmin() });
    if (!perm.allowed) {
      if (!perm.silent && perm.message) {
        await sock.sendMessage(from, { text: perm.message });
      }
      return;
    }
    const yardimCmd = commands.get('yardim');
    if (yardimCmd) {
      console.log(`[COMMAND] Executing 'yardim' for ${from}...`);
      try {
        const menuArgs = menuMatch[1] ? menuMatch[1].trim().split(/\s+/) : [];
        await yardimCmd.execute(sock, msg, from, menuArgs, { text, ltext, isOwner, isAdmin: await getIsAdmin() });
        console.log(`[COMMAND] Finished 'yardim' for ${from}`);
      } catch (err) {
        console.error('[Yardım Komutu] Hata:', err.message);
        await sock.sendMessage(from, { text: `⚠️ Yardım menüsü alınırken bir sorun oluştu: ${err.message}` });
      }
    }
    return;
  }

  // Parse Command Name and Arguments
  let commandName = '';
  let args = [];

  if (hasPrefix) {
    const cleanPrefixText = text.slice(matchedPrefix.length).trim();
    const parts = cleanPrefixText.split(/\s+/);
    commandName = parts[0].toLowerCase();
    args = parts.slice(1);
  } else if (!isGroupChat) {
    // In Direct Messages (DM) only: Support prefixless single explicit commands for convenience
    // (Casual words like 'sa', 'selam', 'dur', 'hata', 'sabah', 'yemek' in groups are NOT triggered)
    if (['kuyruk', 'queue'].includes(ltext)) {
      commandName = 'kuyruk';
    } else if (['durum', 'status'].includes(ltext)) {
      commandName = 'durum';
    } else if (['disk', 'depolama'].includes(ltext)) {
      commandName = 'disk';
    } else if (['gecmis', 'geçmiş'].includes(ltext)) {
      commandName = 'gecmis';
    } else if (['hatalar'].includes(ltext)) {
      commandName = 'hatalar';
    } else if (['hiz', 'hız'].includes(ltext)) {
      commandName = 'hiz';
    } else if (['uniyemek'].includes(ltext)) {
      commandName = 'uniyemek';
    } else if (['takvim'].includes(ltext)) {
      commandName = 'takvim';
    } else if (/^(?:ciz|çiz|imagine|airesim|aiciz)\s+(.+)$/i.test(ltext)) {
      commandName = 'ciz';
      args = text.trim().split(/\s+/).slice(1);
    }
  }

  // Execute Command if matched
  if (commandName) {
    const canonicalName = getCanonicalCommandName(commandName);
    const cmd = commands.get(canonicalName) || commands.get(commandName);

    if (cmd) {
      const perm = checkCommandPermission(canonicalName || cmd.name, from, { isOwner, isAdmin: await getIsAdmin() });
      if (!perm.allowed) {
        if (!perm.silent && perm.message) {
          await sock.sendMessage(from, { text: perm.message });
        }
        return;
      }

      console.log(`[COMMAND] Executing '${cmd.name}' for ${from}...`);
      try {
        await cmd.execute(sock, msg, from, args, {
          text,
          ltext,
          config,
          botState,
          activeCaptchasMap: global.activeCaptchasMap || new Map(),
          downloadsDir,
          formatBytes,
          isOwner,
          isAdmin: await getIsAdmin()
        });
        console.log(`[COMMAND] Finished '${cmd.name}' for ${from}`);
      } catch (err) {
        console.error(`Command error (${cmd.name}):`, err.message);
        await sock.sendMessage(from, { text: `⚠️ Komut hatası: ${err.message}` });
      }
      return;
    }
  }

  // Treat as download if supported link
  if (isSupportedLink || isTorrentUrl) {
    const perm = checkLinkPermission(text, from, { isOwner, isAdmin: await getIsAdmin() });
    if (!perm.allowed) {
      if (!perm.silent && perm.message) {
        await sock.sendMessage(from, { text: perm.message });
      }
      return;
    }

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
          formatBytes,
          isOwner,
          isAdmin: await getIsAdmin()
        });
      } catch (err) {
        console.error(`Download execution error:`, err.message);
        await sock.sendMessage(from, { text: `⚠️ İndirme hatası: ${err.message}` });
      }
    }
    return;
  }

  // Fallback to AI conversational chat if not a command and not a media link
  const aiCfg = getAiConfig();
  if (aiCfg.hasAnyKey && aiCfg.enabled) {
    const botNumber = sock.user?.id?.split(':')[0]?.replace(/[^0-9]/g, '') || '';
    const botLid = sock.user?.lid ? sock.user.lid.split(':')[0] : '';
    const msgContextInfo = content.extendedTextMessage?.contextInfo || 
                           content.imageMessage?.contextInfo || 
                           content.videoMessage?.contextInfo || 
                           content.documentMessage?.contextInfo || 
                           content.stickerMessage?.contextInfo ||
                           directImage?.contextInfo;

    const mentionedJids = msgContextInfo?.mentionedJid || [];
    const isBotMentioned = Boolean(
      (botNumber && mentionedJids.some(j => j.includes(botNumber))) ||
      (botLid && mentionedJids.some(j => j.includes(botLid))) ||
      (text && botNumber && text.includes(`@${botNumber}`))
    );

    const quotedParticipant = msgContextInfo?.participant || '';
    const isReplyToBot = Boolean(
      (botNumber && quotedParticipant.includes(botNumber)) ||
      (botLid && quotedParticipant.includes(botLid))
    );

    // If in group, verify that AI is allowed in this group and bot is strictly tagged/replied
    if (isGroupChat) {
      const groupCfg = getGroupConfig(from);
      if (groupCfg.allowAi === false) {
        return; // AI is explicitly disabled in this group
      }
      // In groups, NEVER reply unless explicitly tagged or replied to
      if (!isBotMentioned && !isReplyToBot) {
        return;
      }
    }

    // İndirme komutlarını her zaman işle (AI'dan bağımsız - doğal dil ile)
    const dlResult = await handleDownloadCommands(sock, msg, from, text, { quoted: msg, skipAntiBan: true });
    if (dlResult.handled) return;

    // Auto reply in DMs, or in groups when mentioned / replied to
    if (!isGroupChat || isBotMentioned || isReplyToBot) {
      let prompt = text;
      if (isBotMentioned && botNumber) {
        prompt = text.replace(new RegExp(`@${botNumber}`, 'g'), '').trim();
      }

      // 👁️ Check for image in the message or quoted message to analyze with AI Vision
      try {
        const { extractImageBufferFromMessage, extractAudioBufferFromMessage, transcribeAudioBuffer, handleAiVision, handleAiChat } = await import('../ai/aiEngine.js');
        const imgData = await extractImageBufferFromMessage(msg);
        if (imgData && imgData.buffer) {
          const visionPrompt = prompt || imgData.caption || 'Bu görseli incele, ne olduğunu, üzerindeki detayları veya soruları açıkla.';
          await handleAiVision(sock, msg, from, imgData.buffer, imgData.mimeType, visionPrompt);
          return;
        }

        // 🎙️ Check for voice note (PTT / Audio) to transcribe with Whisper and chat
        if (!prompt) {
          const audioData = await extractAudioBufferFromMessage(msg);
          if (audioData && audioData.buffer) {
            try { await sock.sendPresenceUpdate('recording', from); } catch (e) {}
            const transcript = await transcribeAudioBuffer(audioData.buffer, audioData.mimeType);
            if (transcript) {
              console.log(`[AI VOICE TRANSCRIPTION] (${from}): "${transcript}"`);
              await handleAiChat(sock, msg, from, transcript, {
                senderName: msg.pushName || senderNumber,
                isGroup: isGroupChat,
                transcribedFromVoice: true
              });
              return;
            }
          }
        }

        if (prompt) {
          await handleAiChat(sock, msg, from, prompt, {
            senderName: msg.pushName || senderNumber,
            isGroup: isGroupChat
          });
        }
      } catch (aiErr) {
        console.error('[AI AUTO CHAT ERROR]:', aiErr.message);
      }
    }
  }
}
