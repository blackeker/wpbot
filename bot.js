import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
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
  getYtDlpCommand,
  sentMessageIds
} from './config.js';

import { startServer, startCaptchaPoller } from './server.js';
import { handleConnectionUpdate } from './events/connection.js';
import { handleMessage } from './events/messages.js';

const logger = pino({ level: 'silent' });
const PORT = process.env.PORT || 7860;

// Dynamic Command Loader
export const commands = new Map();

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
    auth: state,
    logger: logger,
    browser: Browsers.macOS('Desktop'),
    printQRInTerminal: false
  });

  botSocketRef.current = sock;
  
  const originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    const result = await originalSendMessage(...args);
    if (result && result.key && result.key.id) {
      sentMessageIds.add(result.key.id);
    }
    return result;
  };

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    await handleConnectionUpdate(sock, update, startBot);
  });

  sock.ev.on('messages.upsert', async (m) => {
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
