import { writeConfig, readConfig } from "../../config.js";

export default {
  name: "hentaigrup",
  aliases: ["hentaigroup", "hentaihedef"],
  async execute(sock, msg, from, args, ctx) {
    const config = readConfig();
    if (args.length < 1) {
      const currentHentaiGroup = config.hentaiGroupJid;
      if (currentHentaiGroup) {
        await sock.sendMessage(from, { text: `🔞 *Mevcut Hentai Hedef Grubu:*\n\`${currentHentaiGroup}\`\n\nDeğiştirmek: \`!hentaigrup burası\` (grupta yaz)\nSilmek: \`!hentaigrup sil\`\nManuel: \`!hentaigrup <grup JID>\`` });
      } else {
        await sock.sendMessage(from, { text: `🔞 *Hentai hedef grubu ayarlanmamış.*\n\nBir grupta \`!hentaigrup burası\` yazarak o grubu hedef yapabilirsin.\nVeya: \`!hentaigrup <grup JID>\`\n\n_Ayar yapılmadığında indirilen paketler linkin gönderildiği sohbete iletilir._` });
      }
      return;
    }

    const arg = args[0].toLowerCase();
    if (arg === "burası" || arg === "burasi" || arg === "bura" || arg === "here") {
      if (!from.endsWith("@g.us")) {
        await sock.sendMessage(from, { text: "❌ Bu komut sadece grup sohbetlerinde çalışır. Lütfen hedef grupta deneyin." });
        return;
      }
      writeConfig({ hentaiGroupJid: from });
      await sock.sendMessage(from, { text: `✅ *Bu grup Hentai Hedef Grubu olarak ayarlandı!*\n\nBundan sonra çekilen tüm Hentai paketleri (kapak resmi + tüm videolar) bu gruba gönderilecek.\nGrup JID: \`${from}\`` });
      return;
    }

    if (arg === "sil" || arg === "kaldır" || arg === "kaldir" || arg === "remove") {
      writeConfig({ hentaiGroupJid: "" });
      await sock.sendMessage(from, { text: "✅ Hentai hedef grubu ayarı kaldırıldı. Dosyalar artık isteğin yapıldığı sohbete gönderilecek." });
      return;
    }

    const jid = args[0].trim();
    writeConfig({ hentaiGroupJid: jid });
    await sock.sendMessage(from, { text: `✅ *Hentai hedef grubu ayarlandı:*\n\`${jid}\`\n\nTüm Hentai paketleri bu gruba gönderilecek.` });
  }
};
