import fs from 'fs';
import path from 'path';
import { sessionPath } from './config.js';

const cacheFilePath = path.join(sessionPath, 'cache_db.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours

function readCacheFile() {
  if (fs.existsSync(cacheFilePath)) {
    try {
      return JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function writeCacheFile(data) {
  try {
    fs.writeFileSync(cacheFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Cache] Save error:', err.message);
  }
}

export function getCachedResult(url) {
  try {
    const cache = readCacheFile();
    const entry = cache[url];
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > CACHE_TTL_MS) {
      delete cache[url];
      writeCacheFile(cache);
      return null;
    }

    return entry.result;
  } catch (e) {
    return null;
  }
}

export function saveToCache(url, result) {
  try {
    const cache = readCacheFile();
    cache[url] = {
      timestamp: Date.now(),
      result
    };
    writeCacheFile(cache);
  } catch (e) {}
}

export function clearExpiredCache() {
  try {
    const cache = readCacheFile();
    const now = Date.now();
    let modified = false;

    for (const url of Object.keys(cache)) {
      if (now - cache[url].timestamp > CACHE_TTL_MS) {
        delete cache[url];
        modified = true;
      }
    }

    if (modified) {
      writeCacheFile(cache);
    }
  } catch (e) {}
}
