import fs from 'fs';
import path from 'path';
import { sessionPath } from '../config.js';

const storeFile = path.join(sessionPath, 'hentai_fav_store.json');

// In-memory mappings
const numToAnimeMap = new Map();
const lastPageByChat = new Map();

// Initialize from disk if available
try {
  if (fs.existsSync(storeFile)) {
    const data = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    if (data.items && typeof data.items === 'object') {
      for (const [k, v] of Object.entries(data.items)) {
        numToAnimeMap.set(parseInt(k, 10), v);
      }
    }
    if (data.lastPageByChat && typeof data.lastPageByChat === 'object') {
      for (const [k, v] of Object.entries(data.lastPageByChat)) {
        lastPageByChat.set(k, v);
      }
    }
  }
} catch (err) {
  console.warn('[HentaiFavStore] Cache yüklenirken hata:', err.message);
}

function persist() {
  try {
    const itemsObj = {};
    for (const [k, v] of numToAnimeMap.entries()) {
      itemsObj[k] = v;
    }
    const chatObj = {};
    for (const [k, v] of lastPageByChat.entries()) {
      chatObj[k] = v;
    }
    fs.writeFileSync(storeFile, JSON.stringify({ items: itemsObj, lastPageByChat: chatObj }, null, 2), 'utf8');
  } catch (err) {
    console.warn('[HentaiFavStore] Cache kaydedilemedi:', err.message);
  }
}

export const hentaiFavStore = {
  /**
   * Save a page of anime listings and assign numbers to each
   */
  savePage(page, animeList, from = null) {
    const pageNum = parseInt(page, 10) || 1;
    const baseIndex = (pageNum - 1) * 20;

    // Clear old items for this page
    for (const [k, v] of numToAnimeMap.entries()) {
      if (v.page === pageNum) {
        numToAnimeMap.delete(k);
      }
    }

    const assignedList = animeList.map((item, idx) => {
      const index = baseIndex + (idx + 1);
      const entry = {
        index,
        localIndex: idx + 1,
        url: item.url,
        title: item.title,
        posterUrl: item.posterUrl,
        page: pageNum
      };
      numToAnimeMap.set(index, entry);
      return entry;
    });

    if (from) {
      lastPageByChat.set(from, pageNum);
    }

    persist();
    return assignedList;
  },

  /**
   * Get an anime by number (either global index or relative to current page)
   */
  getItem(num, from = null) {
    const n = parseInt(num, 10);
    if (isNaN(n)) return null;

    // 1. Direct match with global index
    if (numToAnimeMap.has(n)) {
      return numToAnimeMap.get(n);
    }

    // 2. Relative index from user's last viewed page
    if (from && lastPageByChat.has(from)) {
      const lastPage = lastPageByChat.get(from);
      const relativeIndex = (lastPage - 1) * 20 + n;
      if (numToAnimeMap.has(relativeIndex)) {
        return numToAnimeMap.get(relativeIndex);
      }
    }

    return null;
  },

  /**
   * Get last viewed page for a chat
   */
  getLastPage(from) {
    return (from && lastPageByChat.get(from)) || 1;
  },

  /**
   * Return size of store
   */
  size() {
    return numToAnimeMap.size;
  },

  /**
   * Return all items
   */
  getAll() {
    return Array.from(numToAnimeMap.values());
  },

  /**
   * Find an item by title or URL snippet
   */
  findItemByText(text) {
    if (!text) return null;
    const clean = text.toLowerCase().trim();
    for (const item of numToAnimeMap.values()) {
      if (item.url && clean.includes(item.url.toLowerCase())) return item;
      if (item.title && item.title.length > 3 && (clean.includes(item.title.toLowerCase()) || item.title.toLowerCase().includes(clean))) {
        return item;
      }
    }
    return null;
  },

  /**
   * Clear all items in memory and on disk
   */
  clear() {
    numToAnimeMap.clear();
    lastPageByChat.clear();
    persist();
  }
};
