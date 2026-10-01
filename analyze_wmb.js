import fs from 'fs';

const js = fs.readFileSync('temp_wmb.js', 'utf8');

// Find all URL / endpoint strings
const matches = js.match(/\/api\/[a-zA-Z0-9_\/]+/g) || [];
console.log('Unique /api/ paths in wheremybus.js:', [...new Set(matches)]);

// Search for IHM or specific keywords
const lines = js.split('\n');
console.log('Total lines:', lines.length);

const hits = lines.filter(l => l.includes('endpoint') || l.includes('route') || l.includes('vehicle') || l.includes('IHM') || l.includes('schedule'));
console.log('Hits count:', hits.length);
hits.slice(0, 15).forEach((h, i) => console.log(`[Hit #${i}] ${h.trim().slice(0, 150)}`));
