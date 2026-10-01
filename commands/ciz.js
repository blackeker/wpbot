import axios from 'axios';
import { translateToEnglish } from '../utils/translator.js';

const API_BASE = process.env.AI_IMAGE_API || 'http://111.235.150.203:5000';

const CATEGORY_MAP = {
  anime: {
    name: 'Anime & Manga',
    icon: '🌸',
    apiCat: 'anime',
    style: 'Painted Anime Plus',
    tags: 'masterpiece, best quality, ultra-detailed anime art, vibrant anime aesthetic, sharp focus, 8k resolution',
    neg: 'lowres, bad anatomy, bad hands, cropped, worst quality, low quality, blurry, text, watermark',
    models: ['Animagine XL', 'Anything Diffusion', 'Dreamshaper', 'Waifu Diffusion']
  },
  ghibli: {
    name: 'Studio Ghibli',
    icon: '🍃',
    apiCat: 'anime',
    style: 'Studio Ghibli',
    tags: 'ghibli style anime, hand-drawn anime aesthetic, lush landscape, soft atmospheric lighting, nostalgic studio ghibli masterpiece',
    neg: 'lowres, 3d, realistic, photo, bad quality, blurry, dark',
    models: ['Animagine XL', 'Dreamshaper', 'Anything Diffusion']
  },
  cyberpunk: {
    name: 'Siberpunk & Sci-Fi',
    icon: '🌃',
    apiCat: 'cyberpunk',
    style: 'Neon Vintage Anime',
    tags: 'cyberpunk aesthetic, neon lighting, futuristic sci-fi, dark rainy high-tech city, volumetric lighting, unreal engine 5, 8k',
    neg: 'lowres, bad anatomy, blurry, worst quality, low quality, oversaturated',
    models: ['Dreamshaper', 'Deliberate', 'ICBINP - I Cant Believe Its Not Photography', 'AlbedoBase XL']
  },
  siberpunk: {
    name: 'Siberpunk & Sci-Fi',
    icon: '🌃',
    apiCat: 'cyberpunk',
    style: 'Neon Vintage Anime',
    tags: 'cyberpunk aesthetic, neon lighting, futuristic sci-fi, dark rainy high-tech city, volumetric lighting, unreal engine 5, 8k',
    neg: 'lowres, bad anatomy, blurry, worst quality, low quality',
    models: ['Dreamshaper', 'Deliberate', 'AlbedoBase XL']
  },
  mecha: {
    name: 'Futuristic Mecha',
    icon: '🤖',
    apiCat: 'cyberpunk',
    style: 'Futuristic Mecha',
    tags: 'detailed futuristic mecha robot, high-tech armor, intricate mechanical joints, cinematic lighting',
    neg: 'lowres, bad anatomy, blurry, worst quality',
    models: ['Dreamshaper', 'Deliberate']
  },
  foto: {
    name: 'Fotogerçekçi & Portre',
    icon: '📸',
    apiCat: 'photorealistic',
    style: 'Professional Photo',
    tags: 'photorealistic portrait, 8k raw photo, highly detailed skin texture, 35mm lens, depth of field, studio lighting, award winning',
    neg: 'anime, drawing, cartoon, 3d, render, illustration, bad anatomy, blurry, low quality',
    models: ['ICBINP - I Cant Believe Its Not Photography', 'Deliberate', 'Dreamshaper']
  },
  portre: {
    name: 'Fotogerçekçi & Portre',
    icon: '📸',
    apiCat: 'photorealistic',
    style: 'Professional Photo',
    tags: 'photorealistic portrait, 8k raw photo, highly detailed skin texture, 35mm lens, depth of field, studio lighting',
    neg: 'anime, drawing, cartoon, 3d, render, bad anatomy, blurry, low quality',
    models: ['ICBINP - I Cant Believe Its Not Photography', 'Deliberate', 'Dreamshaper']
  },
  sinema: {
    name: 'Sinematik Film Sahnesi',
    icon: '🎬',
    apiCat: 'photorealistic',
    style: 'Cinematic',
    tags: 'cinematic film still, 35mm movie scene, realistic atmospheric lighting, color graded masterpiece, 8k raw',
    neg: 'anime, cartoon, drawing, painting, bad quality, blurry',
    models: ['ICBINP - I Cant Believe Its Not Photography', 'Deliberate', 'Dreamshaper']
  },
  '3d': {
    name: '3D Pixar & Disney',
    icon: '🎨',
    apiCat: 'digital_art',
    style: '3D Disney Character',
    tags: 'cute 3d render, pixar disney animation style, octane render, vivid colors, smooth surfaces, raytracing 4k',
    neg: 'flat, 2d, sketch, painting, bad render, blurry, distorted',
    models: ['Dreamshaper', 'Anything Diffusion', 'Deliberate']
  },
  pixar: {
    name: 'Pixar 3D',
    icon: '🎨',
    apiCat: 'digital_art',
    style: '3D Disney Character',
    tags: 'cute 3d render, pixar disney animation style, octane render, vivid colors, smooth surfaces, raytracing 4k',
    neg: 'flat, 2d, sketch, painting, bad render, blurry, distorted',
    models: ['Dreamshaper', 'Anything Diffusion', 'Deliberate']
  },
  pixel: {
    name: 'Pixel Art (16-bit)',
    icon: '👾',
    apiCat: 'pixel_art',
    style: 'Pixel Art (16-bit)',
    tags: '16-bit pixel art, retro gaming aesthetic, vibrant pixelated details, snes arcade pixel masterpiece',
    neg: 'photorealistic, 3d, modern render, blurry, smooth, gradient',
    models: ['Dreamshaper', 'Anything Diffusion']
  },
  fantastik: {
    name: 'Fantastik & RPG',
    icon: '🧙‍♂️',
    apiCat: 'fantasy',
    style: 'Fantasy Painting',
    tags: 'epic high fantasy digital art, mythical, magical atmosphere, detailed concept art, cinematic lighting, artstation',
    neg: 'low quality, modern, car, blurry, bad anatomy, lowres',
    models: ['Dreamshaper', 'Deliberate', 'Animagine XL']
  },
  lol: {
    name: 'League of Legends Art',
    icon: '⚔️',
    apiCat: 'fantasy',
    style: 'League of Legends',
    tags: 'league of legends splash art style, dynamic champion pose, magical glow, epic concept art masterpiece',
    neg: 'lowres, blurry, bad anatomy',
    models: ['Dreamshaper', 'Deliberate']
  },
  yagliboya: {
    name: 'Rönesans Yağlı Boya',
    icon: '🖼️',
    apiCat: 'oil_painting',
    style: 'Oil Painting',
    tags: 'renaissance classical oil painting on canvas, artistic textured brushstrokes, fine art masterpiece',
    neg: 'photo, 3d render, digital, bad art, low quality',
    models: ['Dreamshaper', 'Deliberate']
  },
  nsfw: {
    name: 'NSFW & Uncensored',
    icon: '🔞',
    apiCat: 'anime',
    style: 'Painted Anime Plus',
    tags: 'masterpiece, best quality, ultra-detailed, uncensored, expressive, vibrant lighting, highly detailed',
    neg: 'lowres, bad anatomy, bad hands, blurry, worst quality, low quality, censored, mosaic',
    models: ['Animagine XL', 'Anything Diffusion', 'Waifu Diffusion', 'Dreamshaper']
  },
  hentai: {
    name: 'Hentai & Ecchi',
    icon: '🔞',
    apiCat: 'anime',
    style: 'Painted Anime Plus',
    tags: 'masterpiece, best quality, uncensored anime, ecchi, detailed anime art, vibrant colors',
    neg: 'lowres, bad anatomy, bad hands, blurry, worst quality, low quality, censored, mosaic',
    models: ['Animagine XL', 'Anything Diffusion', 'Waifu Diffusion']
  },
  ecchi: {
    name: 'Ecchi & Waifu',
    icon: '💋',
    apiCat: 'anime',
    style: 'Painted Anime Plus',
    tags: 'masterpiece, best quality, beautiful waifu, ecchi aesthetic, detailed, vibrant',
    neg: 'lowres, bad anatomy, blurry, worst quality, low quality, censored',
    models: ['Animagine XL', 'Anything Diffusion', 'Waifu Diffusion']
  },
  waifu: {
    name: 'Anime Waifu',
    icon: '💖',
    apiCat: 'anime',
    style: 'Painted Anime Plus',
    tags: 'masterpiece, best quality, extremely beautiful waifu, glowing soft eyes, cute expression, highly detailed anime',
    neg: 'lowres, bad anatomy, blurry, worst quality, low quality',
    models: ['Animagine XL', 'Anything Diffusion', 'Dreamshaper']
  }
};

async function generateHordeDirect(prompt, categoryKey, width = 768, height = 512) {
  const cat = CATEGORY_MAP[categoryKey] || CATEGORY_MAP.anime;
  const fullPrompt = `${prompt}, ${cat.tags} ### ${cat.neg}`;
  const models = cat.models || ['Dreamshaper', 'Animagine XL', 'Deliberate'];

  const payload = {
    prompt: fullPrompt,
    params: {
      sampler_name: 'k_euler_a',
      cfg_scale: 7.5,
      width: width,
      height: height,
      steps: 22,
      n: 1
    },
    models: models,
    nsfw: true,
    censor_nsfw: false,
    shared: true
  };

  const res = await axios.post('https://aihorde.net/api/v2/generate/async', payload, {
    headers: {
      'apikey': '0000000000',
      'Client-Agent': 'wpbot:1.0'
    },
    timeout: 15000
  });

  const reqId = res.data?.id;
  if (!reqId) throw new Error('Horde görev ID oluşturamadı.');

  const startTime = Date.now();
  while (Date.now() - startTime < 75000) {
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
      if (!gen || !gen.img) throw new Error('Horde görsel verisi boş döndü.');

      let buffer;
      if (gen.img.startsWith('http')) {
        const imgDownload = await axios.get(gen.img, { responseType: 'arraybuffer', timeout: 20000 });
        buffer = Buffer.from(imgDownload.data);
      } else {
        buffer = Buffer.from(gen.img, 'base64');
      }

      return {
        buffer,
        model: gen.model || 'OmniArt SDXL Engine',
        elapsed: ((Date.now() - startTime) / 1000).toFixed(1)
      };
    }
  }

  throw new Error('Horde işlemi zaman aşımına uğradı.');
}

export default {
  name: 'ciz',
  aliases: ['çiz', 'resim', 'imagine', 'gorsel', 'görsel', 'airesim', 'aiciz', 'omniart'],
  async execute(sock, msg, from, args = [], ctx = {}) {
    if (!args || args.length === 0) {
      const help = 
`⚡ *OMNIART AI - GÖRSEL STÜDYOSU*
━━━━━━━━━━━━━━━━━━━━
Yapay zeka ile istediğiniz görseli oluşturmak için:

📌 *Popüler Stiller:*
• \`!ciz <açıklama>\` ➔ Standart Anime / Çizim
• \`!ciz anime <açıklama>\` ➔ 🌸 Painted Anime Plus
• \`!ciz ghibli <açıklama>\` ➔ 🍃 Studio Ghibli
• \`!ciz cyberpunk <açıklama>\` ➔ 🌃 Neon Siberpunk
• \`!ciz foto <açıklama>\` ➔ 📸 Professional Photo (8K)
• \`!ciz sinema <açıklama>\` ➔ 🎬 Sinematik 35mm Sahne
• \`!ciz 3d <açıklama>\` ➔ 🎨 3D Disney & Pixar
• \`!ciz pixel <açıklama>\` ➔ 👾 16-Bit Pixel Art
• \`!ciz lol <açıklama>\` ➔ ⚔️ League of Legends Splash Art
• \`!ciz fantastik <açıklama>\` ➔ 🧙‍♂️ Epik Fantastik / RPG
• \`!ciz yagliboya <açıklama>\` ➔ 🖼️ Rönesans Yağlı Boya
• \`!ciz nsfw <açıklama>\` ➔ 🔞 NSFW & Uncensored
• \`!ciz hentai <açıklama>\` ➔ 🔞 Hentai / Ecchi Anime

📐 *Boyut Seçenekleri (Opsiyonel):*
Açıklamanın içine \`dikey\` veya \`kare\` yazabilirsiniz.

💡 *Örnek:* \`!ciz anime karlı dağlarda koşan sihirli beyaz kedi\``;
      await sock.sendMessage(from, { text: help });
      return;
    }

    let rawText = args.join(' ').trim();

    // Boyut tespiti (Landscape 768x512, Square 512x512, Portrait 512x768)
    let shape = '768x512';
    let hordeW = 768, hordeH = 512;
    if (/\b(dikey|portrait|düşey)\b/i.test(rawText)) {
      shape = '512x768';
      hordeW = 512; hordeH = 768;
      rawText = rawText.replace(/\b(dikey|portrait|düşey)\b/ig, '').trim();
    } else if (/\b(kare|square)\b/i.test(rawText)) {
      shape = '512x512';
      hordeW = 512; hordeH = 512;
      rawText = rawText.replace(/\b(kare|square)\b/ig, '').trim();
    } else if (/\b(yatay|landscape)\b/i.test(rawText)) {
      shape = '768x512';
      hordeW = 768; hordeH = 512;
      rawText = rawText.replace(/\b(yatay|landscape)\b/ig, '').trim();
    }

    const words = rawText.split(/\s+/);
    const firstWord = words[0].toLowerCase().replace(/^[!#]/, '');
    let categoryKey = null;
    let userPrompt = '';

    if (CATEGORY_MAP[firstWord] && words.length > 1) {
      categoryKey = firstWord;
      userPrompt = words.slice(1).join(' ').trim();
    } else {
      userPrompt = rawText;
    }

    if (!userPrompt) {
      await sock.sendMessage(from, { text: '⚠️ Lütfen çizilmesini istediğiniz görseli açıklayın.\nÖrnek: `!ciz anime uzayda süzülen astronot kedi`' });
      return;
    }

    const catInfo = categoryKey ? CATEGORY_MAP[categoryKey] : CATEGORY_MAP.anime;
    const catName = `${catInfo.icon} ${catInfo.name}`;

    sock.sendPresenceUpdate('composing', from).catch(() => {});

    // Promptu Türkçeden İngilizceye otomatik çevir
    let englishPrompt = userPrompt;
    try {
      englishPrompt = await translateToEnglish(userPrompt);
    } catch (e) {
      englishPrompt = userPrompt;
    }

    let imageBuffer = null;
    let usedModel = 'OmniArt AI Engine';
    let elapsed = '0';

    // 1. OmniArt REST API v1 (http://111.235.150.203:5000/api/v1/generate)
    try {
      const apiRes = await axios.post(`${API_BASE}/api/v1/generate`, {
        prompt: englishPrompt,
        category: catInfo.apiCat,
        style: catInfo.style,
        provider: 'auto',
        shape: shape
      }, { timeout: 45000 });

      if (apiRes.data && apiRes.data.success && apiRes.data.url) {
        const fullImgUrl = apiRes.data.url.startsWith('http') 
          ? apiRes.data.url 
          : `${API_BASE}${apiRes.data.url}`;
        
        const imgDownload = await axios.get(fullImgUrl, { responseType: 'arraybuffer', timeout: 30000 });
        imageBuffer = Buffer.from(imgDownload.data);
        usedModel = `${(apiRes.data.provider || 'OmniArt').toUpperCase()} (${apiRes.data.style || catInfo.style})`;
        elapsed = apiRes.data.elapsed_seconds || '';
      }
    } catch (apiErr) {
      console.log(`[OMNIART REMOTE] Remote API (${apiErr.message}), yerel SDXL motoruna geçiliyor...`);
    }

    // 2. Fallback: Stable Horde Dağıtık AI Motoru
    if (!imageBuffer) {
      try {
        const result = await generateHordeDirect(englishPrompt, categoryKey || 'anime', hordeW, hordeH);
        imageBuffer = result.buffer;
        usedModel = result.model;
        elapsed = result.elapsed;
      } catch (hordeErr) {
        console.error('[OMNIART HORDE ERROR]:', hordeErr.message);
      }
    }

    if (!imageBuffer) {
      await sock.sendMessage(from, { text: '❌ Görsel üretilirken bir hata oluştu. Lütfen biraz sonra tekrar deneyin.' });
      return;
    }

    const isDifferent = englishPrompt.toLowerCase() !== userPrompt.toLowerCase();
    let caption = `⚡ *OmniArt AI Görseli Hazır!*\n━━━━━━━━━━━━━━━━━━━━\n📝 *İstem:* ${userPrompt}\n`;
    if (isDifferent) {
      caption += `🌐 *Çeviri:* _${englishPrompt}_\n`;
    }
    caption += `🎨 *Stil:* ${catName} (${shape})\n⚡ *Motor:* ${usedModel} (${elapsed}s)\n━━━━━━━━━━━━━━━━━━━━`;

    await sock.sendMessage(from, {
      image: imageBuffer,
      caption: caption.trim()
    });
  }
};
