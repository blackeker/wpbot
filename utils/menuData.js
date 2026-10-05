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

  // Çorbalar
  if (t.includes('corba')) return '🥣';

  // Tatlılar (çikolatayı koladan önce kontrol et)
  if (t.includes('kek') || t.includes('browni') || t.includes('tatli') || t.includes('helva') || t.includes('cikolata') || t.includes('sekerpare') || t.includes('puding') || t.includes('baklava') || t.includes('pankek') || t.includes('supangle') || t.includes('sutlac')) return '🍰';
  if (t.includes('recel') || t.includes('bal') || t.includes('tahin') || t.includes('pekmez')) return '🍯';

  // İçecekler (meyve suyunu meyveden önce kontrol et)
  if (t.includes('cay') || t.includes('kahve')) return '☕';
  if (t.includes('su ') || t.endsWith(' su') || t.includes('500 ml su')) return '💧';
  if (t.includes('ayran') || t.includes('sut') || t.includes('meyve suyu') || t.includes(' kola') || t.startsWith('kola') || t.includes('icecek') || t.includes('gazoz') || t.includes('salgam')) return '🥤';

  // Patates / Kızartmalar (Patates kavurması gibi yemekler için patatesi kavurmadan önce kontrol et)
  if (t.includes('patates') || t.includes('kizartma')) return '🥔';

  // Pilav / Makarna (Nohutlu pilav gibi yemekler için pilavı nohuttan önce kontrol et)
  if (t.includes('makarna') || t.includes('eriste')) return '🍝';
  if (t.includes('pilav') || t.includes('pirinc') || t.includes('bulgur')) return '🍚';

  // Ana Yemekler (Et / Tavuk / Köfte vb.)
  if (t.includes('tavuk')) return '🍗';
  if (t.includes('kofte') || t.includes('kebab') || t.includes('et ') || t.includes('etli') || t.includes('kavurma') || t.includes('doner') || t.includes('biftek')) return '🥩';
  if (t.includes('manti') || t.includes('nohut') || t.includes('fasulye') || t.includes('bezelye') || t.includes('dolma') || t.includes('turlu') || t.includes('karniyarik')) return '🍲';

  // Hamur işleri / Kahvaltılık Unlular
  if (t.includes('simit') || t.includes('pogaca') || t.includes('acma') || t.includes('borek') || t.includes('pisi') || t.includes('katmer')) return '🥐';
  if (t.includes('pizza')) return '🍕';
  if (t.includes('ekmek')) return '🥖';

  // Yumurtalar
  if (t.includes('omlet') || t.includes('yumurta') || t.includes('menemen')) return '🍳';

  // Şarküteri
  if (t.includes('sosis') || t.includes('sucuk') || t.includes('salam')) return '🌭';

  // Peynir / Zeytin
  if (t.includes('peynir') || t.includes('kasar') || t.includes('labne') || t.includes('lor')) return '🧀';
  if (t.includes('zeytin')) return '🫒';


  // Salata / Meze / Yoğurt
  if (t.includes('salata') || t.includes('cacik') || t.includes('ezme')) return '🥗';
  if (t.includes('yogurt')) return '🥣';

  // Meyveler
  if (t.includes('elma') || t.includes('portakal') || t.includes('mandalina') || t.includes('meyve') || t.includes('karpuz') || t.includes('kavun') || t.includes('uzum') || t.includes('seftali') || t.includes('armut')) return '🍎';

  return type === 'kahvalti' ? '🥪' : '🍽️';
}

/**
 * Kullanıcı girdisine göre uygun menü kaydını bulur.
 */
export function findMenuByQuery(query = '', data = []) {
  if (!data || data.length === 0) return null;

  const rawQuery = (query || '').trim();
  const nQuery = normalizeTr(rawQuery);

  const todayStr = getOffsetDate(0);
  const tomorrowStr = getOffsetDate(1);
  const yesterdayStr = getOffsetDate(-1);

  // 1. Parametre yok veya "bugün"
  if (!nQuery || nQuery === 'bugun') {
    const found = data.find(d => d.tarih === todayStr);
    return { entry: found, label: 'Bugün', isDefault: true };
  }

  // 2. "yarın"
  if (nQuery === 'yarin') {
    const found = data.find(d => d.tarih === tomorrowStr);
    return { entry: found, label: 'Yarın' };
  }

  // 3. "dün"
  if (nQuery === 'dun') {
    const found = data.find(d => d.tarih === yesterdayStr);
    return { entry: found, label: 'Dün' };
  }

  // 4. Gün adı eşleşmesi (pazartesi, salı, çarşamba, perşembe, cuma, cumartesi, pazar)
  const days = ['pazar', 'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi'];
  const matchedDay = days.find(d => d === nQuery);
  if (matchedDay) {
    const todayDate = parseDateStr(todayStr);
    const matches = data.filter(d => normalizeTr(d.gun) === matchedDay);
    if (matches.length > 0) {
      // Bugünden sonraki ilk günü (veya bugünü) tercih et
      const upcoming = matches.find(d => parseDateStr(d.tarih) >= todayDate);
      const chosen = upcoming || matches[0];
      return { entry: chosen, label: chosen.gun };
    }
  }

  // 5. Gün sayısı formatı: "25" -> 25. gün
  if (/^\d{1,2}$/.test(rawQuery)) {
    const dayPad = rawQuery.padStart(2, '0');
    const found = data.find(d => d.tarih.startsWith(`${dayPad}.`));
    return { entry: found, label: `${rawQuery}. gün` };
  }

  // 6. Gün ve Ay formatı: "25.09"
  if (/^\d{1,2}\.\d{1,2}$/.test(rawQuery)) {
    const [d, m] = rawQuery.split('.');
    const pattern = `${d.padStart(2, '0')}.${m.padStart(2, '0')}.`;
    const found = data.find(d => d.tarih.startsWith(pattern));
    return { entry: found, label: rawQuery };
  }

  // 7. Tam tarih: "25.09.2026"
  const fullFound = data.find(d => d.tarih === rawQuery || normalizeTr(d.tarih) === nQuery);
  if (fullFound) {
    return { entry: fullFound, label: fullFound.tarih };
  }

  return null;
}

/**
 * Menü bulunamadığında gösterilecek açıklayıcı mesaj.
 */
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
  '📋 *KYK Yemek Listesi*'
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
  '🍽️ _Afiyet olsun, iyi günler!_'
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

/**
 * Kahvaltı menüsü yanıt metnini dinamik ve değişken şablonla hazırlar.
 */
export function getKahvaltiMessage(query = '') {
  const data = loadMenuData();
  if (!data || data.length === 0) {
    return '❌ *Hata:* Menü verisi (data.json) bulunamadı veya boş.';
  }

  const result = findMenuByQuery(query, data);
  if (!result || !result.entry) {
    return getNotFoundMessage(query, data, 'kahvalti');
  }

  const entry = result.entry;
  const items = entry.kahvalti || [];

  if (items.length === 0) {
    return `ℹ️ *${entry.tarih} (${entry.gun})* tarihi için kahvaltı menüsü bulunmuyor.`;
  }

  const bulletFn = pickRandom(BULLET_FORMATS);
  const formattedItems = items.map(item => bulletFn(getItemEmoji(item, 'kahvalti'), item)).join('\n');
  const tag = result.label && result.label !== entry.gun ? ` _(${result.label})_` : '';
  const header = pickRandom(KAHVALTI_HEADERS);
  const divider = pickRandom(DIVIDERS);
  const footer = pickRandom(KAHVALTI_FOOTERS);
  const dateLine = formatDateHeader(entry.tarih, entry.gun, tag);

  return (
    `${header}\n` +
    `${dateLine}\n` +
    `${divider}\n` +
    `${formattedItems}\n` +
    `${divider}\n` +
    `${footer}`
  );
}

/**
 * Akşam yemeği menüsü yanıt metnini dinamik ve değişken şablonla hazırlar.
 */
export function getAksamMessage(query = '') {
  const data = loadMenuData();
  if (!data || data.length === 0) {
    return '❌ *Hata:* Menü verisi (data.json) bulunamadı veya boş.';
  }

  const result = findMenuByQuery(query, data);
  if (!result || !result.entry) {
    return getNotFoundMessage(query, data, 'aksam');
  }

  const entry = result.entry;
  const items = entry.aksam_yemegi || [];

  if (items.length === 0) {
    return `ℹ️ *${entry.tarih} (${entry.gun})* tarihi için akşam yemeği menüsü bulunmuyor.`;
  }

  const bulletFn = pickRandom(BULLET_FORMATS);
  const formattedItems = items.map(item => bulletFn(getItemEmoji(item, 'aksam'), item)).join('\n');
  const tag = result.label && result.label !== entry.gun ? ` _(${result.label})_` : '';
  const header = pickRandom(AKSAM_HEADERS);
  const divider = pickRandom(DIVIDERS);
  const footer = pickRandom(AKSAM_FOOTERS);
  const dateLine = formatDateHeader(entry.tarih, entry.gun, tag);

  return (
    `${header}\n` +
    `${dateLine}\n` +
    `${divider}\n` +
    `${formattedItems}\n` +
    `${divider}\n` +
    `${footer}`
  );
}

/**
 * Hem kahvaltı hem akşam yemeğini birlikte gösteren menü metni.
 */
export function getYemekMessage(query = '') {
  const data = loadMenuData();
  if (!data || data.length === 0) {
    return '❌ *Hata:* Menü verisi (data.json) bulunamadı veya boş.';
  }

  const result = findMenuByQuery(query, data);
  if (!result || !result.entry) {
    return getNotFoundMessage(query, data, 'yemek');
  }

  const entry = result.entry;
  const bulletFn = pickRandom(BULLET_FORMATS);
  const kahvaltiItems = (entry.kahvalti || []).map(item => bulletFn(getItemEmoji(item, 'kahvalti'), item)).join('\n');
  const aksamItems = (entry.aksam_yemegi || []).map(item => bulletFn(getItemEmoji(item, 'aksam'), item)).join('\n');
  const tag = result.label && result.label !== entry.gun ? ` _(${result.label})_` : '';

  const header = pickRandom(YEMEK_HEADERS);
  const divider = pickRandom(DIVIDERS);
  const footer = pickRandom(YEMEK_FOOTERS);
  const dateLine = formatDateHeader(entry.tarih, entry.gun, tag);

  let text = `${header}\n${dateLine}\n${divider}\n`;
  text += `🍳 *KAHVALTI:*\n${kahvaltiItems || '— Menü belirtilmemiş —'}\n\n`;
  text += `🍲 *AKŞAM YEMEĞİ:*\n${aksamItems || '— Menü belirtilmemiş —'}\n`;
  text += `${divider}\n`;
  text += `${footer}`;

  return text;
}

/**
 * Menü yanıtını komutun geldiği sohbete (Grup veya DM) gönderir.
 * Anti-ban ve insan simülasyonu için 'yazıyor...' durumu ve kısa rastgele gecikme ekler.
 */
export async function sendMenuResponse(sock, msg, from, replyPayload) {
  const payload = typeof replyPayload === 'string' ? { text: replyPayload } : replyPayload;
  await sock.sendMessage(from, payload, { quoted: msg });
}

