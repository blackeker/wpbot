import fs from 'fs';
import path from 'path';
import { sessionPath } from '../config.js';

/**
 * ── USER PROFILE & KNOWLEDGE MANAGER (Kalıcı Kullanıcı Belleği) ──
 * Her kullanıcının (veya numarasının) bilgilerini (ismi, takma adı, memleketi, hobileri,
 * sevdiği/sevmediği şeyler, tuttuğu takım, hedefleri, kişisel notları vb.)
 * kalıcı olarak JSON dosyasında saklar.
 * Yapay zeka sohbet ederken kullanıcı hakkında yeni bilgi öğrendiğinde
 * veya bir bilgi güncellendiğinde bu veriyi dinamik olarak günceller.
 */
class UserProfileManager {
  constructor() {
    this.storageFile = path.join(sessionPath || './auth_info_session', 'ai_user_profiles.json');
    this.profiles = new Map();
    this.saveTimeout = null;
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          for (const [userId, profile] of Object.entries(parsed)) {
            this.profiles.set(this.normalizeUserId(userId), profile);
          }
        }
      }
    } catch (e) {
      console.warn('[USER PROFILES] Diskten profil okunamadı, yeni başlatılıyor:', e.message);
    }
  }

  scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.saveToDisk(), 1500);
  }

  saveToDisk() {
    try {
      const obj = {};
      for (const [userId, profile] of this.profiles.entries()) {
        obj[userId] = profile;
      }
      const dir = path.dirname(this.storageFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storageFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      console.error('[USER PROFILES SAVE ERROR]:', e.message);
    }
  }

  normalizeUserId(jidOrNumber) {
    if (!jidOrNumber) return '';
    const clean = String(jidOrNumber).split('@')[0].replace(/[^0-9]/g, '');
    return clean || String(jidOrNumber);
  }

  getProfile(jidOrNumber) {
    const userId = this.normalizeUserId(jidOrNumber);
    if (!userId) return null;
    if (!this.profiles.has(userId)) {
      this.profiles.set(userId, {
        userId,
        name: null,
        nickname: null,
        gender: null,
        city: null,
        occupation: null,
        interests: [],
        favoriteThings: [],
        dislikedThings: [],
        customNotes: {},
        lastUpdated: Date.now()
      });
    }
    return this.profiles.get(userId);
  }

  updateProfile(jidOrNumber, updates = {}) {
    const profile = this.getProfile(jidOrNumber);
    if (!profile) return null;

    if (updates.name && typeof updates.name === 'string') profile.name = updates.name.trim();
    if (updates.nickname && typeof updates.nickname === 'string') profile.nickname = updates.nickname.trim();
    if (updates.gender && typeof updates.gender === 'string') profile.gender = updates.gender.trim();
    if (updates.city && typeof updates.city === 'string') profile.city = updates.city.trim();
    if (updates.occupation && typeof updates.occupation === 'string') profile.occupation = updates.occupation.trim();

    // Dizi alanları (interests, favoriteThings, dislikedThings)
    const mergeArray = (key, items) => {
      if (Array.isArray(items)) {
        profile[key] = profile[key] || [];
        for (const item of items) {
          const str = String(item).trim();
          if (str && !profile[key].includes(str)) {
            profile[key].push(str);
          }
        }
      } else if (typeof items === 'string' && items.trim()) {
        profile[key] = profile[key] || [];
        const str = items.trim();
        if (!profile[key].includes(str)) {
          profile[key].push(str);
        }
      }
    };

    if (updates.interests) mergeArray('interests', updates.interests);
    if (updates.favoriteThings) mergeArray('favoriteThings', updates.favoriteThings);
    if (updates.dislikedThings) mergeArray('dislikedThings', updates.dislikedThings);

    // Çıkarılacak alanlar
    const removeFromArray = (key, items) => {
      if (!profile[key]) return;
      const toRemove = Array.isArray(items) ? items.map(s => String(s).toLowerCase().trim()) : [String(items).toLowerCase().trim()];
      profile[key] = profile[key].filter(x => !toRemove.includes(String(x).toLowerCase().trim()));
    };

    if (updates.removeInterests) removeFromArray('interests', updates.removeInterests);
    if (updates.removeFavoriteThings) removeFromArray('favoriteThings', updates.removeFavoriteThings);
    if (updates.removeDislikedThings) removeFromArray('dislikedThings', updates.removeDislikedThings);

    // Özel Notlar (Key-Value)
    if (updates.customNotes && typeof updates.customNotes === 'object') {
      profile.customNotes = profile.customNotes || {};
      for (const [k, v] of Object.entries(updates.customNotes)) {
        if (v === null || v === '') {
          delete profile.customNotes[k];
        } else {
          profile.customNotes[k] = v;
        }
      }
    }

    if (updates.deleteNotes && Array.isArray(updates.deleteNotes)) {
      for (const k of updates.deleteNotes) {
        if (profile.customNotes) delete profile.customNotes[k];
      }
    }

    profile.lastUpdated = Date.now();
    this.scheduleSave();
    return profile;
  }

  getProfileSummaryForPrompt(jidOrNumber) {
    const profile = this.getProfile(jidOrNumber);
    if (!profile) return '';

    const lines = [];
    if (profile.name) lines.push(`İsim: ${profile.name}`);
    if (profile.nickname) lines.push(`Takma Ad / Hitap: ${profile.nickname}`);
    if (profile.city) lines.push(`Şehir/Memleket: ${profile.city}`);
    if (profile.occupation) lines.push(`Meslek/Okul: ${profile.occupation}`);
    if (profile.gender) lines.push(`Cinsiyet: ${profile.gender}`);
    if (profile.interests && profile.interests.length > 0) lines.push(`İlgi Alanları/Hobiler: ${profile.interests.join(', ')}`);
    if (profile.favoriteThings && profile.favoriteThings.length > 0) lines.push(`Sevdiği Şeyler: ${profile.favoriteThings.join(', ')}`);
    if (profile.dislikedThings && profile.dislikedThings.length > 0) lines.push(`Sevmediği Şeyler: ${profile.dislikedThings.join(', ')}`);

    if (profile.customNotes && Object.keys(profile.customNotes).length > 0) {
      const notes = Object.entries(profile.customNotes).map(([k, v]) => `${k}: ${v}`).join(' | ');
      lines.push(`Kişisel Notlar & Hatırlananlar: ${notes}`);
    }

    if (lines.length === 0) return '';
    return `👤 [BU KULLANICI HAKKINDA HAFIZANDAKİ BİLGİLER]:\n${lines.join('\n')}`;
  }
}

export const userProfileManager = new UserProfileManager();
