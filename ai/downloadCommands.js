import { addDownloadTask, cancelDownloadTask, downloadQueue, activeTasksList, processQueue, clearQueue, queueState } from '../queue.js';
import { userProfileManager } from './userProfileManager.js';
import { memoryManager, getQuotedMessageText } from './aiEngine.js';
import { readConfig, botState, downloadsDir, formatBytes } from '../config.js';
import { isBotOwner, isGroupAdminOrOwner, checkLinkPermission } from '../utils/permissionManager.js';
import indirCmd from '../commands/media/indir.js';
import indirHentaiCmd from '../commands/hentai/indirhentai.js';

/**
 * 📥 AI Doğal Dil İndirme & Kuyruk Komutları Modülü
 * Sohbet esnasında doğal dil ile:
 * - "şu animenin indirmelerini ayarlarmısın indirtsene", "bunu indiriver", "1 ile 12. bölümleri indir"
 * - "indirmeler ne durumda", "kuyrukta ne var"
 * - "indirmeyi iptal et", "indirmeleri durdur"
 * - "bu resmin promptunu kayıt et"
 * gibi istekleri doğrudan gerçek bot aksiyonlarına dönüştürür.
 */

/**
 * Yapay zeka sistem istemine (extraContext) eklenecek canlı indirme kuyruğu özeti
 */
export function getLiveDownloadQueueContext(from) {
  const active = activeTasksList.filter(t => !from || t.recipientJid === from);
  const queued = downloadQueue.filter(t => !from || t.recipientJid === from);

  if (active.length === 0 && queued.length === 0) {
    return '';
  }

  let ctx = `\n📥 AKTİF İNDİRME VE KUYRUK DURUMU:\n`;
  if (active.length > 0) {
    ctx += `- Şu an İndirilenler (${active.length} adet):\n`;
    for (const t of active) {
      ctx += `  * ${t.title || t.url} | Durum: ${t.status || 'İndiriliyor'} | İlerleme: %${t.progress || 0} | Hız: ${t.speed || '0'} MB/s\n`;
    }
  }
  if (queued.length > 0) {
    ctx += `- Sırada Bekleyenler (${queued.length} adet):\n`;
    for (const t of queued.slice(0, 8)) {
      ctx += `  * ${t.title || t.url} (${t.status || 'Sırada'})\n`;
    }
    if (queued.length > 8) {
      ctx += `  * ...ve ${queued.length - 8} görev daha sırada bekliyor.\n`;
    }
  }
  return ctx;
}

/**
 * Sohbet geçmişinden (son birkaç mesajdan) en son paylaşılan URL'yi bulur
 */
function findRecentUrlInHistory(from) {
  try {
    const history = memoryManager.getHistory(from);
    for (let i = history.length - 1; i >= Math.max(0, history.length - 6); i--) {
      const content = String(history[i]?.content || '');
      const urlMatch = content.match(/(?:https?:\/\/|magnet:\?)[^\s"',<>\]\)]+/i);
      if (urlMatch) return urlMatch[0];
    }
  } catch (e) {}
  return null;
}

/**
 * Gerçek indir.js veya indirhentai.js komutunu tetikler
 */
export async function executeConversationalDownload(sock, msg, from, targetUrl, extraText = '') {
  if (!targetUrl) return false;

  const sender = msg?.key?.participant || from;
  const senderNumber = (sender || '').split('@')[0];
  const isOwner = msg ? isBotOwner(msg, senderNumber) : true;
  const isAdmin = msg ? await isGroupAdminOrOwner(sock, msg, from) : true;

  const perm = checkLinkPermission(targetUrl, from, { isOwner, isAdmin });
  if (!perm.allowed) {
    if (!perm.silent && perm.message) {
      await sock.sendMessage(from, { text: perm.message }, msg ? { quoted: msg, skipAntiBan: true } : { skipAntiBan: true });
    }
    return true;
  }

  // Bölüm aralığı (örn: "1-12", "1 ile 12", "5+") veya mp3/öncelik argümanlarını ayıkla
  const extraArgs = [];
  const cleanExtra = String(extraText || '').replace(targetUrl, ' ').trim();

  const rangeMatch = cleanExtra.match(/\b(\d+(?:\.\d+)?)\s*(?:[-–—]|ile|den|dan|'den|'dan|to)\s*(\d+(?:\.\d+)?)\b/i);
  const plusMatch = cleanExtra.match(/\b(\d+(?:\.\d+)?)\s*(?:\+|ve\s*sonras[ıi]|bölümden\s*sonras[ıi])\b/i);
  const singleEpMatch = cleanExtra.match(/\b(\d+)\.\s*bölüm/i) || cleanExtra.match(/\bbölüm\s*(\d+)\b/i);

  if (rangeMatch) {
    extraArgs.push(`${rangeMatch[1]}-${rangeMatch[2]}`);
  } else if (plusMatch) {
    extraArgs.push(`${plusMatch[1]}+`);
  } else if (singleEpMatch) {
    extraArgs.push(singleEpMatch[1]);
  }

  if (/\b(acil|öncelikli|oncelikli|hemen)\b/i.test(cleanExtra)) {
    extraArgs.push('--oncelikli');
  }
  if (/\b(gömülü|gomulu|hardsub)\b/i.test(cleanExtra)) {
    extraArgs.push('--hardsub');
  }

  const isMp3 = /\b(mp3|ses\s*olarak|müzik\s*olarak|şarkı\s*olarak)\b/i.test(cleanExtra);
  const syntheticText = `${isMp3 ? '!mp3' : '!indir'} ${targetUrl}${extraArgs.length ? ' ' + extraArgs.join(' ') : ''}`;

  const ctx = {
    text: syntheticText,
    ltext: syntheticText.toLowerCase(),
    config: readConfig(),
    botState,
    activeCaptchasMap: global.activeCaptchasMap || new Map(),
    downloadsDir,
    formatBytes,
    isOwner,
    isAdmin
  };

  if (targetUrl.toLowerCase().includes('hentaizm') && indirHentaiCmd?.execute) {
    await indirHentaiCmd.execute(sock, msg, from, [targetUrl, ...extraArgs], ctx);
    return true;
  }

  if (indirCmd?.execute) {
    await indirCmd.execute(sock, msg, from, [targetUrl, ...extraArgs], ctx);
    return true;
  }

  // Fallback: Doğrudan kuyruğa ekle
  const task = addDownloadTask(targetUrl, from, 'Medya İndirme', null, extraArgs.includes('--oncelikli'));
  await sock.sendMessage(from, {
    text: `📥 *İndirme Başlatıldı*\n━━━━━━━━━━━━━━━━━━━━\n🔗 ${targetUrl}\n📋 Görev ID: ${task.id}\n⏳ Kuyruğa eklendi.`
  }, msg ? { quoted: msg, skipAntiBan: true } : { skipAntiBan: true });
  processQueue();
  return true;
}

export async function handleDownloadCommands(sock, msg, from, userPrompt, options = {}) {
  const rawPrompt = (userPrompt || '').trim();
  const cleanCmd = rawPrompt.toLocaleLowerCase('tr-TR');
  const { quoted: msgQuoted } = options;
  const sendOpts = msgQuoted ? { quoted: msgQuoted, skipAntiBan: true } : { skipAntiBan: true };

  // ── 1. İNDİRME / KUYRUK DURUMU SORGUSU ──
  const durumPatterns = [
    /indirme(ler|m|lerimiz)?\s*(ne\s+durumda|ne\s+alemde|durumu|durum|bitti\s*mi|kaldı\s*mı)/i,
    /(ne\s+durumda|ne\s+alemde|durumu|durum)\s*indirme(ler)?/i,
    /kuyruk(ta)?\s*(ne\s+var|durumu|ne\s+durumda)/i,
    /şu\s*an\s*ne\s*iniyor/i,
    /aktif\s*indirme(ler)?(\s*var\s*mı)?/i,
    /indirme(ler)?\s*liste/i,
    /download\s*(status|durum|list)/i
  ];
  const isDurumSorgu = durumPatterns.some(p => p.test(cleanCmd));

  if (isDurumSorgu) {
    const active = activeTasksList.filter(t => t.recipientJid === from);
    const queued = downloadQueue.filter(t => t.recipientJid === from);

    let reply = '';
    if (active.length === 0 && queued.length === 0) {
      reply = `Şu an aktif veya sırada bekleyen hiçbir indirmen yok kanka. İndirmek istediğin bir anime, film veya video varsa linkini at hemen ateşleyelim.`;
    } else {
      reply = `📥 *İNDİRME DURUMU*\n━━━━━━━━━━━━━━━━━━━━\n`;
      if (active.length > 0) {
        reply += `🔄 *Şu An İnenler (${active.length}):*\n`;
        for (const t of active) {
          reply += `• *${t.title || t.url}*\n  Durum: ${t.status || 'İndiriliyor'} | İlerleme: %${t.progress || 0} | Hız: ${t.speed || '0'} MB/s\n\n`;
        }
      }
      if (queued.length > 0) {
        reply += `⏳ *Sırada Bekleyenler (${queued.length}):*\n`;
        for (const t of queued.slice(0, 10)) {
          reply += `• ${t.title || t.url} (${t.status || 'Bekliyor'})\n`;
        }
        if (queued.length > 10) {
          reply += `• _...ve ${queued.length - 10} bölüm/dosya daha sırada._\n`;
        }
      }
      reply += `━━━━━━━━━━━━━━━━━━━━\n💡 Durdurmak istersen "indirmeyi iptal et" demen yeterli kanka.`;
    }

    await sock.sendMessage(from, { text: reply }, sendOpts);
    return { text: reply, provider: 'local_action', handled: true };
  }

  // ── 2. İNDİRME İPTAL ETME / DURDURMA ──
  const iptalPatterns = [
    /(iptal(\s*et)?|durdur|sil|kaldır|kaldir|vazgeçtim)\s*(şu\s*)?(indirme(ler|yi|leri)?|indir|download|kuyruğu|kuyrugu)/i,
    /(indirme(ler|yi|leri)?|indir|download|kuyruğu|kuyrugu)\s*(iptal(\s*et)?|durdur|sil|kaldır|kaldir|temizle)/i,
    /tüm\s*indirmeleri\s*(iptal|durdur|sil|temizle)/i,
    /download\s*(cancel|stop)/i
  ];
  const isIptal = iptalPatterns.some(p => p.test(cleanCmd));

  if (isIptal) {
    const wantsAll = /(tüm|hepsini|komple|kuyruğu\s*temizle|kuyrugu\s*temizle|indirmeleri)/i.test(cleanCmd);
    const activeForChat = activeTasksList.filter(t => t.recipientJid === from);
    const queuedForChat = downloadQueue.filter(t => t.recipientJid === from);

    if (activeForChat.length === 0 && queuedForChat.length === 0) {
      const msgText = `Şu an iptal edilecek aktif veya bekleyen bir indirmen yok kanka.`;
      await sock.sendMessage(from, { text: msgText }, sendOpts);
      return { text: msgText, provider: 'local_action', handled: true };
    }

    if (wantsAll && (activeForChat.length + queuedForChat.length > 1)) {
      let count = 0;
      for (const t of [...activeForChat, ...queuedForChat]) {
        if (cancelDownloadTask(t.id)) count++;
      }
      const msgText = `⛔ Toplam *${count}* adet aktif/bekleyen indirme iptal edildi ve kuyruktan temizlendi kanka.`;
      await sock.sendMessage(from, { text: msgText }, sendOpts);
      return { text: msgText, provider: 'local_action', handled: true };
    }

    const targetTask = activeForChat[0] || queuedForChat[0];
    if (targetTask) {
      cancelDownloadTask(targetTask.id);
      const msgText = `⛔ *${targetTask.title || targetTask.url}* indirmesi durduruldu ve kuyruktan kaldırıldı kanka.`;
      await sock.sendMessage(from, { text: msgText }, sendOpts);
      return { text: msgText, provider: 'local_action', handled: true };
    }
  }

  // ── 3. DOĞAL DİL İLE ANİME / VİDEO / LİNK İNDİRME ──
  const hasDownloadVerb = /\b(indir\w*|indirt\w*|çek\w*|cek\w*|yükle\w*|yukle\w*|download|sıraya\s*(?:al|ekle|koy)|kuyruğa\s*(?:al|ekle|koy)|indirmelerini\s*ayarla\w*|indirmesini\s*ayarla\w*)\b/i.test(cleanCmd);
  const hasMediaNoun = /\b(anime\w*|dizi\w*|film\w*|video\w*|bölüm\w*|bolum\w*|link\w*|şarkı\w*|müzik\w*|mp3|hepsini|tümünü)\b/i.test(cleanCmd);

  // Mesajda, alıntıda veya yakın geçmişte URL var mı kontrol et
  let targetUrl = null;
  const directUrlMatch = rawPrompt.match(/(?:https?:\/\/|magnet:\?)[^\s"',<>]+/i);
  if (directUrlMatch) {
    targetUrl = directUrlMatch[0];
  }

  const quotedText = getQuotedMessageText(msg);
  if (!targetUrl && quotedText) {
    const quotedUrlMatch = quotedText.match(/(?:https?:\/\/|magnet:\?)[^\s"',<>]+/i);
    if (quotedUrlMatch) targetUrl = quotedUrlMatch[0];
  }

  // Kullanıcı "şu animenin indirmelerini ayarla / bunu indir / 1-12 bölümleri indir" dediyse yakın sohbet geçmişindeki linke de bak
  const isConversationalDownloadRequest =
    hasDownloadVerb && (Boolean(targetUrl) || hasMediaNoun || /^(?:bunu|şunu|sunu|onları|hepsini|linki)\s+/i.test(cleanCmd) || /\b(?:bunu|şunu|linki)\s+indir/i.test(cleanCmd));

  if (isConversationalDownloadRequest) {
    if (!targetUrl) {
      targetUrl = findRecentUrlInHistory(from);
    }

    if (targetUrl) {
      try {
        await executeConversationalDownload(sock, msg, from, targetUrl, rawPrompt + (quotedText ? ' ' + quotedText : ''));
        return { text: 'İndirme işlemi başlatıldı.', provider: 'local_action', handled: true };
      } catch (err) {
        await sock.sendMessage(from, {
          text: `❌ İndirme başlatılırken bir sorun çıktı kanka: ${err.message}`
        }, sendOpts);
        return { text: 'İndirme hatası.', provider: 'local_action', handled: true };
      }
    }
  }

  // ── 4. GÖRSEL PROMPTUNU KULLANICI HAFIZASINA KAYDETME ──
  const promptKayitPatterns = [
    /(bu\s+)?resim(ın|in)?\s*(promptu|prompt)\s*(kayıt|kaydet|hafızama\s*kaydet)/i,
    /(promptu|prompt)\s*(kayıt|kaydet|hafızama\s*kaydet)/i,
    /resim\s*promptu\s*kaydet/i,
    /görsel\s*promptu\s*kaydet/i,
    /gorsel\s*promptu\s*kaydet/i,
    /promptu\s*hafızama\s*kaydet/i,
    /örnek\s*resim(İ|i)?\s*kaydet/i,
    /örnek\s*resim\s*kaydet/i
  ];
  const isPromptKayit = promptKayitPatterns.some(p => p.test(cleanCmd));

  if (isPromptKayit) {
    const userJid = msg?.key?.senderPn || msg?.key?.participant || msg?.participant || from;
    const history = memoryManager.getHistory(from);
    let lastImagePrompt = null;
    let lastImageStyle = null;
    let lastImageFilePath = null;

    for (let i = history.length - 1; i >= 0; i--) {
      const content = String(history[i]?.content || '');
      const match = content.match(/\[Görsel Üretildi: "([\s\S]*?)" \| Stil: ([^\]]+)(?: \| Dosya: ([^\]]+))?\]/);
      if (match) {
        lastImagePrompt = match[1];
        lastImageStyle = match[2];
        lastImageFilePath = match[3] || null;
        break;
      }
    }

    if (!lastImagePrompt) {
      await sock.sendMessage(from, {
        text: `❌ Henüz kaydedilecek bir görsel promptu bulunamadı kanka. Önce bir görsel üretelim, sonra promptunu kaydedebilirim.`
      }, sendOpts);
      return { text: 'Görsel promptu bulunamadı.', provider: 'local_action', handled: true };
    }

    userProfileManager.setNote(userJid, 'son_resim_promotu', lastImagePrompt);
    userProfileManager.setNote(userJid, 'son_resim_stili', lastImageStyle);
    if (lastImageFilePath) {
      userProfileManager.setNote(userJid, 'son_resim_dosya_yolu', lastImageFilePath);
    }
    userProfileManager.addFact(userJid, `Üretilen görsel promptu: "${lastImagePrompt}" (Stil: ${lastImageStyle})${lastImageFilePath ? ` | Dosya: ${lastImageFilePath}` : ''}`);

    const reply = `🖼️ *Görsel Promptu Kaydedildi!*\n━━━━━━━━━━━━━━━━━━━━\n📝 *Prompt:* ${lastImagePrompt}\n🎨 *Stil:* ${lastImageStyle}${lastImageFilePath ? `\n📁 *Örnek Resim Dosyası:* ${lastImageFilePath}` : ''}\n\n✅ Bu prompt ve örnek resim kullanıcı hafıza kartına kaydedildi.`;
    await sock.sendMessage(from, { text: reply }, sendOpts);
    return { text: reply, provider: 'local_action', handled: true };
  }

  return { handled: false };
}