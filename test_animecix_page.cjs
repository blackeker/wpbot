const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  try {
    const url = 'https://animecix.tv/titles/258/black-clover/season/1/episode/170';
    console.log('Fetching page with improved headers: ' + url);
    const res = await axios.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://animecix.tv/',
        'Cache-Control': 'max-age=0'
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
    console.log('Scripts contain "source":', scripts.includes('source'));
    console.log('Scripts contain "url":', scripts.includes('url'));

    console.log('\n--- Body Text Analysis ---');
    const body = $('body').text().substring(0, 500);
    console.log('Body start: ' + body);

  } catch(e) {
    console.error('Error status:', e.response?.status);
    console.error('Error message:', e.message);
  }
}

test();
