import fs from 'fs';
import path from 'path';
import axios from 'axios';
import HttpsProxyAgentPkg from 'https-proxy-agent';
const HttpsProxyAgent = HttpsProxyAgentPkg.HttpsProxyAgent || HttpsProxyAgentPkg;
import { getProxyUrl, formatBytes, getProgressBar } from '../config.js';
import { checkAvailableDiskSpace, shouldUseProxy } from './utils.js';
import { getModuleLogger } from '../utils/logger.js';

const logger = getModuleLogger('downloader-direct');

export async function downloadDirectVideo(url, outputPath, signal, progressCallback, refererOverride, cookiesOverride = null, userAgentOverride = null, headersOverride = null) {
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

  let supportsRange = false;
  let totalBytes = 0;
  try {
    let headRes;
    try {
      headRes = await axios.head(url, { headers, timeout: 10000, maxRedirects: 5, ...agentOpts });
    } catch {
      headRes = await axios.get(url, { headers: { ...headers, Range: 'bytes=0-1' }, timeout: 10000, maxRedirects: 5, ...agentOpts });
    }
    totalBytes = parseInt(
      headRes.headers['content-range']?.split('/')?.[1] ||
      headRes.headers['content-length'] || '0',
      10
    );
    supportsRange = headRes.status === 206 || headRes.headers['accept-ranges'] === 'bytes';
    if (!supportsRange && totalBytes > 10 * 1024 * 1024) {
      supportsRange = true;
    }
  } catch (headErr) {
    logger.info({ err: headErr.message }, '[Segmented Downloader] Range check failed, falling back to standard sequential download');
  }

  await checkAvailableDiskSpace(path.dirname(outputPath), totalBytes);

  const partPath = outputPath + '.part';

  const res = await axios.get(url, {
    headers,
    responseType: 'stream',
    timeout: 30000,
    maxRedirects: 5,
    signal: signal || undefined,
    ...agentOpts
  });

  let existingSize = 0;
  if (fs.existsSync(partPath)) {
    try {
      existingSize = fs.statSync(partPath).size;
    } catch (e) {}
  }

  const isResuming = existingSize > 0;
  const actualResuming = isResuming && res.status === 206;
  const writeFlags = actualResuming ? 'a' : 'w';
  if (!actualResuming) {
    existingSize = 0;
  }

  const contentLen = parseInt(res.headers['content-length'] || '0', 10) + existingSize;
  let downloaded = existingSize;

  return new Promise((resolve, reject) => {
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
          logger.info(`[İNDİRME İLERLEME] %${percent} [${getProgressBar(percent)}] | ${formatBytes(downloaded)} / ${formatBytes(contentLen)} | Hız: ~${speedMBs} MB/s`);
        } else {
          logger.info(`[İNDİRME İLERLEME] İndirilen: ${formatBytes(downloaded)} | Hız: ~${speedMBs} MB/s`);
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
        logger.info(`[İNDİRME TAMAMLANDI] Dosya: ${path.basename(outputPath)} | Boyut: ${formatBytes(downloaded)} | Süre: ${durationSec}s | Ort. Hız: ~${avgSpeed} MB/s`);
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

