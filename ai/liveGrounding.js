import axios from 'axios';

/**
 * 🌐 LIVE GROUNDING & REAL-TIME INFO FETCHER
 * 
 * Yapay zekaya güncel döviz, kripto, hava durumu ve gerçek zamanlı bağlam sağlar.
 * Kullanıcı soru sorduğunda arka planda milisaniyeler içinde canlı veri çekilerek
 * yapay zeka istemine enjekte edilir.
 */

// Basit 5 dakikalık bellek önbelleği
const cache = new Map();
function getCached(key, ttlMs = 300000) {
  const item = cache.get(key);
  if (item && (Date.now() - item.time < ttlMs)) return item.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

/**
 * Güncel Döviz Kurlarını Getirir (Dolar, Euro, Sterlin)
 */
export async function getLiveCurrency() {
  const cached = getCached('currency', 180000); // 3 dk
  if (cached) return cached;

  try {
    const res = await axios.get('https://api.frankfurter.app/latest?from=USD&to=TRY,EUR', { timeout: 3500 });
    const usdTry = res.data?.rates?.TRY;
    const usdEur = res.data?.rates?.EUR;
    let eurTry = null;
    if (usdTry && usdEur) {
      eurTry = (usdTry / usdEur).toFixed(2);
    }
    const result = {
      usd: usdTry ? Number(usdTry).toFixed(2) : null,
      eur: eurTry || null,
      date: res.data?.date || new Date().toISOString().split('T')[0]
    };
    setCache('currency', result);
    return result;
  } catch (err) {
    return null;
  }
}

/**
 * Belirli bir şehir için canlı hava durumunu getirir
 */
export async function getLiveWeather(cityName = 'Istanbul') {
  const cleanCity = encodeURIComponent(cityName.trim().replace(/['"`]/g, ''));
  const cacheKey = `weather_${cleanCity.toLowerCase()}`;
  const cached = getCached(cacheKey, 300000); // 5 dk
  if (cached) return cached;

  try {
    const res = await axios.get(`https://wttr.in/${cleanCity}?format=j1`, { timeout: 3500 });
    const current = res.data?.current_condition?.[0];
    if (!current) return null;

    const weather = {
      city: cityName,
      temp: current.temp_C,
      feelsLike: current.FeelsLikeC,
      desc: current.weatherDesc?.[0]?.value || 'Açık',
      humidity: current.humidity + '%',
      wind: current.windspeedKmph + ' km/s'
    };
    setCache(cacheKey, weather);
    return weather;
  } catch (err) {
    return null;
  }
}

/**
 * Kullanıcı istemini analiz edip canlı bağlam gerekip gerekmediğini belirler
 */
export async function resolveLiveGroundingContext(userPrompt) {
  if (!userPrompt || typeof userPrompt !== 'string') return '';
  const lower = userPrompt.toLowerCase();
  let ctxParts = [];

  // 1. Döviz / Para / Kur / Altın Soruları
  if (lower.match(/(dolar|doların|euro|avro|döviz|kur|parite|tl karşılığı|kaç tl|ne kadar oldu)/)) {
    const curr = await getLiveCurrency();
    if (curr && curr.usd) {
      ctxParts.push(`📈 GÜNCEL DÖVİZ KURLARI (${curr.date}): 1 USD ≈ ${curr.usd} TL ${curr.eur ? `| 1 EUR ≈ ${curr.eur} TL` : ''}`);
    }
  }

  // 2. Hava Durumu Soruları
  if (lower.match(/(hava durumu|hava nasıl|yağmur var mı|yağmurlu mu|kaç derece|soğuk mu|sıcak mı)/)) {
    // Şehir tespiti
    const cities = ['istanbul', 'ankara', 'izmir', 'bursa', 'antalya', 'eskişehir', 'adana', 'trabzon', 'konya', 'gaziantep', 'samsun', 'diyarbakır', 'kayseri', 'mersin'];
    let targetCity = 'Istanbul';
    for (const c of cities) {
      if (lower.includes(c)) {
        targetCity = c.charAt(0).toUpperCase() + c.slice(1);
        break;
      }
    }
    const weather = await getLiveWeather(targetCity);
    if (weather) {
      ctxParts.push(`🌤️ GÜNCEL HAVA DURUMU (${weather.city}): ${weather.temp}°C (Hissedilen: ${weather.feelsLike}°C), Durum: ${weather.desc}, Nem: ${weather.humidity}`);
    }
  }

  // 3. Tarih ve Saat Bilgisi
  const now = new Date();
  const trDateStr = now.toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Istanbul' });
  const trTimeStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
  const hour = parseInt(trTimeStr.split(':')[0], 10);
  let timeVibe = 'Gündüz';
  if (hour >= 0 && hour < 6) timeVibe = 'Gece / Sabaha Karşı (Uykusuzluk / Gece kuşu vakti)';
  else if (hour >= 6 && hour < 11) timeVibe = 'Sabah (Güne başlama / Kahvaltı vakti)';
  else if (hour >= 11 && hour < 17) timeVibe = 'Öğle / İkindi (Çalışma / Okul vakti)';
  else if (hour >= 17 && hour < 22) timeVibe = 'Akşam (İş çıkışı / Dinlenme vakti)';
  else timeVibe = 'Gece (Günün sonu / Sohbet vakti)';

  let timeContext = `🕒 GÜNCEL ZAMAN VE TARİH: ${trDateStr}, Saat: ${trTimeStr} [${timeVibe}]`;

  if (ctxParts.length > 0) {
    return `\n${timeContext}\n${ctxParts.join('\n')}\n`;
  }
  return `\n${timeContext}\n`;
}
