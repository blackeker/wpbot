import { extractGenericWebpage } from './generic_webpage.js';

export async function extractKalite18(pageUrl) {
  return extractGenericWebpage(pageUrl, 'Kalite18');
}
