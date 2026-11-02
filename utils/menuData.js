import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = fs.existsSync(path.resolve(__dirname, '../data/data.json'))
  ? path.resolve(__dirname, '../data/data.json')
  : path.resolve(__dirname, '../data.json');

/**
 * Türkçe karakterleri ASCII küçük harfe dönüştürür.
 */
export function normalizeTr(str) {
  if (!str) return '';
  return str.toString().toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();
}

/**
 * Türkiye saat dilimine (Europe/Istanbul UTC+3) göre gün kaydırmalı tarih stringi döner (DD.MM.YYYY).
 */
export function getOffsetDate(offsetDays = 0) {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istanbulTime = new Date(utc + (3600000 * 3));
  istanbulTime.setDate(istanbulTime.getDate() + offsetDays);

  const day = String(istanbulTime.getDate()).padStart(2, '0');
  const month = String(istanbulTime.getMonth() + 1).padStart(2, '0');
  const year = istanbulTime.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * DD.MM.YYYY formatındaki stringi Date objesine çevirir.
 */
function parseDateStr(str) {
  if (!str) return new Date();
  const [d, m, y] = str.split('.').map(Number);
  return new Date(y, m - 1, d);
}

let cachedMenuData = null;
let lastMenuMtime = 0;

/**
 * data.json dosyasını okur ve JSON objesi olarak döner.
 */
export function loadMenuData() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      console.error('[MenuData] data.json bulunamadı:', DATA_PATH);
      return [];
    }
    const stat = fs.statSync(DATA_PATH);
    if (cachedMenuData && stat.mtimeMs === lastMenuMtime) {
      return cachedMenuData;
    }
    const raw = fs.readFileSync(DATA_PATH, 'utf-8');
    cachedMenuData = JSON.parse(raw);
    lastMenuMtime = stat.mtimeMs;
    return cachedMenuData;
  } catch (err) {
    console.error('[MenuData] data.json okuma hatası:', err.message);
    return [];
  }
}

/**
 * Yemek adına göre uygun emojiyi belirler.
 */
export function getItemEmoji(item, type = 'aksam') {
  const t = normalizeTr(item);

  if (t.includes('corba')) return '🥣';
  if (t.includes('kek') || t.includes('browni') || t.includes('tatli') || t.includes('helva') || t.includes('cikolata') || t.includes('sekerpare') || t.includes('puding') || t.includes('baklava') || t.includes('pankek') || t.includes('supangle') || t.includes('sutlac')) return '🍰';
  if (t.includes('recel') || t.includes('bal') || t.includes('tahin') || t.includes('pekmez')) return '🍯';
  if (t.includes('cay') || t.includes('kahve')) return '☕';
  if (t.includes('su ') || t.endsWith(' su') || t.includes('500 ml su')) return '💧';
  if (t.includes('ayran') || t.includes('sut') || t.includes('meyve suyu') || t.includes(' kola') || t.startsWith('kola') || t.includes('icecek') || t.includes('gazoz') || t.includes('salgam')) return '🥤';
  if (t.includes('patates') || t.includes('kizartma')) return '🥔';
  if (t.includes('makarna') || t.includes('eriste')) return '🍝';
  if (t.includes('pilav') || t.includes('pirinc') || t.includes('bulgur')) return '🍚';
  if (t.includes('tavuk')) return '🍗';
  if (t.includes('kofte') || t.includes('kebab') || t.includes('et ') || t.includes('etli') || t.includes('kavurma') || t.includes('doner') || t.includes('biftek')) return '🥩';
  if (t.includes('manti') || t.includes('nohut') || t.includes('fasulye') || t.includes('bezelye') || t.includes('dolma') || t.includes('turlu') || t.includes('karniyarik')) return '🍲';
  if (t.includes('simit') || t.includes('pogaca') || t.includes('acma') || t.includes('borek') || t.includes('pisi') || t.includes('katmer')) return '🥐';
  if (t.includes('pizza')) return '🍕';
  if (t.includes('ekmek')) return '🥖';
  if (t.includes('omlet') || t.includes('yumurta') || t.includes('menemen')) return '🍳';
  if (t.includes('sosis') || t.includes('sucuk') || t.includes('salam')) return '🌭';
  if (t.includes('peynir') || t.includes('kasar') || t.includes('labne') || t.includes('lor')) return '🧀';
  if (t.includes('zeytin')) return '🫒';
  if (t.includes('salata') || t.includes('cacik') || t.includes('ezme')) return '🥗';
  if (t.includes('yogurt')) return '🥣';
  if (t.includes('elma') || t.includes('portakal') || t.includes('mandalina') || t.includes('meyve') || t.includes('karpuz') || t.includes('kavun') || t.includes('uzum') || t.includes('seftali') || t.includes('armut')) return '🍎';

  return type === 'kahvalti' ? '🥪' : '🍽️';
}

export function findMenuByQuery(query = '', data = []) {
  if (!data || data.length === 0) return null;

  const rawQuery = (query || '').trim();
  const nQuery = normalizeTr(rawQuery);

  const todayStr = getOffsetDate(0);
  const tomorrowStr = getOffsetDate(1);
  const yesterdayStr = getOffsetDate(-1);

  if (!nQuery || nQuery === 'bugun') {
    const found = data.find(d => d.tarih === todayStr);
    return { entry: found, label: 'Bugün', isDefault: true };
  }
  if (nQuery === 'yarin') {
    const found = data.find(d => d.tarih === tomorrowStr);
    return { entry: found, label: 'Yarın' };
  }
  if (nQuery === 'dun') {
    const found = data.find(d => d.tarih === yesterdayStr);
    return { entry: found, label: 'Dün' };
  }
  const days = ['pazar', 'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi'];
  const matchedDay = days.find(d => d === nQuery);
  if (matchedDay) {
    const todayDate = parseDateStr(todayStr);
    const matches = data.filter(d => normalizeTr(d.gun) === matchedDay);
    if (matches.length > 0) {
      const upcoming = matches.find(d => parseDateStr(d.tarih) >= todayDate);
      const chosen = upcoming || matches[0];
      return { entry: chosen, label: chosen.gun };
    }
  }
  if (/^\d{1,2}$/.test(rawQuery)) {
    const dayPad = rawQuery.padStart(2, '0');
    const found = data.find(d => d.tarih.startsWith(`${dayPad}.`));
    return { entry: found, label: `${rawQuery}. gün` };
  }
  if (/^\d{1,2}\.\d{1,2}$/.test(rawQuery)) {
    const [d, m] = rawQuery.split('.');
    const pattern = `${d.padStart(2, '0')}.${m.padStart(2, '0')}.`;
    const found = data.find(d => d.tarih.startsWith(pattern));
    return { entry: found, label: rawQuery };
  }
  const fullFound = data.find(d => d.tarih === rawQuery || normalizeTr(d.tarih) === nQuery);
  if (fullFound) {
    return { entry: fullFound, label: fullFound.tarih };
  }

  return null;
}

function getNotFoundMessage(query, data, cmdName) {
  let rangeInfo = '';
  if (data && data.length > 0) {
    rangeInfo = `\n📅 *Mevcut Tarih Aralığı:* ${data[0].tarih} — ${data[data.length - 1].tarih}`;
  }

  return (
    `❌ *Menü Bulunamadı!*\n` +
    (query ? `"${query}" araması için bir menü kaydı bulunamadı.\n` : '') +
    rangeInfo +
    `\n\n💡 *Örnek Kullanımlar:*\n` +
    `• \`!${cmdName}\` ➔ Bugünün menüsü\n` +
    `• \`!${cmdName} yarin\` ➔ Yarının menüsü\n` +
    `• \`!${cmdName} pazartesi\` ➔ En yakın Pazartesi menüsü\n` +
    `• \`!${cmdName} 25\` ➔ Ayın 25'i menüsü\n` +
    `• \`!${cmdName} 28.09\` ➔ 28 Eylül menüsü`
  );
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const DIVIDERS = [
  '━━━━━━━━━━━━━━━━━━━━',
  '────────────────────',
  '····································',
  '════════════════════',
  '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈',
  '✦ ──────────────── ✦'
];

const BULLET_FORMATS = [
  (emoji, item) => `${emoji} ${item}`,
  (emoji, item) => `• ${emoji} ${item}`,
  (emoji, item) => `▹ ${emoji} ${item}`,
  (emoji, item) => `${emoji} *${item}*`,
  (emoji, item) => `▫️ ${emoji} ${item}`
];

const AKSAM_HEADERS = [
  '🍲 *AKŞAM YEMEĞİ MENÜSÜ* 🍽️',
  '🍽️ *Günün Akşam Menüsü* ✨',
  '🥘 *KYK Akşam Yemeği Menüsü*',
  '🍴 *Akşam Yemeği Listesi*',
  '🥣 *KYK Akşam Menüsü* 🥖',
  '✨ *Akşam Yemeğinde Ne Var?* 🍲',
  '🍽️ *Akşam Menüsü | KYK*'
];

const KAHVALTI_HEADERS = [
  '🍳 *KAHVALTI MENÜSÜ* 🥐',
  '🥐 *Günün Sabah Kahvaltısı* ☕',
  '🥪 *KYK Kahvaltı Menüsü*',
  '☕ *Sabah Kahvaltısı Listesi*',
  '🍳 *Kahvaltıda Ne Var?* 🥐',
  '✨ *KYK Sabah Menüsü* 🥪',
  '🥖 *Sabah Kahvaltısı | KYK*'
];

const YEMEK_HEADERS = [
  '📋 *GÜNLÜK YEMEK MENÜSÜ* 🍽️',
  '🍛 *KYK Günlük Yemek Listesi*',
  '🍽️ *Bugünün Menüsü (Kahvaltı & Akşam)*',
  '✨ *Günün Tam Yemek Menüsü* 🥘',
  '📋 *KYK Yemek Listesi*',
  '🥘 *Bugün Ne Yiyoruz?*',
  '🍽️ *Günlük Tabldot Menüsü*',
  '🍲 *KYK Yemek Menüsü Geldi!*'
];

const AKSAM_FOOTERS = [
  '💡 _Yarın için:_ `!aksam yarin`  |  _Kahvaltı:_ `!kahvalti`',
  '✨ _Afiyet olsun!_ 💡 _Yarınki menü:_ `!aksam yarin`',
  '🍴 _Afiyet olsun, iyi akşamlar!_',
  '😋 _Afiyet olsun!_ 📌 _Yarın için:_ `!aksam yarin`',
  '💡 _Kahvaltı menüsü için:_ `!kahvalti`  |  _Tam menü:_ `!yemek`'
];

const KAHVALTI_FOOTERS = [
  '💡 _Yarın için:_ `!kahvalti yarin`  |  _Akşam:_ `!aksam`',
  '✨ _Afiyet olsun, hayırlı sabahlar!_',
  '☕ _Afiyet olsun!_ 💡 _Akşam için:_ `!aksam`',
  '😋 _Afiyet olsun!_ 📌 _Yarınki kahvaltı:_ `!kahvalti yarin`'
];

const YEMEK_FOOTERS = [
  '💡 _Yarın için:_ `!yemek yarin`  |  _Sadece akşam:_ `!aksam`',
  '✨ _Afiyet olsun!_',
  '📌 _Yarınki menü için:_ `!yemek yarin`',
  '🍽️ _Afiyet olsun, iyi günler!_',
  '😋 _Şimdiden afiyet olsun beyler!_',
  '🍴 _Yemekler hazır, afiyet olsun!_',
  '✨ _Günün menüsü bu kadardı, afiyetle!'
];

const HUMAN_INTROS = [
  'Beyler menü geldi: ',
  'Bugün yemekler şöyle: ',
  'İşte bugünün menüsü: ',
  'Menüye bakalım: ',
  'Güncel menü burada: ',
  '', // Bazen giriş olmasın
];

const HUMAN_OUTROS = [
  '\n\nAfiyet olsun herkese! 😋',
  '\n\nŞimdiden afiyetle yiyin! 🥘',
  '\n\nMenü bu, afiyet olsun! ✨',
  '', // Bazen çıkış olmasın
];

function formatDateHeader(tarih, gun, tag) {
  const formats = [
    `📅 *Tarih:* ${tarih} — *${gun}*${tag}`,
    `🗓️ *${tarih}* | *${gun}*${tag}`,
    `📆 *${gun}* (${tarih})${tag}`,
    `📅 *${tarih}* — ${gun}${tag}`
  ];
  return pickRandom(formats);
}

/* İl Müdürlüğü notu: bazı yurt gruplarına belirli tarihlerde özel akşam menüsü verilir.
   Menü listesi DEĞİŞMEZ; yalnızca ilgili yurdun ilgili günlerinde kısa bir not gösterilir. */
export const kykOzelAralik = {
  "ahmet-kabakli": ["2026-11-08", "2026-11-20"],
  "sare-ana": ["2026-11-02", "2026-11-17"],
  "harput": ["2026-11-02", "2026-11-17"],
  "izzetpasa": ["2026-11-02", "2026-11-17"],
  "omer-bilginoglu": ["2026-11-11", "2026-11-27"],
  "fethi-sekin": ["2026-11-11", "2026-11-27"],
  "firat": ["2026-11-11", "2026-11-27"]
};

export const kykOzelNot = (bas, bit) => {
  const g = t => t.slice(8, 10) + "." + t.slice(5, 7);
  return `📢 *Özel Menü Notu:*\n${g(bas)}–${g(bit)} tarihleri arasında ilgili yurtlarda (Mercimek çorba, Lahmacun, Mevsim Salata, Ayran) menüsü verilecektir.`;
};

export const KAHVALTI_GENEL_NOTU = "ℹ️ _Al götür kahvaltı her gün 10.30'a kadar verilir._";

function getOzelYurtNotu(tarihStr, query = '') {
  if (!tarihStr) return '';
  // DD.MM.YYYY -> YYYY-MM-DD
  const parts = tarihStr.split('.');
  if (parts.length !== 3) return '';
  const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`;

  const cleanQuery = normalizeTr(query);
  for (const [yurtKey, [bas, bit]] of Object.entries(kykOzelAralik)) {
    if (isoDate >= bas && isoDate <= bit) {
      if (cleanQuery && (cleanQuery.includes(normalizeTr(yurtKey)) || normalizeTr(yurtKey).includes(cleanQuery))) {
        return `\n\n${kykOzelNot(bas, bit)}`;
      }
    }
  }
  return '';
}

export function getKahvaltiMessage(query = '') {
  const data = loadMenuData();
  if (!data || data.length === 0) return '❌ *Hata:* Menü verisi bulunamadı.';
  const result = findMenuByQuery(query, data);
  if (!result || !result.entry) return getNotFoundMessage(query, data, 'kahvalti');
  const entry = result.entry;
  const items = entry.kahvalti || [];
  if (items.length === 0) return `ℹ️ *${entry.tarih} (${entry.gun})* tarihi için kahvaltı menüsü bulunmuyor.`;
  const bulletFn = pickRandom(BULLET_FORMATS);
  const formattedItems = items.map(item => bulletFn(getItemEmoji(item, 'kahvalti'), item)).join('\n');
  const tag = result.label && result.label !== entry.gun ? ` _(${result.label})_` : '';
  const header = pickRandom(KAHVALTI_HEADERS);
  const divider = pickRandom(DIVIDERS);
  const footer = pickRandom(KAHVALTI_FOOTERS);
  const dateLine = formatDateHeader(entry.tarih, entry.gun, tag);
  const kahvaltiNotu = entry.kahvalti_notu ? `\n\nℹ️ _${entry.kahvalti_notu}_` : `\n\n${KAHVALTI_GENEL_NOTU}`;

  return `${header}\n${dateLine}\n${divider}\n${formattedItems}${kahvaltiNotu}\n${divider}\n${footer}`;
}

export function getAksamMessage(query = '') {
  const data = loadMenuData();
  if (!data || data.length === 0) return '❌ *Hata:* Menü verisi bulunamadı.';
  const result = findMenuByQuery(query, data);
  if (!result || !result.entry) return getNotFoundMessage(query, data, 'aksam');
  const entry = result.entry;
  const items = entry.aksam_yemegi || entry.aksam || [];
  if (items.length === 0) return `ℹ️ *${entry.tarih} (${entry.gun})* tarihi için akşam yemeği menüsü bulunmuyor.`;
  const bulletFn = pickRandom(BULLET_FORMATS);
  const formattedItems = items.map(item => bulletFn(getItemEmoji(item, 'aksam'), item)).join('\n');
  const tag = result.label && result.label !== entry.gun ? ` _(${result.label})_` : '';
  const header = pickRandom(AKSAM_HEADERS);
  const divider = pickRandom(DIVIDERS);
  const footer = pickRandom(AKSAM_FOOTERS);
  const dateLine = formatDateHeader(entry.tarih, entry.gun, tag);
  const ozelNot = getOzelYurtNotu(entry.tarih, query);

  return `${header}\n${dateLine}\n${divider}\n${formattedItems}${ozelNot}\n${divider}\n${footer}`;
}

export function getYemekMessage(query = '') {
  const data = loadMenuData();
  if (!data || data.length === 0) return '❌ *Hata:* Menü verisi bulunamadı.';
  const result = findMenuByQuery(query, data);
  if (!result || !result.entry) return getNotFoundMessage(query, data, 'yemek');
  const entry = result.entry;
  const bulletFn = pickRandom(BULLET_FORMATS);
  const kahvaltiItems = (entry.kahvalti || []).map(item => bulletFn(getItemEmoji(item, 'kahvalti'), item)).join('\n');
  const aksamItems = (entry.aksam_yemegi || entry.aksam || []).map(item => bulletFn(getItemEmoji(item, 'aksam'), item)).join('\n');
  const tag = result.label && result.label !== entry.gun ? ` _(${result.label})_` : '';
  const header = pickRandom(YEMEK_HEADERS);
  const divider = pickRandom(DIVIDERS);
  const footer = pickRandom(YEMEK_FOOTERS);
  const dateLine = formatDateHeader(entry.tarih, entry.gun, tag);
  const intro = pickRandom(HUMAN_INTROS);
  const outro = pickRandom(HUMAN_OUTROS);
  const kahvaltiNotu = entry.kahvalti_notu ? `\n_${entry.kahvalti_notu}_\n` : `\n_${KAHVALTI_GENEL_NOTU}_\n`;
  const ozelNot = getOzelYurtNotu(entry.tarih, query);

  let text = `${intro}${header}\n${dateLine}\n${divider}\n`;
  text += `🍳 *KAHVALTI:*\n${kahvaltiItems || '— Menü belirtilmemiş —'}\n${kahvaltiNotu}\n`;
  text += `🍲 *AKŞAM YEMEĞİ:*\n${aksamItems || '— Menü belirtilmemiş —'}${ozelNot}\n`;
  text += `${divider}\n${footer}${outro}`;

  return text;
}

export async function sendMenuResponse(sock, msg, from, replyPayload) {
  const payload = typeof replyPayload === 'string' ? { text: replyPayload } : replyPayload;
  await sock.sendMessage(from, payload, { quoted: msg });
}
