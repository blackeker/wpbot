import axios from 'axios';

// Perchance AI API Endpoints (Local or Remote VPS)
const PERCHANCE_API_LIST = [
  'http://127.0.0.1:8000',
  process.env.PERCHANCE_AI_API,
  process.env.AI_IMAGE_API,
  'http://localhost:8000'
].filter(Boolean);

// Core 8 Perchance Styles + User Keywords Mapping
const STYLE_MAP = {
  // 1. Anime & Manga
  anime: {
    name: 'Anime & Manga',
    icon: '🌸',
    perchanceStyle: 'anime',
    pollinationsModel: 'flux-anime',
    negative: 'lowres, bad anatomy, bad hands, blurry, worst quality, low quality, distorted',
    tags: 'masterpiece, best quality, ultra-detailed anime art, vibrant anime aesthetic, sharp focus'
  },
  manga: {
    name: 'Anime & Manga',
    icon: '🌸',
    perchanceStyle: 'anime',
    pollinationsModel: 'flux-anime',
    negative: 'lowres, bad anatomy, blurry, worst quality',
    tags: 'masterpiece, ultra-detailed anime aesthetic'
  },
  ghibli: {
    name: 'Studio Ghibli Anime',
    icon: '🍃',
    perchanceStyle: 'anime',
    pollinationsModel: 'flux-anime',
    negative: 'lowres, 3d, realistic, bad quality, blurry',
    tags: 'studio ghibli style, hand-drawn anime aesthetic, lush landscape, soft atmospheric lighting, nostalgic'
  },
  waifu: {
    name: 'Anime Waifu',
    icon: '💖',
    perchanceStyle: 'anime',
    pollinationsModel: 'flux-anime',
    negative: 'lowres, bad anatomy, blurry, worst quality',
    tags: 'masterpiece, best quality, extremely beautiful waifu, glowing soft eyes, cute expression'
  },
  nsfw: {
    name: 'NSFW & Uncensored',
    icon: '🔞',
    perchanceStyle: 'anime',
    pollinationsModel: 'flux-anime',
    negative: 'lowres, bad anatomy, bad hands, blurry, worst quality, low quality, censored, mosaic',
    tags: 'masterpiece, best quality, ultra-detailed, uncensored, expressive, vibrant lighting'
  },
  hentai: {
    name: 'Hentai & Ecchi',
    icon: '🔞',
    perchanceStyle: 'anime',
    pollinationsModel: 'flux-anime',
    negative: 'lowres, bad anatomy, bad hands, blurry, worst quality, low quality, censored, mosaic',
    tags: 'masterpiece, best quality, uncensored anime, ecchi, detailed anime art, vibrant colors'
  },
  ecchi: {
    name: 'Ecchi & Waifu',
    icon: '💋',
    perchanceStyle: 'anime',
    pollinationsModel: 'flux-anime',
    negative: 'lowres, bad anatomy, blurry, worst quality, low quality, censored',
    tags: 'masterpiece, best quality, beautiful waifu, ecchi aesthetic, detailed'
  },

  // 2. Photorealistic & Portrait
  foto: {
    name: 'Fotogerçekçi & Portre',
    icon: '📸',
    perchanceStyle: 'photorealistic',
    pollinationsModel: 'flux-realism',
    negative: 'anime, drawing, cartoon, 3d, render, illustration, bad anatomy, blurry, low quality',
    tags: 'photorealistic portrait, 8k raw photo, highly detailed skin texture, 35mm lens, depth of field, studio lighting, award winning'
  },
  portre: {
    name: 'Fotogerçekçi Portre',
    icon: '📸',
    perchanceStyle: 'photorealistic',
    pollinationsModel: 'flux-realism',
    negative: 'anime, cartoon, drawing, 3d, render, bad anatomy, blurry, low quality',
    tags: 'photorealistic portrait, 8k raw photo, highly detailed skin texture, studio lighting'
  },
  photorealistic: {
    name: 'Fotogerçekçi (8K)',
    icon: '📸',
    perchanceStyle: 'photorealistic',
    pollinationsModel: 'flux-realism',
    negative: 'anime, drawing, cartoon, bad anatomy, blurry',
    tags: 'photorealistic, 8k resolution, raw photo, realistic lighting'
  },

  // 3. Cinematic
  sinema: {
    name: 'Sinematik Film Sahnesi',
    icon: '🎬',
    perchanceStyle: 'cinematic',
    pollinationsModel: 'flux-cablyai',
    negative: 'anime, cartoon, drawing, painting, bad quality, blurry',
    tags: 'cinematic film still, 35mm movie scene, realistic atmospheric lighting, color graded masterpiece, 8k raw'
  },
  cinematic: {
    name: 'Sinematik Sahne',
    icon: '🎬',
    perchanceStyle: 'cinematic',
    pollinationsModel: 'flux-cablyai',
    negative: 'anime, cartoon, drawing, bad quality, blurry',
    tags: 'cinematic lighting, dramatic atmosphere, color graded 8k movie still'
  },

  // 4. Digital Art & Illustration
  dijital: {
    name: 'Modern Dijital Çizim',
    icon: '🎨',
    perchanceStyle: 'digital art',
    pollinationsModel: 'flux',
    negative: 'photo, realistic, bad drawing, blurry, low quality',
    tags: 'modern digital art illustration, clean lines, vibrant colors, trending on artstation'
  },
  cizim: {
    name: 'Dijital İllüstrasyon',
    icon: '🎨',
    perchanceStyle: 'digital art',
    pollinationsModel: 'flux',
    negative: 'photo, realistic, bad drawing, blurry',
    tags: 'detailed digital illustration, artistic style, colorful masterpiece'
  },
  digital: {
    name: 'Digital Art',
    icon: '🎨',
    perchanceStyle: 'digital art',
    pollinationsModel: 'flux',
    negative: 'photo, blurry, low quality',
    tags: 'digital art masterpiece, high resolution concept art'
  },

  // 5. Cyberpunk & Sci-Fi
  cyberpunk: {
    name: 'Siberpunk & Neon Şehir',
    icon: '🌃',
    perchanceStyle: 'cyberpunk',
    pollinationsModel: 'flux',
    negative: 'lowres, bad anatomy, blurry, worst quality, low quality, oversaturated',
    tags: 'cyberpunk aesthetic, neon lighting, futuristic sci-fi, dark rainy high-tech city, volumetric lighting, 8k'
  },
  siberpunk: {
    name: 'Siberpunk & Sci-Fi',
    icon: '🌃',
    perchanceStyle: 'cyberpunk',
    pollinationsModel: 'flux',
    negative: 'lowres, bad anatomy, blurry, worst quality',
    tags: 'cyberpunk aesthetic, neon glowing lights, futuristic high-tech city, volumetric lighting'
  },
  mecha: {
    name: 'Futuristik Mecha Robot',
    icon: '🤖',
    perchanceStyle: 'cyberpunk',
    pollinationsModel: 'flux',
    negative: 'lowres, bad anatomy, blurry',
    tags: 'detailed futuristic mecha robot, high-tech armor, mechanical joints, cinematic neon lighting'
  },

  // 6. Oil Painting (Yağlı Boya)
  yagliboya: {
    name: 'Klasik Yağlı Boya Tablo',
    icon: '🖼️',
    perchanceStyle: 'oil painting',
    pollinationsModel: 'flux',
    negative: 'photo, 3d render, digital, bad art, low quality',
    tags: 'renaissance classical oil painting on canvas, artistic textured brushstrokes, fine art masterpiece'
  },
  oil: {
    name: 'Oil Painting',
    icon: '🖼️',
    perchanceStyle: 'oil painting',
    pollinationsModel: 'flux',
    negative: 'photo, 3d render, digital, blurry',
    tags: 'classical oil painting on canvas, artistic textured brushstrokes'
  },

  // 7. Fantasy & RPG
  fantastik: {
    name: 'Büyülü Fantastik & RPG',
    icon: '🧙‍♂️',
    perchanceStyle: 'fantasy',
    pollinationsModel: 'flux',
    negative: 'low quality, modern, car, blurry, bad anatomy, lowres',
    tags: 'epic high fantasy digital art, mythical, magical glowing atmosphere, detailed concept art, cinematic lighting'
  },
  fantasy: {
    name: 'Fantasy World',
    icon: '🧙‍♂️',
    perchanceStyle: 'fantasy',
    pollinationsModel: 'flux',
    negative: 'modern, blurry, bad anatomy',
    tags: 'epic high fantasy, magical atmosphere, detailed concept art'
  },
  lol: {
    name: 'League of Legends Art',
    icon: '⚔️',
    perchanceStyle: 'fantasy',
    pollinationsModel: 'flux',
    negative: 'lowres, blurry, bad anatomy',
    tags: 'league of legends splash art style, dynamic champion pose, magical glow, epic concept art masterpiece'
  },

  // 8. 3D Render & Disney / Pixar
  '3d': {
    name: '3D Pixar & Disney Animation',
    icon: '👾',
    perchanceStyle: '3D render',
    pollinationsModel: 'flux-3d',
    negative: 'flat, 2d, sketch, painting, bad render, blurry, distorted',
    tags: 'cute 3d render, pixar disney animation style, octane render, vivid colors, smooth surfaces, raytracing 4k'
  },
  pixar: {
    name: 'Pixar & 3D Character',
    icon: '👾',
    perchanceStyle: '3D render',
    pollinationsModel: 'flux-3d',
    negative: 'flat, 2d, sketch, painting, bad render, blurry',
    tags: '3d render, pixar disney character animation, unreal engine 5, octane render, vivid colors'
  },
  render: {
    name: '3D Octane Render',
    icon: '👾',
    perchanceStyle: '3D render',
    pollinationsModel: 'flux-3d',
    negative: 'flat, 2d, bad render, blurry',
    tags: 'unreal engine 5, octane 3d render, smooth surfaces, raytracing 8k'
  },

  // 9. Pixel Art (16-bit)
  pixel: {
    name: '16-Bit Pixel Art',
    icon: '🕹️',
    perchanceStyle: 'digital art',
    pollinationsModel: 'flux',
    negative: 'photorealistic, 3d, modern render, blurry, smooth, gradient',
    tags: '16-bit pixel art, retro gaming aesthetic, vibrant pixelated details, snes arcade pixel masterpiece'
  }
};

/**
 * Generates an image using the Perchance AI Image Generator REST API.
 */
async function generateWithPerchanceAPI(prompt, styleObj, shape = 'square') {
  for (const baseUrl of PERCHANCE_API_LIST) {
    try {
      const startTime = Date.now();
      const payload = {
        prompt: styleObj.tags ? `${prompt}, ${styleObj.tags}` : prompt,
        negative_prompt: styleObj.negative || 'blurry, low quality, bad anatomy',
        style: styleObj.perchanceStyle || 'anime',
        shape: shape, // "square" | "portrait" | "landscape"
        num_images: 1,
        response_format: 'url'
      };

      const res = await axios.post(`${baseUrl}/generate`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 75000 // Average generation is 15-25s
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
            engine: `Perchance AI Engine (${styleObj.perchanceStyle})`,
            elapsed
          };
        }
      }
    } catch (err) {
      console.warn(`[PERCHANCE API] Error connecting to ${baseUrl}:`, err.response?.data?.detail || err.message);
    }
  }

  return null;
}

/**
 * Fallback 1: High-Speed Pollinations Engine
 */
async function generateWithPollinations(prompt, styleObj, shape = 'square') {
  try {
    const startTime = Date.now();
    let width = 768, height = 768;
    if (shape === 'portrait') { width = 576; height = 1024; }
    else if (shape === 'landscape') { width = 1024; height = 576; }

    const model = styleObj.pollinationsModel || (styleObj.perchanceStyle === 'anime' ? 'flux-anime' : 'flux');
    const enrichedPrompt = styleObj.tags ? `${prompt}, ${styleObj.tags}` : prompt;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(enrichedPrompt)}?width=${width}&height=${height}&model=${model}&nologo=true&seed=${Math.floor(Math.random() * 999999)}`;

    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    if (res.status === 200 && res.data) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      return {
        buffer: Buffer.from(res.data),
        engine: `Pollinations AI (${model})`,
        elapsed
      };
    }
  } catch (err) {
    console.warn('[POLLINATIONS FALLBACK] Error:', err.message);
  }
  return null;
}

/**
 * Fallback 2: Stable Horde Distributed SDXL Engine
 */
async function generateWithStableHorde(prompt, styleObj, shape = 'square') {
  try {
    const startTime = Date.now();
    let width = 768, height = 512;
    if (shape === 'portrait') { width = 512; height = 768; }
    else if (shape === 'square') { width = 512; height = 512; }

    const fullPrompt = styleObj.tags 
      ? `${prompt}, ${styleObj.tags} ### ${styleObj.negative || 'lowres, bad quality'}` 
      : `${prompt} ### lowres, bad quality`;

    const payload = {
      prompt: fullPrompt,
      params: {
        sampler_name: 'k_euler_a',
        cfg_scale: 7.5,
        width,
        height,
        steps: 20,
        n: 1
      },
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
    if (!reqId) return null;

    while (Date.now() - startTime < 65000) {
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
        if (!gen || !gen.img) return null;

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
          elapsed
        };
      }
    }
  } catch (err) {
    console.warn('[HORDE FALLBACK] Error:', err.message);
  }
  return null;
}

export default {
  name: 'ciz',
  aliases: ['çiz', 'resim', 'imagine', 'gorsel', 'görsel', 'airesim', 'aiciz', 'omniart', 'perchance'],
  description: 'Perchance AI motoru ile yüksek kaliteli görsel oluşturur',
  async execute(sock, msg, from, args = [], ctx = {}) {
    if (from.endsWith('@g.us')) {
      await sock.sendMessage(from, { 
        text: '❌ Bu komut gruplarda kullanılamaz. Lütfen özel mesaj (DM) üzerinden kullanın.' 
      });
      return;
    }

    if (!args || args.length === 0) {
      const help = 
`⚡ *PERCHANCE AI - GÖRSEL STÜDYOSU*
━━━━━━━━━━━━━━━━━━━━
Yapay zeka ile dilediğiniz görseli oluşturmak için:

🎨 *Desteklenen Sanat Tarzları:*
• \`!ciz <açıklama>\` ➔ Standart Anime / Çizim
• \`!ciz anime <açıklama>\` ➔ 🌸 Anime & Manga (Makoto Shinkai / Ghibli)
• \`!ciz foto <açıklama>\` ➔ 📸 Fotogerçekçi 8K Portre
• \`!ciz sinema <açıklama>\` ➔ 🎬 Sinematik Film Sahnesi Aydınlatması
• \`!ciz dijital <açıklama>\` ➔ 🎨 Modern Dijital İllüstrasyon
• \`!ciz cyberpunk <açıklama>\` ➔ 🌃 Neon Siberpunk & Gelecek
• \`!ciz yagliboya <açıklama>\` ➔ 🖼️ Klasik Yağlı Boya Tablo
• \`!ciz fantastik <açıklama>\` ➔ 🧙‍♂️ Büyülü Fantastik Konsept / RPG
• \`!ciz 3d <açıklama>\` ➔ 👾 3D Disney & Pixar / Octane Render
• \`!ciz pixel <açıklama>\` ➔ 🕹️ 16-Bit Retro Pixel Art
• \`!ciz nsfw <açıklama>\` ➔ 🔞 NSFW & Hentai (Uncensored)

📐 *En-Boy Oranı (Opsiyonel):*
Mesajınızın içine \`kare\` (1:1), \`dikey\` (9:16) veya \`yatay\` (16:9) ekleyebilirsiniz.

💡 *Örnekler:*
• \`!ciz anime karlı dağlarda koşan sihirli beyaz kedi dikey\`
• \`!ciz foto yağmur altında yürüyen şemsiyeli kadın portresi\`
• \`!ciz cyberpunk neon ışıklı fütüristik spor araba yatay\``;
      await sock.sendMessage(from, { text: help });
      return;
    }

    let rawText = args.join(' ').trim();

    // 1. En-Boy Oranı Tespiti (square, portrait, landscape)
    let shape = 'square';
    let shapeLabel = '1:1 Kare';

    if (/\b(dikey|portrait|düşey|9:16|hikaye|story)\b/i.test(rawText)) {
      shape = 'portrait';
      shapeLabel = '9:16 Dikey';
      rawText = rawText.replace(/\b(dikey|portrait|düşey|9:16|hikaye|story)\b/ig, '').trim();
    } else if (/\b(yatay|landscape|genis|geniş|16:9)\b/i.test(rawText)) {
      shape = 'landscape';
      shapeLabel = '16:9 Yatay';
      rawText = rawText.replace(/\b(yatay|landscape|genis|geniş|16:9)\b/ig, '').trim();
    } else if (/\b(kare|square|1:1)\b/i.test(rawText)) {
      shape = 'square';
      shapeLabel = '1:1 Kare';
      rawText = rawText.replace(/\b(kare|square|1:1)\b/ig, '').trim();
    }

    // 2. Stil Tespiti
    const words = rawText.split(/\s+/);
    const firstWord = words[0].toLowerCase().replace(/^[!#]/, '');
    let styleKey = 'anime';
    let userPrompt = '';

    if (STYLE_MAP[firstWord] && words.length > 1) {
      styleKey = firstWord;
      userPrompt = words.slice(1).join(' ').trim();
    } else {
      userPrompt = rawText;
    }

    if (!userPrompt) {
      await sock.sendMessage(from, { 
        text: '⚠️ Lütfen çizilmesini istediğiniz görseli açıklayın.\nÖrnek: `!ciz anime uzayda süzülen astronot kedi`' 
      });
      return;
    }

    const selectedStyle = STYLE_MAP[styleKey] || STYLE_MAP.anime;
    sock.sendPresenceUpdate('composing', from).catch(() => {});

    // 3. Görsel Üretimi (3 Kademeli Kusursuz Mimari)
    // Aşama 1: Perchance AI API (Port 8000)
    let result = await generateWithPerchanceAPI(userPrompt, selectedStyle, shape);

    // Aşama 2: Hızlı Pollinations Flux Motoru
    if (!result) {
      console.log('[CIZ] Perchance API yanıt vermedi veya meşgul, Pollinations AI motoruna geçiliyor...');
      result = await generateWithPollinations(userPrompt, selectedStyle, shape);
    }

    // Aşama 3: Stable Horde Dağıtık SDXL
    if (!result) {
      console.log('[CIZ] Pollinations yanıt vermedi, Stable Horde motoruna geçiliyor...');
      result = await generateWithStableHorde(userPrompt, selectedStyle, shape);
    }

    if (!result || !result.buffer) {
      await sock.sendMessage(from, { 
        text: '❌ Görsel üretilirken tüm AI motorları zaman aşımına uğradı. Lütfen birkaç saniye sonra tekrar deneyin.' 
      });
      return;
    }

    // 4. WhatsApp Mesajı Oluşturma ve Gönderme
    let caption = `✨ *Görsel Hazır!*\n━━━━━━━━━━━━━━━━━━━━\n📝 *İstem:* ${userPrompt}\n🎨 *Stil:* ${selectedStyle.icon} ${selectedStyle.name}\n📐 *Boyut:* ${shapeLabel}\n⚡ (${result.elapsed}s)\n━━━━━━━━━━━━━━━━━━━━`;

    await sock.sendMessage(from, {
      image: result.buffer,
      caption: caption.trim()
    });
  }
};
