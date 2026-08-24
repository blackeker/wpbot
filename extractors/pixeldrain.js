import axios from 'axios';
import path from 'path';

export async function extractPixeldrain(pageUrl) {
  try {
    // URL format: https://pixeldrain.com/u/FILE_ID or https://pixeldrain.com/l/LIST_ID
    const match = pageUrl.match(/\/u\/([a-zA-Z0-9]+)/);
    if (!match) {
      throw new Error('Geçersiz Pixeldrain URL formatı.');
    }

    const fileId = match[1];
    const infoUrl = `https://pixeldrain.com/api/file/${fileId}/info`;
    const directUrl = `https://pixeldrain.com/api/file/${fileId}`;

    let title = `Pixeldrain_${fileId}`;
    try {
      const infoRes = await axios.get(infoUrl);
      if (infoRes.data && infoRes.data.name) {
        title = infoRes.data.name;
      }
    } catch (e) {
      // Fail-safe title fallback
    }

    return {
      title,
      source: 'pixeldrain',
      url: directUrl,
      directUrl,
      fileId
    };
  } catch (err) {
    throw new Error(`Pixeldrain extraction error: ${err.message}`);
  }
}
