import axios from 'axios';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { getAiConfig } from '../config.js';
import { loadMenuData, findMenuByQuery } from '../utils/menuData.js';

/**
 * ── 1. CONVERSATION MEMORY MANAGER ──────────────────────────────
 * Stores last 15 messages per chat with 30-min TTL auto-cleanup.
 */
export class MemoryManager {
  constructor(options = {}) {
    this.maxMessages = options.maxMessages || 15;
    this.ttlMs = options.ttlMs || 30 * 60 * 1000;
    this.sessions = new Map();

    const timer = setInterval(() => this.cleanupExpired(), 5 * 60 * 1000);
    if (timer.unref) timer.unref();
  }

  getSession(jid) {
    if (!this.sessions.has(jid)) {
      this.sessions.set(jid, { messages: [], lastActive: Date.now() });
    }
    const s = this.sessions.get(jid);
    s.lastActive = Date.now();
    return s;
  }

  addMessage(jid, role, content) {
    if (!jid || !content) return;
    const s = this.getSession(jid);
    s.messages.push({ role, content: String(content).trim(), timestamp: Date.now() });
    if (s.messages.length > this.maxMessages) s.messages = s.messages.slice(-this.maxMessages);
    s.lastActive = Date.now();
  }

  getHistory(jid) {
    if (!this.sessions.has(jid)) return [];
    const s = this.getSession(jid);
    s.lastActive = Date.now();
    return s.messages.map(m => ({ role: m.role, content: m.content }));
  }

  clearHistory(jid) {
    return this.sessions.delete(jid);
  }

  cleanupExpired() {
    const now = Date.now();
    for (const [jid, s] of this.sessions.entries()) {
      if (now - s.lastActive > this.ttlMs) this.sessions.delete(jid);
    }
  }

  getStats() {
    let count = 0;
    for (const s of this.sessions.values()) count += s.messages.length;
    return { activeSessions: this.sessions.size, totalMessagesInMemory: count, ttlMinutes: this.ttlMs / 60000 };
  }
}

export const memoryManager = new MemoryManager();

/**
 * ── 2. SYSTEM PROMPT & DYNAMIC MENU BUILDER ─────────────────────
 */
export function getDailyMenuContext() {
  try {
    const data = loadMenuData();
    if (!data || data.length === 0) return '';
    const today = findMenuByQuery('', data);
    const tomorrow = findMenuByQuery('yarin', data);
    let ctx = '📅 GÜNCEL YEMEK MENÜSÜ:\n';
    if (today?.entry) {
      const e = today.entry;
      ctx += `• Bugün (${e.tarih} - ${e.gun}): Kahvaltı: ${e.kahvalti?.join(', ') || 'Yok'} | Akşam: ${e.aksam_yemegi?.join(', ') || 'Yok'}\n`;
    }
    if (tomorrow?.entry) {
      const e = tomorrow.entry;
      ctx += `• Yarın (${e.tarih} - ${e.gun}): Kahvaltı: ${e.kahvalti?.join(', ') || 'Yok'} | Akşam: ${e.aksam_yemegi?.join(', ') || 'Yok'}\n`;
    }
    return ctx;
  } catch (e) {
    return '';
  }
}

export function getSystemPrompt(botName = 'Kondi AI', extraContext = '') {
  const menuContext = getDailyMenuContext();
  return `Sen ${botName} isimli samimi, esprili, zeki ve yardımsever bir Türk WhatsApp arkadaşısın.

KURALLAR:
1. Doğal & Samimi: Robotik veya resmi olma. Gerçek bir yakın arkadaş gibi Türkçe konuş.
2. WhatsApp Formatı: Asla uzun paragraflar yazma. WhatsApp formatına uygun (*kalın*, _italik_) kısa, net ve akıcı ol. Asla '#' başlıkları kullanma.
3. Görsel & OCR: Fotoğraf geldiğinde üzerindeki soruları adım adım çözer, metinleri okur, nesneleri açıklarsın.
4. Yemekhane: Yemek sorulduğunda güncel menüyü bilirsin.

${menuContext ? `\n${menuContext}\n` : ''}${extraContext ? `\nEK BAĞLAM:\n${extraContext}\n` : ''}`;
}

/**
 * ── 3. MULTI-PROVIDER FALLBACK ENGINE (TEXT + VISION) ───────────
 */
export class AiEngine {
  constructor() {
    this.cooldowns = new Map();
    this.stats = {
      groq: { success: 0, errors: 0, lastUsed: null },
      openrouter: { success: 0, errors: 0, lastUsed: null },
      gemini: { success: 0, errors: 0, lastUsed: null },
      ollama: { success: 0, errors: 0, lastUsed: null }
    };
  }

  isCoolingDown(p) {
    const until = this.cooldowns.get(p);
    if (!until) return false;
    if (Date.now() < until) return true;
    this.cooldowns.delete(p);
    return false;
  }

  setCooldown(p, ms = 60000) {
    this.cooldowns.set(p, Date.now() + ms);
  }

  async generateReply(userText, history = [], options = {}) {
    const aiConfig = getAiConfig();
    const botName = options.botName || aiConfig.botName || 'Kondi AI';
    const systemPrompt = options.systemPrompt || getSystemPrompt(botName, options.extraContext);
    const fullMessages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userText }];
    const errors = [];
    const startTime = Date.now();

    // 1. Groq (Primary Ultra-Fast)
    const groqKey = options.groqApiKey || aiConfig.groqApiKey;
    if (groqKey && !this.isCoolingDown('groq')) {
      try {
        const res = await this.callGroq(fullMessages, groqKey, options);
        this.stats.groq.success++;
        this.stats.groq.lastUsed = new Date();
        return { ...res, latencyMs: Date.now() - startTime };
      } catch (err) {
        this.stats.groq.errors++;
        errors.push({ provider: 'groq', error: err.message });
        if (this.isRateLimitOrQuota(err)) this.setCooldown('groq', 60000);
      }
    }

    // 2. OpenRouter (Secondary)
    const orKey = options.openrouterApiKey || aiConfig.openrouterApiKey;
    if (orKey && !this.isCoolingDown('openrouter')) {
      try {
        const res = await this.callOpenRouter(fullMessages, orKey, options);
        this.stats.openrouter.success++;
        this.stats.openrouter.lastUsed = new Date();
        return { ...res, latencyMs: Date.now() - startTime };
      } catch (err) {
        this.stats.openrouter.errors++;
        errors.push({ provider: 'openrouter', error: err.message });
        if (this.isRateLimitOrQuota(err)) this.setCooldown('openrouter', 60000);
      }
    }

    // 3. Google Gemini (Tertiary)
    const geminiKey = options.geminiApiKey || aiConfig.geminiApiKey;
    if (geminiKey && !this.isCoolingDown('gemini')) {
      try {
        const res = await this.callGemini(systemPrompt, history, userText, geminiKey, options);
        this.stats.gemini.success++;
        this.stats.gemini.lastUsed = new Date();
        return { ...res, latencyMs: Date.now() - startTime };
      } catch (err) {
        this.stats.gemini.errors++;
        errors.push({ provider: 'gemini', error: err.message });
        if (this.isRateLimitOrQuota(err)) this.setCooldown('gemini', 60000);
      }
    }

    // 4. Ollama Cloud (4x Multi-Key Fallback)
    const ollamaUrl = options.ollamaUrl || aiConfig.ollamaUrl;
    const ollamaKeys = options.ollamaApiKeys || aiConfig.ollamaApiKeys || [aiConfig.ollamaApiKey];
    if ((aiConfig.ollamaEnabled || options.provider === 'ollama') && ollamaUrl && !this.isCoolingDown('ollama')) {
      try {
        const res = await this.callOllama(fullMessages, ollamaUrl, { ...options, apiKeys: ollamaKeys });
        this.stats.ollama.success++;
        this.stats.ollama.lastUsed = new Date();
        return { ...res, latencyMs: Date.now() - startTime };
      } catch (err) {
        this.stats.ollama.errors++;
        errors.push({ provider: 'ollama', error: err.message });
        this.setCooldown('ollama', 45000);
      }
    }

    throw new Error(`Yapay zeka sağlayıcıları yanıt veremedi: ${errors.map(e => `${e.provider}: ${e.error}`).join(' | ')}`);
  }

  async generateVisionReply(imageBufferOrBase64, mimeType = 'image/jpeg', prompt = 'Bu görseli açıkla.', options = {}) {
    const aiConfig = getAiConfig();
    const base64Data = Buffer.isBuffer(imageBufferOrBase64)
      ? imageBufferOrBase64.toString('base64')
      : String(imageBufferOrBase64).replace(/^data:image\/\w+;base64,/, '');

    const botName = options.botName || aiConfig.botName || 'Kondi AI';
    const systemPrompt = options.systemPrompt || getSystemPrompt(botName, options.extraContext);
    const userPrompt = (prompt || 'Bu görseli incele ve detaylıca açıkla.').trim();
    const errors = [];
    const startTime = Date.now();

    // 1. Ollama Cloud Vision (gemma4:31b Multimodal)
    const ollamaUrl = options.ollamaUrl || aiConfig.ollamaUrl || 'https://ollama.com';
    const ollamaKeys = options.ollamaApiKeys || aiConfig.ollamaApiKeys || [aiConfig.ollamaApiKey];
    if (ollamaUrl && !this.isCoolingDown('ollama')) {
      try {
        const model = options.model || aiConfig.ollamaModel || 'gemma4:31b';
        let lastErr = null;
        for (let i = 0; i < ollamaKeys.length; i++) {
          try {
            const res = await axios.post(`${ollamaUrl.replace(/\/+$/, '')}/api/chat`, {
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt, images: [base64Data] }
              ],
              stream: false,
              options: { temperature: 0.4 }
            }, {
              headers: { 'Authorization': `Bearer ${ollamaKeys[i]}`, 'Content-Type': 'application/json' },
              timeout: 40000
            });
            if (res.data?.message?.content) {
              this.stats.ollama.success++;
              return { text: res.data.message.content.trim(), provider: 'ollama-vision', model: `${model} (Key #${i + 1})`, latencyMs: Date.now() - startTime };
            }
          } catch (kErr) { lastErr = kErr; }
        }
        if (lastErr) throw lastErr;
      } catch (err) {
        this.stats.ollama.errors++;
        errors.push({ provider: 'ollama-vision', error: err.message });
      }
    }

    // 2. Gemini Vision
    const geminiKey = options.geminiApiKey || aiConfig.geminiApiKey;
    if (geminiKey && !this.isCoolingDown('gemini')) {
      for (const gm of ['gemini-2.5-flash', 'gemini-flash-latest']) {
        try {
          const res = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${gm}:generateContent?key=${geminiKey}`, {
            contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nKullanıcı: ${userPrompt}` }, { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Data } }] }]
          }, { headers: { 'Content-Type': 'application/json' }, timeout: 25000 });
          const textPart = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (textPart) {
            this.stats.gemini.success++;
            return { text: textPart.trim(), provider: 'gemini-vision', model: gm, latencyMs: Date.now() - startTime };
          }
        } catch (gErr) { errors.push({ provider: `gemini-${gm}`, error: gErr.message }); }
      }
    }

    throw new Error(`Görsel işlenemedi: ${errors.map(e => `${e.provider}: ${e.error}`).join(' | ')}`);
  }

  isRateLimitOrQuota(err) {
    const s = err.response?.status;
    const msg = (err.response?.data?.error?.message || err.message || '').toLowerCase();
    return s === 429 || s === 402 || msg.includes('rate limit') || msg.includes('quota');
  }

  async callGroq(messages, apiKey, options = {}) {
    const model = options.model || 'openai/gpt-oss-20b';
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model, messages, temperature: options.temperature ?? 0.7, max_tokens: options.max_tokens ?? 800
    }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    const content = res.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Groq boş yanıt döndürdü.');
    return { text: content.trim(), provider: 'groq', model };
  }

  async callOpenRouter(messages, apiKey, options = {}) {
    const model = options.model || 'google/gemma-4-31b-it:free';
    const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model, messages, temperature: options.temperature ?? 0.7, max_tokens: options.max_tokens ?? 800
    }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://github.com/blackeker/wpbot', 'Content-Type': 'application/json' }, timeout: 25000 });
    let content = res.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenRouter boş yanıt döndürdü.');
    return { text: content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(), provider: 'openrouter', model };
  }

  async callGemini(systemPrompt, history, userText, apiKey, options = {}) {
    const model = options.model || 'gemini-2.5-flash';
    const contents = [];
    for (const h of history) {
      contents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] });
    }
    contents.push({ role: 'user', parts: [{ text: userText }] });

    const res = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      contents, systemInstruction: { parts: [{ text: systemPrompt }] }
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 });
    const textPart = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textPart) throw new Error('Gemini boş yanıt döndürdü.');
    return { text: textPart.trim(), provider: 'gemini', model };
  }

  async callOllama(messages, url, options = {}) {
    const cleanUrl = (url || 'https://ollama.com').replace(/\/+$/, '');
    const model = options.model || 'gemma4:31b';
    const rawKeys = options.apiKeys && options.apiKeys.length > 0 ? options.apiKeys : (options.apiKey ? [options.apiKey] : ['']);
    const keys = rawKeys.filter(Boolean).length > 0 ? rawKeys.filter(Boolean) : [''];
    let lastErr = null;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const headers = { 'Content-Type': 'application/json' };
      if (key) headers['Authorization'] = `Bearer ${key}`;

      try {
        const res = await axios.post(`${cleanUrl}/api/chat`, { model, messages, stream: false, options: { temperature: 0.7 } }, { headers, timeout: 35000 });
        if (res.data?.message?.content) {
          return { text: res.data.message.content.trim(), provider: 'ollama', model: `${model} (Key #${i + 1})` };
        }
      } catch (nativeErr) {
        try {
          const resV1 = await axios.post(`${cleanUrl}/v1/chat/completions`, { model, messages, temperature: 0.7 }, { headers, timeout: 35000 });
          if (resV1.data?.choices?.[0]?.message?.content) {
            return { text: resV1.data.choices[0].message.content.trim(), provider: 'ollama', model: `${model} (Key #${i + 1})` };
          }
        } catch (v1Err) {
          lastErr = nativeErr.response?.status === 404 ? v1Err : nativeErr;
        }
      }
    }
    throw lastErr || new Error('Tüm Ollama anahtarları yanıt veremedi.');
  }

  getStatus() {
    const c = getAiConfig();
    return {
      providers: {
        groq: { configured: Boolean(c.groqApiKey), model: c.groqModel || 'openai/gpt-oss-20b', coolingDown: this.isCoolingDown('groq'), stats: this.stats.groq },
        openrouter: { configured: Boolean(c.openrouterApiKey), model: c.openrouterModel || 'google/gemma-4-31b-it:free', coolingDown: this.isCoolingDown('openrouter'), stats: this.stats.openrouter },
        gemini: { configured: Boolean(c.geminiApiKey), model: c.geminiModel || 'gemini-2.5-flash', coolingDown: this.isCoolingDown('gemini'), stats: this.stats.gemini },
        ollama: { configured: Boolean(c.ollamaEnabled || c.ollamaApiKeys?.length > 0), model: c.ollamaModel || 'gemma4:31b', keyCount: c.ollamaApiKeys?.length || 0, coolingDown: this.isCoolingDown('ollama'), stats: this.stats.ollama }
      }
    };
  }
}

export const aiEngine = new AiEngine();

/**
 * ── 4. WHATSAPP MESSAGE & VISION DISPATCH HELPERS ───────────────
 */
export function getQuotedMessageText(msg) {
  if (!msg?.message) return null;
  const raw = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message;
  const ctx = raw.extendedTextMessage?.contextInfo || raw.imageMessage?.contextInfo || raw.videoMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;
  const q = ctx.quotedMessage;
  return (q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || '').trim() || null;
}

export async function extractImageBufferFromMessage(msg) {
  if (!msg?.message) return null;
  const raw = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message;

  if (raw.imageMessage) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: () => Promise.resolve() });
      return { buffer, mimeType: raw.imageMessage.mimetype || 'image/jpeg', caption: raw.imageMessage.caption || '' };
    } catch (e) {}
  }

  const ctx = raw.extendedTextMessage?.contextInfo || raw.imageMessage?.contextInfo || raw.videoMessage?.contextInfo;
  if (ctx?.quotedMessage?.imageMessage) {
    try {
      const quotedObj = { key: { remoteJid: msg.key?.remoteJid, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage };
      const buffer = await downloadMediaMessage(quotedObj, 'buffer', {}, { reuploadRequest: () => Promise.resolve() });
      return { buffer, mimeType: ctx.quotedMessage.imageMessage.mimetype || 'image/jpeg', caption: ctx.quotedMessage.imageMessage.caption || '' };
    } catch (e) {}
  }

  return null;
}

export async function handleAiChat(sock, msg, from, userPrompt, options = {}) {
  if (!sock || !from || !userPrompt) return null;
  try { await sock.sendPresenceUpdate('composing', from); } catch (e) {}

  try {
    const quotedText = getQuotedMessageText(msg);
    let promptWithContext = userPrompt;
    if (quotedText) promptWithContext = `[Alıntılanan / Yanıtlanan Mesaj: "${quotedText}"]\n\n${userPrompt}`;

    const history = memoryManager.getHistory(from);
    const result = await aiEngine.generateReply(promptWithContext, history, options);

    memoryManager.addMessage(from, 'user', promptWithContext);
    memoryManager.addMessage(from, 'assistant', result.text);

    try { await sock.sendPresenceUpdate('paused', from); } catch (e) {}

    const sendOptions = options.quoteMessage !== false && msg ? { quoted: msg } : {};
    let messageBody = result.text;
    if (options.showProviderFooter) {
      messageBody += `\n\n_⚡ ${result.provider.toUpperCase()} (${result.model}) • ${result.latencyMs}ms_`;
    }

    await sock.sendMessage(from, { text: messageBody }, sendOptions);
    return result;
  } catch (err) {
    try { await sock.sendPresenceUpdate('paused', from); } catch (e) {}
    console.error(`[AI ERROR] Failed to respond to ${from}:`, err.message);
    await sock.sendMessage(from, { text: '😔 Kusura bakma, şu an yanıt verirken küçük bir aksaklık oldu. Birkaç saniye sonra tekrar yazar mısın?' }, msg ? { quoted: msg } : {});
    return null;
  }
}

export async function handleAiVision(sock, msg, from, imageBuffer, mimeType, userPrompt = '') {
  if (!sock || !from || !imageBuffer) return null;
  try { await sock.sendPresenceUpdate('composing', from); } catch (e) {}

  try {
    const prompt = userPrompt || 'Bu görseli detaylıca incele, ne olduğunu ve üzerindeki detayları veya soruları açıkla.';
    const result = await aiEngine.generateVisionReply(imageBuffer, mimeType, prompt);

    try { await sock.sendPresenceUpdate('paused', from); } catch (e) {}
    await sock.sendMessage(from, { text: result.text }, { quoted: msg });
    return result;
  } catch (err) {
    try { await sock.sendPresenceUpdate('paused', from); } catch (e) {}
    console.error(`[VISION ERROR] Failed to process image for ${from}:`, err.message);
    await sock.sendMessage(from, { text: '😔 Görseli incelerken bir sorun oluştu. Lütfen tekrar göndermeyi deneyin.' }, { quoted: msg });
    return null;
  }
}
