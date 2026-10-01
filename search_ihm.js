import fs from 'fs';

const js = fs.readFileSync('temp_wmb.js', 'utf8');

// Search for IHM in js
const lines = js.split('\n');
const ihmHits = lines.filter(l => l.toLowerCase().includes('ihm'));
console.log('IHM hits count in wmb.js:', ihmHits.length);
ihmHits.forEach(h => console.log('IHM hit:', h.trim()));

// Also search in temp_wheremybus.html
const html = fs.readFileSync('temp_wheremybus.html', 'utf8');
const htmlIhm = html.split('\n').filter(l => l.toLowerCase().includes('ihm'));
console.log('IHM hits in html:', htmlIhm.length);
htmlIhm.forEach(h => console.log('HTML IHM:', h.trim()));
