// ============================================================
// BM4 Patch 010 — Map Route Performance Guard
// Tujuan:
// - Tidak menambah fungsi dengan nama lama / tidak double declaration.
// - Membungkus fungsi rute yang sudah ada agar tidak blocking 30 detik.
// - Rute via OSRM tetap dipakai, tapi ada timeout cepat + fallback estimasi.
// - Hasil rute yang berhasil tetap masuk cache lama bm4_route_cache_v1.
// ============================================================
(function BM4RoutePerformancePatch(){
  if (window.__BM4_ROUTE_PERFORMANCE_PATCH__) {
    console.log('[BM4 RoutePerf] patch sudah aktif, skip duplikasi.');
    return;
  }
  window.__BM4_ROUTE_PERFORMANCE_PATCH__ = true;

  const PERF = window.BM4RoutePerformance = window.BM4RoutePerformance || {};
  PERF.version = '1.0.0';
  PERF.createdAt = new Date().toISOString();

  const ROUTE_TIMEOUT_MS = 5500;        // batas tunggu user-facing
  const ROUTE_BG_TIMEOUT_MS = 12000;    // batas proses background untuk isi cache
  const ROUTE_BATCH_TIMEOUT_MS = 4200;  // batas per rute untuk batch/lazy upgrade
  const ROUTE_BATCH_CONCURRENCY = 3;    // turunkan dari 6 supaya UI tidak terasa berat
  const ROUTE_SHORTLIST_PER_KAT = 2;    // cukup 2 terdekat/kategori untuk upgrade awal
  const ROUTE_PERUM_SHORTLIST = 4;      // cukup 4 perumahan terdekat untuk compare awal
  const LOCAL_CACHE_KEY = 'bm4_route_cache_v1';
  const DEFAULT_ENDPOINTS = [
    'https://router.project-osrm.org',
    'https://routing.openstreetmap.de/routed-car'
  ];

  const inflightFull = new Map();
  const inflightDistance = new Map();

  function bm4PerfEndpoints(){
    try {
      if (typeof OSRM_ENDPOINTS !== 'undefined' && Array.isArray(OSRM_ENDPOINTS) && OSRM_ENDPOINTS.length) {
        return OSRM_ENDPOINTS.slice(0, 2);
      }
    } catch (_) {}
    return DEFAULT_ENDPOINTS;
  }

  function bm4PerfFactor(){
    try {
      if (typeof ROUTE_HAVERSINE_FACTOR !== 'undefined' && Number(ROUTE_HAVERSINE_FACTOR) > 0) return Number(ROUTE_HAVERSINE_FACTOR);
    } catch (_) {}
    return 1.35;
  }

  function bm4PerfRouteKey(lat1, lng1, lat2, lng2){
    return `${Number(lat1).toFixed(5)},${Number(lng1).toFixed(5)}_${Number(lat2).toFixed(5)},${Number(lng2).toFixed(5)}`;
  }

  function bm4PerfHaversine(lat1, lng1, lat2, lng2){
    try {
      if (typeof haversine === 'function') return haversine(lat1, lng1, lat2, lng2);
    } catch (_) {}
    const R = 6371;
    const toRad = d => Number(d) * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bm4PerfEstimate(lat1, lng1, lat2, lng2){
    const kmLurus = bm4PerfHaversine(lat1, lng1, lat2, lng2);
    const km = +(kmLurus * bm4PerfFactor()).toFixed(1);
    return {
      km,
      menit: Math.max(1, Math.round(km / 35 * 60)),
      coords: [[lat1, lng1], [lat2, lng2]],
      viaRoad: false,
      isEstimate: true,
      fastFallback: true,
      _t: Date.now()
    };
  }

  function bm4PerfGetCached(key){
    try {
      if (typeof routeCache !== 'undefined' && routeCache && routeCache[key]) return routeCache[key];
    } catch (_) {}
    try {
      const raw = localStorage.getItem(LOCAL_CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && data[key] ? data[key] : null;
    } catch (_) {
      return null;
    }
  }

  function bm4PerfSaveCached(key, value){
    if (!key || !value || !value.viaRoad) return;
    const out = Object.assign({}, value, { _t: value._t || Date.now() });
    try {
      if (typeof routeCache !== 'undefined' && routeCache) routeCache[key] = out;
    } catch (_) {}
    try {
      if (typeof saveRouteCache === 'function') {
        saveRouteCache();
        return;
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem(LOCAL_CACHE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      data[key] = out;
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function bm4PerfWithTimeout(promise, ms, fallbackFactory){
    let done = false;
    return new Promise(resolve => {
      const tid = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(fallbackFactory());
      }, ms);
      promise.then(v => {
        if (done) return;
        done = true;
        clearTimeout(tid);
        resolve(v);
      }).catch(() => {
        if (done) return;
        done = true;
        clearTimeout(tid);
        resolve(fallbackFactory());
      });
    });
  }

  async function bm4PerfFetchOne(endpoint, lat1, lng1, lat2, lng2, opts){
    opts = opts || {};
    const overview = opts.overview || 'full';
    const timeoutMs = opts.timeoutMs || ROUTE_TIMEOUT_MS;
    const url = `${endpoint}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=${overview}&geometries=geojson`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'force-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('No route');
      const route = data.routes[0];
      const coords = route.geometry && Array.isArray(route.geometry.coordinates)
        ? route.geometry.coordinates.map(c => [c[1], c[0]])
        : [[lat1, lng1], [lat2, lng2]];
      return {
        km: route.distance / 1000,
        menit: Math.max(1, Math.round(route.duration / 60)),
        coords,
        viaRoad: true,
        _t: Date.now()
      };
    } finally {
      clearTimeout(tid);
    }
  }

  async function bm4PerfFetchFullRoute(lat1, lng1, lat2, lng2, timeoutMs){
    const endpoints = bm4PerfEndpoints();
    const tasks = endpoints.map(endpoint => bm4PerfFetchOne(endpoint, lat1, lng1, lat2, lng2, {
      overview: 'full',
      timeoutMs: timeoutMs || ROUTE_TIMEOUT_MS
    }));
    if (typeof Promise.any === 'function') return Promise.any(tasks);
    return new Promise((resolve, reject) => {
      let failed = 0;
      tasks.forEach(p => p.then(resolve).catch(err => {
        failed++;
        if (failed >= tasks.length) reject(err);
      }));
    });
  }

  async function bm4PerfFetchDistanceOnly(lat1, lng1, lat2, lng2, timeoutMs){
    const key = bm4PerfRouteKey(lat1, lng1, lat2, lng2);
    const cached = bm4PerfGetCached(key);
    if (cached && cached.viaRoad) return cached;
    if (inflightDistance.has(key)) return bm4PerfWithTimeout(inflightDistance.get(key), ROUTE_BATCH_TIMEOUT_MS, () => bm4PerfEstimate(lat1, lng1, lat2, lng2));

    const endpoints = bm4PerfEndpoints();
    const job = (async () => {
      let lastErr = null;
      for (const endpoint of endpoints) {
        try {
          const r = await bm4PerfFetchOne(endpoint, lat1, lng1, lat2, lng2, {
            overview: 'false',
            timeoutMs: timeoutMs || ROUTE_BATCH_TIMEOUT_MS
          });
          bm4PerfSaveCached(key, r);
          return r;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('route failed');
    })().finally(() => inflightDistance.delete(key));

    inflightDistance.set(key, job);
    return bm4PerfWithTimeout(job, timeoutMs || ROUTE_BATCH_TIMEOUT_MS, () => bm4PerfEstimate(lat1, lng1, lat2, lng2));
  }

  PERF.originalGetRouteDistance = typeof getRouteDistance === 'function' ? getRouteDistance : null;

  // Tidak membuat function getRouteDistance() baru. Hanya mengganti referensi fungsi lama.
  if (PERF.originalGetRouteDistance) {
    getRouteDistance = async function bm4RoutePerfGetRouteDistance(lat1, lng1, lat2, lng2){
      const key = bm4PerfRouteKey(lat1, lng1, lat2, lng2);
      const cached = bm4PerfGetCached(key);
      if (cached && cached.viaRoad) return cached;

      if (inflightFull.has(key)) {
        return bm4PerfWithTimeout(inflightFull.get(key), ROUTE_TIMEOUT_MS, () => bm4PerfEstimate(lat1, lng1, lat2, lng2));
      }

      const job = bm4PerfFetchFullRoute(lat1, lng1, lat2, lng2, ROUTE_TIMEOUT_MS)
        .then(r => {
          bm4PerfSaveCached(key, r);
          return r;
        })
        .catch(() => {
          // Background retry lebih panjang untuk mengisi cache kalau endpoint sedang lambat.
          bm4PerfFetchFullRoute(lat1, lng1, lat2, lng2, ROUTE_BG_TIMEOUT_MS)
            .then(r => bm4PerfSaveCached(key, r))
            .catch(() => {});
          return bm4PerfEstimate(lat1, lng1, lat2, lng2);
        })
        .finally(() => inflightFull.delete(key));

      inflightFull.set(key, job);
      return bm4PerfWithTimeout(job, ROUTE_TIMEOUT_MS, () => {
        // Biarkan job tetap berjalan. User tidak perlu menunggu lebih lama.
        return bm4PerfEstimate(lat1, lng1, lat2, lng2);
      });
    };
    window.getRouteDistance = getRouteDistance;
  }

  async function bm4PerfRunBatchedDistance(p, targets, concurrency){
    const out = new Array(targets.length);
    let idx = 0;
    async function worker(){
      while (idx < targets.length) {
        const i = idx++;
        const t = targets[i];
        try {
          const r = await bm4PerfFetchDistanceOnly(p.lat, p.lng, t.lat, t.lng, ROUTE_BATCH_TIMEOUT_MS);
          out[i] = Object.assign({}, t, { km: r.km, menit: r.menit, viaRoad: r.viaRoad });
        } catch (_) {
          out[i] = null;
        }
        // beri napas ke browser supaya UI tidak terasa berhenti
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    const workers = [];
    const n = Math.min(concurrency || ROUTE_BATCH_CONCURRENCY, targets.length);
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);
    return out.filter(Boolean);
  }

  PERF.originalUpgradeKompetitorToRoad = typeof upgradeKompetitorToRoad === 'function' ? upgradeKompetitorToRoad : null;

  if (PERF.originalUpgradeKompetitorToRoad) {
    upgradeKompetitorToRoad = async function bm4RoutePerfUpgradeKompetitorToRoad(p, opts){
      if (!p) return;
      opts = opts || {};
      const force = opts.force === true;
      if (!force && p._distMode === 'jalan') return;
      try {
        if (typeof _roadUpgradeInProgress !== 'undefined' && _roadUpgradeInProgress.has(p.id)) return;
        if (typeof _roadUpgradeInProgress !== 'undefined') _roadUpgradeInProgress.add(p.id);
      } catch (_) {}

      p._distMode = 'mengukur';
      try { if (typeof _updateDistModeBadge === 'function') _updateDistModeBadge(p); } catch (_) {}

      try {
        const byKat = {};
        (Array.isArray(poi) ? poi : []).forEach(x => {
          if (!x || isNaN(x.lat) || isNaN(x.lng)) return;
          const d = bm4PerfHaversine(p.lat, p.lng, x.lat, x.lng);
          (byKat[x.kat] = byKat[x.kat] || []).push(Object.assign({}, x, { _hav: d }));
        });

        const shortlist = [];
        for (const k in byKat) {
          byKat[k].sort((a, b) => a._hav - b._hav);
          shortlist.push.apply(shortlist, byKat[k].slice(0, ROUTE_SHORTLIST_PER_KAT));
        }

        const results = await bm4PerfRunBatchedDistance(p, shortlist, ROUTE_BATCH_CONCURRENCY);
        const roadByKat = {};
        results.forEach(r => {
          if (!r) return;
          const cur = roadByKat[r.kat];
          if (!cur || r.km < cur.dist) {
            roadByKat[r.kat] = Object.assign({}, r, { dist: r.km, viaRoad: r.viaRoad, menit: r.menit });
          }
        });
        p._roadNearest = roadByKat;

        const otherPerum = (Array.isArray(perumahan) ? perumahan : [])
          .filter(x => x && x.id !== p.id && !isNaN(x.lat) && !isNaN(x.lng))
          .map(x => Object.assign({}, x, { _hav: bm4PerfHaversine(p.lat, p.lng, x.lat, x.lng) }))
          .sort((a, b) => a._hav - b._hav)
          .slice(0, ROUTE_PERUM_SHORTLIST);

        const perumResults = await bm4PerfRunBatchedDistance(p, otherPerum, ROUTE_BATCH_CONCURRENCY);
        p._roadPerum = {};
        perumResults.forEach(r => {
          if (r) p._roadPerum[r.id] = { km: r.km, menit: r.menit, viaRoad: r.viaRoad };
        });

        try { if (typeof _recalcScoreWithRoad === 'function') _recalcScoreWithRoad(p); } catch (_) {}

        const roadCount = results.filter(r => r && r.viaRoad).length;
        p._distMode = roadCount > 0 ? (roadCount === results.length ? 'jalan' : 'partial') : 'lurus';

        try {
          if (typeof selectedId !== 'undefined' && selectedId === p.id) {
            if (typeof renderDetailOverview === 'function') renderDetailOverview(p);
            if (typeof renderDetailFasilitas === 'function') renderDetailFasilitas(p);
            if (typeof renderDetailCompare === 'function') renderDetailCompare(p);
            if (typeof renderDetailRadar === 'function') renderDetailRadar(p);
            if (typeof renderDetailNearby === 'function') renderDetailNearby(p);
          }
        } catch (_) {}

        try { if (typeof _updateDistModeBadge === 'function') _updateDistModeBadge(p); } catch (_) {}
        try {
          if (typeof buildRanking === 'function') {
            const cat = document.getElementById('rank-cat-select')?.value;
            if (cat) buildRanking(cat);
          }
        } catch (_) {}
      } catch (e) {
        console.warn('[BM4 RoutePerf] road upgrade fallback:', e);
        p._distMode = 'lurus';
        try { if (typeof _updateDistModeBadge === 'function') _updateDistModeBadge(p); } catch (_) {}
      } finally {
        try {
          if (typeof _roadUpgradeInProgress !== 'undefined') _roadUpgradeInProgress.delete(p.id);
        } catch (_) {}
      }
    };
    window.upgradeKompetitorToRoad = upgradeKompetitorToRoad;
  }

  PERF.originalHitungJarakViaJalanTP = typeof hitungJarakViaJalanTP === 'function' ? hitungJarakViaJalanTP : null;
  if (PERF.originalHitungJarakViaJalanTP) {
    hitungJarakViaJalanTP = async function bm4RoutePerfHitungJarakViaJalanTP(id){
      const t = Array.isArray(tpTargets) ? tpTargets.find(x => x.id === id) : null;
      if (!t) return;
      const proj = currentProyek ? PROYEK[currentProyek] : PROYEK.gwc;
      const el = document.getElementById('tp-d-jarak-road');
      if (el) {
        el.textContent = 'menghitung rute...';
        el.style.cursor = 'default';
      }

      const r = await getRouteDistance(proj.lat, proj.lng, t.lat, t.lng);
      const span = document.getElementById('tp-d-jarak-road');
      if (!span) return;

      if (r.viaRoad) {
        span.innerHTML = `<b style="color:var(--accent);">${r.km.toFixed(1)} km via jalan</b> <span style="color:var(--muted);">(${r.menit} mnt)</span>`;
      } else {
        span.innerHTML = `<span style="color:#B45309;">± ${r.km.toFixed(1)} km estimasi · rute asli masih dihitung/cache</span>`;
      }
      span.style.textDecoration = 'none';

      try {
        if (tpMap && tpMapInit && typeof L !== 'undefined') {
          if (typeof tpJumpLine !== 'undefined' && tpJumpLine) { tpMap.removeLayer(tpJumpLine); tpJumpLine = null; }
          if (typeof tpJumpPulse !== 'undefined' && tpJumpPulse) { tpMap.removeLayer(tpJumpPulse); tpJumpPulse = null; }
          const lineStyle = r.viaRoad
            ? { color:'#D97706', weight:4, opacity:0.85 }
            : { color:'#D97706', weight:3, opacity:0.7, dashArray:'8,6' };
          tpJumpLine = L.polyline(r.coords, lineStyle).addTo(tpMap);
          tpJumpPulse = L.circleMarker([t.lat, t.lng], {
            radius:32, color:'#D97706', fillColor:'#FBBF24', fillOpacity:0.4, weight:3
          }).addTo(tpMap);
          tpMap.fitBounds(tpJumpLine.getBounds(), { padding:[50,50], maxZoom:14, animate:true });
        }
      } catch (e) {
        console.warn('[BM4 RoutePerf] gambar rute TP gagal:', e);
      }
    };
    window.hitungJarakViaJalanTP = hitungJarakViaJalanTP;
  }

  PERF.originalHitungJarakViaJalanCompare = typeof hitungJarakViaJalanCompare === 'function' ? hitungJarakViaJalanCompare : null;
  if (PERF.originalHitungJarakViaJalanCompare) {
    hitungJarakViaJalanCompare = async function bm4RoutePerfHitungJarakViaJalanCompare(pid){
      const p = Array.isArray(perumahan) ? perumahan.find(x => x.id === pid) : null;
      const anchor = Array.isArray(perumahan) ? perumahan.find(x => x.id === ANCHOR_ID) : null;
      if (!p || !anchor) return;
      const el = document.getElementById('cmp-jarak-road');
      if (el) {
        el.textContent = 'menghitung rute...';
        el.style.cursor = 'default';
      }
      const r = await getRouteDistance(p.lat, p.lng, anchor.lat, anchor.lng);
      if (!el) return;
      if (r.viaRoad) {
        el.innerHTML = `<b>${r.km.toFixed(1)} km via jalan · ${r.menit} mnt berkendara</b>`;
      } else {
        el.innerHTML = `± ${r.km.toFixed(1)} km estimasi · rute asli masih dihitung/cache`;
      }
      el.style.textDecoration = 'none';
      el.style.cursor = 'default';
    };
    window.hitungJarakViaJalanCompare = hitungJarakViaJalanCompare;
  }

  console.log('[BM4 RoutePerf] aktif — route timeout cepat, fallback estimasi, cache tetap dipakai.');
})(window, document);
