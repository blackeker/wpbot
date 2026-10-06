/**
 * 🤖 24/7 WhatsApp AI Chat Bot (Node.js)
 * Powered by @whiskeysockets/baileys & Multi-Provider AI Fallback Engine
 * 
 * Hierarchy:
 * 1. Groq SDK / REST API (llama-3.3-70b-versatile) - Ultra fast
 * 2. OpenRouter API (meta-llama/llama-3.3-70b-instruct:free, deepseek/deepseek-r1:free) - Backup
 * 3. Google Gemini REST API (gemini-2.0-flash) - Fallback
 * 
 * Features:
 * - 24/7 Continuous WhatsApp connection with auto-reconnect
 * - In-Memory Conversation History (15 messages rolling window)
 * - 30-minute TTL Auto-Cleanup (zero memory leak)
 * - Natural, friendly Turkish conversational personality
 * - WhatsApp formatting (*bold*, _italic_) & typing presence simulation
 */

import 'dotenv/config';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import { handleAiChat, memoryManager, aiEngine } from './ai/aiEngine.js';
import { getAiConfig, readConfig } from './config.js';

// Configuration
const SESSION_DIR = process.env.SESSION_DIR || './auth_info_ai';
const aiConfig = getAiConfig();
const BOT_NAME = aiConfig.botName || 'Kondi AI';
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
const AI_AUTO_REPLY_DM = process.env.AI_AUTO_REPLY_DM !== 'false'; // default true
const AI_AUTO_REPLY_MENTION = process.env.AI_AUTO_REPLY_MENTION !== 'false'; // default true

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

function unwrapMessage(message) {
  if (!message) return null;
  if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.documentWithCaptionMessage?.message) return unwrapMessage(message.documentWithCaptionMessage.message);
  return message;
}

let sock = null;

async function startAiBot() {
  console.log(`\n==================================================`);
  console.log(`🚀 ${BOT_NAME} WhatsApp AI Bot Başlatılıyor...`);
  console.log(`==================================================\n`);

  // Ensure session directory exists
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`📦 Baileys Sürümü: v${version.join('.')} (En Güncel: ${isLatest})`);

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: state,
    browser: [BOT_NAME, 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: true,
    syncFullHistory: false
  });

  // Save auth state
  sock.ev.on('creds.update', saveCreds);

  // Connection handling
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📲 [QR KOD HAZIR] Lütfen WhatsApp uygulamanızdan bu QR kodu okutun:\n');
      qrcode.generate(qr, { small: true });
      console.log('\nBekleniyor...\n');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.warn(`⚠️ [BAĞLANTI KAPANDI] Kod: ${statusCode} | Yeniden bağlanılıyor: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(startAiBot, 3000);
      } else {
        console.error('❌ Oturum sonlandırıldı (Logged Out). Lütfen oturum klasörünü silip tekrar QR okutun.');
      }
    } else if (connection === 'open') {
      console.log(`\n✅ [BAĞLANTI BAŞARILI] ${BOT_NAME} WhatsApp'a başarıyla bağlandı!`);
      const botNumber = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0];
      console.log(`📱 Bot Numarası: +${botNumber}`);
      console.log(`🧠 Konuşma Hafızası & Fallback Havuzu Devrede!\n`);

      // Print status of providers
      const status = aiEngine.getStatus();
      console.log(`🔧 Sağlayıcı Durumu:`);
      console.log(`   - Groq (Primary): ${status.providers.groq.configured ? '🟢 Aktif' : '🔴 API Key Eksik'}`);
      console.log(`   - OpenRouter (Secondary): ${status.providers.openrouter.configured ? '🟢 Aktif' : '🔴 API Key Eksik'}`);
      console.log(`   - Google Gemini (Tertiary): ${status.providers.gemini.configured ? '🟢 Aktif' : '🔴 API Key Eksik'}\n`);
    }
  });

  // Incoming message handler
  sock.ev.on('messages.upsert', async (m) => {
    if (!m?.messages || !Array.isArray(m.messages)) return;

    for (const msg of m.messages) {
      try {
        await processIncomingMessage(sock, msg);
      } catch (err) {
        console.error('[MESAJ İŞLEME HATASI]:', err?.message || err);
      }
    }
  });
}

async function processIncomingMessage(sock, msg) {
  if (!msg?.message) return;

  // Ignore status broadcasts
  if (msg.key.remoteJid === 'status@broadcast') return;

  // Ignore messages older than 60 seconds (prevents message storm on restart)
  const nowSec = Math.floor(Date.now() / 1000);
  const msgTimestamp = typeof msg.messageTimestamp === 'number'
    ? msg.messageTimestamp
    : (msg.messageTimestamp?.low || Number(msg.messageTimestamp) || 0);

  if (msgTimestamp > 0 && (nowSec - msgTimestamp) > 60) {
    return;
  }

  const from = msg.key.remoteJid;
  const isGroup = from.endsWith('@g.us');
  const isFromMe = Boolean(msg.key.fromMe);

  // Unwrap message payload
  const content = unwrapMessage(msg.message);
  if (!content) return;

  const text = (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  ).trim();

  if (!text) return;

  const ltext = text.toLowerCase().trim();
  const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
  const botNumber = sock.user?.id?.split(':')[0];

  // Self messages: ignore unless explicitly testing
  if (isFromMe && !text.startsWith('!ai') && !text.startsWith('!sor') && !text.startsWith('!gpt')) {
    return;
  }

  // ── 1. Komut Kontrolleri (Reset / Durum) ─────────────────────
  if (ltext === '!reset' || ltext === '!temizle' || ltext === '!hafiza' || ltext === '!unutmabeni') {
    memoryManager.clearHistory(from);
    await sock.sendMessage(from, { text: '🧠 *Konuşma hafızası sıfırlandı!* Yeni bir konudan konuşabiliriz.' }, { quoted: msg });
    return;
  }

  if (ltext === '!durum' || ltext === '!status' || ltext === '!ping') {
    const memStats = memoryManager.getStats();
    const engineStatus = aiEngine.getStatus();
    const reply = `🤖 *${BOT_NAME} Durum Raporu*

⚡ *Yapay Zeka Fallback Havuzu:*
1. Groq: ${engineStatus.providers.groq.configured ? '🟢 Aktif' : '🔴 Yapılandırılmadı'} (${engineStatus.providers.groq.stats.success} başarılı)
2. OpenRouter: ${engineStatus.providers.openrouter.configured ? '🟢 Aktif' : '🔴 Yapılandırılmadı'} (${engineStatus.providers.openrouter.stats.success} başarılı)
3. Google Gemini: ${engineStatus.providers.gemini.configured ? '🟢 Aktif' : '🔴 Yapılandırılmadı'} (${engineStatus.providers.gemini.stats.success} başarılı)

🧠 *Hafıza:*
• Aktif Sohbet: ${memStats.activeSessions}
• Bellekteki Mesaj: ${memStats.totalMessagesInMemory}
• Zaman Aşımı: ${memStats.ttlMinutes} dk`;

    await sock.sendMessage(from, { text: reply }, { quoted: msg });
    return;
  }

  // ── 2. AI Tetikleme Koşulları ────────────────────────────────
  let userPrompt = null;
  let shouldReply = false;

  // A) Explicit Command (!ai, !sor, !gpt, !bot)
  const commandPrefixes = ['!ai', '!sor', '!gpt', '!bot', '/ai', '.ai'];
  for (const prefix of commandPrefixes) {
    if (ltext.startsWith(prefix)) {
      userPrompt = text.slice(prefix.length).trim();
      shouldReply = true;
      break;
    }
  }

  // B) Direct Private Chat (DM) -> Auto Reply
  if (!shouldReply && !isGroup && AI_AUTO_REPLY_DM) {
    userPrompt = text;
    shouldReply = true;
  }

  // C) Group Chat -> Reply if mentioned or replied to bot
  if (!shouldReply && isGroup && AI_AUTO_REPLY_MENTION) {
    const mentionedJids = content.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const isBotMentioned = botNumber && mentionedJids.some(j => j.includes(botNumber));
    const isReplyToBot = content.extendedTextMessage?.contextInfo?.participant?.includes(botNumber);

    if (isBotMentioned || isReplyToBot) {
      userPrompt = text.replace(new RegExp(`@${botNumber}`, 'g'), '').trim();
      shouldReply = true;
    }
  }

  if (!shouldReply || !userPrompt) return;

  console.log(`[MESAJ ALINDI] Chat: ${from} | Prompt: "${userPrompt}"`);

  // ── 3. AI Yanıtını Üret ve Gönder ──────────────────────────
  await handleAiChat(sock, msg, from, userPrompt);
}

// Global Exception Safety
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]:', reason);
});

// Start the bot
startAiBot();
