/*
 * WhereMyBus — Balıkesir canlı sayfasıyla (balikesirkart.asiselektronik.com.tr/wheremybus)
 * DOM ve çalışma mantığını birebir eşleştiren vanilla JS implementasyonu.
 *
 * Akış:
 *   1) allrouteshorts → hat listesi (autocomplete)
 *   2) Kullanıcı hat seçer → routebyrouteid → varyantlar → baseline auto-select
 *   3) Varyant seçimi → routevariantstations + routevariantvehicle (+ polyline)
 *   4) Sekmeler: Duraklar / HAT SAATLERİ (routevariantschedule) / ÜCRET TARİFELERİ (routeprice)
 */
(function () {
    'use strict';

    if (!window.maplibregl) { console.error('[WMB] MapLibre GL yüklü değil.'); return; }
    var cfg = window.WMB_CONFIG;
    if (!cfg) { console.error('[WMB] WMB_CONFIG tanımsız.'); return; }

    // ----- DOM
    var $search       = document.getElementById('wmb-bussearch');
    var $searchLoad   = document.getElementById('wmb-bussearch-loading');
    var $searchClear  = document.getElementById('wmb-bussearch-clear');
    var $busList      = document.getElementById('wmb-buslist');

    var $variantWrap  = document.getElementById('wmb-variant-wrap');
    var $variantTrig  = document.getElementById('wmb-variant-trigger');
    var $variantValue = document.getElementById('wmb-variant-value');
    var $variantPanel = document.getElementById('wmb-variant-panel');

    var $busDetail    = document.getElementById('wmb-bus-detail');
    var $stopsList    = document.getElementById('wmb-stops-list');

    var $hoursTitle   = document.getElementById('wmb-hours-title');
    var $scheduleDesc = document.getElementById('wmb-schedule-desc');
    var $dayTrig      = document.getElementById('wmb-day-trigger');
    var $dayValue     = document.getElementById('wmb-day-value');
    var $dayPanel     = document.getElementById('wmb-day-panel');
    var $hoursList    = document.getElementById('wmb-hours-list');

    var $priceList    = document.getElementById('wmb-price-list');
    var $status       = document.getElementById('wmb-map-status');

    var $routeInfo    = document.getElementById('wmb-route-info');
    var $infoStops    = document.getElementById('wmb-info-stops');
    var $infoVehicles = document.getElementById('wmb-info-vehicles');
    var $infoUpdated  = document.getElementById('wmb-info-updated');
    var $refresh      = document.getElementById('wmb-refresh');

    // ----- State
    var allRoutes = [];
    var routeByCode = null; // routeCode → hat (routeKind için; loadRoutes kurar)
    var selectedRoute = null;
    var variants = [];
    var selectedVariant = null;
    var pollHandle = null;
    var scheduleCache = {};
    var selectedDay = 0;
    var weekDays = [];
    var vehiclesIndex = {};   // key -> { feature, animFrom, animTo, headFrom, headTo, animStart, animDur }
    var animRafHandle = null;

    var DAY_NAMES = (function () {
        var i18n = window.WMB_I18N || {};
        var fallback = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
        return fallback.map(function (d, i) { return i18n['js.day.' + i] || d; });
    })();
    function t(key, fallback) {
        var dict = window.WMB_I18N || {};
        return (dict[key] != null && dict[key] !== '') ? dict[key] : (fallback != null ? fallback : key);
    }

    // ----- Utilities
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
        });
    }
    function fetchJson(url) {
        // Auth-aware fetch: WMB.cwFetchJson kullanılırsa Van gibi reCAPTCHA-tabanlı
        // backend'lerde otomatik /auth/init + 401 retry yapılır. Helper yoksa düz fetch'e düş.
        if (window.WMB && typeof window.WMB.cwFetchJson === 'function') {
            return window.WMB.cwFetchJson(url);
        }
        return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    }
    function unwrap(env) { return (env && Object.prototype.hasOwnProperty.call(env, 'result')) ? (env.result || {}) : (env || {}); }
    function showStatus(msg, hideMs) {
        if (!msg) { $status.classList.add('d-none'); $status.textContent = ''; return; }
        $status.textContent = msg; $status.classList.remove('d-none');
        if (hideMs) setTimeout(function () { $status.classList.add('d-none'); }, hideMs);
    }
    function lonLatOf(item) {
        var lon = item.longitude != null ? item.longitude : item.boylam;
        var lat = item.latitude  != null ? item.latitude  : item.enlem;
        if (lon == null || lat == null) return null;
        lon = Number(lon); lat = Number(lat);
        if (!isFinite(lon) || !isFinite(lat)) return null;
        return [lon, lat];
    }
    function pad2(n) { n = Number(n) || 0; return (n < 10 ? '0' : '') + n; }
    function fmtDate(d) {
        return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
    }

    // ----- MapLibre GL harita (gerçek 3D pitch)
    function wmbTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }
    // Başlangıç stili ortak çekirdekten gelir (WmbMapCore.buildStyle): katalogdaki
    // seçili mod raster ise altlıklı kabuk, vektör stil ("style" türü, OpenFreeMap)
    // ise yalnızca arka plan — gerçek altlığı basemaps.js stil birleştirmesi ekler.
    // Eski CARTO yedek şablonları kaldırıldı (anahtarsız CARTO filigran basıyor).
    function buildStyle(theme) { return WmbMapCore.buildStyle(theme); }
    // Durak etiketi renkleri — temaya göre
    function labelColors() {
        return wmbTheme() === 'dark'
            ? { 'text-color': '#cbd5e1', 'text-halo-color': 'rgba(8,13,24,0.9)', 'text-halo-width': 1.2 }
            : { 'text-color': '#334155', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.2 };
    }

    var DEFAULT_PITCH = 55, DEFAULT_BEARING = -16;
    var map = new maplibregl.Map({
        container: 'wmb-map',
        style: buildStyle(wmbTheme()),
        center: cfg.center || [32.85, 39.93],
        zoom: cfg.zoom || 13,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
        attributionControl: false,
        dragRotate: true
    });
    // Pusula gizli — yön sıfırlama 2D/3D düğmesi üzerinden zaten yapılıyor
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    // Atıf (lisans şartı) — kompakt ⓘ, açılışta KAPALI, tıklanınca açılır (ortak yardımcı)
    WmbMapCore.addAttribution(map);
    window.WMB_MAP = map;
    // Durak adı etiketleri zoom ile ölçeklenir (uzakta küçük, yaklaştıkça büyür)
    WmbMapCore.attachLabelScale(map);

    // Harita görünümü (soluk / açık / doğa / detaylı) — ortak modül (js/basemaps.js).
    // 'base' kaynağının döşemelerini yerinde değiştirir; hat/durak/araç katmanları korunur.
    //
    // 'load' DEĞİL 'style.load': 'load' ilk döşemelerin inmesini bekler; yavaş bir
    // altlıkta (ör. OpenTopoMap) hiç ateşlenmeyebilir ve tonlama uygulanmadan kalır.
    var basemapBound = false;
    map.on('style.load', function () {
        if (basemapBound || !window.WmbBasemaps) return;
        basemapBound = true;
        window.WmbBasemaps.bindMapLibre(map);
    });

    var mapReady = false, readyQueue = [];
    function whenReady(cb) { if (mapReady) cb(); else readyQueue.push(cb); }

    // Rota çizgisi renkleri — SmartStop ile aynı kurumsal dil:
    // açık temada beyaz halo + koyu lacivert; koyu temada koyu halo + açık mavi
    function routeColors() {
        return wmbTheme() === 'dark'
            ? { halo: 'rgba(8,13,24,0.85)', core: '#4f8cff' }
            : { halo: 'rgba(255,255,255,0.92)', core: '#0b2f5e' };
    }

    // 'load' ilk tile'ların inmesini bekler; tile sunucusu yavaşsa/ulaşılamazsa
    // katmanlar hiç kurulmaz. 'style.load' stil hazır olur olmaz ateşlenir.
    // Her hatta deterministik, birbirinden uzak bir renk üret (golden-angle HSL).
    // Aynı kod her oturumda aynı rengi alır; "110" ile "111" gibi bitişik kodlar
    // bile çarpan sayesinde birbirinden uzak tonlara düşer.
    var routeColorCache = {};
    function routeColor(code) {
        var s = String(code == null ? '' : code);
        if (routeColorCache[s]) return routeColorCache[s];
        var h = 0;
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        var hue = Math.round((h % 1000) * 137.508) % 360;
        var c = 'hsl(' + hue + ', 72%, 48%)';
        routeColorCache[s] = c;
        return c;
    }

    // ----- 3B binalar / POI --------------------------------------------------
    // Uygulama mantığı ortak çekirdekte: wwwroot/js/mapcore.js
    // (Dört harita ekranı da aynı katman tanımlarını paylaşır.)
    var DATA_LAYERS = ['allroutes-line', 'route-glow', 'route-core', 'stations'];
    function addBuildingLayer() { if (window.WmbMapCore) WmbMapCore.addBuildings(map, DATA_LAYERS); }
    function setBuildings3d(on) { if (window.WmbMapCore) WmbMapCore.setBuildings(map, on); }
    function refreshBuildingTheme() { if (window.WmbMapCore) WmbMapCore.refreshTheme(map); }

    // Durak pin görüntüleri — Akıllı Durak'la aynı simge (WmbMapCore).
    // Ara durak kurumsal renkte (temaya uyar), uçlar amber/kırmızı (lejantla birebir).
    function loadStopPinImages(cb) {
        if (!window.WmbMapCore || !WmbMapCore.addStopPinImages) { if (cb) cb(); return; }
        var dark = wmbTheme() === 'dark';
        WmbMapCore.addStopPinImages(map, [
            { id: 'wmb-stop-mid', color: dark ? '#4f8cff' : '#0b2f5e' },
            { id: 'wmb-stop-start', color: '#f5a623' },
            { id: 'wmb-stop-end', color: '#ef4444' }
        ], cb);
    }

    map.on('style.load', function () {
        if (map.getSource('route')) return; // tema stil yenilemelerinde çift kurulumu önle
        var rc = routeColors();
        // Tüm hatların çizimi — her hat kendi renginde (feature.properties.color),
        // seçili rota katmanlarının ALTINDA kalır
        map.addSource('allroutes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'allroutes-line', type: 'line', source: 'allroutes',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#4f8cff'],
                'line-width': 2.5,
                'line-opacity': 0.7
            } });
        map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'route-glow', type: 'line', source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': rc.halo, 'line-width': 10 } });
        map.addLayer({ id: 'route-core', type: 'line', source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': rc.core, 'line-width': 4, 'line-dasharray': [2.2, 1.6] } });
        // Yürüyüş rotası — kullanıcıdan önerilen durağa yeşil kesikli çizgi
        map.addSource('walkroute', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'walkroute', type: 'line', source: 'walkroute',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-dasharray': [0.5, 1.8] } });
        // Duraklar — Akıllı Durak'taki pin simgesi (WmbMapCore.addStopPinImages).
        // Lejantla birebir: başlangıç AMBER, ara KURUMSAL LACİVERT, bitiş KIRMIZI.
        map.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'stations', type: 'symbol', source: 'stations',
            layout: {
                'icon-image': ['match', ['get', 'kind'], 'start', 'wmb-stop-start', 'end', 'wmb-stop-end', 'wmb-stop-mid'],
                'icon-size': ['interpolate', ['linear'], ['zoom'],
                    10, ['match', ['get', 'kind'], 'start', 0.46, 'end', 0.46, 0.36],
                    13, ['match', ['get', 'kind'], 'start', 0.56, 'end', 0.56, 0.46],
                    16, ['match', ['get', 'kind'], 'start', 0.68, 'end', 0.68, 0.56]],
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                // Düşük sort key önce çizilir (altta kalır) — uç duraklar
                // (start/end) ara durakların ÜSTÜNDE görünsün diye yüksek değer alır.
                'symbol-sort-key': ['match', ['get', 'kind'], 'start', 2, 'end', 2, 1]
            } });
        loadStopPinImages(function () { map.triggerRepaint(); });
        // Durak adları HTML etiketlerle basılır (setStationData) — font sunucusuna
        // bağımlılık yok, her ortamda garantili görünür.
        // Durak hover popup
        var stationPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'wmb-mlpopup', offset: 14 });
        map.on('mouseenter', 'stations', function (e) {
            map.getCanvas().style.cursor = 'pointer';
            var f = e.features && e.features[0]; if (!f || !f.properties || !f.properties.name) return;
            stationPopup.setLngLat(f.geometry.coordinates.slice()).setHTML('<strong>' + escapeHtml(f.properties.name) + '</strong>').addTo(map);
        });
        map.on('mousemove', 'stations', function (e) {
            var f = e.features && e.features[0]; if (f) stationPopup.setLngLat(f.geometry.coordinates.slice());
        });
        map.on('mouseleave', 'stations', function () { map.getCanvas().style.cursor = ''; stationPopup.remove(); });
        // Durak pin'ine tıklama → listedeki satırı bul, kaydır ve detay panelini aç
        map.on('click', 'stations', function (e) {
            var f = e.features && e.features[0]; if (!f || !f.properties) return;
            var sid = f.properties.stopId; if (!sid) return;
            var row = $stopsList && $stopsList.querySelector('.list-item[data-stop-id="' + sid + '"]');
            if (!row) return;
            e.originalEvent && e.originalEvent.stopPropagation && e.originalEvent.stopPropagation();
            activateTab('stops');
            openStopDetail(row, { toggle: false });
            row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });

        // Konteyner boyut değişiminde (panel aç/kapat) yeniden ölçeklen
        if (window.ResizeObserver) {
            new ResizeObserver(function () { map.resize(); }).observe(document.getElementById('wmb-map'));
        }

        // 3B binalar — veri katmanları kurulduktan SONRA eklenir ki onların
        // altına yerleştirilebilsin. Görünürlük mevcut 2B/3B durumuna göre.
        addBuildingLayer();
        var shellEl = document.querySelector('.wmb-shell');
        setBuildings3d(!shellEl || shellEl.getAttribute('data-wmb-tilt') !== 'off');

        // İlgi noktaları (eczane, okul, kafe…) — altlık menüsündeki anahtardan yönetilir
        if (window.WmbMapCore && window.WmbBasemaps) {
            WmbMapCore.addPois(map, DATA_LAYERS);
            WmbBasemaps.onPoi(function (on) { WmbMapCore.setPois(map, on); });
        }

        mapReady = true;
        readyQueue.forEach(function (cb) { try { cb(); } catch (e) {} });
        readyQueue = [];
    });

    // Tema değişince zemin tile'larını güncelle
    (function () {
        var last = wmbTheme();
        new MutationObserver(function () {
            var now = wmbTheme();
            if (now !== last) {
                last = now;
                whenReady(function () {
                    // Altlık döşemesi/stili basemaps.js'in kendi tema aboneliğiyle
                    // güncellenir (bindMapLibre) — burada tekrar dokunulmaz.
                    // Rota çizgisi renklerini yeni temaya uydur (HTML durak etiketleri CSS ile uyar)
                    var rc = routeColors();
                    if (map.getLayer('route-glow')) map.setPaintProperty('route-glow', 'line-color', rc.halo);
                    if (map.getLayer('route-core')) map.setPaintProperty('route-core', 'line-color', rc.core);
                    // Ara durak pin'i kurumsal renkte — görüntü yeni tema renginde yeniden üretilir
                    if (map.getLayer('stations')) loadStopPinImages(function () { map.triggerRepaint(); });
                    refreshBuildingTheme();   // 3B bina rengi de temaya uysun
                    // allroutes-line hat bazlı sabit renk kullanır — temadan bağımsız
                });
            }
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    })();

    // Pitch (eğim) aç/kapat — view'daki 3D/2D düğmesi çağırır
    window.WMB_SET_TILT = function (on) {
        map.easeTo({ pitch: on ? DEFAULT_PITCH : 0, bearing: on ? DEFAULT_BEARING : 0, duration: 450 });
        // 3B binalar yalnızca eğimli görünümde anlamlı — 2B'de gizlenir ve
        // MapLibre o kaynağın döşemelerini istemeyi de bırakır (bant genişliği).
        setBuildings3d(!!on);
    };

    // ----- Rota & durak kaynak yardımcıları
    var routeLines = [];
    function setRouteData() { whenReady(function () { map.getSource('route').setData({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: routeLines } }); }); }
    function clearRoute() { routeLines = []; setRouteData(); }
    function addRouteCoords(coords) { if (coords && coords.length > 1) { routeLines.push(coords); setRouteData(); } }

    var stationFeatures = [];
    // Durak adı etiketleri — HTML marker olarak (her ortamda görünür, font sunucusu gerekmez)
    var stopLabelMarkers = [];
    function clearStopLabels() {
        stopLabelMarkers.forEach(function (m) { m.remove(); });
        stopLabelMarkers = [];
    }
    function syncStopLabelVisibility() {
        var show = map.getZoom() >= 12.8;   // uzak zoom'da etiket kalabalığı olmasın
        stopLabelMarkers.forEach(function (m) {
            m.getElement().classList.toggle('is-hidden', !show);
        });
    }
    map.on('zoom', syncStopLabelVisibility);

    function setStationData() {
        whenReady(function () {
            map.getSource('stations').setData({ type: 'FeatureCollection', features: stationFeatures });
            clearStopLabels();
            stationFeatures.forEach(function (f) {
                if (!f.properties || !f.properties.name) return;
                var el = document.createElement('div');
                el.className = 'wmb-stoplabel';
                el.textContent = f.properties.name;
                var mk = new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 8] })
                    .setLngLat(f.geometry.coordinates)
                    .addTo(map);
                stopLabelMarkers.push(mk);
            });
            syncStopLabelVisibility();
        });
    }
    function clearStations() { closeStopDetail(); stationFeatures = []; clearStopLabels(); setStationData(); }
    function addStation(lngLat, name, kind, id) { stationFeatures.push({ type: 'Feature', properties: { name: name, kind: kind, stopId: id != null ? String(id) : '' }, geometry: { type: 'Point', coordinates: lngLat } }); }
    function fitToStations() {
        if (!stationFeatures.length) return;
        var b = new maplibregl.LngLatBounds();
        stationFeatures.forEach(function (f) { b.extend(f.geometry.coordinates); });
        whenReady(function () {
            var cam = map.cameraForBounds(b, { padding: 70, maxZoom: 16, bearing: map.getBearing() });
            if (cam) map.easeTo({ center: cam.center, zoom: cam.zoom, bearing: map.getBearing(), pitch: map.getPitch(), duration: 550 });
        });
    }

    // ----- Araç (canlı otobüs) HTML marker yardımcıları — pitch'te dik kalır
    // Tıklanan otobüse odaklanılır ve kamera onu izler.
    // Takip şu durumlarda biter: haritayı sürükleme, haritada boş bir yere tıklama,
    // başka bir otobüse tıklama, aynı otobüse tekrar tıklama, araç seferden düşme.
    var followKey = null;
    function clearFollow() {
        if (!followKey) return;
        var e = vehiclesIndex[followKey];
        if (e && e.el) e.el.classList.remove('is-followed');
        followKey = null;
    }
    map.on('dragstart', clearFollow);
    // Aracı takibe al (otobüs marker'ı ve durak detayındaki "yaklaşan araç" satırı ortak kullanır)
    function followVehicle(key) {
        var e = vehiclesIndex[key];
        if (!e || !e.el) return false;
        clearFollow();
        followKey = key;
        e.el.classList.add('is-followed');
        attachEntry(e);   // ekran dışında/kümede ayrılmış olabilir
        var pos = e.marker ? e.marker.getLngLat() : null;
        if (pos) {
            map.easeTo({ center: pos, zoom: Math.max(map.getZoom(), LOD_ZOOM + 0.5), duration: 550 });
            markUserCamera(650);   // ease bitmeden takip kamerası (jumpTo) onu kesmesin
        }
        return true;
    }
    function vehicleKeyByPlate(plate) {
        var want = String(plate || '').replace(/\s+/g, '').toLocaleUpperCase('tr');
        if (!want) return null;
        var keys = Object.keys(vehiclesIndex);
        for (var i = 0; i < keys.length; i++) {
            var e = vehiclesIndex[keys[i]];
            var have = e && e.el && e.el._plate ? String(e.el._plate.textContent || '').replace(/\s+/g, '').toLocaleUpperCase('tr') : '';
            if (have && have === want) return keys[i];
        }
        return null;
    }

    // --- Takipte kamera yönetimi ---
    // Kullanıcı yakınlaştırma/uzaklaştırma yaparken kamerayı ele almayız; aksi
    // hâlde her karede yapılan setCenter, zoom hareketini iptal ediyordu.
    var userCameraUntil = 0;
    // Olay dinleyicisi olarak da çağrılır (argüman = event) — o durumda varsayılan süre
    function markUserCamera(ms) { userCameraUntil = Date.now() + (typeof ms === 'number' ? ms : 2500); }
    map.on('zoomstart', markUserCamera);
    map.on('rotatestart', markUserCamera);
    map.on('pitchstart', markUserCamera);

    /**
     * Takip kamerası: izlenen otobüs ekranın ORTASINA kilitlenir ve her konum
     * karesinde harita onunla birlikte kayar. Otobüs, hareket yönünde görüntünün
     * küçük bir oranı kadar merkezin GERİSİNDE tutulur → yolun ilerisi daha çok
     * görünür ve görüntü stabil bir "kilitli kamera" hissi verir. Araç konumu
     * zaten karelerarası yumuşatıldığı için per-frame jumpTo akıcıdır.
     * Kullanıcı zoom/döndürme/eğim hareketi yaparken (userCameraUntil) kameraya
     * dokunulmaz; sürükleme zaten takibi bitirir.
     */
    var FOLLOW_LEAD_RATIO = 0.12;
    var followCamBusy = false;   // takip jumpTo'sunun tetiklediği moveend'leri ayırt etmek için
    function followCamera(lon, lat, heading) {
        if (Date.now() < userCameraUntil) return;      // kullanıcı kamerayla oynuyor
        var c = map.getContainer();
        var w = c.clientWidth, h = c.clientHeight;
        if (!w || !h) return;
        var lead = Math.min(w, h) * FOLLOW_LEAD_RATIO;
        var ang = (((heading || 0) - map.getBearing()) * Math.PI) / 180;
        var p = map.project([lon, lat]);
        var center = map.unproject([p.x + Math.sin(ang) * lead, p.y - Math.cos(ang) * lead]);
        followCamBusy = true;
        map.jumpTo({ center: center });
        followCamBusy = false;
    }
    // Haritanın boş bir yerine tıklamak da takibi bırakır. Otobüs marker'ları HTML
    // marker olduğu için kendi click'lerinde stopPropagation yapıyor; bu yüzden
    // buraya yalnızca "boşluğa tıklama" ulaşır.
    map.on('click', clearFollow);
    // Marker'lar haritanın canvas'ı DIŞINDA (overlay katmanında) durduğundan
    // MapLibre'nin click olayı sidebar/FAB gibi alanlara ulaşmaz — belge
    // seviyesinde de dinleyip harita dışına tıklamada takibi bırakıyoruz.
    document.addEventListener('click', function (ev) {
        if (!followKey) return;
        if (ev.target.closest && ev.target.closest('.wmb-vmarker')) return; // marker kendi işini yapıyor
        clearFollow();
    });

    // Uzak bakış eşiği: bu zoom'un ALTINDA otobüs ikonu yerine sade daire+yön oku
    // (nav dot) gösterilir; ÜSTÜNDE detaylı üstten-görünüm otobüs ikonu + plaka.
    // Değer yüksek tutulur → daire/küme daha uzun süre görünür kalır, detaylı
    // ikon ancak sokak seviyesine (binaların net seçildiği yakınlığa) inince
    // belirir. Bir otobüse tıklanınca kamera LOD_ZOOM + 0.5'e gider → eşiğin
    // üstünde kalır ve otomatik detaylı ikona geçer.
    var LOD_ZOOM = 16.3;

    /**
     * Sadeleştirme (daire+ok ve kümeleme) YALNIZCA genel bakış modunda uygulanır.
     * Bir hat seçildiğinde ekranda zaten avuç içi kadar araç kalır: orada daire
     * göstermek ya da üçünü tek balonda toplamak bilgi gizlemekten başka işe
     * yaramıyordu — hat seçiliyken araçlar her zoom'da otobüs ikonu olarak çizilir.
     */
    function simplifyVehicles() {
        return overviewActive && map.getZoom() < LOD_ZOOM;
    }

    // Rozet: otobüsün ait olduğu hattın kodu, hat çizgisiyle AYNI renkte.
    // routeCode yoksa (tek hat modu) rozet gizlenir, sadece plaka görünür.
    // Ayrıca uzak-bakış dot'unun daire rengi de hat rengine boyanır.
    function setVehicleRoute(el, code) {
        if (el._dot) el.style.setProperty('--wmb-dot-color', code ? routeColor(code) : '#15335e');
        if (!el._route) return;
        if (code) {
            el._route.textContent = code;
            el._route.style.background = routeColor(code);
            el._route.classList.remove('d-none');
        } else if (el._route.textContent !== '') {
            el._route.textContent = '';
            el._route.classList.add('d-none');
        } else {
            el._route.classList.add('d-none');
        }
    }

    /**
     * Hattın araç türü ('bus' | 'minibus' | 'dolmus' | 'tram' | 'metro'): allRoutes'taki routeTypeId
     * şehir eşlemesiyle (Transit:RouteTypeIcons) çözülür. code boşsa (tek hat
     * modu) seçili hat kullanılır. Eşleme olmayan şehirde hep 'bus'.
     */
    function routeKind(code) {
        var r = null;
        if (code) {
            var c = String(code);
            // O(1) arama: genel bakışta her yoklamada HER araç için çağrılır — liste taraması
            // Bursa ölçeğinde (2000 araç × 433 hat) yoklama başına ~1 milyon karşılaştırma demekti.
            r = routeByCode ? (routeByCode[c] || null) : null;
        } else {
            r = selectedRoute;
        }
        return (window.WmbMapCore && WmbMapCore.vehicleKind)
            ? WmbMapCore.vehicleKind(r ? r.routeTypeId : null)
            : 'bus';
    }
    function routeKindClass(r) {
        var k = (window.WmbMapCore && WmbMapCore.vehicleKind) ? WmbMapCore.vehicleKind(r ? r.routeTypeId : null) : 'bus';
        return k === 'bus' ? '' : ' icon-bus--' + k;
    }
    /** Araç görselini hattın türüne göre kurar; tür değiştiyse (genel bakışta hat değişimi) yeniler. */
    function ensureVehicleKind(el, routeCode) {
        var kind = routeKind(routeCode);
        if (!el._bus || el._bus._kind === kind) return;
        var nb = (window.WmbMapCore && WmbMapCore.createBusIcon) ? WmbMapCore.createBusIcon(kind) : null;
        if (!nb) return;
        el.replaceChild(nb, el._bus);
        el._bus = nb;
        if (el._heading != null) applyHeading(el, el._heading);
    }

    function makeVehicleEl(plate, key, routeCode) {
        var vkind = routeKind(routeCode);
        var el = document.createElement('div');
        el.className = 'wmb-vmarker';
        el.title = t('ss.track.hint', 'Aracı canlı izle');
        // Uzak-bakış göstergesi: daire + yön oku (nav dot). Daire hat rengine boyanır
        // (setVehicleRoute → --wmb-dot-color), beyaz ok gpsDir yönünü gösterir.
        var dot = document.createElement('div');
        dot.className = 'wmb-vmarker__dot';
        // Daire (hat renginde) + daireden DIŞARI taşan yön işaretçisi (gpsDir'e döner)
        dot.innerHTML =
            '<svg viewBox="0 0 40 40" width="28" height="28" aria-hidden="true">' +
                '<path d="M20 2 L26 14 L14 14 Z" fill="var(--wmb-dot-color, #15335e)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>' +
                '<circle cx="20" cy="20" r="8.5" fill="var(--wmb-dot-color, #15335e)" stroke="#fff" stroke-width="2.5"/>' +
            '</svg>';
        // Otobüs görseli ortak bileşenden: 2B üstten ikon + 3B hacimli gövde
        // (eğimli görünümde otomatik geçer — WmbMapCore.poseBusIcon)
        var bus = (window.WmbMapCore && WmbMapCore.createBusIcon)
            ? WmbMapCore.createBusIcon(vkind)
            : (function () {
                  var i = document.createElement('img');
                  i.className = 'wmb-vmarker__bus'; i.src = '/images/vehicles/' + vkind + '-top.svg'; i.alt = '';
                  i._kind = vkind;
                  return i;
              })();
        var label = document.createElement('div');
        label.className = 'wmb-vmarker__label';
        var route = document.createElement('span');
        route.className = 'wmb-vmarker__route d-none';
        var lab = document.createElement('span');
        lab.className = 'wmb-vmarker__plate'; lab.textContent = plate || '';
        label.appendChild(route); label.appendChild(lab);
        el.appendChild(dot); el.appendChild(bus); el.appendChild(label);
        el._dot = dot; el._bus = bus; el._plate = lab; el._route = route;
        if (simplifyVehicles()) el.classList.add('is-far');   // ilk durum
        setVehicleRoute(el, routeCode);
        el.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (followKey === key) { clearFollow(); return; }   // tekrar tıklama: takibi bırak
            followVehicle(key);
        });
        return el;
    }
    function applyHeading(el, h) {
        var dir = ((h % 360) + 360) % 360;
        el._heading = dir;
        // Otobüs görseli hareket yönüne (gpsDir, 0° = kuzey) döner; harita
        // döndürülmüşse bearing telafi edilir. Eğimli görünümde 2B üstten ikon
        // yerine gerçek 3B gövde çizilir — geçiş ve duruş hesabı tüm
        // ekranlarda ortak (WmbMapCore.poseBusIcon).
        var bearing = (map && map.getBearing) ? map.getBearing() : 0;
        if (window.WmbMapCore && WmbMapCore.poseBusIcon && el._bus && el._bus._top) {
            WmbMapCore.poseBusIcon(map, el._bus, dir);
        } else if (el._bus) {
            el._bus.style.transform = 'rotateZ(' + (dir - bearing) + 'deg)';
        }
        // Uzak-bakış dot'unun oku da hareket yönüne dönsün (düz, perspektifsiz)
        if (el._dot) el._dot.style.transform = 'rotateZ(' + (dir - bearing) + 'deg)';
    }
    // Harita döndürüldüğünde / eğim (2D-3D) değiştiğinde tüm otobüs ikonlarını güncelle
    function refreshVehicleHeadings() {
        Object.keys(vehiclesIndex).forEach(function (k) {
            var e = vehiclesIndex[k];
            if (e && e._attached && e.el && e.el._heading != null) applyHeading(e.el, e.el._heading);
        });
    }
    map.on('rotate', refreshVehicleHeadings);
    map.on('pitch', refreshVehicleHeadings);

    // Detay seviyesi (LOD): genel bakışta uzak zoom'da sade daire+ok, yakınlaşınca
    // detaylı ikon. '.is-far' → dot görünür, otobüs+plaka gizli; üstünde tersi.
    // 'zoom' her karede gelir; tüm araçları gezmek (Bursa ~1.200) yalnız eşik
    // GEÇİLDİĞİNDE yapılır. Yeni araçlar durumu makeVehicleEl'de alır.
    var lastLodFar = null;
    function syncVehicleLod(force) {
        var far = simplifyVehicles();
        if (force !== true && far === lastLodFar) return;
        lastLodFar = far;
        Object.keys(vehiclesIndex).forEach(function (k) {
            var e = vehiclesIndex[k];
            if (e && e.el) e.el.classList.toggle('is-far', far);
        });
    }
    map.on('zoom', syncVehicleLod);

    // ----- Kümeleme: GENEL BAKIŞ modunda, uzak zoom'da yan yana düşen otobüs
    // dotları tek BÜYÜK daireye toplanır (içinde araç sayısı yazar). Yakınlaştıkça
    // noktalar ekranda ayrışır ve kümeler kendiliğinden dağılır; LOD_ZOOM üstünde
    // ve hat seçiliyken kümeleme tamamen kapalıdır (detaylı otobüs ikonları
    // görünür). Sayı HTML içinde yazıldığı için glyph sunucusuna ihtiyaç yoktur
    // (bkz. CLAUDE.md glyph tuzağı).
    var CLUSTER_RADIUS_PX = 42;
    var clusterMarkers = [];
    var clusterRaf = null;

    function clearClusterMarkers() {
        clusterMarkers.forEach(function (m) { m.remove(); });
        clusterMarkers = [];
    }

    // Kümeler her eşitlemede SİLİNİP yeniden kurulmaz (2026-09-13): eskiden her
    // araç yoklamasında ve her moveend'de tüm balonlar kaldırılıp yeniden
    // yaratılıyor, giriş animasyonu baştan oynuyor ve balonlar "yanıp sönüyor"
    // gibi görünüyordu. 2026-09-22'den beri balonlar KALICI nesnelerdir: araçlar
    // önce mevcut balonlara bağlanır (üyelik histerezisi, CLUSTER_KEEP_PX), balon
    // üyelerinin ortalamasına kayar, yalnız bağlanamayan araçlardan yeni balon
    // doğar (≥3), üyesi 2'nin altına düşen balon dağılır, yaklaşan balonlar birleşir.
    // Üyelik histerezisi: kümeli araç balondan ancak bu uzaklıkta AYRILIR (katılma eşiği
    // CLUSTER_RADIUS_PX) — bkz. syncVehicleClusters.
    var CLUSTER_KEEP_PX = CLUSTER_RADIUS_PX * 1.4;
    var CLUSTER_MIN_NEW = 3, CLUSTER_MIN_KEEP = 2;

    function styleClusterEl(el, n) {
        var size = Math.min(54, 30 + Math.round(Math.sqrt(n) * 4)); // 3 araç ≈ 37px, 20 araç ≈ 48px
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        if (window.WmbMapCore) WmbMapCore.applyClusterLevel(el, n);
        var inner = el.firstChild;
        if (inner && inner.textContent !== String(n)) inner.textContent = String(n);
        el.title = n + ' ' + t('js.cluster.bus', 'otobüs');
    }

    function makeClusterMarker(lng, lat, n) {
        var el = document.createElement('div');
        el.className = 'wmb-vcluster';
        // Görsel/animasyon iç elemanda: kök elemanın transform'unu MapLibre
        // konumlandırma için kullanır, keyframe ile çakışmamalı.
        var inner = document.createElement('div');
        inner.className = 'wmb-vcluster__c';
        el.appendChild(inner);
        styleClusterEl(el, n);
        var marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
        el.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var c = marker.getLngLat();
            map.easeTo({ center: [c.lng, c.lat], zoom: Math.min(map.getZoom() + 2.2, LOD_ZOOM + 0.5), duration: 500 });
        });
        return marker;
    }

    // ----- Görünürlük ayıklaması (culling) — 2026-09-16
    // MapLibre HTML marker'ı haritaya bağlı olduğu sürece HER KAREDE yeniden
    // konumlar; CSS ile gizlenmiş (display:none) marker da bu işe dahildir.
    // Bursa'da ~1.200 araçla yakınlaşınca (kümeleme kapanır) tüm araçlar ekran
    // dışındakiler dahil 3B gövdeli ikon olarak çiziliyor, harita kasıyordu.
    // Artık ekran (paylı) dışındaki ve kümeye giren araçların marker'ı haritadan
    // AYRILIR (marker.remove); görünür alana girince geri eklenir. Konum/yön
    // verisi entry'de tutulmaya devam eder. İzlenen araç her zaman bağlıdır.
    var CULL_PAD = 0.3;   // görünür alanın her yanına eklenen pay (kısa kaydırmada boşluk görünmesin)
    function makeViewTest(pad) {
        var b = map.getBounds();
        var pl = (b.getEast() - b.getWest()) * pad, pa = (b.getNorth() - b.getSouth()) * pad;
        var w = b.getWest() - pl, e = b.getEast() + pl, so = b.getSouth() - pa, n = b.getNorth() + pa;
        return function (lng, lat) { return lng >= w && lng <= e && lat >= so && lat <= n; };
    }
    function attachEntry(e) {
        if (!e || e._attached || !e.marker) return;
        e.marker.addTo(map);
        e._attached = true;
        if (e.el && e.el._heading != null) applyHeading(e.el, e.el._heading);
    }
    function detachEntry(e) {
        if (!e || !e._attached || !e.marker) return;
        e.marker.remove();
        e._attached = false;
    }
    function syncVehicleCulling(inView) {
        inView = inView || makeViewTest(CULL_PAD);
        Object.keys(vehiclesIndex).forEach(function (k) {
            var e = vehiclesIndex[k];
            if (!e || !e.marker) return;
            var show = k === followKey;
            if (!show && !e.clustered) {
                var ll = e.marker.getLngLat();
                show = inView(ll.lng, ll.lat);
            }
            if (show) attachEntry(e); else detachEntry(e);
        });
    }

    function syncVehicleClusters() {
        var keys = Object.keys(vehiclesIndex);
        var far = simplifyVehicles();
        var inView = makeViewTest(CULL_PAD);
        if (!far || keys.length < 2) {
            clearClusterMarkers();
            keys.forEach(function (k) {
                var e = vehiclesIndex[k];
                if (e) e.clustered = false;
            });
            syncVehicleCulling(inView);
            return;
        }
        // Konum: animasyonun HEDEFİ (animTo) — mevcut marker konumu animasyon fazına göre
        // değişir, aynı yoklama içinde kümeleme kararı fazdan bağımsız olmalı.
        function posOf(e) {
            if (e.animTo && isFinite(e.animTo[0]) && isFinite(e.animTo[1])) return { lng: e.animTo[0], lat: e.animTo[1] };
            return e.marker.getLngLat();
        }

        // ÜYELİK HİSTEREZİSİ (2026-09-22, Bursa ~1.400 araç): kümeler her yoklamada sıfırdan
        // açgözlü kurulunca sınırdaki araçlar bir yoklama balona giriyor (gizleniyor), bir
        // sonrakinde çıkıyordu — 36 sn'de görünür 550 aracın 91'i en az bir kez kaybolup geri
        // geldi ("otobüsler bir geliyor bir gidiyor"). Şimdi önce MEVCUT balonlara bağlılık
        // denenir: zaten kümeli araç balondan ancak CLUSTER_KEEP_PX'ten uzaklaşınca ayrılır,
        // kümesiz araç balona ancak CLUSTER_RADIUS_PX içine girince katılır. Yalnız hiçbir
        // balona bağlanamayanlar açgözlü yeni küme oluşturur (≥3). Birbirine yaklaşan balonlar
        // birleştirilir.
        var existing = clusterMarkers.map(function (m) {
            var q = map.project(m.getLngLat());
            return { marker: m, x: q.x, y: q.y, members: [], sumLng: 0, sumLat: 0, sx: 0, sy: 0 };
        });
        var loose = [];
        keys.forEach(function (k) {
            var e = vehiclesIndex[k];
            if (!e || !e.marker || !e.el) return;
            var was = !!e.clustered;
            e.clustered = false;
            if (k === followKey) return; // izlenen araç asla kümelenmez
            var ll = posOf(e);
            if (!inView(ll.lng, ll.lat)) return;
            var p = map.project(ll);
            var item = { e: e, ll: ll, p: p };
            var best = null, bestD = was ? CLUSTER_KEEP_PX : CLUSTER_RADIUS_PX;
            for (var i = 0; i < existing.length; i++) {
                var dx = existing[i].x - p.x, dy = existing[i].y - p.y;
                var d = Math.sqrt(dx * dx + dy * dy);
                if (d < bestD) { best = existing[i]; bestD = d; }
            }
            if (best) { best.members.push(item); best.sumLng += ll.lng; best.sumLat += ll.lat; best.sx += p.x; best.sy += p.y; }
            else loose.push(item);
        });

        // Yaşayan balonlar: ≥ CLUSTER_MIN_KEEP üye; merkez üyelerin ortalamasına kayar.
        // Dağılan balonun üyeleri serbest kalır (yeniden kümeleme adayı).
        var alive = [];
        existing.forEach(function (c) {
            var n = c.members.length;
            if (n >= CLUSTER_MIN_KEEP) { c.x = c.sx / n; c.y = c.sy / n; alive.push(c); }
            else { c.marker.remove(); c.members.forEach(function (it) { loose.push(it); }); }
        });
        // Birbirine yaklaşan balonlar birleşir (aksi hâlde üst üste iki balon kalır)
        for (var a = 0; a < alive.length; a++) {
            for (var b = alive.length - 1; b > a; b--) {
                var ddx = alive[a].x - alive[b].x, ddy = alive[a].y - alive[b].y;
                if (Math.sqrt(ddx * ddx + ddy * ddy) < CLUSTER_RADIUS_PX) {
                    var A = alive[a], B = alive[b];
                    B.members.forEach(function (it) { A.members.push(it); });
                    A.sumLng += B.sumLng; A.sumLat += B.sumLat; A.sx += B.sx; A.sy += B.sy;
                    A.x = A.sx / A.members.length; A.y = A.sy / A.members.length;
                    B.marker.remove();
                    alive.splice(b, 1);
                }
            }
        }

        // Serbest araçlar: ekran (piksel) uzaklığına göre açgözlü YENİ kümeler
        var fresh = [];
        loose.forEach(function (it) {
            var p = it.p, best = null, bestD = CLUSTER_RADIUS_PX;
            for (var i = 0; i < fresh.length; i++) {
                var dx = fresh[i].x - p.x, dy = fresh[i].y - p.y;
                var d = Math.sqrt(dx * dx + dy * dy);
                if (d < bestD) { best = fresh[i]; bestD = d; }
            }
            if (best) {
                best.members.push(it);
                best.sumLng += it.ll.lng; best.sumLat += it.ll.lat;
                var n = best.members.length;
                best.x = (best.x * (n - 1) + p.x) / n;   // merkez üyelerin ortalamasına kayar
                best.y = (best.y * (n - 1) + p.y) / n;
            } else {
                fresh.push({ x: p.x, y: p.y, sumLng: it.ll.lng, sumLat: it.ll.lat, members: [it] });
            }
        });

        var nextMarkers = [];
        alive.forEach(function (c) {
            var n = c.members.length;
            c.members.forEach(function (it) { it.e.clustered = true; });
            styleClusterEl(c.marker.getElement(), n);
            c.marker.setLngLat([c.sumLng / n, c.sumLat / n]);
            nextMarkers.push(c.marker);
        });
        fresh.forEach(function (c) {
            var n = c.members.length;
            if (n < CLUSTER_MIN_NEW) return;
            c.members.forEach(function (it) { it.e.clustered = true; });
            nextMarkers.push(makeClusterMarker(c.sumLng / n, c.sumLat / n, n));
        });
        clusterMarkers = nextMarkers;
        syncVehicleCulling(inView);
    }

    function scheduleClusterSync() {
        // Takip kamerasının per-frame jumpTo'su da moveend üretir; saf kaydırma
        // araçların birbirine göre ekran uzaklıklarını değiştirmez — kümeleri
        // sürekli yıkıp yeniden kurmak yalnızca animasyonlarını sıfırlardı.
        if (followCamBusy) return;
        if (clusterRaf) return;
        // rAF değil setTimeout: sekme/panel arka plandayken rAF hiç çalışmaz,
        // kümeler güncellenmeden kalırdı. Kısa gecikme ardışık olayları birleştirir.
        clusterRaf = setTimeout(function () {
            clusterRaf = null;
            syncVehicleClusters();
        }, 60);
    }
    map.on('zoomend', scheduleClusterSync);
    map.on('moveend', scheduleClusterSync);
    // Kaydırma/yakınlaştırma SÜRERKEN de görünür alana giren araçlar eklenir,
    // çıkanlar ayrılır (en çok 250 ms'de bir; takip kamerasında da çalışır).
    var cullThrottleAt = 0, cullTimer = null;
    map.on('move', function () {
        var now = Date.now();
        if (now - cullThrottleAt >= 250) { cullThrottleAt = now; syncVehicleClusters(); return; }
        if (cullTimer) return;
        cullTimer = setTimeout(function () { cullTimer = null; cullThrottleAt = Date.now(); syncVehicleClusters(); }, 260);
    });

    // ----- Routes (kalıcı hat listesi — açılışta TÜM hatlar listelenir)
    var $listWrap = document.getElementById('wmb-routelist-wrap');
    var $routeCount = document.getElementById('wmb-route-count');
    function setListVisible(on) {
        if ($listWrap) $listWrap.classList.toggle('d-none', !on);
    }

    function loadRoutes() {
        $searchLoad.classList.remove('d-none');
        fetchJson(cfg.endpoints.routes)
            .then(function (env) {
                var data = unwrap(env);
                allRoutes = data.routes || [];
                routeByCode = {};
                allRoutes.forEach(function (x) {
                    var k = String(x.routeCode || '');
                    if (k && !routeByCode[k]) routeByCode[k] = x; // ilk eşleşme — eski find() ile aynı
                });
                $searchLoad.classList.add('d-none');
                buildKindFilter();
                renderBusList(filterRoutes('')); // tüm hatlar listede (tür filtresi uygulanmış) — kullanıcı buradan seçer
            })
            .catch(function (err) {
                console.error('[WMB] routes', err);
                $searchLoad.classList.add('d-none');
                showStatus(t('js.error.routes', 'Hatlar yüklenemedi.'), 4000);
            });
    }

    // TR/EN karakter duyarsız arama: "balik" → "BALIKPAZARI" ile eşleşir
    var fold = window.trFold || function (s) { return String(s == null ? '' : s).toLowerCase(); };

    function filterRoutes(q) {
        var list = kindFilterActive() ? allRoutes.filter(function (r) { return kindAllowed(routeKindOf(r)); }) : allRoutes.slice();
        if (!q) return list;
        var needle = fold(q);
        return list.filter(function (r) {
            var hay = fold((r.routeCode || '') + ' ' + (r.shortTitle || '') + ' ' + (r.title || '') + ' ' + (r.description || ''));
            return hay.indexOf(needle) !== -1;
        });
    }

    // ----- Hat türü filtresi (Transit:RouteTypeFilter — mobil BursaKart "Filtrele" paritesi)
    // Seçenekler listede GERÇEKTEN bulunan türlerden kurulur (Otobüs/Minibüs/Metro/Tramvay);
    // tek tür varsa düğme hiç görünmez. Seçim bu tarayıcıda hatırlanır (localStorage).
    // Filtre hat listesine VE genel bakış haritasına (hat çizgileri + canlı araçlar) uygulanır.
    // Sıra OmniLocal /Alm/Get/VehicleTypes yanıtıyla aynı (5 Otobüs, 4 Minibüs, 32 Tramvay, 126 Metro);
    // taksi dolmuş (Balıkesir AVL 10001) minibüsün ardından, otopark (Trabzon Trapark 10008) en sonda.
    var KIND_ORDER = ['bus', 'minibus', 'dolmus', 'tram', 'metro', 'parking'];
    var KIND_STORE = 'wmb.routeKindFilter';
    var $filterBtn   = document.getElementById('wmb-filter-btn');
    var $filterPanel = document.getElementById('wmb-filter-panel');
    var $filterOpts  = document.getElementById('wmb-filter-opts');
    var $filterAll   = document.getElementById('wmb-filter-all');
    var $filterDot   = document.getElementById('wmb-filter-dot');
    var availableKinds = [];     // listede bulunan türler (KIND_ORDER sırasıyla)
    var hiddenKinds = {};        // kullanıcının KAPATTIĞI türler (yeni tür gelirse varsayılan açık)
    function routeKindOf(r) {
        return (window.WmbMapCore && WmbMapCore.vehicleKind) ? WmbMapCore.vehicleKind(r ? r.routeTypeId : null) : 'bus';
    }
    function kindAllowed(kind) { return !hiddenKinds[kind]; }
    function kindFilterActive() {
        return !!cfg.routeTypeFilter && availableKinds.some(function (k) { return hiddenKinds[k]; });
    }
    (function loadKindFilter() {
        if (!cfg.routeTypeFilter) return;
        try {
            var raw = window.localStorage.getItem(KIND_STORE);
            (raw ? JSON.parse(raw) : []).forEach(function (k) { if (KIND_ORDER.indexOf(k) !== -1) hiddenKinds[k] = true; });
        } catch (e) { hiddenKinds = {}; }
    })();
    function saveKindFilter() {
        try { window.localStorage.setItem(KIND_STORE, JSON.stringify(Object.keys(hiddenKinds).filter(function (k) { return hiddenKinds[k]; }))); }
        catch (e) { /* gizli pencere vb. — oturum içinde yine çalışır */ }
    }
    function buildKindFilter() {
        if (!cfg.routeTypeFilter || !$filterBtn || !$filterOpts) return;
        var counts = {};
        allRoutes.forEach(function (r) { var k = routeKindOf(r); counts[k] = (counts[k] || 0) + 1; });
        availableKinds = KIND_ORDER.filter(function (k) { return counts[k]; });
        $filterBtn.classList.toggle('d-none', availableKinds.length < 2);
        if (availableKinds.length < 2) { $filterPanel.classList.add('d-none'); hiddenKinds = {}; }
        $filterOpts.innerHTML = availableKinds.map(function (k) {
            return '<label class="wmb-filter__opt">'
                 +   '<input type="checkbox" data-kind="' + k + '"' + (kindAllowed(k) ? ' checked' : '') + '>'
                 +   '<span class="wmb-filter__check"><i class="bi bi-check-lg" aria-hidden="true"></i></span>'
                 +   '<span class="icon icon-bus' + (k === 'bus' ? '' : ' icon-bus--' + k) + '" aria-hidden="true"></span>'
                 +   '<span>' + escapeHtml(t('wmb.kind.' + k, k)) + '</span>'
                 +   '<span class="wmb-filter__n">' + counts[k] + '</span>'
                 + '</label>';
        }).join('');
        syncKindFilterUi();
        applyOverviewKindFilter();
    }
    function syncKindFilterUi() {
        if ($filterDot) $filterDot.classList.toggle('d-none', !kindFilterActive());
    }
    function onKindFilterChanged() {
        saveKindFilter();
        syncKindFilterUi();
        renderBusList(filterRoutes($search.value.trim()));
        applyOverviewKindFilter();
        if (overviewActive) {
            overviewLastGen = null;   // aynı snapshot'ı yeni filtreyle yeniden bas
            loadOverviewVehicles().catch(function (err) { console.warn('[WMB] overview filter', err); });
        }
    }
    /** Genel bakış hat çizgileri: izin verilen türlerin hat kodlarıyla süzülür. */
    function applyOverviewKindFilter() {
        whenReady(function () {
            if (!map.getLayer('allroutes-line')) return;
            if (!kindFilterActive()) { map.setFilter('allroutes-line', null); return; }
            var codes = allRoutes.filter(function (r) { return kindAllowed(routeKindOf(r)); })
                                 .map(function (r) { return String(r.routeCode || ''); });
            map.setFilter('allroutes-line', ['in', ['get', 'code'], ['literal', codes]]);
        });
    }
    if ($filterBtn && $filterPanel) {
        $filterBtn.addEventListener('click', function () {
            var open = $filterPanel.classList.contains('d-none');
            $filterPanel.classList.toggle('d-none', !open);
            $filterBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        $filterOpts.addEventListener('change', function (e) {
            var cb = e.target.closest('input[data-kind]'); if (!cb) return;
            var kind = cb.getAttribute('data-kind');
            if (!cb.checked) {
                // Hepsini kapatmak boş liste verir — son açık tür kapatılamaz (mobilde de en az biri seçili kalır)
                var stillOn = availableKinds.filter(function (k) { return k !== kind && kindAllowed(k); });
                if (!stillOn.length) { cb.checked = true; return; }
                hiddenKinds[kind] = true;
            } else {
                delete hiddenKinds[kind];
            }
            onKindFilterChanged();
        });
        $filterAll.addEventListener('click', function () {
            hiddenKinds = {};
            $filterOpts.querySelectorAll('input[data-kind]').forEach(function (cb) { cb.checked = true; });
            onKindFilterChanged();
        });
    }

    // Favori hatlar (çerez `favoriteroutes`, js/favorites.js) — listenin başında ayrı bölüm,
    // her satırda yıldız. Favori yokken bölüm başlıkları basılmaz (eski görünüm).
    var favRoutes = window.WmbFavorites ? WmbFavorites.routes : null;
    function isFavRoute(r) { return !!favRoutes && favRoutes.has(r.id); }
    function routeRowHtml(r) {
        // Üst başlık: Transit:RouteListTitle — 'shortTitle' (Balıkesir: Kısa Ad, "23T") ya da
        // varsayılan hat kodu. Kısa Ad boşsa hat koduna düşülür; alt satır Açıklama'dır ve
        // üst başlığı yinelemez.
        var byShort = cfg.routeListTitle === 'shortTitle';
        var code = (byShort && String(r.shortTitle || '').trim()) || r.routeCode || '';
        var desc  = r.description || r.shortTitle || r.title || '';
        if (byShort && desc === code) desc = (r.title && r.title !== code) ? r.title : '';
        return '<div class="mat-option" data-route-id="' + r.id + '">'
             +   '<div class="item flex middle">'
             +     '<div class="icon icon-bus' + routeKindClass(r) + '"></div>'
             +     '<div class="route-text">'
             +       '<div class="route-title">' + escapeHtml(code) + '</div>'
             +       (desc ? '<div class="route-description">' + escapeHtml(desc) + '</div>' : '')
             +     '</div>'
             +     (favRoutes ? WmbFavorites.starHtml('routes', r.id, isFavRoute(r)) : '')
             +   '</div>'
             + '</div>';
    }
    function renderBusList(matches) {
        if ($routeCount) $routeCount.textContent = matches.length;
        if (!matches.length) {
            var emptyMsg = (kindFilterActive() && !$search.value.trim())
                ? t('wmb.filter.none', 'Seçili türde hat yok. Filtreyi değiştirin.')
                : t('js.empty.routes', 'Hat bulunamadı.');
            $busList.innerHTML = '<div class="text-muted small p-3">' + escapeHtml(emptyMsg) + '</div>';
            $busList.classList.remove('d-none');
            return;
        }
        var favs = matches.filter(isFavRoute);
        var rest = favs.length ? matches.filter(function (r) { return !isFavRoute(r); }) : matches;
        var html = '';
        if (favs.length) {
            html += WmbFavorites.sectionHtml('bi-star-fill', t('fav.routes', 'Favori Hatlar'), favs.length, 'wmb-favsect--fav')
                  + favs.map(routeRowHtml).join('')
                  + (rest.length ? WmbFavorites.sectionHtml('bi-signpost-2', t('fav.allRoutes', 'Tüm Hatlar'), rest.length) : '');
        }
        html += rest.map(routeRowHtml).join('');
        $busList.innerHTML = html;
        $busList.classList.remove('d-none');
    }

    // ----- Variants
    function selectRoute(route) {
        stopOverview(); // tek hat moduna geç: silik hat çizgileri + tüm otobüsler gizlenir
        boardingPending = true; // yeni hat seçildi → veriler yüklenince binme popup'ı açılsın
        selectedRoute = route;
        $search.value = (route.routeCode || '') + ' ' + (route.shortTitle || route.title || '');
        setListVisible(false); // liste yerini hat detayına bırakır
        $searchClear.classList.remove('d-none');
        showStatus(t('js.loading.route', 'Rota bilgileri yükleniyor...'));

        // Hattın AVL duyuruları varsa popup olarak göster (yoksa sessiz)
        if (window.WmbAvlAnn) {
            WmbAvlAnn.showFor('route', route.id, {
                title: [route.routeCode, route.shortTitle || route.title].filter(Boolean).join(' - ')
            });
        }

        fetchJson(cfg.endpoints.variants + encodeURIComponent(route.id))
            .then(function (env) {
                var data = unwrap(env);
                var node = (data.route && data.route[0]) || {};
                variants = node.routeVariants || [];
                if (!variants.length) {
                    showStatus(t('js.error.variant', 'Bu hat için varyant bulunamadı.'), 4000);
                    return;
                }
                renderVariantSelect(variants);
                var baseline = variants.find(function (v) { return v.isBaseLineVariant === true; })
                            || variants.find(function (v) { return v.directionTypeTitle === 'Gidiş'; })
                            || variants[0];
                pickVariant(baseline);
            })
            .catch(function (err) {
                console.error('[WMB] variants', err);
                showStatus(t('js.error.route', 'Hat bilgileri yüklenemedi.'), 4000);
            });
    }

    function variantLabel(v) {
        // Transit:VariantTitle = 'description' (Bursa): varyantın kendi Açıklama'sı ("A -> B")
        // + yön. Hat adı iki yönde aynı olduğundan eski etiket yalnız Gidiş/Dönüş ile ayrışıyordu.
        var desc = String(v.description || '').trim();
        if (cfg.variantTitle === 'description' && desc && desc !== String(v.title || '').trim()) {
            // Açıklama yönü zaten içeriyorsa (Malatya: "MALİYE - İNÖNÜ M.Y.O - Gidiş") tekrar eklenmez.
            var hasDir = v.directionTypeTitle && desc.indexOf(v.directionTypeTitle) !== -1;
            return desc.replace(/\s*->\s*/g, ' → ') + (v.directionTypeTitle && !hasDir ? ' (' + v.directionTypeTitle + ')' : '');
        }
        var base = v.title || v.description || v.routeVariantCode || v.variantCode || ('#' + v.id);
        var dir = v.directionTypeTitle ? ' - ' + v.directionTypeTitle : '';
        // title zaten yön bilgisini içeriyorsa tekrar ekleme
        if (v.title && v.directionTypeTitle && v.title.indexOf(v.directionTypeTitle) !== -1) dir = '';
        return base + dir + ' (' + t('js.label.baseline', 'Ana Hat') + ')';
    }

    function renderVariantSelect(list) {
        $variantValue.textContent = '';
        var html = list.map(function (v) {
            return '<li class="custom-select__option" data-variant-id="' + v.id + '">' + escapeHtml(variantLabel(v)) + '</li>';
        }).join('');
        $variantPanel.innerHTML = html;
        $variantWrap.classList.remove('d-none');
    }

    function pickVariant(variant) {
        if (!variant) return;
        selectedVariant = variant;
        $variantValue.textContent = variantLabel(variant);
        $variantPanel.classList.add('d-none');

        stopPolling();
        clearStations();
        clearRoute();
        resetVehicles();
        scheduleCache = {};
        selectedDay = 0;

        $busDetail.classList.remove('d-none');
        activateTab('stops');

        $hoursTitle.textContent = variant.title || '';
        $dayValue.textContent = t('wmb.daySelect', 'Gün Seçiniz');
        $hoursList.innerHTML = '';
        $scheduleDesc.classList.add('d-none');
        $scheduleDesc.textContent = '';
        $priceList.innerHTML = '';
        $stopsList.innerHTML = '<div class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm"></div></div>';

        // Polyline öncelikle variant.geom'dan, yoksa stations response'undaki polyline'dan
        drawGeomPolyline(variant.geom);

        showStatus(t('js.loading.detail', 'Durak ve araç bilgileri yükleniyor...'));
        Promise.all([loadStations(variant.id), loadVehicles(variant.id)])
            .then(function () {
                showStatus(null);
                startPolling();
                renderWeekDays();
                loadScheduleForToday();
                loadPrice();
                onVariantReady(); // binme durağı önerisi: FAB'ı göster + (ilk seçimde) popup'ı aç
            })
            .catch(function (err) {
                console.error('[WMB] variant load', err);
                showStatus(t('js.error.detail', 'Veriler yüklenemedi.'), 4000);
            });
    }

    function drawGeomPolyline(geom) {
        if (!geom) return;
        var parsed;
        try { parsed = typeof geom === 'string' ? JSON.parse(geom) : geom; } catch (e) { return; }
        var g = parsed && parsed.geometry ? parsed.geometry : parsed;
        if (!g || !g.coordinates) return;

        function addLine(coords) {
            var pts = coords
                .map(function (c) { return (c && c.length >= 2) ? [Number(c[0]), Number(c[1])] : null; })
                .filter(Boolean);
            addRouteCoords(pts);
        }
        if (g.type === 'LineString') addLine(g.coordinates);
        else if (g.type === 'MultiLineString') g.coordinates.forEach(addLine);
    }

    function extractStations(data) {
        // Upstream şeması: result.routeVariantStops[0].station[] (yeni)
        // Geri uyumlu: result.stations[] (eski)
        if (Array.isArray(data && data.stations)) return data.stations;
        if (Array.isArray(data && data.routeVariantStops)) {
            var acc = [];
            data.routeVariantStops.forEach(function (grp) {
                (grp.station || grp.stations || []).forEach(function (s) { acc.push(s); });
            });
            return acc;
        }
        return [];
    }

    // ----- Stations
    // Gösterim formatı her yerde aynı: "DURAK ADI - stopNo" (liste, harita etiketi,
    // hover popup, biniş önerisi). stopNo yoksa yalnız ad gösterilir.
    // "SARUHAN 683" gibi adı zaten numarayla biten duraklarda numara TEKRAR
    // eklenmez ("SARUHAN 683 - 683" olmasın). Yalnız tam son parça eşleşmesi
    // bastırılır: "SEVİNDİK 7" + 1207 → eklenir ("7" ≠ "1207").
    function nameEndsWithNo(name, no) {
        if (name === no) return true;
        var tail = name.slice(-(no.length + 1));
        return tail === ' ' + no || tail === '-' + no;
    }
    function stopDisplayName(s) {
        var name = String(s.stopTitle || s.title || s.stationName || s.stopName || '').trim();
        var no = String(s.stopNo || '').trim();
        if (!name) return no ? (t('js.label.stop', 'Durak') + ' #' + no) : '';
        if (!no || nameEndsWithNo(name, no)) return name;
        // NBSP + U+2011 (bölünmez tire): satır sarmada "- no" addan kopmasın.
        // Normal tire yeterli DEĞİL: UAX #14 LB12a tireden sonra kırılıma izin verir.
        return name + '\u00A0\u2011\u00A0' + no;
    }

    function loadStations(variantId) {
        return fetchJson(cfg.endpoints.stations + variantId).then(function (env) {
            var data = unwrap(env);
            clearStations();

            var stops = extractStations(data).slice().sort(function (a, b) {
                return (a.rowNo != null ? a.rowNo : (a.sequence || 0)) - (b.rowNo != null ? b.rowNo : (b.sequence || 0));
            });

            stops.forEach(function (s, i) {
                var pt = lonLatOf(s);
                if (!pt) return;
                addStation(pt, stopDisplayName(s), i === 0 ? 'start' : (i === stops.length - 1 ? 'end' : 'mid'), s.id != null ? s.id : s.stopId);
            });
            setStationData();

            renderStopsList(stops);
            if ($infoStops) $infoStops.textContent = stops.length;
            if ($routeInfo) $routeInfo.classList.remove('d-none');

            if (routeLines.length === 0 && data.polyline && data.polyline.length > 1) {
                var coords = data.polyline
                    .slice()
                    .sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); })
                    .map(function (p) { return lonLatOf(p); })
                    .filter(Boolean);
                addRouteCoords(coords);
            }

            fitToStations();
        });
    }

    var currentStops = [];   // sıralı hat durakları — listedeki otobüs konumlandırması için
    function renderStopsList(stops) {
        closeStopDetail();
        currentStops = stops || [];
        if (!stops.length) {
            $stopsList.innerHTML = '<div class="text-center text-muted small py-3">' + t('js.empty.stops', 'Durak bulunamadı.') + '</div>';
            return;
        }
        var last = stops.length - 1;
        var html = stops.map(function (s, i) {
            var name = stopDisplayName(s) || (t('js.label.stop', 'Durak') + ' #' + (s.stopId || s.id));
            var iconCls = (i === 0) ? 'stop-icon stop-icon--start'
                        : (i === last) ? 'stop-icon stop-icon--end'
                        : 'stop-icon stop-icon--mid';
            var sid = s.id != null ? s.id : (s.stopId != null ? s.stopId : '');
            return '<div class="list-item flex middle between" data-si="' + i + '" data-stop-id="' + escapeHtml(sid) + '" data-stop-lon="' + (s.longitude || '') + '" data-stop-lat="' + (s.latitude || '') + '">'
                 +   '<div class="busstop-name flex middle">'
                 +     '<div class="' + iconCls + '"></div>'
                 +     '<div class="name">' + escapeHtml(name) + '</div>'
                 +   '</div>'
                 + '</div>';
        }).join('');
        $stopsList.innerHTML = html;
        updateBusPositionsInList();
    }

    // ===== Durak detayı (hat modu) — Akıllı Durak paritesi (2026-09-13) =====
    // Durak satırına ya da haritadaki pin'e tıklanınca satırın ALTINDA "Yaklaşan
    // Araçlar / Geçen Hatlar" sekmeli kart açılır. Veri Akıllı Durak'ın uçlarından
    // gelir (/api/smartstop/approaching/{id}, /api/smartstop/routes/{id}); durak
    // kimliği hat duraklarındaki `id` alanıdır (SmartStop durak id'siyle aynı).
    // Yaklaşan araçlar panel açıkken 20 sn'de bir tazelenir; hat/varyant
    // değişince (clearStations/renderStopsList) panel kapanır ve sayaç durur.
    var stopDetail = { el: null, row: null, stopId: null, timer: null, tab: 'approaching', vehicles: [], routes: [] };

    function closeStopDetail() {
        if (stopDetail.timer) { clearInterval(stopDetail.timer); stopDetail.timer = null; }
        if (stopDetail.el && stopDetail.el.parentNode) stopDetail.el.parentNode.removeChild(stopDetail.el);
        if (stopDetail.row) stopDetail.row.classList.remove('is-open');
        stopDetail.el = null; stopDetail.row = null; stopDetail.stopId = null;
        stopDetail.vehicles = []; stopDetail.routes = [];
    }

    function buildStopDetailEl(name) {
        var el = document.createElement('div');
        el.className = 'wmb-stopdetail';
        el.innerHTML =
            '<div class="wmb-stopdetail__head">' +
              '<div class="wmb-stopdetail__title"><i class="bi bi-geo-alt-fill"></i><span>' + escapeHtml(name) + '</span></div>' +
              '<button type="button" class="wmb-stopdetail__close" data-sd-close title="' + escapeHtml(t('co.btn.close', 'Kapat')) + '" aria-label="' + escapeHtml(t('co.btn.close', 'Kapat')) + '"><i class="bi bi-x-lg"></i></button>' +
            '</div>' +
            '<div class="wmb-stopdetail__tabs" role="tablist">' +
              '<button type="button" class="wmb-stopdetail__tab is-active" data-sd-tab="approaching" role="tab"><i class="bi bi-bus-front"></i>' + escapeHtml(t('ss.tab.approaching', 'Yaklaşan Araçlar')) + '</button>' +
              '<button type="button" class="wmb-stopdetail__tab" data-sd-tab="routes" role="tab"><i class="bi bi-signpost-split"></i>' + escapeHtml(t('ss.tab.routes', 'Geçen Hatlar')) + '</button>' +
            '</div>' +
            '<div class="wmb-stopdetail__pane" data-sd-pane="approaching">' +
              '<div class="wmb-stopdetail__meta"><span><i class="bi bi-arrow-repeat"></i> ' + escapeHtml(t('ss.autorefresh', 'Otomatik yenilenir (20 sn)')) + '</span>' +
              '<button type="button" class="wmb-stopdetail__refresh" data-sd-refresh title="' + escapeHtml(t('ss.refresh', 'Yenile')) + '"><i class="bi bi-arrow-clockwise"></i></button></div>' +
              '<ul class="list-group list-group-flush small" data-sd-list="vehicles"></ul>' +
            '</div>' +
            '<div class="wmb-stopdetail__pane d-none" data-sd-pane="routes">' +
              '<ul class="list-group list-group-flush small" data-sd-list="routes"></ul>' +
            '</div>';
        return el;
    }

    function sdList(kind) { return stopDetail.el ? stopDetail.el.querySelector('[data-sd-list="' + kind + '"]') : null; }
    function sdMsg(kind, text, cls) {
        var ul = sdList(kind); if (!ul) return;
        ul.innerHTML = '<li class="list-group-item px-2 small ' + (cls || 'text-muted') + '">' + escapeHtml(text) + '</li>';
    }
    function fmtEtaSd(v) { return v.remainingTimeCurr != null ? v.remainingTimeCurr + ' ' + t('ss.eta.min', 'dk') : '—'; }
    function fmtStopsSd(v) { return v.remainingNumberOfBusStops != null ? v.remainingNumberOfBusStops + ' ' + t('ss.unit.stop', 'durak') : ''; }

    function renderSdVehicles(list) {
        stopDetail.vehicles = list || [];
        var ul = sdList('vehicles'); if (!ul) return;
        if (!list || !list.length) { sdMsg('vehicles', t('ss.vehicles.none', 'Yaklaşan araç yok.')); return; }
        ul.innerHTML = list.map(function (v, i) {
            var code = escapeHtml(v.busLineCode || '');
            var name = escapeHtml(v.busLineShortName || v.busLineLongName || v.description || '');
            var isPlanned = !v.busPlate || v.busPlate === 'Plan';
            var plate = v.busPlate ? '<span class="ss-veh__plate text-muted small">' + escapeHtml(v.busPlate) + '</span>' : '';
            var stops = fmtStopsSd(v);
            var onMap = !isPlanned && !!vehicleKeyByPlate(v.busPlate);
            var tracked = onMap && followKey && followKey === vehicleKeyByPlate(v.busPlate) ? ' is-tracked' : '';
            var cls = 'ss-veh' + tracked + (isPlanned ? ' ss-veh--plan' : '');
            var cta = isPlanned
                ? '<div class="ss-veh__cta ss-veh__cta--plan"><i class="bi bi-clock-history"></i> ' + escapeHtml(t('ss.track.planned', 'Planlı sefer')) + '</div>'
                : (onMap
                    ? '<div class="ss-veh__cta"><i class="bi bi-crosshair"></i> ' + escapeHtml(t('ss.track.hint', 'Aracı canlı izle')) + '</div>'
                    : '<div class="ss-veh__cta"><i class="bi bi-map"></i> ' + escapeHtml(t('ss.route.hint', 'Hattı haritada aç')) + '</div>');
            return '<li class="list-group-item px-2 ' + cls + '" data-sd-vi="' + i + '">' +
                '<div class="d-flex justify-content-between align-items-start">' +
                '<div class="ss-veh__main"><div class="ss-veh__hdr"><span class="badge text-bg-primary">' + code + '</span>' + plate + '</div>' +
                '<div class="small mt-1">' + name + '</div></div>' +
                '<div class="text-end flex-shrink-0 ms-2">' +
                '<div class="fw-semibold">' + escapeHtml(fmtEtaSd(v)) + '</div>' +
                (stops ? '<div class="text-muted small">' + escapeHtml(stops) + '</div>' : '') +
                cta + '</div></div></li>';
        }).join('');
    }

    function sdRouteDisplay(r) {
        var st = r.shortTitle || r.title || '';
        var m = /^([0-9A-Za-z]+)-(.+)$/.exec(st);
        return {
            code: m ? m[1] : (r.routeCode || (r.routeNo != null ? String(r.routeNo) : '')),
            name: m ? m[2] : (st || r.description || '')
        };
    }
    function renderSdRoutes(list) {
        var ul = sdList('routes'); if (!ul) return;
        var seen = {};
        var unique = (list || []).filter(function (r) {
            var k = r.routeCode || String(r.id || '');
            if (!k || seen[k]) return false; seen[k] = true; return true;
        });
        stopDetail.routes = unique;
        if (!unique.length) { sdMsg('routes', t('ss.routes.none', 'Bu duraktan geçen hat bulunamadı.')); return; }
        var curCode = selectedRoute ? String(selectedRoute.routeCode || '') : '';
        ul.innerHTML = unique.map(function (r, i) {
            var d = sdRouteDisplay(r);
            var isCur = curCode && String(r.routeCode || d.code) === curCode;
            return '<li class="list-group-item px-2 ss-veh' + (isCur ? ' is-tracked' : '') + '" data-sd-ri="' + i + '" title="' + escapeHtml(t('ss.route.hint', 'Hattı haritada aç')) + '">' +
                '<div class="d-flex align-items-center gap-2">' +
                '<span class="badge text-bg-primary">' + escapeHtml(d.code) + '</span>' +
                '<span class="small flex-grow-1">' + escapeHtml(d.name) + '</span>' +
                (isCur ? '' : '<span class="ss-veh__cta"><i class="bi bi-map"></i> ' + escapeHtml(t('ss.route.hint', 'Hattı haritada aç')) + '</span>') +
                '</div></li>';
        }).join('');
    }

    function loadSdVehicles(stopId) {
        var ul = sdList('vehicles'); if (!ul) return;
        if (!stopDetail.vehicles.length) sdMsg('vehicles', t('co.loading', 'Yükleniyor…'));
        fetchJson('/api/smartstop/approaching/' + encodeURIComponent(stopId))
            .then(function (json) {
                if (stopDetail.stopId !== stopId) return;
                var list = (json && json.result && (json.result.route || json.result.vehicles)) || [];
                renderSdVehicles(Array.isArray(list) ? list : []);
            })
            .catch(function () { if (stopDetail.stopId === stopId) sdMsg('vehicles', t('ss.vehicles.err', 'Yaklaşan araçlar alınamadı.'), 'text-danger'); });
    }
    function loadSdRoutes(stopId) {
        sdMsg('routes', t('co.loading', 'Yükleniyor…'));
        fetchJson('/api/smartstop/routes/' + encodeURIComponent(stopId))
            .then(function (json) {
                if (stopDetail.stopId !== stopId) return;
                var list = (json && json.result && json.result.route) || [];
                renderSdRoutes(Array.isArray(list) ? list : []);
            })
            .catch(function () { if (stopDetail.stopId === stopId) sdMsg('routes', t('ss.routes.err', 'Duraktan geçen hatlar alınamadı.'), 'text-danger'); });
    }

    function openStopDetail(row, opts) {
        opts = opts || {};
        var stopId = row.getAttribute('data-stop-id');
        if (!stopId) return;
        if (stopDetail.row === row) {
            if (opts.toggle) closeStopDetail();
            return;
        }
        closeStopDetail();
        var idx = Number(row.getAttribute('data-si'));
        var s = currentStops[idx] || {};
        var name = stopDisplayName(s) || (row.querySelector('.name') ? row.querySelector('.name').textContent : '');
        var el = buildStopDetailEl(name);
        row.parentNode.insertBefore(el, row.nextSibling);
        row.classList.add('is-open');
        stopDetail.el = el; stopDetail.row = row; stopDetail.stopId = stopId; stopDetail.tab = 'approaching';
        loadSdVehicles(stopId);
        loadSdRoutes(stopId);
        stopDetail.timer = setInterval(function () {
            if (document.hidden) return;
            loadSdVehicles(stopId);
        }, 20000);
    }

    function setSdTab(name) {
        if (!stopDetail.el) return;
        stopDetail.tab = name;
        stopDetail.el.querySelectorAll('[data-sd-tab]').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-sd-tab') === name); });
        stopDetail.el.querySelectorAll('[data-sd-pane]').forEach(function (p) { p.classList.toggle('d-none', p.getAttribute('data-sd-pane') !== name); });
    }

    function onStopDetailClick(e) {
        e.stopPropagation();
        if (e.target.closest('[data-sd-close]')) { closeStopDetail(); return; }
        var tab = e.target.closest('[data-sd-tab]');
        if (tab) { setSdTab(tab.getAttribute('data-sd-tab')); return; }
        if (e.target.closest('[data-sd-refresh]') && stopDetail.stopId) { loadSdVehicles(stopDetail.stopId); return; }
        var vi = e.target.closest('[data-sd-vi]');
        if (vi) {
            var v = stopDetail.vehicles[Number(vi.getAttribute('data-sd-vi'))];
            if (!v || !v.busPlate || v.busPlate === 'Plan') return;
            var key = vehicleKeyByPlate(v.busPlate);
            if (key) {
                // Aynı hattın aracı ekranda → takibe al
                followVehicle(key);
                stopDetail.el.querySelectorAll('[data-sd-vi]').forEach(function (li) { li.classList.remove('is-tracked'); });
                vi.classList.add('is-tracked');
                return;
            }
            // Başka hattın aracı → o hattı aç (araç orada canlı görünür)
            var rv = allRoutes.find(function (r) { return v.routeId != null && String(r.id) === String(v.routeId); })
                  || allRoutes.find(function (r) { return v.busLineCode && String(r.routeCode || '') === String(v.busLineCode); });
            if (rv) selectRoute(rv);
            return;
        }
        var ri = e.target.closest('[data-sd-ri]');
        if (ri) {
            var r = stopDetail.routes[Number(ri.getAttribute('data-sd-ri'))];
            if (!r) return;
            var code = String(r.routeCode || sdRouteDisplay(r).code || '');
            if (selectedRoute && String(selectedRoute.routeCode || '') === code) return; // zaten bu hat
            var target = allRoutes.find(function (x) { return r.id != null && String(x.id) === String(r.id); })
                      || allRoutes.find(function (x) { return String(x.routeCode || '') === code; });
            if (target) selectRoute(target);
        }
    }

    // ----- Durak listesinde canlı otobüs konumları -----
    // Araç bir durağın ~60 m yakınındaysa o durağın satırında, değilse iki durağın
    // ARASINDA plaka çipiyle gösterilir. Her araç güncellemesinde tazelenir.
    //
    // Yerleşim YOL-BOYU mesafeyle yapılır (2026-09-22): düz-çizgi "en yakın durak" mantığı,
    // hattın kıvrıldığı yerde aracı geçtiği durağın ÖNÜNE koyuyordu (Bursa 3C: Şehreküstü'yü
    // geçip Timurtaş Paşa'ya inen araç Ördekli–Şehreküstü arasında görünüyordu). Seçili
    // varyantın çizgisi + durakların sıra korumalı along değerleri (WmbMapCore.stopsAlongPath)
    // bir kez kurulur; araç, gpsDir'i uyan segmente izdüşürülüp iki durak arasına konur.
    // Çizgi/along yoksa eski düz-çizgi yaklaşımına düşülür.
    var stopPathIdx = null;   // { key, coords, cum, along[] } — varyant/durak listesi değişince yeniden kurulur
    function stopPathIndex() {
        if (!routeLines.length || !currentStops.length || !window.WmbMapCore || !WmbMapCore.stopsAlongPath) return null;
        var key = routeLines.length + ':' + routeLines.reduce(function (n, l) { return n + l.length; }, 0) +
                  ':' + currentStops.length + ':' + String(currentStops[0].id != null ? currentStops[0].id : currentStops[0].stopId);
        if (stopPathIdx && stopPathIdx.key === key) return stopPathIdx;
        var coords = [].concat.apply([], routeLines);
        if (coords.length < 2) return null;
        var cum = WmbMapCore.pathCum(coords);
        stopPathIdx = { key: key, coords: coords, cum: cum,
                        along: WmbMapCore.stopsAlongPath(coords, currentStops.map(lonLatOf), { cum: cum }) };
        return stopPathIdx;
    }
    function updateBusPositionsInList() {
        if (!$stopsList) return;
        $stopsList.querySelectorAll('.wmb-busrow').forEach(function (n) { n.remove(); });
        $stopsList.querySelectorAll('.list-item .wmb-buschip').forEach(function (n) { n.remove(); });
        $stopsList.querySelectorAll('.list-item.is-bus-here').forEach(function (n) { n.classList.remove('is-bus-here'); });
        $stopsList.querySelectorAll('.list-item.is-bus-next').forEach(function (n) { n.classList.remove('is-bus-next'); });
        if (!currentStops.length) return;

        var coords = currentStops.map(lonLatOf);
        var rows = $stopsList.querySelectorAll('.list-item');
        var idx = stopPathIndex();
        function d2(c, pos) {
            if (!c) return Infinity;
            var dx = (c[0] - pos[0]) * Math.cos(pos[1] * Math.PI / 180);
            var dy = c[1] - pos[1];
            return dx * dx + dy * dy;
        }
        function chipHtml(plate) {
            var src = (window.WmbMapCore && WmbMapCore.vehicleTopSrc) ? WmbMapCore.vehicleTopSrc(routeKind('')) : '/images/vehicles/bus-top.svg';
            return '<span class="wmb-buschip" title="' + escapeHtml(plate) + '">' +
                   '<img src="' + src + '" alt="" />' + escapeHtml(plate) + '</span>';
        }
        function placeHere(i, plate) {
            rows[i].classList.add('is-bus-here');
            rows[i].insertAdjacentHTML('beforeend', chipHtml(plate));
        }
        function placeAfter(afterIdx, plate) {
            var between = document.createElement('div');
            between.className = 'wmb-busrow';
            between.innerHTML = '<span class="wmb-busrow__line" aria-hidden="true"></span>' + chipHtml(plate);
            if (afterIdx < 0) {
                // Henüz ilk durağa varmadı — listenin başına
                rows[0].before(between);
                rows[0].classList.add('is-bus-next');
                return;
            }
            rows[afterIdx].after(between);
            // Liste güzergâh sırasında → aracın gittiği durak bir alttaki
            if (rows[afterIdx + 1]) rows[afterIdx + 1].classList.add('is-bus-next');
        }
        Object.keys(vehiclesIndex).forEach(function (k) {
            var e = vehiclesIndex[k];
            if (!e || !e.marker) return;
            var p = e.marker.getLngLat();
            var pos = [p.lng, p.lat];
            var plate = (e.el && e.el._plate) ? e.el._plate.textContent : '';

            // 1) Yol-boyu yerleşim
            if (idx) {
                var pr = WmbMapCore.projectOnPath(idx.coords, pos, { cum: idx.cum, heading: e.headTo, maxOffM: SNAP_DIR_M });
                if (pr) {
                    var hereI = -1, afterI = -1;
                    idx.along.forEach(function (a, i) {
                        if (a == null || !rows[i]) return;
                        var gap = Math.abs(a - pr.along);
                        if (gap <= 60 && (hereI < 0 || gap < Math.abs(idx.along[hereI] - pr.along))) hereI = i;
                        if (a < pr.along) afterI = i;
                    });
                    if (hereI >= 0) placeHere(hereI, plate);
                    else placeAfter(Math.min(afterI, rows.length - 2), plate);
                    return;
                }
            }

            // 2) Yedek: düz-çizgi en yakın durak
            var bi = 0, bd = Infinity;
            coords.forEach(function (c, i) {
                var d = d2(c, pos);
                if (d < bd) { bd = d; bi = i; }
            });
            if (!rows[bi]) return;
            var distM = Math.sqrt(bd) * 111320;
            if (distM <= 60) {
                placeHere(bi, plate);
            } else {
                var afterIdx = bi;
                if (bi > 0 && d2(coords[bi - 1], pos) < d2(coords[bi + 1], pos)) afterIdx = bi - 1;
                if (afterIdx >= rows.length - 1) afterIdx = rows.length - 2;
                if (afterIdx < 0) afterIdx = 0;
                placeAfter(afterIdx, plate);
            }
        });
    }

    // ----- Vehicles (polling + smooth animation)
    function vehicleLonLat(v) {
        // Yeni API: geom = GeoJSON Feature/Geometry (string veya obje)
        if (v && v.geom) {
            try {
                var g = typeof v.geom === 'string' ? JSON.parse(v.geom) : v.geom;
                var inner = (g && g.geometry) ? g.geometry : g;
                if (inner && inner.coordinates && inner.coordinates.length >= 2) {
                    var lon = Number(inner.coordinates[0]);
                    var lat = Number(inner.coordinates[1]);
                    if (isFinite(lon) && isFinite(lat)) return [lon, lat];
                }
            } catch (e) { /* fallback */ }
        }
        var lon2 = v.longitude != null ? v.longitude : v.boylam;
        var lat2 = v.latitude  != null ? v.latitude  : v.enlem;
        if (lon2 == null || lat2 == null) return null;
        lon2 = Number(lon2); lat2 = Number(lat2);
        if (!isFinite(lon2) || !isFinite(lat2)) return null;
        return [lon2, lat2];
    }

    function vehicleKey(v) {
        return String(v.vehicleId != null ? v.vehicleId
                    : (v.id != null ? v.id
                    : (v.licencePlate || v.plate || v.plaka || v.plateNumber || '')));
    }

    // Konum damgası (editDate) bu süreden eskiyse araç "canlı" sayılmaz —
    // kontağı kapatılmış / verisi kesilmiş araçlar hat ekranında gösterilmez.
    var STALE_MS = 15 * 60 * 1000;
    function vehicleStale(v) {
        var s = v && (v.editDate || v.gpsDate || v.lastUpdate);
        if (!s || typeof s !== 'string') return false;   // damga yoksa karar verme
        // Zaman dilimi belirtilmemişse UTC varsay (upstream UTC yollar). Varsayım
        // yanlışsa yaş NEGATİF çıkar ve araç GÖSTERİLİR — güvenli tarafta kalır.
        var iso = /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z';
        var tms = Date.parse(iso);
        if (!isFinite(tms)) return false;
        return (Date.now() - tms) > STALE_MS;
    }

    // 360°/0° sınırında kısa yönü seç
    function shortestAngleDelta(from, to) {
        var d = ((to - from) % 360 + 540) % 360 - 180;
        return d;
    }

    // ----- Hat çizgisine oturtma (snap) -----
    // GPS noktaları yol geometrisinden onlarca metre sapabiliyor; ikonlar hattın
    // yanında paralel bir izde "yamuk" gidiyordu. Araç, ait olduğu hat çiziminin:
    //   • SNAP_POS_M yakınındaysa KONUMU tam çizginin üzerine oturtulur ve
    //     YÖNÜ en yakın segmentin yönüne çevrilir (gpsDir hangi uca yakınsa).
    // Eşik dışındaki (hattan sapmış/garaja çekilmiş) araç hat modunda HİÇ
    // gösterilmez (bkz. updateVehicles); genel bakışta GPS verisi olduğu gibi
    // kullanılır. Genel bakışta her araç kendi routeCode'unun çizgisine, hat
    // modunda seçili varyantın çizgisine oturtulur.
    var SNAP_POS_M = 200;
    var SNAP_DIR_M = 200;
    var overviewLinesByCode = {};   // routeCode -> [ [ [lon,lat], ... ], ... ]

    function snapToLines(lines, lonLat, gpsDir) {
        if (!lines || !lines.length) return null;
        // Küçük alanlarda yeterli hassasiyette düzlem yaklaşımı (metre cinsinden)
        var mPerLat = 110540;
        var mPerLon = 111320 * Math.cos(lonLat[1] * Math.PI / 180);
        var px = lonLat[0] * mPerLon, py = lonLat[1] * mPerLat;
        var best = null;
        for (var li = 0; li < lines.length; li++) {
            var line = lines[li];
            for (var i = 0; i < line.length - 1; i++) {
                var ax = line[i][0] * mPerLon,     ay = line[i][1] * mPerLat;
                var bx = line[i + 1][0] * mPerLon, by = line[i + 1][1] * mPerLat;
                var vx = bx - ax, vy = by - ay;
                var len2 = vx * vx + vy * vy;
                if (!len2) continue;
                var t0 = ((px - ax) * vx + (py - ay) * vy) / len2;
                if (t0 < 0) t0 = 0; else if (t0 > 1) t0 = 1;
                var qx = ax + vx * t0, qy = ay + vy * t0;
                var dx = px - qx, dy = py - qy;
                var d2 = dx * dx + dy * dy;
                // Ring hatlarda gidiş/dönüş aynı caddeden geçer: yalnız mesafeye bakınca araç
                // ters bacağa oturuyordu (2026-09-22 Bursa). Aracın gpsDir'ine TERS segment
                // 150 m uzak sayılır — yakın mesafede yönü uyan bacak kazanır.
                var segAz = ((Math.atan2(vx, vy) * 180 / Math.PI) % 360 + 360) % 360;
                var score = Math.sqrt(d2) + (Math.abs(shortestAngleDelta(gpsDir, segAz)) > 90 ? 150 : 0);
                if (!best || score < best.score) best = { score: score, d2: d2, qx: qx, qy: qy, vx: vx, vy: vy };
            }
        }
        if (!best || best.d2 > SNAP_DIR_M * SNAP_DIR_M) return null;
        // Segment azimutu (0° = kuzey, saat yönü). Segment iki yönlü gezilebilir:
        // gpsDir hangi uca yakınsa otobüs o yöne çevrilir.
        var az = Math.atan2(best.vx, best.vy) * 180 / Math.PI;
        if (Math.abs(shortestAngleDelta(gpsDir, az)) > 90) az += 180;
        az = ((az % 360) + 360) % 360;
        return {
            heading: az,
            pos: best.d2 <= SNAP_POS_M * SNAP_POS_M
                ? [best.qx / mPerLon, best.qy / mPerLat]
                : null
        };
    }

    /** Aracın oturtulacağı çizgiler: genel bakışta kendi hattı, hat modunda seçili varyant. */
    function snapVehicle(lonLat, gpsDir, routeCode) {
        var lines = overviewActive
            ? (routeCode ? overviewLinesByCode[routeCode] : null)
            : routeLines;
        return snapToLines(lines, lonLat, gpsDir);
    }

    // ----- Gerçekçi takip: iki konum arası HAT ÇİZGİSİ üzerinde ilerleme -----
    // Düz çizgi yerine, eski ve yeni konum hattın aynı çizgisine oturuyorsa
    // aradaki güzergâh köşe noktalarından geçen bir yol kurulur; otobüs bu yol
    // boyunca SABİT hızla süzülür ve burnu her an gittiği segmentin yönüne bakar.
    var PATH_SNAP_M = SNAP_POS_M;  // iki uç da çizgiye bu kadar yakınsa yol kurulur
    var PATH_MAX_M  = 900;         // bundan uzun sıçramalarda yol takibi denenmez

    /** a→b arasında verilen çizgiler üzerinde yol kurar; olmuyorsa null. */
    function buildPathOnLines(lines, a, b) {
        if (!lines || !lines.length) return null;
        var mPerLat = 110540;
        var mPerLon = 111320 * Math.cos(a[1] * Math.PI / 180);

        function proj(line, p) {
            var px = p[0] * mPerLon, py = p[1] * mPerLat, best = null;
            for (var i = 0; i < line.length - 1; i++) {
                var ax = line[i][0] * mPerLon,     ay = line[i][1] * mPerLat;
                var bx = line[i + 1][0] * mPerLon, by = line[i + 1][1] * mPerLat;
                var vx = bx - ax, vy = by - ay;
                var len2 = vx * vx + vy * vy;
                if (!len2) continue;
                var t = ((px - ax) * vx + (py - ay) * vy) / len2;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                var qx = ax + vx * t, qy = ay + vy * t;
                var dx = px - qx, dy = py - qy, d2 = dx * dx + dy * dy;
                if (!best || d2 < best.d2) best = { d2: d2, seg: i, x: qx, y: qy };
            }
            return best;
        }

        // İki ucu da en iyi karşılayan çizgi (en kötü projeksiyonu en küçük olan)
        var bestLine = null;
        for (var li = 0; li < lines.length; li++) {
            var pa = proj(lines[li], a), pb = proj(lines[li], b);
            if (!pa || !pb) continue;
            var worst = Math.max(pa.d2, pb.d2);
            if (!bestLine || worst < bestLine.worst) bestLine = { line: lines[li], pa: pa, pb: pb, worst: worst };
        }
        if (!bestLine || bestLine.worst > PATH_SNAP_M * PATH_SNAP_M) return null;

        var line = bestLine.line, pa = bestLine.pa, pb = bestLine.pb;
        var pts = [[pa.x / mPerLon, pa.y / mPerLat]];
        function pushPt(p) {   // çakışık ardışık noktaları alma (sıfır segment koruması)
            var last = pts[pts.length - 1];
            if (distMeters(last, p) > 0.2) pts.push(p);
        }
        if (pa.seg < pb.seg) {
            for (var f = pa.seg + 1; f <= pb.seg; f++) pushPt(line[f]);
        } else if (pa.seg > pb.seg) {
            for (var r = pa.seg; r > pb.seg; r--) pushPt(line[r]);
        }
        pushPt([pb.x / mPerLon, pb.y / mPerLat]);
        if (pts.length < 2) return null;

        var cum = [0], total = 0;
        for (var k = 1; k < pts.length; k++) {
            total += distMeters(pts[k - 1], pts[k]);
            cum.push(total);
        }
        if (total < 1) return null;

        // Projeksiyon yanlış kola/döngüye oturduysa yol saçma uzar — düz geçişe düş.
        var straight = distMeters(a, b);
        if (total > Math.max(3 * straight, straight + 150)) return null;

        return { pts: pts, cum: cum, total: total, mPerLon: mPerLon, mPerLat: mPerLat };
    }

    /** Yol üzerinde s (metre) noktasının konumu ve segment azimutu (0°=K). */
    function pointAlongPath(p, s) {
        var pts = p.pts, cum = p.cum, n = pts.length;
        if (s <= 0) s = 0; else if (s > p.total) s = p.total;
        var i = 1;
        while (i < n - 1 && cum[i] < s) i++;
        var segLen = cum[i] - cum[i - 1];
        var f = segLen > 0 ? (s - cum[i - 1]) / segLen : 0;
        var x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f;
        var y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
        var az = Math.atan2((pts[i][0] - pts[i - 1][0]) * p.mPerLon,
                            (pts[i][1] - pts[i - 1][1]) * p.mPerLat) * 180 / Math.PI;
        return { pos: [x, y], az: ((az % 360) + 360) % 360 };
    }

    // ----- Işınlanma: konum güncellemesi çok uzağa sıçradıysa kayma animasyonu
    // yapılmaz — otobüsün haritanın bir ucundan öbürüne süzülmesi yanıltıcıydı.
    // Araç yeni konumunda yanıp sönerek belirir (CSS .is-teleported).
    var TELEPORT_M = 300;

    function distMeters(a, b) {
        var dx = (a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
        var dy = (a[1] - b[1]) * 110540;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function blinkVehicle(el) {
        el.classList.remove('is-teleported');
        void el.offsetWidth;                 // animasyonu baştan başlat
        el.classList.add('is-teleported');
        clearTimeout(el._blinkT);
        el._blinkT = setTimeout(function () { el.classList.remove('is-teleported'); }, 2000);
    }

    function loadVehicles(variantId) {
        return fetchJson(cfg.endpoints.vehicles + variantId).then(function (env) {
            var data = unwrap(env);
            var list = data.routeVehicles || data.vehicles || [];
            var shown = updateVehicles(list);
            // Sayaç filtre SONRASI sayıyı gösterir — haritada olmayan araç sayılmaz
            if ($infoVehicles) $infoVehicles.textContent = shown;
            if ($infoUpdated) {
                var now = new Date();
                $infoUpdated.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
            }
        });
    }

    // Görsel takip hızı: gerçekçi süzülme için ortalama şehir içi otobüs hızı.
    // Süre = mesafe / hız → kısa adım kısa, uzun adım uzun sürer; gerçek araç
    // markerdan hızlıysa marker bir sonraki veride kaldığı yerden yeni hedefe
    // yönelir (uçuş radarı mantığı — veri aralığı kadar geriden akıcı takip).
    var ANIM_MIN_MS = 1500, ANIM_MAX_MS = 45000;

    function moveDurationMs(distM) {
        var kmh = Number(cfg.busKmh) > 0 ? Number(cfg.busKmh) : 20;
        var mps = Math.max(3, kmh / 3.6);
        return Math.min(ANIM_MAX_MS, Math.max(ANIM_MIN_MS, Math.round(distM / mps * 1000)));
    }

    /**
     * Genel bakışta kümede ya da ekran dışında kalan araç animasyonlanmaz,
     * yeni konuma tek adımda geçer. Bursa'da ~1.200 aracın hepsini her karede
     * güncellemek (setLngLat + MapLibre'nin marker başına rAF'ı) haritayı
     * kasıyordu; görünür araçlar eskisi gibi süzülür. İzlenen araç hep görünür sayılır.
     */
    function makeHiddenTest() {
        var inView = makeViewTest(CULL_PAD);
        return function (key, entry, from, to) {
            if (key === followKey) return false;
            return entry.clustered || (!inView(from[0], from[1]) && !inView(to[0], to[1]));
        };
    }

    function updateVehicles(list, animMs, opts) {
        opts = opts || {};
        var seen = {};
        var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var isHidden = makeHiddenTest();

        list.forEach(function (v) {
            var key = vehicleKey(v);
            if (!key) return;
            var lonLat = vehicleLonLat(v);
            if (!lonLat) return;

            var plate = v.licencePlate || v.plate || v.plaka || v.plateNumber || '';
            var heading = Number(v.gpsDir != null ? v.gpsDir : (v.yon != null ? v.yon : (v.heading != null ? v.heading : v.direction))) || 0;

            // Hat çizgisine oturt: yön segment yönüne, konum çizginin üzerine
            var snap = snapVehicle(lonLat, heading, v.routeCode);

            // Hat modunda güvenilmez araçlar HİÇ gösterilmez:
            //  • konum damgası 15 dk'dan eskiyse (veri gelmeyen araç),
            //  • hat çizgisi eldeyken çizgiden SNAP_DIR_M'den (200 m) uzaksa
            //    (garaja çekilmiş / başka görevdeki araç).
            // seen'e yazılmadıkları için varsa eski marker'ları da kaldırılır.
            if (!overviewActive) {
                if (vehicleStale(v)) return;
                if (routeLines.length && !snap) return;
            }
            seen[key] = true;

            if (snap) {
                heading = snap.heading;
                if (snap.pos) lonLat = snap.pos;
            }

            var entry = vehiclesIndex[key];
            if (!entry) {
                var el = makeVehicleEl(plate, key, v.routeCode);
                // Haritaya hemen EKLENMEZ — updateVehicles sonunda culling karar verir
                // (ilk yüklemede 1.200 marker'ın bir kareliğine bile eklenmesi kasıyordu).
                var marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(lonLat);
                applyHeading(el, heading);
                vehiclesIndex[key] = {
                    marker: marker, el: el, _attached: false, clustered: false,
                    animFrom: lonLat.slice(), animTo: lonLat.slice(),
                    headFrom: heading,        headTo: heading,
                    animStart: now,           animDur: 0
                };
            } else {
                entry.el._plate.textContent = plate;
                setVehicleRoute(entry.el, v.routeCode); // araç hat değiştirmiş olabilir
                ensureVehicleKind(entry.el, v.routeCode); // tramvay ↔ otobüs değişimi
                var cur = entry.marker.getLngLat();
                var from = [cur.lng, cur.lat];
                var d = distMeters(from, lonLat);

                // Görünmeyen araç: animasyon yok, doğrudan yeni konum/yön
                if (isHidden(key, entry, from, lonLat)) {
                    entry.path = null;
                    entry.animFrom = lonLat.slice();
                    entry.animTo   = lonLat.slice();
                    entry.headFrom = entry.headTo = heading;
                    entry.animStart = now;
                    entry.animDur   = 0;
                    if (d >= 0.5) entry.marker.setLngLat(lonLat);
                    if (Math.abs(shortestAngleDelta(entry.el._heading || 0, heading)) >= 1) applyHeading(entry.el, heading);
                    return;
                }

                // Kayda değer hareket yok: konumu koru, yalnızca yönü yumuşakça çevir.
                if (d < 3) {
                    // Duruyor ve yönü de değişmemiş → animasyon başlatma (boş kare maliyeti)
                    if (entry.animDur <= 0 && Math.abs(shortestAngleDelta(entry.headTo, heading)) < 2) return;
                    entry.path = null;
                    entry.animFrom = from;
                    entry.animTo   = lonLat.slice();
                    entry.headFrom = entry.headTo;
                    entry.headTo   = entry.headTo + shortestAngleDelta(entry.headTo, heading);
                    entry.animStart = now;
                    entry.animDur   = 800;
                    return;
                }

                // Önce hat çizgisi üzerinde yol kurmayı dene — kurulabiliyorsa
                // otobüs güzergâh kıvrımlarını izleyerek sabit hızla süzülür.
                var lines = overviewActive
                    ? (v.routeCode ? overviewLinesByCode[v.routeCode] : null)
                    : routeLines;
                var path = d <= PATH_MAX_M ? buildPathOnLines(lines, from, lonLat) : null;

                if (path) {
                    entry.path = path;
                    entry.animFrom = from;
                    entry.animTo   = lonLat.slice();
                    entry.animStart = now;
                    entry.animDur   = moveDurationMs(path.total);
                    return;
                }

                // Uzun sıçrama (yol da kurulamadı): süzülme yerine yanıp sönerek belir
                if (d > TELEPORT_M) {
                    entry.path = null;
                    entry.animFrom = lonLat.slice();
                    entry.animTo   = lonLat.slice();
                    entry.headFrom = entry.headTo = heading;
                    entry.animStart = now;
                    entry.animDur   = 0;
                    entry.marker.setLngLat(lonLat);
                    applyHeading(entry.el, heading);
                    blinkVehicle(entry.el);
                    // İzlenen araç ışınlandıysa kamera da kaymadan oraya geçsin
                    if (key === followKey) {
                        map.easeTo({ center: lonLat, duration: 600 });
                        markUserCamera(700);
                    }
                    return;
                }

                // Düz geçiş (çizgi dışı araç): yine hıza dayalı sürede süzül.
                var currentHead = entry.headTo;
                entry.path = null;
                entry.animFrom = from;
                entry.animTo   = lonLat.slice();
                entry.headFrom = currentHead;
                entry.headTo   = currentHead + shortestAngleDelta(currentHead, heading);
                entry.animStart = now;
                entry.animDur   = moveDurationMs(d);
            }
        });

        // Artık listede olmayan araçları kaldır. keepMissing (gateway snapshot'ı henüz
        // dolmamış, ready=false — deploy/yeniden başlatma sonrası ilk ~1 dk): eksik araç
        // KALDIRILMAZ; kısmi listeyle haritanın boşalıp yeniden dolması engellenir.
        if (!opts.keepMissing) Object.keys(vehiclesIndex).forEach(function (key) {
            if (!seen[key]) {
                if (key === followKey) clearFollow();  // izlenen araç seferden düştü
                var e = vehiclesIndex[key];
                if (e && e.marker) e.marker.remove();
                delete vehiclesIndex[key];
            }
        });

        syncVehicleLod(true);
        syncVehicleClusters();   // kümeler + culling (senkron: yeni araçlar ilk karede doğru durumda)
        ensureAnimationLoop();
        updateBusPositionsInList();
        return Object.keys(vehiclesIndex).length;   // gösterilen (filtre sonrası) araç sayısı
    }

    function ensureAnimationLoop() {
        if (animRafHandle) return;
        var step = function () {
            var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            var active = false;
            var keys = Object.keys(vehiclesIndex);
            for (var i = 0; i < keys.length; i++) {
                var e = vehiclesIndex[keys[i]];
                if (!e || e.animDur <= 0) continue;
                if (!e._attached) {
                    // Haritada değil: kare kare süzmeye gerek yok, hedefe atla
                    e.path = null;
                    e.animDur = 0;
                    e.headFrom = e.headTo;
                    e.marker.setLngLat(e.animTo);
                    if (e.el) e.el._heading = ((e.headTo % 360) + 360) % 360;
                    continue;
                }
                var t = (now - e.animStart) / e.animDur;
                if (t >= 1) { t = 1; }

                var x, y, h;
                if (e.path) {
                    // Hat üzerinde ilerleme: SABİT hız (lineer) — gerçek sürüş hissi;
                    // burun her an bulunduğu segmentin gidiş yönüne bakar.
                    var q = pointAlongPath(e.path, t * e.path.total);
                    x = q.pos[0]; y = q.pos[1];
                    // Yumuşak dönüş: ani segment kırılımlarında burnu kısa adımlarla çevir.
                    h = e.headTo + shortestAngleDelta(e.headTo, q.az) * 0.35;
                    e.headFrom = e.headTo = h;
                    if (t >= 1) e.path = null;   // yol bitti → sonraki güncelleme buradan devam eder
                } else {
                    // easeInOutQuad
                    var eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                    x = e.animFrom[0] + (e.animTo[0] - e.animFrom[0]) * eased;
                    y = e.animFrom[1] + (e.animTo[1] - e.animFrom[1]) * eased;
                    h = e.headFrom + (e.headTo - e.headFrom) * eased;
                }
                e.marker.setLngLat([x, y]);
                applyHeading(e.el, h);
                // Takip modu: kamera izlenen otobüse kilitlenir ve her karede
                // onunla birlikte kayar (hareket yönünde hafif önde). Kullanıcı
                // zoom/döndürme yaparken followCamera kendini devre dışı bırakır.
                if (followKey === keys[i]) followCamera(x, y, h);
                if (t < 1) active = true;
                else e.animDur = 0;
            }
            if (active) {
                animRafHandle = requestAnimationFrame(step);
            } else {
                animRafHandle = null;
            }
        };
        animRafHandle = requestAnimationFrame(step);
    }

    function resetVehicles() {
        clearFollow();
        Object.keys(vehiclesIndex).forEach(function (k) {
            var e = vehiclesIndex[k]; if (e && e.marker) e.marker.remove();
        });
        vehiclesIndex = {};
        clearClusterMarkers();
        updateBusPositionsInList();   // listedeki plaka çiplerini temizle
        if (animRafHandle) { cancelAnimationFrame(animRafHandle); animRafHandle = null; }
    }

    function startPolling() {
        if (!cfg.vehiclePollMs || cfg.vehiclePollMs <= 0) return;
        stopPolling();
        pollHandle = setInterval(function () {
            if (!selectedVariant) return;
            loadVehicles(selectedVariant.id).catch(function (err) { console.warn('[WMB] vehicle poll', err); });
        }, cfg.vehiclePollMs);
    }
    function stopPolling() { if (pollHandle) { clearInterval(pollHandle); pollHandle = null; } }

    // ----- Genel bakış modu: TÜM hat çizimleri + TÜM canlı otobüsler
    // Veri sunucuda uygulama-içi cache'ten gelir (tüm kullanıcılar aynı snapshot'ı
    // okur), bu yüzden istemci polling'i upstream API'ye yük bindirmez.
    // Bu modda durak işaretleri/adları bilerek ÇİZİLMEZ.
    var overviewActive = false;
    var overviewPollHandle = null;
    var overviewGeoLoaded = false;
    var overviewRetryHandle = null;

    function setAllRoutesVisible(on) {
        whenReady(function () {
            if (map.getLayer('allroutes-line'))
                map.setLayoutProperty('allroutes-line', 'visibility', on ? 'visible' : 'none');
        });
    }

    // Kalabalık görünmesin + DOM maliyeti düşsün diye uzak zoom'da plakaları gizle
    var lastPlateHidden = null;
    function syncPlateVisibility(force) {
        var hide = overviewActive && map.getZoom() < 13;
        if (force !== true && hide === lastPlateHidden) return;
        lastPlateHidden = hide;
        Object.keys(vehiclesIndex).forEach(function (k) {
            var e = vehiclesIndex[k];
            if (e && e.el) e.el.classList.toggle('is-plate-hidden', hide);
        });
    }
    map.on('zoom', syncPlateVisibility);

    function loadOverviewGeometry() {
        if (overviewGeoLoaded) return Promise.resolve();
        return fetchJson(cfg.endpoints.overview).then(function (data) {
            var features = [];
            overviewLinesByCode = {};   // snap dizini — araçlar kendi hattının çizgisine oturtulur
            (data.routes || []).forEach(function (r) {
                var code = r.routeCode || '';
                var color = routeColor(code || r.id);
                (r.lines || []).forEach(function (line) {
                    if (line && line.length > 1) {
                        features.push({ type: 'Feature', properties: { code: code, color: color },
                                        geometry: { type: 'LineString', coordinates: line } });
                        if (code) (overviewLinesByCode[code] || (overviewLinesByCode[code] = [])).push(line);
                    }
                });
            });
            whenReady(function () {
                var src = map.getSource('allroutes');
                if (src) src.setData({ type: 'FeatureCollection', features: features });
            });
            // Upstream bozukken 200 + boş liste dönebiliyor; bunu "yüklendi"
            // saymak çizgileri (ve snap'i) kalıcı olarak boş bırakırdı —
            // boşsa poll döngüsü yeniden dener.
            overviewGeoLoaded = features.length > 0;
        });
    }

    var overviewLastGen = null;    // sunucu snapshot damgası — değişmediyse animasyona dokunma
    var overviewLastGenAt = 0;

    // Yoklama başına en çok BİR istek uçuşta olur: 2000 araçlık gövde (~200 KB) yavaş ağda
    // aralıktan uzun sürebilir; üst üste binen istekler hem bant genişliğini katlar hem de
    // geç gelen ESKİ yanıtın yeni snapshot'ın üzerine yazılmasına yol açar.
    var overviewFetching = false;

    function loadOverviewVehicles() {
        if (overviewFetching) return Promise.resolve();
        overviewFetching = true;
        return fetchJson(cfg.endpoints.overviewVehicles).then(function (data) {
            overviewFetching = false;
            if (!overviewActive) return;
            // Sunucu cache'i henüz yenilenmediyse aynı snapshot gelir; süren
            // animasyonu yeniden başlatıp yavaşlatmamak için hiç dokunma.
            if (data.generatedUtc && data.generatedUtc === overviewLastGen) return;
            // Sıra dışı (daha eski damgalı) yanıt yok sayılır. Metin karşılaştırması YANLIŞ olur:
            // sunucu kesri değişken uzunlukta basar ("…26.85Z" > "…26.851531Z" sözlük sırasında).
            if (data.generatedUtc && overviewLastGen) {
                var genMs = Date.parse(data.generatedUtc), lastMs = Date.parse(overviewLastGen);
                if (isFinite(genMs) && isFinite(lastMs) && genMs < lastMs) return;
            }

            // Animasyon süresi = iki VERİ değişimi arasında ölçülen gerçek süre
            // → sunucu yenilemesi (rate limit vs.) yavaşlasa bile otobüsler
            // bir sonraki güncellemeye kadar kesintisiz süzülür.
            var nowMs = Date.now();
            var animMs = overviewLastGenAt
                ? Math.min(Math.max(nowMs - overviewLastGenAt, 1500), 15000)
                : (cfg.overviewPollMs || 3000);
            overviewLastGen = data.generatedUtc || null;
            overviewLastGenAt = nowMs;

            var list = (data.vehicles || []).map(function (v) {
                return { vehicleId: v.key, licencePlate: v.plate, longitude: v.lon, latitude: v.lat, gpsDir: v.dir, routeCode: v.routeCode };
            });
            // Hat türü filtresi: kapatılan türlerin araçları genel bakışta gösterilmez
            if (kindFilterActive()) list = list.filter(function (v) { return kindAllowed(routeKind(v.routeCode)); });
            // ready=false: gateway snapshot'ı henüz tüm hatları taramadı (soğuk başlangıç) —
            // listede olmayan araçlar korunur, yalnız gelenler eklenir/güncellenir.
            updateVehicles(list, animMs, { keepMissing: data.ready === false && Object.keys(vehiclesIndex).length > list.length });
            syncPlateVisibility(true);
        }, function (err) {
            overviewFetching = false;
            throw err;
        });
    }

    function startOverview() {
        if (overviewActive) return;
        overviewActive = true;
        setAllRoutesVisible(true);

        loadOverviewGeometry()
            .then(function () { return loadOverviewVehicles(); })
            .catch(function (err) {
                console.warn('[WMB] overview', err);
                // Upstream geçici düşmüş olabilir — mod hâlâ aktifse biraz sonra yeniden dene
                overviewRetryHandle = setTimeout(function () {
                    overviewRetryHandle = null;
                    if (overviewActive) { overviewActive = false; startOverview(); }
                }, 15000);
            });

        var pollMs = cfg.overviewPollMs || 20000;
        // İlk yükleme hatasındaki yeniden deneme startOverview'ı tekrar çağırır: eski zamanlayıcı
        // temizlenmezse her denemede bir yoklama döngüsü daha SIZAR (upstream düşükken yük katlanır,
        // sızan döngü hat modunda da çalışmaya devam eder).
        if (overviewPollHandle) { clearInterval(overviewPollHandle); overviewPollHandle = null; }
        overviewPollHandle = setInterval(function () {
            // Gizli sekme yoklamaz: sunucudaki canlı yenileyiciyi (ve gateway taramasını) boşuna
            // ayakta tutmasın. Sekme görünür olunca visibilitychange hemen tazeler.
            if (document.hidden) return;
            if (!overviewGeoLoaded) {
                // Geometri hâlâ yok (upstream boş dönmüş olabilir) — araç sorgusundan
                // önce çizgileri yeniden dene; gelmeden araç sorgusu kurulumuna takılır.
                loadOverviewGeometry()
                    .then(function () { return loadOverviewVehicles(); })
                    .catch(function (err) { console.warn('[WMB] overview geo retry', err); });
                return;
            }
            loadOverviewVehicles().catch(function (err) { console.warn('[WMB] overview poll', err); });
        }, pollMs);
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden || !overviewActive || !overviewGeoLoaded) return;
        loadOverviewVehicles().catch(function (err) { console.warn('[WMB] overview resume', err); });
    });

    function stopOverview() {
        if (overviewRetryHandle) { clearTimeout(overviewRetryHandle); overviewRetryHandle = null; }
        if (!overviewActive) return;
        overviewActive = false;
        if (overviewPollHandle) { clearInterval(overviewPollHandle); overviewPollHandle = null; }
        setAllRoutesVisible(false);
        resetVehicles();
    }

    // ----- Tabs
    function activateTab(name) {
        Array.prototype.forEach.call($busDetail.querySelectorAll('[data-wmb-tab]'), function (t) {
            t.classList.toggle('active', t.getAttribute('data-wmb-tab') === name);
        });
        Array.prototype.forEach.call($busDetail.querySelectorAll('[data-wmb-pane]'), function (p) {
            p.classList.toggle('active', p.getAttribute('data-wmb-pane') === name);
        });
    }

    // ----- Schedule (Hat saatleri)
    function renderWeekDays() {
        weekDays = buildNextSevenDays();
        var html = '<li class="custom-select__option custom-select__option--disabled" data-day="0">' + t('wmb.daySelect', 'Gün Seçiniz') + '</li>';
        html += weekDays.map(function (d) {
            return '<li class="custom-select__option" data-day="' + d.value + '">'
                 +   escapeHtml(d.title) + ' <span class="day-date">' + fmtDate(d.date) + '</span>'
                 + '</li>';
        }).join('');
        $dayPanel.innerHTML = html;
    }
    function buildNextSevenDays() {
        // value: 1=Pzt .. 7=Paz (backend beklentisi)
        var today = new Date();
        var jsDow = today.getDay(); // 0=Paz..6=Cmt
        var backendToday = jsDow === 0 ? 7 : jsDow;
        var days = [];
        for (var i = 0; i < 7; i++) {
            var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
            var jd = d.getDay();
            var backend = jd === 0 ? 7 : jd;
            days.push({ value: backend, title: DAY_NAMES[jd], date: d });
        }
        return days;
    }
    function loadScheduleForToday() {
        var j = new Date().getDay();
        var wd = j === 0 ? 7 : j;
        pickDay(wd);
    }
    function pickDay(wd) {
        selectedDay = wd;
        var match = weekDays.find(function (d) { return d.value === wd; });
        $dayValue.textContent = match ? (match.title + ' ' + fmtDate(match.date)) : t('wmb.daySelect', 'Gün Seçiniz');
        $dayPanel.classList.add('d-none');

        if (!selectedVariant) return;
        if (scheduleCache[wd]) { renderSchedule(scheduleCache[wd]); return; }

        $hoursList.innerHTML = '<li class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm"></div></li>';
        fetchJson(cfg.endpoints.schedule + selectedVariant.id + '/' + wd + scheduleQuery())
            .then(function (env) {
                var data = unwrap(env);
                scheduleCache[wd] = data;
                renderSchedule(data);
            })
            .catch(function (err) {
                console.error('[WMB] schedule', err);
                $hoursList.innerHTML = '<li class="text-center text-danger small py-3">' + t('js.error.schedule', 'Hat saatleri alınamadı.') + '</li>';
            });
    }
    // Dış kaynak (belediye sitesi) açıkken çizelge isteğine hattın kimliği ve
    // varyantın yönü eklenir; sunucu siteyi eşleyemezse gateway'e düşer.
    function scheduleQuery() {
        if (!cfg.lineHoursExternal || !selectedRoute) return '';
        var q = {
            routeCode: selectedRoute.routeCode, title: selectedRoute.title, shortTitle: selectedRoute.shortTitle,
            variantTitle: selectedVariant && selectedVariant.title,
            direction: selectedVariant && selectedVariant.directionTypeTitle
        };
        return '?' + Object.keys(q).filter(function (k) { return q[k]; })
            .map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
    }
    function renderSchedule(data) {
        var desc = data && data.scheduleDescription;
        if (desc) { $scheduleDesc.textContent = desc; $scheduleDesc.classList.remove('d-none'); }
        else      { $scheduleDesc.textContent = ''; $scheduleDesc.classList.add('d-none'); }

        // Dış kaynak: gruplar (kalkış noktası / gün başlığı) ayrı ayrı basılır.
        if (data && data.groups) {
            var html = '';
            if (!data.groups.length) {
                html = '<li class="text-center text-muted small py-3">' + t('js.empty.schedule', 'Bu güne ait sefer bulunamadı.') + '</li>';
            } else {
                data.groups.forEach(function (g) {
                    html += '<li class="hoursGroup"><span class="hoursGroup__title">' + escapeHtml(g.title || t('wmb.tab.hours', 'Hat Saatleri')) + '</span>'
                          + (g.note ? '<span class="hoursGroup__note">' + escapeHtml(g.note) + '</span>' : '')
                          + '</li>';
                    html += g.schedule && g.schedule.length
                        ? renderHourLines(g.schedule)
                        : '<li class="text-center text-muted small py-2">' + t('js.empty.schedule', 'Bu güne ait sefer bulunamadı.') + '</li>';
                });
            }
            if (data.source && data.source.host) {
                html += '<li class="hoursSource"><i class="bi bi-info-circle" aria-hidden="true"></i> '
                      + escapeHtml(t('js.schedule.source', 'Kaynak: {host}').replace('{host}', data.source.host)) + '</li>';
            }
            $hoursList.innerHTML = html;
            return;
        }

        var items = (data && data.schedule) || [];
        if (!items.length) {
            $hoursList.innerHTML = '<li class="text-center text-muted small py-3">' + t('js.empty.schedule', 'Bu güne ait sefer bulunamadı.') + '</li>';
            return;
        }
        $hoursList.innerHTML = renderHourLines(items);
    }
    // Saat satırları (saat başına bir satır, dakikalar rozet) — iki kaynak için ortak.
    function renderHourLines(items) {
        var byHour = {};
        items.forEach(function (it) {
            var h = (it.hour != null) ? Number(it.hour) : 0;
            (byHour[h] = byHour[h] || []).push(it);
        });
        var hours = Object.keys(byHour).map(Number).sort(function (a, b) { return a - b; });

        // Sistem saatine göre vurgular — YALNIZCA bugünün çizelgesinde:
        //  • kalkış saati geçmiş seferler soluklaştırılır (--past),
        //  • sıradaki (bir sonraki kalkacak) sefere yanıp sönen sarı nokta
        //    konur (--next). İptal seferler her iki vurgunun da dışındadır.
        // Saatler kronolojik gezildiği için ilk "geçmemiş" sefer sıradakidir.
        var now = new Date();
        var todayWd = now.getDay() === 0 ? 7 : now.getDay();
        var isToday = selectedDay === todayWd;
        var nowMin = now.getHours() * 60 + now.getMinutes();
        var nextMarked = false;

        return hours.map(function (h) {
            var rows = byHour[h]
                .slice()
                .sort(function (a, b) { return (a.minute || 0) - (b.minute || 0); })
                .map(function (it) {
                    var mm = pad2(it.minute || 0);
                    var cancelled = it.isCancelled === true;
                    // İptal edilen seferde açıklama önceliği: cancelDescription → timeDescription → genel metin
                    var note = cancelled
                        ? (it.cancelDescription || it.timeDescription || t('js.cancel.note', 'Bu sefer iptal edilmiştir.'))
                        : (it.timeDescription || it.description || '');
                    var extraCls = (note ? ' lineHoursData--hasNote' : '')
                                 + (cancelled ? ' lineHoursData--cancelled' : '');
                    var isNext = false;
                    if (isToday && !cancelled) {
                        var tMin = h * 60 + (Number(it.minute) || 0);
                        if (tMin < nowMin) {
                            extraCls += ' lineHoursData--past';
                        } else if (!nextMarked) {
                            extraCls += ' lineHoursData--next';
                            nextMarked = true;
                            isNext = true;
                        }
                    }
                    var badge = note
                        ? '<i class="bi bi-megaphone-fill lineHoursData__mark" aria-hidden="true"></i>'
                        : '';
                    var dataAttr = note ? ' data-note="' + escapeHtml(note) + '"' : '';
                    if (cancelled) dataAttr += ' data-note-title="' + escapeHtml(t('js.cancel.title', 'Sefer İptal Edildi')) + '"';
                    var titleAttr = note ? ' title="' + escapeHtml(note) + '"'
                                  : (isNext ? ' title="' + escapeHtml(t('js.next.trip', 'Sıradaki sefer')) + '"' : '');
                    return '<span class="lineHoursData' + extraCls + '"'
                         + dataAttr + titleAttr
                         + '><span class="lineHoursData__t">' + pad2(h) + ':' + mm + '</span>' + badge + '</span>';
                }).join('');
            return '<li class="hoursLine">'
                 +   '<span class="lineNumber">' + pad2(h) + '</span>'
                 +   rows
                 + '</li>';
        }).join('');
    }

    // Geçmiş/sıradaki sefer vurgusu saate bağlı — çizelge açıkken kendi kendine
    // eskimesin diye yarım dakikada bir cache'ten yeniden çizilir (ağ isteği yok).
    setInterval(function () {
        if (selectedVariant && scheduleCache[selectedDay]) renderSchedule(scheduleCache[selectedDay]);
    }, 30000);

    // ----- Price
    function loadPrice(attempt) {
        var code = selectedRoute && (selectedRoute.routeCode || selectedRoute.shortTitle);
        if (!code) { $priceList.innerHTML = '<div class="text-center text-muted small py-3">' + t('js.empty.routeCode', 'Hat kodu yok.') + '</div>'; return; }
        if (!attempt) $priceList.innerHTML = '<div class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm"></div></div>';
        fetchJson(cfg.endpoints.price + encodeURIComponent(code))
            .then(function (env) {
                var items = (env && env.result) || [];
                if (!items.length) {
                    // Upstream aralıklı boş dönebiliyor — bir kez kısa gecikmeyle yeniden dene
                    if (!attempt) { setTimeout(function () { loadPrice(1); }, 900); return; }
                    $priceList.innerHTML = '<div class="text-center text-muted small py-3">' + t('js.empty.price', 'Ücret tarifesi bulunamadı.') + '</div>';
                    return;
                }
                $priceList.innerHTML = items.map(function (p) {
                    var price = (p.price != null) ? Number(p.price).toFixed(2).replace('.', ',') + ' ₺' : '-';
                    var label = p.cardType || p.description || '-';
                    return '<div class="line flex">'
                         +   '<div class="tag">' + escapeHtml(label) + '</div>'
                         +   '<div class="price">' + escapeHtml(price) + '</div>'
                         + '</div>';
                }).join('');
            })
            .catch(function (err) {
                console.error('[WMB] price', err);
                $priceList.innerHTML = '<div class="text-center text-danger small py-3">' + t('js.error.price', 'Ücret tarifesi alınamadı.') + '</div>';
            });
    }

    // ----- Events
    $search.addEventListener('input', function () {
        var q = $search.value.trim();
        $searchClear.classList.toggle('d-none', !q);
        renderBusList(filterRoutes(q));
        setListVisible(true); // yazmaya başlayınca liste (yeniden) görünür
    });
    document.addEventListener('click', function (e) {
        if (!e.target.closest('#wmb-variant-select')) $variantPanel.classList.add('d-none');
        if (!e.target.closest('#wmb-day-select')) $dayPanel.classList.add('d-none');
    });
    $busList.addEventListener('click', function (e) {
        var star = e.target.closest('.wmb-fav');
        if (star && favRoutes) {
            // Yıldız: hattı seçme, yalnız favori durumunu değiştirip listeyi yeniden kur
            e.preventDefault(); e.stopPropagation();
            favRoutes.toggle(star.getAttribute('data-fav-id'));
            renderBusList(filterRoutes($search.value.trim()));
            return;
        }
        var opt = e.target.closest('.mat-option'); if (!opt) return;
        var id = opt.getAttribute('data-route-id');
        var route = allRoutes.find(function (r) { return String(r.id) === String(id); });
        if (route) selectRoute(route);
    });
    $searchClear.addEventListener('click', function () {
        $search.value = '';
        $searchClear.classList.add('d-none');
        $variantWrap.classList.add('d-none');
        $busDetail.classList.add('d-none');
        if ($routeInfo) $routeInfo.classList.add('d-none');
        stopPolling();
        clearStations(); clearRoute(); resetVehicles();
        selectedRoute = null; selectedVariant = null; variants = [];
        renderBusList(filterRoutes(''));
        setListVisible(true);    // temizlendi → tüm hat listesi geri gelir
        boardingReset();         // binme önerisini kapat + FAB'ı gizle + yürüyüş çizgisini sil
        startOverview();         // ve genel bakışa dön
    });
    if ($refresh) {
        $refresh.addEventListener('click', function () {
            if (overviewActive) {
                $refresh.classList.add('is-loading');
                // Hiçbir hat seçili değilken yenile aynı zamanda "başa dön"dür:
                // şehir merkezine odaklan. Diğer üç harita ekranındaki yenile
                // FAB'ı da böyle davranıyor.
                //
                // Bir araç izleniyorsa kamera ona kilitli (keepFollowedInView);
                // merkeze almak takibi bozar, o yüzden yalnızca veri tazelenir.
                // Eğim/yön korunur — 2B/3B tercihi kullanıcınındır.
                if (!followKey) {
                    map.easeTo({
                        center: cfg.center || [32.85, 39.93],
                        zoom: cfg.zoom || 13,
                        duration: 500
                    });
                }
                loadOverviewVehicles().catch(function () {}).then(function () {
                    setTimeout(function () { $refresh.classList.remove('is-loading'); }, 400);
                });
                return;
            }
            if (!selectedVariant) return;
            $refresh.classList.add('is-loading');
            Promise.all([
                loadStations(selectedVariant.id).catch(function () {}),
                loadVehicles(selectedVariant.id).catch(function () {})
            ]).then(function () {
                setTimeout(function () { $refresh.classList.remove('is-loading'); }, 400);
            });
        });
    }
    $variantTrig.addEventListener('click', function () { $variantPanel.classList.toggle('d-none'); });
    $variantPanel.addEventListener('click', function (e) {
        var li = e.target.closest('.custom-select__option'); if (!li) return;
        var id = li.getAttribute('data-variant-id');
        var v = variants.find(function (x) { return String(x.id) === String(id); });
        if (v) {
            pickVariant(v);
            // Kullanıcının seçtiği varyantın AVL duyuruları varsa popup göster.
            // (Hat seçiminde otomatik atanan ana varyant için hat duyurusu yeterli —
            // bu çağrı yalnız kullanıcı listeden varyant değiştirdiğinde yapılır.)
            if (window.WmbAvlAnn) WmbAvlAnn.showFor('variant', v.id, { title: variantLabel(v) });
        }
    });
    $dayTrig.addEventListener('click', function () { $dayPanel.classList.toggle('d-none'); });
    $dayPanel.addEventListener('click', function (e) {
        var li = e.target.closest('.custom-select__option'); if (!li) return;
        if (li.classList.contains('custom-select__option--disabled')) { $dayPanel.classList.add('d-none'); return; }
        var wd = Number(li.getAttribute('data-day') || 0);
        if (wd >= 1 && wd <= 7) pickDay(wd);
    });
    $busDetail.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-wmb-tab]');
        if (tab) { activateTab(tab.getAttribute('data-wmb-tab')); return; }
        if (e.target.closest('.wmb-stopdetail')) { onStopDetailClick(e); return; }
        var stop = e.target.closest('.list-item');
        if (stop) {
            var lon = parseFloat(stop.getAttribute('data-stop-lon'));
            var lat = parseFloat(stop.getAttribute('data-stop-lat'));
            if (isFinite(lon) && isFinite(lat)) {
                map.flyTo({ center: [lon, lat], zoom: 17, pitch: map.getPitch(), bearing: map.getBearing(), duration: 450 });
            }
            openStopDetail(stop, { toggle: true });
        }
    });

    // ----- Hour note tooltip (timeDescription)
    var $noteTip = document.createElement('div');
    $noteTip.className = 'wmb-hourtip';
    $noteTip.setAttribute('role', 'tooltip');
    $noteTip.innerHTML =
        '<span class="wmb-hourtip__arrow"></span>' +
        '<span class="wmb-hourtip__ico"><i class="bi bi-megaphone-fill"></i></span>' +
        '<span class="wmb-hourtip__body">' +
            '<span class="wmb-hourtip__title"></span>' +
            '<span class="wmb-hourtip__text"></span>' +
        '</span>';
    document.body.appendChild($noteTip);
    var $noteTipTitle = $noteTip.querySelector('.wmb-hourtip__title');
    var $noteTipText  = $noteTip.querySelector('.wmb-hourtip__text');
    var noteTimer = null;

    function showNoteTip(el) {
        var note = el.getAttribute('data-note');
        if (!note) return;
        // Native title baloncuğu ile çakışmasın
        if (el.getAttribute('title')) {
            el.setAttribute('data-title', el.getAttribute('title'));
            el.removeAttribute('title');
        }
        // İptal balonunda başlık "Sefer İptal Edildi", normalde saatin kendisi
        var customTitle = el.getAttribute('data-note-title');
        $noteTipTitle.textContent = customTitle
            || (el.textContent || '').trim().replace(/\s+/g, ' ').split(' ')[0];
        $noteTipText.textContent  = note;
        $noteTip.classList.toggle('wmb-hourtip--cancelled', el.classList.contains('lineHoursData--cancelled'));
        positionNoteTip(el);
        $noteTip.classList.add('is-visible');
    }
    function hideNoteTip() {
        $noteTip.classList.remove('is-visible');
    }
    function positionNoteTip(el) {
        var r = el.getBoundingClientRect();
        // önce görünür konuma getir ki genişliği ölçebilelim
        $noteTip.style.visibility = 'hidden';
        $noteTip.style.display = 'inline-flex';
        var tr = $noteTip.getBoundingClientRect();
        var margin = 10;
        var vw = window.innerWidth, vh = window.innerHeight;
        var left = r.left + r.width / 2 - tr.width / 2;
        left = Math.max(8, Math.min(vw - tr.width - 8, left));
        var top = r.top - tr.height - margin;
        var placement = 'top';
        if (top < 8) { top = r.bottom + margin; placement = 'bottom'; }
        // üstün de altında yoksa sağa koy
        if (top + tr.height > vh - 8 && placement === 'bottom') {
            top = Math.max(8, r.top + r.height / 2 - tr.height / 2);
            left = r.right + margin;
            placement = 'right';
            if (left + tr.width > vw - 8) {
                left = Math.max(8, r.left - tr.width - margin);
                placement = 'left';
            }
        }
        $noteTip.setAttribute('data-placement', placement);
        $noteTip.style.left = (left + window.scrollX) + 'px';
        $noteTip.style.top  = (top  + window.scrollY) + 'px';
        $noteTip.style.visibility = '';
    }

    $hoursList.addEventListener('mouseover', function (e) {
        var el = e.target.closest('.lineHoursData--hasNote'); if (!el) return;
        clearTimeout(noteTimer);
        noteTimer = setTimeout(function () { showNoteTip(el); }, 120);
    });
    $hoursList.addEventListener('mouseout', function (e) {
        var el = e.target.closest('.lineHoursData--hasNote'); if (!el) return;
        clearTimeout(noteTimer);
        noteTimer = setTimeout(hideNoteTip, 80);
    });
    // Mobil için: dokunma ile aç/kapat
    $hoursList.addEventListener('click', function (e) {
        var el = e.target.closest('.lineHoursData--hasNote'); if (!el) return;
        e.preventDefault();
        if ($noteTip.classList.contains('is-visible') && $noteTip.dataset.targetId === el.dataset.uid) {
            hideNoteTip();
        } else {
            el.dataset.uid = el.dataset.uid || ('h' + Math.random().toString(36).slice(2));
            $noteTip.dataset.targetId = el.dataset.uid;
            showNoteTip(el);
            setTimeout(hideNoteTip, 4000);
        }
    });
    window.addEventListener('scroll', hideNoteTip, { passive: true });
    window.addEventListener('resize', hideNoteTip);

    // Durak hover popup'ı harita 'load' içinde kurulu; araç plakası marker üzerinde gösterilir.

    window.addEventListener('beforeunload', function () {
        stopPolling();
        stopOverview();
        if (animRafHandle) { cancelAnimationFrame(animRafHandle); animRafHandle = null; }
    });

    // ----- Konumumu Bul — kullanıcı konumuna odaklan + mavi nokta
    var $locate = document.getElementById('wmb-locate');
    var userMarker = null;
    if ($locate) {
        $locate.addEventListener('click', function () {
            if (!navigator.geolocation) {
                showStatus(t('ss.geo.unsupported', 'Konum desteklenmiyor.'), 3000);
                return;
            }
            navigator.geolocation.getCurrentPosition(function (pos) {
                // Şehir hizmet alanı dışındaki konuma odaklanılmaz.
                if (window.WmbMapCore && !WmbMapCore.inCityBounds(pos.coords.latitude, pos.coords.longitude)) {
                    showStatus(t('bounds.geoOutside', 'Konumunuz {city} hizmet alanı dışında görünüyor.')
                        .replace('{city}', (window.WMB && window.WMB.city && window.WMB.city.name) || ''), 4000);
                    return;
                }
                var c = [pos.coords.longitude, pos.coords.latitude];
                if (!userMarker) {
                    var el = document.createElement('div');
                    el.className = 'wmb-userdot';
                    userMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(c).addTo(map);
                } else {
                    userMarker.setLngLat(c);
                }
                map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 15), duration: 600 });
            }, function () {
                showStatus(t('ss.geo.denied', 'Konum erişimi reddedildi.'), 3000);
            });
        });
    }

    // ===== Binme durağı önerisi ("En yakın binebileceğin durak") =====
    // Kullanıcı bir hat seçtiğinde konum izni ister; otobüsün ROTA ÜZERİNDEKİ
    // yönünü hesaba katarak yürüyerek yetişebileceği EN İYİ durağı önerir.
    //
    // Mantık: En yakın durak, otobüsün ARDINDA kalmış olabilir (otobüs oradan
    // çoktan geçti) — o durakta otobüse binemezsin. Bu yüzden yalnızca otobüsün
    // ÖNÜNDEKİ durakları değerlendirir; her biri için "yürüme süresi ≤ otobüs
    // varış süresi" ise oraya yetişebilirsin. Yetişebildiklerin arasından otobüsün
    // EN ERKEN ulaştığı durağı seçer (en hızlı biniş). Hiçbirine rahat yetişemiyorsan
    // en az açık veren durağı "acele et" uyarısıyla gösterir.
    var WALK_KMH = Number(cfg.walkKmh) > 0 ? Number(cfg.walkKmh) : 5;    // normal yürüyüş
    var BUS_KMH  = Number(cfg.busKmh)  > 0 ? Number(cfg.busKmh)  : 20;   // şehir içi otobüs ortalaması (duraklar dahil)
    var WALK_MPS = WALK_KMH * 1000 / 3600;
    var BUS_MPS  = BUS_KMH  * 1000 / 3600;

    function haversineM(a, b) {
        var R = 6371000;
        var dLat = (b[1] - a[1]) * Math.PI / 180;
        var dLon = (b[0] - a[0]) * Math.PI / 180;
        var la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180;
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
              + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * R * Math.asin(Math.sqrt(h));
    }
    // p'nin a-b segmenti üzerindeki en yakın noktaya olan uzaklığı + segment içi oranı (t)
    function projectOnSegment(p, a, b) {
        var mPerLat = 110540;
        var mPerLon = 111320 * Math.cos(a[1] * Math.PI / 180);
        function xy(ll) { return [(ll[0] - a[0]) * mPerLon, (ll[1] - a[1]) * mPerLat]; }
        var P = xy(p), B = xy(b);
        var len2 = B[0] * B[0] + B[1] * B[1];
        var tt = len2 > 0 ? (P[0] * B[0] + P[1] * B[1]) / len2 : 0;
        tt = Math.max(0, Math.min(1, tt));
        var dx = P[0] - B[0] * tt, dy = P[1] - B[1] * tt;
        return { t: tt, dist: Math.sqrt(dx * dx + dy * dy) };
    }
    // Otobüsün rota başlangıcından itibaren kat ettiği kümülatif mesafe (m)
    function busCumDistance(busLL, pts, cum) {
        var best = { d: Infinity, cum: 0 };
        for (var i = 0; i < pts.length - 1; i++) {
            var pr = projectOnSegment(busLL, pts[i].ll, pts[i + 1].ll);
            if (pr.dist < best.d) { best.d = pr.dist; best.cum = cum[i] + pr.t * (cum[i + 1] - cum[i]); }
        }
        return best.cum;
    }

    function fmtDist(m) {
        if (m == null) return '–';
        return m < 950 ? Math.round(m / 10) * 10 + ' m'
                       : (m / 1000).toFixed(1).replace('.', ',') + ' km';
    }
    function fmtMin(sec) {
        if (sec == null) return '–';
        var m = Math.round(sec / 60);
        if (m <= 0) return t('js.board.now', 'şimdi');
        return m + ' ' + t('js.board.minShort', 'dk');
    }

    // Önerilecek durağı hesapla. Dönüş: {name, ll, walkDist, walkTime, busTime, mode, plate}
    function computeBestBoardingStop(user) {
        var pts = [];
        currentStops.forEach(function (s) {
            var ll = lonLatOf(s);
            if (ll) pts.push({ ll: ll, name: stopDisplayName(s) });
        });
        if (pts.length < 2) return null;

        var cum = [0];
        for (var i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + haversineM(pts[i - 1].ll, pts[i].ll);

        // Bu varyanttaki canlı otobüsler
        var buses = [];
        Object.keys(vehiclesIndex).forEach(function (k) {
            var e = vehiclesIndex[k];
            if (!e || !e.marker) return;
            var p = e.marker.getLngLat();
            buses.push({ ll: [p.lng, p.lat], plate: (e.el && e.el._plate) ? e.el._plate.textContent : '' });
        });

        var candidates = [];
        buses.forEach(function (bus) {
            var bc = busCumDistance(bus.ll, pts, cum);
            for (var i = 0; i < pts.length; i++) {
                var busDist = cum[i] - bc;
                if (busDist <= 0) continue;                 // otobüs bu durağı geçmiş → burada binemezsin
                var busTime = busDist / BUS_MPS;
                var walkDist = haversineM(user, pts[i].ll);
                var walkTime = walkDist / WALK_MPS;
                candidates.push({
                    name: pts[i].name, ll: pts[i].ll, plate: bus.plate,
                    walkDist: walkDist, walkTime: walkTime, busTime: busTime,
                    feasible: walkTime <= busTime          // otobüs sen vardıktan sonra geliyorsa yetişirsin
                });
            }
        });

        var pick = null;
        if (candidates.length) {
            var feasible = candidates.filter(function (c) { return c.feasible; });
            if (feasible.length) {
                feasible.sort(function (a, b) { return a.busTime - b.busTime; });   // en erken biniş
                pick = feasible[0]; pick.mode = 'catch';
            } else {
                // Hiçbirine rahat yetişemiyorsun → en az açık veren (en yakın yetişilebilir) durak
                candidates.sort(function (a, b) { return (a.walkTime - a.busTime) - (b.walkTime - b.busTime); });
                pick = candidates[0]; pick.mode = 'hurry';
            }
        }

        // Otobüs yok / hepsi ardımızda → en yakın durağı göster
        if (!pick) {
            var best = null;
            pts.forEach(function (pt) {
                var wd = haversineM(user, pt.ll);
                if (!best || wd < best.walkDist) {
                    best = { name: pt.name, ll: pt.ll, walkDist: wd, walkTime: wd / WALK_MPS, busTime: null, mode: 'nearest', plate: '' };
                }
            });
            pick = best;
        }
        return pick;
    }

    // ----- Popup DOM & durum yönetimi
    var $board       = document.getElementById('wmb-board');
    var $boardOpen   = document.getElementById('wmb-board-open');
    var $boardAllow  = document.getElementById('wmb-board-allow');
    var $boardResult = document.getElementById('wmb-board-result');
    var $boardError  = document.getElementById('wmb-board-error');
    var boardingPending = false;   // yeni hat seçildi mi (ilk yüklemede otomatik aç)
    var boardMarker = null;        // önerilen durak işareti

    function boardSetState(state) {
        if (!$board) return;
        Array.prototype.forEach.call($board.querySelectorAll('[data-wmb-board-state]'), function (el) {
            el.classList.toggle('d-none', el.getAttribute('data-wmb-board-state') !== state);
        });
    }
    function boardOpen() {
        if (!$board) return;
        boardSetState('ask');
        $board.classList.remove('d-none');
    }
    function boardClose() { if ($board) $board.classList.add('d-none'); }

    function setWalkPath(coords) {
        whenReady(function () {
            var src = map.getSource('walkroute');
            if (!src) return;
            src.setData((coords && coords.length > 1)
                ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
                : { type: 'FeatureCollection', features: [] });
        });
    }

    // OSRM uyumlu yaya yol tarifi — yürüyüşü sokaklardan çizmek için.
    // Harici servis; uygulama backend'i değil, bu yüzden düz fetch (kimlik bilgisiz).
    function fetchWalkRoute(from, to) {
        var base = cfg.walkRouteUrl;
        if (!base) return Promise.resolve(null);
        var url = base + from[0] + ',' + from[1] + ';' + to[0] + ',' + to[1] + '?overview=full&geometries=geojson';
        return fetch(url, { headers: { 'Accept': 'application/json' } })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (data) {
                var route = data && data.routes && data.routes[0];
                var g = route && route.geometry;
                if (!g || !g.coordinates || g.coordinates.length < 2) return null;
                return { coords: g.coordinates, distance: route.distance, duration: route.duration };
            })
            .catch(function (err) { console.warn('[WMB] walkroute', err); return null; });
    }
    function setBoardMarker(ll) {
        whenReady(function () {
            if (!ll) { if (boardMarker) { boardMarker.remove(); boardMarker = null; } return; }
            if (!boardMarker) {
                var el = document.createElement('div');
                el.className = 'wmb-boarddot';
                boardMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(ll).addTo(map);
            } else {
                boardMarker.setLngLat(ll);
            }
        });
    }

    function renderBoardResult(pick, user) {
        if (!pick) {
            boardShowError(t('js.board.noStops', 'Bu hat için durak bilgisi yok.'), false);
            return;
        }
        // mode → not kutusu (yürüme süresi güncellenince yeniden hesaplanabilir)
        function noteInfo(mode) {
            if (mode === 'catch') return { cls: 'ok',   ico: 'bi-check-circle-fill',        txt: t('js.board.catch', 'Otobüs sen vardıktan sonra bu durağa ulaşıyor — rahat yetişirsin.') };
            if (mode === 'hurry') return { cls: 'warn', ico: 'bi-exclamation-triangle-fill', txt: t('js.board.hurry', 'Biraz acele etmen gerekebilir, ama en iyi şansın bu durak.') };
            return                       { cls: 'info', ico: 'bi-info-circle-fill',          txt: t('js.board.nearest', 'Yakında aktif otobüs yok — sana en yakın durağı gösteriyoruz.') };
        }
        function paintNote($el, mode) {
            var n = noteInfo(mode);
            $el.className = 'wmb-board__note wmb-board__note--' + n.cls;
            $el.innerHTML = '<i class="bi ' + n.ico + '"></i><span>' + escapeHtml(n.txt) + '</span>';
        }

        var busMetric = (pick.busTime != null)
            ? '<div class="wmb-board__metric">'
            +   '<span class="wmb-board__metric-lbl">' + escapeHtml(t('js.board.busEta', 'Otobüs bu durakta')) + (pick.plate ? ' · ' + escapeHtml(pick.plate) : '') + '</span>'
            +   '<span class="wmb-board__metric-val">' + escapeHtml(fmtMin(pick.busTime)) + '</span>'
            + '</div>'
            : '';

        var gmapsUrl = 'https://www.google.com/maps/dir/?api=1'
                     + '&origin=' + user[1] + ',' + user[0]
                     + '&destination=' + pick.ll[1] + ',' + pick.ll[0]
                     + '&travelmode=walking';

        $boardResult.innerHTML =
            '<div class="wmb-board__stopname"><i class="bi bi-geo-alt-fill"></i>' + escapeHtml(pick.name || '') + '</div>'
          + '<div class="wmb-board__metrics">'
          +   '<div class="wmb-board__metric">'
          +     '<span class="wmb-board__metric-lbl">' + escapeHtml(t('js.board.walkDist', 'Yürüme mesafesi')) + '</span>'
          +     '<span class="wmb-board__metric-val" id="wmb-bd-walkdist">' + escapeHtml(fmtDist(pick.walkDist)) + '</span>'
          +   '</div>'
          +   '<div class="wmb-board__metric">'
          +     '<span class="wmb-board__metric-lbl">' + escapeHtml(t('js.board.walkTime', 'Yürüme süresi')) + '</span>'
          +     '<span class="wmb-board__metric-val" id="wmb-bd-walktime">' + escapeHtml(fmtMin(pick.walkTime)) + '</span>'
          +   '</div>'
          +   busMetric
          + '</div>'
          + '<div class="wmb-board__note" id="wmb-bd-note"></div>'
          + '<div class="wmb-board__actions">'
          +   '<button type="button" class="btn btn-primary w-100" id="wmb-board-show"><i class="bi bi-map me-1"></i>' + escapeHtml(t('js.board.showMap', 'Haritada göster')) + '</button>'
          +   '<a class="btn btn-outline-secondary w-100" href="' + gmapsUrl + '" target="_blank" rel="noopener"><i class="bi bi-signpost-2 me-1"></i>' + escapeHtml(t('js.board.gmaps', "Google Haritalar'da aç")) + '</a>'
          + '</div>';

        var $note = document.getElementById('wmb-bd-note');
        paintNote($note, pick.mode);

        boardSetState('result');

        // Kullanıcı + önerilen durağı haritada göster (kullanıcı noktası locate marker'ıyla ortak)
        showUserDot(user);
        setBoardMarker(pick.ll);
        // Önce anlık geri bildirim için düz çizgi çiz, sonra sokak rotasıyla değiştir
        setWalkPath([user, pick.ll]);
        fitWalk(user, pick.ll);

        var $show = document.getElementById('wmb-board-show');
        var lastPath = [user, pick.ll];
        if ($show) $show.addEventListener('click', function () {
            boardClose();
            fitPath(lastPath);
        });

        // Sokak yürüyüş rotasını getir → çizgiyi ve gerçek mesafe/süreyi güncelle
        fetchWalkRoute(user, pick.ll).then(function (route) {
            if (!route) return;   // servis erişilemezse düz çizgi kalır (yol tarifi yine çalışır)
            lastPath = route.coords;
            setWalkPath(route.coords);
            fitPath(route.coords);

            var $wd = document.getElementById('wmb-bd-walkdist');
            var $wt = document.getElementById('wmb-bd-walktime');
            if ($wd) $wd.textContent = fmtDist(route.distance);
            if ($wt) $wt.textContent = fmtMin(route.duration);

            // Gerçek yürüme süresiyle "yetişir/acele et" notunu yeniden değerlendir
            if (pick.busTime != null && (pick.mode === 'catch' || pick.mode === 'hurry')) {
                var $n = document.getElementById('wmb-bd-note');
                if ($n) paintNote($n, route.duration <= pick.busTime ? 'catch' : 'hurry');
            }
        });
    }

    function fitPath(coords) {
        if (!coords || !coords.length) return;
        whenReady(function () {
            var b = new maplibregl.LngLatBounds();
            coords.forEach(function (c) { b.extend(c); });
            var cam = map.cameraForBounds(b, { padding: 90, maxZoom: 16.5, bearing: map.getBearing() });
            if (cam) map.easeTo({ center: cam.center, zoom: cam.zoom, bearing: map.getBearing(), pitch: map.getPitch(), duration: 600 });
        });
    }

    function fitWalk(user, stopLL) {
        whenReady(function () {
            var b = new maplibregl.LngLatBounds();
            b.extend(user); b.extend(stopLL);
            var cam = map.cameraForBounds(b, { padding: 90, maxZoom: 16.5, bearing: map.getBearing() });
            if (cam) map.easeTo({ center: cam.center, zoom: cam.zoom, bearing: map.getBearing(), pitch: map.getPitch(), duration: 600 });
        });
    }

    function boardShowError(msg, retry) {
        if (!$boardError) return;
        $boardError.innerHTML = '<div>' + escapeHtml(msg) + '</div>'
            + (retry ? '<button type="button" class="btn btn-primary" id="wmb-board-retry">' + escapeHtml(t('js.board.retry', 'Tekrar Dene')) + '</button>' : '');
        boardSetState('error');
        var $retry = document.getElementById('wmb-board-retry');
        if ($retry) $retry.addEventListener('click', requestLocationAndSuggest);
    }

    // locate düğmesindeki mavi kullanıcı noktasını ortak kullan
    function showUserDot(c) {
        if (!userMarker) {
            var el = document.createElement('div');
            el.className = 'wmb-userdot';
            userMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(c).addTo(map);
        } else {
            userMarker.setLngLat(c);
        }
    }

    function requestLocationAndSuggest() {
        // Yerel geliştirme: appsettings'teki sabit konumu kullan (gerçek GPS'i atla)
        var mock = cfg.mockLocation;
        if (mock && mock.length === 2 && isFinite(mock[0]) && isFinite(mock[1])) {
            boardSetState('loading');
            setTimeout(function () {
                var user = [Number(mock[0]), Number(mock[1])];
                renderBoardResult(computeBestBoardingStop(user), user);
            }, 150);
            return;
        }
        if (!navigator.geolocation) {
            boardShowError(t('js.board.geoUnsupported', 'Tarayıcın konum servisini desteklemiyor.'), false);
            return;
        }
        boardSetState('loading');
        navigator.geolocation.getCurrentPosition(function (pos) {
            // Şehir hizmet alanı dışından binme durağı önerisi anlamsızdır.
            if (window.WmbMapCore && !WmbMapCore.inCityBounds(pos.coords.latitude, pos.coords.longitude)) {
                boardShowError(t('bounds.geoOutside', 'Konumunuz {city} hizmet alanı dışında görünüyor.')
                    .replace('{city}', (window.WMB && window.WMB.city && window.WMB.city.name) || ''), false);
                return;
            }
            var user = [pos.coords.longitude, pos.coords.latitude];
            var pick = computeBestBoardingStop(user);
            renderBoardResult(pick, user);
        }, function (err) {
            var denied = err && err.code === 1;
            boardShowError(denied
                ? t('js.board.geoDenied', 'Konum erişimi reddedildi. Tarayıcı ayarlarından izin verebilirsin.')
                : t('js.board.geoFail', 'Konum alınamadı. Lütfen tekrar dene.'), !denied);
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    }

    // Hat verileri hazır olduğunda: FAB'ı göster + (yeni seçimse) popup'ı otomatik aç
    function onVariantReady() {
        if ($boardOpen) $boardOpen.classList.remove('d-none');
        if (boardingPending) {
            boardingPending = false;
            boardOpen();
        }
    }
    function boardingReset() {
        boardingPending = false;
        boardClose();
        if ($boardOpen) $boardOpen.classList.add('d-none');
        setWalkPath(null);
        setBoardMarker(null);
    }

    if ($boardAllow) $boardAllow.addEventListener('click', requestLocationAndSuggest);
    if ($boardOpen)  $boardOpen.addEventListener('click', function () {
        // Yeniden açılış: daha önce sonuç aldıysak doğrudan güncel öneriyi göster
        boardOpen();
        if (userMarker) requestLocationAndSuggest();
    });
    if ($board) {
        $board.addEventListener('click', function (e) {
            if (e.target.closest('[data-wmb-board-close]')) { e.preventDefault(); boardClose(); }
        });
    }
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && $board && !$board.classList.contains('d-none')) boardClose();
    });

    // ----- Boot
    loadRoutes();
    startOverview(); // ilk açılışta tüm hat çizimleri + tüm canlı otobüsler (duraksız)
})();
