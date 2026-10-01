import axios from 'axios';

async function testToken() {
  const client = axios.create({
    baseURL: 'https://elazigkart.elazig.bel.tr',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://elazigkart.elazig.bel.tr/wheremybus',
      'Origin': 'https://elazigkart.elazig.bel.tr'
    }
  });

  try {
    const res = await client.post('/api/access/token', {}, {
      validateStatus: () => true
    });
    console.log('Status:', res.status);
    console.log('Headers:', res.headers);
    console.log('Body:', res.data);
  } catch (e) {
    console.log('Err:', e.message);
  }
}

testToken();
