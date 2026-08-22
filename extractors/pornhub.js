import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { getProxyUrl, getYtDlpCommand } from "../config.js";
import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
import * as cheerio from 'cheerio';
export async function extractPornhub(pageUrl) {
  try {
    const pageRes = await gotScraping.get({
      url: pageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Cookie': 'hasVisited=1; accessAgeDisclaimerPH=1; platform=pc; bs=1; cookiesBannerSeen=1'
      }
    });
    const html = pageRes.body;
    const $ = cheerio.load(html);
    let title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || 'Pornhub Video';
    title = title.replace(/\s*-\s*Pornhub\.com/i, '').trim();
    let videoUrl = null;
    let format = 'Direct';
    const scripts = $('script');
    let flashvarsJson = null;
    scripts.each((_, el) => {
      const data = $(el).html() || '';
      if (data.includes('flashvars') || data.includes('mediaDefinitions')) {
        const match = data.match(/flashvars_\d+\s*=\s*(\{.*?\});/) || data.match(/flashvars\s*=\s*(\{.*?\});/) || data.match(/var\s+flashvars\s*=\s*(\{.*?\});/) || data.match(/var\s+flashvars_[\w]+\s*=\s*(\{[\s\S]+?\})\s*;/);
        if (match) {
          try {
            flashvarsJson = JSON.parse(match[1]);
          } catch (e) {}
        }
      }
    });
    if (flashvarsJson && flashvarsJson.mediaDefinitions) {
      const sources = [];
      for (const media of flashvarsJson.mediaDefinitions) {
        const streamUrl = media.videoUrl;
        const formatType = media.format;
        const quality = String(media.quality || 'Auto');
        if (streamUrl) {
          sources.push({
            url: streamUrl,
            format: formatType,
            quality: quality,
            qualityNum: parseInt(quality.replace(/[^0-9]/g, '')) || 0
          });
        }
      }
      if (sources.length > 0) {
        const validSources = sources.filter(s => !s.url.includes('get_media'));
        if (validSources.length > 0) {
          validSources.sort((a, b) => {
            if (a.format === 'mp4' && b.format !== 'mp4') return -1;
            if (a.format !== 'mp4' && b.format === 'mp4') return 1;
            return b.qualityNum - a.qualityNum;
          });
          videoUrl = validSources[0].url;
          format = validSources[0].format;
        }
      }
    }
    if (!videoUrl) {
      console.log('[Pornhub Extractor] Flashvars not found or failed, trying yt-dlp fallback...');
      const ytDlpCmd = getYtDlpCommand();
      const dump = await new Promise((resolve, reject) => {
        const activeProxy = getProxyUrl();
        const proxyArg = activeProxy ? ` --proxy "${activeProxy}"` : '';
        const env = { ...process.env };
        const ytDlpDir = path.dirname(ytDlpCmd);
        const separator = process.platform === 'win32' ? ';' : ':';
        env.PATH = `${ytDlpDir}${separator}/usr/local/bin${separator}/usr/bin${separator}/bin${separator}${env.PATH || ''}`;
        
        exec(`"${ytDlpCmd}" --dump-json --no-playlist${proxyArg} --add-header "Cookie:hasVisited=1; accessAgeDisclaimerPH=1; platform=pc; bs=1; cookiesBannerSeen=1" "${pageUrl}"`, { env }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));else resolve(stdout.trim());
        });
      });
      const parsed = JSON.parse(dump);
      videoUrl = parsed.url;
      if (parsed.title) {
        title = parsed.title;
      }
    }
    if (!videoUrl) {
      throw new Error('Pornhub video URL could not be resolved.');
    }
    return {
      title,
      source: `Pornhub (${format})`,
      url: videoUrl,
      referer: 'https://www.pornhub.com/',
      cookies: 'hasVisited=1; accessAgeDisclaimerPH=1; platform=pc; bs=1; cookiesBannerSeen=1'
    };
  } catch (err) {
    throw new Error(`Pornhub çözme hatası: ${err.message}`);
  }
}