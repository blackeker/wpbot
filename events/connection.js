import fs from 'fs';
import qrcode from 'qrcode-terminal';
import QRCodeImage from 'qrcode';
import { botState, pairingState, sessionPath, backupSession, backupCredsFile } from '../config.js';
import { startTrackerService } from '../tracker.js';
import { notifyStatusUpdate } from '../server.js';

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
      console.log('--- WhatsApp Bot QR Code ---');
      console.log('Scan the QR code below using your WhatsApp Linked Devices:');
      console.log('====================================');
      qrcode.generate(qr, { small: true });
    } else {
      botState.status = 'connecting';
      console.log('[PAIRING] QR baskı atlandı, pairing code bekleniyor...');
    }
  }

  if (connection === 'connecting' && pairingState.isPairingMode && pairingState.pairingPhoneNumber) {
    const cleanPhone = pairingState.pairingPhoneNumber.replace(/[^0-9]/g, '');
    console.log(`[PAIRING] Bağlantı kuruluyor, kod isteniyor: ${cleanPhone}`);
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(cleanPhone);
        botState.pairingCode = code;
        botState.pairingMode = true;
        botState.status = 'pairing';
        console.log(`\n🔑 PAIRING CODE: ${code}\n`);
      } catch (err) {
        console.error('[PAIRING] Hata:', err.message);
        pairingState.isPairingMode = false;
        botState.pairingMode = false;
      }
    }, 3000);
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
  }
  notifyStatusUpdate();
}
