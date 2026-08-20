const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'extractor.js');
let srcContent = fs.readFileSync(srcPath, 'utf8');

const modules = {
  animecix: ['extractAnimecix', 'resolveAnimecixSlug', 'resolveTauVideo', 'resolveSibNet', 'resolveOkRu', 'pickBestQuality', 'getAnimecixSeasonEpisodes'],
  hentaizm: ['extractHentaizm', 'resolvePlayerIframe', 'resolvePlayerAjax', 'decryptHentaizmString', 'cleanHentaizmTitle', 'initiateHentaizmLogin'],
  doeda: ['extractDoeda'],
  hdabla: ['extractHdabla'],
  hdkore: ['extractHdkore', 'extractHdkorePuppeteer', 'getHdkoreSeasonEpisodes', 'decryptDramaizle'],
  pornhub: ['extractPornhub'],
  turkifsahub: ['extractTurkifsahub'],
  turkifsalar: ['extractTurkifsalar'],
  turkporno: ['extractTurkporno', 'veevDecode', 'buildArray', 'hexToString', 'decodeUrl', 'resolveTurkPornoEmbed'],
  cloudmailru: ['extractCloudMailRu'],
  ninemod: ['extract9Mod'],
  itch: ['extractItch'],
  hdfilmcehennemi: ['getHdfilmcehennemiSeasonEpisodes']
};

const commonHelpers = ['gotScraping', 'sleep', 'tryDecrypt', 'dcHello', 'getAndUnpack', 'rot13Str', 'rot13Buffer', 'unmix'];

function extractFunction(name, content) {
  const regex = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\([^{]*{`, 'g');
  const match = regex.exec(content);
  if (!match) {
    return null;
  }
  
  let startIndex = match.index;
  let i = startIndex + match[0].length;
  let braceCount = 1;
  let inString = false;
  let stringChar = '';
  let inComment = false;
  let inMultiComment = false;
  
  while (i < content.length && braceCount > 0) {
    const char = content[i];
    const nextChar = content[i+1];
    
    if (inString) {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === stringChar) {
        inString = false;
      }
    } else if (inComment) {
      if (char === '\n') {
        inComment = false;
      }
    } else if (inMultiComment) {
      if (char === '*' && nextChar === '/') {
        inMultiComment = true;
        i += 2;
        continue;
      }
    } else {
      if (char === '"' || char === "'" || char === '`') {
        inString = true;
        stringChar = char;
      } else if (char === '/' && nextChar === '/') {
        inComment = true;
        i++;
      } else if (char === '/' && nextChar === '*') {
        inMultiComment = true;
        i++;
      } else if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
      }
    }
    i++;
  }
  
  return {
    code: content.substring(startIndex, i),
    startIndex,
    endIndex: i
  };
}

let newSrcContent = srcContent;
let imports = [];

for (const [moduleName, funcs] of Object.entries(modules)) {
  let moduleCode = `import { ${commonHelpers.join(', ')} } from '../extractor.js';\n\n`;
  if (moduleName === 'hdfilmcehennemi') {
    // Add mainUrl if it exists in extractor.js
    const mainUrlMatch = srcContent.match(/const mainUrl\s*=\s*['"][^'"]+['"];/);
    if (mainUrlMatch) {
       moduleCode += mainUrlMatch[0] + '\n\n';
       newSrcContent = newSrcContent.replace(mainUrlMatch[0], '');
    } else {
       moduleCode += "const mainUrl = 'https://www.hdfilmcehennemi.us';\n\n";
    }
  }

  let exportedFuncs = [];

  for (const func of funcs) {
    const extracted = extractFunction(func, newSrcContent);
    if (extracted) {
      let fCode = extracted.code;
      // ensure it's exported in the new module
      if (!fCode.startsWith('export ')) {
         fCode = 'export ' + fCode;
      }
      moduleCode += fCode + '\n\n';
      
      // replace with empty string
      newSrcContent = newSrcContent.substring(0, extracted.startIndex) + newSrcContent.substring(extracted.endIndex);
      exportedFuncs.push(func);
    } else {
      console.log('Not found:', func);
    }
  }

  if (exportedFuncs.length > 0) {
    imports.push(`export { ${exportedFuncs.join(', ')} } from './extractors/${moduleName}.js';`);
  }

  const modulePath = path.join(__dirname, 'extractors', `${moduleName}.js`);
  fs.writeFileSync(modulePath, moduleCode);
}

// Add common helper exports to extractor.js
for (const helper of commonHelpers) {
  // convert `function helper(` to `export function helper(` if not exported
  const regex = new RegExp(`function\\s+${helper}\\s*\\(`, 'g');
  newSrcContent = newSrcContent.replace(regex, (match) => {
    return 'export ' + match;
  });
  
  const regexAsync = new RegExp(`async\\s+function\\s+${helper}\\s*\\(`, 'g');
  newSrcContent = newSrcContent.replace(regexAsync, (match) => {
    return 'export ' + match;
  });
  
  const regexConst = new RegExp(`const\\s+${helper}\\s*=`, 'g');
  newSrcContent = newSrcContent.replace(regexConst, (match) => {
    return 'export ' + match;
  });
}

// Ensure gotScraping is exported if imported
newSrcContent = newSrcContent.replace(/import\s*{\s*gotScraping\s*}\s*from/g, 'export { gotScraping } from');
// Wait, we can just export commonHelpers at the end.
newSrcContent += `\n\n// Modular extractors exports\n` + imports.join('\n') + '\n';

fs.writeFileSync(srcPath, newSrcContent);
console.log('Done!');
