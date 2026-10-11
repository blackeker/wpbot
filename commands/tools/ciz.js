import axios from 'axios';
import { pendingSelections, setPendingSelection } from '../../queue.js';
import { readConfig } from '../../config.js';
import { checkDailyLimit, recordUsage, isPremium } from '../../utils/rateLimiter.js';

// Core 10 Styles Definition
export const STYLE_MAP = {
  '1': 'anime',
  '2': 'foto',
  '3': 'sinema',
  '4': 'dijital',
  '5': 'cyberpunk',
  '6': 'yagliboya',
  '7': 'fantastik',
  '8': '3d',
  '9': 'pixel',
  '10': 'nsfw',

  anime: {
    name: 'Anime & Manga',
    icon: '🌸',
    perchanceStyle: 'anime',
    negative: 'lowres, bad anatomy, bad hands, blurry, worst quality, low quality, distorted',
    tags: 'masterpiece, best quality, ultra-detailed anime art, vibrant anime aesthetic, sharp focus'
  },
  foto: {
    name: 'Fotogerçekçi Portre (8K)',
    icon: '📸',
    perchanceStyle: 'photorealistic',
    negative: 'anime, drawing, cartoon, 3d, render, illustration, bad anatomy, blurry, low quality',
    tags: 'photorealistic portrait, 8k raw photo, highly detailed skin texture, 35mm lens, depth of field, studio lighting, award winning'
  },
  sinema: {
    name: 'Sinematik Film Sahnesi',
    icon: '🎬',
    perchanceStyle: 'cinematic',
    negative: 'anime, cartoon, drawing, painting, bad quality, blurry',
    tags: 'cinematic film still, 35mm movie scene, realistic atmospheric lighting, color graded masterpiece, 8k raw'
  },
  dijital: {
    name: 'Modern Dijital Çizim',
    icon: '🎨',
    perchanceStyle: 'digital art',
    negative: 'photo, realistic, bad drawing, blurry, low quality',
    tags: 'modern digital art illustration, clean lines, vibrant colors, trending on artstation'
  },
  cyberpunk: {
    name: 'Neon Siberpunk & Gelecek',
    icon: '🌃',
    perchanceStyle: 'cyberpunk',
    negative: 'lowres, bad anatomy, blurry, worst quality, low quality, oversaturated',
    tags: 'cyberpunk aesthetic, neon lighting, futuristic sci-fi, dark rainy high-tech city, volumetric lighting, 8k'
  },
  yagliboya: {
    name: 'Klasik Yağlı Boya Tablo',
    icon: '🖼️',
    perchanceStyle: 'oil painting',
    negative: 'photo, 3d render, digital, bad art, low quality',
    tags: 'renaissance classical oil painting on canvas, artistic textured brushstrokes, fine art masterpiece'
  },
  fantastik: {
    name: 'Büyülü Fantastik & RPG',
    icon: '🧙‍♂️',
    perchanceStyle: 'fantasy',
    negative: 'low quality, modern, car, blurry, bad anatomy, lowres',
    tags: 'epic high fantasy digital art, mythical, magical glowing atmosphere, detailed concept art, cinematic lighting'
  },
  '3d': {
    name: '3D Disney / Pixar & Octane',
    icon: '👾',
    perchanceStyle: '3D render',
    negative: 'flat, 2d, sketch, painting, bad render, blurry, distorted',
    tags: 'cute 3d render, pixar disney animation style, octane render, vivid colors, smooth surfaces, raytracing 4k'
  },
  pixel: {
    name: '16-Bit Retro Pixel Art',
    icon: '🕹️',
    perchanceStyle: 'digital art',
    negative: 'photorealistic, 3d, modern render, blurry, smooth, gradient',
    tags: '16-bit pixel art, retro gaming aesthetic, vibrant pixelated details, snes arcade pixel masterpiece'
  },
  nsfw: {
    name: 'NSFW & Hentai (Uncensored)',
    icon: '🔞',
    perchanceStyle: 'anime',
    negative: 'lowres, bad anatomy, bad hands, blurry, worst quality, low quality, censored, mosaic',
    tags: 'masterpiece, best quality, ultra-detailed, uncensored, expressive, vibrant lighting'
  }
};

export function resolveStyle(input) {
  if (!input) return STYLE_MAP.anime;
  const clean = input.toLowerCase().trim().replace(/^[!#./]/, '');
  if (STYLE_MAP[clean] && typeof STYLE_MAP[clean] === 'string') {
    const targetKey = STYLE_MAP[clean];
    return STYLE_MAP[targetKey] || STYLE_MAP.anime;
  }
  if (STYLE_MAP[clean] && typeof STYLE_MAP[clean] === 'object') {
    return STYLE_MAP[clean];
  }
  // Keyword fuzzy matching
  if (['anime', 'manga', 'ghibli', 'waifu', 'çizgi'].some(k => clean.includes(k))) return STYLE_MAP.anime;
  if (['foto', 'portre', 'gercek', 'gerçek', 'real'].some(k => clean.includes(k))) return STYLE_MAP.foto;
  if (['sinema', 'film', 'movie', 'sahne'].some(k => clean.includes(k))) return STYLE_MAP.sinema;
  if (['dijital', 'cizim', 'çizim', 'art'].some(k => clean.includes(k))) return STYLE_MAP.dijital;
  if (['cyber', 'siber', 'neon', 'mecha'].some(k => clean.includes(k))) return STYLE_MAP.cyberpunk;
  if (['yagliboya', 'yağlı', 'tablo', 'oil'].some(k => clean.includes(k))) return STYLE_MAP.yagliboya;
  if (['fantastik', 'fantasy', 'rpg', 'buyu', 'büyü'].some(k => clean.includes(k))) return STYLE_MAP.fantastik;
  if (['3d', 'pixar', 'disney', 'render'].some(k => clean.includes(k))) return STYLE_MAP['3d'];
  if (['pixel', 'piksel', 'retro', '8bit', '16bit'].some(k => clean.includes(k))) return STYLE_MAP.pixel;
  if (['nsfw', 'hentai', 'ecchi', '+18', 'yetiskin', 'yetişkin'].some(k => clean.includes(k))) return STYLE_MAP.nsfw;

  return STYLE_MAP.anime;
}

export function getStyleMenuText(prompt) {
  return `🎨 *YAPAY ZEKA GÖRSEL STÜDYOSU*
━━━━━━━━━━━━━━━━━━━━
📝 *İstem:* ${prompt}

Lütfen bir *Sanat Tarzı / Kategori* seçin:

1️⃣ 🌸 *Anime & Manga*
2️⃣ 📸 *Fotogerçekçi Portre (8K)*
3️⃣ 🎬 *Sinematik Film Sahnesi*
4️⃣ 🎨 *Modern Dijital Çizim*
5️⃣ 🌃 *Neon Siberpunk & Gelecek*
6️⃣ 🖼️ *Klasik Yağlı Boya Tablo*
7️⃣ 🧙‍♂️ *Büyülü Fantastik & RPG*
8️⃣ 👾 *3D Disney / Pixar & Octane*
9️⃣ 🕹️ *16-Bit Retro Pixel Art*
🔟 🔞 *NSFW & Hentai (Uncensored)*
━━━━━━━━━━━━━━━━━━━━
💡 *Seçmek için numarasını (1-10) veya stil adını (Örn: 1 veya foto) yazın.*
❌ İptal etmek için: *iptal*`;
}

export function getShapeMenuText(styleObj) {
  return `📐 *GÖRSEL BOYUTU / EN-BOY ORANI SEÇİMİ*
━━━━━━━━━━━━━━━━━━━━
🎨 *Seçilen Stil:* ${styleObj.icon} ${styleObj.name}

Lütfen görsel boyutunu seçin:

1️⃣ ⏹️ *Kare (1:1)* ➔ Standart / Profil
2️⃣ 📱 *Dikey (9:16)* ➔ WhatsApp Durum & Hikaye
3️⃣ 🖥️ *Yatay (16:9)* ➔ Geniş Ekran / Manzara
━━━━━━━━━━━━━━━━━━━━
💡 *Seçmek için 1, 2 veya 3 (ya da kare/dikey/yatay) yazın.*
❌ İptal etmek için: *iptal*`;
}

/**
 * Generates an image exclusively using Perchance AI API.
 */
export async function executeAiDraw(prompt, styleInput, shape = 'square') {
  const styleObj = (typeof styleInput === 'object' && styleInput !== null && styleInput.name)
    ? styleInput
    : resolveStyle(styleInput);

  let shapeLabel = '1:1 Kare';
  if (shape === 'portrait') {
    shapeLabel = '9:16 Dikey';
  } else if (shape === 'landscape') {
    shapeLabel = '16:9 Yatay';
  }

  const rawPrompt = prompt ? prompt.trim() : '';
  let processedPrompt = rawPrompt;

  // Otomatik Türkçe -> İngilizce Prompt Çevirisi & Zenginleştirme
  if (/[ığüşöçİĞÜŞÖÇ]/.test(rawPrompt)) {
    try {
      const { translateToEnglish } = await import('../../utils/translator.js');
      const translated = await translateToEnglish(rawPrompt);
      if (translated && translated.trim().length > 0) {
        processedPrompt = translated.trim();
      }
    } catch (tErr) {
      console.warn('[CIZ TRANSLATE ERROR]:', tErr.message);
    }
  }

  const config = readConfig();

  // Candidate Perchance endpoints
  const candidateEndpoints = [
    config?.perchanceAiApi,
    process.env.PERCHANCE_AI_API,
    'http://127.0.0.1:8000',
    'http://localhost:8000'
  ].filter(Boolean);

  const endpoints = [...new Set(candidateEndpoints)];

  for (const baseUrl of endpoints) {
    try {
      const startTime = Date.now();
      const payload = {
        prompt: styleObj.tags ? `${processedPrompt}, ${styleObj.tags}` : processedPrompt,
        negative_prompt: styleObj.negative || 'blurry, low quality, bad anatomy, deformed hands, extra limbs',
        style: styleObj.perchanceStyle || 'anime',
        shape: shape,
        num_images: 1,
        response_format: 'url'
      };

      const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
      const res = await axios.post(`${cleanBaseUrl}/generate`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 90000
      });

      if (res.data && res.data.data && res.data.data[0]) {
        const item = res.data.data[0];
        let buffer = null;

        if (item.b64_json) {
          buffer = Buffer.from(item.b64_json, 'base64');
        } else if (item.url) {
          const imgUrl = item.url.startsWith('http') ? item.url : `${cleanBaseUrl}${item.url}`;
          const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 35000 });
          buffer = Buffer.from(imgRes.data);
        }

        if (buffer && buffer.length > 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          return { 
            buffer, 
            engine: `Perchance AI (${styleObj.perchanceStyle || 'anime'})`, 
            elapsed, 
            shapeLabel
          };
        }
      }
    } catch (err) {
      console.error(`[Perchance AI] Error calling ${baseUrl}:`, err.message);
    }
  }

  return null;
}

export default {
  name: 'ciz',
  aliases: ['çiz', 'resim', 'imagine', 'gorsel', 'görsel', 'airesim', 'aiciz', 'omniart', 'perchance'],
  description: 'Yapay zeka ile görsel üretimi (Yalnızca Özel Mesaj / DM)',
  async execute(sock, msg, from, args = [], ctx = {}) {
    // SADECE DM (Özel Mesaj) KONTROLÜ
    if (from.endsWith('@g.us')) {
      await sock.sendMessage(from, { 
        text: '❌ `!ciz` komutu yalnızca *Özel Mesajlarda (DM)* kullanılabilir. Lütfen bota özel mesaj olarak yazın.' 
      });
      return;
    }

    const rawText = args.join(' ').trim();

    const sender = msg.key.participant || from;

    // 2. Günlük görsel limiti kontrolü (3/gün, premium muaf)
    const CIZ_DAILY_LIMIT = 3;
    const limitCheck = checkDailyLimit(sender, 'ciz', CIZ_DAILY_LIMIT);
    if (!limitCheck.allowed) {
      await sock.sendMessage(from, {
        text: `⛔ *Günlük görsel limitine ulaştın!*\n\nHer kullanıcı günde en fazla *${CIZ_DAILY_LIMIT} görsel* üretebilir.\n📊 Kullanım: ${limitCheck.used}/${limitCheck.limit}\n⏰ Limit her gün sıfırlanır.\n\n💎 _Premium üyelik için bot sahibiyle iletişime geç._`
      });
      return;
    }

    if (!rawText) {
      setPendingSelection(from, {
        type: 'ciz_flow',
        step: 'prompt',
        sender,
        createdAt: Date.now()
      });
      await sock.sendMessage(from, {
        text: `🎨 *Hazır Ve Nazır*\n━━━━━━━━━━━━━━━━━━━━\n📝 Lütfen çizilmesini istediğiniz görseli açıklayan metni (istem / prompt) yazın:\n\n_Örnek: ` + '`karlı dağlarda koşan sihirli beyaz kurt`_'
      });
      return;
    }

    // 2. Prompt verildi -> Kategori / Stil seçim aşamasına geç
    setPendingSelection(from, {
      type: 'ciz_flow',
      step: 'style',
      prompt: rawText,
      sender,
      createdAt: Date.now()
    });

    await sock.sendMessage(from, {
      text: getStyleMenuText(rawText)
    });
  }
};
