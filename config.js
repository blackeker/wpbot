import fs from 'fs';
import path from 'path';
import { gotScraping } from 'got-scraping';
import { Cookie } from 'tough-cookie';
import { fileLogger } from './utils/logger.js';

export const sessionPath = process.env.SESSION_PATH || './auth_info_session';
export const configPath = path.join(sessionPath, 'config.json');
export const downloadsDir = path.resolve('./downloads');
export const historyPath = path.join(sessionPath, 'history.json');
export const errorLogPath = path.join(sessionPath, 'errors.json');
export const sentMessageIds = new Set();
export function addSentMessageId(id) {
  if (!id) return;
  sentMessageIds.add(id);
  if (sentMessageIds.size > 2000) {
    const firstKey = sentMessageIds.values().next().value;
    sentMessageIds.delete(firstKey);
  }
}

// Ensure directories exist
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}
if (!fs.existsSync(sessionPath)) {
  fs.mkdirSync(sessionPath, { recursive: true });
}

export async function cleanLeftoverCacheFiles() {
  try {
    const rootFiles = fs.readdirSync('.');
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours

    for (const file of rootFiles) {
      if (file.startsWith('.hdwp_cache_')) {
        const filePath = path.resolve(file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory() && (now - stats.mtimeMs > maxAge)) {
            fs.rmSync(filePath, { recursive: true, force: true });
            console.log(`[CLEANUP] Leftover cache directory deleted: ${file}`);
          }
        } catch (err) {}
      }
    }

    if (fs.existsSync(downloadsDir)) {
      const dlFiles = fs.readdirSync(downloadsDir);
      for (const file of dlFiles) {
        if (file.endsWith('.part') || file.includes('.part')) {
          const filePath = path.join(downloadsDir, file);
          try {
            const stats = fs.statSync(filePath);
            if (stats.isFile() && (now - stats.mtimeMs > maxAge)) {
              fs.unlinkSync(filePath);
              console.log(`[CLEANUP] Leftover part file deleted: ${file}`);
            }
          } catch (err) {}
        }
      }
    }
    try {
      const { clearExpiredCache } = await import('./cache.js');
      clearExpiredCache();
    } catch (e) {}
  } catch (e) {
    console.error('[CLEANUP] Önbellek temizleme hatası:', e.message);
  }
}

// Run immediately and every 6 hours
cleanLeftoverCacheFiles();
setInterval(cleanLeftoverCacheFiles, 6 * 60 * 60 * 1000);

// Config file reader/writer helpers with full defaults
const DEFAULT_CONFIG = {
  whatsappPhoneNumber: process.env.WHATSAPP_PHONE_NUMBER || "905052761405",
  port: parseInt(process.env.PORT || "7860", 10),
  vdsIp: process.env.VDS_IP || "111.235.150.157",
  pingUrl: process.env.PING_URL || "",
  proxyUrl: process.env.PROXY_URL || "",
  proxyList: "",
  downloadRetentionHours: parseFloat(process.env.DOWNLOAD_MAX_AGE_HOURS || "4"),
  maxDownloadsCacheGB: parseFloat(process.env.MAX_DOWNLOADS_CACHE_GB || "15"),
  concurrencyLimit: parseInt(process.env.CONCURRENCY_LIMIT || "1", 10),
  burnSubtitles: process.env.BURN_SUBTITLES === 'true',
  autoCleanAfterSend: true,
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  dashboardUser: process.env.DASHBOARD_USER || "admin",
  dashboardPass: process.env.DASHBOARD_PASS || "",
  adminJids: process.env.ADMIN_JIDS || "",
  customCommands: {},
  depotGroupJid: "",
  groupJid: "",
  cronSchedules: [
    { id: "cleanup", name: "Disk Temizliği", cron: "0 4 * * *", action: "cleanup", active: true }
  ]
};

let cachedConfig = null;

export function readConfig() {
  if (cachedConfig) return cachedConfig;
  let config = { ...DEFAULT_CONFIG };
  if (fs.existsSync(configPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = { ...config, ...saved };
    } catch (e) {
      // Return default on parse failure
    }
  }
  // Initialize env values from config for libraries checking process.env
  if (config.proxyUrl) {
    process.env.PROXY_URL = config.proxyUrl;
  }
  if (config.downloadRetentionHours) {
    process.env.DOWNLOAD_MAX_AGE_HOURS = String(config.downloadRetentionHours);
  }
  if (config.maxDownloadsCacheGB) {
    process.env.MAX_DOWNLOADS_CACHE_GB = String(config.maxDownloadsCacheGB);
  }
  cachedConfig = config;
  return config;
}

export function writeConfig(data) {
  const current = readConfig();
  const updated = { ...current, ...data };
  cachedConfig = updated;
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf8');
  
  // Update process.env variables immediately
  if (updated.proxyUrl) process.env.PROXY_URL = updated.proxyUrl;
  else delete process.env.PROXY_URL;
  
  if (updated.downloadRetentionHours) process.env.DOWNLOAD_MAX_AGE_HOURS = String(updated.downloadRetentionHours);
  if (updated.maxDownloadsCacheGB) process.env.MAX_DOWNLOADS_CACHE_GB = String(updated.maxDownloadsCacheGB);
}

let proxyPoolIndex = 0;

export function getProxyUrl() {
  const config = readConfig();
  if (config.proxyList && config.proxyList.trim() !== "") {
    const list = config.proxyList.split(',').map(p => p.trim()).filter(Boolean);
    if (list.length > 0) {
      const proxy = list[proxyPoolIndex % list.length];
      proxyPoolIndex++;
      return proxy;
    }
  }
  return config.proxyUrl || process.env.PROXY_URL || "";
}

// ─── Real-time Log Forwarder Hook System ───
export const logQueue = [];
const MAX_LOGS_LIMIT = 500;
let logEmitter = null;

export function setLogEmitter(emitter) {
  logEmitter = emitter;
}

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

// Initialize markdown logger for 'npm run dev'
let devLogFilePath = null;
const isDevMode = process.env.npm_lifecycle_event === 'dev';

if (isDevMode) {
  try {
    const logsDir = path.resolve('./logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const day = pad(now.getDate());
    const month = pad(now.getMonth() + 1);
    const year = now.getFullYear();
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());

    // Slashes are illegal in file names, so we use '.' for dates and '-' for times
    const logFileName = `${day}.${month}.${year}---${hours}-${minutes}-${seconds}.md`;
    devLogFilePath = path.join(logsDir, logFileName);

    fs.writeFileSync(
      devLogFilePath,
      `# HDWP Bot Dev Session Log - ${day}/${month}/${year} ${hours}:${minutes}:${seconds}\n\n` +
      `| Zaman | Tip | Log Mesajı |\n` +
      `| --- | --- | --- |\n`,
      'utf8'
    );
  } catch (e) {
    originalError('[LOG INIT ERROR] Failed to initialize file logging:', e.message);
  }
}

function handleLogIntercept(type, args) {
  const text = args.map(arg => {
    if (typeof arg === 'object') {
      try { return JSON.stringify(arg); } catch (e) { return String(arg); }
    }
    return String(arg);
  }).join(' ');
  
  const time = new Date().toLocaleTimeString('tr-TR');
  const logEntry = { type, time, text };
  
  logQueue.push(logEntry);
  if (logQueue.length > MAX_LOGS_LIMIT) {
    logQueue.shift();
  }
  
  if (logEmitter) {
    try { logEmitter(logEntry); } catch (e) {}
  }

  try {
    const loggerFunc = fileLogger[type === 'error' ? 'error' : type === 'warn' ? 'warn' : 'info'];
    loggerFunc.call(fileLogger, text);
  } catch (e) {
    // Silent catch
  }

  if (devLogFilePath) {
    try {
      const cleanText = text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
      const typeUpper = type.toUpperCase();
      fs.appendFileSync(devLogFilePath, `| ${time} | **${typeUpper}** | ${cleanText} |\n`, 'utf8');
    } catch (e) {
      // Silent catch to prevent infinite recursion on error logging
    }
  }
}

console.log = (...args) => {
  originalLog(...args);
  handleLogIntercept('info', args);
};

console.error = (...args) => {
  originalError(...args);
  handleLogIntercept('error', args);
};

console.warn = (...args) => {
  originalWarn(...args);
  handleLogIntercept('warn', args);
};

// Global Bot Socket reference to avoid circular dependencies
export const botSocketRef = {
  current: null
};

// Shared state for pairing mode (process level)
export const pairingState = {
  isPairingMode: false,
  pairingPhoneNumber: process.env.WHATSAPP_PHONE_NUMBER || "905052761405"
};

// Main Shared Bot State
export const botState = {
  status: 'connecting',
  qrCodeUrl: null,
  pairingCode: null,
  pairingMode: false,
  pairingNumber: process.env.WHATSAPP_PHONE_NUMBER || "905052761405",
  uptime: new Date(),
  pingUrl: readConfig().pingUrl || process.env.PING_URL || process.env.RENDER_EXTERNAL_URL || '',
  activeTasks: [],
  sendingTasks: []
};

// Ping timer state
let pingIntervalId = null;

export function setupPingTimer(url) {
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }

  if (url) {
    console.log(`Setting up auto-ping system. Pinging: ${url} every 2 minutes.`);
    pingIntervalId = setInterval(async () => {
      try {
        console.log(`Sending keep-alive ping to ${url}...`);
        await gotScraping.get({ url });
      } catch (err) {
        console.error(`Keep-alive ping failed:`, err.message);
      }
    }, 120000);
  }
}

// Basic formatting helpers
export function getProgressBar(percent) {
  const totalBlocks = 10;
  const filledBlocks = Math.min(totalBlocks, Math.max(0, Math.round((percent / 100) * totalBlocks)));
  const emptyBlocks = totalBlocks - filledBlocks;
  return '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
}

export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function getYtDlpCommand() {
  if (process.platform === 'win32') {
    if (fs.existsSync('./bin/yt-dlp.exe')) return path.resolve('./bin/yt-dlp.exe');
    if (fs.existsSync('./yt-dlp.exe')) return path.resolve('./yt-dlp.exe');
    return 'yt-dlp';
  } else {
    if (fs.existsSync('./bin/yt-dlp')) return path.resolve('./bin/yt-dlp');
    if (fs.existsSync('./yt-dlp')) return path.resolve('./yt-dlp');
    return 'yt-dlp';
  }
}

export async function cleanOldDownloads() {
  // Yapılandırılabilir saklama süresi (varsayılan: 4 saat veya .env DOWNLOAD_MAX_AGE_HOURS)
  const maxAgeHours = parseFloat(process.env.DOWNLOAD_MAX_AGE_HOURS || '4');
  const expiryTime = maxAgeHours * 60 * 60 * 1000;
  // Yapılandırılabilir maksimum disk önbellek limiti (varsayılan: 15 GB veya .env MAX_DOWNLOADS_CACHE_GB)
  const maxCacheBytes = parseFloat(process.env.MAX_DOWNLOADS_CACHE_GB || '15') * 1024 * 1024 * 1024;
  const now = Date.now();

  let activeList = [];
  try {
    const queueModule = await import('./queue.js');
    activeList = queueModule.activeTasksList || [];
  } catch (e) {}

  try {
    if (!fs.existsSync(downloadsDir)) return;
    const entries = fs.readdirSync(downloadsDir);
    const fileStats = [];
    let totalBytes = 0;

    for (const file of entries) {
      if (file === '.gitignore' || file === 'placeholder') continue;
      const filePath = path.join(downloadsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) continue;

        // Aktif indirilen veya gönderilen dosyaları koru
        const isActive = activeList.some(task => {
          if (!task.title) return false;
          const safe = task.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          const cleanF = file.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          return cleanF.includes(safe);
        });

        // 1. Yarım kalmış veya geçici artık dosyaları temizle (.part, .ytdl, .tmp, segment_ vb.)
        const isTemp = file.endsWith('.part') || file.endsWith('.ytdl') || file.endsWith('.tmp') || 
                       file.startsWith('temp_') || file.startsWith('segment_') || file.startsWith('hentaizm_captcha_');

        if (isTemp && (now - stat.mtimeMs > 15 * 60 * 1000)) {
          fs.unlinkSync(filePath);
          console.log(`[CLEANUP] Silindi (Yetim geçici dosya): ${file}`);
          continue;
        }

        // 2. Belirlenen maksimum yaştan eski dosyaları temizle
        if (now - stat.mtimeMs > expiryTime && !isActive) {
          fs.unlinkSync(filePath);
          console.log(`[CLEANUP] Silindi (Süresi dolan dosya > ${maxAgeHours} saat): ${file}`);
          continue;
        }

        totalBytes += stat.size;
        if (!isActive) {
          fileStats.push({ name: file, path: filePath, size: stat.size, mtime: stat.mtimeMs });
        }
      } catch {}
    }

    // 3. Disk kotası kontrolü: Toplam boyut limiti aşarsa en eski dosyalardan başlayarak temizle
    if (totalBytes > maxCacheBytes) {
      console.log(`[CLEANUP] İndirme önbelleği (${formatBytes(totalBytes)}) sınırı (${formatBytes(maxCacheBytes)}) aştı. En eski dosyalar temizleniyor...`);
      fileStats.sort((a, b) => a.mtime - b.mtime); // En eskiler başta

      const targetSize = maxCacheBytes * 0.7; // %70 seviyesine kadar düşür
      for (const item of fileStats) {
        if (totalBytes <= targetSize) break;
        try {
          fs.unlinkSync(item.path);
          totalBytes -= item.size;
          console.log(`[CLEANUP] Kota tahliyesi: ${item.name} (${formatBytes(item.size)}) silindi.`);
        } catch (e) {
          console.error(`[CLEANUP] Dosya silinemedi (${item.name}):`, e.message);
        }
      }
    }
  } catch (err) {
    console.error('[CLEANUP] Temizlik sırasında hata:', err.message);
  }
}

// ─── Download History ───
export function readHistory() {
  if (fs.existsSync(historyPath)) {
    try { return JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch { return []; }
  }
  return [];
}

export function addHistory(entry) {
  const history = readHistory();
  history.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (history.length > 100) history.length = 100; // Max 100 kayit
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
}

// ─── Error Log ───
export function readErrorLog() {
  if (fs.existsSync(errorLogPath)) {
    try { return JSON.parse(fs.readFileSync(errorLogPath, 'utf8')); } catch { return []; }
  }
  return [];
}

export function addErrorLog(entry) {
  const errors = readErrorLog();
  errors.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (errors.length > 50) errors.length = 50;
  fs.writeFileSync(errorLogPath, JSON.stringify(errors, null, 2), 'utf8');
}

// ─── Disk Usage ───
export function getDiskUsage(dir = downloadsDir) {
  let totalBytes = 0;
  const files = [];
  if (!fs.existsSync(dir)) return { totalBytes: 0, files: [] };
  const entries = fs.readdirSync(dir);
  for (const file of entries) {
    if (file === '.gitignore' || file === 'placeholder') continue;
    const fp = path.join(dir, file);
    try {
      const stat = fs.statSync(fp);
      totalBytes += stat.size;
      files.push({ name: file, size: stat.size, mtime: stat.mtimeMs });
    } catch {}
  }
  files.sort((a, b) => b.size - a.size);
  return { totalBytes, files };
}

export const pendingHentaizmLogins = {};

// ─── Baileys Session Backup & Restore ───
export const backupDir = path.resolve('./session_backup');
export const backupCredsFile = path.join(backupDir, 'creds.json');
export const sessionCredsFile = path.join(sessionPath, 'creds.json');

export function backupSession() {
  try {
    if (fs.existsSync(sessionCredsFile)) {
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      fs.copyFileSync(sessionCredsFile, backupCredsFile);
      console.log('[SESSION] Baileys session credentials backup created successfully.');
    }
  } catch (err) {
    console.error('[SESSION] Session backup failed:', err.message);
  }
}

export function restoreSession() {
  try {
    if (!fs.existsSync(sessionCredsFile) && fs.existsSync(backupCredsFile)) {
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }
      fs.copyFileSync(backupCredsFile, sessionCredsFile);
      console.log('[SESSION] Baileys session credentials restored from backup.');
      return true;
    }
  } catch (err) {
    console.error('[SESSION] Session restore failed:', err.message);
  }
  return false;
}

export function validateEnv() {
  const phone = process.env.WHATSAPP_PHONE_NUMBER;
  if (phone && !/^\d+$/.test(phone)) {
    console.warn(`[VALIDATION] WHATSAPP_PHONE_NUMBER '${phone}' sadece rakamlardan oluşmalıdır.`);
  }
  const port = process.env.PORT;
  if (port && isNaN(Number(port))) {
    console.warn(`[VALIDATION] PORT '${port}' geçerli bir sayı olmalıdır.`);
  }
  const maxAge = process.env.DOWNLOAD_MAX_AGE_HOURS;
  if (maxAge && isNaN(Number(maxAge))) {
    console.warn(`[VALIDATION] DOWNLOAD_MAX_AGE_HOURS '${maxAge}' geçerli bir sayı olmalıdır.`);
  }
  const maxCache = process.env.MAX_DOWNLOADS_CACHE_GB;
  if (maxCache && isNaN(Number(maxCache))) {
    console.warn(`[VALIDATION] MAX_DOWNLOADS_CACHE_GB '${maxCache}' geçerli bir sayı olmalıdır.`);
  }
}

// Run validation
validateEnv();

