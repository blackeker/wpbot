import dotenv from 'dotenv';
dotenv.config({ override: true });

// Process Crash Resilience: Catch unhandled errors and rejections to prevent bot crashes
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err?.message || err);
  if (err?.stack) console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION] At:', promise, 'Reason:', reason);
});

// Libsignal gürültülü iç debug loglarını (Closing session, Opening session vb.) filtrele
const originalConsoleInfo = console.info.bind(console);
console.info = (...args) => {
  if (typeof args[0] === 'string' && (args[0].startsWith('Closing session:') || args[0].startsWith('Opening session:'))) {
    return;
  }
  originalConsoleInfo(...args);
};

const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Closing open session in favor of incoming prekey bundle')) {
    return;
  }
  originalConsoleWarn(...args);
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
import { exec } from 'child_process';

import { 
  botSocketRef, 
  sessionPath, 
  botState, 
  setupPingTimer,
  cleanOldDownloads,
  restoreSession,
  cleanCorruptedSessions,
  getYtDlpCommand,
  sentMessageIds,
  addSentMessageId
} from './config.js';

import { startServer, startCaptchaPoller } from './server.js';
import { handleConnectionUpdate } from './events/connection.js';
import { handleMessage } from './events/messages.js';

const logger = pino({ level: 'silent' });
const PORT = process.env.PORT || 7860;

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

async function loadCommands() {
  commands.clear();
  const commandsDir = path.resolve('./commands');
  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
  }

  const files = fs.readdirSync(commandsDir);
  for (const file of files) {
    if (file.endsWith('.js')) {
      try {
        const module = await import(`./commands/${file}`);
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
        console.error(`[LOADER] Failed to load command: ${file}`, err.message);
      }
    }
  }
  console.log(`[LOADER] Loaded ${commands.size} command handlers/aliases.`);
}

// Setup keep-alive ping
setupPingTimer(botState.pingUrl);

async function startBot() {
  // Auto-update yt-dlp on startup in the background
  (async () => {
    const ytDlpCmd = getYtDlpCommand();
    console.log(`[STARTUP] Checking for yt-dlp updates using: ${ytDlpCmd}`);
    exec(`"${ytDlpCmd}" -U`, (err, stdout, stderr) => {
      if (err) {
        console.error(`[STARTUP] yt-dlp update failed: ${err.message}`);
      } else {
        console.log(`[STARTUP] yt-dlp update result: ${stdout.trim()}`);
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

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    makeSignalRepository: (auth) => {
      const repository = DEFAULT_CONNECTION_CONFIG.makeSignalRepository(auth);
      const originalDecryptMessage = repository.decryptMessage.bind(repository);
      repository.decryptMessage = async ({ jid, type, ciphertext }) => {
        try {
          return await originalDecryptMessage({ jid, type, ciphertext });
        } catch (err) {
          if (err && err.message && (err.message.includes('Bad MAC') || err.message.includes('No matching sessions'))) {
            const addrStr = repository.jidToSignalProtocolAddress(jid).toString();
            console.warn(`[Session Auto-Fix] Bozulmuş oturum anahtarı (${err.message}) tespit edildi: ${addrStr}. Temizlenerek yeni anahtar değişimi tetikleniyor.`);
            try {
              await auth.keys.set({ session: { [addrStr]: null } });
            } catch (clearErr) {}
          }
          throw err;
        }
      };
      return repository;
    },
    logger: logger,
    browser: Browsers.macOS('Desktop'),
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
    const result = await originalSendMessage(...args);
    if (result && result.key && result.key.id) {
      addSentMessageId(result.key.id);
      if (result.message) {
        storeMessage(result.key, result.message);
      }
    }
    return result;
  };

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    await handleConnectionUpdate(sock, update, startBot);
  });

  sock.ev.on('messages.upsert', async (m) => {
    for (const msg of m.messages || []) {
      if (msg?.key && msg?.message) {
        storeMessage(msg.key, msg.message);
      }
    }
    await handleMessage(sock, m);
  });
}

// Start everything
(async () => {
  await loadCommands();
  
  // Start Express and Captcha Poller
  startServer(PORT, startBot);
  startCaptchaPoller();

  // Start Baileys WhatsApp Bot
  startBot().catch(err => console.error("Error starting bot:", err));

  // Run cleanup at startup and then every 15 minutes
  cleanOldDownloads();
  setInterval(cleanOldDownloads, 15 * 60 * 1000);
})();
