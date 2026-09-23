import fs from 'fs';
import path from 'path';
import { gotScraping as originalGotScraping } from 'got-scraping';
import { getProxyUrl, cleanOldDownloads } from '../config.js';
import { getModuleLogger } from '../utils/logger.js';

const logger = getModuleLogger('downloader-utils');

export async function checkAvailableDiskSpace(targetDir, requiredBytes = 500 * 1024 * 1024) {
  try {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(targetDir);
      const freeBytes = stats.bavail * stats.bsize;
      if (freeBytes < 2 * 1024 * 1024 * 1024) {
        logger.warn({ freeMB: (freeBytes / 1024 / 1024).toFixed(0) }, '[DISK UYARISI] Düşük boş disk alanı. Temizlik tetikleniyor...');
        cleanOldDownloads();
      }
      const statsAfter = fs.statfsSync(targetDir);
      const freeAfter = statsAfter.bavail * statsAfter.bsize;
      if (freeAfter < Math.max(requiredBytes, 1024 * 1024 * 1024)) {
        throw new Error(`Yetersiz disk alanı: Sadece ${(freeAfter / 1024 / 1024).toFixed(0)} MB boş alan var.`);
      }
    }
  } catch (err) {
    if (err.message && err.message.startsWith('Yetersiz disk')) throw err;
  }
}

export function shouldUseProxy(url) {
  if (!url) return false;
  const lowerUrl = String(url).toLowerCase();
  return lowerUrl.includes('pornhub.com') ||
         lowerUrl.includes('phncdn.com') ||
         lowerUrl.includes('hentaizm') ||
         lowerUrl.includes('turkifsahub.com') ||
         lowerUrl.includes('turkifsalar') ||
         lowerUrl.includes('turkporno') ||
         lowerUrl.includes('cloud.mail.ru') ||
         lowerUrl.includes('cloclo') ||
         lowerUrl.includes('mail.ru');
}

export const gotScraping = new Proxy(originalGotScraping, {
  apply(target, thisArg, argumentsList) {
    const options = argumentsList[0] || {};
    const url = options.url || '';
    const activeProxy = getProxyUrl();
    if (typeof options === 'object' && activeProxy && shouldUseProxy(url)) {
      options.proxyUrl = activeProxy;
    }
    return Reflect.apply(target, thisArg, argumentsList);
  },
  get(target, prop, receiver) {
    if (['get', 'post', 'put', 'patch', 'delete', 'head'].includes(prop)) {
      return (url, options) => {
        let opt = {};
        if (typeof url === 'object') {
          opt = url;
        } else {
          opt = options || {};
          opt.url = url;
        }
        const activeProxy = getProxyUrl();
        if (activeProxy && shouldUseProxy(opt.url)) {
          opt.proxyUrl = activeProxy;
        }
        return originalGotScraping[prop](opt);
      };
    }
    return Reflect.get(target, prop, receiver);
  }
});

export function resolveUrl(baseUrl, relativeUrl) {
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  const base = new URL(baseUrl);
  if (relativeUrl.startsWith('/')) {
    return `${base.origin}${relativeUrl}`;
  }
  const pathParts = base.pathname.split('/');
  pathParts.pop();
  const basePath = pathParts.join('/');
  return `${base.origin}${basePath}/${relativeUrl}`;
}

