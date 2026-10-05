import fs from 'fs';
import path from 'path';
import { sessionPath, atomicWriteFileSync } from './config.js';

const cacheFilePath = path.join(sessionPath, 'cache_db.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours

let memoryCache = null;

function loadMemoryCache() {
  if (memoryCache) return memoryCache;
  if (fs.existsSync(cacheFilePath)) {
    try {
      memoryCache = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
      return memoryCache;
    } catch {
      memoryCache = {};
      return memoryCache;
    }
  }
  memoryCache = {};
  return memoryCache;
}

function writeCacheFile() {
  try {
    const data = loadMemoryCache();
    atomicWriteFileSync(cacheFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Cache] Save error:', err.message);
  }
}

export function getCachedResult(url) {
  try {
    const cache = loadMemoryCache();
    const entry = cache[url];
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > CACHE_TTL_MS) {
      delete cache[url];
      writeCacheFile();
      return null;
    }

    return entry.result;
  } catch (e) {
    return null;
  }
}

export function saveToCache(url, result) {
  try {
    if (!result || !result.url) return;

    // Don't cache ephemeral stream URLs with short-lived tokens
    const isEphemeral = /[?&](e|token|expire|hash|h)=/i.test(result.url) || 
                        result.url.includes('phncdn.com') || 
                        result.url.includes('.m3u8');
    if (isEphemeral) {
      console.log(`[Cache] Skipping cache for ephemeral stream URL: ${url}`);
      return;
    }

    const cache = loadMemoryCache();
    cache[url] = {
      timestamp: Date.now(),
      result
    };
    writeCacheFile();
  } catch (e) {}
}

export function deleteFromCache(url) {
  try {
    const cache = loadMemoryCache();
    if (cache[url]) {
      delete cache[url];
      writeCacheFile();
      console.log(`[Cache] Invalidated cache entry for: ${url}`);
    }
  } catch (e) {}
}

export function clearExpiredCache() {
  try {
    const cache = loadMemoryCache();
    const now = Date.now();
    let modified = false;

    for (const url of Object.keys(cache)) {
      if (now - cache[url].timestamp > CACHE_TTL_MS) {
        delete cache[url];
        modified = true;
      }
    }

    if (modified) {
      writeCacheFile();
    }
  } catch (e) {}
}
