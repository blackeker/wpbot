import { 
  CATEGORIES, 
  ALIAS_MAP,
  getCanonicalCommandName, 
  getCommandCategory, 
  getGroupConfig, 
  updateGroupConfig, 
  resetGroupConfig,
  isGroupAdminOrOwner,
  isBotOwner
} from '../../utils/permissionManager.js';
import { readConfig } from '../../config.js';

export default {
  name: 'izin',
  aliases: ['yetki', 'izinler', 'grupizin', 'grupayar', 'komutkapat', 'komutac', 'komut'],
  description: 'Grup bazlı komut, kategori ve indirme izinlerini yönetir',
  async execute(sock, msg, from, args = [], ctx = {}) {
    const isGroup = from.endsWith('@g.us');
    const sender = msg?.key?.participant || from;
    const senderNumber = sender.split('@')[0];
    const isOwner = isBotOwner(msg, senderNumber);
    let targetGroupJid = isGroup ? from : '';

    // If invoked by Bot Owner in DM, allow specifying target group JID as first argument
    if (!isGroup && isOwner && args.length > 0 && args[0].endsWith('@g.us')) {
      targetGroupJid = args[0];
      args = args.slice(1);
    }

    const isAdmin = isGroup ? await isGroupAdminOrOwner(sock, msg, targetGroupJid || from) : isOwner;

    // Permission check: Must be Group Admin or Bot Owner
    if (!isGroup && !isOwner) {
      await sock.sendMessage(from, { 
        text: 'ℹ️ Bu komut grup ayarlarını yapılandırmak içindir. Grup içinde veya Bot Sahibi olarak kullanınız.' 
      });
      return;
    }

    if (isGroup && !isAdmin) {
      await sock.sendMessage(from, { 
        text: '⛔ Bu komutu kullanmak ve grup izinlerini değiştirmek için *Grup Yöneticisi* veya *Bot Sahibi* olmalısınız.' 
      });
      return;
    }

    // Direct invocation via alias: !komutkapat <komut> or !komutac <komut>
    const firstWord = (ctx.text || '').trim().split(/\s+/)[0].toLowerCase().replace(/^[!/.]/, '');
    if (firstWord === 'komutkapat' && args.length > 0) {
      args = ['kapat', ...args];
    } else if (firstWord === 'komutac' && args.length > 0) {
      args = ['ac', ...args];
    }

    const subCommand = (args[0] || '').toLowerCase().trim();

    // 1. LIST CATEGORIES & COMMANDS
    if (subCommand === 'kategoriler' || subCommand === 'kategori' || subCommand === 'liste') {
      let listMsg = `📋 *SİSTEMDEKİ TÜM KATEGORİLER VE KOMUTLAR*\n━━━━━━━━━━━━━━━━━━━━\n`;
      for (const [key, data] of Object.entries(CATEGORIES)) {
        listMsg += `${data.icon} *${data.name}* (\`${key}\`)\n`;
        listMsg += `📝 _${data.description}_\n`;
        listMsg += `🔹 *Komutlar:* ${data.commands.map(c => `\`!${c}\``).join(', ')}\n\n`;
      }
      listMsg += `━━━━━━━━━━━━━━━━━━━━\n💡 *Örnek Kullanım:* \`!izin kapat universite\` veya \`!izin kapat ciz\``;
      await sock.sendMessage(from, { text: listMsg });
      return;
    }

    // 2. LIST ALL BOT GROUPS & CONFIGURED GROUPS (Bot Owner only)
    if (subCommand === 'gruplar' || subCommand === 'tumgruplar') {
      if (!isOwner) {
        await sock.sendMessage(from, { text: '⛔ Bu listeyi yalnızca Bot Sahibi görüntüleyebilir.' });
        return;
      }

      let participating = {};
      if (sock && typeof sock.groupFetchAllParticipating === 'function') {
        try {
          participating = await sock.groupFetchAllParticipating();
        } catch (e) {
          console.warn('[IZIN CMD] groupFetchAllParticipating error:', e.message);
        }
      }

      const config = readConfig();
      const allPerms = config.groupPermissions || {};
      const allJids = Array.from(new Set([...Object.keys(participating), ...Object.keys(allPerms)]));

      if (allJids.length === 0) {
        await sock.sendMessage(from, { text: 'ℹ️ Botun bulunduğu veya özel ayarlanmış herhangi bir grup bulunamadı.' });
        return;
      }

      let groupListText = `📋 *BOTUN BULUNDUĞU GRUPLAR (${allJids.length})*\n━━━━━━━━━━━━━━━━━━━━\n`;
      allJids.forEach((jid, index) => {
        const item = allPerms[jid];
        const waGroup = participating[jid];
        const title = waGroup?.subject || item?.name || 'İsimsiz Grup';
        const memberCount = waGroup?.participants?.length ? ` (${waGroup.participants.length} Üye)` : '';

        groupListText += `${index + 1}. *${title}*${memberCount}\n`;
        groupListText += `   🆔 \`${jid}\`\n`;

        if (item) {
          groupListText += `   🛡️ Mod: *${item.mode === 'whitelist' ? 'Beyaz Liste' : 'Kara Liste'}*\n`;
          if (item.disabledCategories?.length) groupListText += `   ⛔ Kapalı Kat.: ${item.disabledCategories.map(c => `\`${c}\``).join(', ')}\n`;
          if (item.disabledCommands?.length) groupListText += `   ⛔ Kapalı Komut: ${item.disabledCommands.map(c => `\`!${c}\``).join(', ')}\n`;
          groupListText += `   📦 Link: ${item.allowLinks ? '✅' : '❌'} | 🔞 +18: ${item.allowAdultLinks ? '✅' : '❌'}\n`;
        } else {
          groupListText += `   ⚙️ _Varsayılan Güvenli Mod (+18 Kapalı, Genel Komutlar Açık)_\n`;
        }
        groupListText += `\n`;
      });

      groupListText += `━━━━━━━━━━━━━━━━━━━━\n💡 _Grup kuralı değiştirmek için o grupta \`!izin kapat <komut>\` yazabilir veya web paneli kullanabilirsiniz._`;

      await sock.sendMessage(from, { text: groupListText });
      return;
    }

    if (!targetGroupJid) {
      await sock.sendMessage(from, { 
        text: 'ℹ️ Lütfen bir grup içinde kullanın veya Bot Sahibi olarak hedef grup kimliğini belirtin: `!izin <groupJid> <kapat|ac> <komut>`' 
      });
      return;
    }

    // 3. RESET GROUP PERMISSIONS
    if (subCommand === 'sifirla' || subCommand === 'sıfırla' || subCommand === 'reset') {
      resetGroupConfig(targetGroupJid);
      await sock.sendMessage(from, { 
        text: `✅ *Grup izinleri başarıyla sıfırlandı!*\n\nBu grup için varsayılan ayarlara dönüldü (Genel komutlar açık, 18+ içerik kapalı).` 
      });
      return;
    }

    // 4. SWITCH MODE (Blacklist / Whitelist)
    if (subCommand === 'mod' || subCommand === 'mode') {
      const modeParam = (args[1] || '').toLowerCase();
      if (['kara', 'karaliste', 'blacklist', 'kara_liste'].includes(modeParam)) {
        updateGroupConfig(targetGroupJid, { mode: 'blacklist' });
        await sock.sendMessage(from, { 
          text: `🛡️ *Grup Modu Değiştirildi:* **Kara Liste (Blacklist)**\n\nTüm komutlar varsayılan olarak serbesttir, sadece kapatılan komutlar engellenir.` 
        });
        return;
      } else if (['beyaz', 'beyazliste', 'whitelist', 'beyaz_liste'].includes(modeParam)) {
        updateGroupConfig(targetGroupJid, { mode: 'whitelist' });
        await sock.sendMessage(from, { 
          text: `🔒 *Grup Modu Değiştirildi:* **Beyaz Liste (Whitelist)**\n\nTüm komutlar varsayılan olarak engellidir, yalnızca \`!izin ac\` ile izin verilen komutlar çalışır.` 
        });
        return;
      } else {
        await sock.sendMessage(from, { 
          text: `⚠️ *Geçersiz mod! Doğru kullanım:*\n• \`!izin mod kara\` ➔ Kara Liste (Önerilen)\n• \`!izin mod beyaz\` ➔ Beyaz Liste (Sadece izinli komutlar)` 
        });
        return;
      }
    }

    // 5. SILENT MODE TOGGLE
    if (subCommand === 'sessiz' || subCommand === 'silent') {
      const silentParam = (args[1] || '').toLowerCase();
      if (['ac', 'aç', 'on', '1', 'true', 'evet'].includes(silentParam)) {
        updateGroupConfig(targetGroupJid, { silent: true });
        await sock.sendMessage(from, { text: '🔇 *Sessiz Mod Açıldı:* Engelli komutlar yazıldığında uyarı mesajı verilmeyecek, sessizce yoksayılacak.' });
        return;
      } else if (['kapat', 'off', '0', 'false', 'hayir', 'hayır'].includes(silentParam)) {
        updateGroupConfig(targetGroupJid, { silent: false });
        await sock.sendMessage(from, { text: '🔔 *Sessiz Mod Kapatıldı:* Engelli komutlar yazıldığında bilgi uyarısı verilecek.' });
        return;
      } else {
        await sock.sendMessage(from, { text: '⚠️ *Kullanım:* `!izin sessiz ac` veya `!izin sessiz kapat`' });
        return;
      }
    }

    // 6. DISABLE COMMAND OR CATEGORY (KAPAT / ENGELLE)
    if (subCommand === 'kapat' || subCommand === 'engelle' || subCommand === 'disable' || subCommand === 'yasakla') {
      const target = (args[1] || '').toLowerCase().replace(/^[!/.]/, '').trim();
      if (!target) {
        await sock.sendMessage(from, { 
          text: `⚠️ *Lütfen kapatmak istediğiniz komut veya kategori adını belirtin.*\n\n*Örnekler:*\n• \`!izin kapat ciz\` ➔ Yapay zeka görsel üretimini kapatır.\n• \`!izin kapat universite\` ➔ Tüm üniversite menü/takvim komutlarını kapatır.\n• \`!izin kapat indirme\` ➔ Tüm indirme komutlarını kapatır.\n• \`!izin kapat linkler\` ➔ Otomatik link indirmeyi kapatır.\n• \`!izin kapat hentai\` ➔ Yetişkin 18+ içerikleri kapatır.\n• \`!izin kapat hepsi\` ➔ Tüm genel komutları kapatır.` 
        });
        return;
      }

      const current = getGroupConfig(targetGroupJid);
      let disabledCommands = new Set(current.disabledCommands || []);
      let disabledCategories = new Set(current.disabledCategories || []);
      let allowedCommands = new Set(current.allowedCommands || []);
      let allowedCategories = new Set(current.allowedCategories || []);

      // Case: Disable all categories
      if (['hepsi', 'tumu', 'tümü', 'all'].includes(target)) {
        Object.keys(CATEGORIES).forEach(k => {
          if (k !== 'admin') disabledCategories.add(k);
        });
        updateGroupConfig(targetGroupJid, {
          disabledCategories: Array.from(disabledCategories),
          allowedCategories: []
        });
        await sock.sendMessage(from, { text: '⛔ *Bu grupta tüm genel komut kategorileri devre dışı bırakıldı!*' });
        return;
      }

      // Case A: Link downloads
      if (['link', 'linkler', 'url', 'otolink'].includes(target)) {
        updateGroupConfig(targetGroupJid, { allowLinks: false });
        await sock.sendMessage(from, { text: '🚫 *Grupta otomatik link indirme özelliği kapatıldı!*' });
        return;
      }

      // Case B: 18+ Adult / Hentai
      if (['yetiskin', 'yetişkin', '18+', 'nsfw', 'hentai'].includes(target)) {
        disabledCategories.add('hentai');
        allowedCategories.delete('hentai');
        updateGroupConfig(targetGroupJid, { 
          disabledCategories: Array.from(disabledCategories),
          allowedCategories: Array.from(allowedCategories),
          allowAdultLinks: false 
        });
        await sock.sendMessage(from, { text: '🔞 *Bu grupta Yetişkin (18+) komutları ve içerik indirmeleri tamamen kapatıldı!*' });
        return;
      }

      // Case C: Check if target is a known category
      if (CATEGORIES[target]) {
        disabledCategories.add(target);
        allowedCategories.delete(target);
        updateGroupConfig(targetGroupJid, { 
          disabledCategories: Array.from(disabledCategories),
          allowedCategories: Array.from(allowedCategories)
        });
        await sock.sendMessage(from, { 
          text: `⛔ *[Kategori Kapatıldı]* *${CATEGORIES[target].name}* (\`${target}\`) kategorisindeki tüm komutlar bu grupta devre dışı bırakıldı.` 
        });
        return;
      }

      // Case D: Single command
      const canonical = getCanonicalCommandName(target);
      if (canonical === 'izin') {
        await sock.sendMessage(from, { text: '❌ `!izin` komutu kapatılamaz.' });
        return;
      }

      disabledCommands.add(canonical);
      allowedCommands.delete(canonical);

      updateGroupConfig(targetGroupJid, { 
        disabledCommands: Array.from(disabledCommands),
        allowedCommands: Array.from(allowedCommands)
      });

      await sock.sendMessage(from, { 
        text: `⛔ *[Komut Kapatıldı]* \`!${canonical}\` komutu bu grupta devre dışı bırakıldı.` 
      });
      return;
    }

    // 7. ENABLE COMMAND OR CATEGORY (AC / IZIN VER)
    if (subCommand === 'ac' || subCommand === 'aç' || subCommand === 'izinver' || subCommand === 'enable') {
      const target = (args[1] || '').toLowerCase().replace(/^[!/.]/, '').trim();
      if (!target) {
        await sock.sendMessage(from, { 
          text: `⚠️ *Lütfen açmak istediğiniz komut veya kategori adını belirtin.*\n\n*Örnekler:*\n• \`!izin ac ciz\` ➔ Yapay zeka görsel üretimini açar.\n• \`!izin ac universite\` ➔ Üniversite komutlarını açar.\n• \`!izin ac linkler\` ➔ Link indirmeyi açar.\n• \`!izin ac hentai\` ➔ Yetişkin 18+ içerikleri açar.\n• \`!izin ac hepsi\` ➔ Tüm kategorileri açar.` 
        });
        return;
      }

      const current = getGroupConfig(targetGroupJid);
      let disabledCommands = new Set(current.disabledCommands || []);
      let disabledCategories = new Set(current.disabledCategories || []);
      let allowedCommands = new Set(current.allowedCommands || []);
      let allowedCategories = new Set(current.allowedCategories || []);

      // Case: Enable all
      if (['hepsi', 'tumu', 'tümü', 'all'].includes(target)) {
        disabledCategories.clear();
        disabledCommands.clear();
        Object.keys(CATEGORIES).forEach(k => {
          if (k !== 'hentai' && k !== 'admin') allowedCategories.add(k);
        });
        updateGroupConfig(targetGroupJid, {
          disabledCategories: ['hentai'],
          disabledCommands: [],
          allowLinks: true
        });
        await sock.sendMessage(from, { text: '✅ *Bu grupta tüm genel komutlar ve link indirmeleri etkinleştirildi!*' });
        return;
      }

      // Case A: Link downloads
      if (['link', 'linkler', 'url', 'otolink'].includes(target)) {
        updateGroupConfig(targetGroupJid, { allowLinks: true });
        await sock.sendMessage(from, { text: '✅ *Grupta link indirme özelliği açıldı!*' });
        return;
      }

      // Case B: 18+ Adult / Hentai
      if (['yetiskin', 'yetişkin', '18+', 'nsfw', 'hentai'].includes(target)) {
        disabledCategories.delete('hentai');
        allowedCategories.add('hentai');
        updateGroupConfig(targetGroupJid, { 
          disabledCategories: Array.from(disabledCategories),
          allowedCategories: Array.from(allowedCategories),
          allowAdultLinks: true 
        });
        await sock.sendMessage(from, { text: '🔞 *Bu grupta Yetişkin (18+) komutları ve içerik indirmeleri etkinleştirildi!*' });
        return;
      }

      // Case C: Check if target is a known category
      if (CATEGORIES[target]) {
        disabledCategories.delete(target);
        allowedCategories.add(target);
        updateGroupConfig(targetGroupJid, { 
          disabledCategories: Array.from(disabledCategories),
          allowedCategories: Array.from(allowedCategories)
        });
        await sock.sendMessage(from, { 
          text: `✅ *[Kategori Açıldı]* *${CATEGORIES[target].name}* (\`${target}\`) kategorisindeki komutlar bu grupta açıldı.` 
        });
        return;
      }

      // Case D: Single command
      const canonical = getCanonicalCommandName(target);
      disabledCommands.delete(canonical);
      allowedCommands.add(canonical);

      updateGroupConfig(targetGroupJid, { 
        disabledCommands: Array.from(disabledCommands),
        allowedCommands: Array.from(allowedCommands)
      });

      await sock.sendMessage(from, { 
        text: `✅ *[Komut Açıldı]* \`!${canonical}\` komutu bu grupta kullanıma açıldı.` 
      });
      return;
    }

    // 8. DEFAULT: DISPLAY CURRENT GROUP STATUS & DASHBOARD
    const groupConfig = getGroupConfig(targetGroupJid);
    const modeLabel = groupConfig.mode === 'whitelist' ? '🔒 Beyaz Liste (Sadece İzinliler)' : '🛡️ Kara Liste (Kapalılar Hariç Her Şey)';
    
    let info = `⚙️ *GRUP İZİN VE YETKİ MERKEZİ*\n━━━━━━━━━━━━━━━━━━━━\n`;
    info += `📍 *Grup:* \`${targetGroupJid}\`\n`;
    info += `🛡️ *Çalışma Modu:* ${modeLabel}\n\n`;

    if (groupConfig.mode === 'whitelist') {
      const allowedCats = groupConfig.allowedCategories.length > 0
        ? groupConfig.allowedCategories.map(c => `• ${CATEGORIES[c]?.name || c}`).join('\n')
        : '_Tanımlı kategori yok_';
      const allowedCmds = groupConfig.allowedCommands.length > 0
        ? groupConfig.allowedCommands.map(c => `\`!${c}\``).join(', ')
        : '_Tanımlı komut yok_';
      
      info += `✅ *İzin Verilen Kategoriler:*\n${allowedCats}\n\n`;
      info += `✅ *İzin Verilen Ek Komutlar:*\n${allowedCmds}\n\n`;
    } else {
      const disCats = groupConfig.disabledCategories.length > 0 
        ? groupConfig.disabledCategories.map(c => `• ${CATEGORIES[c]?.name || c} (\`${c}\`)`).join('\n')
        : '_Engellenen kategori yok_';
      const disCmds = groupConfig.disabledCommands.length > 0 
        ? groupConfig.disabledCommands.map(c => `\`!${c}\``).join(', ')
        : '_Engellenen komut yok_';

      info += `⛔ *Kapalı Kategoriler:*\n${disCats}\n\n`;
      info += `⛔ *Kapalı Komutlar:*\n${disCmds}\n\n`;
    }

    info += `📦 *Medya & Link İndirme:* ${groupConfig.allowLinks ? '✅ Açık' : '❌ Kapalı'}\n`;
    info += `🔞 *18+ / Yetişkin Medya:* ${groupConfig.allowAdultLinks ? '✅ Açık' : '❌ Kapalı (Güvenli)'}\n`;
    info += `🔇 *Sessiz Uyarı Modu:* ${groupConfig.silent ? '✅ Açık (Sessiz)' : '❌ Kapalı (Mesajla Bildir)'}\n`;
    info += `━━━━━━━━━━━━━━━━━━━━\n`;
    info += `🛠️ *HIZLI YÖNETİM KOMUTLARI:*\n`;
    info += `• Komut Kapat: \`!izin kapat <komut>\` (Örn: \`!izin kapat ciz\`)\n`;
    info += `• Komut Aç: \`!izin ac <komut>\` (Örn: \`!izin ac ciz\`)\n`;
    info += `• Kategori Kapat: \`!izin kapat <kategori>\`\n`;
    info += `• Kategori Aç: \`!izin ac <kategori>\`\n`;
    info += `• Kategorileri Gör: \`!izin kategoriler\`\n`;
    info += `• Ayarları Sıfırla: \`!izin sifirla\``;

    await sock.sendMessage(from, { text: info });
  }
};
