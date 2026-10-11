/**
 * menuRateLimiter.js
 * 
 * Yurt/Üniversite yemek komutları için ortak rate limit yardımcı fonksiyonu.
 * - DM: Günde 1 kullanım (premium muaf)
 * - Grup: Son 20 mesajda 1 kullanım (premium muaf)
 * 
 * Engelleme durumunda AI'dan dinamik "yukarı bak" mesajı üretilir.
 */

import { aiEngine } from '../ai/aiEngine.js';
import { getAiConfig } from '../config.js';
import {
  checkDailyLimit,
  recordUsage,
  checkGroupCooldown,
  recordGroupCmdUsage,
  isPremium
} from './rateLimiter.js';

const MENU_DAILY_LIMIT = 1;
const GROUP_MSG_COOLDOWN = 20;

/**
 * Yemek komutları için AI "yukarı bak" mesajı üretir.
 * @param {string} cmdName - komut adı (aksam, kahvalti vb.)
 * @param {number} remaining - kaç mesaj sonra kullanılabilir (grup için)
 * @param {string} context - 'group' veya 'dm'
 */
async function getAiScrollMessage(cmdName, remaining = 0, context = 'group') {
  const cmdLabel = {
    aksam: 'akşam yemeği',
    kahvalti: 'kahvaltı',
    uniyemek: 'üniversite yemek menüsü',
    yemek: 'yemek menüsü'
  }[cmdName] || cmdName;

  const aiCfg = getAiConfig();
  
  if (aiCfg.hasAnyKey && aiCfg.enabled) {
    try {
      const contextHint = context === 'group'
        ? `Bu bir grup sohbeti. ${remaining} mesaj sonra tekrar kullanılabilir.`
        : `Özel mesajda. Bugün zaten kullanıldı.`;
      
      const prompt = `Biri "${cmdLabel}" komutunu az önce sormuş, ama az önce cevap verildi. Kısaca ve esprili bir şekilde "yukarıya bak" veya "daha önce yazdım" anlamında 1-2 cümlelik bir yanıt yaz. Türkçe, doğal, samimi bir dil kullan. ${contextHint}`;
      
      const result = await aiEngine.generateReply(prompt, [], {
        systemPrompt: 'Sen WhatsApp grubunda kullanılan yardımsever ama biraz şakacı bir botsun. Çok kısa, doğal Türkçe cevaplar veriyorsun.'
      });
      
      if (result && result.text) {
        return result.text.trim();
      }
    } catch (e) {
      // AI başarısız → fallback
    }
  }

  // Fallback statik mesajlar
  const fallbacks = context === 'group' ? [
    `📜 Az önce yukarıya yazdım, kaydır bir bak! (${remaining} mesaj sonra tekrar sorabilirsin)`,
    `⬆️ Yukarıya bak canım, ${remaining} mesaj önce paylaştım!`,
    `🍽️ Menüyü biraz önce attım, scroll et yukarı! ${remaining} mesaj sonra tekrar bakabilirim.`,
    `👆 Az önce paylaştım! ${remaining} mesaj daha geçsin, tekrar bakayım.`
  ] : [
    `📅 Bugün zaten paylaştım! Yarın tekrar sorabilirsin.`,
    `🍽️ Bugünkü menüyü az önce gönderdim, yukarıya bak!`,
    `⏰ Günde bir kez paylaşıyorum, bugünküsünü çoktan verdim!`
  ];
  
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

/**
 * Komut öncesi rate limit kontrolü yapar.
 * Engellenmişse mesaj gönderir ve false döner.
 * İzin verilmişse kaydeder ve true döner.
 * 
 * @param {object} sock - WhatsApp socket
 * @param {object} msg - mesaj nesnesi
 * @param {string} from - chat JID
 * @param {string} cmdName - komut adı
 * @returns {Promise<boolean>} - devam et mi?
 */
export async function checkMenuRateLimit(sock, msg, from, cmdName) {
  const isGroup = from.endsWith('@g.us');
  const sender = msg.key.participant || from;

  // Premium kullanıcı → her zaman geç
  if (isPremium(sender)) {
    if (isGroup) recordGroupCmdUsage(from, cmdName);
    else recordUsage(sender, cmdName);
    return true;
  }

  if (isGroup) {
    // ── GRUP: son 20 mesajda 1 ─────────────────────────────────────────
    const cooldown = checkGroupCooldown(from, cmdName, GROUP_MSG_COOLDOWN);
    if (!cooldown.allowed) {
      const scrollMsg = await getAiScrollMessage(cmdName, cooldown.remaining, 'group');
      await sock.sendMessage(from, { text: scrollMsg }, { quoted: msg });
      return false;
    }
    // İzinli → kaydet
    recordGroupCmdUsage(from, cmdName);
  } else {
    // ── DM: günde 1 ───────────────────────────────────────────────────
    const limit = checkDailyLimit(sender, cmdName, MENU_DAILY_LIMIT);
    if (!limit.allowed) {
      const scrollMsg = await getAiScrollMessage(cmdName, 0, 'dm');
      await sock.sendMessage(from, { text: scrollMsg });
      return false;
    }
    // İzinli → kaydet
    recordUsage(sender, cmdName);
  }

  return true;
}
