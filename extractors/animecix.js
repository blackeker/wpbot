import { gotScraping, sleep, tryDecrypt, dcHello, getAndUnpack, rot13Str, rot13Buffer, unmix } from "../extractor.js";
import axios from 'axios';

const SECURITY_TOKEN = "7Y2ozlO+QysR5w9Q6Tupmtvl9jJp7ThFH8SB+Lo7NvZjgjqRSqOgcT2v4ISM9sP10LmnlYI8WQ==.xrlyOBFS5BHjQ2Lk";
const APP_HASH = "b849e8a9f6cceff267251a73644faacc801ad726cc8f22a9c323c56a203f5446";

export function getAnimecixHeaders(host = "https://animecix.tv") {
  const cleanHost = host.endsWith('/') ? host.slice(0, -1) : host;
  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
    'X-Requested-With': 'com.kraptor.AnimeciX',
    'X-App-Version': '1.0.5',
    'x-e-h': SECURITY_TOKEN,
    'X-App-Hash': APP_HASH,
    'Referer': cleanHost + '/'
  };
}

export async function requestAnimecixApi(pathAndQuery, preferredHost = "https://animecix.tv") {
  const candidateHosts = [preferredHost, "https://ecchicix.com", "https://animecix.tv"].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);
  let lastErr = null;
  for (const host of candidateHosts) {
    try {
      const cleanPath = pathAndQuery.startsWith('/') ? pathAndQuery : '/' + pathAndQuery;
      const url = `${host}${cleanPath}`;
      const res = await axios.get(url, {
        headers: getAnimecixHeaders(host),
        timeout: 12000
      });
      if (res.data && typeof res.data === 'object') {
        return res.data;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Animecix API sunucularına erişilemedi.");
}

export
// ==========================================
// ANIMECIX EXTRACTOR AND RESOLVER FUNCTIONS
// ==========================================
async function resolveAnimecixSlug(slug, host = "https://animecix.tv") {
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9\-]/g, '');
  const words = cleanSlug.split('-');
  let items = [];
  // Fallback search loop from longest to shortest query
  for (let len = Math.min(words.length, 3); len >= 1; len--) {
    const query = words.slice(0, len).join(' ');
    try {
      const data = await requestAnimecixApi(`/secure/titles?query=${encodeURIComponent(query)}`, host);
      items = data?.pagination?.data || [];
      if (items.length > 0) {
        break;
      }
    } catch (e) {
      // Fail silent
    }
  }
  if (items.length === 0) {
    throw new Error(`Animecix'te "${slug}" için sonuç bulunamadı.`);
  }
  let bestItem = null;
  let bestRatio = 0;
  const urlWords = cleanSlug.split('-');
  for (const item of items) {
    const names = [item.name, item.name_romanji, item.name_english, item.original_title].filter(Boolean);
    for (const name of names) {
      const nameWords = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
      if (nameWords.length === 0) continue;
      const overlap = nameWords.filter(w => urlWords.includes(w)).length;
      const ratio = overlap / nameWords.length;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestItem = item;
      }
    }
  }
  if (!bestItem || bestRatio < 0.2) {
    return items[0].id;
  }
  return bestItem.id;
}
export async function extractAnimecix(pageUrl) {
  try {
    const host = new URL(pageUrl).origin;
    const parts = pageUrl.split('/');
    let titleId = null;
    const titlesIdx = parts.indexOf('titles');
    if (titlesIdx !== -1) {
      titleId = parts[titlesIdx + 1];
    } else {
      const diziMatch = pageUrl.match(/\/dizi\/([^/]+)/);
      if (diziMatch) {
        titleId = await resolveAnimecixSlug(diziMatch[1], host);
      }
    }

    // Parse season and episode number
    let season = null;
    const seasonIdx = parts.findIndex(p => p.toLowerCase().startsWith('season') || p.toLowerCase().startsWith('sezon'));
    if (seasonIdx !== -1) {
      const sPart = parts[seasonIdx];
      const sMatch = sPart.match(/\d+/);
      if (sMatch) {
        season = sMatch[0];
      } else if (seasonIdx + 1 < parts.length) {
        season = parts[seasonIdx + 1];
      }
    }
    let episode = null;
    const episodeIdx = parts.findIndex(p => p.toLowerCase().startsWith('episode') || p.toLowerCase().startsWith('bolum') || p.toLowerCase().startsWith('bölüm'));
    if (episodeIdx !== -1) {
      const ePart = parts[episodeIdx];
      const eMatch = ePart.match(/\d+/);
      if (eMatch) {
        episode = eMatch[0];
      } else if (episodeIdx + 1 < parts.length) {
        episode = parts[episodeIdx + 1];
      }
    }
    if (!titleId) {
      throw new Error("Geçersiz Animecix URL formatı.");
    }
    if (!season) season = "1";
    if (!episode) episode = "1";
    // ── Başlığı Title Detail API'den çek (anime adı + bölüm adı) ──
    let title = `Animecix - Sezon ${season} Bölüm ${episode}`;
    try {
      const titleRes = await requestAnimecixApi(`/secure/titles/${titleId}?titleId=${titleId}&seasonNumber=${season}&page=1&perPage=100`, host);
      const titleData = titleRes?.data || titleRes;
      const animeName = titleData?.title?.name;
      if (animeName) {
        title = `${animeName} - Sezon ${season} Bölüm ${episode}`;
      }
    } catch (e) {
      console.error('Animecix başlık API hatası (devam ediyor):', e.message);
    }

    // ── Video kaynaklarını çek ──
    const epRes = await requestAnimecixApi(`/secure/episode-videos?titleId=${titleId}&season=${season}&episode=${episode}`, host);
    const sources = epRes?.data || epRes;
    if (Array.isArray(sources) && sources.length > 0) {
      let providerUrl = null;
      let sourceName = '';

      // Priority: SibNet > Tau > Ok.ru > Generic
      const sibnet = sources.find(s => s.url && s.url.includes('sibnet.ru'));
      if (sibnet) {
        providerUrl = await resolveSibNet(sibnet.url);
        if (providerUrl) sourceName = 'SibNet';
      }
      if (!providerUrl) {
        const tau = sources.find(s => s.url && (s.url.includes('tau-video.xyz') || s.url.includes('tau')));
        if (tau) {
          providerUrl = await resolveTauVideo(tau.url);
          if (providerUrl) sourceName = 'Tau Video';
        }
      }
      if (!providerUrl) {
        const okru = sources.find(s => s.url && s.url.includes('ok.ru'));
        if (okru) {
          providerUrl = await resolveOkRu(okru.url);
          if (providerUrl) sourceName = 'Ok.ru';
        }
      }

      // Generic fallback: check all sources for direct links or other embeds
      if (!providerUrl) {
        for (const s of sources) {
          if (!s.url) continue;
          if (s.url.includes('sibnet.ru')) {
            providerUrl = await resolveSibNet(s.url);
            if (providerUrl) {
              sourceName = 'SibNet';
              break;
            }
          } else if (s.url.includes('tau-video.xyz') || s.url.includes('tau')) {
            providerUrl = await resolveTauVideo(s.url);
            if (providerUrl) {
              sourceName = 'Tau Video';
              break;
            }
          } else if (s.url.includes('ok.ru')) {
            providerUrl = await resolveOkRu(s.url);
            if (providerUrl) {
              sourceName = 'Ok.ru';
              break;
            }
          } else if (s.url.startsWith('http://') || s.url.startsWith('https://')) {
            providerUrl = s.url;
            sourceName = s.name || s.extra || 'Direkt Video';
            break;
          }
        }
      }
      if (providerUrl) {
        if (providerUrl.includes('.m3u8')) {
          providerUrl = await pickBestQuality(providerUrl);
        }
        return {
          title,
          source: sourceName,
          url: providerUrl,
          referer: host + '/'
        };
      }
    }
    throw new Error("Çözümlenebilir video kaynağı bulunamadı.");
  } catch (err) {
    throw new Error(`Animecix çözme hatası: ${err.message}`);
  }
}
export async function resolveTauVideo(embedUrl) {
  try {
    const videoId = embedUrl.split('/').pop().split('?')[0];
    const vidParam = new URL(embedUrl).searchParams.get('vid');
    const apiUrl = `https://tau-video.xyz/api/video/${videoId}${vidParam ? `?vid=${vidParam}` : ''}`;
    const response = await axios.get(apiUrl, {
      headers: {
        'Referer': 'https://animecix.tv/',
        'X-Requested-With': 'com.kraptor.AnimeciX',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      timeout: 15000
    });
    if (response.data && response.data.urls && response.data.urls.length > 0) {
      const best = response.data.urls.sort((a, b) => (parseInt(b.label) || 0) - (parseInt(a.label) || 0))[0];
      return best.url;
    }
  } catch (e) {}
  return null;
}
export async function resolveSibNet(embedUrl) {
  try {
    const response = await axios.get(embedUrl, {
      headers: {
        'Referer': 'https://animecix.tv/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      responseType: 'text',
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024
    });
    const html = typeof response.data === 'string' ? response.data : response.data.toString('utf8');
    const match = html.match(/src:\s*["']([^"']+)["']/) || html.match(/source\s+src=["']([^"']+)["']/);
    if (match) {
      let videoPath = match[1];
      if (videoPath.startsWith('//')) videoPath = 'https:' + videoPath;
      return videoPath.startsWith('http') ? videoPath : `https://video.sibnet.ru${videoPath}`;
    }
  } catch (e) {}
  return null;
}
export async function resolveOkRu(embedUrl) {
  try {
    const response = await axios.get(embedUrl, {
      headers: {
        'Referer': 'https://animecix.tv/'
      },
      responseType: 'text',
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024
    });
    const html = typeof response.data === 'string' ? response.data : response.data.toString('utf8');
    const match = html.match(/hlsManifestUrl\\":\\"(.*?)\\"/);
    if (match) {
      return match[1].replace(/\\u0026/g, '&');
    }
  } catch (e) {}
  return null;
}
export async function pickBestQuality(masterUrl) {
  try {
    const response = await axios.get(masterUrl, {
      responseType: 'text',
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024
    });
    const content = typeof response.data === 'string' ? response.data : response.data.toString('utf8');
    if (content.includes('#EXT-X-STREAM-INF')) {
      const lines = content.split('\n');
      let bestBandwidth = 0;
      let bestUri = '';
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('BANDWIDTH=')) {
          const match = lines[i].match(/BANDWIDTH=(\d+)/);
          if (match) {
            const bw = parseInt(match[1]);
            // Find next non-empty, non-comment line
            for (let j = i + 1; j < lines.length; j++) {
              const nextLine = lines[j].trim();
              if (nextLine && !nextLine.startsWith('#')) {
                if (bw > bestBandwidth) {
                  bestBandwidth = bw;
                  bestUri = nextLine;
                }
                break;
              }
            }
          }
        }
      }
      if (bestUri) {
        if (bestUri.startsWith('http://') || bestUri.startsWith('https://')) {
          return bestUri;
        }
        // Resolve relative URL against master URL base
        const base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
        return base + bestUri;
      }
    }
  } catch (e) {}
  return masterUrl;
}
export async function getAnimecixSeasonEpisodes(seasonUrl) {
  try {
    const host = new URL(seasonUrl).origin;
    const parts = seasonUrl.split('/');
    let titleId = null;
    const titlesIdx = parts.indexOf('titles');
    if (titlesIdx !== -1) {
      titleId = parts[titlesIdx + 1];
    } else {
      const diziMatch = seasonUrl.match(/\/dizi\/([^/]+)/);
      if (diziMatch) {
        titleId = await resolveAnimecixSlug(diziMatch[1], host);
      }
    }

    if (!titleId) {
      throw new Error("Geçersiz Animecix Sezon URL formatı.");
    }

    // Check if a specific season was requested in the URL
    let requestedSeason = null;
    const seasonIdx = parts.findIndex(p => p.toLowerCase().startsWith('season') || p.toLowerCase().startsWith('sezon'));
    if (seasonIdx !== -1) {
      const sPart = parts[seasonIdx];
      const sMatch = sPart.match(/\d+/);
      if (sMatch) {
        requestedSeason = sMatch[0];
      } else if (seasonIdx + 1 < parts.length) {
        requestedSeason = parts[seasonIdx + 1];
      }
    }

    const initSeason = requestedSeason || "1";
    const response = await requestAnimecixApi(`/secure/titles/${titleId}?titleId=${titleId}&seasonNumber=${initSeason}&page=1&perPage=100`, host);
    const data = response?.data || response;
    if (!data || !data.title || !data.title.seasons) {
      throw new Error('API yanıtı geçersiz.');
    }

    const allSeasons = data.title.seasons || [];
    const targetSeasons = [];
    if (requestedSeason) {
      const sObj = allSeasons.find(s => s.number == requestedSeason);
      if (sObj) targetSeasons.push(sObj);
      else targetSeasons.push({ number: parseInt(requestedSeason, 10) });
    } else {
      targetSeasons.push(...allSeasons);
    }

    const seasonDataMap = new Map();
    const initSObj = allSeasons.find(s => s.number == initSeason);
    if (initSObj) seasonDataMap.set(Number(initSeason), initSObj);

    // Helper: Fetch all raw episodes across all pagination pages for a season
    async function fetchAllRawEpisodesForSeason(sNum, initialSeasonObj) {
      let sObj = initialSeasonObj;
      if (!sObj || !sObj.episodePagination) {
        try {
          const res = await requestAnimecixApi(`/secure/titles/${titleId}?titleId=${titleId}&seasonNumber=${sNum}&page=1&perPage=100`, host);
          const d = res?.data || res;
          sObj = d?.title?.seasons?.find(s => s.number == sNum);
        } catch (e) {
          console.warn(`[Animecix] Sezon ${sNum} ilk sayfa alınamadı:`, e.message);
          return [];
        }
      }
      if (!sObj || !sObj.episodePagination) {
        return [];
      }

      const pagination = sObj.episodePagination;
      let allRaw = [...(pagination.data || [])];
      const lastPage = pagination.last_page || 1;

      if (lastPage > 1) {
        const pagePromises = [];
        for (let p = 2; p <= lastPage; p++) {
          pagePromises.push(
            requestAnimecixApi(`/secure/titles/${titleId}?titleId=${titleId}&seasonNumber=${sNum}&page=${p}&perPage=100`, host)
              .then(res => {
                const d = res?.data || res;
                const foundS = d?.title?.seasons?.find(s => s.number == sNum);
                return foundS?.episodePagination?.data || [];
              })
              .catch(err => {
                console.warn(`[Animecix] Sezon ${sNum} sayfa ${p} alınamadı:`, err.message);
                return [];
              })
          );
        }
        const pages = await Promise.all(pagePromises);
        for (const pData of pages) {
          if (Array.isArray(pData)) {
            allRaw.push(...pData);
          }
        }
      }

      // Deduplicate by episode_number
      const seen = new Set();
      const deduped = [];
      for (const ep of allRaw) {
        if (!ep || ep.episode_number == null) continue;
        if (!seen.has(ep.episode_number)) {
          seen.add(ep.episode_number);
          deduped.push(ep);
        }
      }
      return deduped;
    }

    const seasonsResult = [];
    let totalSkipped = 0;

    for (const s of targetSeasons) {
      const sNum = s.number;
      const sObj = seasonDataMap.get(Number(sNum));
      const rawEps = await fetchAllRawEpisodesForSeason(sNum, sObj);
      const candidates = rawEps.filter(ep => {
        if (ep.release_date) {
          const relDate = new Date(ep.release_date);
          if (relDate > new Date()) return false;
        }
        return true;
      });

      // Filter episodes that have video sources (in chunks of 15 with retry)
      const episodesWithSources = [];
      const CHUNK_SIZE = 15;
      for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
        const chunk = candidates.slice(i, i + CHUNK_SIZE);
        const results = await Promise.allSettled(chunk.map(async ep => {
          let sources = [];
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const r = await requestAnimecixApi(`/secure/episode-videos?titleId=${titleId}&season=${sNum}&episode=${ep.episode_number}`, host);
              sources = r?.data || r || [];
              if (Array.isArray(sources) && sources.length > 0) break;
            } catch (e) {
              if (attempt === 0) await sleep(250);
            }
          }
          return { ep, sources };
        }));

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.sources && result.value.sources.length > 0) {
            episodesWithSources.push(result.value.ep);
          } else {
            totalSkipped++;
            console.log(`[Season Filter] Sezon ${sNum} Bölüm ${result.value?.ep?.episode_number ?? '?'} atlandı - video kaynağı yok`);
          }
        }
      }

      const episodes = episodesWithSources.map(ep => {
        const epNum = ep.episode_number;
        return {
          season: String(sNum),
          number: epNum,
          name: ep.name ? `Sezon ${sNum} Bölüm ${epNum} - ${ep.name}` : `Sezon ${sNum} Bölüm ${epNum}`,
          url: `${host}/titles/${titleId}/season/${sNum}/episode/${epNum}`
        };
      }).sort((a, b) => a.number - b.number);

      seasonsResult.push({
        season: sNum,
        name: `${sNum}. Sezon`,
        episodes
      });
    }

    // Only consider seasons that actually have available episodes
    const activeSeasons = seasonsResult.filter(s => s.episodes && s.episodes.length > 0);
    const allEpisodes = activeSeasons.flatMap(s => s.episodes);
    const isMultiSeason = !requestedSeason && activeSeasons.length > 1;

    return {
      animeName: data.title.name,
      isMultiSeason,
      seasons: activeSeasons,
      allEpisodes,
      episodes: allEpisodes,
      skippedCount: totalSkipped
    };
  } catch (err) {
    throw new Error(`Bölümler alınamadı: ${err.message}`);
  }
}