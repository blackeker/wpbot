import fs from 'fs';
import qrcode from 'qrcode-terminal';
import QRCodeImage from 'qrcode';
import { botState, pairingState, sessionPath, backupSession, backupCredsFile } from '../config.js';
import { startTrackerService } from '../tracker.js';
import { notifyStatusUpdate } from '../server.js';
import { processQueue } from '../queue.js';

export async function handleConnectionUpdate(sock, update, startBot) {
  const { connection, lastDisconnect, qr } = update;

  if (qr && !sock.authState.creds.registered) {
    if (!pairingState.isPairingMode) {
      botState.status = 'qr';
      try {
        botState.qrCodeUrl = await QRCodeImage.toDataURL(qr);
      } catch (err) {
        console.error('QR code generation error:', err);
      }
      console.clear();
      console.log('====================================');
      console.log('--- WhatsApp Bot QR Kodu ---');
      console.log('WhatsApp uygulamanızdan Bağlı Cihazlar menüsüne giderek aşağıdaki QR kodu taratın:');
      console.log('====================================');
      qrcode.generate(qr, { small: true });
      console.log('\n💡 İpucu: Eşleşme kodu (Pairing Code) ile bağlanmak için web panelini (http://localhost:7860) kullanabilir veya \'npm start -- --pairing <numara>\' komutuyla başlatabilirsiniz.\n');
    } else {
      if (!botState.pairingCode) {
        botState.status = 'connecting';
        console.log('[PAIRING] Eşleşme modu aktif, eşleşme kodu bekleniyor...');
      }
    }
  }

  if (connection === 'connecting') {
    if (pairingState.isPairingMode) {
      botState.status = botState.pairingCode ? 'pairing' : 'connecting';
    } else if (!botState.qrCodeUrl) {
      botState.status = 'connecting';
    }
  }

  if (connection === 'close') {
    botState.status = 'disconnected';
    botState.qrCodeUrl = null;
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const reason = lastDisconnect?.error?.message || lastDisconnect?.error || 'Bilinmeyen Hata';
    
    console.log(`Connection closed (Sebep: ${reason}, Code: ${statusCode}).`);

    if (statusCode === 401) {
      console.log('[BOT] Oturum kapatıldı (401), oturum verileri temizleniyor...');
      try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch(e) {}
      try { if (fs.existsSync(backupCredsFile)) fs.unlinkSync(backupCredsFile); } catch(e) {}
    }

    const delay = (statusCode === 428 || statusCode === 440 || String(reason).includes('conflict')) ? 10000 : 5000;
    console.log(`Reconnecting in ${delay/1000}s...`);
    setTimeout(() => startBot(), delay);
  } else if (connection === 'open') {
    botState.status = 'connected';
    botState.qrCodeUrl = null;
    botState.pairingCode = null;
    botState.pairingMode = false;
    pairingState.isPairingMode = false;
    backupSession();
    console.clear();
    console.log('====================================');
    console.log('WhatsApp Bot is successfully connected and online!');
    console.log('====================================');
    try {
      startTrackerService();
    } catch (err) {
      console.error('[Tracker] Failed to start tracker service:', err.message);
    }
    try {
      processQueue();
    } catch (err) {
      console.error('[QUEUE] Failed to start queue on connection open:', err.message);
    }
  }
  notifyStatusUpdate();
}
