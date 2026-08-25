import { extractGenericWebpage } from './generic_webpage.js';

export async function extractXhamster(pageUrl) {
  return extractGenericWebpage(pageUrl, 'xHamster');
}
