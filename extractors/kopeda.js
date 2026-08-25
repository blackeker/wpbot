import { extractGenericWebpage } from './generic_webpage.js';

export async function extractKopeda(pageUrl) {
  return extractGenericWebpage(pageUrl, 'Kopeda');
}
