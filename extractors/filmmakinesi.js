import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { gotScraping } from '../extractor.js';
import * as cheerio from 'cheerio';
import vm from 'vm';

puppeteer.use(StealthPlugin());

// Unpacker logic for eval-packed JS
function getAndUnpack(script) {
  const match = script.match(/eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?return p\}[\s\S]*?\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!match) return script;
  let [_, p, a, c, k] = match;
  a = parseInt(a, 10);
  c = parseInt(c, 10);
  k = k.split('|');
  const e = c => {
    const r = c % a;
    const digit = r > 35 ? String.fromCharCode(r + 29) : r.toString(36);
    return (c < a ? '' : e(Math.floor(c / a))) + digit;
  };
  const d = {};
  for (let i = 0; i < k.length; i++) {
    if (k[i]) {
      d[e(i)] = k[i];
    }
  }
  return p.replace(/\b[0-9a-zA-Z_]+\b/g, w => d[w] || w);
}

function extractFunctionBlock(html, startSearchIndex) {
  let openBraceIndex = html.indexOf('{', startSearchIndex);
  if (openBraceIndex === -1) return null;
  
  let braceCount = 1;
  let index = openBraceIndex + 1;
  while (index < html.length && braceCount > 0) {
    const char = html[index];
    if (char === '{') {
      braceCount++;
    } else if (char === '}') {
      braceCount--;
    }
    index++;
  }
  if (braceCount === 0) {
    return html.substring(startSearchIndex, index);
  }
  return null;
}

function decryptSource(html) {
  // Find all named function definitions: function name(args) {
  const funcMatches = [];
  const regex = /function\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    funcMatches.push({
      name: m[1],
      index: m.index
    });
  }
  
  let searchIdx = 0;
  while (true) {
    const unmixIdx = html.indexOf('unmix', searchIdx);
    if (unmixIdx === -1) break;
    
    // Find the closest preceding named function
    let bestFunc = null;
    for (const f of funcMatches) {
      if (f.index < unmixIdx) {
        if (!bestFunc || f.index > bestFunc.index) {
          bestFunc = f;
        }
      }
    }
    
    if (!bestFunc) {
      searchIdx = unmixIdx + 5;
      continue;
    }
    
    const funcCode = extractFunctionBlock(html, bestFunc.index);
    if (!funcCode) {
      searchIdx = unmixIdx + 5;
      continue;
    }
    
    const funcName = bestFunc.name;
    
    // Search the WHOLE html for the variable calling this function
    const varRegex = new RegExp(`(?:var|let|const|\\s|^)(s_\\w+)\\s*=\\s*${funcName}\\s*\\((\\[[\\s\\S]*?\\])\\)`);
    const varMatch = html.match(varRegex);
    if (varMatch) {
      const varName = varMatch[1];
      const arrayArg = varMatch[2];
      
      const codeToRun = `${funcCode}\nvar decrypted = ${funcName}(${arrayArg});`;
      try {
        const sandbox = {
          atob: (str) => Buffer.from(str, 'base64').toString('binary'),
          btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
          console
        };
        vm.createContext(sandbox);
        vm.runInContext(codeToRun, sandbox);
        if (sandbox.decrypted) {
          return sandbox.decrypted;
        }
      } catch (e) {
        // Fail silently
      }
    }
    searchIdx = unmixIdx + 5;
  }
  return null;
}

export async function extractFilmMakinesi(pageUrl) {
  console.log(`[FilmMakinesi] Launching browser to scrape: ${pageUrl}`);
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    const rawTitle = await page.title();
    const title = rawTitle.replace(/ - Film Makinesi.*/i, '').trim();

    // Extract alternative embed/player links
    const embedUrls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.video-parts a, [data-video_url]'))
        .map(a => a.getAttribute('data-video_url') || a.href)
        .filter(url => url && (url.includes('embed') || url.includes('player')));
    });

    console.log(`[FilmMakinesi] Title: ${title}, Found ${embedUrls.length} embeds.`);
    await browser.close();
    browser = null;

    if (embedUrls.length === 0) {
      throw new Error('Film Makinesi alternatif player linkleri bulunamadı.');
    }

    // Try each embed URL in order of preference (Rapid first, then Closeload, etc.)
    const sortedEmbeds = embedUrls.sort((a, b) => {
      const rankA = a.includes('rapid') ? 1 : a.includes('closeload') ? 2 : 3;
      const rankB = b.includes('rapid') ? 1 : b.includes('closeload') ? 2 : 3;
      return rankA - rankB;
    });

    for (const embedUrl of sortedEmbeds) {
      try {
        console.log(`[FilmMakinesi] Resolving embed: ${embedUrl}`);
        const res = await gotScraping({
          url: embedUrl,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': pageUrl
          }
        });

        const $ = cheerio.load(res.body);
        let unpackedHtml = '';
        $('script').each((_, el) => {
          const html = $(el).html() || '';
          if (html.includes('eval(function')) {
            unpackedHtml += '\n' + getAndUnpack(html);
          } else {
            unpackedHtml += '\n' + html;
          }
        });

        // Unescape backslashes for VM context script compatibility
        unpackedHtml = unpackedHtml.replace(/\\'/g, "'").replace(/\\"/g, '"');

        const decryptedUrl = decryptSource(unpackedHtml);
        if (decryptedUrl) {
          console.log(`[FilmMakinesi] Decrypted stream URL: ${decryptedUrl}`);
          
          // Extract subtitle URL
          let subtitleUrl = null;
          try {
            const tracksMatch = unpackedHtml.match(/tracks\s*:\s*(\[[\s\S]*?\])/) || res.body.match(/tracks\s*:\s*(\[[\s\S]*?\])/);
            if (tracksMatch) {
              const tracksStr = tracksMatch[1];
              // Try to find the file corresponding to Turkish subtitle
              const trMatch = tracksStr.match(/"file"\s*:\s*"([^"]+)"[^}]*(?:tr|turkish|türkçe)/i) || 
                              tracksStr.match(/"file"\s*:\s*"([^"]+tr[^"]+)"/i) ||
                              tracksStr.match(/"file"\s*:\s*"([^"]+)"[^}]*default_ses_durum/i);
              
              if (trMatch) {
                const subFile = trMatch[1].replace(/\\/g, '');
                subtitleUrl = new URL(subFile, embedUrl).href;
                console.log(`[FilmMakinesi] Found Turkish Subtitle URL: ${subtitleUrl}`);
              }
            }
          } catch (subErr) {
            console.error('[FilmMakinesi] Subtitle extraction failed:', subErr.message);
          }

          return {
            title,
            source: 'filmmodu',
            url: decryptedUrl,
            directUrl: decryptedUrl,
            isHls: decryptedUrl.includes('m3u8'),
            subtitleUrl
          };
        }
      } catch (err) {
        console.error(`[FilmMakinesi] Error resolving embed ${embedUrl}:`, err.message);
      }
    }

    throw new Error('Film Makinesi video bağlantıları çözülemedi.');
  } catch (err) {
    if (browser) await browser.close();
    throw new Error(`FilmMakinesi extraction error: ${err.message}`);
  }
}
