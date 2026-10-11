import { getYemekMessage, sendMenuResponse, loadMenuData, findMenuByQuery } from '../../utils/menuData.js';
import { aiEngine } from '../../ai/aiEngine.js';
import { getAiConfig } from '../../config.js';
import { checkMenuRateLimit } from '../../utils/menuRateLimiter.js';

export default {
  name: 'yemek',
  aliases: ['gunlukyemek', 'tabldot', 'yemekhane'],
  description: 'Günlük yemek menüsünü ve yapay zeka gurme yorumunu gösterir',
  async execute(sock, msg, from, args, ctx) {
    try {
      // Rate limit kontrolü (DM: günde 1, Grup: son 20 mesajda 1)
      const allowed = await checkMenuRateLimit(sock, msg, from, 'yemek');
      if (!allowed) return;

      const query = args && args.length > 0 ? args.join(' ').trim() : '';
      const menuText = getYemekMessage(query);

      const aiCfg = getAiConfig();
      if (!aiCfg.hasAnyKey || !aiCfg.enabled) {
        await sendMenuResponse(sock, msg, from, menuText);
        return;
      }

      // If AI is available, generate dynamic commentary about today's menu
      const data = loadMenuData();
      const match = findMenuByQuery(query, data);
      
      if (match && match.entry) {
        const e = match.entry;
        const prompt = `Yemekhane menüsü:\nKahvaltı: ${e.kahvalti?.join(', ')}\nAkşam: ${e.aksam_yemegi?.join(', ')}\n\nBu menüyü incele, samimi, esprili ve iştah açıcı 1-2 cümlelik kısa bir gurme arkadaş yorumu yap (menünün lezzetine, kalori durumuna veya favori yemeğe değin).`;

        try {
          const aiComment = await aiEngine.generateReply(prompt, [], {
            systemPrompt: 'Sen yemekleri çok seven, üniversite yemekhanesinde arkadaşlarıyla yemek yiyen samimi ve esprili bir Türk gurmesin. Asla uzun yazma, en fazla 2 kısa cümle yaz.'
          });

          const combinedText = `${menuText}\n\n🤖 *Kondi'nin Gurme Yorumu:* ${aiComment.text}`;
          await sendMenuResponse(sock, msg, from, combinedText);
          return;
        } catch (aiErr) {
          // Fallback to static menu if AI fails
        }
      }

      await sendMenuResponse(sock, msg, from, menuText);
    } catch (err) {
      console.error('[Yemek Komutu] Hata:', err.message);
      await sendMenuResponse(sock, msg, from, `❌ *Hata:* Yemek menüsü alınırken bir sorun oluştu: ${err.message}`);
    }
  }
};
