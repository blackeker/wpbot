import { extractGenericWebpage } from './generic_webpage.js';

export async function extractRule34Video(pageUrl) {
  return extractGenericWebpage(pageUrl, 'Rule34 Video');
}
