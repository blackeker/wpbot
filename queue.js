import { botSocketRef, sessionPath, readConfig } from './config.js';
import { executeDownloadPipeline } from './pipelines.js';
import fs from 'fs';
import path from 'path';

const queueFilePath = path.join(sessionPath, 'queue.json');

export let downloadQueue = [];
export const pendingSelections = {}; // { 'sender_jid': { url: '...', title: '...', formats: [...] } }
let taskIdCounter = 1;

let queueUpdateCallback = null;
export function setQueueUpdateCallback(cb) {
  queueUpdateCallback = cb;
}
export function notifyQueueUpdate() {
  if (queueUpdateCallback) {
    try { queueUpdateCallback(); } catch (e) {}
  }
}

// ─── Kuyruk Duraklatma Durumu ───
export const queueState = {
  isPaused: false
};

// JSON Dosyasına Kaydet
function saveQueueToFile() {
  try {
    const dataToSave = {
      downloadQueue: downloadQueue.map(t => ({
        id: t.id,
        url: t.url,
        recipientJid: t.recipientJid,
        title: t.title,
        status: t.status,
        format: t.format,
        priority: t.priority,
        addedTime: t.addedTime
      })),
      activeTasks: activeTasksList.map(t => ({
        id: t.id,
        url: t.url,
        recipientJid: t.recipientJid,
        title: t.title,
        status: 'queued', // restore active tasks as queued on next boot
        format: t.format,
        priority: t.priority,
        addedTime: t.addedTime
      })),
      taskIdCounter
    };
    fs.writeFileSync(queueFilePath, JSON.stringify(dataToSave, null, 2), 'utf8');
  } catch (err) {
    console.error('Kuyruk kaydedilemedi:', err.message);
  }
}

// JSON Dosyasından Yükle
function loadQueueFromFile() {
  try {
    if (fs.existsSync(queueFilePath)) {
      const data = JSON.parse(fs.readFileSync(queueFilePath, 'utf8'));
      const loadedQueue = [];

      // Restore active tasks first so they resume first
      if (data.activeTasks && Array.isArray(data.activeTasks)) {
        data.activeTasks.forEach(t => {
          loadedQueue.push({
            ...t,
            addedTime: new Date(t.addedTime),
            isCancelled: false,
            startTime: null,
            endTime: null,
            speed: null,
            sizeMB: null
          });
        });
      }

      if (data.downloadQueue && Array.isArray(data.downloadQueue)) {
        data.downloadQueue.forEach(t => {
          loadedQueue.push({
            ...t,
            addedTime: new Date(t.addedTime),
            isCancelled: false,
            startTime: null,
            endTime: null,
            speed: null,
            sizeMB: null
          });
        });
      }

      downloadQueue = loadedQueue;

      if (data.taskIdCounter) {
        taskIdCounter = data.taskIdCounter;
      }
      console.log(`[QUEUE] Diskten ${downloadQueue.length} adet bekleyen/yarıda kalmış görev geri yüklendi.`);
    }
  } catch (err) {
    console.error('Kuyruk yüklenemedi:', err.message);
  }
}

// Sunucu başlarken diskten yükle
loadQueueFromFile();

export const activeTasksList = [];
export const activeTask = {
  get current() {
    return activeTasksList[0] || null;
  },
  set current(val) {
    if (val === null) {
      // compatibility
    } else {
      if (!activeTasksList.includes(val)) {
        activeTasksList.push(val);
      }
    }
  }
};

export function addDownloadTask(url, recipientJid, title, format = null, priority = false) {
  const isDuplicate = downloadQueue.some(t => t.url === url) || activeTasksList.some(t => t.url === url);
  if (isDuplicate) {
    throw new Error("Bu link zaten indirme kuyrugunda veya su an indiriliyor.");
  }

  const task = {
    id: String(taskIdCounter++),
    url,
    recipientJid,
    title,
    status: 'queued',
    isCancelled: false,
    format,
    priority,
    addedTime: new Date(),
    startTime: null,
    endTime: null,
    speed: null,        // MB/s (anlık hız)
    sizeMB: null        // indirilen boyut
  };

  // Öncelikli görevler kuyruğun başına geçer
  if (priority) {
    downloadQueue.unshift(task);
  } else {
    downloadQueue.push(task);
  }

  saveQueueToFile();
  notifyQueueUpdate();
  processQueue();
  return task;
}

export function cancelDownloadTask(taskIdOrIndex) {
  let task = null;
  const num = parseInt(taskIdOrIndex, 10);

  task = activeTasksList.find(t => t.id === taskIdOrIndex) ||
         (taskIdOrIndex === 'aktif' || taskIdOrIndex === 'active' ? activeTasksList[0] : null);

  if (!task) {
    task = downloadQueue.find(t => t.id === taskIdOrIndex);
    if (!task && !isNaN(num) && num > 0 && num <= downloadQueue.length) {
      task = downloadQueue[num - 1];
    }
  }

  if (!task) return false;

  task.isCancelled = true;
  task.status = 'iptal edildi';

  const isRunning = activeTasksList.includes(task);
  if (isRunning && task.abortController) {
    task.abortController.abort();
  } else {
    const index = downloadQueue.findIndex(t => t.id === task.id);
    if (index !== -1) {
      downloadQueue.splice(index, 1);
    }
  }
  saveQueueToFile();
  notifyQueueUpdate();
  return task;
}

export function prioritizeDownloadTask(taskId) {
  const index = downloadQueue.findIndex(t => t.id === taskId);
  if (index === -1) return false;

  const task = downloadQueue[index];
  task.priority = true;
  downloadQueue.splice(index, 1);
  downloadQueue.unshift(task);

  saveQueueToFile();
  notifyQueueUpdate();
  return true;
}

export function clearQueue() {
  const count = downloadQueue.length;
  downloadQueue.length = 0;
  for (const task of activeTasksList) {
    if (task.abortController) {
      task.abortController.abort();
    }
  }
  activeTasksList.length = 0;
  saveQueueToFile();
  notifyQueueUpdate();
  return count;
}

// ─── Kuyruk Durdur / Devam Et ───
export function pauseQueue() {
  queueState.isPaused = true;
  notifyQueueUpdate();
}

export function resumeQueue() {
  queueState.isPaused = false;
  notifyQueueUpdate();
  processQueue();
}

// ─── Tahmini Bekleme Süresi ───
export function getEstimatedWaitTime(queueIndex) {
  const config = readConfig();
  const limit = config.concurrencyLimit || 1;
  const AVG_TASK_MINUTES = 10;
  const minutesLeft = Math.ceil((queueIndex + 1) / limit) * AVG_TASK_MINUTES;
  if (minutesLeft >= 60) {
    const h = Math.floor(minutesLeft / 60);
    const m = minutesLeft % 60;
    return `~${h}sa ${m}dk`;
  }
  return `~${minutesLeft}dk`;
}

export async function processQueue() {
  const config = readConfig();
  const limit = config.concurrencyLimit || 1;

  if (activeTasksList.length >= limit) return;
  if (queueState.isPaused) return;
  if (downloadQueue.length === 0) return;

  const task = downloadQueue.shift();
  activeTasksList.push(task);
  saveQueueToFile();
  notifyQueueUpdate();
  
  if (task.isCancelled) {
    console.log(`Task ${task.id} cancelled before start.`);
    const idx = activeTasksList.indexOf(task);
    if (idx !== -1) activeTasksList.splice(idx, 1);
    notifyQueueUpdate();
    processQueue();
    return;
  }

  task.status = 'indiriliyor';
  task.startTime = Date.now();
  task.abortController = new AbortController();

  (async () => {
    try {
      const sock = botSocketRef.current;
      if (!sock) throw new Error("WhatsApp bağlantısı henüz kurulmadı.");
      
      const from = task.recipientJid;

      console.log(`Starting queue task: ${task.title} (${task.url})`);
      let statusMsgKey = null;
      try {
        const statusMsg = await sock.sendMessage(from, { text: `⏳ *Kuyruk Sırası Geldi:*\n🎬 *${task.title}*\n\nVideo çözümleniyor ve indirme başlatılıyor...` });
        statusMsgKey = statusMsg?.key;
        task.statusMsgKey = statusMsgKey;
      } catch (e) {
        console.error('Kuyruk başlangıç mesajı gönderilemedi:', e.message);
      }

      await executeDownloadPipeline(
        task.url, 
        from, 
        async (statusText) => {
          try {
            if (botSocketRef.current && statusMsgKey) {
              await botSocketRef.current.sendMessage(from, { text: statusText, edit: statusMsgKey });
            }
          } catch (e) { }
          notifyQueueUpdate();
        }, 
        task.abortController.signal,
        task
      );

    } catch (error) {
      console.error('Error running queued task:', error?.message || error?.stack || error);
      const isNoSource = error.message && (
        error.message.includes('video kaynağı bulunamadı') ||
        error.message.includes('Çözümlenebilir video') ||
        error.message.includes('No alternative video sources')
      );
      try {
        if (botSocketRef.current) {
          let text;
          if (error.message === 'İndirme iptal edildi.') {
            text = `⚠️ *İndirme İptal Edildi:* ${task.title}`;
          } else if (isNoSource) {
            text = `⏩ *Atlandı:* ${task.title}\n└ Bu bölüm henüz platforma yüklenmemiş, sonraki bölüme geçiliyor...`;
          } else {
            text = `❌ *Hata (${task.title}):* ${error.message}`;
          }
          
          if (task.statusMsgKey) {
            await botSocketRef.current.sendMessage(task.recipientJid, { text, edit: task.statusMsgKey });
          } else {
            await botSocketRef.current.sendMessage(task.recipientJid, { text });
          }
        }
      } catch (e) { }
    } finally {
      const idx = activeTasksList.indexOf(task);
      if (idx !== -1) {
        activeTasksList.splice(idx, 1);
      }
      saveQueueToFile();
      notifyQueueUpdate();
      processQueue();
    }
  })();

  // Try initiating another worker if limit allows
  processQueue();
}
