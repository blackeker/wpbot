import axios from 'axios';
import fs from 'fs';

async function fetchWmbJs() {
  const res = await axios.get('https://elazigkart.elazig.bel.tr/js/wheremybus.js', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  fs.writeFileSync('temp_wmb.js', res.data);
  console.log('Saved temp_wmb.js, length:', res.data.length);
}
fetchWmbJs();
