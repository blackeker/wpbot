import fs from 'fs';

const js = fs.readFileSync('temp_wmb.js', 'utf8');

const lines = js.split('\n');
console.log('Finding loadRoutes and fetch implementations in wmb.js:');

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.includes('function loadRoutes') || l.includes('function fetchSchedule') || l.includes('function loadSchedule') || l.includes('function pollVehicles')) {
    console.log(`\n=== Found at line ${i} ===`);
    console.log(lines.slice(i, i + 35).join('\n'));
  }
}
