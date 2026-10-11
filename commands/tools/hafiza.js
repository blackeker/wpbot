import { userProfileManager } from '../../ai/userProfileManager.js';

export const name = 'hafiza';
export const aliases = ['hafıza', 'profil', 'benikimim', 'hatirla', 'hafizasil', 'hafıza-sil', 'unut'];
export const description = 'Yapay zekanın senin hakkında öğrendiği kalıcı hafızayı görüntüler veya sıfırlar';
export const category = 'tools';
export const usage = '!hafıza | !hafıza sil';

export async function execute(sock, msg, from, args, context = {}) {
  const userJid = msg?.key?.senderPn || msg?.key?.participant || msg?.participant || from;
  const subCmd = (args[0] || '').toLowerCase().trim();

  if (subCmd === 'sil' || subCmd === 'reset' || subCmd === 'temizle' || subCmd === 'sifirla' || subCmd === 'sıfırla') {
    userProfileManager.clearProfile(userJid);
    await sock.sendMessage(from, {
      text: '🧹 *Kalıcı Hafızan Temizlendi!*\n\nSenin hakkında öğrendiğim tüm kişisel notlar, ilgi alanları ve detaylar sıfırlandı. Yeniden tanışmış gibi konuşabiliriz!'
    }, { quoted: msg });
    return;
  }

  // Hafıza kartını göster
  const card = userProfileManager.formatUserMemoryCard(userJid);
  await sock.sendMessage(from, { text: card }, { quoted: msg });
}
