export default {
  name: 'adres',
  aliases: ['yurt', 'yurtadresi', 'adresim'],
  async execute(sock, msg, from, args, ctx) {
    const addressText = `📍 *YURT ADRESİ:*\n\nAnguzu baba sokak 50/1, 23350 Ahmet kabaklı erkek öğrenci yurdu Merkez/Elazığ`;
    await sock.sendMessage(from, { text: addressText });
  }
};
