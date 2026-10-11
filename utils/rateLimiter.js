/**
 * rateLimiter.js
 * 
 * Merkezi rate limit + premium kullanıcı yönetimi.
 * Premium kullanıcılar tüm limitlerden muaf.
 * Veriler config.json içine kaydedilir (premium listesi kalıcı).
 * Rate limit sayaçları in-memory (bot restart'ta sıfırlanır).
 */

import { readConfig, writeConfig } from '../config.js';

// ─── In-Memory Rate Limit Store ─────────────────────────────────────────────
// { "phone@s.whatsapp.net": { "cmdName": { count: N, date: "YYYY-MM-DD" } } }
const rateLimitStore = new Map();

// ─── Group Command Cooldown (son N mesaj) ───────────────────────────────────
// { "groupJid": { "cmdName": lastMsgIndex } }
const groupCmdMsgIndex = new Map();
// { "groupJid": msgCount }
const groupMsgCounter = new Map();

// Gün damgası  (Türkiye UTC+3)
function today() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10); // "2024-10-10"
}

// ─── Numara normalize ───────────────────────────────────────────────────────
export function normalizePhone(jid) {
  if (!jid) return '';
  // 905332624732@s.whatsapp.net veya 55865277190156@lid → sadece rakam kısımı
  return jid.split('@')[0];
}

// ─── Premium Yönetimi ───────────────────────────────────────────────────────

/** Premium kullanıcıları config'den oku */
export function getPremiumUsers() {
  const cfg = readConfig();
  return Array.isArray(cfg.premiumUsers) ? cfg.premiumUsers : [];
}

/** Telefon numarası premium mi? */
export function isPremium(jidOrPhone) {
  const num = normalizePhone(jidOrPhone);
  return getPremiumUsers().some(p => normalizePhone(p) === num);
}

/** Premium kullanıcı ekle */
export function addPremiumUser(phone) {
  const cleaned = normalizePhone(phone);
  if (!cleaned) return false;
  const current = getPremiumUsers();
  if (current.some(p => normalizePhone(p) === cleaned)) return false; // zaten var
  writeConfig({ premiumUsers: [...current, cleaned] });
  return true;
}

/** Premium kullanıcı çıkar */
export function removePremiumUser(phone) {
  const cleaned = normalizePhone(phone);
  const current = getPremiumUsers();
  const updated = current.filter(p => normalizePhone(p) !== cleaned);
  if (updated.length === current.length) return false; // bulunamadı
  writeConfig({ premiumUsers: updated });
  return true;
}

// ─── DM / Genel Günlük Rate Limit ───────────────────────────────────────────

/**
 * Kullanıcının bu komutu bugün kaç kez kullandığını döner.
 * @param {string} jid - gönderen JID
 * @param {string} cmd - komut adı
 */
function getUsageCount(jid, cmd) {
  const phone = normalizePhone(jid);
  const userMap = rateLimitStore.get(phone) || {};
  const entry = userMap[cmd];
  if (!entry || entry.date !== today()) return 0;
  return entry.count;
}

/**
 * Kullanım sayacını artır.
 */
function incrementUsage(jid, cmd) {
  const phone = normalizePhone(jid);
  const userMap = rateLimitStore.get(phone) || {};
  const prev = userMap[cmd];
  const date = today();
  userMap[cmd] = {
    count: (prev && prev.date === date ? prev.count : 0) + 1,
    date
  };
  rateLimitStore.set(phone, userMap);
}

/**
 * Günlük limit kontrolü.
 * @param {string} jid - gönderen JID (DM için from, grup için participant)
 * @param {string} cmd - komut adı
 * @param {number} dailyLimit - günlük maksimum kullanım (default 3)
 * @returns {{ allowed: boolean, remaining: number, limit: number }}
 */
export function checkDailyLimit(jid, cmd, dailyLimit = 3) {
  // Premium kullanıcı → her zaman izinli
  if (isPremium(jid)) {
    return { allowed: true, remaining: Infinity, limit: dailyLimit, premium: true };
  }

  const used = getUsageCount(jid, cmd);
  const remaining = Math.max(0, dailyLimit - used);
  return {
    allowed: used < dailyLimit,
    remaining,
    limit: dailyLimit,
    used,
    premium: false
  };
}

/**
 * Kullanımı kayıt et (başarılı komut sonrası çağır).
 */
export function recordUsage(jid, cmd) {
  incrementUsage(jid, cmd);
}

// ─── Grup Mesaj Sayacı (son N mesajda 1) ────────────────────────────────────

/**
 * Grup mesaj sayacını artır (her mesaj geldiğinde çağrılır).
 * @param {string} groupJid
 */
export function incrementGroupMsgCount(groupJid) {
  const prev = groupMsgCounter.get(groupJid) || 0;
  groupMsgCounter.set(groupJid, prev + 1);
}

/**
 * Grup içinde komutu son N mesajda kullanabilme kontrolü.
 * @param {string} groupJid
 * @param {string} cmd
 * @param {number} minMessages - en az kaç mesaj sonra tekrar kullanılabilir (default 20)
 * @returns {{ allowed: boolean, remaining: number }}
 */
export function checkGroupCooldown(groupJid, cmd, minMessages = 20) {
  const currentCount = groupMsgCounter.get(groupJid) || 0;
  const cmdMap = groupCmdMsgIndex.get(groupJid) || {};
  const lastUsedAt = cmdMap[cmd];

  if (lastUsedAt === undefined) {
    // Daha önce kullanılmamış → izinli
    return { allowed: true, remaining: 0 };
  }

  const msgsSinceLast = currentCount - lastUsedAt;
  if (msgsSinceLast >= minMessages) {
    return { allowed: true, remaining: 0 };
  }

  return { allowed: false, remaining: minMessages - msgsSinceLast };
}

/**
 * Grup komut kullanımını kaydet (başarılı komut sonrası çağır).
 */
export function recordGroupCmdUsage(groupJid, cmd) {
  const currentCount = groupMsgCounter.get(groupJid) || 0;
  const cmdMap = groupCmdMsgIndex.get(groupJid) || {};
  cmdMap[cmd] = currentCount;
  groupCmdMsgIndex.set(groupJid, cmdMap);
}
