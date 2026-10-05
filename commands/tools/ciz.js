import axios from 'axios';
import { pendingSelections } from '../../queue.js';

// Perchance AI API Endpoints (Local or Remote VPS)
const PERCHANCE_API_LIST = [
  'http://127.0.0.1:8000',
  process.env.PERCHANCE_AI_API,
  process.env.AI_IMAGE_API,
  'http://localhost:8000'
].filter(Boolean);

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
    pollinationsModel: 'flux-anime',
    negative: 'lowres, bad anatomy, bad hands, blurry, worst quality, low quality, distorted',
    tags: 'masterpiece, best quality, ultra-detailed anime art, vibrant anime aesthetic, sharp focus'
  },
  foto: {
    name: 'Fotogerçekçi Portre (8K)',
    icon: '📸',
    perchanceStyle: 'photorealistic',
    pollinationsModel: 'flux-realism',
    negative: 'anime, drawing, cartoon, 3d, render, illustration, bad anatomy, blurry, low quality',
    tags: 'photorealistic portrait, 8k raw photo, highly detailed skin texture, 35mm lens, depth of field, studio lighting, award winning'
  },
  sinema: {
    name: 'Sinematik Film Sahnesi',
    icon: '🎬',
    perchanceStyle: 'cinematic',
    pollinationsModel: 'flux-cablyai',
    negative: 'anime, cartoon, drawing, painting, bad quality, blurry',
    tags: 'cinematic film still, 35mm movie scene, realistic atmospheric lighting, color graded masterpiece, 8k raw'
  },
  dijital: {
    name: 'Modern Dijital Çizim',
    icon: '🎨',
    perchanceStyle: 'digital art',
    pollinationsModel: 'flux',
    negative: 'photo, realistic, bad drawing, blurry, low quality',
    tags: 'modern digital art illustration, clean lines, vibrant colors, trending on artstation'
  },
  cyberpunk: {
    name: 'Neon Siberpunk & Gelecek',
    icon: '🌃',
    perchanceStyle: 'cyberpunk',
    pollinationsModel: 'flux',
    negative: 'lowres, bad anatomy, blurry, worst quality, low quality, oversaturated',
    tags: 'cyberpunk aesthetic, neon lighting, futuristic sci-fi, dark rainy high-tech city, volumetric lighting, 8k'
  },
  yagliboya: {
    name: 'Klasik Yağlı Boya Tablo',
    icon: '🖼️',
    perchanceStyle: 'oil painting',
    pollinationsModel: 'flux',
    negative: 'photo, 3d render, digital, bad art, low quality',
    tags: 'renaissance classical oil painting on canvas, artistic textured brushstrokes, fine art masterpiece'
  },
  fantastik: {
    name: 'Büyülü Fantastik & RPG',
    icon: '🧙‍♂️',
    perchanceStyle: 'fantasy',
    pollinationsModel: 'flux',
    negative: 'low quality, modern, car, blurry, bad anatomy, lowres',
    tags: 'epic high fantasy digital art, mythical, magical glowing atmosphere, detailed concept art, cinematic lighting'
  },
  '3d': {
    name: '3D Disney / Pixar & Octane',
    icon: '👾',
    perchanceStyle: '3D render',
    pollinationsModel: 'flux-3d',
    negative: 'flat, 2d, sketch, painting, bad render, blurry, distorted',
    tags: 'cute 3d render, pixar disney animation style, octane render, vivid colors, smooth surfaces, raytracing 4k'
  },
  pixel: {
    name: '16-Bit Retro Pixel Art',
    icon: '🕹️',
    perchanceStyle: 'digital art',
    pollinationsModel: 'flux',
    negative: 'photorealistic, 3d, modern render, blurry, smooth, gradient',
    tags: '16-bit pixel art, retro gaming aesthetic, vibrant pixelated details, snes arcade pixel masterpiece'
  },
  nsfw: {
    name: 'NSFW & Hentai (Uncensored)',
    icon: '🔞',
    perchanceStyle: 'anime',
    pollinationsModel: 'flux-anime',
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
 * Generates an image using Pollinations AI (FLUX.1), Perchance AI API, or Stable Horde.
 */
export async function executeAiDraw(prompt, styleObj, shape = 'square') {
  let shapeLabel = '1:1 Kare';
  let width = 1024, height = 1024;
  if (shape === 'portrait') {
    shapeLabel = '9:16 Dikey';
    width = 576;
    height = 1024;
  } else if (shape === 'landscape') {
    shapeLabel = '16:9 Yatay';
    width = 1024;
    height = 576;
  }

  const rawPrompt = prompt ? prompt.trim() : '';

  // 1. Primary: Pollinations AI FLUX.1 (High-Definition, Fast & Anatomically Superior)
  try {
    const startTime = Date.now();
    const model = styleObj.pollinationsModel || (styleObj.perchanceStyle === 'anime' ? 'flux-anime' : 'flux');
    const enrichedPrompt = styleObj.tags ? `${rawPrompt}, ${styleObj.tags}` : rawPrompt;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(enrichedPrompt)}?width=${width}&height=${height}&model=${model}&nologo=true&seed=${Math.floor(Math.random() * 999999)}`;

    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 35000 });
    if (res.status === 200 && res.data && res.data.length > 1000) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      return { 
        buffer: Buffer.from(res.data), 
        engine: `FLUX.1 (${model})`, 
        elapsed, 
        shapeLabel
      };
    }
  } catch (err) {}

  // 2. Fallback: Perchance AI API (Local or Remote)
  for (const baseUrl of PERCHANCE_API_LIST) {
    try {
      const startTime = Date.now();
      const payload = {
        prompt: styleObj.tags ? `${rawPrompt}, ${styleObj.tags}` : rawPrompt,
        negative_prompt: styleObj.negative || 'blurry, low quality, bad anatomy, deformed hands, extra limbs',
        style: styleObj.perchanceStyle || 'anime',
        shape: shape,
        num_images: 1,
        response_format: 'url'
      };

      const res = await axios.post(`${baseUrl}/generate`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 45000
      });

      if (res.data && res.data.data && res.data.data[0]) {
        const item = res.data.data[0];
        let buffer = null;

        if (item.b64_json) {
          buffer = Buffer.from(item.b64_json, 'base64');
        } else if (item.url) {
          const imgUrl = item.url.startsWith('http') ? item.url : `${baseUrl}${item.url}`;
          const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 25000 });
          buffer = Buffer.from(imgRes.data);
        }

        if (buffer && buffer.length > 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          return { 
            buffer, 
            engine: `Perchance AI (${styleObj.perchanceStyle})`, 
            elapsed, 
            shapeLabel
          };
        }
      }
    } catch (err) {}
  }

  // 3. Fallback: Stable Horde SDXL
  try {
    const startTime = Date.now();
    let hordeWidth = 768, hordeHeight = 512;
    if (shape === 'portrait') { hordeWidth = 512; hordeHeight = 768; }
    else if (shape === 'square') { hordeWidth = 512; hordeHeight = 512; }

    const fullPrompt = styleObj.tags 
      ? `${rawPrompt}, ${styleObj.tags} ### ${styleObj.negative || 'lowres, bad quality, bad anatomy'}` 
      : `${rawPrompt} ### lowres, bad quality, bad anatomy`;

    const payload = {
      prompt: fullPrompt,
      params: { sampler_name: 'k_euler_a', cfg_scale: 7.5, width: hordeWidth, height: hordeHeight, steps: 20, n: 1 },
      models: ['Animagine XL', 'Dreamshaper', 'Deliberate', 'Anything Diffusion'],
      nsfw: true,
      censor_nsfw: false,
      shared: true
    };

    const res = await axios.post('https://aihorde.net/api/v2/generate/async', payload, {
      headers: { 'apikey': '0000000000', 'Client-Agent': 'wpbot:1.0' },
      timeout: 15000
    });

    const reqId = res.data?.id;
    if (reqId) {
      while (Date.now() - startTime < 60000) {
        await new Promise(r => setTimeout(r, 2500));
        const check = await axios.get(`https://aihorde.net/api/v2/generate/check/${reqId}`, {
          headers: { 'apikey': '0000000000', 'Client-Agent': 'wpbot:1.0' },
          timeout: 10000
        });

        if (check.data?.done) {
          const statusRes = await axios.get(`https://aihorde.net/api/v2/generate/status/${reqId}`, {
            headers: { 'apikey': '0000000000', 'Client-Agent': 'wpbot:1.0' },
            timeout: 15000
          });

          const gen = statusRes.data?.generations?.[0];
          if (gen && gen.img) {
            let buffer;
            if (gen.img.startsWith('http')) {
              const imgDl = await axios.get(gen.img, { responseType: 'arraybuffer', timeout: 20000 });
              buffer = Buffer.from(imgDl.data);
            } else {
              buffer = Buffer.from(gen.img, 'base64');
            }
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            return { 
              buffer, 
              engine: `Stable Horde (${gen.model || 'SDXL'})`, 
              elapsed, 
              shapeLabel
            };
          }
        }
      }
    }
  } catch (err) {}

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

    // 1. Eğer hiçbir prompt yazılmadıysa prompt girmesini iste
    if (!rawText) {
      pendingSelections[from] = {
        type: 'ciz_flow',
        step: 'prompt',
        sender,
        createdAt: Date.now()
      };
      await sock.sendMessage(from, {
        text: `🎨 *YAPAY ZEKA GÖRSEL STÜDYOSU*\n━━━━━━━━━━━━━━━━━━━━\n📝 Lütfen çizilmesini istediğiniz görseli açıklayan metni (istem / prompt) yazın:\n\n_Örnek: ` + '`karlı dağlarda koşan sihirli beyaz kurt`_'
      });
      return;
    }

    // 2. Prompt verildi -> Kategori / Stil seçim aşamasına geç
    pendingSelections[from] = {
      type: 'ciz_flow',
      step: 'style',
      prompt: rawText,
      sender,
      createdAt: Date.now()
    };

    await sock.sendMessage(from, {
      text: getStyleMenuText(rawText)
    });
  }
};
