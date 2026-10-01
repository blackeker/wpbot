#!/usr/bin/env node
/**
 * ============================================================================
 * KYK / Yemek Menüsü Dinamik Düzenleme ve Karşılaştırma CLI Aracı (menu-cli.js)
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.resolve(__dirname, 'data.json');
const BACKUPS_DIR = path.resolve(__dirname, 'backups');

// ANSI Renk Kodları
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  inverse: '\x1b[7m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgCyan: '\x1b[46m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m'
};

const DAYS_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export function normalizeTr(str) {
  if (!str) return '';
  return str.toString()
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseDateStr(str) {
  if (!str) return new Date();
  const [d, m, y] = str.split('.').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function getDayName(dateStr) {
  const d = parseDateStr(dateStr);
  return DAYS_TR[d.getDay()];
}

export function addDays(dateStr, days = 1) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

// ============================================================================
// VERİ VE KELİME SÖZLÜĞÜ
// ============================================================================

let menuData = [];
const foodDictionary = new Set();
let hasUnsavedChanges = false;
let currentIndex = 0;

function addToDictionary(item) {
  if (!item || typeof item !== 'string') return;
  const trimmed = item.trim();
  if (!trimmed) return;
  foodDictionary.add(trimmed);

  // Parantez içi açıklamaları temizleyerek yalın halini de ekle (Örn: "Tavuk Döner (Soslu)" -> "Tavuk Döner")
  if (trimmed.includes('(') && trimmed.includes(')')) {
    const cleanNoParen = trimmed.replace(/\s*\([^)]*\)/g, '').trim();
    if (cleanNoParen && cleanNoParen !== trimmed) {
      foodDictionary.add(cleanNoParen);
    }
  }

  // / veya + ile ayrılmış alternatif yemekleri ayrı ayrı ekle
  if (trimmed.includes('/')) {
    trimmed.split('/').forEach(part => addToDictionary(part));
  }
  if (trimmed.includes('+')) {
    trimmed.split('+').forEach(part => addToDictionary(part));
  }
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      menuData = [];
      return;
    }
    const raw = fs.readFileSync(DATA_PATH, 'utf-8');
    menuData = JSON.parse(raw);
    if (!Array.isArray(menuData)) {
      menuData = [];
    }

    foodDictionary.clear();
    menuData.forEach(entry => {
      (entry.kahvalti || []).forEach(addToDictionary);
      (entry.aksam_yemegi || []).forEach(addToDictionary);
    });

    // Başlangıç: bugünün tarihi veya bugüne en yakın gün
    const todayStr = formatDate(new Date());
    const foundIdx = menuData.findIndex(d => d.tarih === todayStr);
    if (foundIdx !== -1) {
      currentIndex = foundIdx;
    } else {
      const todayTime = parseDateStr(todayStr).getTime();
      const upcomingIdx = menuData.findIndex(d => parseDateStr(d.tarih).getTime() >= todayTime);
      if (upcomingIdx !== -1) {
        currentIndex = upcomingIdx;
      } else {
        currentIndex = 0;
      }
    }
  } catch (err) {
    menuData = [];
  }
}

function saveData() {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = path.join(BACKUPS_DIR, `data_${ts}.json`);

    if (fs.existsSync(DATA_PATH)) {
      fs.copyFileSync(DATA_PATH, backupFile);
      fs.copyFileSync(DATA_PATH, `${DATA_PATH}.bak`);
    }

    fs.writeFileSync(DATA_PATH, JSON.stringify(menuData, null, 2), 'utf-8');
    hasUnsavedChanges = false;
    return { success: true, backupFile };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function getSuggestions(query, dictionary = foodDictionary, limit = 5) {
  const nq = normalizeTr(query);
  if (!nq) return [];

  const qTokens = nq.split(/\s+/).filter(Boolean);
  if (qTokens.length === 0) return [];

  const results = [];

  for (const item of dictionary) {
    const ni = normalizeTr(item);
    if (ni === nq) continue;

    const itemTokens = ni.split(/[\s/+,()\-]+/).filter(Boolean);
    let score = 0;

    // 1. Doğrudan tam başlangıç eşleşmesi (Örn: "mercimek ço" -> "Mercimek Çorbası")
    if (ni.startsWith(nq)) {
      score = 1000 - (ni.length - nq.length);
    }
    // 2. Parça başlangıç eşleşmesi (Örn: "/ mercimek ço" veya "+ mercimek ço")
    else if (ni.includes('/ ' + nq) || ni.includes('+ ' + nq) || ni.includes(' ' + nq)) {
      score = 850 - (ni.length - nq.length);
    }
    // 3. İçinde tam substring geçmesi
    else if (ni.includes(nq)) {
      score = 700 - (ni.length - nq.length);
    }
    // 4. Kelime bazlı çoklu kelime eşleşmesi (Örn: "ço mercimek" veya "pilav sehriye")
    else if (qTokens.length > 1) {
      let allMatched = true;
      let inOrder = true;
      let lastMatchIdx = -1;

      for (const qt of qTokens) {
        const matchIdx = itemTokens.findIndex(it => it.startsWith(qt) || it.includes(qt));
        if (matchIdx === -1) {
          allMatched = false;
          break;
        } else {
          if (matchIdx < lastMatchIdx) inOrder = false;
          lastMatchIdx = matchIdx;
        }
      }

      if (allMatched) {
        const orderBonus = inOrder ? 100 : 0;
        const lastQt = qTokens[qTokens.length - 1];
        const lastPrefixBonus = itemTokens.some(it => it.startsWith(lastQt)) ? 60 : 0;
        score = 500 + orderBonus + lastPrefixBonus - (ni.length - nq.length);
      }
    }
    // 5. Tek kelime için kelime başı veya içi eşleşmesi
    else if (qTokens.length === 1) {
      const qt = qTokens[0];
      if (itemTokens.some(it => it.startsWith(qt))) {
        score = 450 - (ni.length - nq.length);
      } else if (itemTokens.some(it => it.includes(qt))) {
        score = 250 - (ni.length - nq.length);
      }
    }

    if (score > 0) {
      // Tekil, içinde '/' barındırmayan net yemeklere öncelik ver (uzun alternatif cümleleri arkaya at)
      const cleanBonus = item.includes('/') ? 0 : 200;
      results.push({ item, score: score + cleanBonus });
    }
  }

  results.sort((a, b) => b.score - a.score || a.item.length - b.item.length);
  return results.slice(0, limit).map(r => r.item);
}

// ============================================================================
// GÜVENİLİR VE KESİNTİSİZ TERMİNAL GİRDİ YÖNETİCİSİ (TerminalInput)
// ============================================================================

class TerminalInput {
  constructor() {
    this.currentHandler = null;
    this.isTTY = Boolean(process.stdin.isTTY);

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.setRawMode) {
      try {
        process.stdin.setRawMode(true);
      } catch (e) {}
    }
    process.stdin.resume();

    process.stdin.on('keypress', (str, key) => {
      // Global acil çıkış: Ctrl+C
      if (key && key.ctrl && key.name === 'c') {
        process.stdout.write(`\n${C.reset}Çıkılıyor...\n`);
        process.exit(0);
      }
      if (this.currentHandler) {
        this.currentHandler(str, key || {});
      }
    });
  }

  /**
   * Menüde tek bir tuşa basılmasını bekler (Enter basmaya gerek kalmaz).
   */
  getKey() {
    return new Promise((resolve) => {
      this.currentHandler = (str, key) => {
        this.currentHandler = null;
        resolve({
          str: str || '',
          name: key.name || str || '',
          key
        });
      };
    });
  }

  /**
   * Canlı yazarken öneri gösteren input okuyucu.
   */
  readLineWithAutocomplete(promptLabel, initialValue = '', getSuggestionsFn = getSuggestions) {
    return new Promise((resolve) => {
      let input = initialValue || '';
      let cursor = input.length;
      let selectedIdx = -1;
      let suggestions = [];
      let extraLines = 0;

      function getActiveSegment(text, cursorPos) {
        const before = text.slice(0, cursorPos);
        const lastSlash = before.lastIndexOf('/');
        if (lastSlash === -1) {
          return {
            isSegmented: false,
            prefix: '',
            segment: before,
            suffix: text.slice(cursorPos)
          };
        }
        const prefix = before.slice(0, lastSlash + 1) + ' ';
        const segment = before.slice(lastSlash + 1).trimStart();
        const suffix = text.slice(cursorPos);
        return {
          isSegmented: true,
          prefix,
          segment,
          suffix
        };
      }

      const render = () => {
        const active = getActiveSegment(input, cursor);
        const querySegment = active.segment;

        suggestions = querySegment.trim() && getSuggestionsFn ? getSuggestionsFn(querySegment) : [];
        if (selectedIdx >= suggestions.length) selectedIdx = suggestions.length - 1;
        if (selectedIdx < -1) selectedIdx = -1;

        // Önceki öneri satırlarını temizle
        if (extraLines > 0) {
          process.stdout.write(`\x1b[${extraLines}B`);
          for (let i = 0; i < extraLines; i++) {
            process.stdout.write('\r\x1b[2K\x1b[1A');
          }
          process.stdout.write('\r\x1b[2K');
        } else {
          process.stdout.write('\r\x1b[2K');
        }

        // Hayalet metin (aktif parçanın kalan kısmı veya Tab ipucu)
        let ghostText = '';
        if (selectedIdx === -1 && suggestions.length > 0 && querySegment.trim()) {
          const top = suggestions[0];
          const nTop = normalizeTr(top);
          const nSeg = normalizeTr(querySegment);
          if (nTop.startsWith(nSeg)) {
            ghostText = top.slice(querySegment.length);
          } else {
            ghostText = `  ${C.dim}[Tab: ${top}]${C.reset}`;
          }
        }

        process.stdout.write(`\r${C.bold}${promptLabel}${C.reset} ${C.cyan}${input}${C.reset}${C.gray}${ghostText}${C.reset}`);

        // Öneri listesini yaz
        const lines = [];
        if (suggestions.length > 0) {
          lines.push(`  ${C.gray}💡 Öneriler:${C.reset} ${C.dim}[Tab/Sağ Ok: Tamamla | ↑/↓: Seç | Enter: Onayla | Esc: İptal]${C.reset}`);
          suggestions.forEach((sug, i) => {
            if (i === selectedIdx) {
              lines.push(`  ${C.bgCyan}${C.bold}${C.white} ❯ ${i + 1}. ${sug} ${C.reset}`);
            } else {
              lines.push(`    ${C.yellow}${i + 1}.${C.reset} ${sug}`);
            }
          });
        }

        extraLines = lines.length;
        if (extraLines > 0) {
          process.stdout.write('\n' + lines.join('\n'));
          process.stdout.write(`\x1b[${extraLines}A`);
        }

        // İmleci tam olarak inputun cursor pozisyonuna konumlandır
        const cleanPrompt = promptLabel.replace(/\x1b\[[0-9;]*m/g, '');
        const targetCol = cleanPrompt.length + 1 + cursor;
        process.stdout.write(`\r\x1b[${targetCol}C`);
      };

      const cleanup = () => {
        if (extraLines > 0) {
          process.stdout.write(`\x1b[${extraLines}B`);
          for (let i = 0; i < extraLines; i++) {
            process.stdout.write('\r\x1b[2K\x1b[1A');
          }
          process.stdout.write('\r\x1b[2K');
        }
        process.stdout.write('\r\x1b[2K');
      };

      render();

      this.currentHandler = (str, key) => {
        if (key.name === 'escape') {
          cleanup();
          this.currentHandler = null;
          process.stdout.write(`${promptLabel} ${C.gray}(İptal edildi)${C.reset}\n`);
          resolve(null);
          return;
        }

        if (key.name === 'return' || key.name === 'enter' || str === '\r' || str === '\n') {
          let finalVal = input;
          if (selectedIdx >= 0 && suggestions[selectedIdx]) {
            const chosen = suggestions[selectedIdx];
            const active = getActiveSegment(input, cursor);
            finalVal = active.isSegmented ? (active.prefix + chosen + active.suffix) : (chosen + active.suffix);
          }
          cleanup();
          this.currentHandler = null;
          process.stdout.write(`${promptLabel} ${C.green}${C.bold}${finalVal.trim()}${C.reset}\n`);
          if (finalVal.trim()) addToDictionary(finalVal.trim());
          resolve(finalVal.trim());
          return;
        }

        // Tab veya Sağ Ok ile öneriyi tamamla
        if (key.name === 'tab' || (key.name === 'right' && cursor === input.length)) {
          if (suggestions.length > 0) {
            const chosen = selectedIdx >= 0 ? suggestions[selectedIdx] : suggestions[0];
            const active = getActiveSegment(input, cursor);
            if (active.isSegmented) {
              const cleanedSuffix = active.suffix.startsWith(' ') ? active.suffix : (active.suffix ? ' ' + active.suffix : '');
              input = active.prefix + chosen + cleanedSuffix;
              cursor = (active.prefix + chosen).length;
            } else {
              input = chosen + active.suffix;
              cursor = chosen.length;
            }
            selectedIdx = -1;
            render();
          }
          return;
        }

        if (key.name === 'down') {
          if (suggestions.length > 0) {
            selectedIdx = (selectedIdx + 1) % suggestions.length;
            render();
          }
          return;
        }

        if (key.name === 'up') {
          if (suggestions.length > 0) {
            selectedIdx = (selectedIdx - 1 + suggestions.length) % suggestions.length;
            render();
          }
          return;
        }

        if (key.name === 'left') {
          if (cursor > 0) cursor--;
          render();
          return;
        }

        if (key.name === 'right') {
          if (cursor < input.length) cursor++;
          render();
          return;
        }

        if (key.name === 'backspace') {
          if (cursor > 0) {
            input = input.slice(0, cursor - 1) + input.slice(cursor);
            cursor--;
            selectedIdx = -1;
            render();
          }
          return;
        }

        if (key.name === 'delete') {
          if (cursor < input.length) {
            input = input.slice(0, cursor) + input.slice(cursor + 1);
            selectedIdx = -1;
            render();
          }
          return;
        }

        if (str && !key.ctrl && !key.meta) {
          input = input.slice(0, cursor) + str + input.slice(cursor);
          cursor += str.length;
          selectedIdx = -1;
          render();
        }
      };
    });
  }

  /**
   * Basit tek satır girdi okuyucu (Tarih, onay vb. için).
   */
  readLine(promptLabel, initialValue = '') {
    return this.readLineWithAutocomplete(promptLabel, initialValue, () => []);
  }
}

const term = new TerminalInput();

// ============================================================================
// EKRANLAR
// ============================================================================

function renderHeader() {
  console.clear();
  const unsavedBadge = hasUnsavedChanges
    ? ` ${C.bgYellow}${C.bold}${C.black} [DİKKAT: KAYDEDİLMEMİŞ DEĞİŞİKLİKLER VAR] ${C.reset}`
    : ` ${C.gray}[data.json senkronize]${C.reset}`;

  console.log(`${C.cyan}╔════════════════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset}  ${C.bold}🍽️  KYK / YEMEK MENÜSÜ DÜZENLEME VE KARŞILAŞTIRMA SİSTEMİ${C.reset}                         ${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}╚════════════════════════════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(unsavedBadge);
}

function renderDayView() {
  renderHeader();

  if (menuData.length === 0) {
    console.log(`\n${C.yellow}ℹ️ Menü verisinde henüz kayıtlı gün bulunmuyor.${C.reset}`);
    console.log(`${C.green}[+] Yeni gün eklemek için '+' tuşuna basın.${C.reset}`);
    return;
  }

  if (currentIndex < 0) currentIndex = 0;
  if (currentIndex >= menuData.length) currentIndex = menuData.length - 1;

  const current = menuData[currentIndex];
  const total = menuData.length;
  const todayStr = formatDate(new Date());
  const tomorrowStr = addDays(todayStr, 1);

  let dateBadge = '';
  if (current.tarih === todayStr) {
    dateBadge = ` ${C.bgGreen}${C.bold}${C.white} [BUGÜN] ${C.reset}`;
  } else if (current.tarih === tomorrowStr) {
    dateBadge = ` ${C.bgBlue}${C.bold}${C.white} [YARIN] ${C.reset}`;
  }

  console.log(`\n${C.bold}📅 Gün ${currentIndex + 1} / ${total}:${C.reset} ${C.cyan}${C.bold}${current.tarih}${C.reset} — ${C.magenta}${C.bold}${current.gun || getDayName(current.tarih)}${C.reset}${dateBadge}`);
  console.log(`${C.gray}────────────────────────────────────────────────────────────────────────────────────────${C.reset}`);

  // Kahvaltı
  const kahvalti = current.kahvalti || [];
  console.log(`\n${C.yellow}${C.bold}🍳 KAHVALTI MENÜSÜ (${kahvalti.length} Çeşit):${C.reset}`);
  if (kahvalti.length === 0) {
    console.log(`  ${C.gray}— Kahvaltı menüsü boş —${C.reset}`);
  } else {
    kahvalti.forEach((item, idx) => {
      console.log(`  ${C.yellow}[${idx + 1}]${C.reset} ${item}`);
    });
  }

  // Akşam Yemeği
  const aksam = current.aksam_yemegi || [];
  console.log(`\n${C.blue}${C.bold}🍲 AKŞAM YEMEĞİ MENÜSÜ (${aksam.length} Çeşit):${C.reset}`);
  if (aksam.length === 0) {
    console.log(`  ${C.gray}— Akşam yemeği menüsü boş —${C.reset}`);
  } else {
    aksam.forEach((item, idx) => {
      console.log(`  ${C.blue}[${idx + 1}]${C.reset} ${item}`);
    });
  }

  console.log(`\n${C.gray}════════════════════════════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}KONTROLLER (Tek tuşla çalışır):${C.reset}`);
  console.log(` ${C.cyan}[N / →]${C.reset} Sonraki Gün          ${C.cyan}[P / ←]${C.reset} Önceki Gün         ${C.cyan}[G]${C.reset} Tarihe Git        ${C.cyan}[B]${C.reset} Bugüne Git`);
  console.log(` ${C.yellow}[1]${C.reset}     Kahvaltıyı Düzenle    ${C.blue}[2]${C.reset}     Akşamı Düzenle     ${C.green}[+]${C.reset} Yeni Gün Ekle     ${C.yellow}[T]${C.reset} Günü Temizle`);
  console.log(` ${C.magenta}[C]${C.reset}     Karşılaştır (Yan yana) ${C.white}[A]${C.reset}     Yemek Ara (Sözlük) ${C.green}[S]${C.reset} Kaydet (data.json) ${C.red}[-] Günü Sil / [Q] Çıkış${C.reset}`);
  console.log(`${C.gray}════════════════════════════════════════════════════════════════════════════════════════${C.reset}`);
  process.stdout.write(`${C.bold}Seçiminiz: ${C.reset}`);
}

async function compareTwoDays(dayA, dayB) {
  renderHeader();
  console.log(`\n${C.bold}📊 GÜNLERİ YAN YANA KARŞILAŞTIRMA${C.reset}`);
  console.log(`${C.gray}────────────────────────────────────────────────────────────────────────────────────────${C.reset}`);

  const colWidth = 40;
  const pad = (str, len) => {
    const plain = (str || '').replace(/\x1b\[[0-9;]*m/g, '');
    const diff = len - plain.length;
    return str + ' '.repeat(Math.max(0, diff));
  };

  const headerA = `${C.cyan}${C.bold}${dayA.tarih} (${dayA.gun})${C.reset}`;
  const headerB = `${C.magenta}${C.bold}${dayB.tarih} (${dayB.gun})${C.reset}`;
  console.log(`${pad(headerA, colWidth)} │ ${pad(headerB, colWidth)}`);
  console.log(`${'─'.repeat(colWidth)}─┼─${'─'.repeat(colWidth)}`);

  console.log(`${C.yellow}${pad('🍳 KAHVALTI:', colWidth)}${C.reset} │ ${C.yellow}${pad('🍳 KAHVALTI:', colWidth)}${C.reset}`);
  const maxKahvalti = Math.max((dayA.kahvalti || []).length, (dayB.kahvalti || []).length);
  for (let i = 0; i < maxKahvalti; i++) {
    const itemA = (dayA.kahvalti || [])[i] || '—';
    const itemB = (dayB.kahvalti || [])[i] || '—';
    const isSame = normalizeTr(itemA) === normalizeTr(itemB);
    const colorA = isSame ? C.green : C.white;
    const colorB = isSame ? C.green : C.yellow;
    console.log(`${colorA}${pad(`• ${itemA}`, colWidth)}${C.reset} │ ${colorB}${pad(`• ${itemB}`, colWidth)}${C.reset}`);
  }

  console.log(`${'─'.repeat(colWidth)}─┼─${'─'.repeat(colWidth)}`);
  console.log(`${C.blue}${pad('🍲 AKŞAM YEMEĞİ:', colWidth)}${C.reset} │ ${C.blue}${pad('🍲 AKŞAM YEMEĞİ:', colWidth)}${C.reset}`);
  const maxAksam = Math.max((dayA.aksam_yemegi || []).length, (dayB.aksam_yemegi || []).length);
  for (let i = 0; i < maxAksam; i++) {
    const itemA = (dayA.aksam_yemegi || [])[i] || '—';
    const itemB = (dayB.aksam_yemegi || [])[i] || '—';
    const isSame = normalizeTr(itemA) === normalizeTr(itemB);
    const colorA = isSame ? C.green : C.white;
    const colorB = isSame ? C.green : C.yellow;
    console.log(`${colorA}${pad(`• ${itemA}`, colWidth)}${C.reset} │ ${colorB}${pad(`• ${itemB}`, colWidth)}${C.reset}`);
  }

  console.log(`${C.gray}────────────────────────────────────────────────────────────────────────────────────────${C.reset}`);
  console.log(`${C.green}Yeşil${C.reset}: Birebir aynı yemekler  |  ${C.yellow}Sarı/Beyaz${C.reset}: Farklı olan yemekler`);
  process.stdout.write(`\n${C.cyan}Geri dönmek için herhangi bir tuşa basın...${C.reset}`);
  await term.getKey();
}

async function handleCompareMenu() {
  if (menuData.length < 2) {
    process.stdout.write(`\n${C.yellow}Karşılaştırma için en az 2 gün kayıtlı olmalı. Devam için bir tuşa basın...${C.reset}`);
    await term.getKey();
    return;
  }

  const current = menuData[currentIndex];
  renderHeader();
  console.log(`\n${C.bold}🔍 Karşılaştırma Yapılacak Gün: ${C.cyan}${current.tarih} (${current.gun})${C.reset}\n`);
  console.log(` [1] 7 Gün Önceki Menü ile Karşılaştır (Geçen haftaki aynı gün)`);
  console.log(` [2] Bir Önceki Gün ile Karşılaştır`);
  console.log(` [3] Bir Sonraki Gün ile Karşılaştır`);
  console.log(` [4] Belirli bir tarih gir`);
  console.log(` [0] İptal`);
  process.stdout.write(`\n${C.bold}Seçiminiz (0-4): ${C.reset}`);

  const keyObj = await term.getKey();
  const choice = keyObj.name || keyObj.str;
  if (choice === '0' || choice === 'escape') return;

  let targetDay = null;

  if (choice === '1') {
    const prevWeekDate = addDays(current.tarih, -7);
    targetDay = menuData.find(d => d.tarih === prevWeekDate);
    if (!targetDay) {
      process.stdout.write(`\n${C.red}7 gün öncesine (${prevWeekDate}) ait bir kayıt bulunamadı. Devam için bir tuşa basın...${C.reset}`);
      await term.getKey();
      return;
    }
  } else if (choice === '2') {
    if (currentIndex > 0) {
      targetDay = menuData[currentIndex - 1];
    } else {
      process.stdout.write(`\n${C.red}Önceki gün bulunamadı. Devam için bir tuşa basın...${C.reset}`);
      await term.getKey();
      return;
    }
  } else if (choice === '3') {
    if (currentIndex < menuData.length - 1) {
      targetDay = menuData[currentIndex + 1];
    } else {
      process.stdout.write(`\n${C.red}Sonraki gün bulunamadı. Devam için bir tuşa basın...${C.reset}`);
      await term.getKey();
      return;
    }
  } else if (choice === '4') {
    const dateInput = await term.readLine(`\n${C.bold}Karşılaştırılacak Tarih (Örn: 21.09.2026): ${C.reset}`);
    if (dateInput) {
      targetDay = menuData.find(d => d.tarih === dateInput.trim());
      if (!targetDay) {
        process.stdout.write(`\n${C.red}"${dateInput}" tarihine ait menü bulunamadı. Devam için bir tuşa basın...${C.reset}`);
        await term.getKey();
        return;
      }
    }
  }

  if (targetDay) {
    await compareTwoDays(current, targetDay);
  }
}

async function handleEditMeal(mealType = 'kahvalti') {
  const current = menuData[currentIndex];
  if (!current) return;

  const title = mealType === 'kahvalti' ? '🍳 KAHVALTI' : '🍲 AKŞAM YEMEĞİ';
  const color = mealType === 'kahvalti' ? C.yellow : C.blue;

  while (true) {
    renderHeader();
    console.log(`\n${color}${C.bold}--- ${title} DÜZENLEME (${current.tarih} - ${current.gun}) ---${C.reset}\n`);

    const list = current[mealType] || [];
    if (list.length === 0) {
      console.log(`  ${C.gray}(Listeniz boş)${C.reset}`);
    } else {
      list.forEach((item, idx) => {
        console.log(`  ${color}[${idx + 1}]${C.reset} ${item}`);
      });
    }

    console.log(`\n${C.bold}İŞLEMLER:${C.reset}`);
    console.log(` • Bir yemeği düzenlemek için: ${C.cyan}1-${list.length} arası bir rakama basın${C.reset}`);
    console.log(` • Yeni yemek eklemek için:    ${C.green}+ veya e${C.reset}`);
    console.log(` • Bir yemeği silmek için:      ${C.red}-${C.reset}`);
    console.log(` • Bu öğünü temizlemek için:    ${C.yellow}t${C.reset} (Tüm ${title.toLowerCase()} boşaltılır)`);
    console.log(` • Ana menüye dönmek için:      ${C.bold}0, q veya Esc${C.reset}`);
    process.stdout.write(`\n${C.bold}İşlem seçin: ${C.reset}`);

    const keyObj = await term.getKey();
    const cmd = (keyObj.name || keyObj.str || '').toLowerCase();

    if (cmd === '0' || cmd === 'q' || cmd === 'escape' || cmd === 'return') {
      break;
    }

    // Öğünü tamamen temizleme (t)
    if (cmd === 't') {
      console.log('');
      const ans = await term.readLine(`${C.yellow}Bu öğünün (${title}) tüm yemeklerini temizlemek istiyor musunuz? (E/H): ${C.reset}`);
      if (ans.toLowerCase() === 'e') {
        current[mealType] = [];
        hasUnsavedChanges = true;
        process.stdout.write(`\n${C.green}✓ ${title} listesi temizlendi.${C.reset} Devam için bir tuşa basın...`);
        await term.getKey();
      }
      continue;
    }

    // Yeni yemek ekleme
    if (cmd === '+' || cmd === 'e') {
      console.log('');
      const newFood = await term.readLineWithAutocomplete(`${C.green}Yeni Yemek Adı:${C.reset}`);
      if (newFood) {
        if (!current[mealType]) current[mealType] = [];
        current[mealType].push(newFood);
        addToDictionary(newFood);
        hasUnsavedChanges = true;
      }
      continue;
    }

    // Silme (-)
    if (cmd === '-') {
      console.log('');
      const delStr = await term.readLine(`${C.red}Silinecek yemek numarası (1-${list.length}): ${C.reset}`);
      const delIdx = parseInt(delStr, 10) - 1;
      if (!isNaN(delIdx) && delIdx >= 0 && delIdx < list.length) {
        const removed = list.splice(delIdx, 1);
        hasUnsavedChanges = true;
        process.stdout.write(`\n${C.red}✓ "${removed[0]}" silindi.${C.reset} Bir tuşa basın...`);
        await term.getKey();
      }
      continue;
    }

    // Numaraya basarak düzenleme (1-9)
    const num = parseInt(cmd, 10);
    if (!isNaN(num) && num >= 1 && num <= list.length) {
      const editIdx = num - 1;
      const oldItem = list[editIdx];
      console.log('');
      const updatedFood = await term.readLineWithAutocomplete(
        `${C.cyan}[${editIdx + 1}] Yemeği Düzenle:${C.reset}`,
        oldItem
      );
      if (updatedFood !== null && updatedFood !== oldItem) {
        list[editIdx] = updatedFood;
        addToDictionary(updatedFood);
        hasUnsavedChanges = true;
      }
      continue;
    }
  }
}

async function handleAddNewDay() {
  renderHeader();
  console.log(`\n${C.bold}➕ YENİ GÜN EKLEME${C.reset}`);
  console.log(`${C.gray}────────────────────────────────────────────────────────────────────────────────────────${C.reset}`);

  let defaultDate = formatDate(new Date());
  if (menuData.length > 0) {
    const lastDay = menuData[menuData.length - 1];
    defaultDate = addDays(lastDay.tarih, 1);
  }

  const dateInput = await term.readLine(`${C.bold}Tarih [Varsayılan: ${C.cyan}${defaultDate}${C.reset}${C.bold}]: ${C.reset}`);
  let finalDate = dateInput.trim() || defaultDate;

  if (/^\d{1,2}\.\d{1,2}$/.test(finalDate)) {
    finalDate = `${finalDate}.${new Date().getFullYear()}`;
  }

  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(finalDate)) {
    process.stdout.write(`\n${C.red}Hatalı tarih formatı! Lütfen DD.MM.YYYY şeklinde girin. Bir tuşa basın...${C.reset}`);
    await term.getKey();
    return;
  }

  const existingIdx = menuData.findIndex(d => d.tarih === finalDate);
  if (existingIdx !== -1) {
    const ans = await term.readLine(`\n${C.yellow}"${finalDate}" zaten mevcut! O güne gidilsin mi? (E/H): ${C.reset}`);
    if (ans.toLowerCase() === 'e') {
      currentIndex = existingIdx;
    }
    return;
  }

  const computedDayName = getDayName(finalDate);
  console.log(`Gün: ${C.magenta}${C.bold}${computedDayName}${C.reset}\n`);

  console.log(`Menü Başlatma Şekli:`);
  console.log(` [1] Boş menü oluştur`);
  console.log(` [2] 7 Gün Önceki Menüden Kopyala (Haftalık döngü)`);
  console.log(` [3] Başka bir günden kopyala`);
  process.stdout.write(`${C.bold}Seçiminiz (1-3) [Varsayılan: 2]: ${C.reset}`);

  const initKey = await term.getKey();
  const initChoice = initKey.name || initKey.str || '2';

  let initialKahvalti = [];
  let initialAksam = [];

  if (initChoice === '2' || initChoice === 'return') {
    const prevWeek = addDays(finalDate, -7);
    const source = menuData.find(d => d.tarih === prevWeek);
    if (source) {
      initialKahvalti = [...(source.kahvalti || [])];
      initialAksam = [...(source.aksam_yemegi || [])];
      console.log(`\n${C.green}✓ ${prevWeek} tarihli menü kopyalandı!${C.reset}`);
    } else {
      console.log(`\n${C.yellow}⚠️ 7 gün öncesine ait kayıt bulunamadı, boş menü oluşturuldu.${C.reset}`);
    }
  } else if (initChoice === '3') {
    console.log('');
    const srcDate = await term.readLine(`Hangi tarihin menüsü kopyalansın? (Örn: 24.09.2026): `);
    const source = menuData.find(d => d.tarih === srcDate.trim());
    if (source) {
      initialKahvalti = [...(source.kahvalti || [])];
      initialAksam = [...(source.aksam_yemegi || [])];
      console.log(`${C.green}✓ ${srcDate} tarihli menü kopyalandı!${C.reset}`);
    }
  }

  const newEntry = {
    tarih: finalDate,
    gun: computedDayName,
    kahvalti: initialKahvalti,
    kahvalti_kaynak: '[cite: 2]',
    aksam_yemegi: initialAksam,
    aksam_yemegi_kaynak: '[cite: 1]'
  };

  menuData.push(newEntry);
  menuData.sort((a, b) => parseDateStr(a.tarih).getTime() - parseDateStr(b.tarih).getTime());
  currentIndex = menuData.findIndex(d => d.tarih === finalDate);
  hasUnsavedChanges = true;

  process.stdout.write(`\n${C.green}✅ ${finalDate} (${computedDayName}) eklendi! Devam için bir tuşa basın...${C.reset}`);
  await term.getKey();
}

/**
 * Günü tamamen temizleme: Kahvaltı ve akşam menüsünü boşaltır, tarihi korur (kayma olmaz).
 */
async function handleClearCurrentDay() {
  if (menuData.length === 0) return;
  const current = menuData[currentIndex];

  console.log('');
  const ans = await term.readLine(
    `${C.yellow}${C.bold}⚠️  ${current.tarih} (${current.gun}) gününün menüsünü tamamen temizlemek (boşaltmak) istiyor musunuz? (E/H): ${C.reset}`
  );

  if (ans.toLowerCase() === 'e') {
    current.kahvalti = [];
    current.aksam_yemegi = [];
    hasUnsavedChanges = true;
    process.stdout.write(`\n${C.green}✅ ${current.tarih} (${current.gun}) menüsü tamamen temizlendi! (Tarih ve sıralama korundu, kayma olmaz)${C.reset}\nDevam için bir tuşa basın...`);
    await term.getKey();
  }
}

/**
 * Gün silme işlemi: Kullanıcıya sadece menüyü temizleme mi yoksa tarihi listeden tamamen silme mi seçeneği sunar.
 */
async function handleDeleteCurrentDay() {
  if (menuData.length === 0) return;
  const current = menuData[currentIndex];

  renderHeader();
  console.log(`\n${C.bold}--- GÜN İŞLEMİ: ${C.cyan}${current.tarih} (${current.gun})${C.reset}${C.bold} ---${C.reset}\n`);
  console.log(` ${C.green}[1] Menüyü Temizle${C.reset}  ➔ Kahvaltı ve akşamı boşaltır (Tarih ve gün sırası KORUNUR, kayma olmaz)`);
  console.log(` ${C.red}[2] Tarihi Sil${C.reset}      ➔ Bu günü takvimden tamamen kaldırır (Tüm gün kaydı silinir)`);
  console.log(` [0] İptal`);
  process.stdout.write(`\n${C.bold}Seçiminiz (1/2/0): ${C.reset}`);

  const keyObj = await term.getKey();
  const choice = keyObj.name || keyObj.str;

  if (choice === '1') {
    current.kahvalti = [];
    current.aksam_yemegi = [];
    hasUnsavedChanges = true;
    process.stdout.write(`\n\n${C.green}✅ ${current.tarih} (${current.gun}) menüsü temizlendi. Tarih yerinde kaldı, kayma olmadı.${C.reset}\nDevam için bir tuşa basın...`);
    await term.getKey();
  } else if (choice === '2') {
    console.log('');
    const ans = await term.readLine(
      `\n${C.bgRed}${C.white}${C.bold} DİKKAT: "${current.tarih}" tarihi listeden tamamen çıkarılacak! Onaylıyor musunuz? (E/H): ${C.reset} `
    );
    if (ans.toLowerCase() === 'e') {
      menuData.splice(currentIndex, 1);
      if (currentIndex >= menuData.length) currentIndex = Math.max(0, menuData.length - 1);
      hasUnsavedChanges = true;
      process.stdout.write(`\n${C.green}✓ ${current.tarih} tarihi listeden silindi.${C.reset}\nDevam için bir tuşa basın...`);
      await term.getKey();
    }
  }
}

async function handleJumpToDate() {
  console.log('');
  const query = await term.readLine(`${C.bold}Gidilecek Tarih / Gün (Örn: 25, 25.09, 01.10.2026, bugün, yarın): ${C.reset}`);
  const q = normalizeTr(query.trim());
  if (!q) return;

  if (q === 'bugun' || q === 'b') {
    const today = formatDate(new Date());
    const idx = menuData.findIndex(d => d.tarih === today);
    if (idx !== -1) currentIndex = idx;
    return;
  }

  if (q === 'yarin' || q === 'y') {
    const tomorrow = addDays(formatDate(new Date()), 1);
    const idx = menuData.findIndex(d => d.tarih === tomorrow);
    if (idx !== -1) currentIndex = idx;
    return;
  }

  if (/^\d{1,2}$/.test(q)) {
    const padDay = q.padStart(2, '0');
    const idx = menuData.findIndex(d => d.tarih.startsWith(`${padDay}.`));
    if (idx !== -1) currentIndex = idx;
    return;
  }

  if (/^\d{1,2}\.\d{1,2}$/.test(q)) {
    const [d, m] = q.split('.');
    const pattern = `${d.padStart(2, '0')}.${m.padStart(2, '0')}.`;
    const idx = menuData.findIndex(d => d.tarih.startsWith(pattern));
    if (idx !== -1) currentIndex = idx;
    return;
  }

  const fullIdx = menuData.findIndex(d => d.tarih === query.trim());
  if (fullIdx !== -1) {
    currentIndex = fullIdx;
    return;
  }

  const dayIdx = menuData.findIndex(d => normalizeTr(d.gun) === q);
  if (dayIdx !== -1) {
    currentIndex = dayIdx;
    return;
  }

  process.stdout.write(`\n${C.yellow}"${query}" aramasına uygun gün bulunamadı. Devam için bir tuşa basın...${C.reset}`);
  await term.getKey();
}

async function handleSearchDish() {
  console.log('');
  const searchTerm = await term.readLineWithAutocomplete(`${C.bold}Aranacak Yemek Adı:${C.reset}`);
  if (!searchTerm) return;

  const nSearch = normalizeTr(searchTerm);
  const matches = [];

  menuData.forEach((day, dIdx) => {
    (day.kahvalti || []).forEach(item => {
      if (normalizeTr(item).includes(nSearch)) {
        matches.push({ day, type: 'Kahvaltı', item, dIdx });
      }
    });
    (day.aksam_yemegi || []).forEach(item => {
      if (normalizeTr(item).includes(nSearch)) {
        matches.push({ day, type: 'Akşam', item, dIdx });
      }
    });
  });

  renderHeader();
  console.log(`\n${C.bold}🔍 "${searchTerm}" İçeren Günler (${matches.length} Sonuç):${C.reset}\n`);

  if (matches.length === 0) {
    console.log(`  ${C.gray}Hiçbir günde bulunamadı.${C.reset}`);
    process.stdout.write(`\n${C.cyan}Devam için bir tuşa basın...${C.reset}`);
    await term.getKey();
  } else {
    matches.forEach((m, idx) => {
      const typeColor = m.type === 'Kahvaltı' ? C.yellow : C.blue;
      console.log(`  ${C.cyan}[${idx + 1}]${C.reset} ${m.day.tarih} (${m.day.gun}) ➔ ${typeColor}[${m.type}]${C.reset} ${m.item}`);
    });
    const sel = await term.readLine(`\n${C.bold}Gidilecek gün numarası (veya Enter): ${C.reset}`);
    const selIdx = parseInt(sel, 10) - 1;
    if (!isNaN(selIdx) && selIdx >= 0 && selIdx < matches.length) {
      currentIndex = matches[selIdx].dIdx;
    }
  }
}

// ============================================================================
// ANA DÖNGÜ (MAIN)
// ============================================================================

async function main() {
  loadData();

  while (true) {
    renderDayView();

    const keyObj = await term.getKey();
    const key = (keyObj.name || keyObj.str || '').toLowerCase();

    // 1. Navigasyon
    if (key === 'right' || key === 'n' || key === 'return' || key === 'enter') {
      if (currentIndex < menuData.length - 1) currentIndex++;
      else currentIndex = 0;
    } else if (key === 'left' || key === 'p') {
      if (currentIndex > 0) currentIndex--;
      else currentIndex = menuData.length - 1;
    } else if (key === 'b') {
      const today = formatDate(new Date());
      const idx = menuData.findIndex(d => d.tarih === today);
      if (idx !== -1) currentIndex = idx;
    } else if (key === 'g') {
      await handleJumpToDate();
    }
    // 2. Düzenleme
    else if (key === '1' || key === 'k') {
      await handleEditMeal('kahvalti');
    } else if (key === '2' || key === 'a') {
      await handleEditMeal('aksam_yemegi');
    } else if (key === '+' || key === 'y') {
      await handleAddNewDay();
    } else if (key === 't' || key === 'temizle') {
      await handleClearCurrentDay();
    } else if (key === '-' || key === 'd') {
      await handleDeleteCurrentDay();
    }
    // 3. Karşılaştırma & Arama
    else if (key === 'c') {
      await handleCompareMenu();
    } else if (key === 'a' || key === '/') {
      await handleSearchDish();
    }
    // 4. Kaydetme
    else if (key === 's' || key === 'w') {
      const res = saveData();
      if (res.success) {
        process.stdout.write(`\n\n${C.green}✅ data.json dosyasına başarıyla kaydedildi!\n📦 Yedek alındı: ${res.backupFile}${C.reset}\nDevam etmek için bir tuşa basın...`);
      } else {
        process.stdout.write(`\n\n${C.red}❌ Kaydetme hatası: ${res.error}${C.reset}\nDevam etmek için bir tuşa basın...`);
      }
      await term.getKey();
    }
    // 5. Çıkış
    else if (key === 'q' || key === 'escape') {
      if (hasUnsavedChanges) {
        const confirm = await term.readLine(
          `\n${C.yellow}⚠️ Kaydedilmemiş değişiklikler var! Kaydedilsin mi? (E/H/İptal): ${C.reset}`
        );
        const c = confirm.toLowerCase();
        if (c === 'e') {
          saveData();
          console.log(`${C.green}Kaydedildi ve çıkıldı.${C.reset}\n`);
          process.exit(0);
        } else if (c === 'h') {
          console.log(`${C.gray}Kaydedilmeden çıkıldı.${C.reset}\n`);
          process.exit(0);
        }
      } else {
        console.log(`\n${C.green}İyi günler!${C.reset}\n`);
        process.exit(0);
      }
    }
  }
}

// Doğrudan başlat
main().catch(err => {
  console.error(`\n${C.red}Beklenmeyen hata: ${err.message}${C.reset}`);
  process.exit(1);
});
