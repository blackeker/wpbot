import { exec } from 'child_process';
import { addDownloadTask, pendingSelections } from '../queue.js';
import { getYtDlpCommand, getProxyUrl } from '../config.js';

export default {
  name: 'indir',
  aliases: ['download'],
  async execute(sock, msg, from, args, ctx) {
    const isMp3Cmd = ctx.text.startsWith('!mp3');
    const isIndir = ctx.text.startsWith('!indir') || ctx.text.startsWith('!download') || isMp3Cmd;

    let parts;
    if (!isIndir) {
      parts = ['!indir', ctx.text]; // direct link trigger
    } else {
      parts = ctx.text.split(/\s+/);
      if (parts.length < 2) {
        await sock.sendMessage(from, { text: '📢 Link gönder, hemen indir! Sıramı görmek için *kuyruk* yaz.' });
        return;
      }
    }

    // ─── Dizi Aralığı İndirme ───
    if (parts.length >= 3) {
      const url1 = parts[1].trim();
      const url2 = parts[2].trim();

      if (url1.includes('hdfilmcehennemi.nl') && url2.includes('hdfilmcehennemi.nl')) {
        const match1 = url1.match(/\/sezon-(\d+)\/bolum-(\d+)\/?$/);
        const match2 = url2.match(/\/sezon-(\d+)\/bolum-(\d+)\/?$/);

        if (match1 && match2 && match1[1] === match2[1]) {
          const season = match1[1];
          const startEp = Math.min(parseInt(match1[2], 10), parseInt(match2[2], 10));
          const endEp = Math.max(parseInt(match1[2], 10), parseInt(match2[2], 10));
          const baseUrl = url1.split(`/sezon-${season}/`)[0];

          await sock.sendMessage(from, { text: `🎬 *Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

          let addedCount = 0;
          let skipCount = 0;
          for (let ep = startEp; ep <= endEp; ep++) {
            const epUrl = `${baseUrl}/sezon-${season}/bolum-${ep}/`;
            try {
              addDownloadTask(epUrl, from, `Sezon ${season} Bölüm ${ep}`);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) {
            replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          }
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }
    }

    const targetUrl = parts[1].trim();
    const isPriority = targetUrl === '--oncelikli' || targetUrl === '--öncelikli';

    let urls = [];
    let priority = false;

    if (isPriority && parts.length >= 3) {
      priority = true;
      urls = [parts[2].trim()];
    } else {
      urls = parts.slice(1).filter(p => p.startsWith('http') || p.startsWith('magnet:'));
      if (urls.length === 0) {
        await sock.sendMessage(from, { text: 'Lütfen geçerli bir link belirtin. Örnek: `!indir https://www.hdfilmcehennemi.nl/dizi/...`' });
        return;
      }
    }

    const supportedDomains = [
      'hdfilmcehennemi', 'animecix', 'ecchicix', 'hentaizm',
      'youtube.com', 'youtu.be', 'pornhub.com', 'doeda', 'hdabla', 'hdkore',
      'turkifsahub', 'turkifsalar', 'turkporno', 'cloud.mail.ru', 'cloidmail.ru', 'instagram.com',
      'tiktok.com', 'disk.yandex', 'yadi.sk', 'drive.google.com', 'mega.nz', 'yabancidizi', 'sezonlukdizi', 'terabox.com', 'teraboxapp.com', 'nephobox.com', 'liteapks.com', 'modyolo.com', 'koreanturk', 'koreanizm', 'dizigom', 'dizibox', 'dizipal', 'filmmodu', 'fullhdfilmizlesene', 'dramadizilerim'
    ];

    // ─── Aralık İndirme (2 link varsa) ───
    if (urls.length === 2) {
      if (urls[0].includes('hdfilmcehennemi') && urls[1].includes('hdfilmcehennemi')) {
        const match1 = urls[0].match(/\/sezon-(\d+)\/bolum-(\d+)\/?$/);
        const match2 = urls[1].match(/\/sezon-(\d+)\/bolum-(\d+)\/?$/);

        if (match1 && match2 && match1[1] === match2[1]) {
          const season = match1[1];
          const startEp = Math.min(parseInt(match1[2], 10), parseInt(match2[2], 10));
          const endEp = Math.max(parseInt(match1[2], 10), parseInt(match2[2], 10));
          const baseUrl = urls[0].split(`/sezon-${season}/`)[0];

          await sock.sendMessage(from, { text: `🎬 *HDfilmcehennemi Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

          let addedCount = 0;
          let skipCount = 0;
          for (let ep = startEp; ep <= endEp; ep++) {
            const epUrl = `${baseUrl}/sezon-${season}/bolum-${ep}/`;
            try {
              addDownloadTask(epUrl, from, `Sezon ${season} Bölüm ${ep}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }

      if ((urls[0].includes('animecix') || urls[0].includes('ecchicix')) && 
          (urls[1].includes('animecix') || urls[1].includes('ecchicix'))) {
        const match1 = urls[0].match(/\/season\/(\d+)\/episode\/(\d+)/i);
        const match2 = urls[1].match(/\/season\/(\d+)\/episode\/(\d+)/i);

        if (match1 && match2 && match1[1] === match2[1]) {
          const season = match1[1];
          const startEp = Math.min(parseInt(match1[2], 10), parseInt(match2[2], 10));
          const endEp = Math.max(parseInt(match1[2], 10), parseInt(match2[2], 10));
          const baseUrl = urls[0].split(`/season/${season}/`)[0];

          await sock.sendMessage(from, { text: `🎬 *Animecix Dizi Aralığı Algılandı!*\nSezon: ${season}\nBölümler: ${startEp} ile ${endEp} arası sıraya ekleniyor...` });

          let addedCount = 0;
          let skipCount = 0;
          for (let ep = startEp; ep <= endEp; ep++) {
            const epUrl = `${baseUrl}/season/${season}/episode/${ep}`;
            try {
              addDownloadTask(epUrl, from, `Sezon ${season} Bölüm ${ep}`, null, priority);
              addedCount++;
            } catch (e) {
              skipCount++;
            }
          }

          let replyMsg = `✅ Toplam *${addedCount}* bölüm başarıyla sıraya eklendi.`;
          if (skipCount > 0) replyMsg += `\n⚠️ *${skipCount}* adet mükerrer link atlandı.`;
          replyMsg += `\nSırayı görmek için: \`!kuyruk\``;
          await sock.sendMessage(from, { text: replyMsg });
          return;
        }
      }
    }

    // ─── Çoklu Bağımsız Link (2+) ───
    if (urls.length > 1) {
      let addedCount = 0;
      let skipCount = 0;
      let unsupportedCount = 0;
      for (const u of urls) {
        const isSupported = u.startsWith('magnet:') || supportedDomains.some(d => u.includes(d));
        if (!isSupported) { unsupportedCount++; continue; }
        try {
          addDownloadTask(u, from, 'Video Çözümleniyor...', null, priority);
          addedCount++;
        } catch (e) {
          skipCount++;
        }
      }
      let replyMsg = `✅ *${addedCount}* link sıraya eklendi.`;
      if (skipCount > 0) replyMsg += `\n⚠️ ${skipCount} mükerrer atlandı.`;
      if (unsupportedCount > 0) replyMsg += `\n❌ ${unsupportedCount} desteklenmeyen link.`;
      if (priority) replyMsg += `\n🔴 Öncelikli sıraya alındı.`;
      replyMsg += `\n\n\`!kuyruk\` ile durumu takip edin.`;
      await sock.sendMessage(from, { text: replyMsg });
      return;
    }

    // ─── Tekil Link ───
    const singleUrl = urls[0];
    const isYouTubeUrl = /youtube\.com|youtu\.be/i.test(singleUrl);
    const isAnimecix = singleUrl.includes('animecix') || singleUrl.includes('ecchicix');
    const isHentaizm = singleUrl.includes('hentaizm');
    const isPornhub = singleUrl.includes('pornhub.com');
    const isDoeda = /doeda/i.test(singleUrl);
    const isHdabla = /hdabla/i.test(singleUrl);
    const isHdkore = singleUrl.includes('hdkore');
    const isTurkifsahub = singleUrl.includes('turkifsahub.com');
    const isTurkifsalar = /turkifsalar/i.test(singleUrl);
    const isTurkporno = /turkporno/i.test(singleUrl);
    const isCloudMailRu = singleUrl.includes('cloud.mail.ru') || singleUrl.includes('cloidmail.ru');
    const isInstagramUrl = singleUrl.includes('instagram.com');
    const isTikTokUrl = singleUrl.includes('tiktok.com');
    const isYandexUrl = singleUrl.includes('disk.yandex') || singleUrl.includes('yadi.sk');
    const isGDriveUrl = singleUrl.includes('drive.google.com');
    const isMegaUrl = singleUrl.includes('mega.nz');
    const isYabancidiziUrl = singleUrl.includes('yabancidizi.co') || singleUrl.includes('yabancidizi.pw') || singleUrl.includes('yabancidizi.vip') || singleUrl.includes('yabancidizi.fun') || singleUrl.includes('yabancidizi.com');
    const isSezonlukdiziUrl = singleUrl.includes('sezonlukdizi.org') || singleUrl.includes('sezonlukdizi.pro') || singleUrl.includes('sezonlukdizi.co') || singleUrl.includes('sezonlukdizi.com');
    const isTeraboxUrl = singleUrl.includes('terabox.com') || singleUrl.includes('teraboxapp.com') || singleUrl.includes('nephobox.com') || singleUrl.includes('terabox');
    const isLiteapksUrl = singleUrl.includes('liteapks.com');
    const isModyoloUrl = singleUrl.includes('modyolo.com');
    const isDiziSitesiUrl = singleUrl.includes('dizigom') || singleUrl.includes('dizibox') || singleUrl.includes('koreanturk') || singleUrl.includes('koreanizm') || singleUrl.includes('dizipal') || singleUrl.includes('filmmodu') || singleUrl.includes('fullhdfilmizlesene');
    const isDramadizilerim = singleUrl.includes('dramadizilerim.com');
    const isTorrentUrl = singleUrl.startsWith('magnet:') || singleUrl.toLowerCase().includes('.torrent');

    if (!singleUrl.includes('hdfilmcehennemi') && !isAnimecix && !isYouTubeUrl && !isHentaizm && !isPornhub && !isDoeda && !isHdabla && !isHdkore && !isTurkifsahub && !isTurkifsalar && !isTurkporno && !isCloudMailRu && !isInstagramUrl && !isTikTokUrl && !isYandexUrl && !isGDriveUrl && !isMegaUrl && !isYabancidiziUrl && !isSezonlukdiziUrl && !isTeraboxUrl && !isLiteapksUrl && !isModyoloUrl && !isDiziSitesiUrl && !isTorrentUrl && !isDramadizilerim) {
      await sock.sendMessage(from, { text: 'Lütfen geçerli bir desteklenen medya linki gönderin.' });
      return;
    }

    // Animecix Sezon/Dizi kontrolü
    const isAnimecixSingleEp = singleUrl.includes('/episode/') || singleUrl.includes('/bolum/') || singleUrl.includes('/bölüm/');
    const isAnimecixSeasonOrShow = isAnimecix && !isAnimecixSingleEp;

    if (isAnimecixSeasonOrShow) {
      const { getAnimecixSeasonEpisodes } = await import('../extractor.js');
      await sock.sendMessage(from, { text: '🔍 Sezon bölümleri alınıyor, lütfen bekleyin...' });
      try {
        const { animeName, episodes, skippedCount: preSkipped } = await getAnimecixSeasonEpisodes(singleUrl);

        if (episodes.length === 0) {
          const emptyMsg = preSkipped > 0
            ? `❌ Bu sezondaki *${preSkipped}* bölümün tamamı henüz platforma yüklenmemiş.`
            : '❌ Bu sezonda hiçbir bölüm bulunamadı.';
          await sock.sendMessage(from, { text: emptyMsg });
          return;
        }

        pendingSelections[from] = {
          type: 'series',
          seriesName: animeName,
          episodes: episodes,
          priority: priority
        };

        let seasonPrompt = `🎬 *${animeName}* dizisi algılandı!\n📦 Toplam *${episodes.length}* hazır bölüm bulundu.\n\n` +
          `Lütfen indirmek istediğiniz seçeneği yazın:\n\n` +
          `1️⃣ *Tüm Sezonu İndir* (Hepsini indirmek için: *hepsi* veya *1* yazın)\n` +
          `2️⃣ *Bölüm Aralığı İndir* (Örn: *10-20* veya *5-15* yazarak belirli bölümleri indirebilirsiniz)\n\n` +
          `❌ İptal etmek için *iptal* yazın.`;
        if (preSkipped > 0) {
          seasonPrompt += `\n\n*(Not: Platforma henüz yüklenmemiş ${preSkipped} bölüm otomatik atlandı)*`;
        }
        await sock.sendMessage(from, { text: seasonPrompt });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Sezon bölümleri alınırken hata oluştu: ${err.message}` });
      }
      return;
    }

    // HDfilmcehennemi Sezon/Dizi kontrolü
    const isHdfSeries = singleUrl.includes('hdfilmcehennemi') && singleUrl.includes('/dizi/') && !/\/bolum-\d+/i.test(singleUrl);

    if (isHdfSeries) {
      const { getHdfilmcehennemiSeasonEpisodes } = await import('../extractor.js');
      await sock.sendMessage(from, { text: '🔍 HDfilmcehennemi yayınlanan sezon bölümleri taranıyor...' });
      try {
        const { seriesName, episodes } = await getHdfilmcehennemiSeasonEpisodes(singleUrl);

        if (episodes.length === 0) {
          await sock.sendMessage(from, { text: '❌ Bu sezonda/dizide hiçbir bölüm bulunamadı.' });
          return;
        }

        pendingSelections[from] = {
          type: 'series',
          seriesName: seriesName,
          episodes: episodes,
          priority: priority
        };

        let seasonPrompt = `🎬 *${seriesName}* dizisi algılandı!\n📦 Toplam *${episodes.length}* bölüm bulundu.\n\n` +
          `Lütfen indirmek istediğiniz seçeneği yazın:\n\n` +
          `1️⃣ *Tüm Sezonu İndir* (Hepsini indirmek için: *hepsi* veya *1* yazın)\n` +
          `2️⃣ *Bölüm Aralığı İndir* (Örn: *10-20* veya *5-15* yazarak belirli bölümleri indirebilirsiniz)\n\n` +
          `❌ İptal etmek için *iptal* yazın.`;
        await sock.sendMessage(from, { text: seasonPrompt });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Dizi bölümleri alınırken hata oluştu: ${err.message}` });
      }
      return;
    }

    // HDKore Dizi kontrolü
    const isHdkoreSeries = singleUrl.includes('hdkore') && singleUrl.includes('/dizi/') && !/\/bolum\//i.test(singleUrl);

    if (isHdkoreSeries) {
      const { getHdkoreSeasonEpisodes } = await import('../extractor.js');
      await sock.sendMessage(from, { text: '🔍 HDKore yayınlanan dizi bölümleri taranıyor...' });
      try {
        const { seriesName, episodes } = await getHdkoreSeasonEpisodes(singleUrl);

        if (episodes.length === 0) {
          await sock.sendMessage(from, { text: '❌ Bu dizide hiçbir bölüm bulunamadı.' });
          return;
        }

        pendingSelections[from] = {
          type: 'series',
          seriesName: seriesName,
          episodes: episodes,
          priority: priority
        };

        let seasonPrompt = `🎬 *${seriesName}* dizisi algılandı!\n📦 Toplam *${episodes.length}* bölüm bulundu.\n\n` +
          `Lütfen indirmek istediğiniz seçeneği yazın:\n\n` +
          `1️⃣ *Tüm Sezonu İndir* (Hepsini indirmek için: *hepsi* veya *1* yazın)\n` +
          `2️⃣ *Bölüm Aralığı İndir* (Örn: *10-20* veya *5-15* yazarak belirli bölümleri indirebilirsiniz)\n\n` +
          `❌ İptal etmek için *iptal* yazın.`;
        await sock.sendMessage(from, { text: seasonPrompt });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Dizi bölümleri alınırken hata oluştu: ${err.message}` });
      }
      return;
    }

    // Dramadizilerim Dizi/Sezon kontrolü
    const isDramadizilerimSeries = isDramadizilerim && 
      (singleUrl.includes('/dizi/') || (!singleUrl.includes('&e=') && !singleUrl.includes('?e=')));

    if (isDramadizilerimSeries) {
      let targetDiziUrl = singleUrl;
      if (targetDiziUrl.includes('/izle/')) {
        targetDiziUrl = targetDiziUrl.replace('/izle/', '/dizi/');
      }
      
      const { getDramadizilerimSeasonEpisodes } = await import('../extractor.js');
      await sock.sendMessage(from, { text: '🔍 Dramadizilerim yayınlanan dizi bölümleri taranıyor...' });
      try {
        const { seriesName, episodes } = await getDramadizilerimSeasonEpisodes(targetDiziUrl);

        if (episodes.length === 0) {
          await sock.sendMessage(from, { text: '❌ Bu dizide hiçbir bölüm bulunamadı.' });
          return;
        }

        pendingSelections[from] = {
          type: 'series',
          seriesName: seriesName,
          episodes: episodes,
          priority: priority
        };

        let seasonPrompt = `🎬 *${seriesName}* dizisi algılandı!\n📦 Toplam *${episodes.length}* bölüm bulundu.\n\n` +
          `Lütfen indirmek istediğiniz seçeneği yazın:\n\n` +
          `1️⃣ *Tüm Sezonu İndir* (Hepsini indirmek için: *hepsi* veya *1* yazın)\n` +
          `2️⃣ *Bölüm Aralığı İndir* (Örn: *10-20* veya *5-15* yazarak belirli bölümleri indirebilirsiniz)\n\n` +
          `❌ İptal etmek için *iptal* yazın.`;
        await sock.sendMessage(from, { text: seasonPrompt });
      } catch (err) {
        await sock.sendMessage(from, { text: `❌ Dizi bölümleri alınırken hata oluştu: ${err.message}` });
      }
      return;
    }

    // Tekil Video / Link İndirme
    try {
      const isPlaylist = /[?&]list=/.test(singleUrl) && !/[?&]v=/.test(singleUrl);
      
      if (isYouTubeUrl && !isPlaylist && !isMp3Cmd) {
        const activeProxy = getProxyUrl();
        const proxyArg = activeProxy ? ` --proxy "${activeProxy}"` : '';
        const ytDlpCmd = getYtDlpCommand();
        exec(`"${ytDlpCmd}" ${proxyArg} -F --no-playlist "${singleUrl}"`, async (err, stdout) => {
          if (err) {
            await sock.sendMessage(from, { text: `❌ Format analizi başarısız oldu: ${err.message}` });
            return;
          }
          
          const lines = stdout.split('\n');
          const availableFormats = [];
          const targets = [
            { height: 1080, label: '1080p (FHD)' },
            { height: 720, label: '720p (HD)' },
            { height: 480, label: '480p (SD)' },
            { height: 360, label: '360p (Mobil)' }
          ];

          for (const target of targets) {
            const matchedLine = lines.find(l => {
              return l.includes(`${target.height}p`) || new RegExp(`x${target.height}\\b`).test(l);
            });

            if (matchedLine) {
              const partsLine = matchedLine.trim().split(/\s+/);
              const formatId = partsLine[0];
              let sizeStr = 'Bilinmiyor';
              const sizeMatch = matchedLine.match(/(\d+(?:\.\d+)?\s*[GMK]iB)/i);
              if (sizeMatch) sizeStr = sizeMatch[1];
              
              availableFormats.push({
                format_id: formatId,
                label: `${target.label} [${sizeStr}]`,
                height: target.height
              });
            }
          }

          if (availableFormats.length === 0) {
            availableFormats.push({
              format_id: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
              label: 'Varsayılan En İyi Kalite',
              height: 0
            });
          }

          availableFormats.push({
            format_id: 'mp3',
            label: '🎵 Sadece Ses (MP3 olarak indir)',
            height: -1
          });

          let ytTitle = 'YouTube Video';
          try {
            ytTitle = await new Promise((res) => {
              const activeProxy = getProxyUrl();
              const proxyArg = activeProxy ? ` --proxy "${activeProxy}"` : '';
              exec(`"${ytDlpCmd}" ${proxyArg} --get-title --no-playlist "${singleUrl}"`, (e, o) => res(e ? 'YouTube Video' : o.trim()));
            });
          } catch {}

          pendingSelections[from] = {
            url: singleUrl,
            title: ytTitle,
            formats: availableFormats
          };

          let optionsText = `🎬 *YOUTUBE KALİTE SEÇİMİ*\n\n🎥 *Video:* ${ytTitle}\n\nLütfen indirmek istediğiniz kaliteyi seçin:\n\n`;
          availableFormats.forEach((f, idx) => {
            optionsText += `${idx + 1}️⃣ ${f.label}\n`;
          });
          optionsText += `\n*Seçmek için bu mesaja doğrudan sadece seçeneğin numarasını (Ör: 1) yazarak yanıt verin.*`;

          await sock.sendMessage(from, { text: optionsText });
        });
        return;
      }

      const task = addDownloadTask(singleUrl, from, 'Video Çözümleniyor...', isMp3Cmd ? 'mp3' : null, priority);
      const priorityTag = priority ? '🔴 *ÖNCELİKLİ* ' : '';
      await sock.sendMessage(from, { text: `📥 ${priorityTag}Görev Sıraya Eklendi!\n🎬 *Link:* ${singleUrl}\n🆔 *Görev Numarası:* \`${task.id}\`\n\nKuyruk durumu: \`!kuyruk\`\nİptal etmek için: \`!iptal ${task.id}\`` });
    } catch (err) {
      await sock.sendMessage(from, { text: `⚠️ *Hata:* ${err.message}` });
    }
  }
};
