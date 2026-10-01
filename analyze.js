import fs from 'fs';

const html = fs.readFileSync('temp_wheremybus.html', 'utf8');

// Find script tags
const scripts = [];
const scriptMatches = html.match(/<script[^>]+src=["']([^"']+)["']/g) || [];
for (const s of scriptMatches) {
  const src = s.match(/src=["']([^"']+)["']/);
  if (src) scripts.push(src[1]);
}
console.log('Scripts:', scripts);

// Find AJAX / fetch / API endpoints
const urls = html.match(/https?:\/\/[^\s"']+/g) || [];
console.log('Unique external URLs:', [...new Set(urls)]);

// Find any form action, hidden inputs, or initial JSON embedded in page
const scriptContents = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
console.log('Inline script tags count:', scriptContents.length);
for (let i = 0; i < scriptContents.length; i++) {
  const content = scriptContents[i][1].trim();
  if (content.length > 50 && (content.includes('api') || content.includes('bus') || content.includes('data') || content.includes('Line') || content.includes('wheremybus'))) {
    console.log(`--- Script #${i} sample ---`);
    console.log(content.slice(0, 500));
  }
}
