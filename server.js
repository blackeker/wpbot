import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import axios from 'axios';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { gotScraping } from 'got-scraping';
import { exec, execSync } from 'child_process';
import { startCronScheduler } from './server/cronScheduler.js';

import { getModuleLogger } from './utils/logger.js';
const logger = getModuleLogger('server');

import { 
  botState, 
  downloadsDir, 
  botSocketRef, 
  pairingState, 
  sessionPath,
  readConfig,
  writeConfig,
  setupPingTimer,
  formatBytes,
  getDiskUsage,
  getYtDlpCommand,
  setLogEmitter,
  logQueue,
  backupSession,
  restoreSession,
  backupCredsFile,
  readHistory,
  readErrorLog,
  historyPath,
  errorLogPath
} from './config.js';

import { 
  downloadQueue, 
  activeTask, 
  addDownloadTask, 
  cancelDownloadTask,
  prioritizeDownloadTask,
  clearQueue,
  pauseQueue,
  resumeQueue,
  queueState,
  activeTasksList,
  processQueue,
  saveQueueToFile,
  notifyQueueUpdate,
  setQueueUpdateCallback
} from './queue.js';

import { executeDownloadPipeline, queueMediaSend } from './pipelines.js';
import { getAnimecixSeasonEpisodes, getHdfilmcehennemiSeasonEpisodes, getHdkoreSeasonEpisodes, extractVideoUrl } from './extractor.js';
import { 
  CATEGORIES, 
  getGroupConfig, 
  updateGroupConfig, 
  resetGroupConfig 
} from './utils/permissionManager.js';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/downloads', express.static(downloadsDir));

// Brute-force protection state
const loginAttempts = new Map();
const BLOCK_TIME = 15 * 60 * 1000; // 15 minutes lock
const MAX_ATTEMPTS = 5; // Max failed attempts allowed

function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function basicAuth(req, res, next) {
  const config = readConfig();
  const user = config.dashboardUser || 'admin';
  const pass = config.dashboardPass || process.env.DASHBOARD_PASS;

  if (!pass) {
    return next();
  }

  const ip = getClientIp(req);
  const now = Date.now();

  if (loginAttempts.has(ip)) {
    const record = loginAttempts.get(ip);
    if (record.attempts >= MAX_ATTEMPTS) {
      if (now - record.lastAttempt < BLOCK_TIME) {
        const remainingMin = Math.ceil((BLOCK_TIME - (now - record.lastAttempt)) / 60000);
        return res.status(429).send(`Güvenlik Uyarısı: Çok fazla hatalı giriş denemesi! IP adresiniz geçici olarak ${remainingMin} dakika engellenmiştir.`);
      } else {
        loginAttempts.delete(ip);
      }
    }
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard Secure Access"');
    return res.status(401).send('Yetkisiz Giriş: Kimlik doğrulaması gerekiyor.');
  }

  const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  const reqUser = auth[0];
  const reqPass = auth[1];

  const isUserValid = safeCompare(reqUser, user);
  const isPassValid = safeCompare(reqPass, pass);

  if (isUserValid && isPassValid) {
    loginAttempts.delete(ip);
    return next();
  }

  let record = loginAttempts.get(ip) || { attempts: 0, lastAttempt: 0 };
  record.attempts += 1;
  record.lastAttempt = now;
  loginAttempts.set(ip, record);

  res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard Secure Access"');
  const remaining = MAX_ATTEMPTS - record.attempts;

  if (remaining <= 0) {
    return res.status(429).send('Güvenlik Uyarısı: Çok fazla hatalı giriş denemesi! IP adresiniz 15 dakika boyunca engellenmiştir.');
  }

  return res.status(401).send(`Hatalı kullanıcı adı veya şifre! Kalan deneme hakkınız: ${remaining}`);
}

// Secure all dashboard routes EXCEPT /watch, /downloads, and local /api
app.use((req, res, next) => {
  if (req.path.startsWith('/watch') || req.path.startsWith('/downloads') || req.path.startsWith('/api/')) {
    return next();
  }
  basicAuth(req, res, next);
});

export { activeCaptchasMap, sentCaptchasSet, startCaptchaPoller } from './server/captchaPoller.js';

// Site-specific direct link extraction API endpoints
app.get('/api/extract', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'url query parametresi gerekli.' });
  try {
    const result = await extractVideoUrl(url);
    if (result && result.filePath) {
      const config = readConfig();
      const vdsIp = config.vdsIp || '111.235.150.157';
      const port = config.port || 7860;
      const filename = path.basename(result.filePath);
      result.downloadUrl = `http://${vdsIp}:${port}/downloads/${encodeURIComponent(filename)}`;
    }
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/extract/:site', async (req, res) => {
  const { site } = req.params;
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'url query parametresi gerekli.' });

  try {
    const lowerUrl = url.toLowerCase();
    const validSites = [
      'instagram', 'tiktok', 'mega', 'yandex', 'gdrive', 'terabox', 'liteapks', 'modyolo',
      'hentaizm', 'hentaizm_manga', 'pornhub', 'doeda', 'xhamster', 'turkifsahub', 'turkifsalar',
      'turkporno', 'hdabla', 'rule34video', 'maheir', 'kalite18', 'koreanpornmovie', 'kopeda', 'jav_guru'
    ];
    if (!validSites.includes(site)) {
      return res.status(400).json({ success: false, error: `Geçersiz site parametresi. Desteklenenler: ${validSites.join(', ')}` });
    }

    if (site === 'instagram' && !lowerUrl.includes('instagram.com')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece instagram.com linkleri içindir.' });
    }
    if (site === 'tiktok' && !lowerUrl.includes('tiktok.com')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece tiktok.com linkleri içindir.' });
    }
    if (site === 'mega' && !lowerUrl.includes('mega.nz')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece mega.nz linkleri içindir.' });
    }
    if (site === 'yandex' && !lowerUrl.includes('disk.yandex') && !lowerUrl.includes('yadi.sk')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece yandex disk linkleri içindir.' });
    }
    if (site === 'gdrive' && !lowerUrl.includes('drive.google.com')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece drive.google.com linkleri içindir.' });
    }
    if (site === 'terabox' && !lowerUrl.includes('terabox')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece terabox linkleri içindir.' });
    }
    if (site === 'liteapks' && !lowerUrl.includes('liteapks.com')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece liteapks.com linkleri içindir.' });
    }
    if (site === 'modyolo' && !lowerUrl.includes('modyolo.com')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece modyolo.com linkleri içindir.' });
    }
    if (site === 'hentaizm' && !lowerUrl.includes('hentaizm')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece hentaizm linkleri içindir.' });
    }
    if (site === 'hentaizm_manga' && (!lowerUrl.includes('hentaizm') || !lowerUrl.includes('manga'))) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece hentaizm manga linkleri içindir.' });
    }
    if (site === 'pornhub' && !lowerUrl.includes('pornhub.com')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece pornhub.com linkleri içindir.' });
    }
    if (site === 'doeda' && !lowerUrl.includes('doeda')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece doeda linkleri içindir.' });
    }
    if (site === 'xhamster' && !lowerUrl.includes('xhamster')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece xhamster linkleri içindir.' });
    }
    if (site === 'turkifsahub' && !lowerUrl.includes('turkifsahub.com')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece turkifsahub.com linkleri içindir.' });
    }
    if (site === 'turkifsalar' && !lowerUrl.includes('turkifsalar')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece turkifsalar linkleri içindir.' });
    }
    if (site === 'turkporno' && !lowerUrl.includes('turkporno')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece turkporno linkleri içindir.' });
    }
    if (site === 'hdabla' && !lowerUrl.includes('hdabla') && !lowerUrl.includes('fakitonye')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece hdabla linkleri içindir.' });
    }
    if (site === 'rule34video' && !lowerUrl.includes('rule34video')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece rule34video linkleri içindir.' });
    }
    if (site === 'maheir' && !lowerUrl.includes('maheir')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece maheir linkleri içindir.' });
    }
    if (site === 'kalite18' && !lowerUrl.includes('kalite18')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece kalite18 linkleri içindir.' });
    }
    if (site === 'koreanpornmovie' && !lowerUrl.includes('koreanpornmovie')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece koreanpornmovie linkleri içindir.' });
    }
    if (site === 'kopeda' && !lowerUrl.includes('kopeda')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece kopeda linkleri içindir.' });
    }
    if (site === 'jav_guru' && !lowerUrl.includes('jav.guru')) {
      return res.status(400).json({ success: false, error: 'Bu endpoint sadece jav.guru linkleri içindir.' });
    }

    const result = await extractVideoUrl(url);
    if (result && result.filePath) {
      const config = readConfig();
      const vdsIp = config.vdsIp || '111.235.150.157';
      const port = config.port || 7860;
      const filename = path.basename(result.filePath);
      result.downloadUrl = `http://${vdsIp}:${port}/downloads/${encodeURIComponent(filename)}`;
    }
    res.json({ success: true, site, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Local API: trigger a download task (accessible publicly)
app.post('/api/indir', (req, res) => {
  const { url, jid, title, fileName, caption, audioTrack, burnSubtitles } = req.body;
  if (!url || !jid) return res.status(400).json({ error: 'url ve jid gerekli.' });

  try {
    const customTitle = title || fileName || url;
    const task = addDownloadTask(url, jid, customTitle, null, Boolean(req.body.priority), caption || null, null, null, audioTrack || null, Boolean(burnSubtitles));
    res.json({ ok: true, taskId: task.id, message: 'Görev kuyruğa eklendi.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/kuyruk-temizle', (req, res) => {
  const count = clearQueue();
  res.json({ ok: true, message: `${count} görev silindi.` });
});

app.post('/api/kuyruk-duraklat', (req, res) => {
  pauseQueue();
  res.json({ ok: true, message: 'Kuyruk duraklatıldı.' });
});

app.post('/api/kuyruk-devam', (req, res) => {
  resumeQueue();
  res.json({ ok: true, message: 'Kuyruk devam ediyor.' });
});

app.post('/api/queue/insert-after', (req, res) => {
  const { tasks, afterTitle } = req.body;
  if (!tasks || !Array.isArray(tasks)) return res.status(400).json({ error: 'tasks dizisi gereklidir.' });

  let insertIndex = downloadQueue.length;
  if (afterTitle) {
    const idx = downloadQueue.findIndex(t => t.title && t.title.includes(afterTitle));
    if (idx !== -1) insertIndex = idx + 1;
  }

  const created = [];
  for (let i = 0; i < tasks.length; i++) {
    const item = tasks[i];
    const task = {
      id: String(Date.now() + i),
      url: item.url,
      recipientJid: item.recipientJid,
      title: item.title,
      status: 'queued',
      isCancelled: false,
      format: item.format || null,
      priority: false,
      caption: item.caption || null,
      episodeBatch: null,
      seriesPack: null,
      addedTime: new Date(),
      startTime: null,
      endTime: null,
      speed: null,
      sizeMB: null
    };
    downloadQueue.splice(insertIndex + i, 0, task);
    created.push(task);
  }

  saveQueueToFile();
  notifyQueueUpdate();
  processQueue();
  res.json({ ok: true, count: created.length });
});

async function getUniversalSeasonEpisodes(url) {
  if (url.includes('animecix')) {
    return await getAnimecixSeasonEpisodes(url);
  }
  if (url.includes('hdfilmcehennemi')) {
    return await getHdfilmcehennemiSeasonEpisodes(url);
  }
  if (url.includes('hdkore')) {
    return await getHdkoreSeasonEpisodes(url);
  }
  if (url.includes('dramadizilerim')) {
    const { getDramadizilerimSeasonEpisodes } = await import('./extractors/dramadizilerim.js');
    if (getDramadizilerimSeasonEpisodes) {
      return await getDramadizilerimSeasonEpisodes(url);
    }
  }
  if (url.includes('hentaizm')) {
    const { getHentaizmSeasonEpisodes } = await import('./extractors/hentaizm.js');
    if (getHentaizmSeasonEpisodes) {
      return await getHentaizmSeasonEpisodes(url);
    }
  }
  throw new Error('Desteklenmeyen platform. Animecix, HDfilmcehennemi, HDKore, Dramadizilerim veya Hentaizm dizi/sezon bağlantısı girin.');
}

app.get('/api/fetch-episodes', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parametresi gerekli.' });

  try {
    const result = await getUniversalSeasonEpisodes(url);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hentaizm Listing Scanner
app.post('/api/hentai/scan-listing', async (req, res) => {
  const { url, startPage = 1, endPage = 1 } = req.body;
  if (!url) return res.status(400).json({ error: 'url parametresi gereklidir.' });

  try {
    const { extractHentaizmListingPage } = await import('./extractors/hentaizm.js');
    const result = await extractHentaizmListingPage(url, startPage, endPage);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Hentaizm Bulk Queue
app.post('/api/hentai/queue-bulk', async (req, res) => {
  const { items, phone, targetJid: customTargetJid, priority } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items dizisi gereklidir.' });
  }

  try {
    const config = readConfig();
    let targetJid = customTargetJid ? customTargetJid.trim() : null;
    if (!targetJid && phone) {
      const raw = phone.trim();
      if (raw.includes('@')) {
        targetJid = raw;
      } else {
        const clean = raw.replace(/[^0-9]/g, '');
        if (clean) targetJid = `${clean}@s.whatsapp.net`;
      }
    }
    if (!targetJid) {
      targetJid = config.hentaiGroupJid || (config.whatsappPhoneNumber ? `${config.whatsappPhoneNumber.replace(/[^0-9]/g, '')}@s.whatsapp.net` : '');
    }
    if (!targetJid) {
      return res.status(400).json({ error: 'Hedef WhatsApp numarası veya Hentai hedef grubu bulunamadı.' });
    }

    let addedCount = 0;
    let skippedCount = 0;

    for (const item of items) {
      const url = typeof item === 'string' ? item : item.url;
      const title = (typeof item === 'object' && item.title) ? item.title : 'Hentai Seri';
      const posterUrl = (typeof item === 'object' && item.posterUrl) ? item.posterUrl : null;

      try {
        addDownloadTask(
          url,
          targetJid,
          `🔞 ${title} (Paket)`,
          null,
          Boolean(priority),
          null,
          null,
          {
            type: 'hentai_pack',
            seriesName: title,
            posterUrl,
            episodes: [],
            replyJid: targetJid
          }
        );
        addedCount++;
      } catch (e) {
        skippedCount++;
      }
    }

    res.json({
      success: true,
      addedCount,
      skippedCount,
      targetJid,
      message: `${addedCount} anime paketi kuyruğa eklendi.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Media Vault: List Files
app.get('/api/files', (req, res) => {
  try {
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }
    const files = fs.readdirSync(downloadsDir).filter(f => f.endsWith('.mp4') || f.endsWith('.ts') || f.endsWith('.zip'));
    const fileList = files.map(name => {
      const filePath = path.join(downloadsDir, name);
      const stats = fs.statSync(filePath);
      return {
        name,
        sizeBytes: stats.size,
        sizeFormatted: formatBytes(stats.size),
        dateFormatted: stats.mtime.toLocaleString('tr-TR'),
        downloadUrl: `/downloads/${encodeURIComponent(name)}`
      };
    });
    res.json({ success: true, files: fileList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Media Vault: Delete File
app.post('/api/files/delete', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename parametresi gerekli.' });
  try {
    const safeFile = path.basename(filename);
    const filePath = path.join(downloadsDir, safeFile);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true, message: 'Dosya silindi.' });
    } else {
      res.status(404).json({ error: 'Dosya bulunamadı.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Queue: Cancel Task
app.post('/api/indir/cancel', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id gereklidir.' });
  const result = cancelDownloadTask(id);
  if (result) {
    res.json({ success: true, message: 'Görev iptal edildi.' });
  } else {
    res.status(404).json({ error: 'Görev bulunamadı.' });
  }
});

// Queue: Prioritize Task
app.post('/api/indir/prioritize', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id gereklidir.' });
  const result = prioritizeDownloadTask(id);
  if (result) {
    res.json({ success: true, message: 'Görev önceliklendirildi.' });
  } else {
    res.status(404).json({ error: 'Görev bulunamadı.' });
  }
});

// Diagnostics & System Health
app.get('/api/system/health', (req, res) => {
  let ffmpegOk = false;
  try {
    execSync('ffmpeg -version');
    ffmpegOk = true;
  } catch (e) {}

  let ytDlpOk = false;
  const config = readConfig();
  const ytDlpCmd = getYtDlpCommand();
  try {
    execSync(`"${ytDlpCmd}" --version`);
    ytDlpOk = true;
  } catch (e) {}

  let filesCount = 0;
  let totalBytes = 0;
  try {
    if (fs.existsSync(downloadsDir)) {
      const files = fs.readdirSync(downloadsDir);
      filesCount = files.length;
      files.forEach(f => {
        try {
          const stats = fs.statSync(path.join(downloadsDir, f));
          totalBytes += stats.size;
        } catch (e) {}
      });
    }
  } catch (e) {}

  res.json({
    success: true,
    ffmpeg: { ok: ffmpegOk },
    ytDlp: { ok: ytDlpOk, command: ytDlpCmd },
    whatsapp: {
      ok: botState.status === 'connected',
      status: botState.status
    },
    storage: {
      filesCount,
      totalBytes
    }
  });
});

// Git Pull Update
app.post('/api/system/git-pull', (req, res) => {
  exec('git pull', (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: err.message, stderr });
    }
    res.json({ success: true, output: stdout });
  });
});

// PM2 Process Restart
app.post('/api/system/restart', (req, res) => {
  res.json({ success: true, message: 'Bot PM2 süreci yeniden başlatılıyor...' });
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// Session Backup & Restore APIs
app.post('/api/session/backup', (req, res) => {
  try {
    const success = backupSession();
    if (success) {
      res.json({ success: true, message: 'Oturum yedeği alındı.' });
    } else {
      res.status(500).json({ error: 'Yedekleme başarısız oldu.' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/session/restore', (req, res) => {
  try {
    const success = restoreSession();
    if (success) {
      res.json({ success: true, message: 'Oturum geri yüklendi. Bot yeniden başlatılıyor...' });
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    } else {
      res.status(400).json({ error: 'Geri yüklenecek yedek bulunamadı.' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/session/reset', (req, res) => {
  try {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    if (fs.existsSync(backupCredsFile)) {
      fs.unlinkSync(backupCredsFile);
    }
    res.json({ success: true, message: 'Oturum sıfırlandı. Bot yeniden başlatılıyor...' });
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Media Vault: Zip Selected Files
app.post('/api/files/zip', (req, res) => {
  try {
    const { filenames } = req.body;
    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'Dosya adları listesi gereklidir.' });
    }
    const safeFiles = filenames.map(f => path.basename(f));
    const zipName = `hdwp_archive_${Date.now()}.zip`;
    const zipPath = path.join(downloadsDir, zipName);

    // Native tar command for multi-platform compatibility (runs natively on Win10+/Linux)
    const fileArgs = safeFiles.map(f => `"${f}"`).join(' ');
    const cmd = `tar -ca -f "${zipPath}" -C "${downloadsDir}" ${fileArgs}`;

    exec(cmd, (err) => {
      if (err) {
        console.error('[ZIP] Hata:', err.message);
        return res.status(500).json({ error: 'Sıkıştırma işlemi başarısız oldu: ' + err.message });
      }
      res.json({ success: true, zipUrl: `/downloads/${zipName}`, filename: zipName });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy Pool: Test Proxy Link
app.post('/api/proxy/test', async (req, res) => {
  const { proxyUrl } = req.body;
  if (!proxyUrl) return res.status(400).json({ error: 'Proxy URL gereklidir.' });

  const targets = [
    { name: 'YouTube', url: 'https://www.youtube.com' },
    { name: 'Google', url: 'https://www.google.com' },
    { name: 'Animecix', url: 'https://animecix.net' }
  ];

  let proxyConfig = null;
  try {
    const parsed = new URL(proxyUrl);
    proxyConfig = {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: parseInt(parsed.port, 10)
    };
    if (parsed.username || parsed.password) {
      proxyConfig.auth = {
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password)
      };
    }
  } catch (err) {
    return res.status(400).json({ error: 'Geçersiz Proxy URL formatı.' });
  }

  const results = [];
  for (const target of targets) {
    const start = Date.now();
    try {
      await axios.get(target.url, {
        proxy: proxyConfig,
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      results.push({ name: target.name, url: target.url, ok: true, ping: Date.now() - start });
    } catch (err) {
      results.push({ name: target.name, url: target.url, ok: false, error: err.message });
    }
  }

  res.json({ success: true, results });
});

// Cookies: Verify Netscape / JSON Cookies
app.post('/api/cookies/verify', async (req, res) => {
  const { cookiesText, targetUrl } = req.body;
  if (!cookiesText || !targetUrl) {
    return res.status(400).json({ error: 'cookiesText ve targetUrl gereklidir.' });
  }

  try {
    let parsedCookies = [];
    if (cookiesText.trim().startsWith('[')) {
      parsedCookies = JSON.parse(cookiesText);
    } else {
      const lines = cookiesText.split('\n');
      for (const line of lines) {
        const parts = line.trim().split('\t');
        if (parts.length >= 7) {
          parsedCookies.push({
            domain: parts[0],
            path: parts[2],
            secure: parts[3] === 'TRUE',
            name: parts[5],
            value: parts[6]
          });
        }
      }
    }

    if (parsedCookies.length === 0) {
      return res.status(400).json({ error: 'Geçerli çerez verisi bulunamadı.' });
    }

    const cookieHeaderValue = parsedCookies.map(c => `${c.name}=${c.value}`).join('; ');
    const testRes = await axios.get(targetUrl, {
      headers: {
        'Cookie': cookieHeaderValue,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      timeout: 6000
    });

    res.json({
      success: true,
      statusCode: testRes.status,
      parsedCount: parsedCookies.length,
      message: `Bağlantı başarılı (HTTP ${testRes.status})`
    });
  } catch (e) {
    res.json({
      success: false,
      error: e.message,
      message: `Bağlantı başarısız oldu: ${e.message}`
    });
  }
});

// System Settings
app.get('/api/settings', (req, res) => {
  res.json({ success: true, settings: readConfig() });
});

app.post('/api/settings', (req, res) => {
  try {
    writeConfig(req.body);
    processQueue();
    res.json({ success: true, message: 'Ayarlar başarıyla kaydedildi.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Custom Command Templates
app.post('/api/commands', (req, res) => {
  try {
    const { customCommands } = req.body;
    if (!customCommands || typeof customCommands !== 'object') {
      return res.status(400).json({ error: 'Geçersiz komut verisi.' });
    }
    writeConfig({ customCommands });
    res.json({ success: true, message: 'Özel komutlar başarıyla kaydedildi.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cron Scheduler Studio
app.post('/api/cron', (req, res) => {
  try {
    const { cronSchedules } = req.body;
    if (!cronSchedules || !Array.isArray(cronSchedules)) {
      return res.status(400).json({ error: 'Geçersiz zamanlanmış görev verisi.' });
    }
    writeConfig({ cronSchedules });
    res.json({ success: true, message: 'Zamanlanmış görevler başarıyla kaydedildi.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Group Permissions & Restriction APIs
app.get('/api/permissions/whatsapp-groups', async (req, res) => {
  try {
    const sock = botSocketRef.current;
    let groups = [];
    const config = readConfig();
    const savedPermissions = config.groupPermissions || {};

    if (sock && typeof sock.groupFetchAllParticipating === 'function') {
      try {
        const participating = await sock.groupFetchAllParticipating();
        groups = Object.values(participating || {}).map(g => ({
          jid: g.id,
          name: g.subject || g.id,
          participantsCount: g.participants?.length || g.size || 0,
          creation: g.creation,
          owner: g.owner,
          hasCustomRules: Boolean(savedPermissions[g.id])
        }));
      } catch (err) {
        console.warn('[GROUPS API] groupFetchAllParticipating error:', err.message);
      }
    }

    // Include any groups that have custom rules in config even if not currently fetched from socket
    for (const [jid, perm] of Object.entries(savedPermissions)) {
      if (!groups.some(g => g.jid === jid)) {
        groups.push({
          jid,
          name: perm.name || jid,
          participantsCount: 0,
          hasCustomRules: true,
          isDisconnectedOrSaved: true
        });
      }
    }

    // Sort: groups with custom rules first, then alphabetically by name
    groups.sort((a, b) => {
      if (a.hasCustomRules !== b.hasCustomRules) return a.hasCustomRules ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    res.json({
      success: true,
      connected: Boolean(sock),
      totalGroups: groups.length,
      groups
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/permissions/categories', (req, res) => {
  res.json({ success: true, categories: CATEGORIES });
});

app.get('/api/permissions/groups', (req, res) => {
  const config = readConfig();
  res.json({ success: true, groupPermissions: config.groupPermissions || {} });
});

app.get('/api/permissions/groups/:jid', (req, res) => {
  const jid = req.params.jid;
  res.json({ success: true, groupConfig: getGroupConfig(jid) });
});

app.post('/api/permissions/groups/:jid', (req, res) => {
  try {
    const jid = req.params.jid;
    const updated = updateGroupConfig(jid, req.body);
    res.json({ success: true, message: 'Grup izinleri güncellendi.', groupConfig: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/permissions/groups/:jid', (req, res) => {
  try {
    const jid = req.params.jid;
    resetGroupConfig(jid);
    res.json({ success: true, message: 'Grup izinleri varsayılana sıfırlandı.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// History & Errors Logger Analytics APIs
app.get('/api/history', (req, res) => {
  res.json({ success: true, history: readHistory() });
});

app.get('/api/errors', (req, res) => {
  res.json({ success: true, errors: readErrorLog() });
});

app.post('/api/history/clear', (req, res) => {
  try {
    fs.writeFileSync(historyPath, JSON.stringify([], null, 2), 'utf8');
    res.json({ success: true, message: 'İndirme geçmişi temizlendi.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/errors/clear', (req, res) => {
  try {
    fs.writeFileSync(errorLogPath, JSON.stringify([], null, 2), 'utf8');
    res.json({ success: true, message: 'Hata geçmişi temizlendi.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/indir-multiple', (req, res) => {
  const { episodes, jid, batchMerge, seriesName } = req.body;
  if (!episodes || !Array.isArray(episodes) || !jid) {
    return res.status(400).json({ error: 'episodes ve jid gerekli.' });
  }

  let addedCount = 0;
  let skippedCount = 0;

  if (batchMerge) {
    const isSingleZip = Boolean(req.body.singleZip) || Boolean(seriesName && /drama|dizilerim/i.test(seriesName));
    const batchSize = isSingleZip ? episodes.length : 10;
    const chunks = [];
    for (let i = 0; i < episodes.length; i += batchSize) {
      chunks.push(episodes.slice(i, i + batchSize));
    }
    for (const chunk of chunks) {
      try {
        const firstEp = chunk[0];
        const lastEp = chunk[chunk.length - 1];
        const startNum = firstEp.number || 1;
        const endNum = lastEp.number || chunk.length;
        const name = seriesName || firstEp.seriesName || 'Dizi Paketi';
        const batchTitle = startNum === endNum ? `${name} - Bölüm ${startNum}` : `${name} - Bölüm ${startNum}-${endNum}`;
        const batchUrl = `${firstEp.url}#batch=${startNum}-${endNum}`;
        addDownloadTask(batchUrl, jid, batchTitle, null, false, null, chunk);
        addedCount++;
      } catch (e) {
        skippedCount++;
      }
    }
    return res.json({ success: true, addedCount, skippedCount, message: `${addedCount} paket kuyruğa eklendi.` });
  }

  for (const ep of episodes) {
    try {
      const customTitle = ep.title || ep.fileName || ep.name || ep.url;
      addDownloadTask(ep.url, jid, customTitle, null, false, ep.caption || null);
      addedCount++;
    } catch (e) {
      skippedCount++;
    }
  }

  res.json({ success: true, addedCount, skippedCount, message: `${addedCount} bölüm sıraya eklendi.` });
});


// Endpoint for Discord bot to notify new captcha
app.post('/api/notify-captcha', async (req, res) => {
  const { username, accountType, token, channelId, messageId, warnCount, localImageUrl } = req.body;
  if (!messageId || !channelId) {
    return res.status(400).json({ error: 'messageId and channelId are required.' });
  }

  if (sentCaptchasSet.has(messageId)) {
    return res.json({ success: true, message: 'Already notified.' });
  }
  sentCaptchasSet.add(messageId);

  captchaCounter++;
  const durumKodu = String(captchaCounter);
  activeCaptchasMap.set(durumKodu, { messageId, username, accountType, token, channelId });

  const cfg = readConfig();
  const adminNum = cfg.adminJids?.[0] || cfg.whatsappPhoneNumber;
  const targetJid = adminNum ? (adminNum.includes('@') ? adminNum : `${adminNum}@s.whatsapp.net`) : '';

  let infoText = `⚠️ *YENİ CAPTCHA BELİRDİ!* ⚠️\n\n`;
  infoText += `👤 *Hesap:* ${username} (${accountType === 'main' ? 'Ana Hesap' : 'Yan Hesap'})\n`;
  infoText += `⚠️ *Uyarı:* ${warnCount}/6\n`;
  infoText += `🔑 *Durum Kodu (Sıra No):* *${durumKodu}*\n\n`;
  infoText += `💬 *Çözmek için:* \n\`!çöz ${durumKodu} KOD\` yazıp gönderin.`;

  try {
    if (botSocketRef.current) {
      if (localImageUrl) {
        const imgUrl = `http://127.0.0.1:8181${localImageUrl}`;
        const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer' });
        if (imgRes.status === 200) {
          await botSocketRef.current.sendMessage(targetJid, { 
            image: Buffer.from(imgRes.data), 
            caption: infoText 
          });
        } else {
          await botSocketRef.current.sendMessage(targetJid, { text: infoText + `\n\n⚠️ Resim indirilemedi (HTTP ${imgRes.status})` });
        }
      } else {
        await botSocketRef.current.sendMessage(targetJid, { text: infoText });
      }
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'WhatsApp client is not ready.' });
    }
  } catch (err) {
    console.error('Error sending captcha notification to WhatsApp:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Internal WhatsApp Relay for Test / Worker Instances
app.post('/api/internal/send-text', async (req, res) => {
  const { recipientJid, text, editKey } = req.body;
  if (!botSocketRef.current) return res.status(503).json({ error: 'WhatsApp bağlı değil' });
  try {
    let result;
    if (editKey) {
      result = await botSocketRef.current.sendMessage(recipientJid, { text, edit: editKey });
    } else {
      result = await botSocketRef.current.sendMessage(recipientJid, { text });
    }
    res.json({ ok: true, key: result?.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/internal/send-media', async (req, res) => {
  const { recipientJid, filePath, caption, mimetype, fileName, asDocument } = req.body;
  if (!botSocketRef.current) return res.status(503).json({ error: 'WhatsApp bağlı değil' });
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Dosya bulunamadı' });

  try {
    const fileStats = fs.statSync(filePath);
    const resolvedFileName = fileName || path.basename(filePath);
    const resolvedMimetype = mimetype || (resolvedFileName.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');

    const messageContent = asDocument || fileStats.size > 100 * 1024 * 1024 ? {
      document: { stream: fs.createReadStream(filePath) },
      mimetype: resolvedMimetype,
      fileName: resolvedFileName,
      caption: caption || undefined
    } : {
      video: { stream: fs.createReadStream(filePath) },
      mimetype: resolvedMimetype,
      fileName: resolvedFileName,
      caption: caption || undefined
    };

    const result = await queueMediaSend(recipientJid, messageContent);
    res.json({ ok: true, key: result?.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST API Status Endpoint for Realtime Dashboard Polling
app.get('/api/status', (req, res) => {
  let backupExists = false;
  let backupTime = null;
  try {
    if (fs.existsSync(backupCredsFile)) {
      backupExists = true;
      const stats = fs.statSync(backupCredsFile);
      backupTime = stats.mtime.toLocaleString('tr-TR');
    }
  } catch (e) {}

  res.json({
    status: botState.status,
    qrCodeUrl: botState.qrCodeUrl,
    pairingCode: botState.pairingCode,
    pingUrl: botState.pingUrl,
    activeTasks: botState.activeTasks,
    sendingTasks: botState.sendingTasks,
    backupExists,
    backupTime,
    downloadQueue: downloadQueue.map(t => ({ id: t.id, title: t.title, status: t.status, addedTime: t.addedTime })),
    activeTask: activeTask.current ? { id: activeTask.current.id, title: activeTask.current.title, status: activeTask.current.status } : null
  });
});

let onResetRequest = null; // Callback to handle bot reconnection in pairing mode

app.post('/api/request-pairing', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefon numarası gereklidir.' });

  const cleanPhone = phone.replace(/[^0-9]/g, '');
  if (cleanPhone.length < 10) return res.status(400).json({ error: 'Geçersiz telefon numarası. Lütfen ülke koduyla birlikte girin (Örn: 905551234567).' });

  try {
    pairingState.isPairingMode = true;
    pairingState.pairingPhoneNumber = cleanPhone;
    botState.pairingNumber = cleanPhone;
    botState.pairingCode = null;
    botState.pairingMode = true;
    botState.qrCodeUrl = null;
    botState.status = 'connecting';
    notifyStatusUpdate();

    console.log(`[PAIRING] Eşleşme kodu isteği alındı — Numara: +${cleanPhone}`);

    // Canlı soket üzerinden anında eşleşme kodu istemeyi dene
    if (botSocketRef.current && !botSocketRef.current.authState?.creds?.registered) {
      try {
        const { requestBotPairingCode } = await import('./bot.js');
        const code = await requestBotPairingCode(cleanPhone);
        return res.json({ 
          success: true, 
          pairingCode: code, 
          message: `Eşleşme kodu başarıyla oluşturuldu: ${code}` 
        });
      } catch (directErr) {
        console.warn('[PAIRING API] Canlı soket üzerinden kod alma başarısız, soket yeniden başlatılıyor:', directErr.message);
      }
    }

    // Soket yeniden başlatma
    if (botSocketRef.current) {
      try { botSocketRef.current.end(new Error('Pairing mode restart')); } catch(e) {}
      botSocketRef.current = null;
    }

    fs.rmSync(sessionPath, { recursive: true, force: true });
    fs.mkdirSync(sessionPath, { recursive: true });

    if (onResetRequest) {
      setTimeout(() => onResetRequest(), 1200);
    }

    return res.json({ success: true, message: 'Eşleşme kodu talep edildi, birkaç saniye içinde ekranda görünecektir...' });
  } catch (err) {
    console.error('Pairing request error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/request-qr', async (req, res) => {
  try {
    pairingState.isPairingMode = false;
    pairingState.pairingPhoneNumber = '';
    botState.pairingCode = null;
    botState.pairingMode = false;
    botState.status = 'connecting';
    botState.qrCodeUrl = null;
    notifyStatusUpdate();

    console.log('[QR] QR kod moduna geçiliyor...');

    if (botSocketRef.current) {
      try { botSocketRef.current.end(new Error('Switch to QR mode')); } catch(e) {}
      botSocketRef.current = null;
    }

    fs.rmSync(sessionPath, { recursive: true, force: true });
    fs.mkdirSync(sessionPath, { recursive: true });

    if (onResetRequest) {
      setTimeout(() => onResetRequest(), 1200);
    }

    return res.json({ success: true, message: 'QR kod moduna geçiliyor, lütfen bekleyin...' });
  } catch (err) {
    console.error('Request QR error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// HTTP Server Dashboard UI
app.get('/', (req, res) => {
  const PORT = process.env.PORT || 7860;
  const viewsDir = path.join(path.resolve(), 'views');
  try {
    let html = fs.readFileSync(path.join(viewsDir, 'dashboard.html'), 'utf8');
    html = html.replace(/{{PORT}}/g, PORT);
    html = html.replace(/{{UPTIME}}/g, botState.uptime.toLocaleString('tr-TR'));
    res.send(html);
  } catch (err) {
    res.status(500).send("Dashboard yüklenirken hata oluştu: " + err.message);
  }
});

// Dashboard Web Download Request Handler
app.post('/download', async (req, res) => {
  const { url, phone } = req.body;

  if (!url || !phone) {
    return res.status(400).send("Eksik bilgi girdiniz.");
  }

  if (botState.status !== 'connected') {
    return res.status(400).send("WhatsApp botu bağlı değil.");
  }

  let cleanPhone = phone.replace(/[^0-9]/g, '');
  if (!cleanPhone.endsWith('@s.whatsapp.net')) {
    cleanPhone = `${cleanPhone}@s.whatsapp.net`;
  }

  const taskId = Date.now();
  const task = {
    id: taskId,
    phone: phone,
    status: 'Video çözümleniyor...',
    time: new Date().toLocaleTimeString('tr-TR')
  };
  botState.activeTasks.push(task);

  executeDownloadPipeline(url, cleanPhone, async (statusMessage) => {
    const webStatus = statusMessage.replace(/\*|_|`/g, '');
    const idx = botState.activeTasks.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      botState.activeTasks[idx].status = webStatus;
    }
  }).then(() => {
    setTimeout(() => {
      botState.activeTasks = botState.activeTasks.filter(t => t.id !== taskId);
    }, 10000);
  }).catch((err) => {
    const idx = botState.activeTasks.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      botState.activeTasks[idx].status = `Hata: ${err.message}`;
    }
    setTimeout(() => {
      botState.activeTasks = botState.activeTasks.filter(t => t.id !== taskId);
    }, 20000);
  });

  res.redirect('/');
});

// Watch route to list downloads or stream a specific file in HTML5 video player
// Watch route to list downloads or stream a specific file in HTML5 video player
app.get('/watch', (req, res) => {
  const file = req.query.file;
  const viewsDir = path.join(path.resolve(), 'views');
  if (file) {
    const safeFile = path.basename(file);
    const filePath = path.join(downloadsDir, safeFile);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Video dosyası bulunamadı.');
    }

    try {
      let html = fs.readFileSync(path.join(viewsDir, 'player.html'), 'utf8');
      html = html.replace(/{{FILENAME}}/g, safeFile);
      html = html.replace(/{{ENCODED_FILENAME}}/g, encodeURIComponent(safeFile));
      return res.send(html);
    } catch (err) {
      return res.status(500).send("Video oynatıcı yüklenirken hata oluştu: " + err.message);
    }
  }

  let files = [];
  try {
    files = fs.readdirSync(downloadsDir).filter(f => f.endsWith('.mp4') || f.endsWith('.ts'));
  } catch (e) { }

  const listHtml = files.map(f => {
    return `
      <div class="media-item">
        <span class="media-info">🎬 ${f}</span>
        <a href="/watch?file=${encodeURIComponent(f)}" class="play-btn">İzle 🍿</a>
      </div>
    `;
  }).join('');

  try {
    let html = fs.readFileSync(path.join(viewsDir, 'list.html'), 'utf8');
    html = html.replace(/{{LIST_HTML}}/g, listHtml || '<p style="color: #9ca3af;">Henüz indirilmiş video bulunmuyor.</p>');
    res.send(html);
  } catch (err) {
    res.status(500).send("Liste yüklenirken hata oluştu: " + err.message);
  }
});

export let wsBroadcast = () => {};

export function notifyStatusUpdate() {
  if (wsBroadcast) {
    let backupExists = false;
    let backupTime = null;
    try {
      if (fs.existsSync(backupCredsFile)) {
        backupExists = true;
        const stats = fs.statSync(backupCredsFile);
        backupTime = stats.mtime.toLocaleString('tr-TR');
      }
    } catch (e) {}

    wsBroadcast('BOT_STATUS', {
      status: botState.status,
      pairingCode: botState.pairingCode,
      qrCodeUrl: botState.qrCodeUrl,
      backupExists,
      backupTime
    });
  }
}

export function setupWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] Dashboard client connected. Active: ${clients.size}`);

    // Send initial status payload
    ws.send(JSON.stringify({
      type: 'BOT_STATUS',
      data: {
        status: botState.status,
        pairingCode: botState.pairingCode,
        qrCodeUrl: botState.qrCodeUrl
      }
    }));

    // Send initial queue payload
    ws.send(JSON.stringify({
      type: 'QUEUE_UPDATE',
      data: {
        activeTasks: activeTasksList.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          speed: t.speed || '0.00'
        })),
        queue: downloadQueue.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority
        })),
        sending: botState.sendingTasks
      }
    }));

    // Send recent logs
    ws.send(JSON.stringify({
      type: 'INITIAL_LOGS',
      data: logQueue
    }));

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Dashboard client disconnected. Active: ${clients.size}`);
    });
  });

  // Telemetry loop (every 1.5 seconds)
  const telemetryInterval = setInterval(() => {
    if (clients.size === 0) return;
    try {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const loadAvg = os.loadavg();
      const disk = getDiskUsage();

      const payload = JSON.stringify({
        type: 'TELEMETRY_UPDATE',
        data: {
          cpu: {
            cores: cpus.length,
            usagePercent: Math.min(100, Math.max(0, Math.round((loadAvg[0] / Math.max(1, cpus.length)) * 100))),
            loadAvg: loadAvg
          },
          memory: {
            total: totalMem,
            used: usedMem,
            usagePercent: Math.round((usedMem / totalMem) * 100)
          },
          disk: {
            downloadsFolderBytes: disk.totalBytes,
            fileCount: disk.files.length
          }
        }
      });

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    } catch (err) {
      console.error('[WS Telemetry Error]', err.message);
    }
  }, 1500);

  // Hook config's log emitter to forward logs to WebSocket clients
  setLogEmitter((logEntry) => {
    const payload = JSON.stringify({
      type: 'CONSOLE_LOG',
      data: logEntry
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  wsBroadcast = (type, data) => {
    const payload = JSON.stringify({ type, data });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };
}

function parseCronField(field, min) {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return min % step === 0;
  }
  const val = parseInt(field, 10);
  return val === min;
}

function matchCron(cronExpr, date = new Date()) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1; // 1-indexed
  const dow = date.getDay(); // 0-6 (Sun-Sat)
  
  return parseCronField(parts[0], minute) &&
         parseCronField(parts[1], hour) &&
         parseCronField(parts[2], dom) &&
         parseCronField(parts[3], month) &&
         parseCronField(parts[4], dow);
}

export { startCronScheduler };

export function startServer(PORT, startBotCallback) {
  onResetRequest = startBotCallback;
  
  const server = http.createServer(app);
  setupWebSocketServer(server);
  
  startCronScheduler();

  setQueueUpdateCallback(() => {
    if (wsBroadcast) {
      wsBroadcast('QUEUE_UPDATE', {
        activeTasks: activeTasksList.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          speed: t.speed || '0.00'
        })),
        queue: downloadQueue.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority
        })),
        sending: botState.sendingTasks
      });
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`Web Dashboard is running at http://0.0.0.0:${PORT}`);
  });
}
