import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
export async function extractItch(pageUrl) {
  const cookieJar = new CookieJar();

  // 1. Initial Page Fetch
  let res = await gotScraping.get({
    url: pageUrl,
    cookieJar,
    headerGeneratorOptions: {
      devices: ['desktop'],
      operatingSystems: ['windows']
    }
  });
  let $ = cheerio.load(res.body);
  const title = $('title').text().replace(' - itch.io', '').trim() || 'Itch Game';

  // 2. Bypass age verification if present
  const csrfToken = $('input[name="csrf_token"]').val();
  const gameId = $('input[name="game_id"]').val();
  if (csrfToken && gameId) {
    console.log("[ITCH] Bypassing age verification...");
    await gotScraping.post({
      url: 'https://itch.io/content-warning',
      cookieJar,
      form: {
        csrf_token: csrfToken,
        game_id: gameId,
        birth_month: '1',
        birth_day: '1',
        birth_year: '2000',
        remember: 'on'
      },
      headers: {
        Referer: pageUrl
      }
    });
    res = await gotScraping.get({
      url: pageUrl,
      cookieJar,
      headerGeneratorOptions: {
        devices: ['desktop'],
        operatingSystems: ['windows']
      }
    });
    $ = cheerio.load(res.body);
  }

  // 3. Find the upload_id
  let uploadId = '';
  let selectedName = 'Itch Game';
  const buttons = $('.download_btn');
  if (buttons.length === 0) {
    throw new Error("No download buttons found on the itch.io page.");
  }

  // Look for Android
  buttons.each((i, el) => {
    const parentText = $(el).parent().text().toLowerCase();
    if (parentText.includes('android') || parentText.includes('.apk')) {
      uploadId = $(el).attr('data-upload_id');
      selectedName = $(el).parent().find('.name').text().trim() || title;
    }
  });

  // Fallback to first button if no Android version is found
  if (!uploadId) {
    uploadId = buttons.first().attr('data-upload_id');
    selectedName = buttons.first().parent().find('.name').text().trim() || title;
  }
  if (!uploadId) {
    throw new Error("No valid upload_id found for downloading.");
  }
  console.log(`[ITCH] Selected upload_id: ${uploadId} (${selectedName})`);

  // 4. POST to download_url to get redirect URL
  const postRes1 = await gotScraping.post({
    url: pageUrl.split('/download/')[0] + '/download_url',
    cookieJar,
    json: {
      upload_id: parseInt(uploadId, 10),
      csrf_token: ''
    },
    responseType: 'json',
    headers: {
      Referer: pageUrl,
      'X-Requested-With': 'XMLHttpRequest'
    }
  });
  const nextUrl = postRes1.body.url;
  if (!nextUrl) {
    throw new Error("Failed to get redirect URL from download_url POST.");
  }

  // 5. GET redirect page to extract fresh CSRF token
  const finalRes = await gotScraping.get({
    url: nextUrl,
    cookieJar,
    headers: {
      Referer: pageUrl
    }
  });
  const $$ = cheerio.load(finalRes.body);
  const freshCsrf = $$('meta[name="csrf_token"]').attr('value') || $$('input[name="csrf_token"]').val() || $$('meta[name="csrf_token"]').attr('content');
  if (!freshCsrf) {
    throw new Error("Failed to extract fresh CSRF token from redirect page.");
  }

  // 6. POST to the file endpoint to get direct CDN download URL
  const fileRes = await gotScraping.post({
    url: pageUrl.split('/download/')[0] + '/file/' + uploadId + '?source=game_download&after_download_lightbox=1&as_props=1',
    cookieJar,
    form: {
      csrf_token: freshCsrf
    },
    responseType: 'json',
    headers: {
      Referer: nextUrl,
      'X-Requested-With': 'XMLHttpRequest'
    }
  });
  const directUrl = fileRes.body.url;
  if (!directUrl) {
    throw new Error("Failed to retrieve final CDN download link from itch.io.");
  }
  const cookiesStr = await cookieJar.getCookieString(directUrl);

  // Clean filename for saving
  let cleanTitle = selectedName.replace(/[^a-zA-Z0-9\s.\-_()]/g, '').trim();
  if (!cleanTitle.toLowerCase().endsWith('.apk') && !cleanTitle.toLowerCase().endsWith('.zip') && !cleanTitle.toLowerCase().endsWith('.rar')) {
    if (directUrl.toLowerCase().includes('.apk') || directUrl.toLowerCase().includes('android')) {
      cleanTitle += '.apk';
    } else {
      cleanTitle += '.zip';
    }
  }
  return {
    title: cleanTitle,
    source: 'itch.io',
    url: directUrl,
    referer: nextUrl,
    cookies: cookiesStr
  };
}