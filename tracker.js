import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { gotScraping } from 'got-scraping';
import { readConfig, botSocketRef, sessionPath } from './config.js';
import { addDownloadTask } from './queue.js';

const trackedDbPath = path.join(sessionPath, 'tracked_db.json');

// Helper to load/save tracked links
function readTrackedDb() {
  if (fs.existsSync(trackedDbPath)) {
    try {
      return new Set(JSON.parse(fs.readFileSync(trackedDbPath, 'utf8')));
    } catch {
      return new Set();
    }
  }
  return new Set();
}

function saveTrackedDb(set) {
  try {
    fs.writeFileSync(trackedDbPath, JSON.stringify([...set], null, 2), 'utf8');
  } catch (e) {
    console.error('[Tracker DB Save Error]', e.message);
  }
}

// Scrape latest links from Dizigom
async function scanDizigom() {
  const links = [];
  try {
    const res = await gotScraping.get('https://dizigom.li/');
    const $ = cheerio.load(res.body);
    // Dizigom usually lists latest added episodes under main container links
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().trim();
      if (href && (href.includes('/bolum/') || href.includes('-bolum') || href.includes('/episode/'))) {
        links.push({
          url: href.startsWith('http') ? href : `https://dizigom.li${href}`,
          title: title || 'Dizigom Yeni Bölüm',
          source: 'Dizigom'
        });
      }
    });
  } catch (err) {
    console.error('[Tracker] Dizigom scan failed:', err.message);
  }
  return links;
}

// Scrape latest links from Animecix
async function scanAnimecix() {
  const links = [];
  try {
    const res = await gotScraping.get('https://animecix.tv/');
    const $ = cheerio.load(res.body);
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().trim();
      if (href && (href.includes('/bolum/') || href.includes('/bölüm/') || href.includes('/episode/'))) {
        links.push({
          url: href.startsWith('http') ? href : `https://animecix.tv${href}`,
          title: title || 'Animecix Yeni Bölüm',
          source: 'Animecix'
        });
      }
    });
  } catch (err) {
    console.error('[Tracker] Animecix scan failed:', err.message);
  }
  return links;
}

// Scrape latest links from Hentaizm
async function scanHentaizm() {
  const links = [];
  try {
    const res = await gotScraping.get('https://www.hentaizm2.com/');
    const $ = cheerio.load(res.body);
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().trim();
      if (href && (href.includes('/hentai/') || href.includes('/bolum/') || href.includes('/izle/'))) {
        links.push({
          url: href.startsWith('http') ? href : `https://www.hentaizm2.com${href}`,
          title: title || 'Hentaizm Yeni Bölüm',
          source: 'Hentaizm'
        });
      }
    });
  } catch (err) {
    console.error('[Tracker] Hentaizm scan failed:', err.message);
  }
  return links;
}

export async function runTrackerScan(isFirstRun = false) {
  console.log('[Tracker] Starting series & anime scan...');
  const db = readTrackedDb();
  const allFound = [];

  const dizigomLinks = await scanDizigom();
  const animecixLinks = await scanAnimecix();
  const hentaizmLinks = await scanHentaizm();

  allFound.push(...dizigomLinks, ...animecixLinks, ...hentaizmLinks);

  let newItemsCount = 0;
  const config = readConfig();
  const recipient = config.whatsappPhoneNumber ? `${config.whatsappPhoneNumber}@s.whatsapp.net` : null;

  for (const item of allFound) {
    if (!db.has(item.url)) {
      db.add(item.url);
      newItemsCount++;

      // If it is the first run, we just populate the DB without sending notifications to avoid spamming old history
      if (!isFirstRun && recipient && botSocketRef.current) {
        try {
          console.log(`[Tracker] New content detected: ${item.title} -> ${item.url}`);
          const msg = `🔔 *YENİ BÖLÜM YAYINLANDI! (${item.source})* 🔔\n━━━━━━━━━━━━━━━━━━━━\n🎬 *Başlık:* ${item.title}\n🔗 *Link:* ${item.url}\n\n📥 İndirmek için bota gönderebilirsiniz.`;
          await botSocketRef.current.sendMessage(recipient, { text: msg });
        } catch (sendErr) {
          console.error('[Tracker] Failed to send WhatsApp notification:', sendErr.message);
        }
      }
    }
  }

  saveTrackedDb(db);
  console.log(`[Tracker] Scan completed. Found ${allFound.length} links. New detected: ${newItemsCount}`);
}

let trackerInterval = null;

export function startTrackerService() {
  stopTrackerService();
  // Run first scan immediately (first run populates the DB to prevent old spam)
  runTrackerScan(true).catch(err => console.error('[Tracker Init Error]', err.message));

  // Run every 30 minutes (1800000 ms)
  trackerInterval = setInterval(() => {
    runTrackerScan(false).catch(err => console.error('[Tracker Scan Error]', err.message));
  }, 1800000);
}

export function stopTrackerService() {
  if (trackerInterval) {
    clearInterval(trackerInterval);
    trackerInterval = null;
  }
}
