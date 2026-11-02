import { addDownloadTask, cancelDownloadTask, downloadQueue, activeTasksList, clearPendingSelection, setPendingSelection } from '../../queue.js';
import { executeDownloadPipeline } from '../../pipelines.js';
import { botSocketRef } from '../../config.js';

import indirCmd from '../media/indir.js';

export default {
  name: 'indirmedurum',
  aliases: ['dlstatus'],
  description: 'İndirme durumu ve hızlı indirme yönetimi (AI destekli)',
  async execute(sock, msg, from, args = [], ctx = {}) {
    const sender = msg.key.participant || from;
    const rawText = args.join(' ').trim();
    const ltext = rawText.toLowerCase();

    // Komut yoksa kullanıcıya nasıl kullanılacağını söyle
    if (!rawText) {
      await sock.sendMessage(from, {
        text: `📥 *İNDİRME KOMUTU*\n━━━━━━━━━━━━━━━━━━━━\n🔗 Bir link atıp indirmesini isteyin.\n\nÖrnekler:\n• "https://youtube.com/watch?v=... linki indir"\n• "bu linki indir" (alıntılanan mesaja yanıt olarak)\n• "indirmeler ne durumda" (durum sorgusu)\n• "indirme iptal" (aktif indirmeyi iptal et)\n━━━━━━━━━━━━━━━━━━━━\n💡 İpucu: Linki doğrudan yazıp "indir" demeniz yeterli.`
      }, { quoted: msg });
      return;
    }

    // ── 1. İNDİRME DURUMU SORGUSU ──
    if (ltext.includes('indirme') && (ltext.includes('durum') || ltext.includes('ne durumda') || ltext.includes('durumu'))) {
      const active = activeTasksList.filter(t => t.recipientJid === from);
      const queued = downloadQueue.filter(t => t.recipientJid === from);

      let reply = `📥 *İNDİRME DURUMU*\n━━━━━━━━━━━━━━━━━━━━\n`;

      if (active.length === 0 && queued.length === 0) {
        reply += `✅ Şu anda aktif veya bekleyen indirmeniz yok.\n`;
      } else {
        if (active.length > 0) {
          reply += `🔄 *Aktif İndirmeler:*\n`;
          for (const t of active) {
            reply += `• ${t.title || t.url}\n  Durum: ${t.status || 'Bilinmiyor'}\n  İlerleme: ${t.progress || 0}%\n  Hız: ${t.speed || '0'} MB/s\n\n`;
          }
        }
        if (queued.length > 0) {
          reply += `⏳ *Bekleyen İndirmeler:*\n`;
          for (const t of queued) {
            reply += `• ${t.title || t.url}\n  Durum: ${t.status || 'Bekliyor'}\n\n`;
          }
        }
      }

      reply += `━━━━━━━━━━━━━━━━━━━━\n💡 İptal etmek için: "indirme iptal" yazın.`;
      await sock.sendMessage(from, { text: reply }, { quoted: msg });
      return;
    }

    // ── 2. İNDİRME İPTAL ETME ──
    if ((ltext.includes('iptal') || ltext.includes('durdur') || ltext.includes('sil')) && (ltext.includes('indirme') || ltext.includes('indir') || ltext.includes('download'))) {
      const active = activeTasksList.find(t => t.recipientJid === from);
      const queued = downloadQueue.find(t => t.recipientJid === from);

      let cancelled = false;
      if (active) {
        cancelDownloadTask(active.id);
        cancelled = true;
        await sock.sendMessage(from, {
          text: `⛔ *İndirme İptal Edildi*\n━━━━━━━━━━━━━━━━━━━━\n📁 ${active.title || active.url}\n\nİndirme durduruldu ve kuyruktan kaldırıldı.`
        }, { quoted: msg });
      } else if (queued) {
        cancelDownloadTask(queued.id);
        cancelled = true;
        await sock.sendMessage(from, {
          text: `⛔ *Bekleyen İndirme İptal Edildi*\n━━━━━━━━━━━━━━━━━━━━\n📁 ${queued.title || queued.url}\n\nİndirme kuyruktan kaldırıldı.`
        }, { quoted: msg });
      }

      if (!cancelled) {
        await sock.sendMessage(from, {
          text: `ℹ️ İptal edilecek aktif veya bekleyen indirme bulunamadı.`
        }, { quoted: msg });
      }
      return;
    }

    // ── 3. LINK İNDİRME ──
    // URL'yi metinden çıkar
    const urlMatch = rawText.match(/https?:\/\/[^\s]+/);
    let targetUrl = urlMatch ? urlMatch[0] : null;

    // Eğer URL yoksa ve alıntılanan mesaj varsa, oradan link al
    if (!targetUrl && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
      const quotedText = quoted.conversation || quoted.extendedTextMessage?.text || '';
      const quotedUrlMatch = quotedText.match(/https?:\/\/[^\s]+/);
      if (quotedUrlMatch) targetUrl = quotedUrlMatch[0];
    }

    if (!targetUrl) {
      await sock.sendMessage(from, {
        text: `❌ Geçerli bir link bulunamadı.\n\nLütfen indirmek istediğiniz linki yapıştırın.\nÖrnek: "https://youtube.com/watch?v=... indir"`
      }, { quoted: msg });
      return;
    }

    // Başlık çıkar (URL'den veya metinden)
    let title = rawText.replace(targetUrl, '').replace(/indir|download|link/i, '').trim() || 'Video Çözümleniyor...';

    try {
      // Kuyruğa ekle
      const task = addDownloadTask(targetUrl, from, title, null, false, null, null, null, null, false, {});

      await sock.sendMessage(from, {
        text: `📥 *İndirme Başlatıldı*\n━━━━━━━━━━━━━━━━━━━━\n🔗 ${targetUrl}\n📋 Görev ID: ${task.id}\n⏳ Kuyruğa eklendi, sıraya gelince başlayacak.\n\n💡 Durum sorgulamak için: "indirmeler ne durumda"\n🛑 İptal etmek için: "indirme iptal"`
      }, { quoted: msg });

      // Kuyruğu işlemeye başla
      const { processQueue } = await import('../../queue.js');
      processQueue();

    } catch (err) {
      await sock.sendMessage(from, {
        text: `❌ İndirme başlatılamadı: ${err.message}`
      }, { quoted: msg });
    }
  }
};