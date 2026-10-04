import { readConfig, writeConfig } from '../../config.js';

export default {
  name: 'cerez',
  aliases: ['çerez', 'cookie', 'cookies'],
  async execute(sock, msg, from, args, ctx) {
    const inputArg = args.join(' ').trim();
    if (!inputArg) {
      await sock.sendMessage(from, { 
        text: '🍪 *HENTAİZM ÇEREZ (COOKIE) YÖNETİMİ*\n━━━━━━━━━━━━━━━━━━━━\n' +
              '• *Çerez Ekleme:* `!cerez <çerez metni>`\n' +
              '  _(Header String, Netscape txt veya JSON formatında yapıştırabilirsiniz)_\n' +
              '• *Çerez Temizleme:* `!cerez sil` veya `!cerez temizle`\n' +
              '• *Durum Kontrolü:* `!cerez durum`\n\n' +
              '💡 _Örnek (Header string):_ `!cerez PHPSESSID=abc12345; wordpress_logged_in_sec=xyz67890`' 
      });
      return;
    }

    const lowerArg = inputArg.toLowerCase();
    if (lowerArg === 'sil' || lowerArg === 'temizle' || lowerArg === 'clear') {
      writeConfig({ hentaizmCookies: null });
      await sock.sendMessage(from, { text: '🗑️ *Başarılı!* Kayıtlı Hentaizm çerezleri tamamen silindi.' });
      return;
    }

    if (lowerArg === 'durum' || lowerArg === 'status') {
      const config = readConfig();
      if (config.hentaizmCookies && config.hentaizmCookies.cookies) {
        const count = config.hentaizmCookies.cookies.length;
        await sock.sendMessage(from, { text: `🍪 *Çerez Durumu:* Kayıtlı *${count}* adet Hentaizm çerezi aktif durumda.` });
      } else {
        await sock.sendMessage(from, { text: 'ℹ️ *Çerez Durumu:* Kayıtlı Hentaizm çerezi bulunmuyor.' });
      }
      return;
    }

    try {
      const { CookieJar, Cookie } = await import('tough-cookie');
      const jar = new CookieJar();
      const domains = [
        'https://www.hentaizm2.com/',
        'https://hentaizm2.com/',
        'https://www.hentaizm.fun/',
        'https://hentaizm.fun/',
        'https://www.hentaizm.com/',
        'https://hentaizm.com/'
      ];
      let parsedCount = 0;
      let sessionTokenDetected = null;

      const cleanInput = inputArg.replace(/^["']|["']$/g, '').trim();

      // 1. Try Direct Session ID / PHPSESSID Token Format (e.g. "aa2a423eabef2f8b23f48330e59ff0b7")
      const directTokenMatch = cleanInput.match(/^(?:PHPSESSID=)?([a-zA-Z0-9_-]{16,128})$/i);
      if (directTokenMatch) {
        const sessId = directTokenMatch[1];
        sessionTokenDetected = sessId;
        for (const d of domains) {
          const c1 = Cookie.parse(`PHPSESSID=${sessId}; Path=/`);
          if (c1) jar.setCookieSync(c1, d);
        }
        parsedCount = 1;
      }

      // 2. Try JSON Format
      if (parsedCount === 0 && (cleanInput.startsWith('[') || cleanInput.startsWith('{'))) {
        try {
          const json = JSON.parse(cleanInput);
          if (Array.isArray(json)) {
            for (const item of json) {
              if (item.name && item.value) {
                for (const d of domains) {
                  const c = Cookie.parse(`${item.name}=${item.value}; Path=${item.path || '/'}`);
                  if (c) jar.setCookieSync(c, d);
                }
                parsedCount++;
              }
            }
          } else if (json.cookies && Array.isArray(json.cookies)) {
            const restoredJar = CookieJar.fromJSON(json);
            writeConfig({ hentaizmCookies: restoredJar.toJSON() });
            await sock.sendMessage(from, { text: `✅ *Başarılı!* JSON verisinden *${json.cookies.length}* adet çerez yüklendi.` });
            return;
          }
        } catch (e) {}
      }

      // 3. Netscape & Header String Formats
      if (parsedCount === 0) {
        const lines = cleanInput.split(/[\r\n]+/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          const parts = trimmed.split(/\t+/);
          const spaceParts = parts.length < 7 ? trimmed.split(/\s+/) : parts;

          if (spaceParts.length >= 7) {
            // Netscape Format
            const domain = spaceParts[0].replace(/^\./, '');
            const pathVal = spaceParts[2] || '/';
            const secure = spaceParts[3]?.toUpperCase() === 'TRUE';
            const expiresSeconds = parseInt(spaceParts[4], 10);
            const name = spaceParts[5];
            const value = spaceParts[6];

            if (name && value) {
              const cookieString = `${name}=${value}; Domain=${domain}; Path=${pathVal}${secure ? '; Secure' : ''}${expiresSeconds > 0 ? `; Expires=${new Date(expiresSeconds * 1000).toUTCString()}` : ''}`;
              const c = Cookie.parse(cookieString);
              if (c) {
                for (const d of domains) jar.setCookieSync(c, d);
                parsedCount++;
              }
            }
          } else if (trimmed.includes('=')) {
            // Header String Format: "key1=val1; key2=val2"
            const pairs = trimmed.split(';');
            for (const pair of pairs) {
              const eqIdx = pair.indexOf('=');
              if (eqIdx > 0) {
                const k = pair.slice(0, eqIdx).trim();
                const v = pair.slice(eqIdx + 1).trim();
                if (k && v && !['path', 'domain', 'expires', 'max-age', 'samesite', 'httponly', 'secure'].includes(k.toLowerCase())) {
                  for (const d of domains) {
                    const c = Cookie.parse(`${k}=${v}; Path=/`);
                    if (c) jar.setCookieSync(c, d);
                  }
                  parsedCount++;
                }
              }
            }
          }
        }
      }

      if (parsedCount > 0) {
        writeConfig({ hentaizmCookies: jar.toJSON() });
        const detailMsg = sessionTokenDetected
          ? `🔑 *PHPSESSID:* \`${sessionTokenDetected}\`\n\n`
          : `📦 *Toplam:* ${parsedCount} adet çerez\n\n`;

        await sock.sendMessage(from, { 
          text: `✅ *Başarılı!* Hentaizm çerezi başarıyla kaydedildi!\n\n` +
                detailMsg +
                `Artık oturum gerektiren Hentaizm indirmelerini engelsiz bir şekilde yapabilirsiniz.` 
        });
      } else {
        await sock.sendMessage(from, { text: '❌ *Hata:* Gönderilen çerez metni çözümlenemedi. Geçerli bir Session ID (Örn: `!cookie aa2a423eabef2f8b23f48330e59ff0b7`), Header Cookie string veya Netscape çerez metni yapıştırın.' });
      }
    } catch (err) {
      console.error('[Çerez Ekle] Hata:', err.message);
      await sock.sendMessage(from, { text: `❌ *Hata:* Çerezler kaydedilirken bir sorun oluştu: ${err.message}` });
    }
  }
};
