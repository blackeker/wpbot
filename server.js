import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { gotScraping } from 'got-scraping';

import { 
  botState, 
  downloadsDir, 
  botSocketRef, 
  pairingState, 
  sessionPath,
  readConfig,
  writeConfig,
  setupPingTimer,
  formatBytes
} from './config.js';

import { 
  downloadQueue, 
  activeTask, 
  addDownloadTask, 
  cancelDownloadTask,
  clearQueue,
  pauseQueue,
  resumeQueue,
  queueState
} from './queue.js';

import { executeDownloadPipeline } from './pipelines.js';
import { getAnimecixSeasonEpisodes, getHdfilmcehennemiSeasonEpisodes, getHdkoreSeasonEpisodes } from './extractor.js';

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
  const user = process.env.DASHBOARD_USER || 'admin';
  const pass = process.env.DASHBOARD_PASS;

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

// Local API: trigger a download task (only accessible from localhost)
app.post('/api/indir', (req, res) => {
  const ip = getClientIp(req);
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) return res.status(403).json({ error: 'Sadece localhost erişebilir.' });

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
  const ip = getClientIp(req);
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) return res.status(403).json({ error: 'Sadece localhost erişebilir.' });
  const count = clearQueue();
  res.json({ ok: true, message: `${count} görev silindi.` });
});

app.post('/api/kuyruk-duraklat', (req, res) => {
  const ip = getClientIp(req);
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) return res.status(403).json({ error: 'Sadece localhost erişebilir.' });
  pauseQueue();
  res.json({ ok: true, message: 'Kuyruk duraklatıldı.' });
});

app.post('/api/kuyruk-devam', (req, res) => {
  const ip = getClientIp(req);
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) return res.status(403).json({ error: 'Sadece localhost erişebilir.' });
  resumeQueue();
  res.json({ ok: true, message: 'Kuyruk devam ediyor.' });
});

app.get('/api/fetch-episodes', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parametresi gerekli.' });

  try {
    let result;
    if (url.includes('animecix') || url.includes('ecchicix')) {
      const data = await getAnimecixSeasonEpisodes(url);
      result = { seriesName: data.animeName, episodes: data.episodes };
    } else if (url.includes('hdfilmcehennemi')) {
      const data = await getHdfilmcehennemiSeasonEpisodes(url);
      result = { seriesName: data.seriesName, episodes: data.episodes };
    } else if (url.includes('hdkore')) {
      const data = await getHdkoreSeasonEpisodes(url);
      result = { seriesName: data.seriesName, episodes: data.episodes };
    } else {
      return res.status(400).json({ error: 'Bu site dizi/sezon indirmeyi desteklemiyor veya geçersiz URL.' });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  res.json({
    status: botState.status,
    qrCodeUrl: botState.qrCodeUrl,
    pairingCode: botState.pairingCode,
    pingUrl: botState.pingUrl,
    activeTasks: botState.activeTasks,
    sendingTasks: botState.sendingTasks,
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

export function startServer(PORT, startBotCallback) {
  onResetRequest = startBotCallback;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web Dashboard is running at http://0.0.0.0:${PORT}`);
  });
}
