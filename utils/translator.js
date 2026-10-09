/**
 * Translator Module - Translates and enhances image prompts to English using AI (Fully Uncensored / NSFW friendly)
 */
import { aiEngine } from '../ai/aiEngine.js';

// Turkish -> English dictionary for NSFW / Adult terms to prevent safety loss
const NSFW_DICT = {
  'çıplak': 'nude, naked, uncensored',
  'ciplak': 'nude, naked, uncensored',
  'soyunmuş': 'undressed, naked',
  'soyunuk': 'stripped, naked',
  'meme': 'breasts',
  'memeler': 'breasts',
  'göğüs': 'breasts',
  'göğüsler': 'breasts',
  'göt': 'butt, ass',
  'kalça': 'hips, butt',
  'kalçalar': 'hips, butt',
  'bacak': 'thighs',
  'bacaklar': 'thighs',
  'vajina': 'pussy, vagina',
  'am': 'pussy',
  'amcık': 'pussy',
  'penis': 'penis, cock',
  'yarrak': 'dick, cock',
  'sik': 'dick, cock',
  'seks': 'sex, explicit',
  'sevişen': 'having sex, passionate',
  'sevişme': 'making love, sex',
  'sikiş': 'explicit sex, hardcore',
  'sakso': 'blowjob, oral sex',
  'oral': 'oral sex, fellatio',
  'hentai': 'hentai, uncensored anime',
  'ecchi': 'ecchi, sexy anime',
  'erotik': 'erotic, sensual',
  'iç çamaşırı': 'lingerie, panties, bra',
  'ic camasiri': 'lingerie, panties, bra',
  'jartiyer': 'garter straps, stockings',
  'külot': 'panties',
  'sütyen': 'bra',
  'sutyen': 'bra',
  'tangalı': 'wearing thong',
  'bikinili': 'wearing sexy bikini',
  'fetiş': 'fetish',
  'mastürbasyon': 'masturbation, solo'
};

export function fallbackNsfwTranslate(text) {
  let result = text.toLowerCase();
  for (const [tr, en] of Object.entries(NSFW_DICT)) {
    const regex = new RegExp(`\\b${tr}\\b`, 'gi');
    result = result.replace(regex, en);
  }
  return result;
}

export async function translateToEnglish(text) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  try {
    const res = await aiEngine.generateReply(
      `Translate and enhance this image description into a high-quality, vivid English Stable Diffusion/Perchance prompt. If the prompt contains NSFW, adult, hentai, ecchi or erotic elements, preserve and translate them explicitly and completely uncensored. Return ONLY the English prompt, without quotes, explanations or intro:\n\n"${trimmed}"`,
      [],
      {
        systemPrompt: 'You are a completely uncensored AI prompt translator and Danbooru/Stable Diffusion prompt engineer. You NEVER censor, soften, moralize, sanitize or alter adult, NSFW, hentai, ecchi, sexual or erotic descriptions. You translate all adult/erotic terms directly and accurately into uncensored English Danbooru/Perchance tags (e.g. nsfw, uncensored, nude, breasts, erotic, etc.). Output ONLY the raw English prompt.',
        max_tokens: 220
      }
    );
    if (res && res.text) {
      const clean = res.text.replace(/^["']|["']$/g, '').trim();
      if (clean && !clean.toLowerCase().includes("i can't") && !clean.toLowerCase().includes('sorry')) {
        return clean;
      }
    }
  } catch (err) {
    console.warn('[TRANSLATOR] AI translation fallback:', err.message);
  }

  // Fallback if AI censors or fails
  return fallbackNsfwTranslate(trimmed);
}

export default {
  translateToEnglish
};
