import path from 'path';
import { downloadContentFromMessage, downloadMediaMessage } from '@whiskeysockets/baileys';
import { hentaiFavStore } from './hentaiFavStore.js';
import { commands, messageStore } from '../bot.js';
import { checkLinkPermission } from './permissionManager.js';
import { unwrapMessage } from '../events/messages.js';

export function getQuotedMessage(msg) {
  const raw = msg?.message?.ephemeralMessage?.message || msg?.message?.viewOnceMessage?.message || msg?.message;
  const contextInfo =
    raw?.extendedTextMessage?.contextInfo ||
    raw?.imageMessage?.contextInfo ||
    raw?.videoMessage?.contextInfo ||
    raw?.documentMessage?.contextInfo ||
    raw?.documentWithCaptionMessage?.message?.documentMessage?.contextInfo;
  if (!contextInfo) return null;

  let quotedMsg = contextInfo.quotedMessage;
  if (!quotedMsg && contextInfo.stanzaId && messageStore.has(contextInfo.stanzaId)) {
    quotedMsg = messageStore.get(contextInfo.stanzaId);
  }

  return {
    contextInfo,
    quotedMsg,
    stanzaId: contextInfo.stanzaId,
    participant: contextInfo.participant
  };
}

export function extractTextFromMessage(m) {
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.documentMessage?.fileName ||
    ''
  ).trim();
}

/**
 * Checks if the message is attempting to trigger a download by replying
 */
export function isReplyDownloadTrigger(text, hasQuoted) {
  if (!text) return false;
  // If the user's message itself already contains a direct link, process normally
  if (text.includes('http://') || text.includes('https://') || text.includes('magnet:')) {
    return false;
  }
  const ltext = text.toLowerCase().trim();

  // Multi-dots (.. or ...) are normal chat ellipses, NEVER trigger bot
  if (/^\.{2,}$/.test(ltext)) return false;

  // Single dot "." only triggers if quoting a message
  if (ltext === '.') {
    return Boolean(hasQuoted);
  }

  // Starts with dot followed by explicit command or args (e.g. ".indir", ". acil", ". 1-3", ".p")
  if (ltext.startsWith('.')) {
    const firstWord = ltext.split(/\s+/)[0];
    if (firstWord === '.indir' || firstWord === '.acil' || firstWord === '.p' || firstWord === '.') {
      return true;
    }
    if (/^\.\s+/.test(ltext)) return true;
  }

  // Quoting a message and saying "indir", "!indir", "indirhentai", "hepsi", "bunu indir", "kaydet", "bana at"
  if (hasQuoted) {
    if (
      ltext === 'indir' || ltext.startsWith('indir ') ||
      ltext === '!indir' || ltext.startsWith('!indir ') ||
      ltext === 'indirhentai' || ltext.startsWith('indirhentai ') ||
      ltext === 'hepsi' || ltext === 'tümü' ||
      ltext.includes('indir') ||
      ltext.includes('kaydet') ||
      ltext.includes('bana at') ||
      ltext.includes('bunu at') ||
      ltext.includes('bunu gönder') ||
      ltext.includes('indirip at')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Processes the reply download
 */
export async function handleReplyDownload(sock, msg, from, text, ctx) {
  const quotedInfo = getQuotedMessage(msg);
  const ltext = text.toLowerCase().trim();

  // If user sent a command without quoting any message, only show guidance for explicit .indir
  if (!quotedInfo || (!quotedInfo.quotedMsg && !quotedInfo.stanzaId)) {
    if (ltext === '.indir') {
      await sock.sendMessage(from, {
        text: `💡 *Mesajı Yanıtlayarak İndirme:*\n` +
              `İndirmek istediğiniz bir linki, videoyu veya *hentaizmfav* anime afişini WhatsApp'ta *yanıtlayıp (alıntılayıp)* \`.\` yazarsanız bot otomatik olarak indirmeyi başlatır!\n\n` +
              `👉 *Örnek:* Anime afişine yanıt verip: \`.\`\n` +
              `👉 *Öncelikli:* Yanıt verip: \`. acil\``
      });
      return true;
    }
    return false;
  }

  // Parse extra arguments from the reply text
  let extraArgs = [];
  const rawTokens = text.trim().split(/\s+/);
  const firstWord = rawTokens[0].toLowerCase();

  if (['.', '.indir', '!indir', 'indir', 'indirhentai'].includes(firstWord)) {
    extraArgs = rawTokens.slice(1);
  } else if (firstWord.startsWith('.') && firstWord.length > 1) {
    extraArgs = [firstWord.slice(1), ...rawTokens.slice(1)];
  } else {
    extraArgs = rawTokens.slice(1);
  }

  const quotedText = extractTextFromMessage(quotedInfo.quotedMsg);
  console.log(`[REPLY DOWNLOAD] Quoted Text snippet: "${quotedText.substring(0, 100)}" | Extra args:`, extraArgs);

  // 1. Check for Hentaizm Anime No pattern in quoted message
  const noMatch = quotedText.match(/(?:No:\s*|No\.\s*|indirhentai\s+|#\s*)(\d+)/i);
  if (noMatch) {
    const perm = checkLinkPermission('hentaizm', from, { isOwner: ctx?.isOwner, isAdmin: ctx?.isAdmin });
    if (!perm.allowed) {
      if (!perm.silent && perm.message) await sock.sendMessage(from, { text: perm.message });
      return true;
    }
    const animeNo = noMatch[1];
    const indirhentaiCmd = commands.get('indirhentai');
    if (indirhentaiCmd) {
      await indirhentaiCmd.execute(sock, msg, from, [animeNo, ...extraArgs], ctx);
      return true;
    }
  }

  // 2. Check for direct Hentaizm URL in quoted message
  const hentaizmUrlMatch = quotedText.match(/https?:\/\/[^\s"',<>]*hentaizm[^\s"',<>]*(?:\/anime\/|\?tab=|\/izle\/)[^\s"',<>]+/i);
  if (hentaizmUrlMatch) {
    const animeUrl = hentaizmUrlMatch[0];
    const perm = checkLinkPermission(animeUrl, from, { isOwner: ctx?.isOwner, isAdmin: ctx?.isAdmin });
    if (!perm.allowed) {
      if (!perm.silent && perm.message) await sock.sendMessage(from, { text: perm.message });
      return true;
    }
    const indirhentaiCmd = commands.get('indirhentai');
    if (indirhentaiCmd) {
      await indirhentaiCmd.execute(sock, msg, from, [animeUrl, ...extraArgs], ctx);
      return true;
    }
  }

  // 3. Check against hentaiFavStore for title match
  const matchedItem = hentaiFavStore.findItemByText(quotedText);
  if (matchedItem) {
    const perm = checkLinkPermission('hentaizm', from, { isOwner: ctx?.isOwner, isAdmin: ctx?.isAdmin });
    if (!perm.allowed) {
      if (!perm.silent && perm.message) await sock.sendMessage(from, { text: perm.message });
      return true;
    }
    const indirhentaiCmd = commands.get('indirhentai');
    if (indirhentaiCmd) {
      await indirhentaiCmd.execute(sock, msg, from, [String(matchedItem.index), ...extraArgs], ctx);
      return true;
    }
  }

  // 4. Check for any video/web URL or magnet link in quoted message
  const urlMatch = quotedText.match(/https?:\/\/[^\s"',<>]+/i);
  const magnetMatch = quotedText.match(/magnet:\?[^\s"',<>]+/i);
  const targetLink = (urlMatch && urlMatch[0]) || (magnetMatch && magnetMatch[0]);

  if (targetLink) {
    const perm = checkLinkPermission(targetLink, from, { isOwner: ctx?.isOwner, isAdmin: ctx?.isAdmin });
    if (!perm.allowed) {
      if (!perm.silent && perm.message) await sock.sendMessage(from, { text: perm.message });
      return true;
    }
    if (targetLink.includes('hentaizm')) {
      const indirhentaiCmd = commands.get('indirhentai');
      if (indirhentaiCmd) {
        await indirhentaiCmd.execute(sock, msg, from, [targetLink, ...extraArgs], ctx);
        return true;
      }
    } else {
      const indirCmd = commands.get('indir');
      if (indirCmd) {
        await indirCmd.execute(sock, msg, from, [targetLink, ...extraArgs], ctx);
        return true;
      }
    }
  }

  // 5. Check if the quoted message itself contains direct media (image, video, audio, document, viewOnce)
  const qContent = unwrapMessage(quotedInfo.quotedMsg);
  const qImg = qContent?.imageMessage || 
               quotedInfo.quotedMsg?.imageMessage || 
               quotedInfo.quotedMsg?.viewOnceMessage?.message?.imageMessage || 
               quotedInfo.quotedMsg?.viewOnceMessageV2?.message?.imageMessage ||
               quotedInfo.quotedMsg?.viewOnceMessageV2Extension?.message?.imageMessage;

  const qVid = qContent?.videoMessage || 
               quotedInfo.quotedMsg?.videoMessage || 
               quotedInfo.quotedMsg?.viewOnceMessage?.message?.videoMessage || 
               quotedInfo.quotedMsg?.viewOnceMessageV2?.message?.videoMessage ||
               quotedInfo.quotedMsg?.viewOnceMessageV2Extension?.message?.videoMessage;

  const qAud = qContent?.audioMessage || 
               quotedInfo.quotedMsg?.audioMessage || 
               quotedInfo.quotedMsg?.viewOnceMessage?.message?.audioMessage || 
               quotedInfo.quotedMsg?.viewOnceMessageV2?.message?.audioMessage ||
               quotedInfo.quotedMsg?.viewOnceMessageV2Extension?.message?.audioMessage;

  const qDoc = qContent?.documentMessage || 
               quotedInfo.quotedMsg?.documentMessage || 
               quotedInfo.quotedMsg?.viewOnceMessage?.message?.documentMessage || 
               quotedInfo.quotedMsg?.viewOnceMessageV2?.message?.documentMessage ||
               quotedInfo.quotedMsg?.viewOnceMessageV2Extension?.message?.documentMessage ||
               qContent?.documentWithCaptionMessage?.message?.documentMessage;

  const qMedia = qImg || qVid || qAud || qDoc;
  if (qMedia) {
    const mediaType = qImg ? 'image' : (qVid ? 'video' : (qAud ? 'audio' : 'document'));
    let buffer = null;

    try {
      const stream = await downloadContentFromMessage(qMedia, mediaType);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      buffer = Buffer.concat(chunks);
    } catch (e1) {
      try {
        const quotedObj = { 
          key: { remoteJid: from, id: quotedInfo.stanzaId, participant: quotedInfo.participant }, 
          message: quotedInfo.quotedMsg 
        };
        buffer = await downloadMediaMessage(quotedObj, 'buffer', {}, { reuploadRequest: () => Promise.resolve() });
      } catch (e2) {}
    }

    if (buffer && buffer.length > 0) {
      const ext = mediaType === 'image' ? 'jpg' : (mediaType === 'video' ? 'mp4' : (mediaType === 'audio' ? 'mp3' : (qDoc?.fileName ? (path.extname(qDoc.fileName).replace('.', '') || 'bin') : 'bin')));
      const captionText = qMedia.caption || '';
      let replyCaption = `📥 *Medya Başarıyla İndirildi!*\n━━━━━━━━━━━━━━━━━━━━`;
      if (captionText) replyCaption += `\n📝 *Açıklama:* ${captionText}`;
      replyCaption += `\n━━━━━━━━━━━━━━━━━━━━`;

      console.log(`[REPLY MEDIA DOWNLOAD] Sending downloaded ${mediaType} (${buffer.length} bytes) to ${from}...`);

      if (mediaType === 'image') {
        await sock.sendMessage(from, { image: buffer, caption: replyCaption }, { quoted: msg, skipAntiBan: true });
      } else if (mediaType === 'video') {
        await sock.sendMessage(from, { video: buffer, caption: replyCaption, mimetype: qVid?.mimetype || 'video/mp4' }, { quoted: msg, skipAntiBan: true });
      } else if (mediaType === 'audio') {
        await sock.sendMessage(from, { audio: buffer, mimetype: qAud?.mimetype || 'audio/mp4', ptt: Boolean(qAud?.ptt) }, { quoted: msg, skipAntiBan: true });
      } else if (mediaType === 'document') {
        await sock.sendMessage(from, { 
          document: buffer, 
          caption: replyCaption, 
          fileName: qDoc?.fileName || `medya_${Date.now()}.${ext}`, 
          mimetype: qDoc?.mimetype || 'application/octet-stream' 
        }, { quoted: msg, skipAntiBan: true });
      }
      return true;
    }
  }

  // 6. If no target could be determined:
  // If the user just typed single dot '.', fail silently to avoid annoying chatter interruptions
  const isExplicitCommand = ['indir', '!indir', '.indir'].includes(firstWord) || (firstWord === '.' && extraArgs.length > 0);
  if (isExplicitCommand) {
    await sock.sendMessage(from, {
      text: `⚠️ Yanıtladığınız mesajda indirilebilir bir link, video veya Hentaizm anime afişi bulunamadı.\n\n` +
            `💡 *Nasıl kullanılır?*\n` +
            `• Bir anime afişini veya video linkini WhatsApp'ta *alıntılayıp/yanıtlayıp* \`.\` yazmanız yeterlidir.`
    });
    return true;
  }

  return false;
}
