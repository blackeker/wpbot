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

  // If already mostly English / Latin characters without Turkish specific letters, still attempt translation
  
  // 1. Primary: MyMemory Free Translation API
  try {
    const encoded = encodeURIComponent(trimmed);
    const res = await axios.get(`https://api.mymemory.translated.net/get?q=${encoded}&langpair=tr|en`, {
      timeout: 6000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    const translated = res.data?.responseData?.translatedText;
    if (translated && typeof translated === 'string' && !translated.toLowerCase().includes('quota exceeded') && !translated.toLowerCase().includes('invalid')) {
      return translated.trim();
    }
  } catch (err) {
    // Continue to fallback
  }

  // 2. Fallback: Google Translate Web Mobile Engine
  try {
    const encoded = encodeURIComponent(trimmed);
    const res = await axios.get(`https://translate.google.com/m?sl=auto&tl=en&q=${encoded}`, {
      timeout: 6000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15'
      }
    });

    const match = res.data.match(/<div class="result-container">([^<]+)<\/div>/i);
    if (match && match[1]) {
      // Decode HTML entities
      const decoded = match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return decoded.trim();
    }
  } catch (err) {
    // Continue to fallback
  }

  // 3. Fallback: Return original text if translation fails
  return trimmed;
}

export default {
  translateToEnglish
};
