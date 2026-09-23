import fs from 'fs';
import { execSync } from 'child_process';
import ffmpegStaticPath from 'ffmpeg-static';
import { getModuleLogger } from '../utils/logger.js';

const logger = getModuleLogger('pipelines-helpers');

export let ffmpegPath = ffmpegStaticPath;
try {
  const sysFfmpeg = execSync('which ffmpeg 2>/dev/null || true').toString().trim();
  if (sysFfmpeg && fs.existsSync(sysFfmpeg)) {
    ffmpegPath = sysFfmpeg;
  }
} catch (e) {
  ffmpegPath = ffmpegStaticPath;
}

export function replaceTurkishChars(str) {
  if (!str) return '';
  return str
    .replace(/Ğ/g, 'G')
    .replace(/ğ/g, 'g')
    .replace(/Ü/g, 'U')
    .replace(/ü/g, 'u')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 's')
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .replace(/Ö/g, 'O')
    .replace(/ö/g, 'o')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'c');
}

export function getMediaStreamInfo(filePath) {
  try {
    const raw = execSync(`ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,sample_rate,channels -of json "${filePath}"`, { timeout: 10000 }).toString();
    const data = JSON.parse(raw);
    const video = data.streams?.find(s => s.codec_type === 'video');
    const audio = data.streams?.find(s => s.codec_type === 'audio');
    return {
      vCodec: video?.codec_name || '',
      width: Number(video?.width) || 0,
      height: Number(video?.height) || 0,
      aCodec: audio?.codec_name || '',
      sampleRate: audio?.sample_rate ? String(audio.sample_rate) : '',
      channels: Number(audio?.channels) || 0
    };
  } catch (e) {
    return null;
  }
}

export function convertVttToSrt(vttText) {
  if (!vttText) return '';
  let srt = vttText
    .replace(/^WEBVTT[^\r\n]*\r?\n/i, '')
    .replace(/NOTE[^\r\n]*\r?\n([\s\S]*?\r?\n\r?\n)/gi, '')
    .replace(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g, '$1:$2:$3,$4')
    .replace(/(\d{2}):(\d{2})\.(\d{3})/g, '00:$1:$2,$3')
    .replace(/<[^>]+>/g, '')
    .trim();

  const blocks = srt.split(/\r?\n\r?\n+/);
  const numberedBlocks = [];
  let seq = 1;
  for (let block of blocks) {
    block = block.trim();
    if (!block) continue;
    const lines = block.split(/\r?\n/);
    if (!/^\d+$/.test(lines[0])) {
      numberedBlocks.push(`${seq}\n${block}`);
    } else {
      numberedBlocks.push(block);
    }
    seq++;
  }
  return numberedBlocks.join('\n\n');
}

export async function withRetry(fn, retries = 3, delayMs = 3000) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err.message === 'İndirme iptal edildi.') throw err;
      if (attempt < retries) {
        logger.warn({ attempt, retries, delaySec: delayMs / 1000, err: err.message }, `[RETRY] Deneme ${attempt}/${retries} başarısız. ${delayMs / 1000}sn sonra tekrar...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

