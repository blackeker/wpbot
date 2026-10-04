import axios from 'axios';

export default {
  name: 'doviz',
  aliases: ['dolar', 'altin', 'btc', 'kuru', 'euro'],
  async execute(sock, msg, from, args, ctx) {
    try {
      const [truncRes, cryptoRes] = await Promise.all([
        axios.get('https://finans.truncgil.com/today.json', { timeout: 10000 }),
        axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=try,usd', { timeout: 10000 }).catch(() => null)
      ]);

      const f = truncRes.data;
      if (!f) throw new Error('Finans verisi alınamadı.');

      const usd = f.USD?.Satış || '-';
      const usdChange = f.USD?.Değişim || '';
      const eur = f.EUR?.Satış || '-';
      const eurChange = f.EUR?.Değişim || '';
      const gbp = f.GBP?.Satış || '-';

      const gramAltin = f['gram-altin']?.Satış || '-';
      const ceyrekAltin = f['ceyrek-altin']?.Satış || '-';
      const bilezik = f['22-ayar-bilezik']?.Satış || '-';
      const gumus = f.gumus?.Satış || '-';

      let reply = `🪙 *GÜNCEL DÖVİZ & ALTIN KURLARI*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      reply += `💵 *Dolar (USD):* ${usd} ₺ ${usdChange ? `(${usdChange})` : ''}\n`;
      reply += `💶 *Euro (EUR):* ${eur} ₺ ${eurChange ? `(${eurChange})` : ''}\n`;
      reply += `💷 *Sterlin (GBP):* ${gbp} ₺\n\n`;

      reply += `🟡 *Gram Altın:* ${gramAltin} ₺\n`;
      reply += `🌟 *Çeyrek Altın:* ${ceyrekAltin} ₺\n`;
      reply += `💍 *22 Ayar Bilezik:* ${bilezik} ₺\n`;
      reply += `🥈 *Gümüş:* ${gumus} ₺\n\n`;

      if (cryptoRes && cryptoRes.data) {
        const c = cryptoRes.data;
        if (c.bitcoin) {
          reply += `₿ *Bitcoin (BTC):* $${c.bitcoin.usd?.toLocaleString('en-US')} (${c.bitcoin.try?.toLocaleString('tr-TR')} ₺)\n`;
        }
        if (c.ethereum) {
          reply += `Ξ *Ethereum (ETH):* $${c.ethereum.usd?.toLocaleString('en-US')} (${c.ethereum.try?.toLocaleString('tr-TR')} ₺)\n\n`;
        }
      }

      reply += `⏱️ _Güncellenme: ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}_`;

      await sock.sendMessage(from, { text: reply.trim() });
    } catch (err) {
      console.error('[Döviz] Hata:', err.message);
      await sock.sendMessage(from, { text: '❌ *Hata:* Güncel döviz ve altın kurları alınamadı.' });
    }
  }
};
