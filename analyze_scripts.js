import fs from 'fs';

const html = fs.readFileSync('temp_wheremybus.html', 'utf8');

const scriptContents = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
console.log('=== SCRIPT #9 (API Access / Token) ===');
console.log(scriptContents[9][1]);

console.log('=== SCRIPT #20 (WMB_CONFIG Endpoints) ===');
console.log(scriptContents[20][1]);
