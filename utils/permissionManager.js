import { dataPath, readConfig, writeConfig } from '../config.js';
import fs from 'fs';
import path from 'path';

// All supported adult / NSFW domains for automatic group restriction
export const ADULT_DOMAINS = [
  'pornhub.com', 'doeda', 'hdabla', 'hdkore', 'turkifsahub', 'turkifsalar', 'turkporno',
  'rule34video', 'hanime.tv', 'jable.tv', 'missav', 'erome.com', 'fapello.com', 'camwhores',
  'hentaihaven', 'hentaimama', 'hentaiseason', 'spankbang', 'xvideos', 'xnxx', 'eporner',
  'xhamster', 'beeg', 'hqporner', 'youporn', 'redtube', 'tnaflix', 'thumbzilla', 'tube8',
  'txxx', 'youjizz', 'porntrex', 'pornone', 'motherless', 'daftsex', 'veporno', 'brazzers3x',
  'drtuber', 'heavy-r', 'xbabe', 'empflix', 'sxyprn', 'sunporno', 'fuq', 'javforme',
  'javhd', 'jav789', 'yerliifsa', 'sikis', 'pornovakti', 'turkcealtyaziliporno', 'pornoizle',
  'ifsadunyasi', 'guncelporno', 'yerliporno', 'hentaizm', 'ecchicix'
];

// Canonical Category Definitions
export const CATEGORIES = {
  indirme: {
    name: 'İndirme & Medya',
    icon: '📥',
    description: 'Video, ses, dizi, film, torrent ve kuyruk yönetimi',
    commands: ['indir', 'kuyruk', 'dur', 'devam', 'iptal', 'temizle', 'tekrargonder']
  },
  universite: {
    name: 'Üniversite & Yurt',
    icon: '🎓',
    description: 'Fırat Üniversitesi & KYK yemek, otobüs ve takvim',
    commands: ['uniyemek', 'kahvalti', 'aksam', 'yemek', 'takvim', 'hat22', 'adres']
  },
  gunluk: {
    name: 'Günlük Bilgi & Finans',
    icon: '🌤️',
    description: 'Hava durumu, döviz, altın, eczane, namaz, haber ve deprem',
    commands: ['hava', 'doviz', 'eczane', 'namaz', 'haber', 'deprem']
  },
  araclar: {
    name: 'Faydalı Araçlar',
    icon: '🧰',
    description: 'Hatırlatıcı, QR, link kısaltma, sözlük ve wiki',
    commands: ['hatirlat', 'qr', 'kisalt', 'sozluk', 'wiki']
  },
  ai: {
    name: 'Yapay Zeka & Sohbet',
    icon: '🤖',
    description: 'Yapay zeka ile doğal sohbet, soru-cevap ve görsel üretimi',
    commands: ['ai', 'ciz']
  },
  hentai: {
    name: 'Yetişkin & Hentai (18+)',
    icon: '🔞',
    description: 'Hentaizm ve yetişkin medya arama / indirme işlemleri',
    commands: ['hentaizmfav', 'indirhentai', 'topluhentai', 'hentaigrup', 'hhelp']
  },
  sistem: {
    name: 'Sistem & Durum',
    icon: '📊',
    description: 'Sunucu durumu, disk, ağ hızı, indirme geçmişi ve hata kayıtları',
    commands: ['durum', 'disk', 'hiz', 'gecmis', 'hatalar']
  },
  admin: {
    name: 'Yönetici Komutları',
    icon: '👑',
    description: 'Bot yönetimi, grup izinleri, çerez ve ayarlar',
    commands: ['izin', 'grupsec', 'cerez', 'depo', 'guncelle']
  },
  genel: {
    name: 'Genel & Yardım',
    icon: 'ℹ️',
    description: 'Yardım ve rehber komutları',
    commands: ['yardim']
  }
};

// Aliases mapping to canonical command names
export const ALIAS_MAP = {
  // Indirme
  'indir': 'indir', 'dl': 'indir', 'download': 'indir',
  'kuyruk': 'kuyruk', 'queue': 'kuyruk', 'q': 'kuyruk', 'sira': 'kuyruk',
  'dur': 'dur', 'durdur': 'dur', 'bekle': 'dur', 'pause': 'dur',
  'devam': 'devam', 'başlat': 'devam', 'resume': 'devam',
  'iptal': 'iptal', 'cancel': 'iptal', 'iptalet': 'iptal',
  'temizle': 'temizle', 'clear': 'temizle',
  'tekrargonder': 'tekrargonder', 'tekrar': 'tekrargonder', 'resend': 'tekrargonder',

  // Universite
  'uniyemek': 'uniyemek', 'uni yemek': 'uniyemek', 'üniversite yemek': 'uniyemek',
  'universite yemek': 'uniyemek', 'fırat yemek': 'uniyemek', 'firat yemek': 'uniyemek', 'yemekfirat': 'uniyemek',
  'kahvalti': 'kahvalti', 'kahvaltı': 'kahvalti', 'sabah': 'kahvalti', 'sabahyemegi': 'kahvalti', 'sabahyemeği': 'kahvalti',
  'aksam': 'aksam', 'akşam': 'aksam', 'aksamyemegi': 'aksam', 'akşamyemeği': 'aksam', 'aksam_yemegi': 'aksam',
  'yemek': 'yemek', 'yemekler': 'yemek', 'gunlukyemek': 'yemek', 'yemekhane': 'yemek',
  'takvim': 'takvim', 'akademik': 'takvim', 'akademiktakvim': 'takvim', 'akademik takvim': 'takvim',
  'vize': 'takvim', 'vizeler': 'takvim', 'vizesayac': 'takvim', 'vize sayacı': 'takvim',
  'final': 'takvim', 'finaller': 'takvim', 'finalsayac': 'takvim', 'final sayacı': 'takvim',
  'but': 'takvim', 'büt': 'takvim', 'bütünleme': 'takvim', 'butunleme': 'takvim', 'butsayac': 'takvim',
  'tatil': 'takvim', 'tatiller': 'takvim', 'resmitatil': 'takvim', 'resmi tatil': 'takvim',
  'sayac': 'takvim', 'sayaç': 'takvim', 'sinav': 'takvim', 'sınav': 'takvim',
  '22': 'hat22', 'hat22': 'hat22', 'otobus': 'hat22', 'otobüs': 'hat22', 'otobussaatleri': 'hat22', 'otobüs saatleri': 'hat22', '22 saatleri': 'hat22',
  'adres': 'adres', 'yurt': 'adres', 'yurtadresi': 'adres', 'adresim': 'adres',

  // Gunluk
  'hava': 'hava', 'havadurumu': 'hava', 'weather': 'hava',
  'doviz': 'doviz', 'döviz': 'doviz', 'kur': 'doviz', 'kurlar': 'doviz', 'dolar': 'doviz', 'euro': 'doviz', 'btc': 'doviz', 'bitcoin': 'doviz', 'altin': 'doviz', 'altın': 'doviz',
  'eczane': 'eczane', 'nobetcieczane': 'eczane', 'nöbetçieczane': 'eczane', 'nobetci': 'eczane',
  'namaz': 'namaz', 'ezan': 'namaz', 'vakit': 'namaz', 'vakitler': 'namaz',
  'haber': 'haber', 'haberler': 'haber', 'sondakika': 'haber', 'gundem': 'haber', 'gündem': 'haber',
  'deprem': 'deprem', 'kandilli': 'deprem', 'afad': 'deprem', 'sondepremler': 'deprem',

  // Araclar
  'hatirlat': 'hatirlat', 'hatırlat': 'hatirlat', 'alarm': 'hatirlat', 'remind': 'hatirlat',
  'qr': 'qr', 'qrcode': 'qr', 'barkod': 'qr',
  'kisalt': 'kisalt', 'kısalt': 'kisalt', 'short': 'kisalt', 'shorten': 'kisalt', 'urlkisalt': 'kisalt',
  'sozluk': 'sozluk', 'sözlük': 'sozluk', 'tdk': 'sozluk', 'anlam': 'sozluk',
  'wiki': 'wiki', 'vikipedi': 'wiki', 'wikipedia': 'wiki',

  // AI
  'ai': 'ai', 'sor': 'ai', 'gpt': 'ai', 'bot': 'ai', 'sohbet': 'ai', 'yapayzeka': 'ai',
  'ciz': 'ciz', 'çiz': 'ciz', 'resim': 'ciz', 'imagine': 'ciz', 'gorsel': 'ciz', 'görsel': 'ciz', 'airesim': 'ciz', 'aiciz': 'ciz', 'omniart': 'ciz', 'perchance': 'ciz',

  // Hentai
  'hentaizmfav': 'hentaizmfav', 'hentaizm fav': 'hentaizmfav', 'hentaifav': 'hentaizmfav', 'fav hentai': 'hentaizmfav',
  'indirhentai': 'indirhentai', 'hentaizm': 'indirhentai', 'indir hentai': 'indirhentai', 'hentaizmindir': 'indirhentai', 'hentaizm indir': 'indirhentai', 'hentaizmoku': 'indirhentai',
  'topluhentai': 'topluhentai', 'hentaizmfavtoplu': 'topluhentai', 'favtoplu': 'topluhentai', 'toplu hentai': 'topluhentai',
  'hentaigrup': 'hentaigrup', 'hentaigroup': 'hentaigrup', 'hentaihedef': 'hentaigrup',
  'hhelp': 'hhelp', 'hentaihelp': 'hhelp', 'h-help': 'hhelp', 'hyardim': 'hhelp', 'hentaiyardim': 'hhelp', 'hentai yardım': 'hhelp', 'hentai yardim': 'hhelp',

  // Sistem
  'durum': 'durum', 'status': 'durum', 'statu': 'durum', 'bilgi': 'durum',
  'disk': 'disk', 'yer': 'disk', 'depolama': 'disk',
  'hiz': 'hiz', 'hız': 'hiz', 'speed': 'hiz', 'ag': 'hiz',
  'gecmis': 'gecmis', 'geçmiş': 'gecmis', 'sonindirilenler': 'gecmis', 'son': 'gecmis', 'history': 'gecmis',
  'hatalar': 'hatalar', 'hata': 'hatalar', 'logs': 'hatalar', 'loglar': 'hatalar', 'error': 'hatalar', 'errors': 'hatalar',

  // Admin
  'izin': 'izin', 'yetki': 'izin', 'izinler': 'izin', 'grupizin': 'izin', 'grupayar': 'izin', 'komutkapat': 'izin', 'komutac': 'izin', 'komut': 'izin',
  'grupsec': 'grupsec', 'grupseç': 'grupsec', 'grup': 'grupsec',
  'cerez': 'cerez', 'çerez': 'cerez', 'cookie': 'cerez', 'cookies': 'cerez',
  'depo': 'depo',
  'guncelle': 'guncelle', 'güncelle': 'guncelle', 'update': 'guncelle',

  // Genel
  'yardim': 'yardim', 'help': 'yardim', 'menu': 'yardim', 'menü': 'yardim', 'rehber': 'yardim'
};

// Global default group permission template
export const DEFAULT_GROUP_CONFIG = {
  mode: 'blacklist', // 'blacklist' (all open except disabled) or 'whitelist' (all closed except allowed)
  disabledCategories: ['hentai'], // Default: 18+ content disabled in groups for safety
  disabledCommands: [],
  allowedCategories: [],
  allowedCommands: [],
  allowLinks: true,
  allowAdultLinks: false,
  allowAi: false, // Default: AI is DISABLED in all groups by default (only enabled from web panel / admin)
  silent: false
};

/**
 * Resolves a given command name or alias to its canonical command name.
 */
export function getCanonicalCommandName(nameOrAlias) {
  if (!nameOrAlias) return '';
  const clean = nameOrAlias.toLowerCase().replace(/^[!/.]/, '').trim();
  return ALIAS_MAP[clean] || clean;
}

/**
 * Mutable command -> category map (single source of truth for command placement).
 * Initialized from CATEGORIES; can be edited at runtime and persisted to permissions.json.
 */
export const COMMAND_CATEGORY_MAP = {};
for (const [categoryKey, catData] of Object.entries(CATEGORIES)) {
  for (const cmd of (catData.commands || [])) {
    COMMAND_CATEGORY_MAP[cmd] = categoryKey;
  }
}

export function rebuildCategoriesFromMap() {
  for (const cat of Object.values(CATEGORIES)) {
    cat.commands = [];
  }
  for (const [cmd, catKey] of Object.entries(COMMAND_CATEGORY_MAP)) {
    if (!CATEGORIES[catKey]) CATEGORIES[catKey] = { name: catKey, icon: '📁', description: '', commands: [] };
    if (!CATEGORIES[catKey].commands.includes(cmd)) CATEGORIES[catKey].commands.push(cmd);
  }
}

export function moveCommandToCategory(command, newCategory) {
  if (typeof command !== 'string' || typeof newCategory !== 'string') return false;
  const canonical = getCanonicalCommandName(command);
  if (!canonical || !Object.hasOwn(COMMAND_CATEGORY_MAP, canonical) || !Object.hasOwn(CATEGORIES, newCategory)) {
    return false;
  }
  for (const cat of Object.values(CATEGORIES)) {
    const idx = cat.commands.indexOf(canonical);
    if (idx !== -1) cat.commands.splice(idx, 1);
  }
  if (!CATEGORIES[newCategory].commands.includes(canonical)) CATEGORIES[newCategory].commands.push(canonical);
  COMMAND_CATEGORY_MAP[canonical] = newCategory;
  return true;
}

export function addCategory(key, name, icon = '📁', description = '') {
  if (!key || !/^[a-z0-9_-]+$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(CATEGORIES, key) || typeof name !== 'string' || !name.trim()) return false;
  CATEGORIES[key] = { name, icon, description, commands: [] };
  return true;
}

export function renameCategory(oldKey, newKey, newName) {
  if (!Object.hasOwn(CATEGORIES, oldKey) || !newKey || !/^[a-z0-9_-]+$/.test(newKey) || ['__proto__', 'constructor', 'prototype'].includes(newKey)) return false;
  if (oldKey !== newKey && Object.hasOwn(CATEGORIES, newKey)) return false;
  if (oldKey === newKey) {
    if (newName) CATEGORIES[oldKey].name = newName;
    return true;
  }
  CATEGORIES[newKey] = { ...CATEGORIES[oldKey], name: newName || CATEGORIES[oldKey].name };
  delete CATEGORIES[oldKey];
  for (const [cmd, cat] of Object.entries(COMMAND_CATEGORY_MAP)) {
    if (cat === oldKey) COMMAND_CATEGORY_MAP[cmd] = newKey;
  }
  return true;
}

const PERMISSIONS_FILE = path.join(dataPath, 'permissions.json');

export function savePermissionsToFile() {
  try {
    const payload = {
      categories: CATEGORIES,
      commandCategoryMap: COMMAND_CATEGORY_MAP,
      savedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(PERMISSIONS_FILE), { recursive: true });
    const temporaryPath = `${PERMISSIONS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temporaryPath, PERMISSIONS_FILE);
    return true;
  } catch (e) {
    console.error('[PERMISSION] save failed:', e.message);
    return false;
  }
}

export function loadPermissionsFromFile() {
  try {
    if (!fs.existsSync(PERMISSIONS_FILE)) return false;
    const raw = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf8'));
    if (raw.categories && typeof raw.categories === 'object' && !Array.isArray(raw.categories)) {
      for (const k of Object.keys(CATEGORIES)) delete CATEGORIES[k];
      for (const [key, category] of Object.entries(raw.categories)) {
        if (!/^[a-z0-9_-]+$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || !category || typeof category !== 'object' || Array.isArray(category)) continue;
        CATEGORIES[key] = {
          name: typeof category.name === 'string' ? category.name : key,
          icon: typeof category.icon === 'string' ? category.icon : '📁',
          description: typeof category.description === 'string' ? category.description : '',
          commands: Array.isArray(category.commands) ? category.commands.filter(command => typeof command === 'string') : []
        };
      }
    }
    if (raw.commandCategoryMap && typeof raw.commandCategoryMap === 'object' && !Array.isArray(raw.commandCategoryMap)) {
      for (const k of Object.keys(COMMAND_CATEGORY_MAP)) delete COMMAND_CATEGORY_MAP[k];
      for (const [command, categoryKey] of Object.entries(raw.commandCategoryMap)) {
        if (typeof categoryKey === 'string' && Object.hasOwn(CATEGORIES, categoryKey)) {
          COMMAND_CATEGORY_MAP[command] = categoryKey;
        }
      }
      rebuildCategoriesFromMap();
    }
    return true;
  } catch (e) {
    console.error('[PERMISSION] load failed:', e.message);
    return false;
  }
}

loadPermissionsFromFile();

/**
 * Gets the category key for a given command name or alias.
 */
export function getCommandCategory(nameOrAlias) {
  const canonical = getCanonicalCommandName(nameOrAlias);
  if (COMMAND_CATEGORY_MAP[canonical]) return COMMAND_CATEGORY_MAP[canonical];
  for (const [categoryKey, catData] of Object.entries(CATEGORIES)) {
    if (catData.commands.includes(canonical)) {
      return categoryKey;
    }
  }
  return 'genel';
}

/**
 * Checks if a given URL belongs to known adult / NSFW domains.
 */
export function isAdultUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return ADULT_DOMAINS.some(domain => lower.includes(domain));
}

/**
 * Retrieves the effective permission configuration for a group.
 */
export function getGroupConfig(groupJid) {
  const config = readConfig();
  const allGroupPermissions = config.groupPermissions || {};
  const groupSettings = allGroupPermissions[groupJid] || {};
  
  return {
    ...DEFAULT_GROUP_CONFIG,
    ...groupSettings,
    disabledCategories: groupSettings.disabledCategories ?? DEFAULT_GROUP_CONFIG.disabledCategories,
    disabledCommands: groupSettings.disabledCommands ?? DEFAULT_GROUP_CONFIG.disabledCommands,
    allowedCategories: groupSettings.allowedCategories ?? DEFAULT_GROUP_CONFIG.allowedCategories,
    allowedCommands: groupSettings.allowedCommands ?? DEFAULT_GROUP_CONFIG.allowedCommands,
    allowLinks: groupSettings.allowLinks !== undefined ? groupSettings.allowLinks : DEFAULT_GROUP_CONFIG.allowLinks,
    allowAdultLinks: groupSettings.allowAdultLinks !== undefined ? groupSettings.allowAdultLinks : DEFAULT_GROUP_CONFIG.allowAdultLinks,
    allowAi: groupSettings.allowAi !== undefined ? groupSettings.allowAi : DEFAULT_GROUP_CONFIG.allowAi,
    silent: groupSettings.silent !== undefined ? groupSettings.silent : DEFAULT_GROUP_CONFIG.silent,
    mode: groupSettings.mode || DEFAULT_GROUP_CONFIG.mode
  };
}

/**
 * Updates permission configuration for a group and saves to config.
 */
export function updateGroupConfig(groupJid, updates) {
  const config = readConfig();
  const allGroupPermissions = { ...(config.groupPermissions || {}) };
  const current = allGroupPermissions[groupJid] || { ...DEFAULT_GROUP_CONFIG };

  const updated = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  allGroupPermissions[groupJid] = updated;
  writeConfig({ groupPermissions: allGroupPermissions });
  return updated;
}

/**
 * Resets permission configuration for a group back to defaults.
 */
export function resetGroupConfig(groupJid) {
  const config = readConfig();
  const allGroupPermissions = { ...(config.groupPermissions || {}) };
  delete allGroupPermissions[groupJid];
  writeConfig({ groupPermissions: allGroupPermissions });
}

/**
 * Checks whether the sender is a Bot Owner / Admin.
 */
export function isBotOwner(msg, senderNumber) {
  if (msg?.key?.fromMe) return true;
  const config = readConfig();
  if (!config.adminJids) return false;
  
  const adminList = config.adminJids.split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(Boolean);
  if (adminList.length === 0) return false;

  const num = (senderNumber || '').replace(/[^0-9]/g, '');
  if (!num) return false;
  const cleanNum = num.slice(-10);

  return adminList.some(admin => {
    const cleanAdmin = admin.slice(-10);
    return cleanAdmin.length >= 7 && (cleanNum === cleanAdmin || num === admin);
  });
}

// In-memory cache for group metadata with a 5-minute TTL
const groupMetadataCache = new Map();

/**
 * Checks if the user is authorized to administer group permissions (Bot Owner OR WhatsApp Group Admin).
 */
export async function isGroupAdminOrOwner(sock, msg, from) {
  if (msg?.key?.fromMe) return true;
  const sender = msg?.key?.participant || from;
  const senderNumber = sender.split('@')[0];

  if (isBotOwner(msg, senderNumber)) return true;
  if (!from.endsWith('@g.us')) return true; // Direct messages are private

  try {
    const now = Date.now();
    let cached = groupMetadataCache.get(from);
    if (!cached || now > cached.expiresAt) {
      if (!sock || typeof sock.groupMetadata !== 'function') return false;
      const metadata = await sock.groupMetadata(from);
      if (metadata && metadata.participants) {
        cached = { metadata, expiresAt: now + 300000 }; // 5 minutes TTL
        groupMetadataCache.set(from, cached);
      }
    }
    if (!cached?.metadata?.participants) return false;
    
    const participant = cached.metadata.participants.find(p => p.id === sender || p.id.split('@')[0] === senderNumber);
    if (participant && (participant.admin === 'admin' || participant.admin === 'superadmin')) {
      return true;
    }
  } catch (err) {
    console.error(`[PERMISSION] Group metadata fetch error for ${from}:`, err.message);
  }

  return false;
}

/**
 * Evaluates whether a command is allowed to execute in the given context.
 * 
 * @param {string} commandName 
 * @param {string} from - JID of the chat
 * @param {object} options - { senderJid, isAdmin, isOwner }
 * @returns { { allowed: boolean, reason?: string, silent?: boolean, message?: string } }
 */
export function checkCommandPermission(commandName, from, options = {}) {
  const canonical = getCanonicalCommandName(commandName);
  const category = getCommandCategory(canonical);
  const isGroup = from.endsWith('@g.us');
  const { isOwner = false, isAdmin = false } = options;

  // 1. Bot Owner always has full access
  if (isOwner) {
    return { allowed: true };
  }

  // 2. Admin category check (Strict system commands require Bot Owner, permission config requires group admin)
  if (category === 'admin') {
    if (canonical === 'izin') {
      if (isAdmin) return { allowed: true };
      return {
        allowed: false,
        reason: 'admin_required',
        silent: false,
        message: '⛔ Bu komutu kullanmak için *Grup Yöneticisi* veya *Bot Sahibi* olmalısınız.'
      };
    }

    // Other admin commands require Bot Owner
    return {
      allowed: false,
      reason: 'owner_required',
      silent: false,
      message: '⛔ Bu komut yalnızca *Bot Sahibi* tarafından kullanılabilir.'
    };
  }

  // 3. Direct Message (DM / Private Chat): All public commands are allowed
  if (!isGroup) {
    return { allowed: true };
  }

  // 4. Group Permissions Evaluation
  const groupConfig = getGroupConfig(from);

  if (groupConfig.mode === 'whitelist') {
    const isCmdAllowed = groupConfig.allowedCommands.includes(canonical);
    const isCatAllowed = groupConfig.allowedCategories.includes(category);

    if (!isCmdAllowed && !isCatAllowed) {
      return {
        allowed: false,
        reason: 'not_whitelisted',
        silent: groupConfig.silent,
        message: `⛔ *[Yetki Kısıtlaması]* Bu grupta yalnızca izin verilen komutlar çalışır. \`!${canonical}\` komutuna izin verilmemiştir.`
      };
    }
  } else {
    // Blacklist Mode (Default)
    if (groupConfig.disabledCommands.includes(canonical)) {
      return {
        allowed: false,
        reason: 'command_disabled',
        silent: groupConfig.silent,
        message: `⛔ *[Komut Kapalı]* \`!${canonical}\` komutu bu grupta devre dışı bırakılmıştır.`
      };
    }

    if (groupConfig.disabledCategories.includes(category)) {
      const catInfo = CATEGORIES[category];
      const catTitle = catInfo ? catInfo.name : category;
      return {
        allowed: false,
        reason: 'category_disabled',
        silent: groupConfig.silent,
        message: `⛔ *[Kategori Kapalı]* *${catTitle}* kategorisindeki komutlar bu grupta devre dışı bırakılmıştır.`
      };
    }
  }

  return { allowed: true };
}

/**
 * Evaluates whether an incoming media link / download is permitted in the group.
 * 
 * @param {string} url 
 * @param {string} from - JID of the chat
 * @param {object} options - { isOwner, isAdmin }
 * @returns { { allowed: boolean, reason?: string, silent?: boolean, message?: string } }
 */
export function checkLinkPermission(url, from, options = {}) {
  const isGroup = from.endsWith('@g.us');
  const { isOwner = false } = options;

  if (isOwner || !isGroup) {
    return { allowed: true };
  }

  const groupConfig = getGroupConfig(from);
  const isAdult = isAdultUrl(url);

  // 1. Adult / NSFW link check
  if (isAdult) {
    const isHentaiDisabled = groupConfig.disabledCategories.includes('hentai') || !groupConfig.allowAdultLinks;
    if (isHentaiDisabled) {
      return {
        allowed: false,
        reason: 'adult_link_blocked',
        silent: groupConfig.silent,
        message: '🔞 Bu grupta yetişkin (18+) bağlantılardan medya indirme devre dışı bırakılmıştır.'
      };
    }
  }

  // 2. General links check
  if (!groupConfig.allowLinks || groupConfig.disabledCategories.includes('indirme') || groupConfig.disabledCommands.includes('indir')) {
    return {
      allowed: false,
      reason: 'links_blocked',
      silent: groupConfig.silent,
      message: '⛔ Bu grupta otomatik bağlantı indirme özelliği devre dışı bırakılmıştır.'
    };
  }

  return { allowed: true };
}
