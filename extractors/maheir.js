import { extractGenericWebpage } from './generic_webpage.js';

export async function extractMaheir(pageUrl) {
  return extractGenericWebpage(pageUrl, 'Maheir');
}
