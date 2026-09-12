import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { File } from 'megajs';
import { exec, execSync } from 'child_process';
import ffmpegStaticPath from 'ffmpeg-static';

let ffmpegPath = ffmpegStaticPath;
try {
  const sysFfmpeg = execSync('which ffmpeg 2>/dev/null || true').toString().trim();
  if (sysFfmpeg && fs.existsSync(sysFfmpeg)) {
    ffmpegPath = sysFfmpeg;
  }
} catch (e) {
  ffmpegPath = ffmpegStaticPath;
}

import { gotScraping as originalGotScraping } from 'got-scraping';
import HttpsProxyAgentPkg from 'https-proxy-agent';
const HttpsProxyAgent = HttpsProxyAgentPkg.HttpsProxyAgent || HttpsProxyAgentPkg;
import { CookieJar, Cookie } from 'tough-cookie';
import { getProxyUrl, formatBytes, getProgressBar, cleanOldDownloads } from './config.js';

async function checkAvailableDiskSpace(targetDir, requiredBytes = 500 * 1024 * 1024) {
  try {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(targetDir);
      const freeBytes = stats.bavail * stats.bsize;
      if (freeBytes < 2 * 1024 * 1024 * 1024) {
        console.warn(`[DISK UYARISI] Düşük boş disk alanı (${(freeBytes / 1024 / 1024).toFixed(0)} MB). Temizlik tetikleniyor...`);
        cleanOldDownloads();
      }
      const statsAfter = fs.statfsSync(targetDir);
      const freeAfter = statsAfter.bavail * statsAfter.bsize;
      if (freeAfter < Math.max(requiredBytes, 1024 * 1024 * 1024)) {
        throw new Error(`Yetersiz disk alanı: Sadece ${(freeAfter / 1024 / 1024).toFixed(0)} MB boş alan var.`);
      }
    }
  } catch (err) {
    if (err.message && err.message.startsWith('Yetersiz disk')) throw err;
  }
}

function shouldUseProxy(url) {
  if (!url) return false;
  const lowerUrl = String(url).toLowerCase();
  return lowerUrl.includes('pornhub.com') ||
         lowerUrl.includes('phncdn.com') ||
         lowerUrl.includes('hentaizm') ||
         lowerUrl.includes('turkifsahub.com') ||
         lowerUrl.includes('turkifsalar') ||
         lowerUrl.includes('turkporno') ||
         lowerUrl.includes('cloud.mail.ru') ||
         lowerUrl.includes('cloclo') ||
         lowerUrl.includes('mail.ru');
}

const gotScraping = new Proxy(originalGotScraping, {
  apply(target, thisArg, argumentsList) {
    const options = argumentsList[0] || {};
    const url = options.url || '';
    const activeProxy = getProxyUrl();
    if (typeof options === 'object' && activeProxy && shouldUseProxy(url)) {
      options.proxyUrl = activeProxy;
    }
    return Reflect.apply(target, thisArg, argumentsList);
  },
  get(target, prop, receiver) {
    if (['get', 'post', 'put', 'patch', 'delete', 'head'].includes(prop)) {
      return (url, options) => {
        let opt = {};
        if (typeof url === 'object') {
          opt = url;
        } else {
          opt = options || {};
          opt.url = url;
        }
        const activeProxy = getProxyUrl();
        if (activeProxy && shouldUseProxy(opt.url)) {
          opt.proxyUrl = activeProxy;
        }
        return originalGotScraping[prop](opt);
      };
    }
    return Reflect.get(target, prop, receiver);
  }
});


// Helper to resolve URLs relative to a base URL
function resolveUrl(baseUrl, relativeUrl) {
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  const base = new URL(baseUrl);
  if (relativeUrl.startsWith('/')) {
    return `${base.origin}${relativeUrl}`;
  }
  // Relative to path
  const pathParts = base.pathname.split('/');
  pathParts.pop(); // Remove file name
  const basePath = pathParts.join('/');
  return `${base.origin}${basePath}/${relativeUrl}`;
}

async function downloadPlaylistToSingleFile(playlistUrl, outputFilePath, cachePrefix, signal, headers, progressCallback, cookieJar = null) {
  let originHeader = null;
  const refVal = (headers && (headers.Referer || headers.referer)) || null;
  if (refVal) {
    try { originHeader = new URL(refVal).origin; } catch (e) {}
  }
  if (playlistUrl.includes('vibeshort.live') || playlistUrl.includes('volcengine')) {
    originHeader = 'https://www.vibeshort.live';
    if (headers) {
      headers.Referer = 'https://www.vibeshort.live/';
      delete headers.referer;
    }
  }

  const mergedHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
    ...(originHeader ? { 'Origin': originHeader } : {}),
    ...(headers || {})
  };

  let headerLines = [];
  for (const [key, value] of Object.entries(mergedHeaders)) {
    if (value) {
      headerLines.push(`${key}: ${value}`);
    }
  }
  
  if (cookieJar) {
    try {
      const cookies = cookieJar.getCookieStringSync(playlistUrl);
      if (cookies) {
        headerLines.push(`Cookie: ${cookies}`);
      }
    } catch (e) {}
  }

  const headerStr = headerLines.length > 0 ? headerLines.join('\r\n') + '\r\n' : '';
  
  const { spawn } = await import('child_process');
  
  return new Promise((resolve, reject) => {
    const activeProxy = getProxyUrl();
    const args = [
      '-y',
      '-loglevel', 'error',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5'
    ];
    
    if (activeProxy && shouldUseProxy(playlistUrl)) {
      args.push('-http_proxy', activeProxy);
    }
    
    if (headerStr) {
      args.push('-headers', headerStr);
    }
    
    let safeOutputFilePath = outputFilePath;
    if (safeOutputFilePath && !/\.(mp4|mkv|webm|avi|ts|mov|apk|zip|rar|7z|pdf|mp3)$/i.test(safeOutputFilePath)) {
      safeOutputFilePath = safeOutputFilePath.replace(/\.[a-zA-Z0-9]+$/, '') + '.mp4';
    }
    
    args.push('-i', playlistUrl, '-c', 'copy', '-movflags', '+faststart', safeOutputFilePath);
    
    console.log(`[HLS Downloader] Downloading using FFmpeg spawn...`);
    
    const env = { ...process.env };
    if (ffmpegPath !== 'ffmpeg') {
      const ffmpegDir = path.dirname(ffmpegPath);
      const separator = process.platform === 'win32' ? ';' : ':';
      env.PATH = `${ffmpegDir}${separator}${env.PATH || ''}`;
    }
    
    let settled = false;
    const done = (fn) => { if (!settled) { settled = true; fn(); } };

    const proc = spawn(ffmpegPath, args, { env });
    
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      console.error('[HLS Downloader] FFmpeg spawn error:', err.message);
      done(() => reject(new Error(`FFmpeg başlatılamadı: ${err.message}`)));
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log('[HLS Downloader] HLS stream successfully downloaded and merged by FFmpeg!');
        done(() => resolve());
      } else {
        const cleanStderr = stderr.trim();
        console.error(`[HLS Downloader] FFmpeg error (code ${code}):`, cleanStderr || 'No stderr details');
        done(() => reject(new Error(`FFmpeg indirme hatası (Kod ${code}): ${cleanStderr || 'Bilinmeyen hata'}`)));
      }
    });
    
    if (signal) {
      const onAbort = () => {
        try { proc.kill(); } catch {}
        done(() => reject(new Error("İndirme iptal edildi.")));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// Download a direct MP4/video file using streaming (no HLS parsing)
async function downloadDirectVideo(url, outputPath, signal, progressCallback, refererOverride, cookiesOverride = null, userAgentOverride = null, headersOverride = null) {
  // Referer'ı belirle
  let referer = null;
  if (url.includes('sibnet.ru')) {
    referer = 'https://video.sibnet.ru/';
  } else if (url.includes('animecix') || url.includes('ecchicix')) {
    referer = 'https://animecix.tv/';
  } else if (refererOverride) {
    referer = refererOverride;
  }

  if (url.includes('videooplayer')) {
    referer = null;
  }

  const safeUA = (typeof userAgentOverride === 'string' && userAgentOverride.trim()) ? userAgentOverride : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  const headers = {
    "User-Agent": safeUA,
    "Referer": referer || ""
  };

  if (headersOverride && typeof headersOverride === 'object') {
    Object.assign(headers, headersOverride);
  }

  if (cookiesOverride && typeof cookiesOverride === 'string') {
    headers["Cookie"] = cookiesOverride;
  } else if (cookiesOverride && typeof cookiesOverride === 'object' && cookiesOverride.cookies) {
    try {
      const parts = cookiesOverride.cookies.map(c => `${c.key || c.name}=${c.value}`);
      if (parts.length > 0) headers["Cookie"] = parts.join('; ');
    } catch (e) {}
  }

  const activeProxy = getProxyUrl();
  let proxyAgent = null;
  if (activeProxy && shouldUseProxy(url)) {
    proxyAgent = new HttpsProxyAgent(activeProxy);
  }

  const agentOpts = proxyAgent ? { httpsAgent: proxyAgent, httpAgent: proxyAgent } : {};
  const downloadStartTime = Date.now();
  const proxyTag = proxyAgent ? '[PROXY AKTİF]' : '[PROXY PASİF]';
  let lastConsoleLogTime = Date.now();

  // Try checking segmented download support (multi-connection bypasses throttling)
  let supportsRange = false;
  let totalBytes = 0;
  try {
    // HEAD isteğiyle Range desteği kontrol et (GET'ten çok daha hızlı)
    let headRes;
    try {
      headRes = await axios.head(url, { headers, timeout: 10000, maxRedirects: 5, ...agentOpts });
    } catch {
      // HEAD desteklenmiyorsa GET ile dene (sadece ilk 2 byte)
      headRes = await axios.get(url, { headers: { ...headers, Range: 'bytes=0-1' }, timeout: 10000, maxRedirects: 5, ...agentOpts });
    }
    totalBytes = parseInt(
      headRes.headers['content-range']?.split('/')?.[1] ||
      headRes.headers['content-length'] || '0',
      10
    );
    supportsRange = headRes.status === 206 || headRes.headers['accept-ranges'] === 'bytes';
    // content-length varsa ve büyükse segmented kullan (Range desteği olmasa bile dene)
    if (!supportsRange && totalBytes > 10 * 1024 * 1024) {
      supportsRange = true;
    }
  } catch (headErr) {
    console.log('[Segmented Downloader] Range check failed, falling back to standard sequential download:', headErr.message);
  }

  await checkAvailableDiskSpace(path.dirname(outputPath), totalBytes);

  if (supportsRange && totalBytes > 0) {
    console.log(`[İNDİRME BAŞLADI] ${proxyTag} Yöntem: Segmented (8 Parça) | Boyut: ${formatBytes(totalBytes)} | URL: ${url}`);
    const numConnections = 8;
    const chunkSize = Math.ceil(totalBytes / numConnections);
    const promises = [];
    const partFiles = [];
    const downloadedMap = new Map();

    try {
      for (let i = 0; i < numConnections; i++) {
        if (signal && signal.aborted) {
          throw new Error("İndirme iptal edildi.");
        }

        const start = i * chunkSize;
        const end = Math.min(start + chunkSize - 1, totalBytes - 1);
        const partPath = `${outputPath}.part${i}`;
        partFiles.push(partPath);
        downloadedMap.set(i, 0);

        const promise = (async () => {
          let lastErr;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              if (signal && signal.aborted) {
                throw new Error("İndirme iptal edildi.");
              }

              const res = await axios.get(url, {
                headers: {
                  ...headers,
                  'Range': `bytes=${start}-${end}`
                },
                responseType: 'stream',
                signal: signal || undefined,
                timeout: 25000,
                ...agentOpts
              });

              const writer = fs.createWriteStream(partPath);
              let streamEarlyError = null;
              const onEarlyErr = (err) => { streamEarlyError = err; };
              writer.on('error', onEarlyErr);
              res.data.on('error', onEarlyErr);
              res.data.pipe(writer);

              let lastProgressReportTime = 0;
              res.data.on('data', (chunk) => {
                const currentVal = downloadedMap.get(i) || 0;
                downloadedMap.set(i, currentVal + chunk.length);

                const now = Date.now();
                if (now - lastProgressReportTime > 500) {
                  lastProgressReportTime = now;
                  let totalDownloaded = 0;
                  for (let val of downloadedMap.values()) {
                    totalDownloaded += val;
                  }

                  if (progressCallback) {
                    progressCallback(totalDownloaded, totalBytes);
                  }
                }

                if (now - lastConsoleLogTime > 4000) {
                  lastConsoleLogTime = now;
                  let totalDownloaded = 0;
                  for (let val of downloadedMap.values()) {
                    totalDownloaded += val;
                  }
                  const percent = Math.min(100, Math.round((totalDownloaded / totalBytes) * 100));
                  const elapsedSec = (now - downloadStartTime) / 1000;
                  const speedBps = elapsedSec > 0 ? totalDownloaded / elapsedSec : 0;
                  const speedMBs = (speedBps / 1024 / 1024).toFixed(2);
                  const remBytes = totalBytes - totalDownloaded;
                  const etaSec = speedBps > 0 && remBytes > 0 ? Math.round(remBytes / speedBps) : 0;
                  const etaStr = etaSec > 60 ? `${Math.floor(etaSec / 60)}dk ${etaSec % 60}sn` : `${etaSec}sn`;

                  console.log(`[İNDİRME İLERLEME] %${percent} [${getProgressBar(percent)}] | ${formatBytes(totalDownloaded)} / ${formatBytes(totalBytes)} | Hız: ~${speedMBs} MB/s | Kalan: ${etaStr}`);
                }
              });

              await new Promise((resolve, reject) => {
                writer.removeListener('error', onEarlyErr);
                res.data.removeListener('error', onEarlyErr);
                if (streamEarlyError) {
                  try { writer.destroy(); } catch {}
                  return reject(streamEarlyError);
                }

                const onAbort = () => {
                  try { writer.destroy(); } catch {}
                  reject(new Error("İndirme iptal edildi."));
                };

                writer.on('finish', () => {
                  if (signal) signal.removeEventListener('abort', onAbort);
                  resolve();
                });

                const onError = (e) => {
                  if (signal) signal.removeEventListener('abort', onAbort);
                  try { writer.destroy(); } catch {}
                  reject(e);
                };

                writer.on('error', onError);
                res.data.on('error', onError);

                if (signal) {
                  signal.addEventListener('abort', onAbort);
                }
              });

              return; // success
            } catch (err) {
              lastErr = err;
              if (err.message === 'İndirme iptal edildi.') throw err;
              console.warn(`[Segmented Downloader] Parça #${i} indirme denemesi ${attempt}/3 başarısız: ${err.message}`);
              await new Promise(r => setTimeout(r, 2000));
            }
          }
          throw lastErr;
        })();

        promises.push(promise);
      }

      await Promise.all(promises);

      // Merge segments sequentially
      console.log('[Segmented Downloader] Parça dosyaları birleştiriliyor...');
      // Merge segments sequentially using low-level fd copy (prevents stream buffer race conditions)
      const finalFd = fs.openSync(outputPath, 'w');
      try {
        const buffer = Buffer.alloc(64 * 1024);
        for (const partPath of partFiles) {
          if (fs.existsSync(partPath)) {
            const partFd = fs.openSync(partPath, 'r');
            let bytesRead;
            do {
              bytesRead = fs.readSync(partFd, buffer, 0, buffer.length, null);
              if (bytesRead > 0) {
                fs.writeSync(finalFd, buffer, 0, bytesRead);
              }
            } while (bytesRead > 0);
            fs.closeSync(partFd);
            try { fs.unlinkSync(partPath); } catch (e) {}
          }
        }
      } finally {
        fs.closeSync(finalFd);
      }
      const durationSec = ((Date.now() - downloadStartTime) / 1000).toFixed(1);
      const avgSpeed = durationSec > 0 ? (totalBytes / 1024 / 1024 / durationSec).toFixed(2) : '0.00';
      console.log(`[İNDİRME TAMAMLANDI] Dosya: ${path.basename(outputPath)} | Boyut: ${formatBytes(totalBytes)} | Süre: ${durationSec}s | Ort. Hız: ~${avgSpeed} MB/s`);
      return;

    } catch (segmentedErr) {
      console.error('[Segmented Downloader] Segmented indirme başarısız oldu, tekli akışa geçiliyor:', segmentedErr.message);
      // Clean up temp files
      for (const partPath of partFiles) {
        try {
          if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
        } catch (e) {}
      }
      if (signal && signal.aborted) {
        throw segmentedErr;
      }
      // Fall through to sequential download fallback
    }
  }

  // Fallback sequential download
  console.log(`[İNDİRME BAŞLADI] ${proxyTag} Yöntem: Tekli Akış (Sequential) | URL: ${url}`);
  const partPath = `${outputPath}.part`;
  let existingSize = 0;
  if (fs.existsSync(partPath)) {
    existingSize = fs.statSync(partPath).size;
  }

  const reqHeaders = { ...headers };
  const isResuming = existingSize > 0 && supportsRange;
  if (isResuming) {
    reqHeaders['Range'] = `bytes=${existingSize}-`;
    console.log(`[Downloader] Kaldığı yerden devam ediliyor (Byte: ${existingSize})`);
  }

  const res = await axios.get(url, {
    headers: reqHeaders,
    responseType: 'stream',
    timeout: 60000,
    maxRedirects: 5,
    signal: signal || undefined,
    ...agentOpts
  });

  const contentType = (res.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new Error(`Geçersiz video kaynağı (Sunucu video dosyası yerine web sayfası veya metin döndürdü: ${contentType.split(';')[0]}).`);
  }

  const actualResuming = isResuming && res.status === 206;
  const writeFlags = actualResuming ? 'a' : 'w';
  if (!actualResuming) {
    existingSize = 0;
  }

  const contentLen = parseInt(res.headers['content-length'] || '0', 10) + existingSize;
  let downloaded = existingSize;

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(partPath, { flags: writeFlags });
    let settled = false;
    let streamTimer = null;

    const cleanup = () => {
      if (streamTimer) {
        clearTimeout(streamTimer);
        streamTimer = null;
      }
    };

    const resetTimeout = () => {
      cleanup();
      streamTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { writer.destroy(); } catch {}
          try { res.data.destroy(); } catch {}
          reject(new Error("İndirme zaman aşımına uğradı (60 saniye boyunca veri akışı sağlanamadı)."));
        }
      }, 60000);
    };

    resetTimeout();

    res.data.on('data', (chunk) => {
      resetTimeout();
      downloaded += chunk.length;
      const canWrite = writer.write(chunk);
      if (!canWrite) {
        res.data.pause();
        writer.once('drain', () => {
          res.data.resume();
        });
      }
      if (progressCallback) {
        if (contentLen > 0) {
          progressCallback(downloaded, contentLen);
        } else {
          progressCallback(downloaded, downloaded + 1);
        }
      }

      const now = Date.now();
      if (now - lastConsoleLogTime > 4000) {
        lastConsoleLogTime = now;
        const elapsedSec = (now - downloadStartTime) / 1000;
        const speedBps = elapsedSec > 0 ? downloaded / elapsedSec : 0;
        const speedMBs = (speedBps / 1024 / 1024).toFixed(2);
        if (contentLen > 0) {
          const percent = Math.min(100, Math.round((downloaded / contentLen) * 100));
          console.log(`[İNDİRME İLERLEME] %${percent} [${getProgressBar(percent)}] | ${formatBytes(downloaded)} / ${formatBytes(contentLen)} | Hız: ~${speedMBs} MB/s`);
        } else {
          console.log(`[İNDİRME İLERLEME] İndirilen: ${formatBytes(downloaded)} | Hız: ~${speedMBs} MB/s`);
        }
      }
    });

    res.data.on('end', () => {
      cleanup();
      writer.end();
    });

    writer.on('finish', () => {
      cleanup();
      if (settled) return;
      settled = true;
      try {
        fs.renameSync(partPath, outputPath);
        const durationSec = ((Date.now() - downloadStartTime) / 1000).toFixed(1);
        const avgSpeed = durationSec > 0 ? (downloaded / 1024 / 1024 / durationSec).toFixed(2) : '0.00';
        console.log(`[İNDİRME TAMAMLANDI] Dosya: ${path.basename(outputPath)} | Boyut: ${formatBytes(downloaded)} | Süre: ${durationSec}s | Ort. Hız: ~${avgSpeed} MB/s`);
        resolve();
      } catch (renameErr) {
        reject(renameErr);
      }
    });

    writer.on('error', (err) => {
      cleanup();
      if (settled) return;
      settled = true;
      try { writer.destroy(); } catch {}
      reject(err);
    });

    res.data.on('error', (err) => {
      cleanup();
      if (settled) return;
      settled = true;
      try { writer.destroy(); } catch {}
      reject(err);
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        cleanup();
        if (settled) return;
        settled = true;
        try { writer.destroy(); } catch {}
        try { res.data.destroy(); } catch {}
        reject(new Error("İndirme iptal edildi."));
      });
    }
  });
}

export async function downloadM3u8(m3u8Url, outputPath, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10) {
  let signal = null;
  let progressCallback = null;
  let refererOverride = null;
  let cookiesOverride = null;
  let userAgentOverride = null;
  let headersOverride = null;
  let audioPlaylistUrlOverride = null;
  let selectedAudioTrack = null;

  if (arg3 && typeof arg3 === 'function') {
    progressCallback = arg3;
    refererOverride = arg4 || null;
    cookiesOverride = arg5 || null;
    userAgentOverride = arg6 || null;
    headersOverride = arg7 || null;
    audioPlaylistUrlOverride = arg8 || null;
    selectedAudioTrack = arg9 || null;
  } else {
    signal = arg3;
    progressCallback = arg4;
    refererOverride = arg5 || null;
    cookiesOverride = arg6 || null;
    userAgentOverride = arg7 || null;
    headersOverride = arg8 || null;
    audioPlaylistUrlOverride = arg9 || null;
    selectedAudioTrack = arg10 || null;
  }

  if (signal && signal.aborted) {
    throw new Error("İndirme iptal edildi.");
  }

  if (outputPath && !/\.(mp4|mkv|webm|avi|ts|mov|apk|zip|rar|7z|pdf|mp3)$/i.test(outputPath)) {
    console.warn(`[Downloader] Output path has invalid video extension: ${outputPath}, enforcing .mp4`);
    outputPath = outputPath.replace(/\.[a-zA-Z0-9]+$/, '') + '.mp4';
  }

  if (m3u8Url && m3u8Url.includes('?url=http')) {
    try {
      const parsed = new URL(m3u8Url);
      const innerUrl = parsed.searchParams.get('url');
      if (innerUrl && (innerUrl.includes('.m3u8') || innerUrl.includes('.mp4') || innerUrl.includes('/vt/'))) {
        m3u8Url = decodeURIComponent(innerUrl);
        console.log(`[Downloader] Unwrapped embedded stream URL: ${m3u8Url}`);
      }
    } catch (e) {}
  }

  try {
    // Referer'ı belirle: override > URL domain tespiti > varsayılan
    let referer = 'https://www.hdfilmcehennemi.nl/';
    if (refererOverride) {
      referer = refererOverride;
    } else {
      try {
        const urlObj = new URL(m3u8Url);
        if (m3u8Url.includes('animecix') || m3u8Url.includes('ecchicix') || m3u8Url.includes('ancdn') || m3u8Url.includes('vd-1') || m3u8Url.includes('vd-2') || m3u8Url.includes('vd-3')) {
          referer = 'https://animecix.tv/';
        } else if (m3u8Url.includes('rapidrame') || m3u8Url.includes('hdfilmcehennemi')) {
          referer = 'https://www.hdfilmcehennemi.nl/';
        } else if (urlObj.hostname) {
          referer = `${urlObj.protocol}//${urlObj.hostname}/`;
        }
      } catch(e) {}
    }

    const headers = {};
    if (headersOverride && typeof headersOverride === 'object') {
      Object.assign(headers, headersOverride);
    }

    headers["Referer"] = referer;

    if (userAgentOverride) {
      headers["User-Agent"] = userAgentOverride;
    }

    let chromeVersion = 145;
    if (userAgentOverride && typeof userAgentOverride === 'string') {
      const chromeMatch = userAgentOverride.match(/Chrome\/(\d+)/);
      if (chromeMatch) {
        chromeVersion = parseInt(chromeMatch[1], 10);
      }
    }

    const headerGeneratorOptions = {
      devices: ['desktop'],
      locales: ['tr-TR', 'en-US'],
      operatingSystems: ['windows'],
      browsers: [
        {
          name: 'chrome',
          minVersion: chromeVersion,
          maxVersion: chromeVersion
        }
      ]
    };

    if (m3u8Url.includes('mega.nz')) {
      console.log('Mega.nz URL detected, streaming decrypted download...');
      await downloadMegaFile(m3u8Url, outputPath, signal, progressCallback);
      return;
    }

    // Eğer URL doğrudan .mp4 / .mkv / .webm veya sibnet veya cloud.mail.ru veya binary/document ise HLS parse etme, direkt indir
    const urlLower = m3u8Url.toLowerCase().split('?')[0];
    const isDirectBinaryFile = /\.(apk|zip|rar|7z|pdf|exe|tar|gz|mp3|wav|png|jpg|jpeg|gif)(\?.*)?$/i.test(urlLower);
    if (urlLower.endsWith('.mp4') || urlLower.endsWith('.mkv') || urlLower.endsWith('.webm') || urlLower.endsWith('.avi') || isDirectBinaryFile || m3u8Url.includes('sibnet.ru') || m3u8Url.includes('cloud.mail.ru') || m3u8Url.includes('cloclo')) {
      console.log('Direct download URL detected, streaming download...');
      await downloadDirectVideo(m3u8Url, outputPath, signal, progressCallback, refererOverride, cookiesOverride, userAgentOverride, headersOverride);
      return;
    }

    let cookieJar;
    if (cookiesOverride && typeof cookiesOverride === 'object') {
      try {
        const urlObj = new URL(m3u8Url);
        const targetHost = urlObj.hostname;
        if (cookiesOverride.cookies && Array.isArray(cookiesOverride.cookies)) {
          for (const c of cookiesOverride.cookies) {
            c.domain = targetHost;
            c.hostOnly = true;
          }
        }
        cookieJar = CookieJar.fromJSON(cookiesOverride);
      } catch (e) {
        cookieJar = new CookieJar();
      }
    } else {
      cookieJar = new CookieJar();
      if (cookiesOverride && typeof cookiesOverride === 'string') {
        const parts = cookiesOverride.split(';');
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          try {
            const cookie = Cookie.parse(trimmed);
            if (cookie) {
              cookieJar.setCookieSync(cookie, m3u8Url);
            }
          } catch(e) {}
        }
      }
    }

    // 1. Fetch the playlist (only fetch first 10KB to see if it starts with #EXTM3U)KB to see if it starts with #EXTM3U)
    let res;
    try {
      res = await gotScraping.get({
        url: m3u8Url,
        headers: {
          ...headers,
          'Range': 'bytes=0-10240'
        },
        cookieJar,
        headerGeneratorOptions,
        signal: signal || undefined,
        responseType: 'text',
        timeout: { request: 15000 }
      });
    } catch(err) {
      // Fallback: if server doesn't support range requests, do normal fetch
      try {
        res = await gotScraping.get({
          url: m3u8Url,
          headers,
          cookieJar,
          headerGeneratorOptions,
          signal: signal || undefined,
          responseType: 'text',
          timeout: { request: 15000 }
        });
      } catch (innerErr) {
        throw innerErr;
      }
    }
    let content = typeof res.body === 'string' ? res.body : res.body.toString('utf8');

    // If it starts with EXTM3U but was partial, fetch the full content
    if (content.includes('#EXTM3U') && res.statusCode === 206) {
      try {
        const fullRes = await gotScraping.get({
          url: m3u8Url,
          headers,
          cookieJar,
          headerGeneratorOptions,
          signal: signal || undefined,
          responseType: 'text',
          timeout: { request: 15000 }
        });
        content = typeof fullRes.body === 'string' ? fullRes.body : fullRes.body.toString('utf8');
      } catch(e) {}
    }

    // İçerik M3U8 playlist değilse (binary veya HTML geldi), direkt stream indir
    if (!content.includes('#EXTM3U') && !content.includes('#EXT-X-')) {
      const lower = content.toLowerCase();
      if (lower.includes('<html') || lower.includes('<!doctype') || lower.includes('just a moment') || lower.includes('cf-browser-verification')) {
        throw new Error("M3U8 linki geçersiz: Video oynatma listesi yerine web sayfası (HTML) döndü.");
      }
      console.log('Response is not an M3U8 playlist, falling back to direct stream download...');
      await downloadDirectVideo(m3u8Url, outputPath, signal, progressCallback, referer, cookiesOverride, userAgentOverride);
      return;
    }

    let targetPlaylistUrl = m3u8Url;
    let audioPlaylistUrl = audioPlaylistUrlOverride || null;
    let muxMode = 'dual';

    // Check if it's a master playlist
    if (content.includes('#EXT-X-STREAM-INF')) {
      const lines = content.split('\n');
      let bestStreamUrl = '';
      let maxBandwidth = 0;

      const audioTracks = [];
      for (const line of lines) {
        if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
          const langMatch = line.match(/LANGUAGE="([^"]+)"/i);
          const nameMatch = line.match(/NAME="([^"]+)"/i);
          const uriMatch = line.match(/URI="([^"]+)"/i);
          if (uriMatch) {
            const val = uriMatch[1];
            const resolved = resolveUrl(m3u8Url, val);
            const lang = (langMatch ? langMatch[1] : '').toLowerCase();
            const name = (nameMatch ? nameMatch[1] : '').toLowerCase();
            audioTracks.push({ uri: resolved, lang, name, raw: line });
          }
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF')) {
          const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
          const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;
          
          // Get next line which contains the URI
          let nextLine = '';
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim() && !lines[j].trim().startsWith('#')) {
              nextLine = lines[j].trim();
              break;
            }
          }

          if (nextLine && bandwidth > maxBandwidth) {
            maxBandwidth = bandwidth;
            bestStreamUrl = nextLine;
          }
        }
      }

      const sAudio = (selectedAudioTrack || '').toLowerCase();

      if (sAudio === 'tr' || sAudio === 'dublaj') {
        console.log('[Downloader] Audio preference: Türkçe Dublaj');
        if (bestStreamUrl.includes('-a2.')) {
          bestStreamUrl = bestStreamUrl.replace('-a2.', '-a1.');
        }
        const trTrack = audioTracks.find(t => t.lang.startsWith('tr') || t.name.includes('turk') || t.name.includes('türk'));
        if (trTrack && !bestStreamUrl.includes('-a1')) {
          audioPlaylistUrl = trTrack.uri;
          muxMode = 'replace_audio';
        } else {
          audioPlaylistUrl = null; // -a1 already includes Turkish audio
        }
      } else if (sAudio === 'orig' || sAudio === 'en' || sAudio === 'altyazi') {
        console.log('[Downloader] Audio preference: Orijinal / Altyazılı');
        if (bestStreamUrl.includes('-a1.')) {
          bestStreamUrl = bestStreamUrl.replace('-a1.', '-a2.');
        }
        const origTrack = audioTracks.find(t => t.lang.startsWith('en') || t.name.includes('eng') || t.name.includes('orig')) || audioTracks.find(t => !t.lang.startsWith('tr') && !t.name.toLowerCase().includes('türk') && !t.name.toLowerCase().includes('turk'));
        if (origTrack && !bestStreamUrl.includes('-a2')) {
          audioPlaylistUrl = origTrack.uri;
          muxMode = 'replace_audio';
        } else {
          audioPlaylistUrl = null;
        }
      } else if (sAudio === 'dual') {
        console.log('[Downloader] Audio preference: DUAL (Çift Ses)');
        muxMode = 'dual';
        if (!audioPlaylistUrl && audioTracks.length > 1) {
          const secondTrack = audioTracks.find(t => t.lang.startsWith('en') || t.name.includes('eng') || t.name.includes('orig')) || audioTracks.find(t => !t.lang.startsWith('tr') && !t.name.toLowerCase().includes('türk') && !t.name.toLowerCase().includes('turk')) || audioTracks[1];
          if (secondTrack) {
            audioPlaylistUrl = secondTrack.uri;
          }
        }
      } else {
        // Default behavior if no preference specified
        if (!audioPlaylistUrl && audioTracks.length > 0) {
          const trTrack = audioTracks.find(t => t.lang.startsWith('tr') || t.name.includes('turk') || t.name.includes('türk'));
          if (trTrack) {
            audioPlaylistUrl = trTrack.uri;
          } else {
            audioPlaylistUrl = audioTracks[0].uri;
          }
        }
      }

      if (bestStreamUrl) {
        targetPlaylistUrl = resolveUrl(m3u8Url, bestStreamUrl);
      }
    }

    if (audioPlaylistUrl) {
      console.log(`Performing audio/video dual stream download (mode: ${muxMode})...`);
      const tempVideoFile = outputPath.replace(/\.[a-zA-Z0-9]+$/, '_video.ts');
      const tempAudioFile = outputPath.replace(/\.[a-zA-Z0-9]+$/, '_audio.ts');

      // 1. Download Video stream (represent 0-50% in progress updates)
      await downloadPlaylistToSingleFile(targetPlaylistUrl, tempVideoFile, 'video', signal, headers, (completed, total) => {
        if (progressCallback) {
          progressCallback(Math.round((completed / total) * 50), 100);
        }
      }, cookieJar);

      // 2. Download Secondary Audio stream (represent 50-100% in progress updates)
      await downloadPlaylistToSingleFile(audioPlaylistUrl, tempAudioFile, 'audio', signal, headers, (completed, total) => {
        if (progressCallback) {
          progressCallback(50 + Math.round((completed / total) * 50), 100);
        }
      }, cookieJar);

      const ffmpegMap = muxMode === 'replace_audio'
        ? '-map 0:v -map 1:a'
        : '-map 0:v -map 0:a? -map 1:a';

      console.log(`Merging audio and video via FFmpeg (${ffmpegMap} + faststart + mp42)...`);
      await new Promise((resolve) => {
        exec(`"${ffmpegPath}" -y -i "${tempVideoFile}" -i "${tempAudioFile}" ${ffmpegMap} -c:v copy -c:a copy -bsf:a aac_adtstoasc -movflags +faststart -brand mp42 "${outputPath}"`, (err, stdout, stderr) => {
          if (err) {
            console.error("FFmpeg merge failed. Falling back to default video stream:", err.message);
            try {
              if (fs.existsSync(tempVideoFile)) {
                // If tempVideoFile is .ts, remux to mp4 with faststart and standard aac rather than raw rename
                exec(`"${ffmpegPath}" -y -i "${tempVideoFile}" -c:v copy -c:a aac -movflags +faststart -brand mp42 "${outputPath}"`, (remuxErr) => {
                  if (remuxErr && fs.existsSync(tempVideoFile)) {
                    fs.renameSync(tempVideoFile, outputPath);
                  }
                  if (fs.existsSync(tempAudioFile)) fs.unlinkSync(tempAudioFile);
                  resolve();
                });
                return;
              }
              if (fs.existsSync(tempAudioFile)) fs.unlinkSync(tempAudioFile);
            } catch (fallbackErr) {
              console.error("Fallback file operations failed:", fallbackErr.message);
            }
            resolve();
          } else {
            console.log("FFmpeg merge completed successfully!");
            try {
              if (fs.existsSync(tempVideoFile)) fs.unlinkSync(tempVideoFile);
              if (fs.existsSync(tempAudioFile)) fs.unlinkSync(tempAudioFile);
            } catch (cleanupErr) {}
            resolve();
          }
        });
      });
    } else {
      // Single track download (e.g. Animecix or non-dual content)
      await downloadPlaylistToSingleFile(targetPlaylistUrl, outputPath, 'single', signal, headers, progressCallback, cookieJar);
    }

  } catch (err) {
    throw new Error(`M3U8 download failed: ${err.message}`);
  }
}

async function downloadMegaFile(megaUrl, outputPath, signal, progressCallback) {
  const file = File.fromURL(megaUrl);
  await file.loadAttributes();
  const fileStream = file.download();
  const writeStream = fs.createWriteStream(outputPath);
  
  let completed = 0;
  const total = file.size || 0;
  
  return new Promise((resolve, reject) => {
    if (signal) {
      const abortHandler = () => {
        fileStream.destroy();
        writeStream.destroy();
        reject(new Error("İndirme iptal edildi."));
      };
      signal.addEventListener('abort', abortHandler);
    }

    fileStream.on('data', (chunk) => {
      completed += chunk.length;
      if (progressCallback) {
        progressCallback(completed, total);
      }
    });

    fileStream.on('error', (err) => {
      writeStream.destroy();
      reject(err);
    });

    writeStream.on('finish', () => {
      resolve();
    });

    writeStream.on('error', (err) => {
      reject(err);
    });

    fileStream.pipe(writeStream);
  });
}
