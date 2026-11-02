import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USAGE_FILE = path.resolve(__dirname, '../data/daily_usage.json');

const cooldowns = new Map();
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// ─── Bellek İçi Günlük Kullanım Takipçisi ───
let dailyUsageData = {};

function getTodayKey() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istanbulTime = new Date(utc + (3600000 * 3));
  const y = istanbulTime.getFullYear();
  const m = String(istanbulTime.getMonth() + 1).padStart(2, '0');
  const d = String(istanbulTime.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadDailyUsage() {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      const raw = fs.readFileSync(USAGE_FILE, 'utf-8');
      dailyUsageData = JSON.parse(raw);
    } else {
      dailyUsageData = {};
    }
  } catch (e) {
    dailyUsageData = {};
  }
}

function saveDailyUsage() {
  try {
    const dir = path.dirname(USAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(dailyUsageData, null, 2), 'utf-8');
  } catch (e) {
    console.error('[CooldownManager] Günlük kullanım verisi kaydedilemedi:', e.message);
  }
}

// Başlangıçta yükle
loadDailyUsage();

/**
 * Belirli bir özelliğin/komutun bugün bu hedefte (grup veya kullanıcı) kullanılıp kullanılmadığını kontrol eder.
 * @param {string} feature - Özellik veya komut adı (örn: 'yemek')
 * @param {string} targetId - Grup JID veya Kullanıcı JID
 * @returns {boolean} - Bugün kullanıldıysa true, kullanılmadıysa false
 */
export function hasUsedToday(feature, targetId) {
  if (!feature || !targetId) return false;
  const today = getTodayKey();
  const key = `${feature}:${targetId}`;
  return Boolean(dailyUsageData[today] && dailyUsageData[today][key]);
}

/**
 * Özelliğin bugün bu hedefte kullanıldığını işaretler.
 * @param {string} feature - Özellik veya komut adı (örn: 'yemek')
 * @param {string} targetId - Grup JID veya Kullanıcı JID
 */
export function markUsedToday(feature, targetId) {
  if (!feature || !targetId) return;
  const today = getTodayKey();
  if (!dailyUsageData[today]) {
    // Eski günleri temizle (disk şişmesin)
    dailyUsageData = { [today]: {} };
  }
  const key = `${feature}:${targetId}`;
  dailyUsageData[today][key] = Date.now();
  saveDailyUsage();
}

/**
 * Checks if a command is on cooldown for a specific chat.
 * @param {string} commandName - Name of the command.
 * @param {string} chatId - JID of the chat/user.
 * @returns {number|null} - Remaining seconds if on cooldown, otherwise null.
 */
export function checkCooldown(commandName, chatId) {
  const key = `${commandName}:${chatId}`;
  const now = Date.now();
  const lastUsed = cooldowns.get(key);

  if (lastUsed) {
    const elapsed = now - lastUsed;
    if (elapsed < DEFAULT_COOLDOWN_MS) {
      return Math.ceil((DEFAULT_COOLDOWN_MS - elapsed) / 1000);
    }
  }

  return null;
}

/**
 * Updates the last used timestamp for a command in a specific chat.
 * @param {string} commandName - Name of the command.
 * @param {string} chatId - JID of the chat/user.
 */
export function updateCooldown(commandName, chatId) {
  const key = `${commandName}:${chatId}`;
  cooldowns.set(key, Date.now());
}
