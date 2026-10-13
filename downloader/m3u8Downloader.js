import fs from 'fs';
import path from 'path';
import { exec, execSync } from 'child_process';
import ffmpegStaticPath from 'ffmpeg-static';
import { CookieJar, Cookie } from 'tough-cookie';
import { getProxyUrl } from '../config.js';
import { checkAvailableDiskSpace, shouldUseProxy, gotScraping, resolveUrl } from './utils.js';
import { downloadMegaFile } from './megaDownloader.js';
import { downloadDirectVideo } from './directDownloader.js';
import { getModuleLogger } from '../utils/logger.js';

const logger = getModuleLogger('downloader-m3u8');

let ffmpegPath = ffmpegStaticPath;
try {
  const checkCmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg 2>/dev/null';
  const sysFfmpeg = execSync(checkCmd, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim().split(/[\r\n]+/)[0];
  if (sysFfmpeg && fs.existsSync(sysFfmpeg)) {
    ffmpegPath = sysFfmpeg;
  }
} catch (e) {
  ffmpegPath = ffmpegStaticPath;
}

export async function downloadPlaylistToSingleFile(playlistUrl, outputFilePath, cachePrefix, signal, headers, progressCallback, cookieJar = null) {
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
      '-threads', '0',
      '-reconnect', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-rw_timeout', '15000000'
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
    
    args.push('-i', playlistUrl, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', safeOutputFilePath);
    
    logger.info('[HLS Downloader] Downloading using FFmpeg spawn...');
    
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
      logger.error({ err: err.message }, '[HLS Downloader] FFmpeg spawn error');
      done(() => reject(new Error(`FFmpeg başlatılamadı: ${err.message}`)));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        logger.info('[HLS Downloader] HLS stream successfully downloaded and merged by FFmpeg!');
        done(() => resolve());
      } else {
        const cleanStderr = stderr.trim();
        logger.error({ code, stderr: cleanStderr }, '[HLS Downloader] FFmpeg error');
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
    logger.warn(`[Downloader] Output path has invalid video extension: ${outputPath}, enforcing .mp4`);
    outputPath = outputPath.replace(/\.[a-zA-Z0-9]+$/, '') + '.mp4';
  }

  if (m3u8Url && m3u8Url.includes('?url=http')) {
    try {
      const parsed = new URL(m3u8Url);
      const innerUrl = parsed.searchParams.get('url');
      if (innerUrl && (innerUrl.includes('.m3u8') || innerUrl.includes('.mp4') || innerUrl.includes('/vt/'))) {
        m3u8Url = decodeURIComponent(innerUrl);
        logger.info(`[Downloader] Unwrapped embedded stream URL: ${m3u8Url}`);
      }
    } catch (e) {}
  }

  try {
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
      logger.info('Mega.nz URL detected, streaming decrypted download...');
      await downloadMegaFile(m3u8Url, outputPath, signal, progressCallback);
      return;
    }

    const urlLower = m3u8Url.toLowerCase().split('?')[0];
    const isDirectBinaryFile = /\.(apk|zip|rar|7z|pdf|exe|tar|gz|mp3|wav|png|jpg|jpeg|gif)(\?.*)?$/i.test(urlLower);
    if (urlLower.endsWith('.mp4') || urlLower.endsWith('.mkv') || urlLower.endsWith('.webm') || urlLower.endsWith('.avi') || isDirectBinaryFile || m3u8Url.includes('sibnet.ru') || m3u8Url.includes('cloud.mail.ru') || m3u8Url.includes('cloclo')) {
      logger.info('Direct download URL detected, streaming download...');
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
      } catch (e) {}
    }

    let targetPlaylistUrl = m3u8Url;
    let audioPlaylistUrl = audioPlaylistUrlOverride || null;

    if (content.includes('#EXT-X-STREAM-INF')) {
      const lines = content.split('\n');
      const audioTracks = [];
      let currentBandwidth = 0;
      let currentResolution = '';
      let bestBandwidth = -1;
      let bestStreamUrl = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
          const groupMatch = line.match(/GROUP-ID="([^"]+)"/i);
          const nameMatch = line.match(/NAME="([^"]+)"/i);
          const langMatch = line.match(/LANGUAGE="([^"]+)"/i);
          const uriMatch = line.match(/URI="([^"]+)"/i);
          if (uriMatch && uriMatch[1]) {
            audioTracks.push({
              groupId: groupMatch ? groupMatch[1] : '',
              name: nameMatch ? nameMatch[1] : '',
              lang: langMatch ? langMatch[1] : '',
              uri: resolveUrl(m3u8Url, uriMatch[1])
            });
          }
        } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
          const bwMatch = line.match(/BANDWIDTH=(\d+)/);
          currentBandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
          const resMatch = line.match(/RESOLUTION=(\d+x\d+)/);
          currentResolution = resMatch ? resMatch[1] : '';

          let nextIndex = i + 1;
          while (nextIndex < lines.length && lines[nextIndex].trim().startsWith('#')) {
            nextIndex++;
          }
          if (nextIndex < lines.length) {
            const streamUrl = lines[nextIndex].trim();
            if (currentBandwidth > bestBandwidth && streamUrl) {
              bestBandwidth = currentBandwidth;
              bestStreamUrl = streamUrl;
            }
          }
        }
      }

      let muxMode = 'dual';
      if (selectedAudioTrack === 'tr') {
        const trTrack = audioTracks.find(t => t.lang.startsWith('tr') || t.name.toLowerCase().includes('türk') || t.name.toLowerCase().includes('turk'));
        if (trTrack) {
          audioPlaylistUrl = trTrack.uri;
          muxMode = 'replace_audio';
        }
      } else if (selectedAudioTrack === 'en' || selectedAudioTrack === 'org') {
        const enTrack = audioTracks.find(t => t.lang.startsWith('en') || t.name.toLowerCase().includes('eng') || t.name.toLowerCase().includes('orig')) || audioTracks.find(t => !t.lang.startsWith('tr') && !t.name.toLowerCase().includes('türk') && !t.name.toLowerCase().includes('turk'));
        if (enTrack) {
          audioPlaylistUrl = enTrack.uri;
          muxMode = 'replace_audio';
        }
      }

      if (bestStreamUrl) {
        targetPlaylistUrl = resolveUrl(m3u8Url, bestStreamUrl);
      }
    }

    if (audioPlaylistUrl) {
      logger.info(`Performing audio/video dual stream download...`);
      const tempVideoFile = outputPath.replace(/\.[a-zA-Z0-9]+$/, '_video.ts');
      const tempAudioFile = outputPath.replace(/\.[a-zA-Z0-9]+$/, '_audio.ts');

      await downloadPlaylistToSingleFile(targetPlaylistUrl, tempVideoFile, 'video', signal, headers, (completed, total) => {
        if (progressCallback) {
          progressCallback(Math.round((completed / total) * 50), 100);
        }
      }, cookieJar);

      await downloadPlaylistToSingleFile(audioPlaylistUrl, tempAudioFile, 'audio', signal, headers, (completed, total) => {
        if (progressCallback) {
          progressCallback(50 + Math.round((completed / total) * 50), 100);
        }
      }, cookieJar);

      const ffmpegMap = '-map 0:v -map 1:a';

      logger.info(`Merging audio and video via FFmpeg...`);
      await new Promise((resolve) => {
        exec(`"${ffmpegPath}" -y -i "${tempVideoFile}" -i "${tempAudioFile}" ${ffmpegMap} -c:v copy -c:a copy -bsf:a aac_adtstoasc -movflags +faststart -brand mp42 "${outputPath}"`, (err, stdout, stderr) => {
          if (err) {
            logger.error({ err: err.message }, "FFmpeg merge failed. Falling back to default video stream");
            try {
              if (fs.existsSync(tempVideoFile)) {
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
              logger.error({ err: fallbackErr.message }, "Fallback file operations failed");
            }
            resolve();
          } else {
            logger.info("FFmpeg merge completed successfully!");
            try {
              if (fs.existsSync(tempVideoFile)) fs.unlinkSync(tempVideoFile);
              if (fs.existsSync(tempAudioFile)) fs.unlinkSync(tempAudioFile);
            } catch (cleanupErr) {}
            resolve();
          }
        });
      });
    } else {
      await downloadPlaylistToSingleFile(targetPlaylistUrl, outputPath, 'single', signal, headers, progressCallback, cookieJar);
    }

  } catch (err) {
    throw new Error(`M3U8 download failed: ${err.message}`);
  }
}

