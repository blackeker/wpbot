import axios from 'axios';

/**
 * Free & Instant Turkish to English Translator
 * @param {string} text - Turkish text to translate
 * @returns {Promise<string>} - Translated English text
 */
export async function translateToEnglish(text) {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  // 1. Primary: MyMemory Machine Translation
  try {
    const encoded = encodeURIComponent(trimmed);
    const res = await axios.get(`https://api.mymemory.translated.net/get?q=${encoded}&langpair=tr|en&de=admin@wpbot.org`, {
      timeout: 6000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    const translated = res.data?.responseData?.translatedText;
    if (translated && typeof translated === 'string' && !translated.toLowerCase().includes('quota exceeded') && !translated.toLowerCase().includes('invalid')) {
      return translated.trim();
    }
  } catch (err) {}

  // 2. Return original if API fails
  return trimmed;
}

export default {
  translateToEnglish
};
