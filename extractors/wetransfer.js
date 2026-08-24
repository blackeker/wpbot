import axios from 'axios';

export async function extractWeTransfer(pageUrl) {
  try {
    const response = await axios.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      maxRedirects: 5
    });

    const redirectUrl = response.request.res.responseUrl || pageUrl;
    const match = redirectUrl.match(/downloads\/([a-zA-Z0-9]+)\/([a-zA-Z0-9]+)/);

    if (!match) {
      throw new Error('WeTransfer indirme ID bilgisi saptanamadı.');
    }

    const [_, transferId, securityHash] = match;
    const apiRes = await axios.post(`https://wetransfer.com/api/v4/transfers/${transferId}/download`, {
      security_hash: securityHash
    }, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/json'
      }
    });

    if (apiRes.data && apiRes.data.direct_link) {
      return {
        title: apiRes.data.name || `WeTransfer_${transferId}`,
        source: 'wetransfer',
        url: apiRes.data.direct_link,
        directUrl: apiRes.data.direct_link
      };
    }

    throw new Error('WeTransfer doğrudan indirme bağlantısı oluşturamadı.');
  } catch (err) {
    throw new Error(`WeTransfer extraction error: ${err.message}`);
  }
}
