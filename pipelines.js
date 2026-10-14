import fs from 'fs';
import { Transform } from 'stream';
import path from 'path';
import { exec, execSync } from 'child_process';
import { extractVideoUrl, gotScraping } from './extractor.js';
import { downloadM3u8 } from './downloader.js';
import { notifyQueueUpdate, updateUserProgress } from './queue.js';
import { botSocketRef, downloadsDir, getProgressBar, formatBytes, addHistory, addErrorLog, botState, readConfig, getProxyUrl } from './config.js';
// WebTorrent native addon stub (node-datachannel native binary is unsupported in cloud container)
class WebTorrent {
  constructor() {
    throw new Error('Torrent indirmeleri bu bulut sunucu ortamında desteklenmemektedir.');
  }
}
// ... (imports remain the same)
import { getCachedResult, saveToCache, deleteFromCache } from './cache.js';
import { getModuleLogger } from './utils/logger.js';
import { ffmpegPath, replaceTurkishChars, getMediaStreamInfo, convertVttToSrt, withRetry } from './pipelines/helpers.js';


export { convertVttToSrt };
// ... (rest of the file)

const logger = getModuleLogger('pipelines');

// Global media sending queue with concurrency support
let activeUploadsCount = 0;
const mediaUploadQueue = [];

export async function queueMediaSend(jid, messageContent) {
  return new Promise((resolve, reject) => {
    mediaUploadQueue.push({ jid, messageContent, resolve, reject });
    processMediaUploadQueue();
  });
}

async function processMediaUploadQueue() {
  const config = readConfig();
  const maxConcurrentUploads = Math.max(1, Number(config.concurrencyLimit) || 1);

  while (activeUploadsCount < maxConcurrentUploads && mediaUploadQueue.length > 0) {
    activeUploadsCount++;
    const { jid, messageContent, resolve, reject } = mediaUploadQueue.shift();

    (async () => {
      try {
        if (!botSocketRef.current) {
          throw new Error("WhatsApp bot bağlantısı aktif değil.");
        }
        let contentToSend = messageContent;
        if (typeof messageContent === 'function') {
          contentToSend = await messageContent();
        }
        const result = await botSocketRef.current.sendMessage(jid, contentToSend);
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        setTimeout(() => {
          activeUploadsCount--;
          processMediaUploadQueue();
        }, 1500);
      }
    })();
  }
}

// ─── Depo Grubuna Gönderici ───
async function sendToDepot(filePath, fileName, mimetype, title, recipientJid) {
  try {
    const config = readConfig();
    const depotJid = config.depotGroupJid;
    if (!depotJid || depotJid === recipientJid) return; // Depo ayarlı değilse veya zaten depoya gönderiliyorsa atla

    if (!fs.existsSync(filePath)) return;
    if (!botSocketRef.current) return;

    console.log(`[DEPO] Dosya depo grubuna gönderiliyor: ${fileName} -> ${depotJid}`);
    await botSocketRef.current.sendMessage(depotJid, { text: `📦 *Depo Kaydı*\n🎬 ${title}\n📁 ${fileName}` });

    const fileStream = fs.createReadStream(filePath);
    await queueMediaSend(depotJid, {
      document: { stream: fileStream },
      mimetype: mimetype || 'application/octet-stream',
      fileName: fileName
    });
    console.log(`[DEPO] ✅ Dosya depo grubuna gönderildi: ${fileName}`);
  } catch (err) {
    console.error(`[DEPO] ❌ Depo gönderimi başarısız: ${err.message}`);
  }
}

// ─── Süre Formatlayıcı ───
function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}dk ${s}sn` : `${s}sn`;
}

// ── YouTube Pipeline ──
export async function executeYouTubePipeline(targetUrl, recipientJid, progressUpdateCallback, signal, isPlaylist, selectedFormat = null, taskObject = null) {
  const { spawn } = await import('child_process');
  const { getYtDlpCommand } = await import('./config.js');
  
  const ytDlpCmd = getYtDlpCommand();
  const env = { ...process.env };
  const ffmpegDir = path.dirname(ffmpegPath);
  const ytDlpDir = path.dirname(ytDlpCmd);
  const separator = process.platform === 'win32' ? ';' : ':';
  const newPaths = [ffmpegDir, ytDlpDir, '/usr/local/bin', '/usr/bin', '/bin'];
  env.PATH = `${newPaths.join(separator)}${separator}${env.PATH || ''}`;
  
  const execAsync = (cmd) => new Promise((resolve, reject) => {
    let modifiedCmd = cmd;
    const activeProxy = getProxyUrl();
    if (activeProxy && (cmd.includes('yt-dlp') || cmd.includes('yt-dlp.exe') || cmd.includes('/usr/local/bin/yt-dlp') || cmd.includes('/usr/bin/yt-dlp'))) {
      modifiedCmd = cmd.replace(/"?yt-dlp"?|"?\.\\yt-dlp\.exe"?|"?\/usr\/local\/bin\/yt-dlp"?|"?\/usr\/bin\/yt-dlp"?/, (m) => `${m} --proxy "${activeProxy}"`);
    }
    exec(modifiedCmd, { maxBuffer: 10 * 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });

  if (isPlaylist) {
    await progressUpdateCallback(`🎵 *YouTube Playlist*\n\n📋 Video listesi alınıyor...`);
    let urls = [];
    try {
      const urlsRaw = await execAsync(`"${ytDlpCmd}" --flat-playlist --print webpage_url "${targetUrl}"`);
      urls = urlsRaw.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
    } catch (e) {
      throw new Error(`Playlist alınamadı: ${e.message}`);
    }
    
    if (urls.length === 0) throw new Error('Playlist boş veya erişilemiyor.');

    await progressUpdateCallback(`🎵 *YouTube Playlist*\n\n📋 ${urls.length} video bulundu!\nSırayla indiriliyor...`);
    for (let i = 0; i < urls.length; i++) {
      if (signal && signal.aborted) throw new Error('İndirme iptal edildi.');
      await progressUpdateCallback(`🎵 *YouTube Playlist*\n\n📥 Video ${i + 1}/${urls.length} indiriliyor...`);
      try {
        await executeYouTubePipeline(urls[i], recipientJid, progressUpdateCallback, signal, false, selectedFormat, taskObject);
      } catch (err) {
        console.error(`Playlist video ${i+1} indirilemedi:`, err.message);
      }
    }
    await progressUpdateCallback(`🎵 *YouTube Playlist*\n\n✅ Tüm videolar başarıyla işlendi! (${urls.length} video)`);
    return;
  }

  // ── Tek Video İndirme ──
  let title = 'YouTube_Video';
  try {
    title = await execAsync(`"${ytDlpCmd}" --get-title --no-playlist "${targetUrl}"`);
    title = replaceTurkishChars(title).replace(/[^a-zA-Z0-9\s]/g, '').trim().slice(0, 60) || 'YouTube_Video';
  } catch {}

  const safeTitle = title.replace(/\s+/g, '_');
  const mp4Path = path.join(downloadsDir, `${safeTitle}.mp4`);
  
  const isWindows = process.platform === 'win32';
  const zipPath = isWindows ? mp4Path.replace('.mp4', '.zip') : mp4Path.replace('.mp4', '.tar.gz');
  const zipFilename = isWindows ? `${safeTitle}.zip` : `${safeTitle}.tar.gz`;

  if (taskObject) {
    taskObject.title = title;
  }

  await progressUpdateCallback(`🎬 *${title}*\n\n📥 YouTube indirme hazırlığı yapılıyor...`);

  const isMp3 = selectedFormat === 'mp3';
  // Spawn kullanarak gerçek zamanlı ilerleme takibi yapıyoruz
  try {
    await new Promise((resolve, reject) => {
      const args = [];
      if (isMp3) {
        args.push(
          '--ffmpeg-location', ffmpegPath,
          '-x',
          '--audio-format', 'mp3',
          '--no-playlist',
          '-o', mp4Path.replace('.mp4', '.mp3')
        );
      } else {
        const formatRule = selectedFormat 
          ? (selectedFormat.includes('+') ? selectedFormat : `${selectedFormat}+bestaudio[ext=m4a]/bestaudio/best`)
          : 'bestvideo[vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';

        args.push(
          '--ffmpeg-location', ffmpegPath,
          '-f', formatRule,
          '--merge-output-format', 'mp4',
          '--postprocessor-args', 'ffmpeg:-movflags +faststart -brand mp42',
          '--no-playlist',
          '-o', mp4Path
        );
      }
      const activeProxy = getProxyUrl();
      if (activeProxy) {
        args.push('--proxy', activeProxy);
      }
      args.push(targetUrl);
      const proc = spawn(ytDlpCmd, args, { env });
      
      const onAbort = () => {
        try { proc.kill(); } catch {}
      };

      if (signal) {
        signal.addEventListener('abort', onAbort);
      }

      let lastProgressTime = 0;
      proc.stdout.on('data', (data) => {
        const output = data.toString();
        const match = output.match(/(\d+\.\d+)%/);
        if (match) {
          const percent = parseFloat(match[1]);
          const now = Date.now();
          if (now - lastProgressTime > 4000) { // Her 4 saniyede bir WhatsApp durumunu güncelle
            lastProgressTime = now;
            const bar = getProgressBar(percent);
             if (taskObject) {
               taskObject.status = `%${percent} [${bar}] (yt-dlp)`;
               notifyQueueUpdate();
             }
            progressUpdateCallback(`🎬 *${title}*\n\n📥 İndiriliyor: %${percent} [${bar}]`).catch(() => {});
          }
        }
      });

      let errorMsg = '';
      proc.stderr.on('data', (data) => {
        errorMsg += data.toString();
      });

      proc.on('close', (code) => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp başarısız oldu (kod: ${code}). Hata: ${errorMsg}`));
      });
    });
  } catch (err) {
    const p = isMp3 ? mp4Path.replace('.mp4', '.mp3') : mp4Path;
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    throw err;
  }

  const finalPath = isMp3 ? mp4Path.replace('.mp4', '.mp3') : mp4Path;
  const finalExt = isMp3 ? '.mp3' : '.mp4';
  const finalMime = isMp3 ? 'audio/mpeg' : 'video/mp4';
  const finalTitle = isMp3 ? `${title}.mp3` : `${title}.mp4`;
  const finalSafeTitle = isMp3 ? `${safeTitle}.mp3` : `${safeTitle}.mp4`;

  if (signal && signal.aborted) {
    try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch {}
    throw new Error('İndirme iptal edildi.');
  }

  if (!isMp3 && fs.existsSync(finalPath)) {
    await ensureWhatsAppCompatibleMp4(finalPath);
  }

  const finalSize = fs.existsSync(finalPath) ? fs.statSync(finalPath).size : 0;
  const finalSizeStr = formatBytes(finalSize);
  const vdsIp = process.env.VDS_IP || '111.235.150.157';
  const watchUrl = `http://${vdsIp}:7860/downloads/${encodeURIComponent(safeTitle)}${finalExt}`;

  const MAX_WA_SIZE = 1.8 * 1024 * 1024 * 1024; // 1.8 GB Limit
  const sendPromise = (async () => {
    try {
      if (!botSocketRef.current) return;
      await progressUpdateCallback(`🎬 *${title}*\n━━━━━━━━━━━━━━━━━━━━\n🚀 WhatsApp gönderim kuyruğuna eklendi...\nBoyut: ${finalSizeStr}`);
      if (finalSize > MAX_WA_SIZE) {
        const partPattern = path.join(downloadsDir, `${safeTitle}_part%03d${finalExt}`);
        const splitCmd = isMp3
          ? `"${ffmpegPath}" -y -i "${finalPath}" -f segment -segment_time 1800 -c copy "${partPattern}"`
          : `"${ffmpegPath}" -y -i "${finalPath}" -f segment -segment_time 2700 -segment_format_options movflags=+faststart:brand=mp42 -reset_timestamps 1 -c copy -map 0 "${partPattern}"`;
        await new Promise((resolve, reject) => {
          exec(splitCmd, (err) => err ? reject(err) : resolve());
        });
        const splitFiles = fs.readdirSync(downloadsDir)
          .filter(f => f.startsWith(`${safeTitle}_part`) && f.endsWith(finalExt))
          .sort();
        for (let i = 0; i < splitFiles.length; i++) {
          const partPath = path.join(downloadsDir, splitFiles[i]);
          if (i > 0) {
            console.log(`[SPLIT SEND] Waiting 10 seconds before sending YouTube part ${i + 1}...`);
            await new Promise(r => setTimeout(r, 10000));
          }

          const partSize = fs.statSync(partPath).size;
          const fileStream = fs.createReadStream(partPath);
          let lastWaUpdate = 0;
          const progressStream = new ProgressStream(partSize, (uploaded, percent) => {
            if (taskObject) {
              taskObject.status = `Parça ${i + 1}/${splitFiles.length} yükleniyor... %${percent}`;
              notifyQueueUpdate();
            }
            const now = Date.now();
            if (now - lastWaUpdate > 5000) {
              lastWaUpdate = now;
              const bar = getProgressBar(percent);
              progressUpdateCallback(`🎬 *${title}*\n━━━━━━━━━━━━━━━━━━━━\n🚀 *Durum:* WhatsApp'a yükleniyor (Parça ${i + 1}/${splitFiles.length} - *%${percent}*)\n\`[${bar}]\``).catch(() => {});
            }
          });
          fileStream.pipe(progressStream);

          await withRetry(() => queueMediaSend(recipientJid, {
            document: { stream: progressStream },
            mimetype: finalMime,
            fileName: splitFiles[i]
          }));
        }
        await progressUpdateCallback(`🎬 *${title}*\n━━━━━━━━━━━━━━━━━━━━\n✅ Tüm parçalar başarıyla gönderildi!\n\n🔗 *Canlı İzleme (VDS):*\n${watchUrl}`);
        // Depo grubuna her parçayı gönder ve diskten temizle
        for (let i = 0; i < splitFiles.length; i++) {
          const partPath = path.join(downloadsDir, splitFiles[i]);
          await sendToDepot(partPath, splitFiles[i], finalMime, title, recipientJid);
          try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch {}
        }
        try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch {}
      } else {
        if (!fs.existsSync(finalPath)) {
          throw new Error(`İndirilen dosya bulunamadı: ${finalPath}`);
        }
        await withRetry(() => queueMediaSend(recipientJid, () => {
          const fileStream = fs.createReadStream(finalPath);
          fileStream.on('error', (err) => console.error('[YouTube Stream Error]:', err.message));
          let lastWaUpdate = 0;
          const progressStream = new ProgressStream(finalSize, (uploaded, percent) => {
            const now = Date.now();
            if (taskObject) {
              taskObject.status = `Yükleniyor... %${percent}`;
              notifyQueueUpdate();
            }
            if (now - lastWaUpdate > 5000) {
              lastWaUpdate = now;
              const bar = getProgressBar(percent);
              progressUpdateCallback(`🎬 *${title}*\n━━━━━━━━━━━━━━━━━━━━\n🚀 *Durum:* WhatsApp'a yükleniyor (*%${percent}*)\n\`[${bar}]\`\n📦 *Boyut:* ${finalSizeStr}`).catch(() => {});
            }
          });
          fileStream.pipe(progressStream);

          return {
            document: { stream: progressStream },
            mimetype: finalMime,
            fileName: finalSafeTitle
          };
        }));
        await progressUpdateCallback(`🎬 *${title}*\n━━━━━━━━━━━━━━━━━━━━\n✅ Başarıyla Gönderildi! (${finalSizeStr})\n\n🔗 *Canlı İzleme (VDS):*\n${watchUrl}`);
        // Depo grubuna gönder ve diskten temizle
        await sendToDepot(finalPath, finalSafeTitle, finalMime, title, recipientJid);
        try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch {}
      }
    } catch (err) {
      console.error(`WhatsApp gönderme hatası (${title}):`, err.message);
      progressUpdateCallback(`❌ *YouTube Gönderim Hatası*\n━━━━━━━━━━━━━━━━━━━━\nDosya WhatsApp'a yüklenirken bir hata oluştu: ${err.message}`).catch(() => {});
    }
  })();

  // Gönderim tamamlanana kadar bekle
  await sendPromise;
  return;
}


export async function executeTorrentPipeline(torrentId, recipientJid, progressUpdateCallback, signal, taskObject = null) {
  const pipelineStart = Date.now();
  await progressUpdateCallback(`🧲 *Torrent Başlatılıyor*\n━━━━━━━━━━━━━━━━━━━━\n📡 Metadata aranıyor, lütfen bekleyin...`);

  return new Promise((resolve, reject) => {
    let client;
    try {
      client = new WebTorrent();
    } catch (e) {
      return reject(new Error(`WebTorrent istemcisi başlatılamadı: ${e.message}`));
    }

    let onAbort;
    if (signal) {
      onAbort = () => {
        try {
          client.destroy();
        } catch {}
        reject(new Error("İndirme iptal edildi."));
      };
      signal.addEventListener('abort', onAbort);
    }

    client.add(torrentId, { path: downloadsDir }, (torrent) => {
      console.log(`[Torrent] Torrent eklendi: ${torrent.name}`);
      if (taskObject) {
        taskObject.title = torrent.name;
      }

      let lastPercent = -1;
      let lastUpdateTime = 0;

      torrent.on('download', (bytes) => {
        if (signal && signal.aborted) {
          try { client.destroy(); } catch {}
          return;
        }

        const now = Date.now();
        const percent = Math.min(100, Math.round(torrent.progress * 100));
        const timePassed = now - lastUpdateTime > 5000;
        const shouldUpdate = (percent !== lastPercent || timePassed) && (timePassed || percent === 100);
        if (!shouldUpdate) return;

        lastPercent = percent;
        lastUpdateTime = now;
        const bar = getProgressBar(percent);
        const speedMBs = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
        
        let etaStr = 'Hesaplanıyor...';
        const etaSeconds = Math.round(torrent.timeRemaining / 1000);
        if (etaSeconds > 0) {
          const m = Math.floor(etaSeconds / 60);
          const s = etaSeconds % 60;
          etaStr = m > 0 ? `${m}dk ${s}sn` : `${s}sn`;
        }

        const statusLine = `İlerleme: ${formatBytes(torrent.downloaded)} / ${formatBytes(torrent.length)}`;
        
        if (taskObject) {
          taskObject.status = `%${percent} [${bar}] - ${statusLine} - Kalan: ${etaStr}`;
          taskObject.speed = speedMBs;
        }

        progressUpdateCallback(`🧲 *${torrent.name}*\n━━━━━━━━━━━━━━━━━━━━\n📥 İndiriliyor: *%${percent}*\n\`[${bar}]\`\n📊 ${statusLine}\n⚡ Hız: ~${speedMBs} MB/s\n⏳ Kalan Süre: ${etaStr}`).catch(() => {});
      });

      torrent.on('done', async () => {
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
        console.log(`[Torrent] İndirme tamamlandı: ${torrent.name}`);
        const files = torrent.files;
        if (files.length === 0) {
          client.destroy();
          reject(new Error("Torrent içinde dosya bulunamadı."));
          return;
        }

        let finalFilePath;
        let finalTitle;
        let finalFileExt;

        if (files.length === 1) {
          finalFilePath = files[0].path;
          finalFilePath = path.join(downloadsDir, finalFilePath);
          finalTitle = files[0].name;
          finalFileExt = path.extname(files[0].name);
        } else {
          const largestFile = files.reduce((prev, current) => (prev.length > current.length) ? prev : current);
          finalFilePath = path.join(downloadsDir, largestFile.path);
          finalTitle = largestFile.name;
          finalFileExt = path.extname(largestFile.name);
        }

        const fileSize = fs.existsSync(finalFilePath) ? fs.statSync(finalFilePath).size : 0;
        const fileSizeStr = formatBytes(fileSize);
        const totalDuration = formatDuration(Date.now() - pipelineStart);

        try {
          client.destroy();
        } catch {}

        (async () => {
          const sendTaskObj = {
            id: taskObject ? taskObject.id : 'wa_' + Date.now(),
            title: finalTitle,
            status: 'WhatsApp\'a yükleniyor...',
            size: fileSizeStr
          };
          botState.sendingTasks.push(sendTaskObj);

          try {
            const lowerExt = finalFileExt.toLowerCase();
            const isVideo = ['.mp4', '.mkv', '.webm', '.avi', '.ts'].includes(lowerExt);
            const icon = isVideo ? '🎬' : '📦';
            let mimeType = 'video/mp4';
            if (lowerExt === '.apk') {
              mimeType = 'application/vnd.android.package-archive';
            } else if (lowerExt === '.zip') {
              mimeType = 'application/zip';
            } else if (lowerExt === '.pdf') {
              mimeType = 'application/pdf';
            } else if (!isVideo) {
              mimeType = 'application/octet-stream';
            }

            const safeTitle = replaceTurkishChars(finalTitle).replace(/[^a-zA-Z0-9]/g, '_');
            const watchUrl = `http://${process.env.VDS_IP || '111.235.150.157'}:7860/downloads/${encodeURIComponent(safeTitle)}${finalFileExt}`;

            const fileStream = fs.createReadStream(finalFilePath);
            let lastWaUpdate = 0;
            const progressStream = new ProgressStream(fileSize, (uploaded, percent) => {
              sendTaskObj.status = `WhatsApp'a yükleniyor... %${percent}`;
              const now = Date.now();
              if (now - lastWaUpdate > 5000) {
                lastWaUpdate = now;
                const bar = getProgressBar(percent);
                progressUpdateCallback(`${icon} *${finalTitle}*\n━━━━━━━━━━━━━━━━━━━━\n🚀 WhatsApp'a yükleniyor: *%${percent}*\n\`[${bar}]\`\nBoyut: ${fileSizeStr}`).catch(() => {});
              }
            });
            fileStream.pipe(progressStream);

            await queueMediaSend(recipientJid, {
              document: { stream: progressStream },
              mimetype: mimeType,
              fileName: finalTitle
            });

            const summary = `${icon} *${finalTitle}*\n\n✅ *Tamamlandı!*\n📦 Boyut: ${fileSizeStr}\n⏱️ Süre: ${totalDuration}\n\n🔗 *İndirme Linki (VDS):*\n${watchUrl}`;
            await progressUpdateCallback(summary);

            await sendToDepot(finalFilePath, finalTitle, mimeType, finalTitle, recipientJid);
            try { if (fs.existsSync(finalFilePath)) fs.unlinkSync(finalFilePath); } catch {}
          } catch (err) {
            console.error(`WhatsApp gönderme hatası (${finalTitle}):`, err.message);
            progressUpdateCallback(`❌ *Gönderim Hatası*\n━━━━━━━━━━━━━━━━━━━━\nDosya WhatsApp'a yüklenirken bir hata oluştu: ${err.message}`).catch(() => {});
          } finally {
            botState.sendingTasks = botState.sendingTasks.filter(t => t.id !== sendTaskObj.id);
          }
        })().then(resolve).catch(reject);
      });

      torrent.on('error', (err) => {
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
        try { client.destroy(); } catch {}
        reject(err);
      });
    });
  });
}

// Batch Download Pipeline (Downloads & Merges Multiple Episodes into One Video)
// Batch Download Pipeline (Downloads & Packages Multiple Episodes into a ZIP Archive)
export async function executeBatchDownloadPipeline(targetUrl, recipientJid, progressUpdateCallback, signal, taskObject) {
  const pipelineStart = Date.now();
  const batch = taskObject.episodeBatch;
  const totalEps = batch.length;
  const batchTempDir = path.join(downloadsDir, `batch_${taskObject.id || Date.now()}_${Date.now()}`);

  const safeTitle = replaceTurkishChars(taskObject.title).replace(/[^a-zA-Z0-9]/g, '_');
  const folderName = safeTitle;
  const epFolder = path.join(batchTempDir, folderName);
  if (!fs.existsSync(epFolder)) fs.mkdirSync(epFolder, { recursive: true });

  const finalZipPath = path.join(downloadsDir, `${safeTitle}.zip`);
  const downloadedParts = [];

  try {
    await progressUpdateCallback(
      `🎬 *${taskObject.title}*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 *${totalEps}* bölümlük paket indirmesi başlatılıyor...\n` +
      `_Bölümler tek tek indirilip bir klasörde toplanacak ve ZIP arşivi olarak gönderilecektir._`
    );

    for (let i = 0; i < totalEps; i++) {
      if (signal && signal.aborted) throw new Error("İndirme iptal edildi.");
      const ep = batch[i];
      const epNumStr = String(ep.episode || (i + 1)).padStart(2, '0');
      const epFileName = `${safeTitle}_Bolum_${epNumStr}.mp4`;
      const epFilePath = path.join(epFolder, epFileName);

      const epBar = getProgressBar(Math.round((i / totalEps) * 100));
      await progressUpdateCallback(
        `🎬 *${taskObject.title}*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 Paket İndiriliyor: *${i + 1}/${totalEps} Bölüm*\n` +
        `\`[${epBar}]\`\n` +
        `▶️ Başlatılan: *${ep.name || `Bölüm ${i + 1}`}*`
      );

      try {
        const epAudio = taskObject?.audioTrack || null;
        const epCacheKey = epAudio ? `${ep.url}#audio=${epAudio}` : ep.url;
        let epResult = getCachedResult(epCacheKey);
        if (!epResult) {
          epResult = await withRetry(() => extractVideoUrl(ep.url, recipientJid, epAudio));
          saveToCache(epCacheKey, epResult);
        }

        if (epResult.filePath && fs.existsSync(epResult.filePath)) {
          fs.copyFileSync(epResult.filePath, epFilePath);
        } else {
          let lastEpPercent = -1;
          let lastEpUpdateTime = 0;
          const epDownloadStart = Date.now();

          await withRetry(async () => {
            lastEpUpdateTime = 0;
            await downloadM3u8(
              epResult.url,
              epFilePath,
              signal,
              async (completed, total) => {
                const now = Date.now();
                const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
                const timePassed = now - lastEpUpdateTime > 4000;
                if (!timePassed && percent !== 100 && percent === lastEpPercent) return;
                lastEpPercent = percent;
                lastEpUpdateTime = now;

                const overallPercent = Math.min(99, Math.round(((i + (percent / 100)) / totalEps) * 100));
                const overallBar = getProgressBar(overallPercent);
                const elapsedSec = (now - epDownloadStart) / 1000;
                const speedBps = elapsedSec > 0 ? completed / elapsedSec : 0;
                const speedMBs = (speedBps / 1024 / 1024).toFixed(2);

                if (taskObject) {
                  taskObject.status = `Bölüm ${i + 1}/${totalEps} (%${percent}) - Paket: %${overallPercent}`;
                  taskObject.speed = speedMBs;
                  notifyQueueUpdate();
                }

                await progressUpdateCallback(
                  `🎬 *${taskObject.title}*\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `📦 Paket İlerleyişi: *%${overallPercent}* (Bölüm ${i + 1}/${totalEps})\n` +
                  `\`[${overallBar}]\`\n` +
                  `▶️ İndirilen: *${ep.name || `Bölüm ${i + 1}`}* (%${percent})\n` +
                  `⚡ Anlık Hız: ~${speedMBs} MB/s`
                );
              },
              epResult.referer || null,
              epResult.cookies || null,
              epResult.userAgent || null,
              epResult.headers || null,
              epResult.audioUrl || null,
              epAudio
            );
          });
        }

        if (fs.existsSync(epFilePath) && fs.statSync(epFilePath).size > 1000) {
          try {
            await ensureWhatsAppCompatibleMp4(epFilePath);
          } catch (e) {}
          downloadedParts.push(epFilePath);
        }
      } catch (epErr) {
        console.warn(`[Batch Pipeline] Episode ${ep.name} (${ep.url}) failed: ${epErr.message}`);
        if (epErr.message === 'İndirme iptal edildi.') throw epErr;
        await progressUpdateCallback(`⚠️ *${ep.name || `Bölüm ${i + 1}`}* atlandı: ${epErr.message}\nSonraki bölüme geçiliyor...`).catch(() => {});
      }
    }

    if (downloadedParts.length === 0) {
      throw new Error("Seçilen bölümlerin hiçbiri indirilemedi.");
    }

    await progressUpdateCallback(
      `🎬 *${taskObject.title}*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 *${downloadedParts.length}* bölüm başarıyla indirildi!\n` +
      `🗜️ Bölümler klasörlenip ZIP arşivi oluşturuluyor...`
    );

    // ZIP oluşturma: -1 hızlı sıkıştırma ile anında ziple
    const zipCmd = `cd "${batchTempDir}" && zip -r -1 -q "${finalZipPath}" "${folderName}"`;
    await new Promise((resolve, reject) => {
      exec(zipCmd, { timeout: 300000 }, (err) => {
        if (err) {
          const pyZipCmd = `python3 -m zipfile -c "${finalZipPath}" "${path.join(batchTempDir, folderName)}"`;
          exec(pyZipCmd, { timeout: 300000 }, (pyErr) => {
            if (pyErr) reject(err);
            else resolve();
          });
        } else {
          resolve();
        }
      });
    });

    try {
      fs.rmSync(batchTempDir, { recursive: true, force: true });
    } catch (e) {}

  } catch (err) {
    try {
      if (fs.existsSync(batchTempDir)) fs.rmSync(batchTempDir, { recursive: true, force: true });
    } catch (e) {}
    try {
      if (fs.existsSync(finalZipPath)) fs.unlinkSync(finalZipPath);
    } catch (e) {}
    if (err.message !== 'İndirme iptal edildi.') {
      addErrorLog({ title: taskObject?.title || targetUrl, url: targetUrl, error: err.message });
    }
    throw err;
  }

  if (!fs.existsSync(finalZipPath) || fs.statSync(finalZipPath).size < 1000) {
    throw new Error("ZIP arşivi oluşturulamadı.");
  }

  const finalSize = fs.statSync(finalZipPath).size;
  const finalSizeStr = formatBytes(finalSize);
  const vdsIp = process.env.VDS_IP || '111.235.150.157';
  const watchUrl = `http://${vdsIp}:7860/downloads/${encodeURIComponent(safeTitle)}.zip`;
  const totalDuration = formatDuration(Date.now() - pipelineStart);

  const sendTaskObj = {
    id: taskObject ? taskObject.id : 'wa_' + Date.now(),
    title: taskObject.title,
    status: 'WhatsApp\'a yükleniyor...',
    size: finalSizeStr
  };
  botState.sendingTasks.push(sendTaskObj);

  await (async () => {
    try {
      await progressUpdateCallback(
        `🎬 *${taskObject.title}*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🚀 WhatsApp'a gönderiliyor (ZIP)...\n` +
        `📦 Boyut: ${finalSizeStr} (${downloadedParts.length} Bölüm Arşivlendi)`
      );

      const fileStream = fs.createReadStream(finalZipPath);
      let lastWaUpdate = 0;
      const progressStream = new ProgressStream(finalSize, (uploaded, percent) => {
        sendTaskObj.status = `WhatsApp'a yükleniyor... %${percent}`;
        notifyQueueUpdate();
        const now = Date.now();
        if (now - lastWaUpdate > 5000) {
          lastWaUpdate = now;
          const bar = getProgressBar(percent);
          progressUpdateCallback(
            `🎬 *${taskObject.title}*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🚀 WhatsApp'a yükleniyor: *%${percent}*\n` +
            `\`[${bar}]\`\n` +
            `📦 Boyut: ${finalSizeStr} (${downloadedParts.length} Bölüm - ZIP)`
          ).catch(() => {});
        }
      });
      fileStream.pipe(progressStream);

      const waFileName = `${taskObject.title.replace(/[\\/:*?"<>|]/g, '_')}.zip`;
      await withRetry(() => queueMediaSend(recipientJid, {
        document: { stream: progressStream },
        mimetype: 'application/zip',
        fileName: waFileName
      }));

      const summary = 
        `🎬 *${taskObject.title}*\n\n` +
        `✅ *Bölümler İndirildi ve ZIP Olarak Paketlendi!*\n` +
        `📦 Paket İçeriği: *${downloadedParts.length} Bölüm (ZIP)*\n` +
        `📦 Toplam Boyut: ${finalSizeStr}\n` +
        `⏱️ Toplam Süre: ${totalDuration}\n\n` +
        `🔗 *Doğrudan İndirme Linki (VDS):*\n${watchUrl}`;

      await progressUpdateCallback(summary);
      console.log(`✅ Batch ZIP gönderildi: ${taskObject.title}`);

      await sendToDepot(finalZipPath, `${safeTitle}.zip`, 'application/zip', taskObject.title, recipientJid);

      try { if (fs.existsSync(finalZipPath)) fs.unlinkSync(finalZipPath); } catch {}

      if (taskObject) { taskObject.endTime = Date.now(); }
      addHistory({
        title: taskObject.title,
        url: targetUrl,
        sizeMB: (finalSize / 1024 / 1024).toFixed(2),
        duration: totalDuration,
        watchUrl: watchUrl,
        fileName: `${safeTitle}.zip`,
        recipientJid
      });
    } catch (err) {
      console.error(`WhatsApp gönderme hatası (${taskObject.title}):`, err.message);
      addErrorLog({ title: taskObject.title, url: targetUrl, error: err.message });
      progressUpdateCallback(`❌ *Gönderim Hatası*\n━━━━━━━━━━━━━━━━━━━━\nDosya WhatsApp'a yüklenirken bir hata oluştu: ${err.message}`).catch(() => {});
    } finally {
      botState.sendingTasks = botState.sendingTasks.filter(t => t.id !== sendTaskObj.id);
      notifyQueueUpdate();
    }
  })();

  return;
}

// Series Pack Pipeline (Downloads All Episodes to Disk First, Then Dispatches Poster + Title + All Video Files)
export async function executeSeriesPackPipeline(targetUrl, recipientJid, progressUpdateCallback, signal, taskObject) {
  const pipelineStart = Date.now();
  const pack = taskObject.seriesPack;
  let seriesName = pack.seriesName || taskObject.title || 'Seri';
  let posterUrl = pack.posterUrl;
  let description = pack.description || '';
  let episodes = pack.episodes || [];
  const replyJid = pack.replyJid || recipientJid;

  if (episodes.length === 0 && targetUrl.includes('hentaizm')) {
    await progressUpdateCallback(`🔍 *${seriesName}* bölümleri taranıyor...`);
    const { getHentaizmSeasonEpisodes } = await import('./extractors/hentaizm.js');
    const animeData = await getHentaizmSeasonEpisodes(targetUrl);
    episodes = animeData.episodes || [];
    if (!posterUrl) posterUrl = animeData.posterUrl;
    if (!description) description = animeData.description;
    if (animeData.seriesName) seriesName = animeData.seriesName;
  }

  const totalEps = episodes.length;
  if (totalEps === 0) {
    throw new Error("Seride indirilecek bölüm bulunamadı.");
  }

  const packTempDir = path.join(downloadsDir, `pack_${taskObject.id || Date.now()}_${Date.now()}`);
  if (!fs.existsSync(packTempDir)) fs.mkdirSync(packTempDir, { recursive: true });

  const safeTitle = replaceTurkishChars(seriesName).replace(/[^a-zA-Z0-9]/g, '_');
  const downloadedEpisodes = [];
  let localPosterPath = null;

  try {
    await progressUpdateCallback(
      `🎬 *${seriesName}*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 *${totalEps}* bölümlük paket indirmesi başlatılıyor...\n` +
      `_Tüm bölümler önce sunucuya indirilecek, ardından kapak resmiyle birlikte topluca gönderilecektir._`
    );

    // 1. Download Poster Image if available
    if (posterUrl) {
      try {
        const pRes = await gotScraping.get({
          url: posterUrl,
          responseType: 'buffer',
          headerGeneratorOptions: { devices: ['desktop'], locales: ['tr-TR', 'en-US'], operatingSystems: ['windows'] },
          timeout: { request: 15000 }
        });
        const pBuf = pRes.rawBody || pRes.body;
        if (pBuf && pBuf.length > 0) {
          localPosterPath = path.join(packTempDir, 'cover.jpg');
          fs.writeFileSync(localPosterPath, pBuf);
        }
      } catch (pErr) {
        console.warn(`[Series Pack] Kapak resmi indirilemedi: ${pErr.message}`);
      }
    }

    // 2. Download each episode sequentially to packTempDir
    for (let i = 0; i < totalEps; i++) {
      if (signal && signal.aborted) throw new Error("İndirme iptal edildi.");
      const ep = episodes[i];
      const epNumStr = String(ep.number || (i + 1)).padStart(2, '0');
      const epFileName = `${safeTitle}_Bolum_${epNumStr}.mp4`;
      const epFilePath = path.join(packTempDir, epFileName);

      const overallBar = getProgressBar(Math.round((i / totalEps) * 100));
      await progressUpdateCallback(
        `🎬 *${seriesName}*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 Paket İlerleyişi: *%${Math.round((i / totalEps) * 100)}* (Bölüm ${i + 1}/${totalEps})\n` +
        `\`[${overallBar}]\`\n` +
        `▶️ Başlatılan: *${ep.name}*`
      );

      try {
        const epAudio = taskObject?.audioTrack || null;
        const epCacheKey = epAudio ? `${ep.url}#audio=${epAudio}` : ep.url;
        let epResult = getCachedResult(epCacheKey);
        if (!epResult) {
          epResult = await withRetry(() => extractVideoUrl(ep.url, recipientJid, epAudio));
          saveToCache(epCacheKey, epResult);
        }

        if (epResult.filePath && fs.existsSync(epResult.filePath)) {
          fs.copyFileSync(epResult.filePath, epFilePath);
        } else {
          let lastEpPercent = -1;
          let lastEpUpdateTime = 0;
          const epDownloadStart = Date.now();

          await withRetry(async () => {
            lastEpUpdateTime = 0;
            await downloadM3u8(
              epResult.url,
              epFilePath,
              signal,
              async (completed, total) => {
                const now = Date.now();
                const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
                const timePassed = now - lastEpUpdateTime > 4000;
                if (!timePassed && percent !== 100 && percent === lastEpPercent) return;
                lastEpPercent = percent;
                lastEpUpdateTime = now;

                const overallPercent = Math.min(99, Math.round(((i + (percent / 100)) / totalEps) * 100));
                const currentBar = getProgressBar(overallPercent);
                const elapsedSec = (now - epDownloadStart) / 1000;
                const speedBps = elapsedSec > 0 ? completed / elapsedSec : 0;
                const speedMBs = (speedBps / 1024 / 1024).toFixed(2);

                if (taskObject) {
                  taskObject.status = `Bölüm ${i + 1}/${totalEps} (%${percent}) - Paket: %${overallPercent}`;
                  taskObject.speed = speedMBs;
                  notifyQueueUpdate();
                }

                await progressUpdateCallback(
                  `🎬 *${seriesName}*\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `📦 Paket İlerleyişi: *%${overallPercent}* (Bölüm ${i + 1}/${totalEps})\n` +
                  `\`[${currentBar}]\`\n` +
                  `▶️ İndirilen: *${ep.name}* (%${percent})\n` +
                  `⚡ Anlık Hız: ~${speedMBs} MB/s`
                );
              },
              epResult.referer || null,
              epResult.cookies || null,
              epResult.userAgent || null,
              epResult.headers || null,
              epResult.audioUrl || null,
              epAudio
            );
          });
        }

        if (fs.existsSync(epFilePath) && fs.statSync(epFilePath).size > 1000) {
          const epSize = fs.statSync(epFilePath).size;
          downloadedEpisodes.push({
            ep,
            filePath: epFilePath,
            fileName: `${seriesName} - ${ep.name}.mp4`.replace(/[\\/:*?"<>|]/g, '_'),
            size: epSize
          });
          console.log(`[Series Pack] Bölüm indirildi: ${ep.name} (${formatBytes(epSize)})`);
        }
      } catch (epErr) {
        console.warn(`[Series Pack] Bölüm ${ep.name} (${ep.url}) başarısız: ${epErr.message}`);
        if (epErr.message === 'İndirme iptal edildi.') throw epErr;
        await progressUpdateCallback(`⚠️ *${ep.name}* atlandı: ${epErr.message}\nSonraki bölüme geçiliyor...`).catch(() => {});
      }
    }

    if (downloadedEpisodes.length === 0) {
      throw new Error("Seçilen bölümlerin hiçbiri indirilemedi.");
    }

    // 3. Dispatch to WhatsApp
    const config = readConfig();
    const targetJid = config.hentaiGroupJid || recipientJid;
    const sock = botSocketRef.current;
    const totalSize = downloadedEpisodes.reduce((acc, d) => acc + d.size, 0);
    const totalSizeStr = formatBytes(totalSize);

    const sendTaskObj = {
      id: `send_pack_${taskObject.id || Date.now()}`,
      title: `${seriesName} (Paket)`,
      status: `WhatsApp'a yükleniyor...`,
      startTime: Date.now()
    };
    botState.sendingTasks.push(sendTaskObj);

    try {
      // 3a. Cover Poster Image + Info
      let captionText = `🎬 *${seriesName}*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📑 *Toplam Bölüm:* ${downloadedEpisodes.length} Bölüm\n` +
        `📦 *Toplam Boyut:* ${totalSizeStr}\n`;
      if (description) {
        captionText += `📝 *Açıklama:* ${description.slice(0, 200)}...\n`;
      }
      captionText += `\n🚀 Bölüm videoları sırayla yükleniyor...`;

      if (sock) {
        if (localPosterPath && fs.existsSync(localPosterPath)) {
          await sock.sendMessage(targetJid, {
            image: fs.readFileSync(localPosterPath),
            caption: captionText
          });
        } else {
          await sock.sendMessage(targetJid, { text: captionText });
        }
      }

      // 3b. Send each episode
      for (let idx = 0; idx < downloadedEpisodes.length; idx++) {
        const item = downloadedEpisodes[idx];
        const fileStream = fs.createReadStream(item.filePath);
        let lastWaUpdate = 0;
        const progressStream = new ProgressStream(item.size, (uploaded, percent) => {
          sendTaskObj.status = `Bölüm ${idx + 1}/${downloadedEpisodes.length} yükleniyor... %${percent}`;
          notifyQueueUpdate();
          const now = Date.now();
          if (now - lastWaUpdate > 5000) {
            lastWaUpdate = now;
            const bar = getProgressBar(percent);
            progressUpdateCallback(
              `🎬 *${seriesName}*\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `🚀 WhatsApp'a yükleniyor: *${idx + 1}/${downloadedEpisodes.length} Bölüm* (*%${percent}*)\n` +
              `\`[${bar}]\`\n` +
              `📁 ${item.fileName}`
            ).catch(() => {});
          }
        });
        fileStream.pipe(progressStream);

        await withRetry(() => queueMediaSend(targetJid, {
          document: { stream: progressStream },
          mimetype: 'video/mp4',
          fileName: item.fileName
        }));

        // Depo grubuna da gönder (farklıysa)
        await sendToDepot(item.filePath, item.fileName, 'video/mp4', `${seriesName} - ${item.ep.name}`, targetJid);

        if (idx < downloadedEpisodes.length - 1) {
          await new Promise(r => setTimeout(r, 4000));
        }
      }

      // 3c. Completion Summary
      const finalSummary = `🎬 *${seriesName}*\n\n` +
        `✅ *Tüm Bölümler Başarıyla Gönderildi!*\n` +
        `📦 Gönderilen: *${downloadedEpisodes.length} Bölüm*\n` +
        `💾 Toplam Boyut: *${totalSizeStr}*`;
      if (sock) {
        await sock.sendMessage(targetJid, { text: finalSummary });
        if (replyJid && replyJid !== targetJid) {
          await sock.sendMessage(replyJid, {
            text: `✅ *${seriesName}* paketi (${downloadedEpisodes.length} bölüm) hedef gruba başarıyla gönderildi!`
          });
        }
      }

      console.log(`[Series Pack] ✅ Seri paketi tamamlandı ve gönderildi: ${seriesName}`);

      if (taskObject) { taskObject.endTime = Date.now(); }
      addHistory({
        title: `${seriesName} (${downloadedEpisodes.length} Bölüm)`,
        url: targetUrl,
        sizeMB: (totalSize / 1024 / 1024).toFixed(2),
        duration: formatDuration(Date.now() - pipelineStart),
        watchUrl: '',
        fileName: `${safeTitle}_paket`,
        recipientJid: targetJid
      });
    } finally {
      botState.sendingTasks = botState.sendingTasks.filter(t => t.id !== sendTaskObj.id);
    }
  } catch (err) {
    console.error(`[Series Pack] Seri paketi hatası (${seriesName}):`, err.message);
    addErrorLog({ title: seriesName, url: targetUrl, error: err.message });
    progressUpdateCallback(`❌ *Paket Hatası*\n━━━━━━━━━━━━━━━━━━━━\n${seriesName} işlenirken hata oluştu: ${err.message}`).catch(() => {});
  } finally {
    try {
      if (fs.existsSync(packTempDir)) {
        fs.rmSync(packTempDir, { recursive: true, force: true });
      }
    } catch (cleanErr) {
      console.error(`[Series Pack] Temizlik hatası:`, cleanErr.message);
    }
  }
}

// Core Download Pipeline (Reusable for WhatsApp and Dashboard)
export async function executeDownloadPipeline(targetUrl, recipientJid, progressUpdateCallback, signal, taskObject = null) {
  if (targetUrl && typeof targetUrl === 'string') {
    targetUrl = targetUrl.trim().split(/[\r\n]+/)[0].trim();
  }
  console.log(`Starting extraction for target: ${targetUrl}`);

  if (signal && signal.aborted) throw new Error("İndirme iptal edildi.");

  if (taskObject?.seriesPack) {
    return await executeSeriesPackPipeline(targetUrl, recipientJid, progressUpdateCallback, signal, taskObject);
  }

  if (taskObject?.episodeBatch && Array.isArray(taskObject.episodeBatch) && taskObject.episodeBatch.length > 1) {
    return await executeBatchDownloadPipeline(targetUrl, recipientJid, progressUpdateCallback, signal, taskObject);
  }

  const pipelineStart = Date.now();

  const isTorrent = targetUrl.startsWith('magnet:') || targetUrl.toLowerCase().includes('.torrent');
  if (isTorrent) {
    return await executeTorrentPipeline(targetUrl, recipientJid, progressUpdateCallback, signal, taskObject);
  }

  // ── YouTube & Playlist Desteği ──
  const isYouTube = /youtube\.com|youtu\.be/i.test(targetUrl);
  const isPlaylist = /[?&]list=/.test(targetUrl) && !/[?&]v=/.test(targetUrl);

  if (isYouTube) {
    const taskFormat = taskObject ? taskObject.format : null;
    return await executeYouTubePipeline(targetUrl, recipientJid, progressUpdateCallback, signal, isPlaylist, taskFormat, taskObject);
  }

  const selectedAudio = taskObject ? taskObject.audioTrack : null;
  const cacheKey = selectedAudio ? `${targetUrl}#audio=${selectedAudio}` : targetUrl;

  // ── Extraction (retry destekli VEYA önbellek) ──
  let result = getCachedResult(cacheKey);
  if (result) {
    console.log(`[Cache Hit] Serving extracted result from cache for: ${cacheKey}`);
  } else {
    try {
      result = await withRetry(() => extractVideoUrl(targetUrl, recipientJid, selectedAudio));
      saveToCache(cacheKey, result);
    } catch (err) {
      addErrorLog({ title: targetUrl, url: targetUrl, error: err.message });
      throw err;
    }
  }
  // Set title: If taskObject title is generic (e.g. 'Video Çözümleniyor...'), replace it with result.title
  const isGenericTitle = !taskObject?.title || 
    taskObject.title === targetUrl || 
    taskObject.title.startsWith('Video Çözümleniyor') || 
    taskObject.title.startsWith('İndiriliyor');

  if (!isGenericTitle && taskObject?.title) {
    result.title = taskObject.title;
  } else if (taskObject && result?.title) {
    taskObject.title = result.title;
  }

  // ── Ayıklanan bağlantı YouTube ise executeYouTubePipeline'a yönlendir ──
  if (result?.url && /youtube\.com|youtu\.be/i.test(result.url)) {
    console.log(`[Pipeline] Ayıklanan bağlantı YouTube embed/video, executeYouTubePipeline'a yönlendiriliyor: ${result.url}`);
    const taskFormat = taskObject ? taskObject.format : null;
    return await executeYouTubePipeline(result.url, recipientJid, progressUpdateCallback, signal, false, taskFormat, taskObject);
  }

  let fileExt = '.mp4';
  let mimeType = 'video/mp4';
  let cleanTitle = (result.title || 'Video').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

  const knownDocExts = new Set(['.apk', '.zip', '.rar', '.7z', '.tar', '.gz', '.pdf', '.exe']);
  const knownAudioExts = new Set(['.mp3', '.wav', '.flac', '.ogg', '.opus', '.m4a', '.aac']);
  const knownVideoExts = new Set(['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv', '.m4v']);

  const extMatch = cleanTitle.match(/\.([a-zA-Z0-9]{2,5})$/);
  if (extMatch) {
    const candidate = `.${extMatch[1].toLowerCase()}`;
    if (knownDocExts.has(candidate) || knownAudioExts.has(candidate) || knownVideoExts.has(candidate)) {
      fileExt = candidate;
      cleanTitle = cleanTitle.substring(0, cleanTitle.lastIndexOf('.')).trim();
    }
  } else {
    try {
      const urlPath = new URL(result.url).pathname;
      const urlExtMatch = urlPath.match(/\.([a-zA-Z0-9]{2,5})$/);
      if (urlExtMatch) {
        const candidate = `.${urlExtMatch[1].toLowerCase()}`;
        if (knownDocExts.has(candidate) || knownAudioExts.has(candidate)) {
          fileExt = candidate;
        } else if (knownVideoExts.has(candidate)) {
          fileExt = candidate;
        }
      }
    } catch (e) {}
  }

  // Güvenlik / HLS Manifest Kontrolü: .txt, .m3u8, .mpd, .m3u, .ts, .html vb. video çıktı formatı olamaz, daima .mp4 olmalıdır
  const manifestOrInvalidExts = ['.m3u8', '.mpd', '.m3u', '.txt', '.html', '.htm', '.php', '.asp', '.aspx', '.json', '.xml', '.ts', '.key'];
  if (manifestOrInvalidExts.includes(fileExt.toLowerCase()) || (!knownDocExts.has(fileExt.toLowerCase()) && !knownAudioExts.has(fileExt.toLowerCase()) && !knownVideoExts.has(fileExt.toLowerCase()))) {
    fileExt = '.mp4';
  }

  const lowerExt = fileExt.toLowerCase();
  const isVideo = knownVideoExts.has(lowerExt);
  const isAudio = knownAudioExts.has(lowerExt);
  const icon = isVideo ? '🎬' : (isAudio ? '🎵' : '📦');
  const label = isVideo ? 'Video' : (isAudio ? 'Ses' : 'Dosya');

  if (lowerExt === '.apk') {
    mimeType = 'application/vnd.android.package-archive';
  } else if (lowerExt === '.zip') {
    mimeType = 'application/zip';
  } else if (lowerExt === '.pdf') {
    mimeType = 'application/pdf';
  } else if (lowerExt === '.rar') {
    mimeType = 'application/x-rar-compressed';
  } else if (lowerExt === '.mp3') {
    mimeType = 'audio/mpeg';
  } else if (isVideo) {
    mimeType = 'video/mp4';
  } else {
    mimeType = 'application/octet-stream';
  }

  const safeTitle = replaceTurkishChars(cleanTitle).replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'video';
  const filePath = path.join(downloadsDir, `${safeTitle}${fileExt}`);
  const vdsIp = process.env.VDS_IP || '111.235.150.157';
  const watchUrl = `http://${vdsIp}:7860/downloads/${encodeURIComponent(safeTitle)}${fileExt}`;

  if (signal && signal.aborted) throw new Error("İndirme iptal edildi.");

  let actualFilePath = (result.filePath && fs.existsSync(result.filePath)) ? result.filePath : filePath;
  let isPreCompiled = Boolean(result.filePath && fs.existsSync(result.filePath));
  if (!isPreCompiled && fs.existsSync(filePath) && fs.statSync(filePath).size > 50 * 1024 * 1024) {
    try {
      const checkCmd = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
      const dur = parseFloat(execSync(checkCmd, { timeout: 10000 }).toString().trim());
      if (!isNaN(dur) && dur > 60) {
        console.log(`[Pipeline] Bulunan mevcut tamamlanmış dosya yeniden kullanılacak (${dur} sn): ${filePath}`);
        isPreCompiled = true;
      }
    } catch (e) {}
  }

  await progressUpdateCallback(`${icon} *${result.title}*\n━━━━━━━━━━━━━━━━━━━━\n📥 İndirme / İşlem başlatılıyor...\n📡 Kaynak: ${result.source}\n🔗 Canlı İzle: ${watchUrl}`);

  // ── İndirme (retry destekli) ──
  let lastPercent = -1;
  let lastUpdateTime = 0;
  const downloadStart = Date.now();
  let lastSpeedMBs = 0;

  try {
    if (!isPreCompiled) {
      await withRetry(async () => {
        // Sıfırla: retry sırasında lastUpdateTime eski kalmasın
        lastUpdateTime = 0;
        try {
          await downloadM3u8(result.url, actualFilePath, signal, async (completed, total) => {
        const now = Date.now();
        const isBytes = total > 1000; // 1000'den büyükse bytes bazlı (direkt indirme)
        const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

        // Güncelleme koşulu: (percent değişmiş VEYA 5sn geçmiş) VE tamamlanma veya cooldown sağlandı
        const timePassed = now - lastUpdateTime > 5000;
        const shouldUpdate = (percent !== lastPercent || timePassed) && (timePassed || percent === 100);
        if (!shouldUpdate) return;

        lastPercent = percent;
        lastUpdateTime = now;
        const bar = getProgressBar(percent);
        const elapsedMs = now - downloadStart;
        const elapsedSec = elapsedMs / 1000;

        let statusLine = '';
        let etaStr = 'Hesaplanıyor...';

        if (isBytes) {
          // Bytes bazlı (direkt MP4/APK/ZIP indirme)
          const speedBps = elapsedSec > 0 ? completed / elapsedSec : 0;
          lastSpeedMBs = (speedBps / 1024 / 1024).toFixed(2);
          const remainingBytes = total - completed;
          const etaSeconds = speedBps > 0 && remainingBytes > 1 ? Math.round(remainingBytes / speedBps) : 0;
          if (etaSeconds > 0) {
            const m = Math.floor(etaSeconds / 60);
            const s = etaSeconds % 60;
            etaStr = m > 0 ? `${m}dk ${s}sn` : `${s}sn`;
          }
          // Eğer total bilinmiyorsa (total ≈ completed) sadece indirilen miktarı göster
          const totalKnown = total > completed + 1024; // en az 1KB fark varsa biliniyor
          statusLine = totalKnown
            ? `İlerleme: ${formatBytes(completed)} / ${formatBytes(total)}`
            : `İndirilen: ${formatBytes(completed)} (boyut bilinmiyor)`;
          if (taskObject) {
            taskObject.status = `%${percent} [${bar}] - ${statusLine} - Kalan: ${etaStr}`;
            taskObject.speed = lastSpeedMBs;
            notifyQueueUpdate();
          }
        } else {
          // Segment bazlı (HLS/M3U8 indirme)
          const speed = elapsedSec > 0 ? completed / elapsedSec : 0;
          const remainingSegments = total - completed;
          const etaSeconds = speed > 0 ? Math.round(remainingSegments / speed) : 0;
          if (etaSeconds > 0) {
            const m = Math.floor(etaSeconds / 60);
            const s = etaSeconds % 60;
            etaStr = m > 0 ? `${m}dk ${s}sn` : `${s}sn`;
          }
          const estSizeMB = (completed / total) * (result.sizeMB || (completed * 0.4));
          lastSpeedMBs = elapsedSec > 0 ? (estSizeMB / elapsedSec).toFixed(2) : '0.00';
          statusLine = `İlerleme: ${completed}/${total} parça`;
          if (taskObject) {
            taskObject.status = `%${percent} [${bar}] - ${completed}/${total} parça - Kalan: ${etaStr}`;
            taskObject.speed = lastSpeedMBs;
            notifyQueueUpdate();
          }
        }

        await progressUpdateCallback(`${icon} *${result.title}*\n━━━━━━━━━━━━━━━━━━━━\n📥 İndiriliyor: *%${percent}*\n\`[${bar}]\`\n📊 ${statusLine}\n⚡ Hız: ~${lastSpeedMBs} MB/s\n⏳ Kalan Süre: ${etaStr}\n🔗 Canlı İzle: ${watchUrl}`);
      }, result.referer || null, result.cookies || null, result.userAgent || null, result.headers || null, result.audioUrl || null, selectedAudio);
        } catch (dlErr) {
          deleteFromCache(cacheKey);
          if (dlErr.message !== 'İndirme iptal edildi.') {
            console.warn(`[Pipeline] Download attempt failed (${dlErr.message}), clearing cache and re-extracting fresh URL for: ${targetUrl}`);
            try {
              const freshRes = await extractVideoUrl(targetUrl, recipientJid, selectedAudio);
              if (freshRes && freshRes.url) {
                result = freshRes;
              }
            } catch (reExtractErr) {}
          }
          throw dlErr;
        }
    });
    }
  } catch (err) {
    try { if (!isPreCompiled && fs.existsSync(actualFilePath)) fs.unlinkSync(actualFilePath); } catch {}
    if (err.message !== 'İndirme iptal edildi.') {
      addErrorLog({ title: result.title, url: targetUrl, error: err.message });
    }
    throw err;
  }

  if (signal && signal.aborted) {
    try { if (!isPreCompiled && fs.existsSync(actualFilePath)) fs.unlinkSync(actualFilePath); } catch {}
    throw new Error("İndirme iptal edildi.");
  }

  // WhatsApp uyumluluğunu (H.264 + AAC + moov atom) altyazı gömme öncesinde sağla
  if (isVideo && fs.existsSync(actualFilePath)) {
    actualFilePath = await ensureWhatsAppCompatibleMp4(actualFilePath);
  }

  // ── Altyazı Muxing / Gömme Adımı ──
  let subtitlesList = [];
  if (result.subtitles && Array.isArray(result.subtitles) && result.subtitles.length > 0) {
    subtitlesList = result.subtitles;
  } else if (result.subtitleUrl) {
    subtitlesList = [{ url: result.subtitleUrl, language: 'tur', label: 'Türkçe' }];
  }

  let savedSrtPath = null;
  let savedSrtName = null;

  if (subtitlesList.length > 0 && fs.existsSync(actualFilePath)) {
    try {
      const config = readConfig();
      const burnSubtitles = (taskObject && taskObject.burnSubtitles) || process.env.BURN_SUBTITLES === 'true' || config.burnSubtitles === true;
      const gotScrapingModule = await import('got-scraping');
      
      const tempSubPaths = [];
      const preparedSubs = [];

      for (let i = 0; i < subtitlesList.length; i++) {
        const sub = subtitlesList[i];
        try {
          await progressUpdateCallback(`✍️ Altyazı dosyası indiriliyor (${i + 1}/${subtitlesList.length}): ${sub.label}...`);
          
          let refHeader = sub.referer || result.referer || targetUrl;
          let originHeader;
          try { if (refHeader) originHeader = new URL(refHeader).origin; } catch (e) {}

          const subRes = await gotScrapingModule.gotScraping({
            url: sub.url,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              ...(refHeader ? { 'Referer': refHeader } : {}),
              ...(originHeader ? { 'Origin': originHeader } : {})
            }
          });
          
          let subContent = subRes.body;
          if (!subContent || subContent.trim().startsWith('<')) {
            throw new Error(`Geçersiz altyazı verisi alındı (HTML/Cloudflare engeli).`);
          }

          const isVtt = subContent.trim().startsWith('WEBVTT') || sub.url.includes('.vtt');
          if (isVtt) {
            subContent = convertVttToSrt(subContent);
          }
          const ext = '.srt';
          
          const tempSubPath = path.join(downloadsDir, `temp_sub_${i}_${Date.now()}${ext}`);
          fs.writeFileSync(tempSubPath, subContent, 'utf8');
          tempSubPaths.push(tempSubPath);
          preparedSubs.push(sub);
          console.log(`[Subtitles] Saved subtitle track ${sub.label} to ${tempSubPath}`);
        } catch (subDownloadErr) {
          console.error(`[Subtitles] Failed to download subtitle ${sub.label}:`, subDownloadErr.message);
        }
      }

      if (preparedSubs.length > 0) {
        // En uygun Türkçe altyazıyı belirle (ayrı dosya ve hardsub için)
        const primarySubIndex = preparedSubs.findIndex(s => s.language === 'tur' || (s.label && s.label.toLowerCase().includes('türk')));
        const targetSubIndex = primarySubIndex !== -1 ? primarySubIndex : 0;
        const targetSub = preparedSubs[targetSubIndex];

        // WhatsApp için eşlik eden .srt belgesini hazırla
        const companionSrt = path.join(downloadsDir, `${safeTitle}_sub_${Date.now()}.srt`);
        fs.copyFileSync(tempSubPaths[targetSubIndex], companionSrt);
        savedSrtPath = companionSrt;
        savedSrtName = `${cleanTitle.replace(/[\\/:*?"<>|]/g, '_')}.srt`;

        const subbedTempPath = path.join(downloadsDir, `subbed_temp_${Date.now()}${fileExt}`);
        
        if (burnSubtitles) {
          // Hardsub (videoya kalıcı gömme - transcode)
          const subToBurnPath = tempSubPaths[targetSubIndex];
          const subToBurn = targetSub;
          
          await progressUpdateCallback(`✍️ Altyazı videoya kalıcı olarak gömülüyor (Hardsub: ${subToBurn.label})... Bu işlem sunucunun işlemci gücüne göre birkaç dakika sürebilir.`);
          
          const relativeSubPath = path.relative(process.cwd(), subToBurnPath).replace(/\\/g, '/');
          const ffmpegCmd = `"${ffmpegPath}" -y -i "${actualFilePath}" -vf "subtitles='${relativeSubPath}'" -c:v libx264 -preset ultrafast -c:a copy -movflags +faststart -brand mp42 "${subbedTempPath}"`;
          console.log(`[Subtitles] Running hardsub command: ${ffmpegCmd}`);
          
          await new Promise((resolve, reject) => {
            exec(ffmpegCmd, (err, stdout, stderr) => {
              if (err) {
                console.error(`[Subtitles] Hardsub transcoding failed:`, stderr || err.message);
                reject(err);
              } else {
                resolve();
              }
            });
          });
        } else {
          // Softsub (tüm dilleri altyazı track'i olarak gömme)
          await progressUpdateCallback(`✍️ Altyazı dosyaları video içine ekleniyor (Softsub - Çoklu Dil)...`);
          
          const subCodec = fileExt.toLowerCase() === '.mkv' ? 'srt' : 'mov_text';
          const ffmpegInputs = [`-i "${actualFilePath}"`];
          const ffmpegMaps = ['-map 0'];
          const ffmpegMetadata = [];
          
          for (let i = 0; i < tempSubPaths.length; i++) {
            ffmpegInputs.push(`-i "${tempSubPaths[i]}"`);
            ffmpegMaps.push(`-map ${i + 1}`);
            
            const sub = preparedSubs[i];
            const lang = sub.language || 'tur';
            const title = sub.label || 'Altyazı';
            
            ffmpegMetadata.push(`-metadata:s:s:${i} language=${lang}`);
            ffmpegMetadata.push(`-metadata:s:s:${i} title="${title}"`);
          }
          
          const ffmpegCmd = `"${ffmpegPath}" -y ${ffmpegInputs.join(' ')} -c:v copy -c:a copy -c:s ${subCodec} -movflags +faststart -brand mp42 ${ffmpegMaps.join(' ')} ${ffmpegMetadata.join(' ')} "${subbedTempPath}"`;
          console.log(`[Subtitles] Running softsub command: ${ffmpegCmd}`);
          
          await new Promise((resolve, reject) => {
            exec(ffmpegCmd, (err, stdout, stderr) => {
              if (err) {
                console.error(`[Subtitles] Softsub muxing failed:`, stderr || err.message);
                reject(err);
              } else {
                resolve();
              }
            });
          });
        }

        // Cleanup and replace file
        if (fs.existsSync(subbedTempPath) && fs.statSync(subbedTempPath).size > 0) {
          fs.unlinkSync(actualFilePath);
          fs.renameSync(subbedTempPath, actualFilePath);
          console.log(`[Subtitles] Successfully processed subtitles for: ${actualFilePath}`);
        } else {
          throw new Error('Altyazılı video dosyası oluşturulamadı (FFmpeg boş çıktı verdi).');
        }
      }

      // Cleanup temp subtitle files
      for (const tempPath of tempSubPaths) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
    } catch (subErr) {
      console.error(`[Subtitles] Subtitle processing error:`, subErr.message);
      await progressUpdateCallback(`⚠️ Altyazı işlemi başarısız oldu, orijinal video gönderiliyor: ${subErr.message}`);
    }
  }

  const fileSize = fs.existsSync(actualFilePath) ? fs.statSync(actualFilePath).size : 0;
  const fileSizeStr = formatBytes(fileSize);
  const totalDuration = formatDuration(Date.now() - pipelineStart);

  if (!botSocketRef.current) throw new Error("WhatsApp bağlı değil.");

  const MAX_WA_SIZE = 1.8 * 1024 * 1024 * 1024; // 1.8 GB Limit

  await (async () => {
    const sendTaskObj = {
      id: taskObject ? taskObject.id : 'wa_' + Date.now(),
      title: result.title,
      status: 'WhatsApp\'a yükleniyor...',
      size: fileSizeStr
    };
    botState.sendingTasks.push(sendTaskObj);

    try {
      let finalFilePath = actualFilePath;
      let finalFileExt = path.extname(actualFilePath);
      let finalMimeType = isVideo ? 'video/mp4' : mimeType;
      let finalTitle = result.title;

      const skipZipExts = ['.apk', '.zip', '.rar', '.7z', '.pdf', '.exe', '.iso'];
      const needsZip = !isVideo && (!skipZipExts.includes(lowerExt) || fileSize > MAX_WA_SIZE);
      if (needsZip) {
        const isWindows = process.platform === 'win32';
        const zipPath = isWindows ? filePath.replace(fileExt, '.zip') : filePath.replace(fileExt, '.tar.gz');
        const zipFilename = isWindows ? `${safeTitle}.zip` : `${safeTitle}.tar.gz`;
        const mimeTypeZip = isWindows ? 'application/zip' : 'application/gzip';
        const label = isWindows ? 'ZIP' : 'TAR.GZ';
        
        let zipSuccess = false;
        let progressInterval;
        try {
          progressInterval = setInterval(() => {
            try {
              if (fs.existsSync(zipPath)) {
                const currentSize = fs.statSync(zipPath).size;
                const percent = Math.min(99, Math.round((currentSize / fileSize) * 100));
                const bar = getProgressBar(percent);
                progressUpdateCallback(`📦 *${result.title}*\n━━━━━━━━━━━━━━━━━━━━\n🗜️ Dosya sıkıştırılıyor (${label}): *%${percent}*\n\`[${bar}]\``).catch(() => {});
              }
            } catch (e) {}
          }, 3000);

          await new Promise((resolve, reject) => {
            const tarCmd = isWindows 
              ? `tar -c -a -f "${zipPath}" -C "${downloadsDir}" "${safeTitle}${fileExt}"`
              : `tar -czf "${zipPath}" -C "${downloadsDir}" "${safeTitle}${fileExt}"`;
            exec(tarCmd, { timeout: 120000 }, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 0) {
            zipSuccess = true;
          }
        } catch (e) {
          console.warn(`[COMPRESS] Sıkıştırma oluşturulamadı: ${e.message}`);
        } finally {
          clearInterval(progressInterval);
        }

        if (zipSuccess) {
          try { fs.unlinkSync(filePath); } catch (e) {}
          finalFilePath = zipPath;
          finalFileExt = isWindows ? '.zip' : '.tar.gz';
          finalMimeType = mimeTypeZip;
          finalTitle = isWindows ? `${cleanTitle}.zip` : `${cleanTitle}.tar.gz`;
        }
      }

      const finalSize = fs.existsSync(finalFilePath) ? fs.statSync(finalFilePath).size : 0;
      const finalSizeStr = formatBytes(finalSize);
      sendTaskObj.title = finalTitle;
      sendTaskObj.size = finalSizeStr;
      
      await progressUpdateCallback(`${icon} *${finalTitle}*\n\n🚀 WhatsApp'a gönderiliyor...\nBoyut: ${finalSizeStr}`);

      if (finalSize > MAX_WA_SIZE) {
        await progressUpdateCallback(`${icon} *${finalTitle}*\n\n⚠️ Dosya boyutu 1.8 GB limitini aştı (${finalSizeStr}).\n✂️ 1.8 GB parçalara bölünüyor...`);
        
        const partPattern = isVideo 
          ? path.join(downloadsDir, `${safeTitle}_part%03d${finalFileExt}`)
          : path.join(downloadsDir, `${safeTitle}${finalFileExt}.%03d`);

        if (isVideo) {
          const splitCmd = `"${ffmpegPath}" -y -i "${finalFilePath}" -f segment -segment_time 2700 -segment_format_options movflags=+faststart:brand=mp42 -reset_timestamps 1 -c copy -map 0 "${partPattern}"`;
          await new Promise((resolve, reject) => {
            exec(splitCmd, (err) => err ? reject(err) : resolve());
          });
        } else {
          await splitFile(finalFilePath, 1800 * 1024 * 1024, partPattern);
        }

        const splitFiles = fs.readdirSync(downloadsDir)
          .filter(f => {
            if (isVideo) {
              return f.startsWith(`${safeTitle}_part`) && f.endsWith(finalFileExt);
            } else {
              return f.startsWith(`${safeTitle}${finalFileExt}.`) && /^\d+$/.test(f.substring(f.lastIndexOf('.') + 1));
            }
          })
          .sort();

        for (let i = 0; i < splitFiles.length; i++) {
          const partPath = path.join(downloadsDir, splitFiles[i]);
          if (i > 0) {
            console.log(`[SPLIT SEND] Waiting 10 seconds before sending part ${i + 1}...`);
            await new Promise(r => setTimeout(r, 10000));
          }
          await withRetry(() => queueMediaSend(recipientJid, () => {
            const partSize = fs.statSync(partPath).size;
            const fileStream = fs.createReadStream(partPath);
            let lastWaUpdate = 0;
            const progressStream = new ProgressStream(partSize, (uploaded, percent) => {
              sendTaskObj.status = `Parça ${i + 1}/${splitFiles.length} yükleniyor... %${percent}`;
              notifyQueueUpdate();
              const now = Date.now();
              if (now - lastWaUpdate > 5000) {
                lastWaUpdate = now;
                const bar = getProgressBar(percent);
                progressUpdateCallback(`🎬 *${finalTitle}*\n━━━━━━━━━━━━━━━━━━━━\n🚀 *Durum:* WhatsApp'a yükleniyor (Parça ${i + 1}/${splitFiles.length} - *%${percent}*)\n\`[${bar}]\``).catch(() => {});
              }
            });
            fileStream.pipe(progressStream);
            return {
              document: { stream: progressStream },
              mimetype: finalMimeType,
              fileName: splitFiles[i]
            };
          }));
        }
        const summary = `${icon} *${finalTitle}*\n\n✅ *Tüm Parçalar Tamamlandı!*\n📦 Toplam Boyut: ${finalSizeStr}\n⏱️ Süre: ${totalDuration}\n\n🔗 *İndirme Linki (VDS):*\n${watchUrl.replace(fileExt, finalFileExt)}`;
        await progressUpdateCallback(summary);
        // Depo grubuna her parçayı gönder ve diskten temizle
        for (let i = 0; i < splitFiles.length; i++) {
          const partPath = path.join(downloadsDir, splitFiles[i]);
          await sendToDepot(partPath, splitFiles[i], finalMimeType, finalTitle, recipientJid);
          try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch {}
        }
        try { if (fs.existsSync(finalFilePath)) fs.unlinkSync(finalFilePath); } catch {}
      } else {
        if (!fs.existsSync(finalFilePath)) {
          throw new Error(`İndirilen dosya bulunamadı: ${finalFilePath}`);
        }

        const waFileName = `${cleanTitle.replace(/[\\/:*?"<>|]/g, '_')}${finalFileExt}`;
        await withRetry(() => queueMediaSend(recipientJid, () => {
          const fileStream = fs.createReadStream(finalFilePath);
          fileStream.on('error', (err) => console.error('[Pipeline Stream Error]:', err.message));
          let lastWaUpdate = 0;
          const progressStream = new ProgressStream(finalSize, (uploaded, percent) => {
            sendTaskObj.status = `WhatsApp'a yükleniyor... %${percent}`;
            notifyQueueUpdate();
            const now = Date.now();
            if (now - lastWaUpdate > 5000) {
              lastWaUpdate = now;
              const bar = getProgressBar(percent);
              progressUpdateCallback(`${icon} *${finalTitle}*\n━━━━━━━━━━━━━━━━━━━━\n🚀 WhatsApp'a yükleniyor: *%${percent}*\n\`[${bar}]\`\nBoyut: ${finalSizeStr}`).catch(() => {});
            }
          });
          fileStream.pipe(progressStream);
          return {
            document: { stream: progressStream },
            mimetype: finalMimeType,
            fileName: waFileName
          };
        }));

        const customCaptionHeader = (taskObject && taskObject.caption) ? `${taskObject.caption}\n━━━━━━━━━━━━━━━━━━━━` : `${icon} *${finalTitle}*`;
        const summary = `${customCaptionHeader}\n\n✅ *Tamamlandı!*\n📦 Boyut: ${finalSizeStr}\n⏱️ Süre: ${totalDuration}\n\n🔗 *İndirme Linki (VDS):*\n${watchUrl.replace(fileExt, finalFileExt)}`;
        await progressUpdateCallback(summary);
        console.log('✅ Dosya gönderildi');
        // Depo grubuna gönder ve diskten temizle
        await sendToDepot(finalFilePath, `${safeTitle}${finalFileExt}`, finalMimeType, finalTitle, recipientJid);
        try { if (fs.existsSync(finalFilePath)) fs.unlinkSync(finalFilePath); } catch {}
      }

      if (savedSrtPath && fs.existsSync(savedSrtPath)) {
        try {
          console.log(`[Subtitles] Sending companion SRT file to ${recipientJid}: ${savedSrtName}`);
          await withRetry(() => queueMediaSend(recipientJid, {
            document: fs.readFileSync(savedSrtPath),
            mimetype: 'application/x-subrip',
            fileName: savedSrtName || 'altyazi.srt',
            caption: `💬 *Altyazı Dosyası (.srt)*\n🎬 ${finalTitle}\n\n💡 _İpucu: Bu dosyayı VLC, MX Player gibi harici oynatıcılarda videoyla birlikte kullanabilirsiniz._`
          }));
        } catch (srtSendErr) {
          console.error(`[Subtitles] Failed to send companion subtitle file:`, srtSendErr.message);
        } finally {
          try { if (fs.existsSync(savedSrtPath)) fs.unlinkSync(savedSrtPath); } catch {}
          savedSrtPath = null;
        }
      }

      if (taskObject) { taskObject.endTime = Date.now(); }
      addHistory({
        title: finalTitle,
        url: targetUrl,
        sizeMB: (finalSize / 1024 / 1024).toFixed(2),
        duration: totalDuration,
        watchUrl: watchUrl.replace(fileExt, finalFileExt),
        fileName: `${safeTitle}${finalFileExt}`,
        recipientJid
      });
    } catch (err) {
      console.error(`WhatsApp gönderme hatası (${result.title}):`, err.message);
      addErrorLog({ title: result.title, url: targetUrl, error: err.message });
      progressUpdateCallback(`❌ *Gönderim Hatası*\n━━━━━━━━━━━━━━━━━━━━\nDosya WhatsApp'a yüklenirken bir hata oluştu: ${err.message}`).catch(() => {});
    } finally {
      if (savedSrtPath && fs.existsSync(savedSrtPath)) {
        try { fs.unlinkSync(savedSrtPath); } catch {}
        savedSrtPath = null;
      }
      botState.sendingTasks = botState.sendingTasks.filter(t => t.id !== sendTaskObj.id);
    }
  })();

  return;
}

function runCommandAsync(cmd, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 15 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout ? stdout.toString() : '');
    });
  });
}

export async function ensureWhatsAppCompatibleMp4(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return filePath;
  const ext = path.extname(filePath).toLowerCase();
  const videoExts = ['.mp4', '.mkv', '.webm', '.avi', '.ts'];
  if (!videoExts.includes(ext)) return filePath;

  try {
    const probeCmd = `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath}"`;
    const probeOut = await runCommandAsync(probeCmd, 25000);
    const probe = JSON.parse(probeOut);
    const vStream = (probe.streams || []).find(s => s.codec_type === 'video');
    const aStream = (probe.streams || []).find(s => s.codec_type === 'audio');

    const vCodec = (vStream?.codec_name || '').toLowerCase();
    const aCodec = (aStream?.codec_name || '').toLowerCase();

    // WhatsApp yerel oynatıcısının desteklediği standartlar:
    // Video: H.264 (AVC)
    // Audio: AAC
    // Container: MP4 (moov atomu başta: +faststart, brand: mp42)
    const isSupportedVCodec = ['h264', 'avc1'].includes(vCodec);
    const hasAudio = !!aStream;
    const isSupportedACodec = !hasAudio || ['aac', 'mp4a'].includes(aCodec);

    const targetMp4Path = filePath.replace(new RegExp(`\\${ext}$`, 'i'), '.mp4');
    const tempSanitized = filePath.replace(new RegExp(`\\${ext}$`, 'i'), '_wa_temp.mp4');

    if (!isSupportedVCodec) {
      // Desteklenmeyen video formatı (VP9, AV1, HEVC, VP8 vb.) -> H.264 + AAC
      console.log(`[WhatsApp Sanitizer] Desteklenmeyen video codec (${vCodec}) tespit edildi. WhatsApp için H.264 + AAC'ye dönüştürülüyor...`);
      await runCommandAsync(`"${ffmpegPath}" -y -i "${filePath}" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart -brand mp42 "${tempSanitized}"`, 600000);
    } else if (!isSupportedACodec) {
      // Desteklenmeyen ses formatı (Opus, Vorbis, AC3, EAC3, DTS vb.) -> Video kopyalanır, sadece ses AAC yapılır
      console.log(`[WhatsApp Sanitizer] Desteklenmeyen ses codec (${aCodec}) tespit edildi. Video korunup ses AAC'ye dönüştürülüyor...`);
      await runCommandAsync(`"${ffmpegPath}" -y -i "${filePath}" -c:v copy -c:a aac -b:a 128k -movflags +faststart -brand mp42 "${tempSanitized}"`, 180000);
    } else {
      // Hem video hem ses uyumlu -> Hızlı remux, moov atomu başa alınır (+faststart)
      console.log(`[WhatsApp Sanitizer] MP4 başlığı (+faststart, brand mp42) optimize ediliyor...`);
      const bsfOpt = hasAudio ? '-bsf:a aac_adtstoasc' : '';
      try {
        await runCommandAsync(`"${ffmpegPath}" -y -i "${filePath}" -map 0 -c copy ${bsfOpt} -movflags +faststart -brand mp42 "${tempSanitized}"`, 120000);
      } catch (remuxErr) {
        console.warn(`[WhatsApp Sanitizer] BSF remux uyarısı (${remuxErr.message}), ses AAC re-encode deneniyor...`);
        await runCommandAsync(`"${ffmpegPath}" -y -i "${filePath}" -map 0:v -map 0:a? -map 0:s? -c:v copy -c:a aac -b:a 128k -c:s copy -movflags +faststart -brand mp42 "${tempSanitized}"`, 180000);
      }
    }

    if (fs.existsSync(tempSanitized) && fs.statSync(tempSanitized).size > 0) {
      if (filePath !== targetMp4Path && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
      fs.renameSync(tempSanitized, targetMp4Path);
      console.log(`[WhatsApp Sanitizer] MP4 WhatsApp güvenlik ve oynatıcı uyumluluğu sağlandı: ${targetMp4Path}`);
      return targetMp4Path;
    }
  } catch (err) {
    console.warn(`[WhatsApp Sanitizer] Düzeltme sırasında hata oluştu (${err.message}). Orijinal dosya korunuyor.`);
    const tempSanitized = filePath.replace(new RegExp(`\\${ext}$`, 'i'), '_wa_temp.mp4');
    try { if (fs.existsSync(tempSanitized)) fs.unlinkSync(tempSanitized); } catch {}
  }
  return filePath;
}

async function splitFile(filePath, chunkSizeBytes, outputPattern) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch (e) {
    throw e;
  }

  const BUFFER_SIZE = 4 * 1024 * 1024; // 4MB buffer for better performance
  const buffer = Buffer.alloc(BUFFER_SIZE);
  let currentPart = 1;
  let currentPartSize = 0;
  const streams = [];

  function getPartPath(partNum) {
    const formattedNum = String(partNum).padStart(3, '0');
    return outputPattern.replace('%03d', formattedNum);
  }

  function waitForStreamFinish(stream) {
    return new Promise((res, rej) => {
      stream.once('finish', res);
      stream.once('error', rej);
    });
  }

  let partPath = getPartPath(currentPart);
  let writeStream = fs.createWriteStream(partPath);
  let streamFinishPromise = waitForStreamFinish(writeStream);
  streams.push(streamFinishPromise);

  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      let offset = 0;
      while (offset < bytesRead) {
        const spaceLeft = chunkSizeBytes - currentPartSize;
        const toWrite = Math.min(spaceLeft, bytesRead - offset);
        const ok = writeStream.write(buffer.subarray(offset, offset + toWrite));
        if (!ok) {
          // Wait for drain to prevent memory pressure
          await new Promise(res => writeStream.once('drain', res));
        }
        offset += toWrite;
        currentPartSize += toWrite;

        if (currentPartSize >= chunkSizeBytes && offset < bytesRead) {
          writeStream.end();
          currentPart++;
          currentPartSize = 0;
          partPath = getPartPath(currentPart);
          writeStream = fs.createWriteStream(partPath);
          streamFinishPromise = waitForStreamFinish(writeStream);
          streams.push(streamFinishPromise);
        }
      }
    }

    writeStream.end();
    fs.closeSync(fd);

    // Wait for ALL streams to finish before resolving
    await Promise.all(streams);
    return currentPart;
  } catch (e) {
    try { writeStream.destroy(); } catch {}
    try { fs.closeSync(fd); } catch {}
    throw e;
  }
}

class ProgressStream extends Transform {
  constructor(totalBytes, onProgress) {
    super();
    this.totalBytes = totalBytes;
    this.uploadedBytes = 0;
    this.onProgress = onProgress;
  }

  _transform(chunk, encoding, callback) {
    this.uploadedBytes += chunk.length;
    const percent = this.totalBytes > 0 ? Math.round((this.uploadedBytes / this.totalBytes) * 100) : 0;
    this.onProgress(this.uploadedBytes, percent);
    this.push(chunk);
    callback();
  }
}
