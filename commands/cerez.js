import { writeConfig } from '../config.js';

export default {
  name: 'cerez',
  aliases: ['çerez'],
  async execute(sock, msg, from, args, ctx) {
    const cookieText = args.join(' ').trim();
    if (!cookieText) {
      await sock.sendMessage(from, { text: '⚠️ *Kullanım:* `!cerez <Netscape formatındaki çerez metniniz>`\n(Tarayıcı eklentisinden kopyaladığınız tüm metni tek seferde gönderin)' });
      return;
    }

    try {
      const { CookieJar, Cookie } = await import('tough-cookie');
      const jar = new CookieJar();

      const lines = cookieText.split('\n');
      let parsedCount = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length >= 7) {
          const domain = parts[0];
          const path = parts[2];
          const secure = parts[3].toUpperCase() === 'TRUE';
          const expiresSeconds = parseInt(parts[4], 10);
          const name = parts[5];
          const value = parts[6];

          const cookieString = `${name}=${value}; Domain=${domain}; Path=${path}${secure ? '; Secure' : ''}${expiresSeconds > 0 ? `; Expires=${new Date(expiresSeconds * 1000).toUTCString()}` : ''}`;
          const cookie = Cookie.parse(cookieString);
          if (cookie) {
            await jar.setCookie(cookie, "https://www.hentaizm1.com/");
            parsedCount++;
          }
        }
      }

      if (parsedCount > 0) {
        writeConfig({
          hentaizmCookies: jar.toJSON()
        });
        await sock.sendMessage(from, { text: `✅ *Başarılı!* Toplam *${parsedCount}* adet Hentaizm çerezi başarıyla kaydedildi. Artık giriş engeli olmadan indirmeleri yapabilirsiniz!` });
      } else {
        await sock.sendMessage(from, { text: '❌ *Hata:* Gönderilen metin geçerli bir Netscape çerez formatında değil veya çözümlenemedi.' });
      }
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ *Hata:* Çerezler kaydedilirken bir sorun oluştu: ${err.message}` });
    }
  }
};
