/* =========================================================================
     GLOBAL STATE & NAVIGATION
     ========================================================================= */
  let activeTab = 'overview';
  let ws = null;
  let telemetryChartInstance = null;
  let plyrInstance = null;
  let activeQueueTasks = [];
  let pendingQueueTasks = [];
  let queueFilterMode = 'all';
  let queueSearchQuery = '';

  // File Explorer State
  let feFiles = [];
  let feCategoryFilter = 'all';
  let feSearchQuery = '';
  let feSortMode = 'date-desc';
  let feViewMode = 'table';
  let currentSendWaFile = '';

  let currentScannedEpisodes = [];
  let currentHentaiItems = [];
  let cachedMediaFiles = [];

  const TAB_TITLES = {
    'overview': { title: 'Genel Bakış', sub: 'Canlı Sistem Özeti' },
    'queue-manager': { title: 'İndirme Kuyruğu', sub: 'Ayrıntılı Görev Monitörü & Yönetimi' },
    'series-wizard': { title: 'Dizi & Anime Sihirbazı', sub: 'Toplu Bölüm Yakalama & İndirme' },
    'hentai-bulk': { title: 'Hentai & Manga Sihirbazı', sub: 'MangaPortalı & HentaiZM Toplu İndirici' },
    'media-vault': { title: 'Dosya Yöneticisi', sub: 'Sunucu Dosya Gezgini & Medya Oynatıcı' },
    'view-once-vault': { title: 'Tek Gönderimlik Kasa', sub: 'Yakalanan Tek Gönderimlik Fotoğraf, Video ve Sesler' },
    'group-permissions': { title: 'Grup İzinleri', sub: 'Grup Bazlı Komut Kısıtlama & Modlar' },
    'premium-manager': { title: '💎 Premium Kullanıcılar', sub: 'Sınırsız Erişim İçin Premium Üye Yönetimi' },
    'whatsapp-station': { title: 'WhatsApp Bağlantısı', sub: 'QR, Eşleşme Kodu & Oturum Yedekleme' },
    'cron-station': { title: 'Zamanlanmış Görevler', sub: 'Cron Otomasyon Motoru' },
    'settings-station': { title: 'Sistem Ayarları', sub: 'Proxy, Sınırlar & Güvenlik' },
    'config-editor': { title: 'config.json Editörü', sub: 'Canlı Yapılandırma, API Anahtarları & Sistem Ayarları' },
    'system-health': { title: 'Sistem Sağlığı', sub: 'Sunucu Bakım & Tanılama' },
    'terminal-logs': { title: 'Konsol & Loglar', sub: 'Gerçek Zamanlı Terminal Akışı' }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatRelativeTime(date) {
    if (!date || isNaN(date.getTime())) return '-';
    const sec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (sec < 60) return `${sec} sn önce`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} dk önce`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} sa önce`;
    return date.toLocaleDateString('tr-TR');
  }

  function switchNavTab(tabId) {
    activeTab = tabId;
    
    // Update view panels
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('view-' + tabId);
    if (target) target.classList.add('active');

    // Update desktop sidebar active link
    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('onclick')?.includes(tabId)) {
        link.classList.add('active');
      }
    });

    // Update bottom nav active item
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
      item.classList.remove('active');
      if (item.getAttribute('onclick')?.includes(tabId)) {
        item.classList.add('active');
      }
    });

    // Update header titles
    const meta = TAB_TITLES[tabId] || { title: 'WPBot Center', sub: 'Komuta Konsolu' };
    document.getElementById('page-heading').innerText = meta.title;
    document.getElementById('page-subheading').innerText = meta.sub;

    // Close mobile drawer if open
    document.getElementById('sidebar').classList.remove('open');

    // Tab-specific initializers
    if (tabId === 'media-vault') loadMediaVault();
    if (tabId === 'view-once-vault') loadViewOnceVault();
    if (tabId === 'group-permissions') loadGroupPermissionsAction();
    if (tabId === 'cron-station') loadCronAction();
    if (tabId === 'settings-station') loadSettingsAction();
    if (tabId === 'config-editor') loadConfigRawEditor();
    if (tabId === 'system-health') loadSystemHealth();
  }

  function toggleMobileSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
  }

  function showToast(text, duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = text;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }

  /* =========================================================================
     WEBSOCKET REAL-TIME CONNECTION
     ========================================================================= */
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected to WPBot Live Server.');
      document.getElementById('sidebar-status-dot').className = 'dot online';
      document.getElementById('sidebar-status-text').innerText = 'Bağlandı';
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWebSocketMessage(msg);
      } catch (err) {
        console.error('[WS Parse Error]', err);
      }
    };

    ws.onclose = () => {
      console.warn('[WS] Disconnected. Retrying in 2s...');
      document.getElementById('sidebar-status-dot').className = 'dot';
      document.getElementById('sidebar-status-text').innerText = 'Koptu';
      setTimeout(initWebSocket, 2000);
    };
  }

  function handleWebSocketMessage(msg) {
    switch (msg.type) {
      case 'TELEMETRY_UPDATE':
        renderTelemetry(msg.data);
        break;
      case 'QUEUE_UPDATE':
        renderQueueUI(msg.data);
        break;
      case 'BOT_STATUS':
        renderBotStatusUI(msg.data);
        break;
      case 'CONSOLE_LOG':
        appendLogLine(msg.data);
        break;
      case 'INITIAL_LOGS':
        if (Array.isArray(msg.data)) {
          msg.data.forEach(l => appendLogLine(l));
        }
        break;
    }
  }

  /* =========================================================================
     TELEMETRY & CHARTS
     ========================================================================= */
  function renderTelemetry(data) {
    if (!data) return;

    // CPU
    if (data.cpu) {
      document.getElementById('metric-cpu-val').innerText = `${data.cpu.usagePercent}%`;
      document.getElementById('metric-cpu-bar').style.width = `${data.cpu.usagePercent}%`;
      document.getElementById('metric-cpu-cores').innerText = `${data.cpu.cores} Çekirdek`;
      if (data.cpu.loadAvg) {
        document.getElementById('metric-cpu-load').innerText = data.cpu.loadAvg.map(n => n.toFixed(2)).join(', ');
      }
    }

    // RAM
    if (data.memory) {
      document.getElementById('metric-ram-val').innerText = `${data.memory.usagePercent}%`;
      document.getElementById('metric-ram-bar').style.width = `${data.memory.usagePercent}%`;
      const totalGb = (data.memory.total / (1024 ** 3)).toFixed(1);
      const usedMb = Math.round(data.memory.used / (1024 ** 2));
      document.getElementById('metric-ram-total').innerText = `${totalGb} GB`;
      document.getElementById('metric-ram-used').innerText = `${usedMb} MB`;
    }

    // Disk
    if (data.disk) {
      const mb = (data.disk.downloadsFolderBytes / (1024 ** 2)).toFixed(1);
      document.getElementById('metric-disk-val').innerText = `${mb} MB`;
      document.getElementById('metric-disk-files').innerText = `${data.disk.fileCount} Dosya`;
      const diskPct = Math.min(100, Math.round((data.disk.downloadsFolderBytes / (15 * 1024 ** 3)) * 100));
      document.getElementById('metric-disk-bar').style.width = `${diskPct}%`;
    }

    // Update Chart
    if (telemetryChartInstance && data.cpu && data.memory) {
      const now = new Date().toLocaleTimeString('tr-TR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const chart = telemetryChartInstance;
      if (chart.data.labels.length > 20) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
        chart.data.datasets[1].data.shift();
      }
      chart.data.labels.push(now);
      chart.data.datasets[0].data.push(data.cpu.usagePercent);
      chart.data.datasets[1].data.push(data.memory.usagePercent);
      chart.update('none');
    }
  }

  function initTelemetryChart() {
    const ctx = document.getElementById('telemetryChart').getContext('2d');
    telemetryChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'CPU %',
            data: [],
            borderColor: '#ffffff',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            pointRadius: 0
          },
          {
            label: 'RAM %',
            data: [],
            borderColor: '#71717a',
            backgroundColor: 'rgba(113, 113, 122, 0.05)',
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: '#71717a', font: { family: 'JetBrains Mono', size: 10 } }
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: '#71717a', font: { family: 'JetBrains Mono', size: 10 } }
          }
        },
        plugins: {
          legend: {
            labels: { color: '#d4d4d8', font: { family: 'Inter', size: 11 } }
          }
        }
      }
    });
  }

  /* =========================================================================
     QUEUE & TASKS UI (DETAILED MONITOR)
     ========================================================================= */
  function filterQueueList(mode) {
    queueFilterMode = mode;
    ['all', 'active', 'pending'].forEach(m => {
      const el = document.getElementById(`q-filter-${m}`);
      if (el) el.classList.toggle('active', m === mode);
    });
    renderDetailedQueueTable();
  }

  function onQueueSearch(val) {
    queueSearchQuery = (val || '').trim();
    renderDetailedQueueTable();
  }

  function renderQueueUI(data) {
    if (!data) return;
    activeQueueTasks = data.activeTasks || [];
    pendingQueueTasks = data.queue || [];

    const totalCount = activeQueueTasks.length + pendingQueueTasks.length;
    document.getElementById('metric-queue-val').innerText = totalCount;
    document.getElementById('metric-active-count').innerText = `${activeQueueTasks.length} İndiriliyor`;
    document.getElementById('metric-queue-bar').style.width = `${Math.min(100, totalCount * 10)}%`;

    // Header Badges
    const actBadge = document.getElementById('queue-header-active-badge');
    if (actBadge) actBadge.innerText = `${activeQueueTasks.length} Aktif`;
    const penBadge = document.getElementById('queue-header-pending-badge');
    if (penBadge) penBadge.innerText = `${pendingQueueTasks.length} Bekleyen`;

    // Filter counts
    const cntAll = document.getElementById('q-cnt-all');
    if (cntAll) cntAll.innerText = totalCount;
    const cntAct = document.getElementById('q-cnt-active');
    if (cntAct) cntAct.innerText = activeQueueTasks.length;
    const cntPen = document.getElementById('q-cnt-pending');
    if (cntPen) cntPen.innerText = pendingQueueTasks.length;

    // Overview Active Cards
    const activeCont = document.getElementById('active-task-container');
    if (activeCont) {
      if (activeQueueTasks.length === 0) {
        activeCont.innerHTML = '<p style="color: var(--text-4); font-size: 13px;">Şu anda aktif indirme yok.</p>';
      } else {
        activeCont.innerHTML = activeQueueTasks.map(t => `
          <div style="background: var(--bg-2); border: 1px solid var(--border-2); border-radius: var(--radius-md); padding: 12px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                <span class="badge-source">${escapeHtml(t.source || 'Web')}</span>
                <span style="font-weight: 700; color: #fff; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(t.title || 'İndirme Görevi')}</span>
              </div>
              <span class="badge badge-white">${t.speed ? t.speed + ' MB/s' : 'İndiriliyor'}</span>
            </div>
            <div style="font-size: 11px; color: var(--text-3); margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(t.statusText || t.status || 'İşleniyor...')}</div>
            <div class="progress-track"><div class="progress-bar" style="width: 100%; animation: pulseAnim 2s infinite;"></div></div>
          </div>
        `).join('');
      }
    }

    // Overview Pending List
    const queueCont = document.getElementById('queue-task-list');
    if (queueCont) {
      if (pendingQueueTasks.length === 0) {
        queueCont.innerHTML = '<p style="color: var(--text-5); font-size: 12px;">Kuyruk boş.</p>';
      } else {
        queueCont.innerHTML = pendingQueueTasks.map((t, idx) => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--border-1); font-size: 12px;">
            <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; max-width: 75%;">
              <span style="font-family: var(--font-mono); color: var(--text-4);">#${idx + 1}</span>
              <span class="badge-source" style="font-size: 9px;">${escapeHtml(t.source || 'Web')}</span>
              <span style="color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(t.title || t.id)}</span>
            </div>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="prioritizeQueueTask('${t.id}')" style="padding: 3px 6px;">⬆️</button>
              <button class="btn btn-danger btn-sm" onclick="cancelQueueTask('${t.id}')" style="padding: 3px 6px;">İptal</button>
            </div>
          </div>
        `).join('');
      }
    }

    renderDetailedQueueTable();
  }

  function renderDetailedQueueTable() {
    const tbody = document.getElementById('detailed-queue-tbody');
    if (!tbody) return;

    let tasksToShow = [];
    if (queueFilterMode === 'all') {
      tasksToShow = [
        ...activeQueueTasks.map(t => ({ ...t, isActive: true })),
        ...pendingQueueTasks.map(t => ({ ...t, isActive: false }))
      ];
    } else if (queueFilterMode === 'active') {
      tasksToShow = activeQueueTasks.map(t => ({ ...t, isActive: true }));
    } else if (queueFilterMode === 'pending') {
      tasksToShow = pendingQueueTasks.map(t => ({ ...t, isActive: false }));
    }

    if (queueSearchQuery) {
      const q = queueSearchQuery.toLowerCase();
      tasksToShow = tasksToShow.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.url && t.url.toLowerCase().includes(q)) ||
        (t.source && t.source.toLowerCase().includes(q)) ||
        (t.recipientJid && t.recipientJid.toLowerCase().includes(q)) ||
        (t.recipientFormatted && t.recipientFormatted.toLowerCase().includes(q)) ||
        (t.id && String(t.id).includes(q))
      );
    }

    if (tasksToShow.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-5); padding: 24px;">Filtreye uygun görev bulunmuyor.</td></tr>';
      return;
    }

    tbody.innerHTML = tasksToShow.map((t, idx) => {
      const isAct = t.isActive;
      const cleanTime = t.addedTime ? formatRelativeTime(new Date(t.addedTime)) : '-';
      const elapsedSec = t.startTime ? Math.max(0, Math.floor((Date.now() - new Date(t.startTime).getTime()) / 1000)) : null;
      const elapsedFormatted = elapsedSec !== null ? `${Math.floor(elapsedSec / 60)}d ${elapsedSec % 60}s` : cleanTime;

      let batchBadge = '';
      if (t.episodeBatch && Array.isArray(t.episodeBatch)) {
        batchBadge = `<span class="badge" style="font-size: 10px; margin-top: 4px;">${t.episodeBatch.length} Bölüm Paketi</span>`;
      } else if (t.seriesPack) {
        batchBadge = `<span class="badge" style="font-size: 10px; margin-top: 4px;">Toplu Seri Paketi</span>`;
      }

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #fff;">#${idx + 1}</span>
              ${t.priority ? `<span title="Öncelikli Görev" style="color: #fff; font-size: 11px;">★</span>` : ''}
            </div>
            <div style="font-family: var(--font-mono); font-size: 10px; color: var(--text-5);">ID: ${t.id}</div>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              <span class="badge-source">${escapeHtml(t.source || 'Web')}</span>
              <span style="font-weight: 600; color: #ffffff; font-size: 13px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(t.title || 'İndirme Görevi')}</span>
            </div>
            <div style="font-size: 11px; color: var(--text-4); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <a href="${escapeHtml(t.url || '#')}" target="_blank" rel="noopener" style="color: var(--text-4); text-decoration: none;">${escapeHtml(t.url || '')}</a>
            </div>
            ${batchBadge}
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 5px;">
              <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              <span style="font-family: var(--font-mono); font-size: 12px; color: #fff; font-weight: 600;">${escapeHtml(t.recipientFormatted || t.recipientJid || 'Sunucu')}</span>
            </div>
            ${t.format ? `<div style="font-size: 10px; color: var(--text-4); margin-top: 2px;">Format: ${escapeHtml(t.format)}</div>` : ''}
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              ${isAct ? `<span class="pulse-indicator"></span>` : ''}
              <span class="badge ${isAct ? 'badge-white' : ''}" style="font-size: 10px;">${isAct ? 'İNDİRİLİYOR' : 'BEKLİYOR'}</span>
              ${isAct && t.speed ? `<span style="font-family: var(--font-mono); font-size: 11px; color: #fff; font-weight: 600;">${t.speed} MB/s</span>` : ''}
            </div>
            <div style="font-size: 11px; color: var(--text-2); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${escapeHtml(t.statusText || t.status || (isAct ? 'İşleniyor...' : 'Kuyrukta bekliyor'))}
            </div>
            <div class="progress-track"><div class="progress-bar" style="width: ${isAct ? '100%' : '0%'};"></div></div>
          </td>
          <td>
            <div style="font-size: 11px; color: #fff; font-family: var(--font-mono);">${elapsedFormatted}</div>
            <div style="font-size: 10px; color: var(--text-5);">${isAct ? 'İşleniyor' : 'Eklendi'}</div>
          </td>
          <td>
            <div style="display: flex; gap: 5px; flex-wrap: wrap;">
              <button class="btn btn-secondary btn-sm" onclick="showTaskDetailModal('${t.id}')" title="Detayları İncele" style="padding: 4px 7px;">🔍</button>
              ${!isAct ? `<button class="btn btn-secondary btn-sm" onclick="prioritizeQueueTask('${t.id}')" title="Öne Al" style="padding: 4px 7px;">⬆️</button>` : ''}
              <button class="btn btn-danger btn-sm" onclick="cancelQueueTask('${t.id}')" title="İptal Et" style="padding: 4px 7px;">✕</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function showTaskDetailModal(taskId) {
    const all = [
      ...activeQueueTasks.map(t => ({ ...t, isActive: true })),
      ...pendingQueueTasks.map(t => ({ ...t, isActive: false }))
    ];
    const task = all.find(t => String(t.id) === String(taskId));
    if (!task) return showToast('Görev detayları bulunamadı.');

    document.getElementById('task-modal-id-badge').innerText = `#${task.id}`;
    const modalContent = document.getElementById('task-modal-content');
    
    modalContent.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <div class="meta-kv"><span class="meta-k">Başlık</span><span class="meta-v" style="font-family: inherit;">${escapeHtml(task.title || '-')}</span></div>
        <div class="meta-kv"><span class="meta-k">Kaynak Platform</span><span class="meta-v">${escapeHtml(task.source || 'Web')}</span></div>
        <div class="meta-kv"><span class="meta-k">Hedef WhatsApp</span><span class="meta-v">${escapeHtml(task.recipientFormatted || task.recipientJid || '-')}</span></div>
        <div class="meta-kv"><span class="meta-k">Durum</span><span class="meta-v">${task.isActive ? '⚡ Aktif İndiriliyor' : '⏳ Kuyrukta Bekliyor'}</span></div>
        <div class="meta-kv"><span class="meta-k">Canlı Mesaj</span><span class="meta-v" style="font-family: inherit;">${escapeHtml(task.statusText || task.status || '-')}</span></div>
        <div class="meta-kv"><span class="meta-k">Hız</span><span class="meta-v">${task.speed ? task.speed + ' MB/s' : '-'}</span></div>
        <div class="meta-kv"><span class="meta-k">Format / Kalite</span><span class="meta-v">${escapeHtml(task.format || 'Otomatik / En Yüksek')}</span></div>
        <div class="meta-kv"><span class="meta-k">Eklenme Saati</span><span class="meta-v">${task.addedTime ? new Date(task.addedTime).toLocaleString('tr-TR') : '-'}</span></div>
        <div class="meta-kv"><span class="meta-k">Başlama Saati</span><span class="meta-v">${task.startTime ? new Date(task.startTime).toLocaleString('tr-TR') : '-'}</span></div>
        <div class="meta-kv"><span class="meta-k">Öncelik</span><span class="meta-v">${task.priority ? '★ Yüksek Öncelik' : 'Normal'}</span></div>
        <div class="meta-kv"><span class="meta-k">URL Linki</span><span class="meta-v" style="font-size: 11px;"><a href="${escapeHtml(task.url || '')}" target="_blank" rel="noopener" style="color: #fff; text-decoration: underline;">${escapeHtml(task.url || '')}</a></span></div>
      </div>
    `;

    document.getElementById('queue-task-detail-modal').classList.add('active');
  }

  function closeTaskDetailModal() {
    document.getElementById('queue-task-detail-modal').classList.remove('active');
  }

  async function cancelQueueTask(taskId) {
    try {
      const res = await fetch('/api/indir/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, taskId })
      });
      const data = await res.json();
      if (data.success) showToast('Görev iptal edildi.');
      else showToast('Hata: ' + (data.error || 'İptal edilemedi'));
    } catch (e) {
      showToast('İstek hatası: ' + e.message);
    }
  }

  async function prioritizeQueueTask(taskId) {
    try {
      const res = await fetch('/api/indir/prioritize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, taskId })
      });
      const data = await res.json();
      if (data.success) showToast('Görev kuyruk başına taşındı.');
      else showToast('Hata: ' + (data.error || 'Öne alınamadı'));
    } catch (e) {
      showToast('İstek hatası: ' + e.message);
    }
  }

  async function clearQueueAction() {
    if (!confirm('Tüm bekleyen indirmeler temizlensin mi?')) return;
    try {
      await fetch('/api/kuyruk-temizle', { method: 'POST' });
      showToast('Kuyruk temizlendi.');
    } catch (e) {
      showToast('Hata: ' + e.message);
    }
  }

  async function pauseQueueToggle() {
    try {
      const btn1 = document.getElementById('queue-pause-btn');
      const btn2 = document.getElementById('btn-pause-queue');
      const isPaused = (btn1 && btn1.innerText.includes('Devam')) || (btn2 && btn2.innerText.includes('Devam'));
      const endpoint = isPaused ? '/api/kuyruk-devam' : '/api/kuyruk-duraklat';
      await fetch(endpoint, { method: 'POST' });
      if (btn1) btn1.innerText = isPaused ? 'Kuyruğu Duraklat' : 'Kuyruğa Devam Et';
      if (btn2) btn2.innerText = isPaused ? 'Duraklat' : 'Devam Et';
      showToast(isPaused ? 'Kuyruk devam ettiriliyor.' : 'Kuyruk duraklatıldı.');
    } catch (e) {
      showToast('Hata: ' + e.message);
    }
  }

  /* =========================================================================
     QUICK DOWNLOAD FORM
     ========================================================================= */
  function setQuickUrl(url) {
    document.getElementById('input-quick-url').value = url;
    document.getElementById('input-quick-url').focus();
  }

  async function handleQuickDownload(e) {
    e.preventDefault();
    const url = document.getElementById('input-quick-url').value.trim();
    const phone = document.getElementById('input-quick-phone').value.trim();
    const mode = document.getElementById('input-quick-mode').value;

    if (!url) return;

    const btn = document.getElementById('btn-quick-submit');
    btn.disabled = true;
    btn.innerText = 'Görev İletiliyor...';

    try {
      const res = await fetch('/api/indir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, phone, priority: mode === 'high' || mode === 'now' })
      });
      const data = await res.json();
      if (data.success) {
        showToast('İndirme görevi başarıyla kuyruğa alındı!');
        document.getElementById('input-quick-url').value = '';
      } else {
        showToast('Hata: ' + (data.error || 'İndirme başlatılamadı.'));
      }
    } catch (err) {
      showToast('Bağlantı hatası: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerText = 'İndirme Görevini Başlat';
    }
  }

  /* =========================================================================
     SERIES & ANIME WIZARD
     ========================================================================= */
  async function fetchSeriesEpisodes() {
    const url = document.getElementById('series-wizard-url').value.trim();
    if (!url) return showToast('Lütfen bir dizi/anime URL girin.');

    const btn = document.getElementById('series-wizard-fetch-btn');
    btn.disabled = true;
    btn.innerText = 'Taranıyor...';

    try {
      const res = await fetch(`/api/fetch-episodes?url=${encodeURIComponent(url)}`);
      const data = await res.json();

      if (!data.success || !data.episodes || data.episodes.length === 0) {
        showToast('Bölümler bulunamadı veya site desteklenmiyor.');
        return;
      }

      currentScannedEpisodes = data.episodes;
      document.getElementById('series-detected-title').innerText = `${data.title || 'Dizi'} (${data.episodes.length} Bölüm)`;
      
      const cont = document.getElementById('series-episodes-container');
      cont.innerHTML = data.episodes.map((ep, idx) => `
        <label style="display: flex; align-items: center; gap: 8px; background: var(--bg-1); padding: 8px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-1); font-size: 12px; cursor: pointer;">
          <input type="checkbox" class="series-ep-check" data-index="${idx}" checked>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${ep.name || 'Bölüm ' + (idx + 1)}</span>
        </label>
      `).join('');

      document.getElementById('series-step2-panel').style.display = 'block';
      showToast(`${data.episodes.length} bölüm listelendi.`);
    } catch (err) {
      showToast('Hata: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerText = 'Bölümleri Getir';
    }
  }

  function toggleSelectAllEpisodes(state) {
    document.querySelectorAll('.series-ep-check').forEach(cb => cb.checked = state);
  }

  async function downloadSelectedSeriesEpisodes() {
    const selected = [];
    document.querySelectorAll('.series-ep-check:checked').forEach(cb => {
      const idx = parseInt(cb.getAttribute('data-index'), 10);
      if (currentScannedEpisodes[idx]) {
        selected.push(currentScannedEpisodes[idx]);
      }
    });

    if (selected.length === 0) return showToast('En az bir bölüm seçmelisiniz.');

    const phone = document.getElementById('series-target-phone').value.trim();
    const btn = document.getElementById('series-bulk-download-btn');
    btn.disabled = true;
    btn.innerText = 'Kuyruğa Ekleniyor...';

    try {
      const res = await fetch('/api/indir-multiple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodes: selected, phone })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`${selected.length} bölüm başarıyla kuyruğa eklendi!`);
        switchNavTab('overview');
      } else {
        showToast('Hata: ' + (data.error || 'İşlem başarısız'));
      }
    } catch (err) {
      showToast('İstek hatası: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerText = 'Seçili Bölümleri Kuyruğa Ekle';
    }
  }

  /* =========================================================================
     HENTAI & MANGA WIZARD
     ========================================================================= */
  function switchHentaiMode(mode) {
    document.getElementById('hentai-mode-scan-btn').classList.toggle('active', mode === 'scan');
    document.getElementById('hentai-mode-manual-btn').classList.toggle('active', mode === 'manual');
    document.getElementById('hentai-scan-container').style.display = mode === 'scan' ? 'block' : 'none';
    document.getElementById('hentai-manual-container').style.display = mode === 'manual' ? 'block' : 'none';
  }

  async function scanHentaiListingAction() {
    const url = document.getElementById('hentai-scan-url').value.trim();
    const startPage = parseInt(document.getElementById('hentai-scan-start-page').value, 10) || 1;
    const endPage = parseInt(document.getElementById('hentai-scan-end-page').value, 10) || 1;

    if (!url) return showToast('Lütfen bir kategori/seri linki girin.');

    const btn = document.getElementById('hentai-scan-btn');
    btn.disabled = true;
    btn.innerText = 'Taranıyor...';

    try {
      const res = await fetch('/api/hentai/scan-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, startPage, endPage })
      });
      const data = await res.json();

      if (!data.success || !data.items || data.items.length === 0) {
        showToast('İçerik bulunamadı.');
        return;
      }

      currentHentaiItems = data.items;
      document.getElementById('hentai-results-counter').innerText = `${data.items.length} içerik bulundu`;
      
      const grid = document.getElementById('hentai-cards-grid');
      grid.innerHTML = data.items.map((item, idx) => `
        <label style="display: flex; gap: 10px; background: var(--bg-1); border: 1px solid var(--border-1); padding: 10px; border-radius: var(--radius-md); cursor: pointer; align-items: center;">
          <input type="checkbox" class="hentai-item-check" data-index="${idx}" checked>
          <div style="flex: 1; overflow: hidden;">
            <div style="font-weight: 700; color: #fff; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.title || 'Manga / Hentai'}</div>
            <div style="font-size: 10px; color: var(--text-4); font-family: var(--font-mono);">${item.type || 'Media'}</div>
          </div>
        </label>
      `).join('');

      document.getElementById('hentai-results-panel').style.display = 'block';
      showToast(`${data.items.length} içerik listelendi.`);
    } catch (e) {
      showToast('Hata: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.innerText = 'İçerikleri Tara';
    }
  }

  function toggleSelectAllHentai(state) {
    document.querySelectorAll('.hentai-item-check').forEach(cb => cb.checked = state);
  }

  async function queueSelectedHentai() {
    const selected = [];
    document.querySelectorAll('.hentai-item-check:checked').forEach(cb => {
      const idx = parseInt(cb.getAttribute('data-index'), 10);
      if (currentHentaiItems[idx]) selected.push(currentHentaiItems[idx]);
    });

    if (selected.length === 0) return showToast('Lütfen en az bir içerik seçin.');

    try {
      const res = await fetch('/api/hentai/queue-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selected })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`${selected.length} içerik kuyruğa eklendi!`);
        switchNavTab('overview');
      }
    } catch (e) {
      showToast('İstek hatası: ' + e.message);
    }
  }

  /* =========================================================================
     FILE EXPLORER (DOSYA YÖNETİCİSİ) & MULTI-FORMAT PREVIEW
     ========================================================================= */
  async function loadMediaVault() {
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      feFiles = data.files || [];

      // Update counters
      const counts = { all: feFiles.length, pdf: 0, video: 0, audio: 0, archive: 0, other: 0 };
      feFiles.forEach(f => {
        if (counts[f.category] !== undefined) counts[f.category]++;
        else counts.other++;
      });

      const cntAll = document.getElementById('fe-cnt-all');
      if (cntAll) cntAll.innerText = counts.all;
      const cntPdf = document.getElementById('fe-cnt-pdf');
      if (cntPdf) cntPdf.innerText = counts.pdf;
      const cntVid = document.getElementById('fe-cnt-video');
      if (cntVid) cntVid.innerText = counts.video;
      const cntAud = document.getElementById('fe-cnt-audio');
      if (cntAud) cntAud.innerText = counts.audio;
      const cntArc = document.getElementById('fe-cnt-archive');
      if (cntArc) cntArc.innerText = counts.archive;
      const cntOth = document.getElementById('fe-cnt-other');
      if (cntOth) cntOth.innerText = counts.other;

      const statsEl = document.getElementById('fe-stats-badge');
      if (statsEl) {
        statsEl.innerText = `${counts.all} Dosya • ${data.totalBytesFormatted || '0 B'}`;
      }

      renderFileExplorer();
    } catch (e) {
      showToast('Dosyalar yüklenirken hata oluştu: ' + e.message);
    }
  }

  function setFileCategoryFilter(cat) {
    feCategoryFilter = cat;
    const pills = document.querySelectorAll('#fe-filter-pills .pill');
    pills.forEach(p => {
      const onclickAttr = p.getAttribute('onclick') || '';
      p.classList.toggle('active', onclickAttr.includes(`'${cat}'`));
    });
    renderFileExplorer();
  }

  function onFileSearch(val) {
    feSearchQuery = (val || '').trim().toLowerCase();
    renderFileExplorer();
  }

  function onFileSortChange(val) {
    feSortMode = val;
    renderFileExplorer();
  }

  function setFileViewMode(mode) {
    feViewMode = mode;
    const btnTable = document.getElementById('fe-btn-view-table');
    const btnGrid = document.getElementById('fe-btn-view-grid');
    if (btnTable) btnTable.classList.toggle('active', mode === 'table');
    if (btnGrid) btnGrid.classList.toggle('active', mode === 'grid');
    renderFileExplorer();
  }

  function getFileIcon(cat, ext) {
    if (cat === 'pdf') return '📖';
    if (cat === 'video') return '🎬';
    if (cat === 'audio') return '🎵';
    if (cat === 'archive') return '📦';
    if (cat === 'image') return '🖼️';
    return '📁';
  }

  function renderFileExplorer() {
    let files = [...feFiles];

    // Filter by Category
    if (feCategoryFilter !== 'all') {
      files = files.filter(f => f.category === feCategoryFilter);
    }

    // Filter by Search Query
    if (feSearchQuery) {
      files = files.filter(f => f.name.toLowerCase().includes(feSearchQuery));
    }

    // Sort
    files.sort((a, b) => {
      if (feSortMode === 'date-desc') return new Date(b.mtime) - new Date(a.mtime);
      if (feSortMode === 'date-asc') return new Date(a.mtime) - new Date(b.mtime);
      if (feSortMode === 'name-asc') return a.name.localeCompare(b.name);
      if (feSortMode === 'name-desc') return b.name.localeCompare(a.name);
      if (feSortMode === 'size-desc') return (b.sizeBytes || 0) - (a.sizeBytes || 0);
      if (feSortMode === 'size-asc') return (a.sizeBytes || 0) - (b.sizeBytes || 0);
      return 0;
    });

    const tableContainer = document.getElementById('fe-container-table');
    const gridContainer = document.getElementById('fe-container-grid');
    const tbody = document.getElementById('media-vault-tbody');

    if (!tableContainer || !gridContainer || !tbody) return;

    if (feViewMode === 'table') {
      tableContainer.style.display = 'block';
      gridContainer.style.display = 'none';

      if (files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-5); padding: 32px;">Bu filtrede dosya bulunmuyor.</td></tr>';
        return;
      }

      tbody.innerHTML = files.map(f => {
        const icon = getFileIcon(f.category, f.ext);
        return `
          <tr>
            <td><input type="checkbox" class="vault-item-check" data-name="${escapeHtml(f.name)}"></td>
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">${icon}</span>
                <a href="javascript:void(0)" onclick="previewFile('${encodeURIComponent(f.name)}', '${f.category}', '${f.downloadUrl}')" style="font-weight: 600; color: #fff; text-decoration: none; max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(f.name)}">
                  ${escapeHtml(f.name)}
                </a>
              </div>
            </td>
            <td><span class="badge" style="font-size: 10px;">${f.category.toUpperCase()} (${escapeHtml(f.ext)})</span></td>
            <td style="font-family: var(--font-mono); font-size: 12px; color: #fff;">${f.sizeFormatted}</td>
            <td style="color: var(--text-4); font-size: 11px;">${f.dateFormatted}</td>
            <td>
              <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                <button class="btn btn-primary btn-sm" onclick="previewFile('${encodeURIComponent(f.name)}', '${f.category}', '${f.downloadUrl}')" style="padding: 4px 7px;">👁️ Aç</button>
                <button class="btn btn-secondary btn-sm" onclick="openSendWaModal('${encodeURIComponent(f.name)}')" title="WhatsApp'a Gönder" style="padding: 4px 7px;">📲 WA</button>
                <a href="${f.downloadUrl}" download class="btn btn-secondary btn-sm" style="padding: 4px 7px;" title="İndir">⬇️</a>
                <button class="btn btn-secondary btn-sm" onclick="renameFilePrompt('${encodeURIComponent(f.name)}')" title="Yeniden Adlandır" style="padding: 4px 7px;">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="deleteMediaFile('${encodeURIComponent(f.name)}')" title="Sil" style="padding: 4px 7px;">🗑️</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } else {
      tableContainer.style.display = 'none';
      gridContainer.style.display = 'grid';

      if (files.length === 0) {
        gridContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-5); padding: 32px;">Bu filtrede dosya bulunmuyor.</div>';
        return;
      }

      gridContainer.innerHTML = files.map(f => {
        const icon = getFileIcon(f.category, f.ext);
        return `
          <div class="fe-card">
            <div class="fe-top">
              <input type="checkbox" class="vault-item-check" data-name="${escapeHtml(f.name)}" style="margin-top: 3px;">
              <div class="fe-icon-box">${icon}</div>
              <div class="fe-name" title="${escapeHtml(f.name)}" onclick="previewFile('${encodeURIComponent(f.name)}', '${f.category}', '${f.downloadUrl}')" style="cursor: pointer;">
                ${escapeHtml(f.name)}
              </div>
            </div>
            <div class="fe-meta">
              <span>${f.sizeFormatted}</span>
              <span>${f.dateFormatted.split(' ')[0]}</span>
            </div>
            <div class="fe-actions">
              <button class="btn btn-primary btn-sm" onclick="previewFile('${encodeURIComponent(f.name)}', '${f.category}', '${f.downloadUrl}')" style="flex: 1; padding: 4px 6px;">Aç</button>
              <button class="btn btn-secondary btn-sm" onclick="openSendWaModal('${encodeURIComponent(f.name)}')" title="WhatsApp" style="padding: 4px 6px;">📲</button>
              <a href="${f.downloadUrl}" download class="btn btn-secondary btn-sm" style="padding: 4px 6px;" title="İndir">⬇️</a>
              <button class="btn btn-secondary btn-sm" onclick="renameFilePrompt('${encodeURIComponent(f.name)}')" title="Adlandır" style="padding: 4px 6px;">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="deleteMediaFile('${encodeURIComponent(f.name)}')" title="Sil" style="padding: 4px 6px;">🗑️</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  function toggleSelectAllVault(state) {
    document.querySelectorAll('.vault-item-check').forEach(cb => cb.checked = state);
  }

  function previewFile(encodedName, category, downloadUrl) {
    const rawName = decodeURIComponent(encodedName);
    const modal = document.getElementById('file-preview-modal');
    const titleEl = document.getElementById('preview-modal-title');
    const badgeEl = document.getElementById('preview-modal-type-badge');
    const dlLink = document.getElementById('preview-modal-download-link');
    const bodyEl = document.getElementById('preview-modal-body');

    titleEl.innerText = rawName;
    badgeEl.innerText = (category || 'DOSYA').toUpperCase();
    dlLink.href = downloadUrl;

    if (category === 'pdf') {
      bodyEl.innerHTML = `<iframe src="${downloadUrl}#toolbar=1" style="width: 100%; height: 75vh; border: none; background: #27272a;"></iframe>`;
    } else if (category === 'video') {
      bodyEl.innerHTML = `<video id="modal-preview-video" playsinline controls style="width: 100%; max-height: 520px;" src="${downloadUrl}"></video>`;
      setTimeout(() => {
        const vid = document.getElementById('modal-preview-video');
        if (vid) vid.play().catch(() => {});
      }, 100);
    } else if (category === 'audio') {
      bodyEl.innerHTML = `
        <div style="padding: 48px 24px; text-align: center; width: 100%;">
          <div style="font-size: 48px; margin-bottom: 16px;">🎵</div>
          <div style="font-weight: 600; color: #fff; margin-bottom: 20px; font-size: 15px;">${escapeHtml(rawName)}</div>
          <audio controls autoplay style="width: 80%; max-width: 480px;" src="${downloadUrl}"></audio>
        </div>
      `;
    } else if (category === 'image') {
      bodyEl.innerHTML = `<img src="${downloadUrl}" style="max-width: 100%; max-height: 75vh; object-fit: contain; padding: 12px;">`;
    } else {
      bodyEl.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-3);">
          <div style="font-size: 44px; margin-bottom: 12px;">📁</div>
          <p style="margin-bottom: 16px; color: #fff;">Bu dosya türü için tarayıcı içi önizleme desteklenmiyor.</p>
          <a href="${downloadUrl}" download class="btn btn-primary">Dosyayı İndir</a>
        </div>
      `;
    }

    modal.classList.add('active');
  }

  function closeFilePreviewModal() {
    const modal = document.getElementById('file-preview-modal');
    const bodyEl = document.getElementById('preview-modal-body');
    bodyEl.innerHTML = '';
    modal.classList.remove('active');
  }

  function openSendWaModal(encodedName) {
    const rawName = decodeURIComponent(encodedName);
    currentSendWaFile = rawName;
    document.getElementById('wa-send-file-name').value = rawName;
    
    const savedPhone = localStorage.getItem('last_wa_recipient') || '05332624732';
    document.getElementById('wa-send-phone-input').value = savedPhone;
    document.getElementById('wa-send-caption-input').value = '';

    document.getElementById('file-send-wa-modal').classList.add('active');
  }

  function closeSendWaModal() {
    document.getElementById('file-send-wa-modal').classList.remove('active');
  }

  async function submitSendFileToWa() {
    const phone = document.getElementById('wa-send-phone-input').value.trim();
    const caption = document.getElementById('wa-send-caption-input').value.trim();
    const btn = document.getElementById('wa-send-submit-btn');

    if (!phone) return showToast('Lütfen telefon numarası girin.');
    if (!currentSendWaFile) return showToast('Dosya seçilmedi.');

    localStorage.setItem('last_wa_recipient', phone);

    btn.disabled = true;
    btn.innerText = 'Gönderiliyor...';

    try {
      const res = await fetch('/api/files/send-wa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: currentSendWaFile, phone, caption })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Dosya WhatsApp gönderim kuyruğuna alındı!');
        closeSendWaModal();
      } else {
        showToast('Hata: ' + (data.error || 'Gönderilemedi'));
      }
    } catch (e) {
      showToast('İstek hatası: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.innerText = 'WhatsApp\'a Gönder 🚀';
    }
  }

  async function sendSelectedFilesPrompt() {
    const selected = [];
    document.querySelectorAll('.vault-item-check:checked').forEach(cb => {
      selected.push(cb.getAttribute('data-name'));
    });
    if (selected.length === 0) return showToast('Lütfen gönderilecek en az bir dosya seçin.');

    if (selected.length === 1) {
      return openSendWaModal(encodeURIComponent(selected[0]));
    }

    const defaultNum = localStorage.getItem('last_wa_recipient') || '05332624732';
    const phone = prompt(`${selected.length} adet dosyayı WhatsApp üzerinden göndermek istediğiniz numarayı girin:`, defaultNum);
    if (!phone) return;

    localStorage.setItem('last_wa_recipient', phone);
    showToast(`${selected.length} dosya gönderim kuyruğuna ekleniyor...`);

    let sent = 0;
    for (const f of selected) {
      try {
        await fetch('/api/files/send-wa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: f, phone })
        });
        sent++;
      } catch (e) {}
    }
    showToast(`${sent} dosya WhatsApp gönderimine alındı!`);
  }

  async function renameFilePrompt(encodedName) {
    const rawName = decodeURIComponent(encodedName);
    const newName = prompt('Yeni dosya adını girin:', rawName);
    if (!newName || newName.trim() === '' || newName === rawName) return;

    try {
      const res = await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldName: rawName, newName: newName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Dosya yeniden adlandırıldı: ' + data.newName);
        loadMediaVault();
      } else {
        showToast('Hata: ' + (data.error || 'Adlandırılamadı'));
      }
    } catch (e) {
      showToast('İstek hatası: ' + e.message);
    }
  }

  async function deleteMediaFile(encodedName) {
    const rawName = decodeURIComponent(encodedName);
    if (!confirm(`"${rawName}" dosyasını sunucudan silmek istediğinize emin misiniz?`)) return;

    try {
      const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: rawName })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Dosya silindi.');
        loadMediaVault();
      } else {
        showToast('Hata: ' + (data.error || 'Silinemedi'));
      }
    } catch (e) {
      showToast('Silme hatası: ' + e.message);
    }
  }

  async function deleteSelectedFilesAction() {
    const selected = [];
    document.querySelectorAll('.vault-item-check:checked').forEach(cb => {
      selected.push(cb.getAttribute('data-name'));
    });
    if (selected.length === 0) return showToast('Lütfen silmek için dosya seçin.');

    if (!confirm(`Seçilen ${selected.length} dosyayı kalıcı olarak silmek istiyor musunuz?`)) return;

    try {
      const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: selected })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`${data.deletedCount || selected.length} dosya silindi.`);
        loadMediaVault();
      }
    } catch (e) {
      showToast('Silme hatası: ' + e.message);
    }
  }

  async function zipSelectedFiles() {
    const selected = [];
    document.querySelectorAll('.vault-item-check:checked').forEach(cb => {
      selected.push(cb.getAttribute('data-name'));
    });

    if (selected.length === 0) return showToast('Lütfen sıkıştırmak için dosya seçin.');

    showToast('ZIP arşivi oluşturuluyor...');
    try {
      const res = await fetch('/api/files/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: selected })
      });
      const data = await res.json();
      if (data.success && data.zipUrl) {
        window.location.href = data.zipUrl;
        showToast('ZIP arşivi hazır, indirme başladı!');
        loadMediaVault();
      } else {
        showToast('ZIP hatası: ' + (data.error || 'Bilinmiyor'));
      }
    } catch (e) {
      showToast('ZIP oluşturulamadı: ' + e.message);
    }
  }

  function openVideoModal(encodedName) {
    previewFile(encodedName, 'video', `/downloads/${encodedName}`);
  }

  function closeVideoModal() {
    closeFilePreviewModal();
  }

  /* =========================================================================
     WHATSAPP STATION & PERMISSIONS
     ========================================================================= */
  function renderBotStatusUI(data) {
    if (!data) return;
    const badge = document.getElementById('wa-connection-badge');
    const dot = document.getElementById('sidebar-status-dot');
    const statusText = document.getElementById('sidebar-status-text');

    if (data.status === 'online') {
      badge.innerText = 'Çevrimiçi (Bağlı)';
      badge.className = 'badge badge-white';
      dot.className = 'dot online';
      statusText.innerText = 'Online';
      document.getElementById('wa-pairing-code-display').style.display = 'none';
      document.getElementById('wa-qr-img-container').style.display = 'none';
    } else {
      badge.innerText = 'Bağlantı Bekleniyor';
      badge.className = 'badge';
      dot.className = 'dot';
      statusText.innerText = 'Bağlantı Yok';
    }

    if (data.pairingCode) {
      const codeDisplay = document.getElementById('wa-pairing-code-display');
      codeDisplay.innerText = data.pairingCode;
      codeDisplay.style.display = 'block';
    }

    if (data.qrCodeUrl) {
      document.getElementById('wa-qr-image').src = data.qrCodeUrl;
      document.getElementById('wa-qr-img-container').style.display = 'block';
    }
  }

  async function requestNewPairingCode() {
    const phone = document.getElementById('wa-pairing-phone').value.trim();
    if (!phone) return showToast('Lütfen telefon numaranızı girin.');

    try {
      showToast('Eşleşme kodu isteniyor...');
      const res = await fetch('/api/request-pairing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (data.pairingCode) {
        document.getElementById('wa-pairing-code-display').innerText = data.pairingCode;
        document.getElementById('wa-pairing-code-display').style.display = 'block';
        showToast('Eşleşme kodu üretildi!');
      }
    } catch (e) {
      showToast('Hata: ' + e.message);
    }
  }

  async function requestQrAction() {
    try {
      showToast('QR Kod talep ediliyor...');
      const res = await fetch('/api/request-qr', { method: 'POST' });
      const data = await res.json();
      if (data.qrCodeUrl) {
        document.getElementById('wa-qr-image').src = data.qrCodeUrl;
        document.getElementById('wa-qr-img-container').style.display = 'block';
      }
    } catch (e) {
      showToast('QR üretilemedi: ' + e.message);
    }
  }

  async function backupSessionAction() {
    try {
      const res = await fetch('/api/session/backup', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Oturum başarıyla yedeklendi!');
        document.getElementById('wa-backup-status-text').innerText = 'Son yedek: ' + new Date().toLocaleString('tr-TR');
      }
    } catch (e) {
      showToast('Yedekleme hatası: ' + e.message);
    }
  }

  async function restoreSessionAction() {
    if (!confirm('Son oturum yedeği geri yüklensin mi?')) return;
    try {
      const res = await fetch('/api/session/restore', { method: 'POST' });
      const data = await res.json();
      if (data.success) showToast('Yedek geri yüklendi! Bot yeniden başlatılıyor...');
    } catch (e) {
      showToast('Geri yükleme hatası: ' + e.message);
    }
  }

  async function resetSessionAction() {
    if (!confirm('DİKKAT: WhatsApp oturumu tamamen silinecek ve çıkış yapılacak!')) return;
    try {
      const res = await fetch('/api/session/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) showToast('Oturum sıfırlandı.');
    } catch (e) {
      showToast('Sıfırlama hatası: ' + e.message);
    }
  }

  /* =========================================================================
     GROUP PERMISSIONS UI
     ========================================================================= */
  async function loadGroupPermissionsAction() {
    try {
      // Load categories
      const catRes = await fetch('/api/permissions/categories');
      const catData = await catRes.json();
      if (catData.categories) {
        const cont = document.getElementById('gp-category-checkboxes');
        cont.innerHTML = Object.entries(catData.categories).map(([k, v]) => `
          <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #fff; cursor: pointer;">
            <input type="checkbox" class="gp-cat-check" value="${k}">
            <span>${v.name || k}</span>
          </label>
        `).join('');
      }

      // Load active group rules
      const gpRes = await fetch('/api/permissions/groups');
      const gpData = await gpRes.json();
      const tbody = document.getElementById('gp-table-tbody');

      if (!gpData.groups || Object.keys(gpData.groups).length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-5);">Henüz özel kural tanımlanmış grup yok.</td></tr>';
        return;
      }

      tbody.innerHTML = Object.entries(gpData.groups).map(([jid, cfg]) => `
        <tr>
          <td style="font-family: var(--font-mono); font-size: 11px;">${jid}</td>
          <td><span class="badge ${cfg.mode === 'whitelist' ? 'badge-white' : ''}">${cfg.mode === 'whitelist' ? 'Beyaz Liste' : 'Kara Liste'}</span></td>
          <td>${cfg.categories ? cfg.categories.join(', ') : 'Tümü'}</td>
          <td>${cfg.silent ? 'Evet' : 'Hayır'}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="editGroupPermission('${jid}')">Düzenle</button>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      console.error('Group permission load error:', e);
    }
  }

  async function fetchWhatsAppGroupsAction() {
    try {
      showToast('WhatsApp grupları taranıyor...');
      const res = await fetch('/api/permissions/whatsapp-groups');
      const data = await res.json();
      if (data.groups) {
        const select = document.getElementById('gp-group-select');
        select.innerHTML = '<option value="">-- Kayıtlı / Taranan Gruplardan Seç --</option>' +
          data.groups.map(g => `<option value="${g.id}">${g.name} (${g.id})</option>`).join('');
        showToast(`${data.groups.length} WhatsApp grubu bulundu.`);
      }
    } catch (e) {
      showToast('Gruplar alınamadı: ' + e.message);
    }
  }

  function onSelectWhatsAppGroup(jid) {
    if (jid) document.getElementById('gp-group-jid').value = jid;
  }

  function toggleGpModeHelp() {}

  async function saveGroupPermissionAction() {
    const jid = document.getElementById('gp-group-jid').value.trim();
    if (!jid) return showToast('Lütfen bir Grup JID girin.');

    const mode = document.getElementById('gp-mode-select').value;
    const silent = document.getElementById('gp-silent-check').checked;
    const categories = [];
    document.querySelectorAll('.gp-cat-check:checked').forEach(cb => categories.push(cb.value));

    try {
      const res = await fetch(`/api/permissions/groups/${encodeURIComponent(jid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, silent, categories })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Grup izinleri başarıyla kaydedildi!');
        loadGroupPermissionsAction();
      }
    } catch (e) {
      showToast('Hata: ' + e.message);
    }
  }

  async function deleteGroupPermissionAction() {
    const jid = document.getElementById('gp-group-jid').value.trim();
    if (!jid) return showToast('Lütfen Grup JID girin.');

    try {
      await fetch(`/api/permissions/groups/${encodeURIComponent(jid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true })
      });
      showToast('Grup kuralları sıfırlandı.');
      loadGroupPermissionsAction();
    } catch (e) {
      showToast('Hata: ' + e.message);
    }
  }

  /* =========================================================================
     VIEW-ONCE VAULT (TEK GÖNDERİMLİK MEDYA KASASI) & DEPOT GROUP SELECTOR
     ========================================================================= */
  let viewOnceItems = [];
  let viewOnceCurrentFilter = 'all';
  let loadedWhatsAppGroups = [];

  async function loadDepotGroupStatus() {
    try {
      const res = await fetch('/api/groups');
      const data = await res.json();
      const currentJid = data.depotGroupJid || '';
      const textEl = document.getElementById('depot-group-current-text');
      const badgeEl = document.getElementById('depot-status-indicator');

      if (!textEl || !badgeEl) return;

      if (currentJid) {
        const match = (data.groups || []).find(g => g.jid === currentJid);
        const name = match ? match.name : currentJid;
        textEl.innerHTML = `Mevcut Depo: <b style="color: #ffffff;">${escapeHtml(name)}</b> <span style="color: var(--text-4); font-size: 11px;">(${escapeHtml(currentJid)})</span>`;
        badgeEl.innerText = 'Aktif';
        badgeEl.style.background = '#ffffff';
        badgeEl.style.color = '#000000';
      } else {
        textEl.innerHTML = 'Mevcut Depo Grubu: <span style="color: #ef4444; font-weight: 600;">Henüz Seçilmedi (Yukarıdan grubu seçip kaydedin)</span>';
        badgeEl.innerText = 'Seçilmedi';
        badgeEl.style.background = 'var(--bg-3)';
        badgeEl.style.color = '#ffffff';
      }

      if (data.groups && data.groups.length > 0) {
        renderDepotGroupOptions(data.groups, currentJid);
      }
    } catch (e) {
      console.warn('Depot group load error:', e);
    }
  }

  function renderDepotGroupOptions(groups, currentJid) {
    const select = document.getElementById('depot-group-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- Depo Grubu Seçin --</option>' + groups.map(g => {
      const isSel = g.jid === currentJid ? 'selected' : '';
      return `<option value="${escapeHtml(g.jid)}" ${isSel}>📁 ${escapeHtml(g.name)} (${g.participantsCount} üye) ${g.jid === currentJid ? '★ [Mevcut Depo]' : ''}</option>`;
    }).join('');
  }

  async function fetchDynamicGroupsAction() {
    const btn = document.getElementById('btn-fetch-groups');
    if (btn) {
      btn.disabled = true;
      btn.innerText = 'Taranıyor...';
    }

    try {
      const res = await fetch('/api/groups');
      const data = await res.json();

      if (!data.connected) {
        showToast(data.message || 'WhatsApp bot bağlı değil! Önce WhatsApp bağlantısını kurun.');
        return;
      }

      loadedWhatsAppGroups = data.groups || [];
      renderDepotGroupOptions(loadedWhatsAppGroups, data.depotGroupJid);
      loadDepotGroupStatus();
      showToast(`${loadedWhatsAppGroups.length} adet WhatsApp grubu başarıyla çekildi!`);
    } catch (err) {
      showToast('Gruplar çekilemedi: ' + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerText = '🔄 WhatsApp Gruplarını Getir';
      }
    }
  }

  async function saveDepotGroupAction() {
    const select = document.getElementById('depot-group-select');
    const selectedJid = select?.value;

    if (!selectedJid) {
      return showToast('Lütfen listeden bir depo grubu seçin.');
    }

    try {
      const res = await fetch('/api/settings/depot-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depotGroupJid: selectedJid })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Depo grubu başarıyla kaydedildi!');
        loadDepotGroupStatus();
      } else {
        showToast('Hata: ' + (data.error || 'Kaydedilemedi'));
      }
    } catch (err) {
      showToast('Hata: ' + err.message);
    }
  }

  async function testDepotGroupAction() {
    const select = document.getElementById('depot-group-select');
    const selectedJid = select?.value;

    showToast('Depo grubuna test mesajı gönderiliyor...');
    try {
      const res = await fetch('/api/settings/test-depot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depotGroupJid: selectedJid || undefined })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message);
      } else {
        showToast('Hata: ' + (data.error || 'Gönderilemedi'));
      }
    } catch (err) {
      showToast('Hata: ' + err.message);
    }
  }

  async function loadViewOnceVault() {
    loadDepotGroupStatus();
    const grid = document.getElementById('view-once-grid');
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-4); padding: 36px;">Yükleniyor...</div>';

    try {
      const res = await fetch('/api/view-once');
      const data = await res.json();
      viewOnceItems = data.items || [];

      // Update counters
      const total = viewOnceItems.length;
      const images = viewOnceItems.filter(i => i.mediaType === 'image').length;
      const videos = viewOnceItems.filter(i => i.mediaType === 'video').length;
      const audios = viewOnceItems.filter(i => i.mediaType === 'audio').length;

      document.getElementById('vo-stat-total').innerText = total;
      document.getElementById('vo-stat-images').innerText = images;
      document.getElementById('vo-stat-videos').innerText = videos;
      document.getElementById('vo-stat-audios').innerText = audios;

      renderViewOnceGrid();
    } catch (e) {
      grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 24px;">Yükleme hatası: ${escapeHtml(e.message)}</div>`;
    }
  }

  function filterViewOnce(type, btn) {
    viewOnceCurrentFilter = type;
    btn.parentElement.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    renderViewOnceGrid();
  }

  function renderViewOnceGrid() {
    const grid = document.getElementById('view-once-grid');
    const filtered = viewOnceCurrentFilter === 'all' 
      ? viewOnceItems 
      : viewOnceItems.filter(i => i.mediaType === viewOnceCurrentFilter);

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: var(--text-5); padding: 48px; border: 1px dashed var(--border-1); border-radius: var(--radius-lg);">
          <div style="font-size: 32px; margin-bottom: 8px;">👁️</div>
          <div style="font-size: 14px; font-weight: 600; color: var(--text-3);">Bu kategoride tek gönderimlik medya bulunmuyor.</div>
          <div style="font-size: 12px; color: var(--text-5); margin-top: 4px;">WhatsApp'tan gelen tek gönderimlik fotoğraflar otomatik olarak yakalanır.</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(item => {
      const isImg = item.mediaType === 'image';
      const isVid = item.mediaType === 'video';
      const isAud = item.mediaType === 'audio';

      let mediaPreviewHtml = '';
      if (isImg) {
        mediaPreviewHtml = `
          <div style="height: 180px; width: 100%; background: #000; border-radius: var(--radius-sm); overflow: hidden; display: flex; align-items: center; justify-content: center; cursor: pointer;" onclick="openMediaPreview('${item.downloadUrl}', 'image')">
            <img src="${item.downloadUrl}" alt="View Once" style="max-height: 100%; max-width: 100%; object-fit: contain;">
          </div>
        `;
      } else if (isVid) {
        mediaPreviewHtml = `
          <div style="height: 180px; width: 100%; background: #000; border-radius: var(--radius-sm); overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative; cursor: pointer;" onclick="openMediaPreview('${item.downloadUrl}', 'video')">
            <video src="${item.downloadUrl}" style="max-height: 100%; max-width: 100%; object-fit: contain;" preload="metadata"></video>
            <div style="position: absolute; background: rgba(0,0,0,0.6); width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #fff;">▶</div>
          </div>
        `;
      } else if (isAud) {
        mediaPreviewHtml = `
          <div style="height: 90px; width: 100%; background: var(--bg-2); border-radius: var(--radius-sm); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px;">
            <div style="font-size: 12px; color: var(--text-3); margin-bottom: 6px;">🎙️ Ses Kaydı</div>
            <audio src="${item.downloadUrl}" controls style="width: 100%; height: 32px;"></audio>
          </div>
        `;
      } else {
        mediaPreviewHtml = `
          <div style="height: 100px; width: 100%; background: var(--bg-2); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-size: 24px;">
            📄
          </div>
        `;
      }

      return `
        <div class="card" style="display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--border-2); border-radius: var(--radius-md); background: var(--bg-1);">
          ${mediaPreviewHtml}

          <div style="font-size: 12px; display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 700; color: #ffffff;">👤 ${escapeHtml(item.pushName)}</span>
              <span class="badge" style="background: var(--bg-3); font-size: 10px;">${escapeHtml(item.ext.toUpperCase())}</span>
            </div>
            <div style="color: var(--text-4); font-size: 11px; font-family: var(--font-mono);">
              📞 +${escapeHtml(item.senderNumber)}
            </div>
            <div style="color: var(--text-4); font-size: 11px;">
              📍 ${item.isGroup ? `Grup: ${escapeHtml(item.groupName || 'Bilinmiyor')}` : 'Özel Sohbet'}
            </div>
            ${item.caption ? `<div style="color: var(--text-2); font-size: 11px; background: var(--bg-2); padding: 4px 6px; border-radius: 4px; margin-top: 4px;">💬 ${escapeHtml(item.caption)}</div>` : ''}
            <div style="display: flex; justify-content: space-between; color: var(--text-5); font-size: 10px; margin-top: 4px;">
              <span>🕒 ${escapeHtml(item.dateFormatted)}</span>
              <span>💾 ${escapeHtml(item.sizeFormatted)}</span>
            </div>
          </div>

          <div style="display: flex; gap: 6px; margin-top: auto; padding-top: 8px; border-top: 1px solid var(--border-1);">
            <a href="${item.downloadUrl}" download="${item.filename}" class="btn btn-secondary btn-sm" style="flex: 1; text-align: center; text-decoration: none;">İndir</a>
            <button class="btn btn-primary btn-sm" onclick="forwardViewOncePrompt('${item.filename}')" title="WhatsApp'a İlet" style="flex: 1;">İlet</button>
            <button class="btn btn-danger btn-sm" onclick="deleteViewOnceMedia('${item.filename}')" title="Sil">Sil</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function deleteViewOnceMedia(filename) {
    if (!confirm('Bu tek gönderimlik medyayı kalıcı olarak silmek istiyor musunuz?')) return;
    try {
      const res = await fetch(`/api/view-once/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('Medya silindi.');
        loadViewOnceVault();
      }
    } catch (e) {
      showToast('Silinemedi: ' + e.message);
    }
  }

  async function forwardViewOncePrompt(filename) {
    const phone = prompt('Medyayı iletmek istediğiniz telefon numarasını girin (Örn: 905551234567 veya boş bırakarak varsayılan hedefe iletin):');
    if (phone === null) return;

    showToast('Medya WhatsApp üzerinden iletiliyor...');
    try {
      const res = await fetch('/api/view-once/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, targetPhone: phone ? phone.trim() : undefined })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message);
      } else {
        showToast('Hata: ' + (data.error || 'İletilemedi'));
      }
    } catch (e) {
      showToast('Hata: ' + e.message);
    }
  }

  async function clearAllViewOnceMedia() {
    if (!confirm('Kasadaki TÜM tek gönderimlik medyaları kalıcı olarak silmek istediğinize emin misiniz?')) return;
    try {
      const res = await fetch('/api/view-once/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Kasa temizlendi.');
        loadViewOnceVault();
      }
    } catch (e) {
      showToast('Hata: ' + e.message);
    }
  }

  function openMediaPreview(downloadUrl, type) {
    const modal = document.getElementById('file-preview-modal');
    const titleEl = document.getElementById('preview-modal-title');
    const badgeEl = document.getElementById('preview-modal-type-badge');
    const dlLink = document.getElementById('preview-modal-download-link');
    const bodyEl = document.getElementById('preview-modal-body');

    const filename = decodeURIComponent(downloadUrl.split('/').pop());
    titleEl.innerText = filename;
    badgeEl.innerText = (type || 'MEDYA').toUpperCase();
    dlLink.href = downloadUrl;

    if (type === 'image') {
      bodyEl.innerHTML = `<img src="${downloadUrl}" style="max-width: 100%; max-height: 75vh; object-fit: contain; padding: 12px; display: block; margin: 0 auto;">`;
    } else if (type === 'video') {
      bodyEl.innerHTML = `<video id="modal-preview-video" playsinline controls style="width: 100%; max-height: 520px;" src="${downloadUrl}"></video>`;
      setTimeout(() => {
        const vid = document.getElementById('modal-preview-video');
        if (vid) vid.play().catch(() => {});
      }, 100);
    } else if (type === 'audio') {
      bodyEl.innerHTML = `
        <div style="padding: 48px 24px; text-align: center; width: 100%;">
          <div style="font-size: 48px; margin-bottom: 16px;">🎙️</div>
          <div style="font-weight: 600; color: #fff; margin-bottom: 20px; font-size: 15px;">${escapeHtml(filename)}</div>
          <audio controls autoplay style="width: 80%; max-width: 480px;" src="${downloadUrl}"></audio>
        </div>
      `;
    }
    modal.classList.add('active');
  }

  /* =========================================================================
     CRON & SETTINGS
     ========================================================================= */
  async function loadCronAction() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      const tbody = document.getElementById('cron-table-tbody');

      if (!data.cronTasks || data.cronTasks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-5);">Kayıtlı cron görevi yok.</td></tr>';
        return;
      }

      tbody.innerHTML = data.cronTasks.map((c, idx) => `
        <tr>
          <td><input type="text" class="input-text cron-name" value="${c.name || ''}"></td>
          <td><input type="text" class="input-text cron-expr" value="${c.cron || '* * * * *'}"></td>
          <td><input type="text" class="input-text cron-cmd" value="${c.command || ''}"></td>
          <td><input type="text" class="input-text cron-target" value="${c.target || ''}"></td>
          <td><input type="checkbox" class="cron-enabled" ${c.enabled !== false ? 'checked' : ''}></td>
          <td><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">Sil</button></td>
        </tr>
      `).join('');
    } catch (e) {
      console.error(e);
    }
  }

  function addNewCronRow() {
    const tbody = document.getElementById('cron-table-tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="input-text cron-name" placeholder="Görev Adı"></td>
      <td><input type="text" class="input-text cron-expr" value="0 9 * * *"></td>
      <td><input type="text" class="input-text cron-cmd" placeholder="yemek"></td>
      <td><input type="text" class="input-text cron-target" placeholder="905xxxxxxxxx"></td>
      <td><input type="checkbox" class="cron-enabled" checked></td>
      <td><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">Sil</button></td>
    `;
    tbody.appendChild(tr);
  }

  async function saveCronAction() {
    const tasks = [];
    document.querySelectorAll('#cron-table-tbody tr').forEach(tr => {
      const name = tr.querySelector('.cron-name')?.value.trim();
      const cron = tr.querySelector('.cron-expr')?.value.trim();
      const command = tr.querySelector('.cron-cmd')?.value.trim();
      const target = tr.querySelector('.cron-target')?.value.trim();
      const enabled = tr.querySelector('.cron-enabled')?.checked;

      if (name && cron && command) {
        tasks.push({ name, cron, command, target, enabled });
      }
    });

    try {
      const res = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cronTasks: tasks })
      });
      const data = await res.json();
      if (data.success) showToast('Cron görevleri kaydedildi!');
    } catch (e) {
      showToast('Hata: ' + e.message);
    }
  }

  async function loadSettingsAction() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      const cfg = data.settings || data;
      if (cfg.maxConcurrentDownloads || cfg.concurrencyLimit) {
        const limit = cfg.maxConcurrentDownloads || cfg.concurrencyLimit;
        document.getElementById('setting-queue-limit').value = limit;
        document.getElementById('queue-limit-val').innerText = limit;
      }
      if (cfg.proxyUrl) document.getElementById('setting-proxy-url').value = cfg.proxyUrl;
      if (cfg.dashboardUser) document.getElementById('setting-dash-user').value = cfg.dashboardUser;
      if (cfg.vdsIp) document.getElementById('setting-vds-ip').value = cfg.vdsIp;
      if (cfg.port) document.getElementById('setting-vds-port').value = cfg.port;
      if (cfg.depotGroupJid) document.getElementById('setting-depot-group-jid').value = cfg.depotGroupJid;
      if (cfg.ownerNumber) document.getElementById('setting-owner-number').value = cfg.ownerNumber;
      if (cfg.viewOnceTargetJid) document.getElementById('setting-viewonce-target').value = cfg.viewOnceTargetJid;
      if (cfg.viewOnceAutoForward !== undefined) {
        document.getElementById('setting-viewonce-autoforward').checked = Boolean(cfg.viewOnceAutoForward);
      }
      if (cfg.geminiApiKey) document.getElementById('setting-gemini-key').value = cfg.geminiApiKey;
      if (cfg.geminiModel) document.getElementById('setting-gemini-model').value = cfg.geminiModel;
      if (cfg.aiBotName || cfg.botName) document.getElementById('setting-ai-botname').value = cfg.aiBotName || cfg.botName;
      if (cfg.groqApiKey) document.getElementById('setting-groq-key').value = cfg.groqApiKey;
      if (cfg.openrouterApiKey) document.getElementById('setting-openrouter-key').value = cfg.openrouterApiKey;
    } catch (e) {
      console.error(e);
    }
  }

  function updateQueueLimitFromSlider(val) {
    document.getElementById('queue-limit-val').innerText = val;
  }

  async function saveSettingsAction(e) {
    if (e) e.preventDefault();
    const concurrencyLimit = parseInt(document.getElementById('setting-queue-limit').value, 10);
    const proxyUrl = document.getElementById('setting-proxy-url').value.trim();
    const dashboardUser = document.getElementById('setting-dash-user').value.trim();
    const dashboardPass = document.getElementById('setting-dash-pass').value;
    const vdsIp = document.getElementById('setting-vds-ip').value.trim();
    const port = parseInt(document.getElementById('setting-vds-port').value, 10);
    const depotGroupJid = document.getElementById('setting-depot-group-jid')?.value.trim() || '';
    const ownerNumber = document.getElementById('setting-owner-number')?.value.trim() || '';
    const viewOnceTargetJid = document.getElementById('setting-viewonce-target').value.trim();
    const viewOnceAutoForward = document.getElementById('setting-viewonce-autoforward').checked;
    const geminiApiKey = document.getElementById('setting-gemini-key')?.value.trim() || '';
    const geminiModel = document.getElementById('setting-gemini-model')?.value.trim() || 'gemini-3.8-flash';
    const aiBotName = document.getElementById('setting-ai-botname')?.value.trim() || 'Moi';
    const groqApiKey = document.getElementById('setting-groq-key')?.value.trim() || '';
    const openrouterApiKey = document.getElementById('setting-openrouter-key')?.value.trim() || '';

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          concurrencyLimit, 
          proxyUrl, 
          dashboardUser, 
          dashboardPass, 
          vdsIp, 
          port,
          depotGroupJid,
          ownerNumber,
          viewOnceTargetJid,
          viewOnceAutoForward,
          geminiApiKey,
          geminiModel,
          aiBotName,
          groqApiKey,
          openrouterApiKey
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('✅ Sistem ayarları ve config.json güncellendi!');
        // Ham config editorunu da tazele
        loadConfigRawEditor();
      } else {
        showToast('Hata: ' + (data.error || 'Kaydedilemedi'));
      }
    } catch (err) {
      showToast('Hata: ' + err.message);
    }
  }

  async function testProxyAction() {
    const proxyUrl = document.getElementById('setting-proxy-url').value.trim();
    if (!proxyUrl) return showToast('Lütfen test edilecek proxy URL girin.');
    try {
      showToast('Proxy test ediliyor...');
      const res = await fetch('/api/proxy/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxyUrl })
      });
      const data = await res.json();
      if (data.success) showToast(`Proxy Başarılı! Çıkış IP: ${data.ip || 'OK'}`);
      else showToast('Proxy Hatası: ' + (data.error || 'Bağlanılamadı'));
    } catch (e) {
      showToast('Test hatası: ' + e.message);
    }
  }

  async function verifyCookiesAction() {
    try {
      showToast('Çerezler doğrulanıyor...');
      const res = await fetch('/api/cookies/verify', { method: 'POST' });
      const data = await res.json();
      document.getElementById('cookies-status-output').innerText = JSON.stringify(data, null, 2);
      showToast('Çerez durumu güncellendi.');
    } catch (e) {
      showToast('Hata: ' + e.message);
    }
  }

  /* =========================================================================
     SYSTEM HEALTH & DIAGNOSTICS
     ========================================================================= */
  async function loadSystemHealth() {
    try {
      const res = await fetch('/api/system/health');
      const data = await res.json();
      if (data.nodeVersion) document.getElementById('sys-node-version').innerText = data.nodeVersion;
      if (data.platform) document.getElementById('sys-os-platform').innerText = `${data.platform} (${data.arch || 'x64'})`;
      if (data.uptime) document.getElementById('sys-uptime-val').innerText = data.uptime;
    } catch (e) {}
  }

  async function systemDiagnosticGitPull() {
    if (!confirm('Git üzerinden en son güncellemeler çekilsin mi?')) return;
    try {
      showToast('Git pull yürütülüyor...');
      const res = await fetch('/api/system/git-pull', { method: 'POST' });
      const data = await res.json();
      showToast(data.output || 'Kodlar güncellendi.');
    } catch (e) {
      showToast('Hata: ' + e.message);
    }
  }

  async function systemDiagnosticRestartPM2() {
    if (!confirm('PM2 servisi yeniden başlatılsın mı?')) return;
    try {
      await fetch('/api/system/restart', { method: 'POST' });
      showToast('Yeniden başlatma sinyali gönderildi.');
    } catch (e) {
      showToast('Hata: ' + e.message);
    }
  }

  async function clearHistoryLogs() {
    try {
      await fetch('/api/history/clear', { method: 'POST' });
      showToast('İndirme geçmişi temizlendi.');
    } catch (e) {}
  }

  async function clearErrorLogs() {
    try {
      await fetch('/api/errors/clear', { method: 'POST' });
      showToast('Hata günlüğü temizlendi.');
    } catch (e) {}
  }

  /* =========================================================================
     TERMINAL LOGS
     ========================================================================= */
  function appendLogLine(log) {
    const cont = document.getElementById('terminal-container');
    if (!cont) return;

    const line = document.createElement('div');
    line.className = 'log-line';

    const timeStr = log.time ? new Date(log.time).toLocaleTimeString('tr-TR', { hour12: false }) : new Date().toLocaleTimeString('tr-TR', { hour12: false });
    const moduleStr = log.module ? `[${log.module.toUpperCase()}]` : '[BOT]';
    const msgStr = typeof log.msg === 'object' ? JSON.stringify(log.msg) : (log.msg || log.text || String(log));

    line.innerHTML = `
      <span class="log-time">[${timeStr}]</span>
      <span class="log-module">${moduleStr}</span>
      <span class="log-text">${msgStr}</span>
    `;

    cont.appendChild(line);
    if (cont.childNodes.length > 300) cont.removeChild(cont.firstChild);
    cont.scrollTop = cont.scrollHeight;
  }

  function clearTerminalLogs() {
    const cont = document.getElementById('terminal-container');
    if (cont) cont.innerHTML = '';
  }

  function downloadTerminalLogs() {
    const cont = document.getElementById('terminal-container');
    if (!cont) return;
    const blob = new Blob([cont.innerText], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wpbot_logs_${Date.now()}.txt`;
    a.click();
  }

  /* =========================================================================
     CANLI CONFIG.JSON EDİTÖRÜ & YAPILANDIRMA İŞLEMLERİ
     ========================================================================= */
  async function loadConfigRawEditor() {
    const editor = document.getElementById('config-raw-textarea');
    const pathLabel = document.getElementById('config-file-path-badge');
    if (!editor) return;

    try {
      editor.placeholder = 'config.json diskten okunuyor...';
      const res = await fetch('/api/config-raw');
      const data = await res.json();
      if (data.success) {
        editor.value = data.raw || JSON.stringify(data.config || {}, null, 2);
        if (pathLabel) pathLabel.innerText = data.filePath || './config.json';
        validateConfigJsonUi();
      } else {
        showToast('config.json okunamadı: ' + (data.error || 'Bilinmiyor'));
      }
    } catch (err) {
      showToast('Yükleme hatası: ' + err.message);
    }
  }

  function validateConfigJsonUi() {
    const editor = document.getElementById('config-raw-textarea');
    const statusBadge = document.getElementById('config-syntax-status');
    const saveBtn = document.getElementById('config-save-btn');
    if (!editor || !statusBadge) return true;

    const text = editor.value.trim();
    if (!text) {
      statusBadge.innerHTML = '<span style="color:#ef4444;">⚠️ Boş İçerik</span>';
      return false;
    }

    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        statusBadge.innerHTML = '<span style="color:#ef4444;">⚠️ Kök nesne { ... } olmalı</span>';
        return false;
      }
      const count = Object.keys(parsed).length;
      statusBadge.innerHTML = `<span style="color:#22c55e;">🟢 Geçerli JSON (${count} Ayar Anahtarı)</span>`;
      return true;
    } catch (err) {
      const cleanErr = escapeHtml(err.message.replace(/^JSON\.parse: /i, ''));
      statusBadge.innerHTML = `<span style="color:#ef4444;" title="${cleanErr}">🔴 Hatalı JSON: ${cleanErr.slice(0, 45)}...</span>`;
      return false;
    }
  }

  function formatConfigJsonUi() {
    const editor = document.getElementById('config-raw-textarea');
    if (!editor) return;
    try {
      const parsed = JSON.parse(editor.value);
      editor.value = JSON.stringify(parsed, null, 2);
      validateConfigJsonUi();
      showToast('JSON başarıyla hizalandı ve biçimlendirildi!');
    } catch (err) {
      showToast('Sözdizimi hatası nedeniyle biçimlendirilemedi: ' + err.message);
    }
  }

  async function saveConfigRawAction() {
    const editor = document.getElementById('config-raw-textarea');
    const saveBtn = document.getElementById('config-save-btn');
    if (!editor) return;

    const raw = editor.value.trim();
    if (!raw) return showToast('Lütfen geçerli bir JSON içeriği girin.');

    try {
      JSON.parse(raw);
    } catch (parseErr) {
      showToast('Kaydedilemedi: JSON sözdizimi hatalı! ' + parseErr.message);
      validateConfigJsonUi();
      return;
    }

    const origText = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '⏳ Kaydediliyor...';
    }

    try {
      const res = await fetch('/api/config-raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw })
      });
      const data = await res.json();
      if (data.success) {
        showToast('✅ config.json başarıyla kaydedildi ve tüm ayarlar güncellendi!');
        validateConfigJsonUi();
        if (data.raw) editor.value = data.raw;
        // Sistem ayarları formunu da tazele
        loadSettingsAction();
      } else {
        showToast('Kayıt Hatası: ' + (data.error || 'Kaydedilemedi'));
      }
    } catch (err) {
      showToast('Bağlantı hatası: ' + err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = origText;
      }
    }
  }

  async function loadConfigTemplateAction() {
    if (!confirm('Varsayılan şablonu yüklemek istediğinize emin misiniz? Mevcut düzenlemeleriniz şablonla değişecek.')) return;
    try {
      const res = await fetch('/api/config-raw/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.raw) {
        const editor = document.getElementById('config-raw-textarea');
        if (editor) {
          editor.value = data.raw;
          validateConfigJsonUi();
          showToast('Varsayılan şablon yüklendi! Kaydetmek için Kaydet butonuna basın.');
        }
      }
    } catch (err) {
      showToast('Şablon yükleme hatası: ' + err.message);
    }
  }

  function insertConfigSnippet(key, defaultVal) {
    const editor = document.getElementById('config-raw-textarea');
    if (!editor) return;
    try {
      let parsed = {};
      try { parsed = JSON.parse(editor.value); } catch (e) { parsed = {}; }
      parsed[key] = defaultVal;
      editor.value = JSON.stringify(parsed, null, 2);
      validateConfigJsonUi();
      showToast(`"${key}" anahtarı config.json'a eklendi!`);
    } catch (err) {
      showToast('Ekleme hatası: ' + err.message);
    }
  }

  function handleConfigEditorKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveConfigRawAction();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 2;
      validateConfigJsonUi();
    }
  }

  /* =========================================================================
     PAGE INITIALIZATION
     ========================================================================= */
  window.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
    initTelemetryChart();
  });