// Security, config, state, projects, routing
// ============================================================
// [v9 SECURITY] PASSWORD HASHING (SHA-256)
// ============================================================
// Catatan: Ini hashing client-side — lebih aman daripada plaintext,
// tapi BUKAN pengganti hashing di server. Untuk keamanan ideal,
// hashing harus dilakukan di GAS (server-side) dengan salt per user.
// Implementasi saat ini: SHA-256 dengan salt global "bm4_v9_2026".
const PW_SALT = 'bm4_v9_2026';
const PW_HASH_PREFIX = 'h1$'; // penanda sudah ter-hash

async function hashPassword(plain){
  if(!plain) return '';
  // Kalau sudah ter-hash, jangan di-hash ulang
  if(typeof plain === 'string' && plain.startsWith(PW_HASH_PREFIX)) return plain;
  try {
    const enc = new TextEncoder().encode(PW_SALT + ':' + plain);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    const arr = Array.from(new Uint8Array(buf));
    const hex = arr.map(b => b.toString(16).padStart(2,'0')).join('');
    return PW_HASH_PREFIX + hex;
  } catch(e){
    console.error('[BM4] Hash gagal:', e);
    return '';
  }
}

// Cek password: bandingkan plain input vs stored value (yang sudah ter-hash)
async function verifyPassword(plain, stored){
  if(!stored) return false;
  // Kalau stored masih plaintext (legacy), bandingkan langsung
  if(!stored.startsWith(PW_HASH_PREFIX)){
    return plain === stored;
  }
  const hashed = await hashPassword(plain);
  return hashed === stored;
}

// Migrasi: untuk setiap akun yang password-nya masih plaintext, hash-kan.
// Dipanggil sekali saat init.
async function migratePasswordsIfNeeded(){
  let migrated = 0;
  for(let i = 0; i < accounts.length; i++){
    const a = accounts[i];
    if(a.password && !a.password.startsWith(PW_HASH_PREFIX)){
      a.password = await hashPassword(a.password);
      migrated++;
    }
  }
  if(migrated > 0){
    saveAccountsLocal();
    if(USE_SHEETS) syncAccountsToSheets();
    console.log(`[BM4] Migrasi password selesai: ${migrated} akun.`);
  }
  return migrated;
}

// ============================================================
// CONFIG
// ============================================================
// ============================================================
// BM4 GOOGLE SHEET SECURE MODE
// ============================================================
// Tetap memakai Google Sheet + Apps Script, tapi token statis frontend dihapus.
// Semua request memakai sessionToken yang dibuat server-side oleh Apps Script.
// GANTI URL di bawah dengan URL Web App Apps Script setelah deploy.
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyPm0hR8SqqI572qjkaZ97PERPocBcE7ydhRcjoY_hve1qI6PItWMJeZ94kwG_q_gHpaw/exec';
const BM4_SECURE_MODE = true;
const BM4_SESSION_TOKEN_KEY = 'bm4_secure_session_token';
const BM4_SESSION_USER_KEY = 'bm4_secure_user';

function getBm4SessionToken(){
  try { return sessionStorage.getItem(BM4_SESSION_TOKEN_KEY) || localStorage.getItem(BM4_SESSION_TOKEN_KEY) || ''; }
  catch(e){ return ''; }
}
function setBm4SessionToken(token, remember){
  try {
    sessionStorage.setItem(BM4_SESSION_TOKEN_KEY, token || '');
    if(remember) localStorage.setItem(BM4_SESSION_TOKEN_KEY, token || '');
    else localStorage.removeItem(BM4_SESSION_TOKEN_KEY);
  } catch(e){}
}
function clearBm4SessionToken(){
  try {
    sessionStorage.removeItem(BM4_SESSION_TOKEN_KEY);
    localStorage.removeItem(BM4_SESSION_TOKEN_KEY);
    sessionStorage.removeItem(BM4_SESSION_USER_KEY);
    localStorage.removeItem(BM4_SESSION_USER_KEY);
  } catch(e){}
}

// Helper: bangun URL GET dengan sessionToken otomatis.
function gasGet(action, extraParams){
  let params = Object.assign({}, extraParams || {}, { action: action });
  const sessionToken = getBm4SessionToken();
  if(sessionToken) params.sessionToken = sessionToken;
  params._t = Date.now();
  return GAS_URL + '?' + new URLSearchParams(params).toString();
}

// Helper: bangun body POST dengan sessionToken otomatis.
function gasPost(bodyObj){
  const sessionToken = getBm4SessionToken();
  const body = Object.assign({}, bodyObj || {});
  if(sessionToken) body.sessionToken = sessionToken;
  return JSON.stringify(body);
}

// [v11.5 SYNC BADGE] Update indikator sync di topbar
// state: 'synced' | 'loading' | 'offline' | 'local'
function setSyncStatus(state, detail){
  const el = document.getElementById('tb-sync');
  if(!el) return;
  el.className = 'tb-sync state-' + state;
  const labels = {
    synced:  '● Tersinkron',
    loading: 'Memuat...',
    offline: '⚠ Offline',
    local:   '● Lokal'
  };
  el.textContent = labels[state] || state;
  if(detail) el.title = detail;
}

// ============================================================
// [v12.4 STATE PERSISTENCE] Save/restore halaman aktif
// Supaya setelah refresh, user kembali ke tab/perumahan/filter terakhir
// ============================================================
const APP_STATE_KEY = 'bm4_app_state';

function saveAppState(){
  if(!currentUser) return; // jangan simpan kalau belum login
  try {
    const state = {
      v: 1, // version, untuk migrasi nanti
      user: currentUser?.username || null,
      proyek: typeof currentProyek !== 'undefined' ? currentProyek : null,
      divisi: document.querySelector('.divisi-tab.active')?.dataset?.div || null,
      filterTipe: typeof currentFilter !== 'undefined' ? currentFilter : null,
      filterPerumahan: document.getElementById('filter-perumahan')?.value || '',
      selectedPerumahan: typeof selectedId !== 'undefined' ? selectedId : null,
      tabAtab: document.querySelector('.tab.active')?.dataset?.atab || null,
      pdlOpen: !!document.getElementById('pdl-overlay')?.classList?.contains('open'),
      pdlPerumId: window.__currentPdlPerumId || null,
      timestamp: Date.now()
    };
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
  } catch(e){ console.warn('saveAppState failed:', e); }
}

function loadAppState(){
  try {
    const raw = localStorage.getItem(APP_STATE_KEY);
    if(!raw) return null;
    const state = JSON.parse(raw);
    // Validasi: hanya restore kalau user sama dengan yg sekarang & state < 24 jam
    if(!currentUser || state.user !== currentUser.username) return null;
    if(Date.now() - (state.timestamp||0) > 24*60*60*1000) return null;
    return state;
  } catch(e){
    console.warn('loadAppState failed:', e);
    return null;
  }
}

function clearAppState(){
  try { localStorage.removeItem(APP_STATE_KEY); } catch(e){}
}

// Helper: trigger save state (debounced supaya tidak terlalu sering)
let _saveStateTimer = null;
function triggerSaveAppState(){
  if(_saveStateTimer) clearTimeout(_saveStateTimer);
  _saveStateTimer = setTimeout(saveAppState, 300);
}

// Restore app state setelah aplikasi siap (data perumahan loaded)
// PENTING: function ini dipanggil DARI selectProyek() — jadi jangan panggil selectProyek lagi (infinite loop)
async function restoreAppState(){
  const state = loadAppState();
  if(!state) return false;
  try {
    // NOTE: Restore proyek DI-SKIP di sini — selectProyek sudah dipanggil di startup
    // (lihat startup logic dan selectProyek hook). Restore proyek di sini akan infinite loop.
    // 2. Restore divisi/tab
    if(state.divisi){
      const tab = document.querySelector(`[data-div="${state.divisi}"]`);
      if(tab && !tab.classList.contains('active')){
        // [v12.5] BM selalu boleh, lainnya cek akses
        const isBM = currentUser?.role === 'bm';
        const akses = currentUser?.akses || [];
        const allowedAlways = ['dashboard','tim','galeri','proyek'];
        if(isBM || allowedAlways.includes(state.divisi) || akses.includes(state.divisi)){
          switchDiv(state.divisi, tab);
        }
      }
    }
    // 3. Restore filter perumahan dropdown (kalau di Analisa)
    if(state.divisi === 'analisa' && state.filterPerumahan){
      setTimeout(()=>{
        const sel = document.getElementById('filter-perumahan');
        if(sel && sel.querySelector(`option[value="${state.filterPerumahan}"]`)){
          sel.value = state.filterPerumahan;
          sel.dispatchEvent(new Event('change'));
        }
      }, 300);
    }
    // 4. Restore tab dalam Analisa (Info/Fasilitas/Vs Anchor/Radar/Sekitar)
    if(state.divisi === 'analisa' && state.tabAtab){
      setTimeout(()=>{
        const tabEl = document.querySelector(`[data-atab="${state.tabAtab}"]`);
        if(tabEl && typeof switchTab === 'function') switchTab(state.tabAtab, tabEl);
      }, 400);
    }
    // 5. Restore selected perumahan
    if(state.selectedPerumahan && typeof selectPerumahan === 'function'){
      setTimeout(()=>{
        try { selectPerumahan(state.selectedPerumahan); } catch(e){}
      }, 500);
    }
    // 6. Restore modal Detail Lengkap kalau lagi terbuka
    if(state.pdlOpen && state.pdlPerumId && typeof openPdlModal === 'function'){
      setTimeout(()=>{
        try { openPdlModal(state.pdlPerumId); } catch(e){}
      }, 700);
    }
    return true;
  } catch(e){
    console.warn('restoreAppState failed:', e);
    return false;
  }
}
const USE_SHEETS = true;
// [v9 SECURITY] Master password TIDAK hardcoded lagi.
// Kalau belum diset, fungsi return null → login lewat master password diblokir,
// user harus login via akun biasa. Master pw di-set via panel khusus (Settings → BM only).
function getMasterPassword(){
  const v = localStorage.getItem('bm4_master_pw');
  return (v && v.length >= 8) ? v : null;
}
function setMasterPassword(pw){
  if(!pw || pw.length < 8) return false;
  try { localStorage.setItem('bm4_master_pw', pw); return true; }
  catch(e){ return false; }
}
const SESSION_KEY = 'bm4_auth';

// ============================================================
// PROYEK DATA — [v14 PROYEK] Dinamis, bisa di-CRUD via UI (BM only)
// ============================================================
const PROYEK_KEY = 'bm4_proyek';
// Default proyek (seed saat pertama run, lalu tersimpan di localStorage)
const PROYEK_DEFAULT = [
  { id:'gwc', nama:'Griya Wijaya Cibogo', kode:'GWC', area:'Cibogo, Subang', tipe:'Mix-use', unit:1000, lat:-6.5578890, lng:107.8131269, developer:'', ikon:'🏘️', warna:'#3B82F6', status:'Aktif', deskripsi:'', foto:'' },
  { id:'dpr', nama:'Dirgantara Parahyangan Residence', kode:'DPR', area:'Subang', tipe:'Subsidi', unit:0, lat:-6.5700000, lng:107.7800000, developer:'', ikon:'🏡', warna:'#10B981', status:'Aktif', deskripsi:'', foto:'' }
];
let PROYEK_LIST = [];
let currentProyek = null;

// Helper akses proyek — replace pattern lama `PROYEK[id]`
function getProyek(id){
  if(!id) return null;
  return PROYEK_LIST.find(p => p.id === id) || null;
}
function loadProyek(){
  try{
    const saved = localStorage.getItem(PROYEK_KEY);
    if(saved){
      PROYEK_LIST = JSON.parse(saved);
      // Pastikan default (gwc, dpr) tetap ada kalau user hapus semua (safety)
      if(!Array.isArray(PROYEK_LIST) || PROYEK_LIST.length === 0){
        PROYEK_LIST = JSON.parse(JSON.stringify(PROYEK_DEFAULT));
        saveProyekLocal();
      }
    } else {
      PROYEK_LIST = JSON.parse(JSON.stringify(PROYEK_DEFAULT));
      saveProyekLocal();
    }
  } catch(e){
    console.warn('loadProyek error', e);
    PROYEK_LIST = JSON.parse(JSON.stringify(PROYEK_DEFAULT));
  }
}
function saveProyekLocal(){
  try{ localStorage.setItem(PROYEK_KEY, JSON.stringify(PROYEK_LIST)); }catch(e){}
}
// Compatibility shim: kode lama `PROYEK[id]` tetap jalan (read-only access)
// Setelah Panel #3 stabil, semua pemanggil akan diganti ke getProyek().
const PROYEK = new Proxy({}, {
  get(_, id){ return getProyek(id); },
  has(_, id){ return !!getProyek(id); }
});

// ════════════════════════════════════════════════════════
// [v11+] FORMAT TANGGAL INDONESIA
// ════════════════════════════════════════════════════════
const BULAN_ID=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const BULAN_ID_SHORT=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
function formatTanggalID(input, style){
  if(!input||input==='-')return '—';
  const d=new Date(input);
  if(isNaN(d.getTime()))return String(input);
  if(style==='short')return `${d.getDate()} ${BULAN_ID_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  return `${d.getDate()} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
}
function todayISO_ID(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ════════════════════════════════════════════════════════
// [v11+] FORMULA POTENSI UNIT — dapat diubah BM
// ════════════════════════════════════════════════════════
const POTENSI_KEY='bm4_potensi_formula';
let POTENSI_PCT=15;
(function loadPotensi(){
  try{const s=localStorage.getItem(POTENSI_KEY);if(s){const n=parseFloat(s);if(!isNaN(n)&&n>0&&n<=100)POTENSI_PCT=n;}}catch(e){}
})();
function calcPotensiUnit(karyawan){return Math.round(((karyawan||0)*POTENSI_PCT)/100);}
function savePotensiFormula(pct){POTENSI_PCT=pct;try{localStorage.setItem(POTENSI_KEY,String(pct));}catch(e){}}

// ════════════════════════════════════════════════════════
// [v11+] ROUTING — jarak via jalan (multi-endpoint fallback)
// [TAHAP 2] Cache persistent ke localStorage, TTL 30 hari
// ════════════════════════════════════════════════════════
const ROUTE_CACHE_KEY = 'bm4_route_cache_v1';
const ROUTE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari
const ROUTE_HAVERSINE_FACTOR = 1.35; // koreksi haversine → estimasi via jalan

let routeCache = (function loadRouteCache(){
  try {
    const raw = localStorage.getItem(ROUTE_CACHE_KEY);
    if(!raw) return {};
    const data = JSON.parse(raw);
    const now = Date.now();
    const out = {};
    let expired = 0;
    for(const k in data){
      const e = data[k];
      if(e && e._t && (now - e._t) < ROUTE_CACHE_TTL_MS && e.viaRoad){
        out[k] = e; // hanya keep entri yang viaRoad=true (jangan cache estimasi)
      } else {
        expired++;
      }
    }
    if(expired > 0) console.log('[route-cache] '+expired+' entri kadaluarsa dibuang');
    return out;
  } catch(e){
    console.warn('[route-cache] load gagal:', e);
    return {};
  }
})();

let _routeCacheSaveTimer = null;
function saveRouteCache(){
  // Debounce 500ms supaya batch upgrade nggak ngehit localStorage berulang
  clearTimeout(_routeCacheSaveTimer);
  _routeCacheSaveTimer = setTimeout(()=>{
    try {
      const out = {};
      for(const k in routeCache){
        const e = routeCache[k];
        if(e && e.viaRoad) out[k] = {...e, _t: e._t || Date.now()};
      }
      localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(out));
    } catch(e){
      console.warn('[route-cache] save gagal:', e);
      // localStorage penuh — clear cache lama dan retry
      try { localStorage.removeItem(ROUTE_CACHE_KEY); } catch(_){}
    }
  }, 500);
}

function clearRouteCache(){
  routeCache = {};
  try { localStorage.removeItem(ROUTE_CACHE_KEY); } catch(_){}
  console.log('[route-cache] dibersihkan');
}

// Daftar endpoint OSRM — dicoba satu per satu jika gagal
const OSRM_ENDPOINTS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car',
];

async function _fetchOSRM(baseUrl, lng1, lat1, lng2, lat2){
  const url = `${baseUrl}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if(data.code === 'Ok' && data.routes && data.routes.length > 0){
      return data.routes[0];
    }
    throw new Error('No routes in response');
  } catch(e) {
    clearTimeout(tid);
    throw e;
  }
}

async function getRouteDistance(lat1, lng1, lat2, lng2){
  const key = `${lat1.toFixed(5)},${lng1.toFixed(5)}_${lat2.toFixed(5)},${lng2.toFixed(5)}`;
  if(routeCache[key]) return routeCache[key];

  // Coba setiap endpoint satu per satu
  for(const endpoint of OSRM_ENDPOINTS){
    try {
      const route = await _fetchOSRM(endpoint, lng1, lat1, lng2, lat2);
      const out = {
        km: route.distance / 1000,
        menit: Math.round(route.duration / 60),
        coords: route.geometry.coordinates.map(c => [c[1], c[0]]),
        viaRoad: true,
        _t: Date.now()
      };
      routeCache[key] = out;
      saveRouteCache(); // [TAHAP 2] persist ke localStorage
      return out;
    } catch(e) {
      console.warn(`OSRM endpoint gagal (${endpoint}):`, e.message);
    }
  }

  // Semua endpoint gagal — fallback ke jarak lurus (haversine)
  const km = haversine(lat1, lng1, lat2, lng2);
  // Estimasi via jalan = lurus × 1.35 (faktor koreksi umum Indonesia)
  const kmEst = +(km * 1.35).toFixed(1);
  const result = { km: kmEst, menit: Math.round(kmEst / 40 * 60), coords: [[lat1,lng1],[lat2,lng2]], viaRoad: false, isEstimate: true };
  // Cache singkat (5 menit) supaya bisa retry nanti
  routeCache[key] = result;
  setTimeout(() => { delete routeCache[key]; }, 5 * 60 * 1000);
  return result;
}

// ════════════════════════════════════════════════════════
// [TAHAP 2] LAZY ROAD UPGRADE — hitung jarak via jalan
// ════════════════════════════════════════════════════════
// Status per perumahan: undefined (belum) | 'pending' | 'done' | 'partial'
// Strategi: shortlist 3 terdekat per kategori (haversine), lalu OSRM hanya
// untuk shortlist itu — supaya tidak boros request.

const _roadUpgradeInProgress = new Set();

async function upgradeKompetitorToRoad(p, opts){
  if(!p) return;
  opts = opts || {};
  const force = opts.force === true;
  if(!force && p._distMode === 'jalan') return; // sudah di-upgrade
  if(_roadUpgradeInProgress.has(p.id)) return;
  _roadUpgradeInProgress.add(p.id);
  p._distMode = 'mengukur';
  _updateDistModeBadge(p);

  try {
    // 1) Build shortlist top-3 POI per kategori berdasarkan haversine
    const byKat = {};
    poi.forEach(x => {
      const d = haversine(p.lat, p.lng, x.lat, x.lng);
      (byKat[x.kat] = byKat[x.kat] || []).push({...x, _hav: d});
    });
    const shortlist = [];
    for(const k in byKat){
      byKat[k].sort((a,b)=>a._hav - b._hav);
      shortlist.push(...byKat[k].slice(0, 3));
    }

    // 2) Panggil OSRM paralel (max 6 sekaligus) untuk shortlist
    const results = await _runBatchedRoute(p, shortlist, 6);

    // 3) Simpan hasil per kategori — nearest by ROAD distance
    const roadByKat = {};
    results.forEach(r => {
      if(!r) return;
      const cur = roadByKat[r.kat];
      if(!cur || r.km < cur.dist){
        roadByKat[r.kat] = {...r, dist: r.km, viaRoad: r.viaRoad, menit: r.menit};
      }
    });
    p._roadNearest = roadByKat;

    // 4) Upgrade jarak antar perumahan (top 6 terdekat) — lazy juga
    const otherPerum = perumahan.filter(x => x.id !== p.id)
      .map(x => ({...x, _hav: haversine(p.lat, p.lng, x.lat, x.lng)}))
      .sort((a,b)=>a._hav - b._hav).slice(0, 6);
    const perumResults = await _runBatchedRoute(p, otherPerum, 6);
    p._roadPerum = {};
    perumResults.forEach(r => { if(r) p._roadPerum[r.id] = {km: r.km, menit: r.menit, viaRoad: r.viaRoad}; });

    // 5) Re-calc skor pakai road distance
    _recalcScoreWithRoad(p);

    // 6) Cek apakah ada hasil yang viaRoad=false (semua estimasi → tetap badge perkiraan)
    const allRoad = results.every(r => r && r.viaRoad);
    p._distMode = allRoad ? 'jalan' : 'partial';

    // 7) Re-render detail kalau perumahan ini yang lagi dipilih
    if(typeof selectedId !== 'undefined' && selectedId === p.id){
      renderDetailOverview(p);
      renderDetailFasilitas(p);
      renderDetailCompare(p);
      renderDetailRadar(p);
      renderDetailNearby(p);
    }
    // Update badge & ranking
    _updateDistModeBadge(p);
    if(typeof buildRanking === 'function'){
      const cat = document.getElementById('rank-cat-select')?.value;
      if(cat) buildRanking(cat);
    }
  } catch(e){
    console.warn('[road-upgrade] gagal:', e);
    p._distMode = 'lurus';
    _updateDistModeBadge(p);
  } finally {
    _roadUpgradeInProgress.delete(p.id);
  }
}

// Helper: jalankan getRouteDistance untuk array target dgn concurrency limit
async function _runBatchedRoute(p, targets, concurrency){
  const out = new Array(targets.length);
  let idx = 0;
  async function worker(){
    while(idx < targets.length){
      const i = idx++;
      const t = targets[i];
      try {
        const r = await getRouteDistance(p.lat, p.lng, t.lat, t.lng);
        out[i] = {...t, km: r.km, menit: r.menit, viaRoad: r.viaRoad};
      } catch(e){
        out[i] = null;
      }
    }
  }
  const workers = [];
  for(let i=0; i<Math.min(concurrency, targets.length); i++) workers.push(worker());
  await Promise.all(workers);
  return out.filter(Boolean);
}

// Re-hitung skor full pakai road distance jika tersedia
function _recalcScoreWithRoad(p){
  if(!p._roadNearest) return;
  const r = calcScoreFullWithRoad(p);
  p.score = r.overall;
  p._scoreDetail = r;
}

// Versi calcScoreFull yang pakai road distance untuk POI yang sudah di-upgrade
// [FIX #6] calcScoreFull sekarang sudah self-aware (baca _roadNearest otomatis),
// jadi ini cukup jadi alias untuk backward compat.
function calcScoreFullWithRoad(p){ return calcScoreFull(p); }

// Update badge mode jarak di header detail overview
function _updateDistModeBadge(p){
  const el = document.getElementById('dist-mode-badge');
  if(!el || !p) return;
  const m = p._distMode;
  if(m === 'mengukur'){
    el.style.display = 'inline-flex';
    el.style.background = '#FEF3C7';
    el.style.color = '#92400E';
    el.innerHTML = '⏳ Mengukur via jalan...';
  } else if(m === 'jalan'){
    el.style.display = 'inline-flex';
    el.style.background = '#DCFCE7';
    el.style.color = '#15803D';
    el.innerHTML = '🛣 Jarak via jalan';
  } else if(m === 'partial'){
    el.style.display = 'inline-flex';
    el.style.background = '#FEF3C7';
    el.style.color = '#92400E';
    el.innerHTML = '🛣 Sebagian via jalan';
  } else {
    el.style.display = 'inline-flex';
    el.style.background = '#F1F5F9';
    el.style.color = '#475569';
    el.innerHTML = '📏 Jarak perkiraan';
  }
}
