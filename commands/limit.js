import { writeConfig, readConfig } from "../config.js";
import { processQueue } from "../queue.js";

export default {
  name: "limit",
  aliases: ["paralel", "eşzamanlı", "eszamanli", "concurrency", "indirmelimit"],
  async execute(sock, msg, from, args, ctx) {
    const config = readConfig();
    const currentLimit = Math.max(1, Number(config.concurrencyLimit) || 1);

    if (args.length < 1) {
      await sock.sendMessage(from, {
        text: `⚙️ *Eşzamanlı İndirme & Gönderme Limiti:* *${currentLimit}*\n\nDeğiştirmek için:\n\`!limit 4\` (1 ile 10 arasında bir sayı belirtebilirsiniz)\n\n_Örnek: \`!limit 4\` yaptığınızda aynı anda 4 video hem indirilir hem de WhatsApp'a gönderilir._`
      });
      return;
    }

    const val = parseInt(args[0], 10);
    if (isNaN(val) || val < 1 || val > 10) {
      await sock.sendMessage(from, {
        text: `⚠️ *Geçersiz limit!*\nLütfen 1 ile 10 arasında bir sayı girin.\n\nÖrnek: \`!limit 4\``
      });
      return;
    }

    writeConfig({ concurrencyLimit: val });
    processQueue();

    await sock.sendMessage(from, {
      text: `✅ *Eşzamanlı İndirme Limiti Güncellendi!*\n\n🚀 Artık aynı anda en fazla *${val}* video paralel olarak indirilip gönderilecek.\nKuyruktaki bekleyen görevler hemen başlatıldı.`
    });
  }
};
