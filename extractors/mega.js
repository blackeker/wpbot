import { File } from 'megajs';

export async function extractMega(pageUrl) {
  console.log(`[Mega Extractor] Resolving URL: ${pageUrl}`);
  try {
    const file = File.fromURL(pageUrl);
    await file.loadAttributes();
    
    return {
      title: file.name || 'mega_file',
      url: pageUrl, // Handled internally by downloader.js downloadMegaFile
      referer: 'https://mega.nz/',
      source: 'Mega'
    };
  } catch (err) {
    console.error(`[Mega Extractor] Failed to resolve Mega file: ${err.message}`);
    throw err;
  }
}
