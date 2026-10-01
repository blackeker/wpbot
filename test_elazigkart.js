import axios from 'axios';

async function testApi() {
  const client = axios.create({
    baseURL: 'https://elazigkart.elazig.bel.tr',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://elazigkart.elazig.bel.tr/wheremybus'
    },
    withCredentials: true
  });

  try {
    // 1. Get initial page to get cookies and headers
    const pageRes = await client.get('/wheremybus');
    console.log('Page status:', pageRes.status);
    const cookies = pageRes.headers['set-cookie'];
    console.log('Set-Cookies:', cookies);
    const apiToken = pageRes.headers['x-api-token'] || (cookies && cookies.find(c => c.includes('Api-Access'))?.split(';')[0]);
    console.log('Token / Cookie info:', apiToken);

    let cookieHeader = '';
    if (cookies) {
      cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');
    }

    // 2. Try fetching routes list
    const routesRes = await client.get('/api/wheremybus/routes', {
      headers: {
        'Cookie': cookieHeader,
        'X-Api-Token': pageRes.headers['x-api-token'] || ''
      }
    });

    console.log('Routes Status:', routesRes.status);
    console.log('Routes count:', Array.isArray(routesRes.data) ? routesRes.data.length : 'Not array');
    if (Array.isArray(routesRes.data)) {
      console.log('Sample routes (first 5):', routesRes.data.slice(0, 5));
    } else {
      console.log('Routes data sample:', routesRes.data);
    }
  } catch (err) {
    console.log('Error:', err.response ? `${err.response.status} - ${JSON.stringify(err.response.data)}` : err.message);
  }
}

testApi();
