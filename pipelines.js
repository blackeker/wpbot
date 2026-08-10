import fs from 'fs';
import { Transform } from 'stream';
import path from 'path';
import { exec } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { extractVideoUrl } from './extractor.js';
import { downloadM3u8 } from './downloader.js';
import { botSocketRef, downloadsDir, getProgressBar, formatBytes, addHistory, addErrorLog, botState } from './config.js';

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
  
  const ytDlpCmd = fs.existsSync('./yt-dlp.exe') ? '.\\yt-dlp.exe' : 'yt-dlp';
  
  const execAsync = (cmd) => new Promise((resolve, reject) => {
    let modifiedCmd = cmd;
    if (process.env.PROXY_URL && (cmd.includes('yt-dlp') || cmd.includes('yt-dlp.exe'))) {
      modifiedCmd = cmd.replace(/"?yt-dlp"?|"?\.\\yt-dlp\.exe"?/, (m) => `${m} --proxy "${process.env.PROXY_URL}"`);
    }
    exec(modifiedCmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
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
      const formatRule = selectedFormat 
        ? `${selectedFormat}+bestaudio[ext=m4a]/best`
        : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

      const args = [
        '--ffmpeg-location', ffmpegPath,
        '-f', formatRule,
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '-o', mp4Path
      ];
      if (process.env.PROXY_URL) {
        args.push('--proxy', process.env.PROXY_URL);
      }
      args.push(targetUrl);
      const proc = spawn(ytDlpCmd, args);
      
      if (signal) {
        signal.addEventListener('abort', () => {
          try { proc.kill(); } catch {}
        });
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
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp başarısız oldu (kod: ${code}). Hata: ${errorMsg}`));
      });
    });
  } catch (err) {
    try { if (fs.existsSync(mp4Path)) fs.unlinkSync(mp4Path); } catch {}
    throw err;
  }

  if (signal && signal.aborted) {
    try { if (fs.existsSync(mp4Path)) fs.unlinkSync(mp4Path); } catch {}
    throw new Error('İndirme iptal edildi.');
  }

  const mp4Size = fs.existsSync(mp4Path) ? fs.statSync(mp4Path).size : 0;
  const mp4SizeStr = formatBytes(mp4Size);
  const vdsIp = process.env.VDS_IP || '111.235.150.157';
  const watchUrl = `http://${vdsIp}:7860/downloads/${encodeURIComponent(safeTitle)}.mp4`;

  const MAX_WA_SIZE = 1.8 * 1024 * 1024 * 1024; // 1.8 GB Limit
  const sendPromise = (async () => {
    try {
      if (!botSocketRef.current) return;
      await progressUpdateCallback(`🎬 *${title}*\n\n🚀 WhatsApp'a gönderiliyor...\nBoyut: ${mp4SizeStr}`);
      if (mp4Size > MAX_WA_SIZE) {
        const partPattern = path.join(downloadsDir, `${safeTitle}_part%03d.mp4`);
        const splitCmd = `"${ffmpegPath}" -i "${mp4Path}" -c copy -map 0 -fs 1800M "${partPattern}"`;
        await new Promise((resolve, reject) => {
          exec(splitCmd, (err) => err ? reject(err) : resolve());
        });
        const splitFiles = fs.readdirSync(downloadsDir)
          .filter(f => f.startsWith(`${safeTitle}_part`) && f.endsWith('.mp4'))
          .sort();
        for (let i = 0; i < splitFiles.length; i++) {
          const partPath = path.join(downloadsDir, splitFiles[i]);
          if (i > 0) {
            console.log(`[SPLIT SEND] Waiting 10 seconds before sending YouTube part ${i + 1}...`);
            await new Promise(r => setTimeout(r, 10000));
          }
          await withRetry(() => botSocketRef.current.sendMessage(recipientJid, {
            document: { stream: fs.createReadStream(partPath) },
            mimetype: 'video/mp4',
            fileName: splitFiles[i]
          }));
        }
        await progressUpdateCallback(`🎬 *${title}*\n\n✅ Tüm parçalar başarıyla gönderildi!\n\n🔗 *Canlı İzleme Linki (VDS):*\n${watchUrl}`);
      } else {
        await botSocketRef.current.sendMessage(recipientJid, {
          document: { stream: fs.createReadStream(mp4Path) },
          mimetype: 'video/mp4',
          fileName: `${safeTitle}.mp4`
        });
        await progressUpdateCallback(`🎬 *${title}*\n\n✅ Gönderildi! (${mp4SizeStr})\n\n🔗 *Canlı İzleme Linki (VDS):*\n${watchUrl}`);
      }
    } catch (err) {
      console.error(`WhatsApp gönderme hatası (${title}):`, err.message);
    }
  })();

  // Gönderim arka planda devam ederken indirme aşaması bittiği için sonraki göreve geçilsin
  return;
}

// Core Download Pipeline (Reusable for WhatsApp and Dashboard)
export async function executeDownloadPipeline(targetUrl, recipientJid, progressUpdateCallback, signal, taskObject = null) {
  console.log(`Starting extraction for target: ${targetUrl}`);

  if (signal && signal.aborted) throw new Error("İndirme iptal edildi.");

  const pipelineStart = Date.now();

  // ── YouTube & Playlist Desteği ──
  const isYouTube = /youtube\.com|youtu\.be/i.test(targetUrl);
  const isPlaylist = /[?&]list=/.test(targetUrl) && !/[?&]v=/.test(targetUrl);

  if (isYouTube) {
    const taskFormat = taskObject ? taskObject.format : null;
    return await executeYouTubePipeline(targetUrl, recipientJid, progressUpdateCallback, signal, isPlaylist, taskFormat, taskObject);
  }

  // ── Extraction (retry destekli) ──
  let result;
  try {
    result = await withRetry(() => extractVideoUrl(targetUrl, recipientJid));
  } catch (err) {
    addErrorLog({ title: targetUrl, url: targetUrl, error: err.message });
    throw err;
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

  await progressUpdateCallback(`${icon} *${result.title}* bulundu!\nKaynak: ${result.source}\n📥 İndirme başlatılıyor...\n\n🔗 *Canlı İndirme/İzleme Linki (VDS):*\n${watchUrl}`);

  // ── İndirme (retry destekli) ──
  let lastPercent = -1;
  let lastUpdateTime = 0;
  const downloadStart = Date.now();
  let lastSpeedMBs = 0;

  try {
    await withRetry(async () => {
      // Sıfırla: retry sırasında lastUpdateTime eski kalmasın
      lastUpdateTime = 0;
      await downloadM3u8(result.url, filePath, signal, async (completed, total) => {
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
          }
        }

        await progressUpdateCallback(`${icon} *${result.title}*\n\n📥 İndiriliyor: %${percent} [${bar}]\n${statusLine}\nHız: ~${lastSpeedMBs} MB/s\nKalan Süre: ${etaStr}\n\n🔗 *İndirme Linki:*\n${watchUrl}`);
      }, result.referer || null, result.cookies || null, result.userAgent || null, result.headers || null);
    });
  } catch (err) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    if (err.message !== 'İndirme iptal edildi.') {
      addErrorLog({ title: result.title, url: targetUrl, error: err.message });
    }
    throw err;
  }

  if (signal && signal.aborted) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw new Error("İndirme iptal edildi.");
  }

  const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
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
      if (!isVideo && !skipZipExts.includes(lowerExt)) {
        await progressUpdateCallback(`📦 *${result.title}*\n\n🗜️ Dosya sıkıştırılıyor (ZIP)...`);
        const zipPath = filePath.replace(fileExt, '.zip');
        let zipSuccess = false;
        try {
          await new Promise((resolve, reject) => {
            const tarCmd = `tar -c -a -f "${zipPath}" -C "${downloadsDir}" "${safeTitle}${fileExt}"`;
            exec(tarCmd, { timeout: 120000 }, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 0) {
            zipSuccess = true;
          }
        } catch (e) {
          console.warn(`[ZIP] ZIP oluşturulamadı, dosya direkt gönderiliyor: ${e.message}`);
        }

        if (zipSuccess) {
          try { fs.unlinkSync(filePath); } catch (e) {}
          finalFilePath = zipPath;
          finalFileExt = '.zip';
          finalMimeType = 'application/zip';
          finalTitle = `${cleanTitle}.zip`;
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
          const splitCmd = `"${ffmpegPath}" -i "${finalFilePath}" -c copy -map 0 -fs 1800M "${partPattern}"`;
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
          const progressStream = new ProgressStream(partSize, (uploaded, percent) => {
            sendTaskObj.status = `Parça ${i + 1}/${splitFiles.length} yükleniyor... %${percent}`;
          });
          fileStream.pipe(progressStream);

          await withRetry(() => botSocketRef.current.sendMessage(recipientJid, {
            document: { stream: progressStream },
            mimetype: finalMimeType,
            fileName: splitFiles[i]
          }));
        }
        const summary = `${icon} *${finalTitle}*\n\n✅ *Tüm Parçalar Tamamlandı!*\n📦 Toplam Boyut: ${finalSizeStr}\n⏱️ Süre: ${totalDuration}\n\n🔗 *İndirme Linki (VDS):*\n${watchUrl.replace(fileExt, finalFileExt)}`;
        await progressUpdateCallback(summary);
      } else {
        const fileStream = fs.createReadStream(finalFilePath);
        const progressStream = new ProgressStream(finalSize, (uploaded, percent) => {
          sendTaskObj.status = `WhatsApp'a yükleniyor... %${percent}`;
        });
        fileStream.pipe(progressStream);

        await withRetry(() => botSocketRef.current.sendMessage(recipientJid, {
          document: { stream: progressStream },
          mimetype: finalMimeType,
          fileName: `${safeTitle}${finalFileExt}`
        }));

        const summary = `${icon} *${finalTitle}*\n\n✅ *Tamamlandı!*\n📦 Boyut: ${finalSizeStr}\n⏱️ Süre: ${totalDuration}\n\n🔗 *İndirme Linki (VDS):*\n${watchUrl.replace(fileExt, finalFileExt)}`;
        await progressUpdateCallback(summary);
        console.log('✅ Dosya gönderildi');
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
