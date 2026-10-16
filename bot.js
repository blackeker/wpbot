import dotenv from 'dotenv';
dotenv.config({ override: true });

// Process Crash Resilience: Catch unhandled errors and rejections to prevent bot crashes
process.on('uncaughtException', (err) => {
  const errMsg = err?.message || String(err);
  if (errMsg.includes('Over 2000 messages into the future') || errMsg.includes('Failed to decrypt')) {
    // Handled by session auto-healer
    return;
  }
  console.error('[UNCAUGHT EXCEPTION]', errMsg);
  if (err?.stack) console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  const reasonMsg = reason?.message || String(reason);
  if (reasonMsg.includes('Over 2000 messages into the future') || reasonMsg.includes('Failed to decrypt')) {
    return;
  }
  console.error('[UNHANDLED REJECTION] At:', promise, 'Reason:', reason);
});

// Libsignal session ratchet desync auto-healer & noisy debug log filters
const originalConsoleInfo = console.info.bind(console);
console.info = (...args) => {
  if (typeof args[0] === 'string' && (args[0].startsWith('Closing session:') || args[0].startsWith('Opening session:'))) {
    return;
  }
  originalConsoleInfo(...args);
};

const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args) => {
  const str = typeof args[0] === 'string' ? args[0] : '';
  if (str.includes('Closing open session in favor of incoming prekey bundle') || str.includes('Failed to decrypt message')) {
    return;
  }
  originalConsoleWarn(...args);
};

const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  const fullText = args.map(a => (typeof a === 'object' ? (a?.stack || a?.message || JSON.stringify(a)) : String(a))).join(' ');
  
  // Filter noisy Signal ratchet desynchronization errors from flooding logs
  if (fullText.includes('Over 2000 messages into the future') || fullText.includes('Failed to decrypt message with any known session') || fullText.includes('Bad MAC') || fullText.includes('MessageCounterError') || fullText.includes('No matching sessions found for message')) {
    return; // Don't flood PM2 error logs
  }

  originalConsoleError(...args);
};

import { 
  makeWASocket, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion, 
  Browsers, 
  makeCacheableSignalKeyStore,
  DEFAULT_CONNECTION_CONFIG
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { exec } from 'child_process';

import { 
  botSocketRef, 
  sessionPath, 
  botState, 
  pairingState,
  setupPingTimer,
  cleanOldDownloads,
  restoreSession,
  cleanCorruptedSessions,
  getYtDlpCommand,
  sentMessageIds,
  addSentMessageId
} from './config.js';

import { startServer, notifyStatusUpdate } from './server.js';
import { handleConnectionUpdate } from './events/connection.js';
import { handleMessage } from './events/messages.js';

import { getModuleLogger } from './utils/logger.js';
import { sendHumanizedMessage } from './utils/antiBan.js';
const appLogger = getModuleLogger('bot');

const logger = pino({ level: 'silent' });
const PORT = parseInt(process.env.APP_PORT || (process.env.PORT && process.env.PORT !== '8080' ? process.env.PORT : '3000'), 10);

// Dynamic Command Loader
export const commands = new Map();

// In-memory message store for retry-receipts and quoted message lookups
export const messageStore = new Map();
export function storeMessage(key, message) {
  if (!key?.id || !message) return;
  messageStore.set(key.id, message);
  if (messageStore.size > 2000) {
    const oldestKey = messageStore.keys().next().value;
    messageStore.delete(oldestKey);
  }
}

function getCommandFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(getCommandFiles(fullPath));
    } else if (item.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

async function loadCommands() {
  commands.clear();
  const commandsDir = path.resolve('./commands');
  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
  }

  const files = getCommandFiles(commandsDir);
  for (const filePath of files) {
    try {
      const fileUrl = pathToFileURL(filePath).href;
      const module = await import(fileUrl);
      const cmd = module.default;
      if (cmd && cmd.name) {
        commands.set(cmd.name, cmd);
        if (cmd.aliases && Array.isArray(cmd.aliases)) {
          for (const alias of cmd.aliases) {
            commands.set(alias, cmd);
          }
        }
      }
    } catch (err) {
      appLogger.error({ filePath, err: err.message }, '[LOADER] Failed to load command');
    }
  }
  appLogger.info({ count: commands.size }, `[LOADER] Loaded ${commands.size} command handlers/aliases.`);
}

// Setup keep-alive ping
setupPingTimer(botState.pingUrl);

export async function requestBotPairingCode(phoneNumber) {
  const sock = botSocketRef.current;
  if (!sock) {
    throw new Error('WhatsApp soketi henüz başlatılmadı.');
  }
  if (sock.authState?.creds?.registered) {
    throw new Error('Cihaz zaten bağlı ve kayıtlı.');
  }

  const cleanPhone = (phoneNumber || pairingState.pairingPhoneNumber || '').replace(/[^0-9]/g, '');
  if (!cleanPhone || cleanPhone.length < 10) {
    throw new Error('Geçersiz telefon numarası. Lütfen ülke koduyla birlikte girin (Örn: 905551234567).');
  }

  pairingState.isPairingMode = true;
  pairingState.pairingPhoneNumber = cleanPhone;
  botState.pairingNumber = cleanPhone;
  botState.pairingMode = true;
  botState.status = 'connecting';
  notifyStatusUpdate();

  console.log(`[PAIRING] WhatsApp eşleşme kodu isteniyor: +${cleanPhone}...`);
  const rawCode = await sock.requestPairingCode(cleanPhone);
  const formattedCode = rawCode?.match(/.{1,4}/g)?.join("-") || rawCode;

  botState.pairingCode = formattedCode;
  botState.status = 'pairing';
  botState.qrCodeUrl = null;

  console.clear();
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║             🔑 WHATSAPP EŞLEŞME KODU (PAIRING CODE)          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Telefon Numarası : +${cleanPhone.padEnd(39)} ║`);
  console.log(`║  Eşleşme Kodu     : \x1b[1;32m${formattedCode.padEnd(39)}\x1b[0m ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Nasıl Bağlanılır?                                           ║');
  console.log('║  1. Telefonunuzdan WhatsApp uygulamasını açın                 ║');
  console.log('║  2. Ayarlar > Bağlı Cihazlar > Cihaz Bağla                   ║');
  console.log('║  3. "Telefon numarasıyla bağla" seçeneğine dokunun            ║');
  console.log(`║  4. Ekrana şu kodu girin: \x1b[1;33m${formattedCode}\x1b[0m                            ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  notifyStatusUpdate();
  return formattedCode;
}

async function startBot() {
  // Auto-update yt-dlp on startup in the background
  (async () => {
    const ytDlpCmd = getYtDlpCommand();
    appLogger.info({ cmd: ytDlpCmd }, `[STARTUP] Checking for yt-dlp updates`);
    exec(`"${ytDlpCmd}" -U`, (err, stdout, stderr) => {
      if (err) {
        appLogger.error({ err: err.message }, `[STARTUP] yt-dlp update failed`);
      } else {
        appLogger.info({ output: stdout.trim() }, `[STARTUP] yt-dlp update result`);
      }
    });
  })();

  restoreSession();
  cleanCorruptedSessions();
  let version = [2, 3000, 1037641644];
  try {
    const { version: latestVersion } = await fetchLatestBaileysVersion();
    version = latestVersion;
  } catch (err) {
    // Fail silent
  }

  if (botSocketRef.current) {
    try {
      botSocketRef.current.ev.removeAllListeners();
      botSocketRef.current.end?.(new Error('Reconnecting bot'));
    } catch (e) {}
    botSocketRef.current = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    makeSignalRepository: (auth) => DEFAULT_CONNECTION_CONFIG.makeSignalRepository(auth),
    logger: logger,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    getMessage: async (key) => {
      if (key?.id && messageStore.has(key.id)) {
        return messageStore.get(key.id);
      }
      return undefined;
    }
  });

  botSocketRef.current = sock;
  
  const originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    const [targetJid, content, options] = args;
    const result = await sendHumanizedMessage(sock, originalSendMessage, targetJid, content, options);
    if (result && result.key && result.key.id) {
      addSentMessageId(result.key.id);
      if (result.message) {
        storeMessage(result.key, result.message);
      }
    }
    console.log(`[MSG OUTGOING] Sent to: ${targetJid} | ID: ${result?.key?.id}`);
    return result;
  };

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    await handleConnectionUpdate(sock, update, startBot);
  });

  sock.ev.on('messages.upsert', async (m) => {
    console.log('[DEBUG UPSERT ARRIVED]', {
      type: m.type,
      count: m.messages ? m.messages.length : 0,
      keys: m.messages?.map(x => ({ id: x.key?.id, from: x.key?.remoteJid, fromMe: x.key?.fromMe, hasMessage: Boolean(x.message) }))
    });
    for (const msg of m.messages || []) {
      if (msg?.key && msg?.message) {
        storeMessage(msg.key, msg.message);
      }
    }
    await handleMessage(sock, m);
  });

  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates || []) {
      if (update.update?.message && update.key) {
        console.log('[MESSAGES.UPDATE DECRYPTED]', { id: update.key.id, from: update.key.remoteJid, keys: Object.keys(update.update.message) });
        storeMessage(update.key, update.update.message);
        await handleMessage(sock, {
          type: 'notify',
          messages: [{
            key: update.key,
            message: update.update.message,
            messageTimestamp: update.update.messageTimestamp || Math.floor(Date.now() / 1000),
            pushName: update.update.pushName
          }]
        });
      }
    }
  });

  // Otomatik Eşleşme Kodu Talebi (Eğer pairing modu aktifse ve oturum henüz kayıtlı değilse)
  if (pairingState.isPairingMode && pairingState.pairingPhoneNumber && !state.creds?.registered) {
    setTimeout(async () => {
      try {
        if (botSocketRef.current && !botSocketRef.current.authState?.creds?.registered) {
          await requestBotPairingCode(pairingState.pairingPhoneNumber);
        }
      } catch (err) {
        console.error('[PAIRING] Otomatik eşleşme kodu alma hatası:', err.message);
      }
    }, 3000);
  }
}

// Start everything
(async () => {
  await loadCommands();
  
  // Start Express Server
  startServer(PORT, startBot);

  // Start Baileys WhatsApp Bot
  startBot().catch(err => console.error("Error starting bot:", err));

  // Run cleanup at startup and then every 15 minutes
  cleanOldDownloads();
  setInterval(cleanOldDownloads, 15 * 60 * 1000);
})();
