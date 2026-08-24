import path from 'path';

export async function extractDropbox(pageUrl) {
  try {
    let directUrl = pageUrl;
    if (directUrl.includes('dl=0')) {
      directUrl = directUrl.replace('dl=0', 'dl=1');
    } else if (!directUrl.includes('dl=1')) {
      directUrl = directUrl.includes('?') ? `${directUrl}&dl=1` : `${directUrl}?dl=1`;
    }

    const fileName = path.basename(pageUrl.split('?')[0]);
    const title = decodeURIComponent(fileName) || 'Dropbox_File';

    return {
      title,
      source: 'dropbox',
      url: directUrl,
      directUrl
    };
  } catch (err) {
    throw new Error(`Dropbox extraction error: ${err.message}`);
  }
}
