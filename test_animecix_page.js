const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  try {
    const url = 'https://animecix.tv/titles/258/black-clover/season/1/episode/170';
    console.log('Fetching page: ' + url);
    const res = await axios.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
      } 
    });
    const $ = cheerio.load(res.data);
    
    console.log('Page title:', $('title').text());
    
    console.log('\n--- Iframes ---');
    $('iframe').each((i, el) => {
      console.log(`Iframe ${i} src:`, $(el).attr('src'));
    });
    
    console.log('\n--- Scripts Check ---');
    const scripts = $('script').text();
    if (scripts.includes('source') || scripts.includes('url')) {
      console.log('Found potential video references in scripts.');
    } else {
      console.log('No obvious video references in scripts.');
    }

    console.log('\n--- Body Text Analysis ---');
    const body = $('body').text().substring(0, 500);
    console.log('Body start: ' + body);

  } catch(e) {
    console.error('Error:', e.message);
  }
}

test();
