import { hentaiFavStore } from './hentaiFavStore.js';
import { commands, messageStore } from '../bot.js';

export function getQuotedMessage(msg) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
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

  // Quoting a message and saying "indir", "!indir", "indirhentai", "hepsi"
  if (hasQuoted) {
    if (ltext === 'indir' || ltext.startsWith('indir ') ||
        ltext === '!indir' || ltext.startsWith('!indir ') ||
        ltext === 'indirhentai' || ltext.startsWith('indirhentai ') ||
        ltext === 'hepsi' || ltext === 'tümü') {
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
  // E.g. "🔞 *No: 1* - ...", "👉 indirhentai 1", "No: 12", "#12"
  const noMatch = quotedText.match(/(?:No:\s*|No\.\s*|indirhentai\s+|#\s*)(\d+)/i);
  if (noMatch) {
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
    const indirhentaiCmd = commands.get('indirhentai');
    if (indirhentaiCmd) {
      await indirhentaiCmd.execute(sock, msg, from, [animeUrl, ...extraArgs], ctx);
      return true;
    }
  }

  // 3. Check against hentaiFavStore for title match
  const matchedItem = hentaiFavStore.findItemByText(quotedText);
  if (matchedItem) {
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

  // 5. If no target could be determined:
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
