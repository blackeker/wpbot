import { getYemekMessage, sendMenuResponse, loadMenuData, findMenuByQuery } from '../../utils/menuData.js';
import { checkCooldown, updateCooldown } from '../../utils/cooldownManager.js';
import { aiEngine } from '../../ai/aiEngine.js';
import { getAiConfig } from '../../config.js';
import { getUniversityMenu } from '../../utils/uniFetcher.js';

export default {
  name: 'yemek',
  aliases: ['gunlukyemek', 'tabldot', 'yemekhane', 'kahvalti', 'aksam', 'uniyemek', 'kahvaltı', 'akşam'],
  description: 'Günlük yemek menüsünü gösterir (Kısa süre önce atıldıysa yukarıya yönlendirir)',
  async execute(sock, msg, from, args, ctx) {
    try {
      // 1. COOLDOWN KONTROLÜ
      const cooldownRemaining = checkCooldown(this.name, from);
      if (cooldownRemaining) {
        const minutes = Math.floor(cooldownRemaining / 60);
        const seconds = cooldownRemaining % 60;
        await sendMenuResponse(sock, msg, from, `⏳ *Soğuma Süresi:* Bu komutu tekrar kullanabilmek için ${minutes} dakika ${seconds} saniye beklemeniz gerekiyor.`);
        return;
      }

      // 2. MESAJ GEÇMİŞİ KONTROLÜ (YUKARIYA BAK)
      if (ctx && ctx.messages) {
        const lastMessages = ctx.messages.slice(-40);
        const alreadySent = lastMessages.some(m =>
          m.fromMe && (m.text?.includes('YEMEK MENÜSÜ') || m.text?.includes('KAHVALTI') || m.text?.includes('AKŞAM YEMEĞİ'))
        );

        if (alreadySent) {
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

      // 3. KOMUT MANTIĞI
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

      // AI GURME YORUMU (Sadece tam menüde çalışsın)
      const aiCfg = getAiConfig();
      if (aiCfg.hasAnyKey && aiCfg.enabled && !query.toLowerCase().includes('kahvalti') && !query.toLowerCase().includes('aksam')) {
        const data = loadMenuData();
        const match = findMenuByQuery(query, data);
        if (match && match.entry) {
          const e = match.entry;
          const prompt = `Yemekhane menüsü:\nKahvaltı: ${e.kahvalti?.join(', ')}\nAkşam: ${e.aksam_yemegi?.join(', ')}\n\nKısa, esprili bir gurme yorumu yap.`;
          try {
            const aiComment = await aiEngine.generateReply(prompt, [], {
              systemPrompt: 'Sen samimi ve esprili bir Türk gurmesin. En fazla 2 kısa cümle yaz.'
            });
            menuText += `\n\n🤖 *Kondi'nin Gurme Yorumu:* ${aiComment.text}`;
          } catch (aiErr) {}
        }
      }

      await sendMenuResponse(sock, msg, from, menuText);
      updateCooldown(this.name, from);

    } catch (err) {
      console.error('[Yemek Komutu] Hata:', err.message);
      await sendMenuResponse(sock, msg, from, `❌ *Hata:* Menü alınırken bir sorun oluştu.`);
    }
  }
};
