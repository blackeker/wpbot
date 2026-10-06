import { handleAiChat, memoryManager, aiEngine } from '../../ai/aiEngine.js';
import { getGroupConfig, updateGroupConfig, isGroupAdminOrOwner } from '../../utils/permissionManager.js';

export const name = 'ai';
export const aliases = ['sor', 'gpt', 'bot', 'sohbet', 'ask', 'gemini', 'groq', 'yapayzeka'];
export const description = 'Yapay zeka ile kesintisiz ve doğal sohbet eder (Groq -> OpenRouter -> Gemini Fallback)';
export const category = 'tools';
export const usage = '!ai <mesajınız> | !ai aç | !ai kapat | !ai reset | !ai durum';

export async function execute(sock, msg, from, args, context = {}) {
  const subCmd = (args[0] || '').toLowerCase().trim();
  const isGroup = from.endsWith('@g.us');

  // Subcommand: Grup içi Yapay Zeka açma (Group Enable)
  if (subCmd === 'ac' || subCmd === 'aç' || subCmd === 'on' || subCmd === 'aktif' || subCmd === 'enable') {
    if (!isGroup) {
      await sock.sendMessage(from, { text: 'ℹ️ Yapay zeka DM (özel) sohbetlerde her zaman varsayılan olarak açıktır.' }, { quoted: msg });
      return;
    }

    const isAdmin = await isGroupAdminOrOwner(sock, msg, from);
    if (!isAdmin) {
      await sock.sendMessage(from, { text: '⛔ Bu komutu sadece *Grup Yöneticileri* veya *Bot Sahibi* kullanabilir.' }, { quoted: msg });
      return;
    }

    updateGroupConfig(from, { allowAi: true });
    await sock.sendMessage(from, {
      text: '🤖 *Yapay Zeka Sohbeti Aktifleştirildi!*\n\nBu grupta artık bota etiket atarak (`@bot`) veya komutla soru sorabilirsiniz. Doğal sohbete hazır!'
    }, { quoted: msg });
    return;
  }

  // Subcommand: Grup içi Yapay Zeka kapatma (Group Disable)
  if (subCmd === 'kapat' || subCmd === 'off' || subCmd === 'pasif' || subCmd === 'disable') {
    if (!isGroup) {
      await sock.sendMessage(from, { text: 'ℹ️ DM (özel) sohbette yapay zekayı kapatmak yerine yazmayı bırakmanız yeterlidir.' }, { quoted: msg });
      return;
    }

    const isAdmin = await isGroupAdminOrOwner(sock, msg, from);
    if (!isAdmin) {
      await sock.sendMessage(from, { text: '⛔ Bu komutu sadece *Grup Yöneticileri* veya *Bot Sahibi* kullanabilir.' }, { quoted: msg });
      return;
    }

    updateGroupConfig(from, { allowAi: false });
    await sock.sendMessage(from, {
      text: '🔇 *Yapay Zeka Sohbeti Kapatıldı!*\n\nBu grupta otomatik yapay zeka sohbet ve etiket yanıtları devre dışı bırakıldı. Tekrar açmak için: `!ai aç`'
    }, { quoted: msg });
    return;
  }

  // Subcommand: reset conversation memory
  if (subCmd === 'reset' || subCmd === 'temizle' || subCmd === 'sifirla' || subCmd === 'sıfırla') {
    const cleared = memoryManager.clearHistory(from);
    if (cleared) {
      await sock.sendMessage(from, { text: '🧠 *Konuşma geçmişi ve hafıza başarıyla sıfırlandı!* Yeni bir konudan devam edebiliriz.' }, { quoted: msg });
    } else {
      await sock.sendMessage(from, { text: 'ℹ️ Bu sohbette henüz kayıtlı bir hafıza geçmişi yok.' }, { quoted: msg });
    }
    return;
  }

  // Subcommand: status / health check of AI providers
  if (subCmd === 'durum' || subCmd === 'status' || subCmd === 'stats') {
    const memStats = memoryManager.getStats();
    const engineStatus = aiEngine.getStatus();

    const groqSt = engineStatus.providers.groq;
    const openrouterSt = engineStatus.providers.openrouter;
    const geminiSt = engineStatus.providers.gemini;
    const ollamaSt = engineStatus.providers.ollama;

    let groupAiStatusLine = '';
    if (isGroup) {
      const gCfg = getGroupConfig(from);
      groupAiStatusLine = `👥 *Grup Yapay Zeka:* ${gCfg.allowAi !== false ? '🟢 Açık' : '🔴 Kapalı'}\n\n`;
    }

    const statusText = `🤖 *YAPAY ZEKA SAĞLAYICI DURUMU*

${groupAiStatusLine}1️⃣ *Groq (Birincil):*
• Yapılandırıldı: ${groqSt.configured ? '✅ Evet' : '❌ Hayır'}
• Model: \`${groqSt.model}\`
• Durum: ${groqSt.coolingDown ? '⏳ Cooldown' : '🟢 Aktif'}
• Başarılı / Hata: ${groqSt.stats.success} / ${groqSt.stats.errors}

2️⃣ *OpenRouter (İkincil Fallback):*
• Yapılandırıldı: ${openrouterSt.configured ? '✅ Evet' : '❌ Hayır'}
• Model: \`${openrouterSt.model}\`
• Durum: ${openrouterSt.coolingDown ? '⏳ Cooldown' : '🟢 Aktif'}
• Başarılı / Hata: ${openrouterSt.stats.success} / ${openrouterSt.stats.errors}

3️⃣ *Google Gemini (Üçüncül Fallback):*
• Yapılandırıldı: ${geminiSt.configured ? '✅ Evet' : '❌ Hayır'}
• Model: \`${geminiSt.model}\`
• Durum: ${geminiSt.coolingDown ? '⏳ Cooldown' : '🟢 Aktif'}
• Başarılı / Hata: ${geminiSt.stats.success} / ${geminiSt.stats.errors}

4️⃣ *Ollama (4x Multi-Key Fallback):*
• Yapılandırıldı: ${ollamaSt.configured ? '✅ Evet' : '❌ Hayır'} (${ollamaSt.keyCount} Aktif Key)
• Model: \`${ollamaSt.model}\`
• Durum: ${ollamaSt.coolingDown ? '⏳ Cooldown' : '🟢 Aktif'}
• Başarılı / Hata: ${ollamaSt.stats.success} / ${ollamaSt.stats.errors}

🧠 *Hafıza (Bellek):*
• Aktif Sohbet Sayısı: ${memStats.activeSessions}
• Bellekteki Toplam Mesaj: ${memStats.totalMessagesInMemory}
• Oturum Süresi: ${memStats.ttlMinutes} dakika`;

    await sock.sendMessage(from, { text: statusText }, { quoted: msg });
    return;
  }

  const query = args.join(' ').trim();
  if (!query) {
    await sock.sendMessage(from, {
      text: `🤖 *Yapay Zeka Asistanı*

Bana herhangi bir soru sorabilir veya doğrudan sohbet edebilirsin!

📌 *Kullanım:* \`!ai <mesajınız>\`
💡 *Örnek:* \`!ai Bugün hava çok güzel, ne önerirsin?\`
📢 *Grup Ayarı:* \`!ai aç\` veya \`!ai kapat\`
🧹 *Hafızayı Temizle:* \`!ai reset\`
📊 *Durum Kontrolü:* \`!ai durum\``
    }, { quoted: msg });
    return;
  }

  await handleAiChat(sock, msg, from, query, {
    showProviderFooter: false
  });
}
