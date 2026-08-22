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
  setQueueUpdateCallback
} from './queue.js';

import { executeDownloadPipeline } from './pipelines.js';
import { getAnimecixSeasonEpisodes, getHdfilmcehennemiSeasonEpisodes, getHdkoreSeasonEpisodes, extractVideoUrl } from './extractor.js';

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

// Captcha management state
export const activeCaptchasMap = new Map();
let captchaCounter = 0;
export const sentCaptchasSet = new Set();

// Start background captcha poller
export function startCaptchaPoller() {
  setInterval(async () => {
    try {
      if (!botSocketRef.current) return;

      const response = await axios.get('http://127.0.0.1:8181/api/captcha');
      const data = response.data;
      if (data.success && data.captchas && data.captchas.length > 0) {
        for (const cap of data.captchas) {
          if (!sentCaptchasSet.has(cap.messageId)) {
            sentCaptchasSet.add(cap.messageId);

            captchaCounter++;
            const durumKodu = String(captchaCounter);

            activeCaptchasMap.set(durumKodu, { 
              messageId: cap.messageId, 
              username: cap.username, 
              accountType: cap.account, 
              token: cap.token, 
              channelId: cap.channelId 
            });

            const targetJid = '905332624732@s.whatsapp.net';

            let infoText = `⚠️ *YENİ CAPTCHA BELİRDİ! (Poller)* ⚠️\n\n`;
            infoText += `👤 *Hesap:* ${cap.username} (${cap.account === 'main' ? 'Ana Hesap' : 'Yan Hesap'})\n`;
            infoText += `🔑 *Durum Kodu (Sıra No):* *${durumKodu}*\n\n`;
            infoText += `💬 *Çözmek için:* \n\`!çöz ${durumKodu} KOD\` yazıp gönderin.`;

            if (cap.localImageUrl) {
              const imgUrl = `http://127.0.0.1:8181${cap.localImageUrl}`;
              const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer' }).catch(() => null);
              if (imgRes && imgRes.status === 200) {
                await botSocketRef.current.sendMessage(targetJid, { 
                  image: Buffer.from(imgRes.data), 
                  caption: infoText 
                });
              } else {
                await botSocketRef.current.sendMessage(targetJid, { text: infoText + `\n\n⚠️ Resim indirilemedi.` });
              }
            } else {
              await botSocketRef.current.sendMessage(targetJid, { text: infoText });
            }
          }
        }
      }
    } catch (err) {
      // Ignore network errors with Discord bot offline
    }
  }, 19000);
}

// Site-specific direct link extraction API endpoints
app.get('/api/extract', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'url query parametresi gerekli.' });
  try {
    const result = await extractVideoUrl(url);
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

    const result = await extractVideoUrl(url);
    res.json({ success: true, site, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Local API: trigger a download task (accessible publicly)
app.post('/api/indir', (req, res) => {
  const { url, jid } = req.body;
  if (!url || !jid) return res.status(400).json({ error: 'url ve jid gerekli.' });

  try {
    const task = addDownloadTask(url, jid, url);
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
  const { episodes, jid } = req.body;
  if (!episodes || !Array.isArray(episodes) || !jid) {
    return res.status(400).json({ error: 'episodes ve jid gerekli.' });
  }

  let addedCount = 0;
  let skippedCount = 0;
  for (const ep of episodes) {
    try {
      addDownloadTask(ep.url, jid, ep.name);
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

  const targetJid = '905332624732@s.whatsapp.net';

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
  if (cleanPhone.length < 10) return res.status(400).json({ error: 'Geçersiz telefon numarası.' });

  try {
    pairingState.isPairingMode = true;
    pairingState.pairingPhoneNumber = cleanPhone;
    botState.pairingNumber = cleanPhone;
    botState.pairingCode = null;
    botState.pairingMode = true;
    botState.qrCodeUrl = null;
    botState.status = 'connecting';

    console.log(`[PAIRING] Temiz başlatma — numara: ${cleanPhone}`);

    if (botSocketRef.current) {
      try { botSocketRef.current.end(new Error('Pairing mode restart')); } catch(e) {}
      botSocketRef.current = null;
    }

    fs.rmSync(sessionPath, { recursive: true, force: true });
    fs.mkdirSync(sessionPath, { recursive: true });

    if (onResetRequest) {
      setTimeout(() => onResetRequest(), 1500);
    }

    return res.json({ success: true, message: 'Pairing code isteniyor, 5-10 saniye bekleyin...' });
  } catch (err) {
    console.error('Pairing request error:', err);
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

import { cleanOldDownloads } from './config.js';

export function startCronScheduler() {
  console.log('[CRON] Zamanlanmış otomasyon motoru başlatıldı.');
  setInterval(() => {
    try {
      const config = readConfig();
      const schedules = config.cronSchedules || [];
      const now = new Date();
      
      for (const sched of schedules) {
        if (sched.active && matchCron(sched.cron, now)) {
          console.log(`[CRON] Zamanlanmış görev tetiklendi: ${sched.name} (${sched.action})`);
          if (sched.action === 'cleanup') {
            try {
              cleanOldDownloads();
              console.log(`[CRON] ${sched.name} başarıyla tamamlandı.`);
            } catch (err) {
              console.error(`[CRON] ${sched.name} yürütülürken hata oluştu:`, err.message);
            }
          }
        }
      }
    } catch (e) {
      console.error('[CRON Scheduler Loop Error]', e.message);
    }
  }, 60000); // Check every minute
}

export function startServer(PORT, startBotCallback) {
  onResetRequest = startBotCallback;
  
  const server = http.createServer(app);
  setupWebSocketServer(server);
  
  startCronScheduler(); // Start cron studio background loop

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
    console.log(`Web Dashboard is running at http://0.0.0.0:${PORT}`);
  });
}
