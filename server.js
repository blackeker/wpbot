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
  const user = config.dashboardUser || process.env.DASHBOARD_USER || 'admin';
  const pass = config.dashboardPass || process.env.DASHBOARD_PASS || '';

  // If no password configured, permit direct access (e.g. in development/preview environments)
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

// Secure all dashboard routes EXCEPT /watch, /downloads, static assets (/css, /js, /favicon.ico), and local /api
app.use((req, res, next) => {
  if (
    req.path.startsWith('/watch') || 
    req.path.startsWith('/downloads') || 
    req.path.startsWith('/api/') ||
    req.path.startsWith('/css/') ||
    req.path.startsWith('/js/') ||
    req.path === '/favicon.ico'
  ) {
    return next();
  }
  basicAuth(req, res, next);
});

// Serve static assets from public/ directory
app.use(express.static(path.join(path.resolve(), 'public')));


// Site-specific direct link extraction API endpoints
app.get('/api/extract', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'url query parametresi gerekli.' });
  try {
    const result = await extractVideoUrl(url);
    if (result && result.filePath) {
      const config = readConfig();
      const vdsIp = config.vdsIp || '111.235.150.157';
      const port = config.port || parseInt(process.env.PORT || '3000', 10);
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
      const port = config.port || parseInt(process.env.PORT || '3000', 10);
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

app.post('/api/send-message', async (req, res) => {
  const { jid, text, documentPath, fileName, mimetype } = req.body;
  if (!jid) return res.status(400).json({ error: 'jid gereklidir.' });

  try {
    const sock = botSocketRef.current;
    if (!sock) return res.status(503).json({ error: 'WhatsApp bot bağlı değil.' });

    let cleanJid = jid.trim();
    if (!cleanJid.includes('@')) {
      const num = cleanJid.replace(/[^0-9]/g, '');
      cleanJid = `${num}@s.whatsapp.net`;
    }

    if (documentPath && fs.existsSync(documentPath)) {
      const stream = fs.createReadStream(documentPath);
      await sock.sendMessage(cleanJid, {
        document: { stream },
        mimetype: mimetype || 'application/pdf',
        fileName: fileName || path.basename(documentPath),
        caption: text || undefined
      });
      return res.json({ ok: true, message: 'Doküman başarıyla gönderildi.' });
    }

    if (text) {
      await sock.sendMessage(cleanJid, { text });
      return res.json({ ok: true, message: 'Mesaj başarıyla gönderildi.' });
    }

    res.status(400).json({ error: 'text veya documentPath gereklidir.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// File Explorer: Helper to categorize file types
function getFileCategory(ext) {
  ext = (ext || '').toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (['.mp4', '.mkv', '.webm', '.ts', '.avi', '.mov', '.flv'].includes(ext)) return 'video';
  if (['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac', '.opus'].includes(ext)) return 'audio';
  if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'].includes(ext)) return 'archive';
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.bmp'].includes(ext)) return 'image';
  return 'other';
}

// File Explorer: List All Files
app.get('/api/files', (req, res) => {
  try {
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }
    const allEntries = fs.readdirSync(downloadsDir);
    let totalBytes = 0;
    const fileList = [];

    for (const name of allEntries) {
      if (name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.part')) continue;
      try {
        const filePath = path.join(downloadsDir, name);
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) continue;

        totalBytes += stats.size;
        const ext = path.extname(name).toLowerCase();
        fileList.push({
          name,
          ext,
          category: getFileCategory(ext),
          size: stats.size,
          sizeBytes: stats.size,
          sizeFormatted: formatBytes(stats.size),
          mtime: stats.mtime.toISOString(),
          dateFormatted: stats.mtime.toLocaleString('tr-TR'),
          downloadUrl: `/downloads/${encodeURIComponent(name)}`
        });
      } catch (e) {}
    }

    // Sort by mtime descending (newest first)
    fileList.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

    res.json({
      success: true,
      files: fileList,
      totalCount: fileList.length,
      totalBytes,
      totalBytesFormatted: formatBytes(totalBytes)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── View-Once Vault APIs ───
const viewOnceDir = path.join(downloadsDir, 'view_once');

app.get('/api/view-once', (req, res) => {
  try {
    if (!fs.existsSync(viewOnceDir)) {
      fs.mkdirSync(viewOnceDir, { recursive: true });
    }
    const entries = fs.readdirSync(viewOnceDir);
    const items = [];

    for (const name of entries) {
      if (name.endsWith('.meta.json') || name.startsWith('.')) continue;
      try {
        const filePath = path.join(viewOnceDir, name);
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) continue;

        const metaPath = `${filePath}.meta.json`;
        let meta = null;
        if (fs.existsSync(metaPath)) {
          try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          } catch (e) {}
        }

        const ext = path.extname(name).toLowerCase();
        let mediaType = 'image';
        if (['.mp4', '.mkv', '.webm', '.mov'].includes(ext)) mediaType = 'video';
        else if (['.mp3', '.m4a', '.wav', '.ogg', '.opus'].includes(ext)) mediaType = 'audio';
        else if (ext === '.pdf' || ext === '.bin' || ext === '.doc') mediaType = 'document';

        // Extract sender from filename if meta is absent (viewonce_TIMESTAMP_SENDER.ext)
        let senderNumber = meta?.senderNumber || '';
        if (!senderNumber) {
          const parts = name.split('_');
          if (parts.length >= 3) {
            senderNumber = parts[2].split('.')[0];
          }
        }

        items.push({
          filename: name,
          mediaType: meta?.mediaType || mediaType,
          ext: ext.replace('.', ''),
          sizeBytes: stats.size,
          sizeFormatted: formatBytes(stats.size),
          mtime: stats.mtime.toISOString(),
          dateFormatted: stats.mtime.toLocaleString('tr-TR'),
          downloadUrl: `/downloads/view_once/${encodeURIComponent(name)}`,
          senderNumber: senderNumber || 'Bilinmiyor',
          pushName: meta?.pushName || 'WhatsApp Kullanıcısı',
          groupName: meta?.groupName || null,
          isGroup: Boolean(meta?.isGroup),
          caption: meta?.caption || ''
        });
      } catch (e) {}
    }

    items.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

    res.json({
      success: true,
      items,
      count: items.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/view-once/:filename', (req, res) => {
  try {
    const safeFile = path.basename(req.params.filename);
    const filePath = path.join(viewOnceDir, safeFile);
    const metaPath = `${filePath}.meta.json`;

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }

    res.json({ success: true, message: 'Tek gönderimlik medya silindi.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/view-once/forward', async (req, res) => {
  const { filename, targetPhone, targetJid: customJid } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Dosya adı gereklidir.' });
  if (!botSocketRef.current) return res.status(503).json({ success: false, error: 'WhatsApp bot bağlı değil.' });

  try {
    const safeFile = path.basename(filename);
    const filePath = path.join(viewOnceDir, safeFile);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Medya dosyası bulunamadı.' });
    }

    let finalJid = customJid;
    if (!finalJid && targetPhone) {
      const clean = targetPhone.replace(/[^0-9]/g, '');
      finalJid = `${clean}@s.whatsapp.net`;
    }
    if (!finalJid) {
      const config = readConfig();
      finalJid = config.viewOnceTargetJid || config.depotGroupJid || config.adminNumber;
      if (finalJid && !finalJid.includes('@')) {
        finalJid = `${finalJid.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
      }
    }
    if (!finalJid && botSocketRef.current?.user?.id) {
      const selfNum = botSocketRef.current.user.id.split(':')[0].replace(/[^0-9]/g, '');
      finalJid = `${selfNum}@s.whatsapp.net`;
    }

    if (!finalJid) {
      return res.status(400).json({ success: false, error: 'Hedef WhatsApp numarası veya grubu bulunamadı.' });
    }

    const ext = path.extname(safeFile).toLowerCase();
    const buffer = fs.readFileSync(filePath);
    const caption = `👁️ *Tek Gönderimlik Kasa Medyası*\n📁 Dosya: ${safeFile}`;

    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      await botSocketRef.current.sendMessage(finalJid, { image: buffer, caption });
    } else if (['.mp4', '.mkv', '.webm', '.mov'].includes(ext)) {
      await botSocketRef.current.sendMessage(finalJid, { video: buffer, caption, mimetype: 'video/mp4' });
    } else if (['.mp3', '.m4a', '.wav', '.ogg', '.opus'].includes(ext)) {
      await botSocketRef.current.sendMessage(finalJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
      await botSocketRef.current.sendMessage(finalJid, { text: caption });
    } else {
      await botSocketRef.current.sendMessage(finalJid, { document: buffer, fileName: safeFile, caption, mimetype: 'application/octet-stream' });
    }

    res.json({ success: true, message: `Medya ${finalJid} adresine başarıyla iletildi.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/view-once/clear', (req, res) => {
  try {
    if (fs.existsSync(viewOnceDir)) {
      const entries = fs.readdirSync(viewOnceDir);
      for (const e of entries) {
        try { fs.unlinkSync(path.join(viewOnceDir, e)); } catch (err) {}
      }
    }
    res.json({ success: true, message: 'Tek gönderimlik medya kasası temizlendi.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// File Explorer: Rename File
app.post('/api/files/rename', (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName) {
    return res.status(400).json({ success: false, error: 'Eski ve yeni dosya adı gereklidir.' });
  }
  try {
    const safeOld = path.basename(oldName);
    let safeNew = path.basename(newName);

    if (!path.extname(safeNew) && path.extname(safeOld)) {
      safeNew += path.extname(safeOld);
    }

    const oldPath = path.join(downloadsDir, safeOld);
    const newPath = path.join(downloadsDir, safeNew);

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ success: false, error: 'Dosya bulunamadı.' });
    }
    if (fs.existsSync(newPath) && safeOld !== safeNew) {
      return res.status(400).json({ success: false, error: 'Bu isimde bir dosya zaten mevcut.' });
    }

    fs.renameSync(oldPath, newPath);
    res.json({
      success: true,
      message: 'Dosya başarıyla yeniden adlandırıldı.',
      newName: safeNew
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// File Explorer: Delete File(s)
app.post('/api/files/delete', (req, res) => {
  const { filename, filenames } = req.body;
  const filesToDelete = [];
  if (filename) filesToDelete.push(filename);
  if (Array.isArray(filenames)) filesToDelete.push(...filenames);

  if (filesToDelete.length === 0) {
    return res.status(400).json({ success: false, error: 'Silinecek dosya belirtilmedi.' });
  }

  let deletedCount = 0;
  try {
    for (const f of filesToDelete) {
      const safeFile = path.basename(f);
      const filePath = path.join(downloadsDir, safeFile);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }
    res.json({ success: true, message: `${deletedCount} dosya silindi.`, deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// File Explorer: Send File directly to WhatsApp
app.post('/api/files/send-wa', async (req, res) => {
  const { filename, phone, caption } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'filename parametresi gereklidir.' });
  if (!botSocketRef.current) {
    return res.status(400).json({ success: false, error: 'WhatsApp bot bağlantısı aktif değil.' });
  }

  try {
    const safeFile = path.basename(filename);
    const filePath = path.join(downloadsDir, safeFile);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Dosya bulunamadı.' });
    }

    const config = readConfig();
    let num = (phone || config.adminNumber || '05332624732').replace(/[^0-9]/g, '');
    if (num.startsWith('0')) num = '9' + num;
    if (num.length < 10) {
      return res.status(400).json({ success: false, error: 'Geçersiz telefon numarası.' });
    }
    const targetJid = `${num}@s.whatsapp.net`;

    const ext = path.extname(safeFile).toLowerCase();
    let mime = 'application/octet-stream';
    if (ext === '.pdf') mime = 'application/pdf';
    else if (ext === '.mp4') mime = 'video/mp4';
    else if (ext === '.mp3') mime = 'audio/mpeg';
    else if (ext === '.zip') mime = 'application/zip';

    await queueMediaSend(targetJid, () => {
      return {
        document: fs.readFileSync(filePath),
        mimetype: mime,
        fileName: safeFile,
        caption: caption || `📁 ${safeFile}`
      };
    });

    res.json({
      success: true,
      message: `"${safeFile}" WhatsApp üzerinden ${num} numarasına gönderim kuyruğuna alındı.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Queue: Cancel Task
app.post('/api/indir/cancel', (req, res) => {
  const id = req.body.id || req.body.taskId;
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
  const id = req.body.id || req.body.taskId;
  if (!id) return res.status(400).json({ error: 'id gereklidir.' });
  const result = prioritizeDownloadTask(id);
  if (result) {
    res.json({ success: true, message: 'Görev önceliklendirildi.' });
  } else {
    res.status(404).json({ error: 'Görev bulunamadı.' });
  }
});

// Queue: Task Details
app.get('/api/indir/task/:id', (req, res) => {
  const { id } = req.params;
  const active = activeTasksList.find(t => String(t.id) === String(id));
  if (active) {
    return res.json({ success: true, task: formatTaskPayload(active, true) });
  }
  const queued = downloadQueue.find(t => String(t.id) === String(id));
  if (queued) {
    return res.json({ success: true, task: formatTaskPayload(queued, false) });
  }
  return res.status(404).json({ success: false, error: 'Görev bulunamadı.' });
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

// ─── Canlı config.json Dosya Editörü API'leri ───
app.get('/api/config-raw', (req, res) => {
  try {
    const rootPath = path.resolve('./config.json');
    const sessionCfgPath = path.join(sessionPath, 'config.json');
    let rawContent = '';
    let usedFile = './config.json';

    if (fs.existsSync(rootPath)) {
      rawContent = fs.readFileSync(rootPath, 'utf8');
      usedFile = './config.json';
    } else if (fs.existsSync(sessionCfgPath)) {
      rawContent = fs.readFileSync(sessionCfgPath, 'utf8');
      usedFile = sessionCfgPath;
    } else {
      const current = readConfig(true);
      rawContent = JSON.stringify(current, null, 2);
      usedFile = './config.json (Varsayılandan üretildi)';
    }

    let parsed = null;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      parsed = readConfig(true);
    }

    res.json({
      success: true,
      raw: rawContent,
      filePath: usedFile,
      config: parsed
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/config-raw', (req, res) => {
  try {
    let rawInput = '';
    if (typeof req.body?.raw === 'string') {
      rawInput = req.body.raw;
    } else if (typeof req.body?.configJson === 'string') {
      rawInput = req.body.configJson;
    } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      rawInput = JSON.stringify(req.body, null, 2);
    }

    rawInput = rawInput.trim();
    if (!rawInput) {
      return res.status(400).json({ success: false, error: 'Gönderilen config.json içeriği boş olamaz.' });
    }

    let parsedConfig;
    try {
      parsedConfig = JSON.parse(rawInput);
    } catch (parseErr) {
      return res.status(400).json({ 
        success: false, 
        error: `JSON Sözdizimi Hatası (SyntaxError): ${parseErr.message}` 
      });
    }

    if (!parsedConfig || typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) {
      return res.status(400).json({ success: false, error: 'config.json ana kök yapısı bir JSON nesnesi (object { ... }) olmalıdır.' });
    }

    // Biçimlendirilmiş güzel JSON olarak kaydet
    const formattedJson = JSON.stringify(parsedConfig, null, 2);
    const rootPath = path.resolve('./config.json');
    const sessionCfgPath = path.join(sessionPath, 'config.json');

    // 1. Kök dizindeki config.json dosyasına yaz
    fs.writeFileSync(rootPath, formattedJson, 'utf8');

    // 2. Oturum dizinindeki config.json dosyasına da yaz
    try {
      if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
      fs.writeFileSync(sessionCfgPath, formattedJson, 'utf8');
    } catch (e) {}

    // 3. Sistem belleğini, ortam değişkenlerini ve AI konfigürasyonunu anında tazele
    writeConfig(parsedConfig);
    const freshConfig = readConfig(true);
    processQueue();
    notifyStatusUpdate();

    console.log('[CONFIG EDITOR] config.json site üzerinden başarıyla güncellendi ve uygulandı.');
    res.json({
      success: true,
      message: 'config.json başarıyla kaydedildi! Tüm sistem ayarları ve yapay zeka değişkenleri anında aktif edildi.',
      raw: formattedJson,
      config: freshConfig
    });
  } catch (err) {
    console.error('[CONFIG SAVE ERROR]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/config-raw/validate', (req, res) => {
  try {
    const rawInput = (req.body.raw || '').trim();
    if (!rawInput) {
      return res.json({ valid: false, error: 'İçerik boş.' });
    }
    const parsed = JSON.parse(rawInput);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return res.json({ valid: false, error: 'Kök eleman bir JSON nesnesi (object) olmalıdır.' });
    }
    res.json({ valid: true, keyCount: Object.keys(parsed).length });
  } catch (err) {
    res.json({ valid: false, error: err.message });
  }
});

app.post('/api/config-raw/reset', (req, res) => {
  try {
    const defaultTemplate = {
      whatsappPhoneNumber: process.env.WHATSAPP_PHONE_NUMBER || "",
      port: 3000,
      vdsIp: "111.235.150.203",
      ownerNumber: process.env.OWNER_NUMBER || "905332624732",
      depotGroupJid: "",
      viewOnceAutoForward: true,
      viewOnceTargetJid: "",
      aiChatEnabled: true,
      aiBotName: "Moi",
      geminiApiKey: process.env.GEMINI_API_KEY || "",
      geminiModel: "gemini-3.8-flash",
      groqApiKey: process.env.GROQ_API_KEY || "",
      groqModel: "qwen/qwen3.8-27b",
      openrouterApiKey: process.env.OPENROUTER_API_KEY || "",
      openrouterModel: "google/gemma-4-31b-it:free",
      ollamaUrl: "https://ollama.com",
      ollamaModel: "gemma4:31b",
      ollamaApiKey: "",
      ollamaEnabled: false,
      concurrencyLimit: 2,
      downloadRetentionHours: 4,
      maxDownloadsCacheGB: 15,
      antiBan: {
        enabled: true,
        autoRead: true,
        typingSimulation: true
      }
    };
    res.json({ success: true, template: defaultTemplate, raw: JSON.stringify(defaultTemplate, null, 2) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

// ─── Dynamic Groups & Depot Selector APIs ───
app.get('/api/groups', async (req, res) => {
  try {
    const sock = botSocketRef.current;
    const config = readConfig();
    const currentDepot = config.depotGroupJid || '';

    if (!sock) {
      return res.json({
        success: true,
        connected: false,
        depotGroupJid: currentDepot,
        groups: [],
        message: 'WhatsApp botu henüz bağlı değil. Grupları listelemek için botu bağlayın.'
      });
    }

    let groups = [];
    if (typeof sock.groupFetchAllParticipating === 'function') {
      try {
        const participating = await sock.groupFetchAllParticipating();
        groups = Object.values(participating || {}).map(g => ({
          jid: g.id,
          name: g.subject || g.id,
          participantsCount: g.participants?.length || g.size || 0,
          isCurrentDepot: g.id === currentDepot
        }));
      } catch (err) {
        console.warn('[GROUPS API] Fetch error:', err.message);
      }
    }

    // Sort: current depot first, then alphabetically
    groups.sort((a, b) => {
      if (a.isCurrentDepot) return -1;
      if (b.isCurrentDepot) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    res.json({
      success: true,
      connected: true,
      depotGroupJid: currentDepot,
      totalGroups: groups.length,
      groups
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings/depot-group', (req, res) => {
  const { depotGroupJid } = req.body;
  try {
    const cleanJid = (depotGroupJid || '').trim();
    writeConfig({ depotGroupJid: cleanJid });
    res.json({
      success: true,
      depotGroupJid: cleanJid,
      message: cleanJid ? 'Depo grubu başarıyla kaydedildi!' : 'Depo grubu kaldırıldı.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings/test-depot', async (req, res) => {
  const sock = botSocketRef.current;
  if (!sock) return res.status(503).json({ success: false, error: 'WhatsApp bot bağlı değil.' });

  const config = readConfig();
  const target = (req.body.depotGroupJid || config.depotGroupJid || '').trim();
  if (!target) return res.status(400).json({ success: false, error: 'Kayıtlı veya seçilmiş bir depo grubu bulunamadı.' });

  try {
    const timeStr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    await sock.sendMessage(target, {
      text: `📦 *WPBot Depo Grubu Bağlantı Testi*\n━━━━━━━━━━━━━━━━━━━━\n✅ Bu grup, tek gönderimlik (view-once) medyalar ve bot indirmeleri için *Aktif Depo Grubu* olarak tanımlandı.\n🕒 *Zaman:* ${timeStr}`
    });
    res.json({ success: true, message: `"${target}" grubuna test mesajı başarıyla gönderildi!` });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Mesaj gönderilemedi: ' + err.message });
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
    const ext = path.extname(resolvedFileName).toLowerCase();
    const isImg = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
    const isVid = ['.mp4', '.mkv', '.avi', '.webm', '.mov'].includes(ext);
    const resolvedMimetype = mimetype || (isImg ? `image/${ext.replace('.', '')}` : (isVid ? 'video/mp4' : 'application/octet-stream'));

    let messageContent;
    if (asDocument || fileStats.size > 100 * 1024 * 1024) {
      messageContent = {
        document: { stream: fs.createReadStream(filePath) },
        mimetype: resolvedMimetype,
        fileName: resolvedFileName,
        caption: caption || undefined
      };
    } else if (isImg) {
      messageContent = {
        image: { stream: fs.createReadStream(filePath) },
        mimetype: resolvedMimetype,
        caption: caption || undefined
      };
    } else {
      messageContent = {
        video: { stream: fs.createReadStream(filePath) },
        mimetype: resolvedMimetype,
        fileName: resolvedFileName,
        caption: caption || undefined
      };
    }

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

// Modular Dashboard Partial Renderer
function renderModularDashboard(viewsDir, port) {
  const masterPath = path.join(viewsDir, 'dashboard.html');
  let html = fs.readFileSync(masterPath, 'utf8');

  // Support includes: <!-- #include "partials/..." -->
  const includeRegex = /<!--\s*#include\s+["']([^"']+)["']\s*-->/g;
  html = html.replace(includeRegex, (match, relPath) => {
    const partialPath = path.join(viewsDir, relPath);
    if (fs.existsSync(partialPath)) {
      return fs.readFileSync(partialPath, 'utf8');
    }
    console.warn(`[DASHBOARD RENDER] Partial not found: ${relPath}`);
    return `<!-- Partial: ${relPath} bulunamadı -->`;
  });

  html = html.replace(/{{PORT}}/g, port);
  html = html.replace(/{{UPTIME}}/g, botState.uptime.toLocaleString('tr-TR'));
  return html;
}

// HTTP Server Dashboard UI
app.get('/', (req, res) => {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const viewsDir = path.join(path.resolve(), 'views');
  try {
    const html = renderModularDashboard(viewsDir, PORT);
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

export function formatTaskPayload(t, isActive = false) {
  let source = 'Genel Web';
  const url = (t.url || '').toLowerCase();
  if (url.includes('youtube.com') || url.includes('youtu.be')) source = 'YouTube';
  else if (url.includes('mangaportali.com')) source = 'MangaPortalı';
  else if (url.includes('hentaizm.fun') || url.includes('hentaizm')) source = 'HentaiZM';
  else if (url.includes('animecix.net')) source = 'Animecix';
  else if (url.includes('hdfilmcehennemi')) source = 'HDFilmCehennemi';
  else if (url.includes('hdkore')) source = 'HDKore';
  else if (url.includes('sezonlukdizi')) source = 'SezonlukDizi';
  else if (url.includes('pornhub')) source = 'Pornhub';
  else if (url.includes('magnet:') || url.endsWith('.torrent')) source = 'Torrent';

  let recipientFormatted = t.recipientJid || 'Bilinmiyor';
  if (recipientFormatted.includes('@')) {
    recipientFormatted = recipientFormatted.split('@')[0];
  }

  return {
    id: t.id,
    title: t.title || 'İndirme Görevi',
    url: t.url,
    source,
    recipientJid: t.recipientJid,
    recipientFormatted,
    status: t.status,
    statusText: t.statusText || (isActive ? (t.status || 'İşleniyor...') : 'Kuyrukta bekliyor'),
    speed: t.speed || null,
    sizeMB: t.sizeMB || null,
    priority: !!t.priority,
    format: t.format || null,
    addedTime: t.addedTime ? new Date(t.addedTime).toISOString() : null,
    startTime: t.startTime ? new Date(t.startTime).toISOString() : null,
    episodeBatch: t.episodeBatch || null,
    seriesPack: t.seriesPack || null,
    audioTrack: t.audioTrack || null,
    burnSubtitles: !!t.burnSubtitles,
    isActive
  };
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
        activeTasks: activeTasksList.map(t => formatTaskPayload(t, true)),
        queue: downloadQueue.map(t => formatTaskPayload(t, false)),
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
        activeTasks: activeTasksList.map(t => formatTaskPayload(t, true)),
        queue: downloadQueue.map(t => formatTaskPayload(t, false)),
        sending: botState.sendingTasks
      });
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`Web Dashboard is running at http://0.0.0.0:${PORT}`);
  });
}
