import fs from 'fs';
import path from 'path';
import { sessionPath, dataPath } from '../config.js';

/**
 * 🧠 USER PROFILE & PERSISTENT MEMORY MANAGER
 * 
 * Her kullanıcı için kalıcı profil ve uzun vadeli hafıza veri tabanı.
 * Kullanıcı konuştukça öğrendiği detayları (isim, şehir, ilgi alanları, şakalar,
 * tercihler, meslek vb.) disk üzerindeki 'user_profiles.json' dosyasına kaydeder.
 * 
 * Özellikler:
 * - Yapay zeka sohbet esnasında [MEMORY_ADD: ...], [MEMORY_REMOVE: ...], [MEMORY_SET: k=v]
 *   direktifleriyle verileri dinamik olarak ekleyebilir, güncelleyebilir ve silebilir.
 * - Heuristik metin analizi ile kullanıcının belirttiği temel bilgiler (isim, şehir, takım vb.)
 *   otomatik olarak yakalanır.
 * - Her mesajda kullanıcının kalıcı profili yapay zeka sistem istemine (system prompt)
 *   bağlam olarak aktarılır.
 * - Web arayüzü ve WhatsApp komutları (.hafıza, .profil) üzerinden görüntülenebilir ve yönetilebilir.
 */
export class UserProfileManager {
  constructor(options = {}) {
    this.storageFile = options.storageFile || path.join(dataPath || './data', 'user_profiles.json');
    this.profiles = new Map();
    this.saveTimeout = null;
    this.maxFactsPerUser = options.maxFactsPerUser || 50;

    this.loadFromDisk();
  }

  /**
   * JID'yi temiz ve benzersiz anahtar formatına çevirir (örn: 905332624732)
   */
  cleanJid(jid) {
    if (!jid) return 'unknown';
    const str = String(jid).trim();
    // 905332624732@s.whatsapp.net -> 905332624732
    const base = str.split('@')[0].split(':')[0];
    return base.replace(/[^0-9a-zA-Z_-]/g, '') || str;
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          for (const [key, profile] of Object.entries(parsed)) {
            if (profile && typeof profile === 'object') {
              this.profiles.set(key, this.normalizeProfile(key, profile));
            }
          }
          console.log(`[USER MEMORY] ${this.profiles.size} kullanıcı profili diskten başarıyla yüklendi.`);
        }
      }
    } catch (err) {
      console.warn('[USER MEMORY] Profil dosyası okunamadı veya bozuk, yeni başlatılıyor:', err.message);
    }
  }

  scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.saveToDisk(), 1500);
  }

  saveToDisk() {
    try {
      const obj = {};
      for (const [key, profile] of this.profiles.entries()) {
        obj[key] = profile;
      }
      const dir = path.dirname(this.storageFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storageFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      console.error('[USER MEMORY SAVE ERROR]:', err.message);
    }
  }

  normalizeProfile(id, data = {}) {
    return {
      id: id,
      name: data.name || '',
      nickname: data.nickname || '',
      relationship: data.relationship || 'Yeni Tanışıldı',
      custom_relationship: Boolean(data.custom_relationship),
      intimacy_score: Number(data.intimacy_score) || 0,
      mood: data.mood || '',
      personality_traits: Array.isArray(data.personality_traits) ? data.personality_traits : [],
      facts: Array.isArray(data.facts) ? data.facts : [],
      notes: typeof data.notes === 'object' && data.notes !== null ? data.notes : {},
      important_dates: typeof data.important_dates === 'object' && data.important_dates !== null ? data.important_dates : {},
      preferences: {
        likes: Array.isArray(data.preferences?.likes) ? data.preferences.likes : [],
        dislikes: Array.isArray(data.preferences?.dislikes) ? data.preferences.dislikes : []
      },
      message_count: Number(data.message_count) || 0,
      first_seen: data.first_seen || Date.now(),
      last_seen: data.last_seen || Date.now()
    };
  }

  /**
   * Kullanıcı profilini getirir veya oluşturur
   */
  getProfile(rawJid, defaultName = '') {
    const id = this.cleanJid(rawJid);
    if (!this.profiles.has(id)) {
      const newProf = this.normalizeProfile(id, {
        name: defaultName || '',
        first_seen: Date.now(),
        last_seen: Date.now()
      });
      this.profiles.set(id, newProf);
      this.scheduleSave();
      return newProf;
    }
    const prof = this.profiles.get(id);
    if (defaultName && !prof.name) {
      prof.name = defaultName;
      this.scheduleSave();
    }
    return prof;
  }

  /**
   * Kullanıcıyla yeni bir etkileşim kaydeder ve samimiyet puanını günceller
   */
  touch(rawJid, senderName = '') {
    const prof = this.getProfile(rawJid, senderName);
    prof.message_count = (prof.message_count || 0) + 1;
    prof.intimacy_score = (prof.intimacy_score || 0) + 1;
    prof.last_seen = Date.now();
    if (senderName && !prof.name) prof.name = senderName;

    // Dinamik Samimiyet Seviyesi (Relationship Evolution)
    if (!prof.custom_relationship) {
      if (prof.intimacy_score > 100) prof.relationship = 'Can Dostu / Sırdaş';
      else if (prof.intimacy_score > 40) prof.relationship = 'Yakın Kanka';
      else if (prof.intimacy_score > 15) prof.relationship = 'Kanka';
      else if (prof.intimacy_score > 4) prof.relationship = 'Arkadaş';
      else prof.relationship = 'Yeni Tanışıldı';
    }

    this.scheduleSave();
    return prof;
  }

  /**
   * Hafızaya yeni bir gerçek/bilgi (fact) ekler
   */
  addFact(rawJid, factText) {
    if (!factText || typeof factText !== 'string') return false;
    const cleanFact = factText.trim();
    if (cleanFact.length < 2) return false;

    const prof = this.getProfile(rawJid);
    // Benzer veya birebir aynısı varsa ekleme
    const exists = prof.facts.some(f => f.toLowerCase() === cleanFact.toLowerCase() || f.includes(cleanFact));
    if (!exists) {
      prof.facts.unshift(cleanFact);
      if (prof.facts.length > this.maxFactsPerUser) {
        prof.facts = prof.facts.slice(0, this.maxFactsPerUser);
      }
      this.scheduleSave();
      console.log(`[USER MEMORY] + Bilgi Eklendi (${prof.id}): "${cleanFact}"`);
      return true;
    }
    return false;
  }

  /**
   * Anahtar kelime veya metinle eşleşen bilgiyi siler
   */
  removeFact(rawJid, keywordOrText) {
    if (!keywordOrText || typeof keywordOrText !== 'string') return false;
    const q = keywordOrText.trim().toLowerCase();
    const prof = this.getProfile(rawJid);
    const initialLen = prof.facts.length;

    prof.facts = prof.facts.filter(f => !f.toLowerCase().includes(q));
    if (prof.facts.length !== initialLen) {
      this.scheduleSave();
      console.log(`[USER MEMORY] - Bilgi Silindi (${prof.id}): "${keywordOrText}"`);
      return true;
    }
    return false;
  }

  /**
   * Kullanıcı için dinamik bir not/alan ayarlar (örn: sehir = 'Ankara', meslek = 'Yazılımcı')
   */
  setNote(rawJid, key, value) {
    if (!key) return false;
    const cleanKey = String(key).trim().toLowerCase();
    const cleanVal = String(value || '').trim();
    const prof = this.getProfile(rawJid);

    if (!cleanVal) {
      delete prof.notes[cleanKey];
    } else {
      prof.notes[cleanKey] = cleanVal;
    }
    this.scheduleSave();
    console.log(`[USER MEMORY] ✏️ Not Güncellendi (${prof.id}): ${cleanKey} = "${cleanVal}"`);
    return true;
  }

  /**
   * Notu siler
   */
  deleteNote(rawJid, key) {
    if (!key) return false;
    const cleanKey = String(key).trim().toLowerCase();
    const prof = this.getProfile(rawJid);
    if (prof.notes[cleanKey] !== undefined) {
      delete prof.notes[cleanKey];
      this.scheduleSave();
      return true;
    }
    return false;
  }

  /**
   * İsim veya lakap günceller
   */
  setName(rawJid, newName) {
    if (!newName) return false;
    const prof = this.getProfile(rawJid);
    prof.name = String(newName).trim();
    this.scheduleSave();
    return true;
  }

  setNickname(rawJid, nickname) {
    const prof = this.getProfile(rawJid);
    prof.nickname = String(nickname || '').trim();
    this.scheduleSave();
    return true;
  }

  setRelationship(rawJid, relation) {
    const prof = this.getProfile(rawJid);
    prof.relationship = String(relation || 'Arkadaş').trim();
    this.scheduleSave();
    return true;
  }

  /**
   * Kullanıcının tüm hafızasını sıfırlar
   */
  clearProfile(rawJid) {
    const id = this.cleanJid(rawJid);
    if (this.profiles.has(id)) {
      const prof = this.profiles.get(id);
      prof.facts = [];
      prof.notes = {};
      prof.personality_traits = [];
      prof.preferences = { likes: [], dislikes: [] };
      this.scheduleSave();
      console.log(`[USER MEMORY] 🧹 Hafıza Sıfırlandı (${id})`);
      return true;
    }
    return false;
  }

  /**
   * Yapay zekanın yanıtındaki hafıza direktiflerini yakalar, veri tabanına işler ve metni temizler.
   * Desteklenen direktifler:
   * [MEMORY_ADD: <bilgi>]
   * [MEMORY_REMOVE: <bilgi veya anahtar>]
   * [MEMORY_SET: <anahtar>=<değer>]
   * [MEMORY_DELETE: <anahtar>]
   * [MEMORY_NAME: <isim>]
   * [MEMORY_RELATION: <durum>]
   */
  processAiMemoryDirectives(rawJid, aiReplyText) {
    if (!aiReplyText || typeof aiReplyText !== 'string') {
      return { cleanText: aiReplyText, actionsApplied: [] };
    }

    let cleanText = aiReplyText;
    const actionsApplied = [];

    // 1. [MEMORY_ADD: ...]
    const addRegex = /\[MEMORY_ADD:\s*([^\]]+)\]/gi;
    let match;
    while ((match = addRegex.exec(aiReplyText)) !== null) {
      const fact = match[1].trim();
      if (fact) {
        this.addFact(rawJid, fact);
        actionsApplied.push({ action: 'add_fact', value: fact });
      }
    }
    cleanText = cleanText.replace(addRegex, '');

    // 2. [MEMORY_REMOVE: ...]
    const removeRegex = /\[MEMORY_REMOVE:\s*([^\]]+)\]/gi;
    while ((match = removeRegex.exec(aiReplyText)) !== null) {
      const target = match[1].trim();
      if (target) {
        this.removeFact(rawJid, target);
        actionsApplied.push({ action: 'remove_fact', value: target });
      }
    }
    cleanText = cleanText.replace(removeRegex, '');

    // 3. [MEMORY_SET: key=val]
    const setRegex = /\[MEMORY_SET:\s*([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ\-]+)\s*=\s*([^\]]+)\]/gi;
    while ((match = setRegex.exec(aiReplyText)) !== null) {
      const key = match[1].trim();
      const val = match[2].trim();
      if (key && val) {
        this.setNote(rawJid, key, val);
        actionsApplied.push({ action: 'set_note', key, value: val });
      }
    }
    cleanText = cleanText.replace(setRegex, '');

    // 4. [MEMORY_DELETE: key]
    const delRegex = /\[MEMORY_DELETE:\s*([^\]]+)\]/gi;
    while ((match = delRegex.exec(aiReplyText)) !== null) {
      const key = match[1].trim();
      if (key) {
        this.deleteNote(rawJid, key);
        actionsApplied.push({ action: 'delete_note', key });
      }
    }
    cleanText = cleanText.replace(delRegex, '');

    // 5. [MEMORY_NAME: ...]
    const nameRegex = /\[MEMORY_NAME:\s*([^\]]+)\]/gi;
    while ((match = nameRegex.exec(aiReplyText)) !== null) {
      const name = match[1].trim();
      if (name) {
        this.setName(rawJid, name);
        actionsApplied.push({ action: 'set_name', value: name });
      }
    }
    cleanText = cleanText.replace(nameRegex, '');

    // 6. [MEMORY_RELATION: ...]
    const relRegex = /\[MEMORY_RELATION:\s*([^\]]+)\]/gi;
    while ((match = relRegex.exec(aiReplyText)) !== null) {
      const rel = match[1].trim();
      if (rel) {
        this.setRelationship(rawJid, rel);
        actionsApplied.push({ action: 'set_relation', value: rel });
      }
    }
    cleanText = cleanText.replace(relRegex, '');

    // Boşlukları ve gereksiz satır başlarını düzelt
    cleanText = cleanText.replace(/^\s+/, '').replace(/\s{2,}/g, ' ').trim();

    return { cleanText, actionsApplied };
  }

  /**
   * Kullanıcının mesajındaki doğrudan ipuçlarını yakalar (Heuristik Analiz)
   */
  autoExtractUserFacts(rawJid, userText, senderName = '') {
    if (!userText || typeof userText !== 'string') return;
    const text = userText.trim();
    const lower = text.toLowerCase();
    const prof = this.getProfile(rawJid, senderName);

    // İsim yakalama: "benim adım/ismim Mehmet", "adım/ismim Ahmet"
    const nameMatch = text.match(/(?:benim\s+)?(?:adım|ismim)\s+([A-ZÇĞİÖŞÜa-zçğıöşü]{2,20})/i);
    if (nameMatch && nameMatch[1]) {
      const n = nameMatch[1].trim();
      if (!['ne', 'neydi', 'kim', 'bu', 'senin', 'benim'].includes(n.toLowerCase())) {
        prof.name = n;
        this.scheduleSave();
      }
    }

    // Şehir yakalama: "Ankara'da yaşıyorum", "Eskişehir'de mimarlık", "İzmir'deyim", "İstanbul'da oturuyorum"
    // Soru cümlelerinde (örn: "hangi şehirdeyim?", "neredeyim?") veya genel kelimelerde atama yapılmaz
    const isQuestionAboutCity = lower.includes('hangi') || lower.includes('nerede') || lower.includes('?') || lower.includes('miyim') || lower.includes('muyum');
    if (!isQuestionAboutCity) {
      const nonCities = ['şehir', 'sehir', 'nerede', 'neresi', 'burası', 'orası', 'hangi', 'ev', 'iş', 'ofis', 'yol', 'otobüs', 'araba', 'tren', 'uçak', 'tatil', 'otel', 'köy', 'oda'];
      const cityMatch = text.match(/([A-ZÇĞİÖŞÜa-zçğıöşü]{3,15})('da|'de|'ta|'te|da|de|ta|te)\s+(?:yaşıyorum|ikamet|oturuyorum|bulunuyorum|çalışıyorum|mimarlık|yazılımcı|okuyorum)/i);
      if (cityMatch && cityMatch[1]) {
        const c = cityMatch[1].trim();
        if (!nonCities.includes(c.toLowerCase())) {
          this.setNote(rawJid, 'sehir', c);
        }
      } else {
        const cityShortMatch = text.match(/([A-ZÇĞİÖŞÜa-zçğıöşü]{3,15})('da|'de|'ta|'te|da|de|ta|te)yim/i);
        if (cityShortMatch && cityShortMatch[1]) {
          const c = cityShortMatch[1].trim();
          if (!nonCities.includes(c.toLowerCase())) {
            this.setNote(rawJid, 'sehir', c);
          }
        }
      }
    }

    // Takım yakalama: "Galatasaraylıyım", "Fenerbahçe tutuyorum", "Beşiktaşlıyım"
    if (lower.includes('fenerbahçeliyim') || lower.includes('fenerbahçe tutuyorum')) {
      this.setNote(rawJid, 'takim', 'Fenerbahçe');
    } else if (lower.includes('galatasaraylıyım') || lower.includes('galatasaray tutuyorum')) {
      this.setNote(rawJid, 'takim', 'Galatasaray');
    } else if (lower.includes('beşiktaşlıyım') || lower.includes('beşiktaş tutuyorum')) {
      this.setNote(rawJid, 'takim', 'Beşiktaş');
    } else if (lower.includes('trabzonsporluyum')) {
      this.setNote(rawJid, 'takim', 'Trabzonspor');
    }

    // Meslek yakalama: "yazılımcıyım", "mühendisim", "öğrenciyim", "mimarlık yapıyorum", "mimarım", "doktorum"
    const jobMatch = lower.match(/(yazılımcıyım|öğrenciyim|mühendisim|doktorum|avukatım|tasarımcıyım|öğretmenim|aşçıyım|mimarım|mimarlık yapıyorum)/);
    if (jobMatch && jobMatch[1]) {
      let job = jobMatch[1].replace(/yım$|im$|um$| yapıyorum$/, '').trim();
      if (job.toLowerCase() === 'mimarlık') job = 'Mimar';
      this.setNote(rawJid, 'meslek', job.charAt(0).toUpperCase() + job.slice(1));
    }

    // Evcil hayvan yakalama: "Mavi adında muhabbet kuşum var", "Pamuk adında kedim var"
    const petMatch = text.match(/([A-ZÇĞİÖŞÜa-zçğıöşü]{2,15})\s+adında\s+(?:bir\s+)?(köpeğim|kedim|kuşum|muhabbet kuşum|tavşanım|balığım)\s+var/i);
    if (petMatch) {
      const petName = petMatch[1].trim();
      const petType = petMatch[2].trim();
      this.addFact(rawJid, `${petName} adında ${petType} var.`);
    }

    // Enstrüman yakalama: "gitar çalıyorum", "piyano çalıyorum", "bateri çalıyorum"
    const instrumentMatch = lower.match(/(klasik gitar|gitar|piyano|bateri|keman|bağlama|flüt)\s+çalıyorum/);
    if (instrumentMatch) {
      this.addFact(rawJid, `${instrumentMatch[1]} çalıyor.`);
    }

    // Beğeni ve Zevkler Yakalama ("anime çok severim", "rock müzik bayılırım")
    const likeMatch = text.match(/([a-zA-Z0-9\sğüşıöçĞÜŞİÖÇ]{2,20})\s+(?:çok\s+)?(?:severim|bayılırım|seviyorum)/i);
    if (likeMatch && likeMatch[1]) {
      const item = likeMatch[1].trim();
      const forbidden = ['ben', 'sen', 'onu', 'bunu', 'şunu', 'kanka', 'evet', 'hayır'];
      if (!forbidden.includes(item.toLowerCase()) && !prof.preferences.likes.includes(item)) {
        prof.preferences.likes.push(item);
        if (prof.preferences.likes.length > 10) prof.preferences.likes.shift();
      }
    }

    // Hoşlanılmayan Şeyler Yakalama ("sütlü tatlıları hiç sevmem", "yalandan nefret ederim")
    const dislikeMatch = text.match(/([a-zA-Z0-9\sğüşıöçĞÜŞİÖÇ]{2,20})\s+(?:hiç\s+)?(?:sevmem|nefret ederim|sevmiyorum)/i);
    if (dislikeMatch && dislikeMatch[1]) {
      const item = dislikeMatch[1].trim();
      const forbidden = ['ben', 'sen', 'onu', 'bunu', 'şunu', 'kanka'];
      if (!forbidden.includes(item.toLowerCase()) && !prof.preferences.dislikes.includes(item)) {
        prof.preferences.dislikes.push(item);
        if (prof.preferences.dislikes.length > 10) prof.preferences.dislikes.shift();
      }
    }

    // Duygu Durumu Yakalama (Mood Detection)
    if (lower.includes('moralim bozuk') || lower.includes('canım sıkkın') || lower.includes('üzgünüm') || lower.includes('dertliyim')) {
      prof.mood = 'Dertli / Morali Bozuk (Şefkatli ve destekleyici yaklaş)';
    } else if (lower.includes('çok mutluyum') || lower.includes('keyfim yerinde') || lower.includes('harika bir gün') || lower.includes('neşeliyim')) {
      prof.mood = 'Neşeli / Keyifli (Pozitif enerjisine katıl)';
    } else if (lower.includes('çok yoruldum') || lower.includes('pestilim çıktı') || lower.includes('uykum var')) {
      prof.mood = 'Yorgun / Bitkin';
    } else if (lower.includes('stresliyim') || lower.includes('gerginim') || lower.includes('kafam çok dolu')) {
      prof.mood = 'Stresli / Gergin';
    }

    // Yaş yakalama: "25 yaşındayım", "yaşım 24"
    const ageMatch = text.match(/(?:yaşım\s+(\d{1,2})|(\d{1,2})\s+yaşındayım)/i);
    if (ageMatch) {
      const age = ageMatch[1] || ageMatch[2];
      if (age && Number(age) > 5 && Number(age) < 100) {
        this.setNote(rawJid, 'yas', age);
      }
    }
  }

  /**
   * Yapay zeka sistem istemi (System Prompt) için bağlam bloğu üretir
   */
  getFormattedProfileForPrompt(rawJid, senderName = '') {
    const prof = this.getProfile(rawJid, senderName);
    const id = prof.id;

    let out = `\n👤 KONUŞTUĞUN KİŞİNİN KALICI PROFİLİ VE HAFIZAN:\n`;
    out += `- Telefon / ID: ${id}\n`;
    if (prof.name) out += `- İsim / Hitap: ${prof.name}\n`;
    if (prof.nickname) out += `- Lakap: ${prof.nickname}\n`;
    out += `- İlişki / Durum: ${prof.relationship || 'Arkadaş'}\n`;
    out += `- Samimiyet Seviyesi: ${prof.intimacy_score || 1} puan\n`;
    if (prof.mood) out += `- Karşındakinin Ruh Hali: ${prof.mood}\n`;
    out += `- Tanışıklık: ${prof.message_count || 1} mesajdır konuşuyorsunuz\n`;

    if (prof.preferences?.likes && prof.preferences.likes.length > 0) {
      out += `- Sevdiği Şeyler: ${prof.preferences.likes.join(', ')}\n`;
    }
    if (prof.preferences?.dislikes && prof.preferences.dislikes.length > 0) {
      out += `- Sevmediği / Rahatsız Olduğu Şeyler: ${prof.preferences.dislikes.join(', ')}\n`;
    }

    const noteEntries = Object.entries(prof.notes || {});
    if (noteEntries.length > 0) {
      out += `- Kişisel Bilgiler & Notlar:\n`;
      for (const [k, v] of noteEntries) {
        out += `  * ${k.toUpperCase()}: ${v}\n`;
      }
    }

    if (prof.facts && prof.facts.length > 0) {
      out += `- Hakkında Bildiğin Diğer Detaylar (Kalıcı Bellek):\n`;
      for (const f of prof.facts.slice(0, 20)) {
        out += `  * ${f}\n`;
      }
    }

    out += `\n💡 HAFIZA KULLANIM VE GÜNCELLEME TALİMATI:
1. Bu bilgileri konuşurken DOĞAL ŞEKİLDE hatırla ve gerektiğinde laf arasına kat.
2. Kullanıcı sana kendisi hakkında YENİ BİR BİLGİ söylediğinde, bunu kalıcı hafızana eklemek için cevabının içinde şu gizli etiketi kullan: [MEMORY_ADD: öğrendiğin bilgi]
3. Bir bilginin değiştiğini, yanlış olduğunu veya eskidiğini söylediğinde: [MEMORY_REMOVE: silinecek kelime veya bilgi]
4. Şehir, meslek, yaş, takım gibi net bir not ayarlamak için: [MEMORY_SET: sehir=İzmir] veya [MEMORY_SET: meslek=Avukat]
(Bu etiketler otomatik olarak ayrıştırılıp veri tabanına işlenecek ve kullanıcıya gönderilmeden gizlenecektir, doğal konuşmanı sürdür!)\n`;

    return out;
  }

  /**
   * Kullanıcıya WhatsApp üzerinde göstermek için şık hafıza dökümü metni üretir (.hafıza komutu için)
   */
  formatUserMemoryCard(rawJid) {
    const prof = this.getProfile(rawJid);
    let out = `🧠 *SENİN HAKKINDA BİLDİKLERİM (HAFIZA KARTI)*\n`;
    out += `━━━━━━━━━━━━━━━━━━━━\n`;
    out += `👤 *İsim:* ${prof.name || 'Bilinmiyor'}\n`;
    if (prof.nickname) out += `🏷️ *Lakap:* ${prof.nickname}\n`;
    out += `🤝 *İlişki:* ${prof.relationship || 'Arkadaş'}\n`;
    if (prof.mood) out += `🎭 *Son Ruh Hali:* ${prof.mood}\n`;
    out += `💬 *Toplam Mesaj:* ${prof.message_count || 0}\n`;

    if (prof.preferences?.likes?.length > 0) {
      out += `❤️ *Sevdiklerin:* ${prof.preferences.likes.join(', ')}\n`;
    }
    if (prof.preferences?.dislikes?.length > 0) {
      out += `🚫 *Sevmediklerin:* ${prof.preferences.dislikes.join(', ')}\n`;
    }

    const notes = Object.entries(prof.notes || {});
    if (notes.length > 0) {
      out += `\n📌 *Kayıtlı Notlar:*\n`;
      for (const [k, v] of notes) {
        out += `• *${k.charAt(0).toUpperCase() + k.slice(1)}:* ${v}\n`;
      }
    }

    if (prof.facts && prof.facts.length > 0) {
      out += `\n📝 *Öğrenilen Detaylar:*\n`;
      prof.facts.forEach((f, i) => {
        out += `${i + 1}. ${f}\n`;
      });
    } else {
      out += `\n_Henüz özel bir anı veya bilgi kaydetmedim. Konuştukça seni daha iyi tanıyacağım!_\n`;
    }

    out += `━━━━━━━━━━━━━━━━━━━━\n`;
    out += `💡 *İpucu:* Bana kendinden bahsettikçe hafızam otomatik güncellenir. Sıfırlamak için *.hafiza-sil* yazabilirsin.`;
    return out;
  }

  /**
   * Tüm profillerin özet listesi (Dashboard için)
   */
  getAllProfilesList() {
    const list = [];
    for (const [id, prof] of this.profiles.entries()) {
      list.push({
        id,
        name: prof.name || 'İsimsiz',
        nickname: prof.nickname || '',
        relationship: prof.relationship || 'Arkadaş',
        notesCount: Object.keys(prof.notes || {}).length,
        factsCount: (prof.facts || []).length,
        messageCount: prof.message_count || 0,
        lastSeen: prof.last_seen || 0
      });
    }
    // Son görülen en üstte
    return list.sort((a, b) => b.lastSeen - a.lastSeen);
  }
}

// Singleton global nesne
export const userProfileManager = new UserProfileManager();
export default userProfileManager;
