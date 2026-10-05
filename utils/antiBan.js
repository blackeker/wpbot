import { readConfig } from '../config.js';
import { getModuleLogger } from './logger.js';

const logger = getModuleLogger('anti-ban');

/**
 * Default Anti-Ban & Human Simulation Configuration
 */
const DEFAULT_ANTI_BAN_CONFIG = {
  enabled: true,
  autoRead: true, // Mesaj geldiğinde okundu (mavi tik) simülasyonu
  typingSimulation: true, // Mesaj gönderilmeden önce "yazıyor..." veya "kaydediyor..." durumu
  minTypingDelayMs: 1800, // En kısa mesaj için minimum yazıyor süresi (1.8 saniye)
  maxTypingDelayMs: 12000, // En uzun mesajlar için tavan yazıyor süresi (12 saniye)
  msPerChar: 45, // Karakter başına ortalama yazma süresi (~22 karakter/sn - insansı hız)
  jitterFactor: 0.20, // ±%20 rastgele insansı sapma
  minIntervalBetweenSendsMs: 900, // Aynı kişiye/gruba ardışık mesajlar arasındaki minimum soğuma süresi
  maxInboundRatePerFiveSec: 8, // Bir kullanıcının 5 saniyede gönderebileceği maksimum mesaj sayısı (Flood Koruması)
  throttleDurationMs: 12000 // Flood yapan kullanıcıyı geçici olarak yok sayma süresi (12 saniye)
};

/**
 * Get active Anti-Ban configuration merged with user config
 */
export function getAntiBanConfig() {
  try {
    const config = readConfig();
    return { ...DEFAULT_ANTI_BAN_CONFIG, ...(config.antiBan || {}) };
  } catch (e) {
    return { ...DEFAULT_ANTI_BAN_CONFIG };
  }
}

/**
 * Mesaj içeriğine ve uzunluğuna göre dinamik insansı "yazıyor..." süresi hesaplar
 * @param {string|object} content - Baileys mesaj objesi veya metin
 * @param {object} customConfig - Özel konfigürasyon geçersiz kılma
 * @returns {{ delay: number, presenceType: 'composing' | 'recording' }}
 */
export function calculateTypingMetrics(content, customConfig = {}) {
  const config = { ...getAntiBanConfig(), ...customConfig };

  if (!config.enabled || !config.typingSimulation) {
    return { delay: 0, presenceType: 'composing' };
  }

  let textLength = 0;
  let isAudio = false;
  let isMedia = false;

  if (typeof content === 'string') {
    textLength = content.length;
  } else if (content && typeof content === 'object') {
    if (typeof content.text === 'string') {
      textLength += content.text.length;
    }
    if (typeof content.caption === 'string') {
      textLength += content.caption.length;
    }
    if (content.audio || content.ptt) {
      isAudio = true;
      isMedia = true;
    } else if (content.image || content.video || content.document) {
      isMedia = true;
    }
  }

  const presenceType = isAudio ? 'recording' : 'composing';
  let baseDelay = 0;

  if (isAudio) {
    // Ses kaydı simülasyonu: 3.0s - 5.5s
    baseDelay = 3000 + Math.random() * 2500;
  } else if (isMedia) {
    // Medya hazırlama + açıklama metni yazma süresi
    const mediaPrepDelay = 2200;
    const captionDelay = textLength > 0 ? textLength * config.msPerChar : 0;
    baseDelay = mediaPrepDelay + captionDelay;
  } else {
    // Salt metin mesajı: karakter sayısı * msPerChar
    baseDelay = textLength * config.msPerChar;
  }

  // Minimum ve maksimum sınırlar uygula
  let delay = Math.max(config.minTypingDelayMs, Math.min(config.maxTypingDelayMs, baseDelay));

  // Rastgele jitter ekle (robotik sabit süreleri önler)
  const jitterFactor = typeof config.jitterFactor === 'number' ? config.jitterFactor : 0.20;
  const jitterOffset = (Math.random() * 2 - 1) * jitterFactor; // örn: -0.20 ile +0.20 arası
  delay = Math.round(delay * (1 + jitterOffset));

  return { delay, presenceType };
}

// Per-JID Sequential Message Queue & Timestamp tracker
const jidQueues = new Map();
const jidLastSentTimestamp = new Map();

// Inbound Rate Limiting (Anti-Spam / Anti-Flood)
const inboundUserHistory = new Map(); // senderJid -> [timestamps]
const throttledUsers = new Map(); // senderJid -> unthrottleTimestamp

/**
 * Gelen mesajın spam/flood olup olmadığını kontrol eder.
 * @param {string} senderJid 
 * @returns {boolean} true ise mesaj flood sayılır ve işlenmemelidir
 */
export function isSenderThrottled(senderJid) {
  if (!senderJid) return false;
  const config = getAntiBanConfig();
  if (!config.enabled) return false;

  const now = Date.now();

  // Halihazırda engellenmiş mi kontrol et
  const unthrottleTime = throttledUsers.get(senderJid);
  if (unthrottleTime && now < unthrottleTime) {
    return true;
  } else if (unthrottleTime && now >= unthrottleTime) {
    throttledUsers.delete(senderJid);
  }

  // Geçmiş pencereleri temizle ve kaydet
  let timestamps = inboundUserHistory.get(senderJid) || [];
  timestamps = timestamps.filter(t => now - t < 5000); // Son 5 saniye
  timestamps.push(now);
  inboundUserHistory.set(senderJid, timestamps);

  if (timestamps.length > (config.maxInboundRatePerFiveSec || 8)) {
    throttledUsers.set(senderJid, now + (config.throttleDurationMs || 12000));
    logger.warn({ senderJid }, `[ANTI-BAN] Flood tespit edildi! Kullanıcı ${Math.round((config.throttleDurationMs || 12000)/1000)}s süreyle geçici olarak susturuldu.`);
    return true;
  }

  return false;
}

/**
 * Gelen mesaj için insansı mavi tik (okundu bilgisi) simülasyonu yapar
 * @param {object} sock - Baileys socket instance
 * @param {object} msg - Baileys message instance
 */
export async function simulateIncomingRead(sock, msg) {
  if (!sock || !msg?.key) return;
  const config = getAntiBanConfig();
  if (!config.enabled || !config.autoRead) return;

  // İnsansı mesajı görme/okuma süresi (600ms - 1500ms)
  const readDelay = 600 + Math.floor(Math.random() * 900);
  setTimeout(async () => {
    try {
      if (typeof sock.readMessages === 'function') {
        await sock.readMessages([msg.key]);
      }
    } catch (e) {
      // Okundu bilgisi hatalarını yut (bağlantı anlık kopsa bile sorun çıkarmaz)
    }
  }, readDelay);
}

/**
 * Mesajı insansı davranış kurallarına, yazıyor süresine ve soğuma sürelerine göre gönderir
 * @param {object} sock - Baileys socket
 * @param {Function} rawSendMessage - Baileys orijinal sock.sendMessage fonksiyonu
 * @param {string} targetJid - Hedef sohbet/grup JID
 * @param {object} content - Mesaj içeriği
 * @param {object} options - Ek Baileys opsiyonları
 */
export async function sendHumanizedMessage(sock, rawSendMessage, targetJid, content, options = {}) {
  // Eğer anti-ban atlanmak isteniyorsa direkt gönder
  if (options?.skipAntiBan || options?.immediate || !targetJid) {
    return await rawSendMessage(targetJid, content, options);
  }

  const config = getAntiBanConfig();
  if (!config.enabled) {
    return await rawSendMessage(targetJid, content, options);
  }

  // JID bazlı kuyruk mekanizması (aynı sohbete giden mesajların çakışmasını engeller)
  let queuePromise = jidQueues.get(targetJid) || Promise.resolve();

  const taskPromise = queuePromise.then(async () => {
    try {
      // 1. Minimum mesajlar arası bekleme kontrolü (cooldown)
      const lastSent = jidLastSentTimestamp.get(targetJid) || 0;
      const timeSinceLast = Date.now() - lastSent;
      const minInterval = config.minIntervalBetweenSendsMs || 900;
      if (timeSinceLast < minInterval) {
        const waitTime = minInterval - timeSinceLast + Math.floor(Math.random() * 300);
        await new Promise(r => setTimeout(r, waitTime));
      }

      // 2. Mesaj uzunluğuna ve içeriğe göre yazıyor/kaydediyor süresi hesaplama
      const { delay, presenceType } = calculateTypingMetrics(content, config);

      if (delay > 0 && typeof sock.sendPresenceUpdate === 'function') {
        try {
          await sock.sendPresenceUpdate(presenceType, targetJid);
        } catch (err) {}

        // Dinamik hesaplanan yazma süresi kadar bekle
        await new Promise(r => setTimeout(r, delay));

        try {
          await sock.sendPresenceUpdate('paused', targetJid);
        } catch (err) {}
      }

      // 3. Mesajı WhatsApp üzerinden gönder
      const result = await rawSendMessage(targetJid, content, options);

      // Gönderim zamanını kaydet
      jidLastSentTimestamp.set(targetJid, Date.now());

      return result;
    } catch (error) {
      // Hata olsa bile presence'ı temizlemeye çalış
      try {
        if (typeof sock.sendPresenceUpdate === 'function') {
          await sock.sendPresenceUpdate('paused', targetJid);
        }
      } catch (e) {}
      throw error;
    }
  });

  // Kuyruk durumunu güncelle ve hata durumunda zincirin kopmasını önle
  jidQueues.set(targetJid, taskPromise.catch(() => {}));

  return await taskPromise;
}
