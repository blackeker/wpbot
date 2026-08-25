import { extractGenericWebpage } from './generic_webpage.js';

export async function extractKoreanPornMovie(pageUrl) {
  return extractGenericWebpage(pageUrl, 'Korean Movies');
}
