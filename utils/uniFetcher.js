import * as cheerio from 'cheerio';
import { getItemEmoji } from './menuData.js';

let uniMenuCache = null;
let lastFetchTime = 0;

/**
 * Scrapes the University House menu from the official website.
 * @returns {Promise<{date: string, items: string[]}|null>}
 */
export async function fetchUniversityMenu() {
  const url = 'https://unievi.firat.edu.tr';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const html = await res.text();
    const $ = cheerio.load(html);
    const foodDate = $('.university-food .food-date').first().text().trim().replace(/\\s+/g, ' ') || 'Günün Menüsü';

    const foodItems = [];
    $('.university-food .box .box__content p, .university-food .box p').each((_, el) => {
      const itemText = $(el).text().trim().replace(/\\s+/g, ' ');
      if (itemText && !foodItems.includes(itemText)) {
        foodItems.push(itemText);
      }
    });

    if (foodItems.length === 0) return null;

    return { date: foodDate, items: foodItems };
  } catch (err) {
    console.error('[UniFetcher] Scraping error:', err.message);
    return null;
  }
}

/**
 * Gets the university menu, using cache if available.
 */
export async function getUniversityMenu() {
  if (uniMenuCache) return uniMenuCache;

  const data = await fetchUniversityMenu();
  if (data) {
    uniMenuCache = data;
    lastFetchTime = Date.now();
  }
  return uniMenuCache;
}

/**
 * Forces a refresh of the university menu cache.
 * Used by the background scheduler.
 */
export async function refreshUniversityMenuCache() {
  console.log('[UniFetcher] Refreshing university house menu cache...');
  const data = await fetchUniversityMenu();
  if (data) {
    uniMenuCache = data;
    lastFetchTime = Date.now();
    console.log('[UniFetcher] Cache updated successfully.');
  } else {
    console.error('[UniFetcher] Failed to update cache.');
  }
  return data;
}
