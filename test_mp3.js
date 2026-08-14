import { addDownloadTask } from './queue.js';
import { setupPingTimer } from './config.js';

async function run() {
  console.log("Simulating !mp3 command trigger for a short YouTube video...");
  // We trigger a short YouTube video: https://www.youtube.com/shorts/5c5rO8_SveM
  const task = addDownloadTask(
    'https://www.youtube.com/shorts/5c5rO8_SveM',
    '905052761405@s.whatsapp.net',
    'Shorts MP3 Test',
    'mp3'
  );
  console.log("Task Queued successfully! Task ID:", task.id);
}

run().catch(console.error);
