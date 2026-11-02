import { getYemekMessage, getKahvaltiMessage, getAksamMessage, sendMenuResponse, loadMenuData, findMenuByQuery } from '../../utils/menuData.js';
import { checkCooldown, updateCooldown, hasUsedToday, markUsedToday } from '../../utils/cooldownManager.js';
import { getUniversityMenu } from '../../utils/uniFetcher.js';

export default {
  name: 'yemek',
  aliases: ['gunlukyemek', 'tabldot', 'yemekhane', 'kahvalti', 'aksam', 'uniyemek', 'kahvaltı', 'akşam'],
  description: 'Günlük yemek menüsünü gösterir (Her kullanıcı ve her grup için günde en fazla 1 kez çalışır)',
  async execute(sock, msg, from, args, ctx) {
    try {
      const isGroup = from.endsWith('@g.us');
      const sender = msg?.key?.participant || msg?.participant || from;

      // ─── 1. GÜNLÜK KULLANIM VE ANTİ-SPAM KONTROLÜ (Günde sadece 1 kez menü) ───
      // Grupta o gün zaten kullanıldıysa:
      if (isGroup && hasUsedToday('yemek', from)) {
        // Anti-Ban Koruması: Uyarı mesajı da günde SADECE 1 KEZ atılır, sonrasında tamamen sessiz kalınır!
        if (hasUsedToday('yemek_warn', from)) {
          return; // Sessizce yok say (spam ve ban riskini engelle)
        }
        markUsedToday('yemek_warn', from);
        await sendMenuResponse(sock, msg, from, '⚠️ *Grup Limiti:* Bugün bu grupta yemek menüsü zaten paylaşıldı. Yukarıdaki mesajlardan menüye bakabilirsiniz. (Menü her grupta günde yalnızca 1 defa alınabilir.)');
        return;
      }

      // Kullanıcı o gün özelde zaten kullandıysa:
      if (!isGroup && hasUsedToday('yemek', sender)) {
        // Anti-Ban Koruması: DM'de de uyarı mesajı günde SADECE 1 KEZ atılır, sonrasında tamamen sessiz kalınır!
        if (hasUsedToday('yemek_warn', sender)) {
          return; // Sessizce yok say (spam ve ban riskini engelle)
        }
        markUsedToday('yemek_warn', sender);
        await sendMenuResponse(sock, msg, from, '⚠️ *Günlük Limit:* Bugün yemek menüsünü zaten sorguladınız. Yukarıdaki mesaja göz atabilirsiniz. (Günde yalnızca 1 defa sorgulayabilirsiniz.)');
        return;
      }

      // ─── 2. KISA SÜRELİ SOĞUMA SÜRESİ KONTROLÜ (Anti-Burst) ───
      const cooldownRemaining = checkCooldown(this.name, from);
      if (cooldownRemaining) {
        // Soğuma süresi uyarısını da spamlamamak için sadece ilk seferinde ver veya sessiz geç
        return;
      }

      // ─── 3. MESAJ GEÇMİŞİ KONTROLÜ (YUKARIYA BAK) ───
      if (ctx && ctx.messages) {
        const lastMessages = ctx.messages.slice(-40);
        const alreadySent = lastMessages.some(m =>
          m.fromMe && (m.text?.includes('YEMEK MENÜSÜ') || m.text?.includes('KAHVALTI') || m.text?.includes('AKŞAM YEMEĞİ'))
        );

        if (alreadySent) {
          if (hasUsedToday('yemek_warn', from)) return;
          markUsedToday('yemek_warn', from);
          const responses = [
            'Yukarıya bak kanka, attım zaten. 😉',
            'Yukarıda paylaştım, tekrar yazmama gerek yok bence. 👆',
            'Menü yukarıda duruyor, bir göz at istersen. ✨',
            'Yukarıya bak, menü orada! 🍽️'
          ];
          await sendMenuResponse(sock, msg, from, responses[Math.floor(Math.random() * responses.length)]);
          return;
        }
      }

      // ─── 4. KOMUT MANTIĞI ───
      const query = args && args.length > 0 ? args.join(' ').trim() : '';
      let menuText = '';

      if (query.toLowerCase().includes('kahvalti') || query.toLowerCase().includes('sabah')) {
        menuText = getKahvaltiMessage(query);
      } else if (query.toLowerCase().includes('aksam') || query.toLowerCase().includes('akşam')) {
        menuText = getAksamMessage(query);
      } else {
        // Tam menü getir
        menuText = getYemekMessage(query);

        // ÜNİVERSİTE EVİ MENÜSÜNÜ EKLE
        const uniMenu = await getUniversityMenu();
        if (uniMenu) {
          const uniHeaders = ['🎓 *Üniversite Evi Menüsü*', '🏠 *Üniversite Evi Günlük Menü*', '✨ *Uni Evi Yemek Listesi*'];
          const header = uniHeaders[Math.floor(Math.random() * uniHeaders.length)];
          const divider = '────────────────────';

          let uniText = `\n\n${header}\n📅 *Tarih:* ${uniMenu.date}\n${divider}\n`;
          uniMenu.items.forEach(item => {
            uniText += `• ${item}\n`;
          });
          uniText += divider;

          menuText += `\n\n${uniText}`;
        }
      }

      await sendMenuResponse(sock, msg, from, menuText);

      // Başarılı gönderimden sonra bugünün kullanımını kaydet
      if (isGroup) {
        markUsedToday('yemek', from); // Gruba işaret koy
      }
      markUsedToday('yemek', sender); // Kullanıcıya işaret koy
      updateCooldown(this.name, from);

    } catch (err) {
      console.error('[Yemek Komutu] Hata:', err.message);
      await sendMenuResponse(sock, msg, from, `❌ *Hata:* Menü alınırken bir sorun oluştu.`);
    }
  }
};
