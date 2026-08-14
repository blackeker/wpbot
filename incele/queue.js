import { botSocketRef, sessionPath } from './config.js';
import { executeDownloadPipeline } from './pipelines.js';
import fs from 'fs';
import path from 'path';

const queueFilePath = path.join(sessionPath, 'queue.json');

export let downloadQueue = [];
export const activeTask = { current: null };
export const pendingSelections = {}; // { 'sender_jid': { url: '...', title: '...', formats: [...] } }
let taskIdCounter = 1;

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
        status: t.status === 'indiriliyor' ? 'queued' : t.status, // indirilenler tekrar başlasın
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
      if (data.downloadQueue) {
        downloadQueue = data.downloadQueue.map(t => ({
          ...t,
          addedTime: new Date(t.addedTime),
          isCancelled: false,
          startTime: null,
          endTime: null,
          speed: null,
          sizeMB: null
        }));
      }
      if (data.taskIdCounter) {
        taskIdCounter = data.taskIdCounter;
      }
      console.log(`[QUEUE] Diskten ${downloadQueue.length} adet bekleyen görev geri yüklendi.`);
    }
  } catch (err) {
    console.error('Kuyruk yüklenemedi:', err.message);
  }
}

// Sunucu başlarken diskten yükle
loadQueueFromFile();

export function addDownloadTask(url, recipientJid, title, format = null, priority = false) {
  const isDuplicate = downloadQueue.some(t => t.url === url) || (activeTask.current && activeTask.current.url === url);
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
  processQueue();
  return task;
}

export function cancelDownloadTask(taskIdOrIndex) {
  let task = null;
  const num = parseInt(taskIdOrIndex, 10);

  if (activeTask.current && (taskIdOrIndex === 'aktif' || taskIdOrIndex === 'active')) {
    task = activeTask.current;
  } else {
    task = downloadQueue.find(t => t.id === taskIdOrIndex) ||
      (activeTask.current && activeTask.current.id === taskIdOrIndex ? activeTask.current : null);

    if (!task && !isNaN(num) && num > 0 && num <= downloadQueue.length) {
      task = downloadQueue[num - 1];
    }
  }

  if (!task) return false;

  task.isCancelled = true;
  task.status = 'iptal edildi';

  if (task === activeTask.current && activeTask.current.abortController) {
    activeTask.current.abortController.abort();
  } else {
    const index = downloadQueue.findIndex(t => t.id === task.id);
    if (index !== -1) {
      downloadQueue.splice(index, 1);
    }
  }
  saveQueueToFile();
  return task;
}

export function clearQueue() {
  const count = downloadQueue.length;
  downloadQueue.length = 0;
  if (activeTask.current && activeTask.current.abortController) {
    activeTask.current.abortController.abort();
    activeTask.current = null;
  }
  saveQueueToFile();
  return count;
}

// ─── Kuyruk Durdur / Devam Et ───
export function pauseQueue() {
  queueState.isPaused = true;
}

export function resumeQueue() {
  queueState.isPaused = false;
  processQueue();
}

// ─── Tahmini Bekleme Süresi ───
export function getEstimatedWaitTime(queueIndex) {
  // Her görev için ortalama 10 dakika varsayılan tahmin (geçmiş yokken)
  const AVG_TASK_MINUTES = 10;
  const minutesLeft = (queueIndex + 1) * AVG_TASK_MINUTES;
  if (minutesLeft >= 60) {
    const h = Math.floor(minutesLeft / 60);
    const m = minutesLeft % 60;
    return `~${h}sa ${m}dk`;
  }
  return `~${minutesLeft}dk`;
}

export async function processQueue() {
  if (activeTask.current) return;
  if (queueState.isPaused) return;
  if (downloadQueue.length === 0) return;

  activeTask.current = downloadQueue.shift();
  saveQueueToFile();
  
  if (activeTask.current.isCancelled) {
    console.log(`Task ${activeTask.current.id} cancelled before start.`);
    activeTask.current = null;
    processQueue();
    return;
  }

  activeTask.current.status = 'indiriliyor';
  activeTask.current.startTime = Date.now();
  activeTask.current.abortController = new AbortController();

  try {
    const sock = botSocketRef.current;
    if (!sock) throw new Error("WhatsApp bağlantısı henüz kurulmadı.");
    
    const from = activeTask.current.recipientJid;

    console.log(`Starting queue task: ${activeTask.current.title} (${activeTask.current.url})`);
    let statusMsgKey = null;
    try {
      const statusMsg = await sock.sendMessage(from, { text: `⏳ *Kuyruk Sırası Geldi:*\n🎬 *${activeTask.current.title}*\n\nVideo çözümleniyor ve indirme başlatılıyor...` });
      statusMsgKey = statusMsg?.key;
      activeTask.current.statusMsgKey = statusMsgKey;
    } catch (e) {
      console.error('Kuyruk başlangıç mesajı gönderilemedi:', e.message);
    }

    await executeDownloadPipeline(
      activeTask.current.url, 
      from, 
      async (statusText) => {
        try {
          if (botSocketRef.current && statusMsgKey) {
            await botSocketRef.current.sendMessage(from, { text: statusText, edit: statusMsgKey });
          }
        } catch (e) { }
      }, 
      activeTask.current.abortController.signal,
      activeTask.current
    );

  } catch (error) {
    console.error('Error running queued task:', error);
    const isNoSource = error.message && (
      error.message.includes('video kaynağı bulunamadı') ||
      error.message.includes('Çözümlenebilir video') ||
      error.message.includes('No alternative video sources')
    );
    try {
      if (botSocketRef.current) {
        let text;
        if (error.message === 'İndirme iptal edildi.') {
          text = `⚠️ *İndirme İptal Edildi:* ${activeTask.current.title}`;
        } else if (isNoSource) {
          text = `⏩ *Atlandı:* ${activeTask.current.title}\n└ Bu bölüm henüz platforma yüklenmemiş, sonraki bölüme geçiliyor...`;
        } else {
          text = `❌ *Hata (${activeTask.current.title}):* ${error.message}`;
        }
        
        if (activeTask.current.statusMsgKey) {
          await botSocketRef.current.sendMessage(activeTask.current.recipientJid, { text, edit: activeTask.current.statusMsgKey });
        } else {
          await botSocketRef.current.sendMessage(activeTask.current.recipientJid, { text });
        }
      }
    } catch (e) { }
  } finally {
    activeTask.current = null;
    saveQueueToFile();
    processQueue();
  }
}
