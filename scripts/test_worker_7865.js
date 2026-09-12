import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { botSocketRef, downloadsDir, sessionPath } from '../config.js';
import { executeDownloadPipeline } from '../pipelines.js';

const PORT = 7865;
const QUEUE_DB_NAME = 'queue_test.db';
const dbPath = path.join(sessionPath, QUEUE_DB_NAME);
const PRIMARY_BOT_URL = 'http://127.0.0.1:7860';
const TARGET_PHONE = '05551234567';
const TARGET_JID = '905551234567@s.whatsapp.net';

process.on('uncaughtException', (err) => {
  console.error('[Test Worker Uncaught Exception]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Test Worker Unhandled Rejection]:', reason?.message || reason);
});

console.log(`[Test Worker] Initializing on PORT ${PORT} with DB: ${dbPath}`);

// Initialize SQLite schema for test queue
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    url TEXT,
    recipientJid TEXT,
    title TEXT,
    status TEXT,
    format TEXT,
    priority INTEGER,
    addedTime TEXT,
    episodeBatch TEXT
  );
  
  CREATE TABLE IF NOT EXISTS active_tasks (
    id TEXT PRIMARY KEY,
    url TEXT,
    recipientJid TEXT,
    title TEXT,
    status TEXT,
    format TEXT,
    priority INTEGER,
    addedTime TEXT,
    episodeBatch TEXT
  );
`);

// Reset stale active tasks
db.prepare("DELETE FROM active_tasks").run();
db.prepare("UPDATE tasks SET status = 'queued' WHERE status = 'in_progress'").run();

// Setup Mock / Relay Bot Socket
const relaySocket = {
  sendMessage: async (jid, content, options = {}) => {
    try {
      if (content && content.text) {
        const payload = {
          recipientJid: jid,
          text: content.text,
          editKey: content.edit || null
        };
        const res = await axios.post(`${PRIMARY_BOT_URL}/api/internal/send-text`, payload);
        return { key: res.data?.key || { id: 'mock_' + Date.now() } };
      }

      // Media upload
      const fileName = content?.fileName;
      let filePath = null;
      if (fileName) {
        const candidate = path.join(downloadsDir, fileName);
        if (fs.existsSync(candidate)) filePath = candidate;
      }
      if (!filePath && fileName) {
        const parsedBase = path.parse(fileName).name;
        const files = fs.readdirSync(downloadsDir);
        const match = files.find(f => f === fileName || (parsedBase.length > 5 && f.includes(parsedBase)));
        if (match) filePath = path.join(downloadsDir, match);
      }
      if (!filePath && content?.document?.stream?.path) {
        filePath = content.document.stream.path;
      }
      if (!filePath) {
        const files = fs.readdirSync(downloadsDir)
          .filter(f => !f.endsWith('.part') && !f.startsWith('.'))
          .map(f => {
            const p = path.join(downloadsDir, f);
            return { path: p, mtime: fs.statSync(p).mtimeMs, size: fs.statSync(p).size };
          })
          .filter(f => f.size > 1000)
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length > 0 && Date.now() - files[0].mtime < 10 * 60 * 1000) {
          filePath = files[0].path;
        }
      }

      if (filePath && fs.existsSync(filePath)) {
        console.log(`[Test Worker Relay] Sending media file via Primary Bot: ${filePath}`);
        const payload = {
          recipientJid: jid,
          filePath: path.resolve(filePath),
          fileName: fileName || path.basename(filePath),
          caption: content.caption || null,
          mimetype: content.mimetype || null,
          asDocument: !!content.document
        };
        const res = await axios.post(`${PRIMARY_BOT_URL}/api/internal/send-media`, payload);
        return { key: res.data?.key || { id: 'media_' + Date.now() } };
      } else {
        console.warn(`[Test Worker Relay] Media file not found on disk for fileName: ${fileName}`);
        return { key: { id: 'not_found' } };
      }
    } catch (err) {
      console.error(`[Test Worker Relay Error]:`, err?.response?.data || err.message);
      return { key: { id: 'err_' + Date.now() } };
    }
  }
};

botSocketRef.current = relaySocket;

// Express Server
const app = express();
app.use(express.json());

let isProcessingQueue = false;
let currentActiveTask = null;

app.get('/api/status', (req, res) => {
  const pending = db.prepare("SELECT * FROM tasks WHERE status = 'queued' ORDER BY rowid ASC").all();
  const completed = db.prepare("SELECT * FROM tasks WHERE status = 'completed' ORDER BY rowid DESC LIMIT 10").all();
  res.json({
    port: PORT,
    queueDb: QUEUE_DB_NAME,
    targetJid: TARGET_JID,
    activeTask: currentActiveTask,
    pendingTasks: pending,
    completedTasks: completed
  });
});

app.post('/api/indir', (req, res) => {
  const { url, title, priority } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const id = String(Date.now());
  const itemTitle = title || url;
  db.prepare(`
    INSERT INTO tasks (id, url, recipientJid, title, status, format, priority, addedTime)
    VALUES (?, ?, ?, ?, 'queued', NULL, ?, ?)
  `).run(id, url, TARGET_JID, itemTitle, priority ? 1 : 0, new Date().toISOString());

  processTestQueue();
  res.json({ ok: true, id, title: itemTitle });
});

async function processTestQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    while (true) {
      const task = db.prepare("SELECT * FROM tasks WHERE status = 'queued' ORDER BY priority DESC, rowid ASC LIMIT 1").get();
      if (!task) break;

      currentActiveTask = task;
      db.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(task.id);
      db.prepare("DELETE FROM active_tasks WHERE id = ?").run(task.id);
      db.prepare("INSERT INTO active_tasks (id, url, recipientJid, title, status, priority, addedTime) VALUES (?, ?, ?, ?, 'downloading', ?, ?)").run(
        task.id, task.url, task.recipientJid, task.title, task.priority, task.addedTime
      );

      console.log(`\n========================================`);
      console.log(`[Test Worker] Starting Task [${task.id}]: ${task.title}`);
      console.log(`[Test Worker] URL: ${task.url}`);
      console.log(`========================================\n`);

      try {
        await executeDownloadPipeline(
          task.url,
          task.recipientJid,
          async (statusText) => {
            currentActiveTask.statusText = statusText;
          },
          null,
          {
            id: task.id,
            url: task.url,
            title: task.title,
            recipientJid: task.recipientJid
          }
        );
        db.prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").run(task.id);
        console.log(`[Test Worker] ✅ Task [${task.id}] COMPLETED: ${task.title}`);
        
        await relaySocket.sendMessage(task.recipientJid, {
          text: `✅ *Test Başarılı!*\n━━━━━━━━━━━━━━━━━━━━\n🎬 *Başlık:* ${task.title}\n🔗 *Kaynak URL:* ${task.url}\n📁 *Kuyruk:* ${QUEUE_DB_NAME} (Port ${PORT})\n\n_Video dosyanız yukarıda iletildi._`
        });
      } catch (err) {
        console.error(`[Test Worker] ❌ Task [${task.id}] FAILED:`, err.message);
        db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(task.id);
        try {
          await relaySocket.sendMessage(task.recipientJid, {
            text: `❌ *Test İndirme Uyarısı*\n━━━━━━━━━━━━━━━━━━━━\nBaşlık: ${task.title}\nHata: ${err.message}`
          });
        } catch (e) {}
      } finally {
        db.prepare("DELETE FROM active_tasks WHERE id = ?").run(task.id);
        currentActiveTask = null;
      }
    }
  } catch (err) {
    console.error('[Test Worker Queue Error]:', err);
  } finally {
    isProcessingQueue = false;
  }
}

// Start HTTP server and run predefined multi-source test suite
const server = app.listen(PORT, async () => {
  console.log(`[Test Worker] Running HTTP Server on http://127.0.0.1:${PORT}`);

  const existingQueued = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'queued'").get();
  if (existingQueued.c === 0) {
    // Multi-source test items: YouTube, DramaDizilerim, Direct Web MP4, Animecix
    const testSources = [
      {
        source: 'YouTube',
        title: 'YouTube - Me at the zoo (18sn Test)',
        url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
      },
      {
        source: 'DramaDizilerim',
        title: 'DramaDizilerim - Dileklerin Efendisi S1 Bölüm 1',
        url: 'https://dramadizilerim.com/izle/dileklerin-efendisi?s=1&e=1'
      },
      {
        source: 'Direct MP4',
        title: 'Doğrudan Web Video (Google Cloud Storage MP4)',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
      },
      {
        source: 'Animecix',
        title: 'Animecix - Mushoku Tensei: Jobless Reincarnation - Sezon 1 Bölüm 5',
        url: 'https://ecchicix.com/titles/7350/season/1/episode/5'
      }
    ];

    for (const item of testSources) {
      const taskId = 'test_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      db.prepare(`
        INSERT INTO tasks (id, url, recipientJid, title, status, format, priority, addedTime)
        VALUES (?, ?, ?, ?, 'queued', NULL, 0, ?)
      `).run(taskId, item.url, TARGET_JID, item.title, new Date().toISOString());
      console.log(`[Test Worker] Enqueued test task: ${item.title}`);
    }
  }

  // Trigger processing
  processTestQueue();
});

