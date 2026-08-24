import fs from 'fs';
import { Transform } from 'stream';
import path from 'path';
import { exec } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { extractVideoUrl } from './extractor.js';
import { downloadM3u8 } from './downloader.js';
import { notifyQueueUpdate } from './queue.js';
import { botSocketRef, downloadsDir, getProgressBar, formatBytes, addHistory, addErrorLog, botState, readConfig, getProxyUrl } from './config.js';
import WebTorrent from 'webtorrent';
import { getCachedResult, saveToCache } from './cache.js';

// ─── Retry Yardımcısı ───
async function withRetry(fn, retries = 3, delayMs = 3000) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err.message === 'İndirme iptal edildi.') throw err; // İptal edilmişse retry etme
      if (attempt < retries) {
        console.warn(`[RETRY] Deneme ${attempt}/${retries} başarısız: ${err.message}. ${delayMs/1000}sn sonra tekrar...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

// Global media sending lock & queue to prevent rate limits and bandwidth spikes
let isUploadingMedia = false;
const mediaUploadQueue = [];

export async function queueMediaSend(jid, messageContent) {
  return new Promise((resolve, reject) => {
    mediaUploadQueue.push({ jid, messageContent, resolve, reject });
    processMediaUploadQueue();
  });
}

async function processMediaUploadQueue() {
  if (isUploadingMedia || mediaUploadQueue.length === 0) return;
  isUploadingMedia = true;

  const { jid, messageContent, resolve, reject } = mediaUploadQueue.shift();
  try {
    if (!botSocketRef.current) {
      throw new Error("WhatsApp bot bağlantısı aktif değil.");
    }
    const result = await botSocketRef.current.sendMessage(jid, messageContent);
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    // Cooldown of 8 seconds before next media upload can start
    setTimeout(() => {
      isUploadingMedia = false;
      processMediaUploadQueue();
    }, 8000);
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
    title = title.replace(/[^a-zA-Z0-9\s]/g, '').trim().slice(0, 60) || 'YouTube_Video';
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

  // Spawn kullanarak gerçek zamanlı ilerleme takibi yapıyoruz
  try {
    await new Promise((resolve, reject) => {
      const isMp3 = selectedFormat === 'mp3';
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
          ? `${selectedFormat}+bestaudio[ext=m4a]/best`
          : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

        args.push(
          '--ffmpeg-location', ffmpegPath,
          '-f', formatRule,
          '--merge-output-format', 'mp4',
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
          ? `"${ffmpegPath}" -i "${finalPath}" -f segment -segment_time 1800 -c copy "${partPattern}"`
          : `"${ffmpegPath}" -i "${finalPath}" -f segment -segment_time 2700 -segment_format_options movflags=+faststart -c copy -map 0 "${partPattern}"`;
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
        // Depo grubuna her parçayı gönder
        for (let i = 0; i < splitFiles.length; i++) {
          const partPath = path.join(downloadsDir, splitFiles[i]);
          await sendToDepot(partPath, splitFiles[i], finalMime, title, recipientJid);
        }
      } else {
        const fileStream = fs.createReadStream(finalPath);
        let lastWaUpdate = 0;
        const progressStream = new ProgressStream(finalSize, (uploaded, percent) => {
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

        await queueMediaSend(recipientJid, {
          document: { stream: progressStream },
          mimetype: finalMime,
          fileName: finalSafeTitle
        });
        await progressUpdateCallback(`🎬 *${title}*\n━━━━━━━━━━━━━━━━━━━━\n✅ Başarıyla Gönderildi! (${finalSizeStr})\n\n🔗 *Canlı İzleme (VDS):*\n${watchUrl}`);
        // Depo grubuna gönder
        await sendToDepot(finalPath, finalSafeTitle, finalMime, title, recipientJid);
      }
    } catch (err) {
      console.error(`WhatsApp gönderme hatası (${title}):`, err.message);
      progressUpdateCallback(`❌ *YouTube Gönderim Hatası*\n━━━━━━━━━━━━━━━━━━━━\nDosya WhatsApp'a yüklenirken bir hata oluştu: ${err.message}`).catch(() => {});
    }
  })();

  // Gönderim arka planda devam ederken indirme aşaması bittiği için sonraki göreve geçilsin
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

            const safeTitle = finalTitle.replace(/[^a-zA-Z0-9]/g, '_');
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
          } catch (err) {
            console.error(`WhatsApp gönderme hatası (${finalTitle}):`, err.message);
            progressUpdateCallback(`❌ *Gönderim Hatası*\n━━━━━━━━━━━━━━━━━━━━\nDosya WhatsApp'a yüklenirken bir hata oluştu: ${err.message}`).catch(() => {});
          } finally {
            botState.sendingTasks = botState.sendingTasks.filter(t => t.id !== sendTaskObj.id);
          }
        })();

        resolve();
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

// Core Download Pipeline (Reusable for WhatsApp and Dashboard)
export async function executeDownloadPipeline(targetUrl, recipientJid, progressUpdateCallback, signal, taskObject = null) {
  console.log(`Starting extraction for target: ${targetUrl}`);

  if (signal && signal.aborted) throw new Error("İndirme iptal edildi.");

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

  // ── Extraction (retry destekli VEYA önbellek) ──
  let result = getCachedResult(targetUrl);
  if (result) {
    console.log(`[Cache Hit] Serving extracted result from cache for: ${targetUrl}`);
  } else {
    try {
      result = await withRetry(() => extractVideoUrl(targetUrl, recipientJid));
      saveToCache(targetUrl, result);
    } catch (err) {
      addErrorLog({ title: targetUrl, url: targetUrl, error: err.message });
      throw err;
    }
  }
  console.log('Extraction success:', result);
  if (taskObject && taskObject.url === targetUrl) {
    taskObject.title = result.title;
  }

  let fileExt = '.mp4';
  let mimeType = 'video/mp4';
  let cleanTitle = result.title;

  const extMatch = result.title.match(/\.([a-zA-Z0-9]+)$/);
  if (extMatch) {
    fileExt = `.${extMatch[1]}`;
    cleanTitle = result.title.substring(0, result.title.lastIndexOf('.'));
  } else {
    try {
      const urlPath = new URL(result.url).pathname;
      const urlExtMatch = urlPath.match(/\.([a-zA-Z0-9]+)$/);
      if (urlExtMatch) {
        fileExt = `.${urlExtMatch[1]}`;
      }
    } catch (e) {}
  }

  if (fileExt.toLowerCase() === '.m3u8' || fileExt.toLowerCase() === '.mpd') {
    fileExt = '.mp4';
  }

  const lowerExt = fileExt.toLowerCase();
  const isVideo = ['.mp4', '.mkv', '.webm', '.avi', '.ts'].includes(lowerExt);
  const icon = isVideo ? '🎬' : '📦';
  const label = isVideo ? 'Video' : 'Dosya';

  if (lowerExt === '.apk') {
    mimeType = 'application/vnd.android.package-archive';
  } else if (lowerExt === '.zip') {
    mimeType = 'application/zip';
  } else if (lowerExt === '.pdf') {
    mimeType = 'application/pdf';
  } else if (lowerExt === '.rar') {
    mimeType = 'application/x-rar-compressed';
  } else if (!isVideo) {
    mimeType = 'application/octet-stream';
  }

  const safeTitle = cleanTitle.replace(/[^a-zA-Z0-9]/g, '_');
  const filePath = path.join(downloadsDir, `${safeTitle}${fileExt}`);
  const vdsIp = process.env.VDS_IP || '111.235.150.157';
  const watchUrl = `http://${vdsIp}:7860/downloads/${encodeURIComponent(safeTitle)}${fileExt}`;

  if (signal && signal.aborted) throw new Error("İndirme iptal edildi.");

  const actualFilePath = (result.filePath && fs.existsSync(result.filePath)) ? result.filePath : filePath;
  const isPreCompiled = result.filePath && fs.existsSync(result.filePath);

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
      }, result.referer || null, result.cookies || null, result.userAgent || null, result.headers || null);
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

  // ── Altyazı Muxing / Gömme Adımı ──
  if (result.subtitleUrl && fs.existsSync(actualFilePath)) {
    try {
      await progressUpdateCallback(`✍️ Altyazı dosyası indiriliyor...\n🔗 Link: ${result.subtitleUrl}`);
      const gotScrapingModule = await import('got-scraping');
      const subRes = await gotScrapingModule.gotScraping({
        url: result.subtitleUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      let subContent = subRes.body;
      // Convert VTT to SRT if needed
      if (subContent.trim().startsWith('WEBVTT') || result.subtitleUrl.includes('.vtt')) {
        subContent = subContent
          .replace(/^\ufeff?WEBVTT[^\n]*\n/i, '') // Remove WEBVTT header
          .replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2') // Replace dot with comma in timestamps
          .replace(/<[^>]+>/g, ''); // Strip HTML/Style tags
      }
      
      const tempSubPath = path.join(downloadsDir, `temp_sub_${Date.now()}.srt`);
      fs.writeFileSync(tempSubPath, subContent, 'utf8');
      console.log(`[Subtitles] Saved subtitle to ${tempSubPath}`);

      const config = readConfig();
      const burnSubtitles = process.env.BURN_SUBTITLES === 'true' || config.burnSubtitles === true;

      // Determine output path
      const subbedTempPath = path.join(downloadsDir, `subbed_temp_${Date.now()}${fileExt}`);
      
      if (burnSubtitles) {
        // Hardsub (transcoding)
        await progressUpdateCallback(`✍️ Altyazılar videoya kalıcı olarak gömülüyor (Transcoding)... Bu işlem işlemci gücüne göre birkaç dakika sürebilir.`);
        
        // Escape paths for Windows FFmpeg subtitles filter
        const relativeSubPath = path.relative(process.cwd(), tempSubPath).replace(/\\/g, '/');
        
        const ffmpegCmd = `"${ffmpegPath}" -y -i "${actualFilePath}" -vf "subtitles=${relativeSubPath}" -c:v libx264 -preset ultrafast -c:a copy "${subbedTempPath}"`;
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
        // Softsub (muxing)
        await progressUpdateCallback(`✍️ Altyazı dosyası video içine gömülüyor (Softsub)...`);
        
        const subCodec = fileExt.toLowerCase() === '.mkv' ? 'srt' : 'mov_text';
        const ffmpegCmd = `"${ffmpegPath}" -y -i "${actualFilePath}" -i "${tempSubPath}" -c:v copy -c:a copy -c:s ${subCodec} -map 0 -map 1? -metadata:s:s:0 language=tur -metadata:s:s:0 title="Türkçe" "${subbedTempPath}"`;
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

      // Cleanup temp subtitle file
      try { fs.unlinkSync(tempSubPath); } catch (e) {}
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

  (async () => {
    const sendTaskObj = {
      id: taskObject ? taskObject.id : 'wa_' + Date.now(),
      title: result.title,
      status: 'WhatsApp\'a yükleniyor...',
      size: fileSizeStr
    };
    botState.sendingTasks.push(sendTaskObj);

    try {
      let finalFilePath = filePath;
      let finalFileExt = fileExt;
      let finalMimeType = mimeType;
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
          const splitCmd = `"${ffmpegPath}" -i "${finalFilePath}" -f segment -segment_time 2700 -segment_format_options movflags=+faststart -c copy -map 0 "${partPattern}"`;
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

          await withRetry(() => queueMediaSend(recipientJid, {
            document: { stream: progressStream },
            mimetype: finalMimeType,
            fileName: splitFiles[i]
          }));
        }
        const summary = `${icon} *${finalTitle}*\n\n✅ *Tüm Parçalar Tamamlandı!*\n📦 Toplam Boyut: ${finalSizeStr}\n⏱️ Süre: ${totalDuration}\n\n🔗 *İndirme Linki (VDS):*\n${watchUrl.replace(fileExt, finalFileExt)}`;
        await progressUpdateCallback(summary);
        // Depo grubuna her parçayı gönder
        for (let i = 0; i < splitFiles.length; i++) {
          const partPath = path.join(downloadsDir, splitFiles[i]);
          await sendToDepot(partPath, splitFiles[i], finalMimeType, finalTitle, recipientJid);
        }
      } else {
        const fileStream = fs.createReadStream(finalFilePath);
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

        await withRetry(() => queueMediaSend(recipientJid, {
          document: { stream: progressStream },
          mimetype: finalMimeType,
          fileName: `${safeTitle}${finalFileExt}`
        }));

        const summary = `${icon} *${finalTitle}*\n\n✅ *Tamamlandı!*\n📦 Boyut: ${finalSizeStr}\n⏱️ Süre: ${totalDuration}\n\n🔗 *İndirme Linki (VDS):*\n${watchUrl.replace(fileExt, finalFileExt)}`;
        await progressUpdateCallback(summary);
        console.log('✅ Dosya gönderildi');
        // Depo grubuna gönder
        await sendToDepot(finalFilePath, `${safeTitle}${finalFileExt}`, finalMimeType, finalTitle, recipientJid);
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
      botState.sendingTasks = botState.sendingTasks.filter(t => t.id !== sendTaskObj.id);
    }
  })();

  return;
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
