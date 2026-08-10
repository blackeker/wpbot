import fs from 'fs';
import path from 'path';
import { gotScraping } from 'got-scraping';
import { Cookie } from 'tough-cookie';

export const sessionPath = process.env.SESSION_PATH || './auth_info_session';
export const configPath = path.join(sessionPath, 'config.json');
export const downloadsDir = path.resolve('./downloads');
export const historyPath = path.join(sessionPath, 'history.json');
export const errorLogPath = path.join(sessionPath, 'errors.json');

// Ensure directories exist
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}
if (!fs.existsSync(sessionPath)) {
  fs.mkdirSync(sessionPath, { recursive: true });
}

// Config file reader/writer helpers
export function readConfig() {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

export function writeConfig(data) {
  const current = readConfig();
  const updated = { ...current, ...data };
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf8');
}

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

export function cleanOldDownloads() {
  const expiryTime = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();
  try {
    if (!fs.existsSync(downloadsDir)) return;
    const files = fs.readdirSync(downloadsDir);
    for (const file of files) {
      if (file === '.gitignore' || file === 'placeholder') continue;
      const filePath = path.join(downloadsDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > expiryTime) {
        fs.unlinkSync(filePath);
        console.log(`[CLEANUP] Deleted old download: ${file}`);
      }
    }
  } catch (err) {
    console.error('[CLEANUP] Error during cleanup:', err.message);
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
