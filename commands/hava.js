import axios from 'axios';

function getWeatherEmoji(desc, code) {
  const c = parseInt(code, 10);
  if (c === 113) return '☀️';
  if (c === 116) return '⛅';
  if (c === 119 || c === 122) return '☁️';
  if ([176, 263, 266, 293, 296, 299, 302, 305, 308, 353, 356, 359].includes(c)) return '🌧️';
  if ([200, 386, 389, 392, 395].includes(c)) return '🌩️';
  if ([227, 230, 323, 326, 329, 332, 335, 338, 368, 371].includes(c)) return '❄️';
  if (c === 248 || c === 260) return '🌫️';
  
  const text = (desc || '').toLowerCase();
  if (text.includes('güneş') || text.includes('açık')) return '☀️';
  if (text.includes('bulut')) return '⛅';
  if (text.includes('yağmur') || text.includes('sağanak')) return '🌧️';
  if (text.includes('kar')) return '❄️';
  if (text.includes('fırtına') || text.includes('gök')) return '🌩️';
  if (text.includes('sis')) return '🌫️';
  return '🌤️';
}

export default {
  name: 'hava',
  aliases: ['havadurumu', 'weather'],
  async execute(sock, msg, from, args, ctx) {
    const cityInput = args && args.length > 0 ? args.join(' ').trim() : 'Elazığ';
    
    try {
      const response = await axios.get(`https://wttr.in/${encodeURIComponent(cityInput)}?format=j1&lang=tr`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      const data = response.data;
      if (!data || !data.current_condition || data.current_condition.length === 0) {
        await sock.sendMessage(from, { text: `❌ *${cityInput}* için hava durumu bilgisi bulunamadı.` });
        return;
      }

      const current = data.current_condition[0];
      const todayForecast = data.weather && data.weather[0] ? data.weather[0] : null;

      const cityName = cityInput.toUpperCase();
      const condition = current.lang_tr ? current.lang_tr[0].value : current.weatherDesc[0].value;
      const emoji = getWeatherEmoji(condition, current.weatherCode);

      let reply = `${emoji} *HAVA DURUMU — ${cityName}*\n━━━━━━━━━━━━━━━━━━━━\n`;
      reply += `🌡️ *Sıcaklık:* ${current.temp_C}°C (Hissedilen: ${current.FeelsLikeC}°C)\n`;
      reply += `🌈 *Durum:* ${condition} ${emoji}\n`;
      reply += `💧 *Nem:* %${current.humidity}\n`;
      reply += `💨 *Rüzgar Hızı:* ${current.windspeedKmph} km/s\n`;

      if (todayForecast) {
        reply += `\n📅 *Bugün:* En Yüksek: ${todayForecast.maxtempC}°C / En Düşük: ${todayForecast.mintempC}°C`;
      }

      await sock.sendMessage(from, { text: reply.trim() });
    } catch (err) {
      console.error('[Hava Durumu] Hata:', err.message);
      await sock.sendMessage(from, { text: `❌ *Hata:* Hava durumu bilgisi alınamadı (${cityInput}). Lütfen şehir adını kontrol edin.` });
    }
  }
};
