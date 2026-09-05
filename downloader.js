import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { File } from 'megajs';
import { exec, execSync } from 'child_process';
import ffmpegStaticPath from 'ffmpeg-static';

let ffmpegPath = ffmpegStaticPath;
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ffmpegPath = 'ffmpeg';
} catch (e) {
  ffmpegPath = ffmpegStaticPath;
}

import { gotScraping as originalGotScraping } from 'got-scraping';
import { CookieJar, Cookie } from 'tough-cookie';
import { getProxyUrl } from './config.js';

function shouldUseProxy(url) {
  if (!url) return false;
  const lowerUrl = String(url).toLowerCase();
  return lowerUrl.includes('pornhub.com') ||
         lowerUrl.includes('phncdn.com') ||
         lowerUrl.includes('turkifsahub.com') ||
         lowerUrl.includes('turkifsalar') ||
         lowerUrl.includes('turkporno');
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
    
    args.push('-i', playlistUrl, '-c', 'copy', '-movflags', '+faststart', outputFilePath);
    
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
async function downloadDirectVideo(url, outputPath, signal, progressCallback, refererOverride, cookiesOverride = null, userAgentOverride = null) {
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

  const headers = {
    "User-Agent": userAgentOverride || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer": referer || ""
  };

  if (cookiesOverride) {
    headers["Cookie"] = cookiesOverride;
  }

  // Try checking segmented download support (multi-connection bypasses throttling)
  let supportsRange = false;
  let totalBytes = 0;
  try {
    // HEAD isteğiyle Range desteği kontrol et (GET'ten çok daha hızlı)
    let headRes;
    try {
      headRes = await axios.head(url, { headers, timeout: 10000, maxRedirects: 5 });
    } catch {
      // HEAD desteklenmiyorsa GET ile dene (sadece ilk 2 byte)
      headRes = await axios.get(url, { headers: { ...headers, Range: 'bytes=0-1' }, timeout: 10000, maxRedirects: 5 });
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

  if (supportsRange && totalBytes > 0) {
    console.log(`[Segmented Downloader] Starting chunked download: ${totalBytes} bytes (~${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
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
                timeout: 25000
              });

              const writer = fs.createWriteStream(partPath);
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
              });

              await new Promise((resolve, reject) => {
                const onAbort = () => {
                  writer.destroy();
                  reject(new Error("İndirme iptal edildi."));
                };

                writer.on('finish', () => {
                  if (signal) signal.removeEventListener('abort', onAbort);
                  resolve();
                });

                const onError = (e) => {
                  if (signal) signal.removeEventListener('abort', onAbort);
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
              console.warn(`[Segmented Downloader] Chunk #${i} download failed (Attempt ${attempt}/3): ${err.message}`);
              await new Promise(r => setTimeout(r, 2000));
            }
          }
          throw lastErr;
        })();

        promises.push(promise);
      }

      await Promise.all(promises);

      // Merge segments sequentially
      console.log('[Segmented Downloader] Merging part files...');
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
      console.log('[Segmented Downloader] Download and merge completed successfully!');
      return;

    } catch (segmentedErr) {
      console.error('[Segmented Downloader] Segmented download failed, cleaning up parts and trying sequential fallback:', segmentedErr.message);
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
  console.log('[Downloader] Running sequential stream download...');
  const partPath = `${outputPath}.part`;
  let existingSize = 0;
  if (fs.existsSync(partPath)) {
    existingSize = fs.statSync(partPath).size;
  }

  const reqHeaders = { ...headers };
  const isResuming = existingSize > 0 && supportsRange;
  if (isResuming) {
    reqHeaders['Range'] = `bytes=${existingSize}-`;
    console.log(`[Downloader] Resuming download from byte: ${existingSize}`);
  }

  const res = await axios.get(url, {
    headers: reqHeaders,
    responseType: 'stream',
    timeout: 0,
    maxRedirects: 5,
    signal: signal || undefined
  });

  const actualResuming = isResuming && res.status === 206;
  const writeFlags = actualResuming ? 'a' : 'w';
  if (!actualResuming) {
    existingSize = 0;
  }

  const contentLen = parseInt(res.headers['content-length'] || '0', 10) + existingSize;
  let downloaded = existingSize;

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(partPath, { flags: writeFlags });

    res.data.on('data', (chunk) => {
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
    });

    writer.on('finish', () => {
      try {
        fs.renameSync(partPath, outputPath);
        resolve();
      } catch (renameErr) {
        reject(renameErr);
      }
    });
    writer.on('error', (err) => {
      writer.destroy();
      reject(err);
    });
    res.data.on('error', (err) => {
      writer.destroy();
      reject(err);
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        writer.destroy();
        reject(new Error("İndirme iptal edildi."));
      });
    }
  });
}

export async function downloadM3u8(m3u8Url, outputPath, arg3, arg4, arg5, arg6, arg7, arg8, audioPlaylistUrlOverride = null) {
  let signal = null;
  let progressCallback = null;
  let refererOverride = null;
  let cookiesOverride = null;
  let userAgentOverride = null;
  let headersOverride = null;

  if (arg3 && typeof arg3 === 'function') {
    progressCallback = arg3;
    refererOverride = arg4 || null;
    cookiesOverride = arg5 || null;
    userAgentOverride = arg6 || null;
    headersOverride = arg7 || null;
  } else {
    signal = arg3;
    progressCallback = arg4;
    refererOverride = arg5 || null;
    cookiesOverride = arg6 || null;
    userAgentOverride = arg7 || null;
    headersOverride = arg8 || null;
  }

  if (signal && signal.aborted) {
    throw new Error("İndirme iptal edildi.");
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
    if (userAgentOverride) {
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
      await downloadDirectVideo(m3u8Url, outputPath, signal, progressCallback, refererOverride, cookiesOverride, userAgentOverride);
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
      console.log('Response is not an M3U8 playlist, falling back to direct stream download...');
      await downloadDirectVideo(m3u8Url, outputPath, signal, progressCallback, referer, cookiesOverride, userAgentOverride);
      return;
    }

    let targetPlaylistUrl = m3u8Url;
    let audioPlaylistUrl = audioPlaylistUrlOverride || null;

    // Check if it's a master playlist
    if (content.includes('#EXT-X-STREAM-INF')) {
      const lines = content.split('\n');
      let bestStreamUrl = '';
      let maxBandwidth = 0;

      let firstAudioPlaylistUrl = null;
      // Extract Turkish audio playlist URL
      for (const line of lines) {
        if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
          const langMatch = line.match(/LANGUAGE="([^"]+)"/i);
          const nameMatch = line.match(/NAME="([^"]+)"/i);
          const uriMatch = line.match(/URI="([^"]+)"/i);
          if (uriMatch) {
            const val = uriMatch[1];
            const resolved = resolveUrl(m3u8Url, val);
            if (!firstAudioPlaylistUrl) {
              firstAudioPlaylistUrl = resolved;
            }
            const langValue = (langMatch ? langMatch[1] : (nameMatch ? nameMatch[1] : '')).toLowerCase();
            if (langValue === 'tr' || langValue === 'tr-tr' || langValue.startsWith('tr') || langValue === 'tur' || langValue === 'turkish') {
              audioPlaylistUrl = resolved;
            }
          }
        }
      }
      if (!audioPlaylistUrl && firstAudioPlaylistUrl) {
        console.log("No Turkish audio track found, falling back to first audio track:", firstAudioPlaylistUrl);
        audioPlaylistUrl = firstAudioPlaylistUrl;
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

      if (bestStreamUrl) {
        targetPlaylistUrl = resolveUrl(m3u8Url, bestStreamUrl);
      }
    }

    if (audioPlaylistUrl) {
      console.log("Separate Turkish audio track detected. Performing dual HLS stream download...");
      const tempVideoFile = outputPath.replace('.zip', '_video.ts').replace('.mp4', '_video.ts');
      const tempAudioFile = outputPath.replace('.zip', '_audio.ts').replace('.mp4', '_audio.ts');

      // 1. Download Video stream (represent 0-50% in progress updates)
      await downloadPlaylistToSingleFile(targetPlaylistUrl, tempVideoFile, 'video', signal, headers, (completed, total) => {
        if (progressCallback) {
          progressCallback(Math.round((completed / total) * 50), 100);
        }
      }, cookieJar);

      // 2. Download Turkish Audio stream (represent 50-100% in progress updates)
      await downloadPlaylistToSingleFile(audioPlaylistUrl, tempAudioFile, 'audio', signal, headers, (completed, total) => {
        if (progressCallback) {
          progressCallback(50 + Math.round((completed / total) * 50), 100);
        }
      }, cookieJar);

      console.log("Merging audio and video via FFmpeg (Dual audio mapping)...");
      await new Promise((resolve) => {
        exec(`"${ffmpegPath}" -y -i "${tempVideoFile}" -i "${tempAudioFile}" -map 0:v -map 0:a? -map 1:a -c:v copy -c:a copy "${outputPath}"`, (err, stdout, stderr) => {
          if (err) {
            console.error("FFmpeg merge failed. Falling back to default video stream (English):", err.message);
            try {
              if (fs.existsSync(tempVideoFile)) {
                fs.renameSync(tempVideoFile, outputPath); // Keep video with English audio as fallback
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
