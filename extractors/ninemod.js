import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
export async function extract9Mod(targetUrl) {
  const cookieJar = new CookieJar();
  let pageUrl = targetUrl;
  if (!pageUrl.includes('/download/')) {
    const pageRes = await gotScraping.get({
      url: pageUrl,
      cookieJar,
      headerGeneratorOptions: {
        devices: ['desktop'],
        locales: ['tr-TR', 'en-US'],
        operatingSystems: ['windows']
      }
    });
    const $ = cheerio.load(pageRes.body);
    const downloadHref = $('a[href*="/download/"]').first().attr('href');
    if (!downloadHref) throw new Error("Download page link not found on 9mod page.");
    pageUrl = downloadHref.startsWith('http') ? downloadHref : `https://9mod.com${downloadHref}`;
  }
  const downloadPageRes = await gotScraping.get({
    url: pageUrl,
    cookieJar,
    headerGeneratorOptions: {
      devices: ['desktop'],
      locales: ['tr-TR', 'en-US'],
      operatingSystems: ['windows']
    }
  });
  const body = downloadPageRes.body;
  const postIdMatch = body.match(/const\s+postId\s*=\s*(\d+)/);
  if (!postIdMatch) throw new Error("Could not find 9mod postId in page.");
  const postId = postIdMatch[1];
  const encodedFileDataMatch = body.match(/const\s+encodedFileData\s*=\s*'([^']+)'/);
  if (!encodedFileDataMatch) throw new Error("Could not find 9mod encodedFileData in page.");
  const encodedFileData = encodedFileDataMatch[1];
  let title = 'milfs-plaza-mod.apk';
  try {
    const fileInfo = JSON.parse(Buffer.from(encodedFileData, 'base64').toString('utf8'));
    if (fileInfo && fileInfo.fileName) {
      title = fileInfo.fileName;
    }
  } catch (e) {}
  const ajaxUrl = 'https://9mod.com/wp-admin/admin-ajax.php';
  const nonceRes = await gotScraping.post({
    url: ajaxUrl,
    cookieJar,
    body: 'action=app_get_nonce&type=download',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': pageUrl
    }
  });
  const nonceData = JSON.parse(nonceRes.body);
  if (!nonceData.success) throw new Error("Failed to get download nonce from 9mod.");
  const nonce = nonceData.data.nonce;
  const downloadRes = await gotScraping.post({
    url: ajaxUrl,
    cookieJar,
    body: `action=app_get_download&post_id=${postId}&file_index=0&app_download_nonce=${nonce}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': pageUrl
    }
  });
  const downloadData = JSON.parse(downloadRes.body);
  if (!downloadData.success) throw new Error("Failed to retrieve final download link from 9mod.");
  const directUrl = downloadData.data.url;
  const cookiesStr = await cookieJar.getCookieString(directUrl);
  return {
    title,
    source: '9mod',
    url: directUrl,
    referer: pageUrl,
    cookies: cookiesStr
  };
}