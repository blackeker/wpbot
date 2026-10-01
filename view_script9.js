import fs from 'fs';

const html = fs.readFileSync('temp_wheremybus.html', 'utf8');

const scriptContents = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
console.log('=== SCRIPT #8 ===');
console.log(scriptContents[8][1]);
console.log('=== SCRIPT #9 (COMPLETE) ===');
console.log(scriptContents[9][1]);
