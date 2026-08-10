import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { exec } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { gotScraping as originalGotScraping } from 'got-scraping';
import { CookieJar, Cookie } from 'tough-cookie';

const gotScraping = new Proxy(originalGotScraping, {
  apply(target, thisArg, argumentsList) {
    const options = argumentsList[0] || {};
    if (typeof options === 'object' && process.env.PROXY_URL) {
      options.proxyUrl = process.env.PROXY_URL;
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
        if (process.env.PROXY_URL) {
          opt.proxyUrl = process.env.PROXY_URL;
        }
        return originalGotScraping[prop](opt);
      };
    }
    return Reflect.get(target, prop, receiver);
  }
});

// Configure Axios defaults proxy if PROXY_URL is set
if (process.env.PROXY_URL) {
  try {
    const parsed = new URL(process.env.PROXY_URL);
    axios.defaults.proxy = {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: parseInt(parsed.port, 10)
    };
    if (parsed.username || parsed.password) {
      axios.defaults.proxy.auth = {
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password)
      };
    }
    console.log(`[Proxy] Axios default proxy configured: ${parsed.hostname}:${parsed.port}`);
  } catch (e) {
    console.error(`[Proxy] Axios proxy config error:`, e.message);
  }
}


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
  let chromeVersion = 145;
  if (headers && headers["User-Agent"]) {
    const chromeMatch = headers["User-Agent"].match(/Chrome\/(\d+)/);
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

  // Fetch stream playlist
  const res = await gotScraping.get({
    url: playlistUrl,
    headers,
    cookieJar: cookieJar || undefined,
    headerGeneratorOptions,
    signal: signal || undefined,
    responseType: 'text',
    timeout: { request: 15000 }
  });
  const content = typeof res.body === 'string' ? res.body : res.body.toString('utf8');
  
  const segmentUrls = [];
  const lines = content.split('\n');
  for (let line of lines) {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      segmentUrls.push(resolveUrl(playlistUrl, line));
    }
  }

  if (segmentUrls.length === 0) {
    throw new Error("No segments found in HLS stream.");
  }

  const urlHash = crypto.createHash('md5').update(playlistUrl).digest('hex');
  const cacheDir = path.resolve(`./.hdwp_cache_${cachePrefix}_${urlHash}`);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  let completed = 0;
  const concurrency = 8;
  let activeDownloads = 0;

  const pendingSegmentIndexes = [];
  for (let i = 0; i < segmentUrls.length; i++) {
    const segmentPath = path.join(cacheDir, `segment_${i}.ts`);
    if (fs.existsSync(segmentPath) && fs.statSync(segmentPath).size > 0) {
      completed++;
    } else {
      pendingSegmentIndexes.push(i);
    }
  }

  if (completed > 0 && progressCallback) {
    progressCallback(completed, segmentUrls.length);
  }

  if (completed < segmentUrls.length) {
    await new Promise((resolve, reject) => {
      const downloadSegment = async (index) => {
        if (signal && signal.aborted) return;
        const url = segmentUrls[index];
        const segmentPath = path.join(cacheDir, `segment_${index}.ts`);
        let attempts = 5;

        while (attempts > 0) {
          if (signal && signal.aborted) return;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            if (signal) {
              signal.addEventListener('abort', () => controller.abort(), { once: true });
            }

            // Segment indirme için her zaman axios kullan (gotScraping'den çok daha hızlı)
            const reqHeaders = { ...(headers || {}) };
            if (cookieJar) {
              const cookieString = cookieJar.getCookieStringSync(url);
              if (cookieString) reqHeaders['Cookie'] = cookieString;
            }
            const segRes = await axios.get(url, {
              headers: Object.keys(reqHeaders).length > 0 ? reqHeaders : undefined,
              responseType: 'arraybuffer',
              signal: controller.signal,
              timeout: 15000
            });
            const segData = Buffer.from(segRes.data);
            clearTimeout(timeoutId);
            
            fs.writeFileSync(segmentPath, segData);
            completed++;
            if (progressCallback) {
              progressCallback(completed, segmentUrls.length);
            }
            break;
          } catch (e) {
            attempts--;
            if (attempts === 0) {
              reject(new Error(`Segment ${index} indirme hatası: ${e.message}`));
              return;
            }
            const isRateLimit = e.response && e.response.status === 429;
            const waitTime = isRateLimit ? 2000 : 100;
            await new Promise(r => setTimeout(r, waitTime));
          }
        }

        activeDownloads--;
        pump();
      };

      const pump = () => {
        if (signal && signal.aborted) return;
        if (completed === segmentUrls.length) {
          if (activeDownloads === 0) {
            resolve();
          }
          return;
        }
        if (pendingSegmentIndexes.length === 0 && activeDownloads === 0) {
          resolve();
          return;
        }
        while (activeDownloads < concurrency && pendingSegmentIndexes.length > 0) {
          const index = pendingSegmentIndexes.shift();
          activeDownloads++;
          downloadSegment(index);
        }
      };

      if (signal) {
        signal.addEventListener('abort', () => {
          reject(new Error("İndirme iptal edildi."));
        });
      }

      pump();
    });
  }

  // Stitch — async stream pipeline (event loop'u bloke etmez)
  const fileStream = fs.createWriteStream(outputFilePath);
  await new Promise(async (resolve, reject) => {
    fileStream.on('error', reject);
    for (let i = 0; i < segmentUrls.length; i++) {
      const segmentPath = path.join(cacheDir, `segment_${i}.ts`);
      await new Promise((res, rej) => {
        const readStream = fs.createReadStream(segmentPath);
        readStream.on('error', rej);
        readStream.on('end', res);
        readStream.pipe(fileStream, { end: false });
      });
    }
    fileStream.end();
    fileStream.on('finish', resolve);
  });

  // Clean cache
  try {
    for (let i = 0; i < segmentUrls.length; i++) {
      const segmentPath = path.join(cacheDir, `segment_${i}.ts`);
      if (fs.existsSync(segmentPath)) {
        fs.unlinkSync(segmentPath);
      }
    }
    fs.rmdirSync(cacheDir);
  } catch (e) {}
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
          const res = await axios.get(url, {
            headers: {
              ...headers,
              'Range': `bytes=${start}-${end}`
            },
            responseType: 'stream',
            signal: signal || undefined,
            timeout: 20000
          });

          const writer = fs.createWriteStream(partPath);
          res.data.pipe(writer);

          res.data.on('data', (chunk) => {
            const currentVal = downloadedMap.get(i) || 0;
            downloadedMap.set(i, currentVal + chunk.length);

            // Compute total progress
            let totalDownloaded = 0;
            for (let val of downloadedMap.values()) {
              totalDownloaded += val;
            }

            if (progressCallback) {
              progressCallback(totalDownloaded, totalBytes);
            }
          });

          return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
            res.data.on('error', reject);
            if (signal) {
              signal.addEventListener('abort', () => {
                writer.destroy();
                reject(new Error("İndirme iptal edildi."));
              });
            }
          });
        })();

        promises.push(promise);
      }

      await Promise.all(promises);

      // Merge segments sequentially
      console.log('[Segmented Downloader] Merging part files...');
      const finalWriter = fs.createWriteStream(outputPath);
      await new Promise(async (resolve, reject) => {
        finalWriter.on('error', reject);
        try {
          for (const partPath of partFiles) {
            if (fs.existsSync(partPath)) {
              await new Promise((res, rej) => {
                const readStream = fs.createReadStream(partPath);
                readStream.on('error', rej);
                readStream.on('end', () => {
                  try { fs.unlinkSync(partPath); } catch (e) {}
                  res();
                });
                readStream.pipe(finalWriter, { end: false });
              });
            }
          }
          finalWriter.end();
          finalWriter.on('finish', resolve);
        } catch (e) {
          reject(e);
        }
      });
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
  const res = await axios.get(url, {
    headers,
    responseType: 'stream',
    // Stream indirmede timeout yok — büyük dosyaları kesmez
    // Bağlantı başlamazsa signal ile iptal edilir
    timeout: 0,
    maxRedirects: 5,
    signal: signal || undefined
  });

  const contentLen = parseInt(res.headers['content-length'] || '0', 10);
  let downloaded = 0;
  const seqStart = Date.now();

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);

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
          // Bilinen boyut: bytes cinsinden ilerle
          progressCallback(downloaded, contentLen);
        } else {
          // Bilinmeyen boyut: indirilen byte'ı negatif total ile gönder (pipeline bunu yakalar)
          // downloaded bytes gönder, total = downloaded+1 ile %99'da kal
          progressCallback(downloaded, downloaded + 1);
        }
      }
    });

    writer.on('finish', resolve);
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

export async function downloadM3u8(m3u8Url, outputPath, arg3, arg4, arg5, arg6, arg7, arg8) {
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

    // Eğer URL doğrudan .mp4 / .mkv / .webm veya sibnet veya cloud.mail.ru ise HLS parse etme, direkt indir
    const urlLower = m3u8Url.toLowerCase().split('?')[0];
    if (urlLower.endsWith('.mp4') || urlLower.endsWith('.mkv') || urlLower.endsWith('.webm') || urlLower.endsWith('.avi') || m3u8Url.includes('sibnet.ru') || m3u8Url.includes('cloud.mail.ru') || m3u8Url.includes('cloclo')) {
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

    // 1. Fetch the playlist
    let res;
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
    } catch(err) {
      throw err;
    }
    const content = typeof res.body === 'string' ? res.body : res.body.toString('utf8');

    // İçerik M3U8 playlist değilse (binary veya HTML geldi), direkt stream indir
    if (!content.includes('#EXTM3U') && !content.includes('#EXT-X-')) {
      console.log('Response is not an M3U8 playlist, falling back to direct stream download...');
      await downloadDirectVideo(m3u8Url, outputPath, signal, progressCallback, referer, cookiesOverride, userAgentOverride);
      return;
    }

    let targetPlaylistUrl = m3u8Url;
    let audioPlaylistUrl = null;

    // Check if it's a master playlist
    if (content.includes('#EXT-X-STREAM-INF')) {
      const lines = content.split('\n');
      let bestStreamUrl = '';
      let maxBandwidth = 0;

      // Extract Turkish audio playlist URL
      for (const line of lines) {
        if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
          const langMatch = line.match(/LANGUAGE="([^"]+)"/i);
          const uriMatch = line.match(/URI="([^"]+)"/i);
          if (langMatch && uriMatch && langMatch[1].toLowerCase() === 'tr') {
            audioPlaylistUrl = resolveUrl(m3u8Url, uriMatch[1]);
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

      // 3. Mux them together using FFmpeg
      console.log("Merging audio and video via FFmpeg...");
      await new Promise((resolve) => {
        exec(`"${ffmpegPath}" -y -i "${tempVideoFile}" -i "${tempAudioFile}" -map 0:v -map 1:a -c:v copy -c:a copy "${outputPath}"`, (err, stdout, stderr) => {
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
