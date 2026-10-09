import http from 'http';

function post(path, data = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(`http://127.0.0.1:7860${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  // 1. Clear current queue (to cancel the old 1-200 single giant task)
  console.log('Clearing old queue...');
  const clearRes = await post('/api/kuyruk-temizle');
  console.log('Clear response:', clearRes);

  // 2. Queue the 10 volumes (1-20, 21-40, ...)
  const targetJid = '905332624732@s.whatsapp.net';
  const seriesTitle = 'Solo Leveling';
  const baseUrl = 'https://mangaportali.com/reader/solo-leveling';

  const tasks = [];
  const CHUNK_SIZE = 20;
  const TOTAL_CHAPTERS = 200;

  for (let start = 1; start <= TOTAL_CHAPTERS; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, TOTAL_CHAPTERS);
    const volNum = Math.floor((start - 1) / CHUNK_SIZE) + 1;
    const title = `${seriesTitle} (Cilt ${volNum}: Bölüm ${start} - ${end})`;
    const url = `${baseUrl}/bolum-${start}#batch=${start}-${end}`;

    tasks.push({
      url,
      recipientJid: targetJid,
      title
    });
  }

  console.log(`Queueing ${tasks.length} volumes for ${targetJid}...`);
  const queueRes = await post('/api/queue/insert-after', { tasks });
  console.log('Queue response:', queueRes);
}

main().catch(console.error);
