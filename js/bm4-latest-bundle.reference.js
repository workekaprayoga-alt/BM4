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
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyPm0hR8SqqI572qjkaZ97PERPocBcE7ydhRcjoY_hve1qI6PItWMJeZ94kwG_q_gHpaw/exec';
// [v11 SECURITY] Token untuk auth ke Apps Script. Harus sama dengan Script Properties API_TOKEN.
const API_TOKEN = 'U5LHXBVqxurjRCl789XSDFml5KyD7fpo';
// Helper: bangun URL GET dengan token otomatis
function gasGet(action, extraParams){
  let url = GAS_URL + '?action=' + encodeURIComponent(action) + '&token=' + encodeURIComponent(API_TOKEN);
  if(extraParams && typeof extraParams === 'object'){
    Object.keys(extraParams).forEach(k => {
      url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(extraParams[k]);
    });
  }
  return url;
}
// Helper: bangun body POST dengan token otomatis (merge dengan body existing)
function gasPost(bodyObj){
  return JSON.stringify(Object.assign({}, bodyObj || {}, { token: API_TOKEN }));
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


// ============================================================
// KOMPETITOR & POI DATA
// ============================================================
let perumahan=[
  {id:1,nama:"GRIYA WIJAYA CIBOGO",lat:-6.5578890,lng:107.8131269,tipe:"mix",realisasi:0,unit:1000,tahun:2023,developer:"PT WIJAYA INTAN NURYAKSA",area:"Cibogo"},
  {id:2,nama:"GRIYA PUTRA RESIDENCE",lat:-6.5800351,lng:107.7797321,tipe:"subsidi",realisasi:100,unit:120,tahun:2024,developer:"PT BUMI CAHAYA PUTRA",area:"Subang Kota"},
  {id:3,nama:"GRAHA VILLAGE PURWADADI",lat:-6.4715672,lng:107.664008,tipe:"mix",realisasi:200,unit:80,tahun:2024,developer:"PT CIPTA WARNA PROPERTINDO",area:"Purwadadi"},
  {id:4,nama:"KALIS RESIDENCE 2",lat:-6.5190817,lng:107.7829784,tipe:"subsidi",realisasi:300,unit:80,tahun:2024,developer:"PT BUKIT JAYA PROPERTI",area:"Pagaden"},
  {id:5,nama:"PRIMA TALAGA SUNDA",lat:-6.5627312,lng:107.7384974,tipe:"mix",realisasi:70,unit:80,tahun:2024,developer:"PT KOPRIMA SANDYSEJAHTERA",area:"Subang Kota"},
  {id:6,nama:"BUMI GEMILANG ASRI 2",lat:-6.5235201,lng:107.6789249,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT MUGI MUKTI MUGHNI",area:"Kalijati"},
  {id:7,nama:"GRAND SUBANG RESIDENCE",lat:-6.5412470,lng:107.7941358,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT CENTRAL VIRGINIA DEVELOPMENT",area:"Cibogo"},
  {id:8,nama:"HARVA GRAND CITY",lat:-6.5301219,lng:107.7758048,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT HARVA JAYA MANDIRI",area:"Subang Kota"},
  {id:9,nama:"STAVIA RESIDENCE",lat:-6.5791547,lng:107.7514259,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT WAHANA ADIDAYA BANGUN",area:"Subang Kota"},
  {id:10,nama:"BUANA SUBANG RAYA 2",lat:-6.5231573,lng:107.773106,tipe:"mix",realisasi:70,unit:80,tahun:2024,developer:"PT CIKAL BUANA PERSADA",area:"Subang Kota"},
  {id:11,nama:"THE GREEN PAGADEN",lat:-6.4504546,lng:107.7882484,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT PERMATA TRI MANDIRI",area:"Pagaden"},
  {id:12,nama:"GRIYA INSUN MEDAL",lat:-6.5324273,lng:107.7641417,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT ARTHA LAND PROPERTINDO",area:"Subang Kota"},
  {id:13,nama:"NUANSA SALAM JAYA",lat:-6.4257767,lng:107.5756779,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT FAQIH PROPERTY MANDIRI",area:"Pabuaran"},
  {id:14,nama:"KALIS RESIDENCE TAHAP 2",lat:-6.5190817,lng:107.7829784,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT MITRA BORNEO PROPERTI",area:"Pagaden"},
  {id:15,nama:"KAMPOENG HIJAU",lat:-6.5203685,lng:107.678239,tipe:"subsidi",realisasi:70,unit:80,tahun:2023,developer:"PT ROMAN MULTI PROPERTIES",area:"Kalijati"},
  {id:16,nama:"MAHKOTA GRAHA",lat:-6.5714464,lng:107.7748076,tipe:"subsidi",realisasi:70,unit:80,tahun:2020,developer:"PT LIDER BAHTERA TOOLSINDO",area:"Subang Kota"},
  {id:17,nama:"SUBANG GREEN CITY",lat:-6.5539431,lng:107.8029213,tipe:"mix",realisasi:70,unit:80,tahun:2017,developer:"PT GRAHAPRIMA SUKSESUTAMA",area:"Cibogo"},
];
const poi=[
  {nama:"RSUD Subang",lat:-6.557257,lng:107.747284,kat:"rs",label:"RS",emoji:"🏥"},
  {nama:"RS Mitra Plumbon",lat:-6.543243,lng:107.779872,kat:"rs",label:"RS",emoji:"🏥"},
  {nama:"RS HAMORI Pagaden",lat:-6.527665,lng:107.791289,kat:"rs",label:"RS",emoji:"🏥"},
  {nama:"RS PTPN VIII Subang",lat:-6.568158,lng:107.762698,kat:"rs",label:"RS",emoji:"🏥"},
  {nama:"Klinik Hasna Medika",lat:-6.559860,lng:107.777137,kat:"rs",label:"RS",emoji:"🏥"},
  {nama:"Universitas Subang",lat:-6.577598,lng:107.782929,kat:"kampus",label:"U",emoji:"🎓"},
  {nama:"Politeknik Negeri Subang (Cibogo)",lat:-6.553000,lng:107.810000,kat:"kampus",label:"U",emoji:"🎓"},
  {nama:"Politeknik Negeri Subang (Ciereng)",lat:-6.570000,lng:107.768000,kat:"kampus",label:"U",emoji:"🎓"},
  {nama:"Yogya Grand Subang",lat:-6.563381,lng:107.766748,kat:"mall",label:"M",emoji:"🏬"},
  {nama:"Pasar Pujasera Subang",lat:-6.569098,lng:107.759447,kat:"mall",label:"M",emoji:"🏬"},
  {nama:"Exit Tol Subang",lat:-6.531840,lng:107.783652,kat:"tol",label:"T",emoji:"🛣️"},
  {nama:"Exit Tol Kalijati",lat:-6.509211,lng:107.678693,kat:"tol",label:"T",emoji:"🛣️"},
  {nama:"Stasiun Pagadenbaru",lat:-6.487000,lng:107.792000,kat:"tol",label:"S",emoji:"🚆"},
  {nama:"Kantor Bupati Subang",lat:-6.571548,lng:107.762397,kat:"pemda",label:"G",emoji:"🏛️"},
  {nama:"Komplek Perkantoran Kab. Subang",lat:-6.572743,lng:107.762607,kat:"pemda",label:"G",emoji:"🏛️"},
  {nama:"Taifa Industrial Estate",lat:-6.516994,lng:107.801795,kat:"industri",label:"I",emoji:"💼"},
  {nama:"Subang Smartpolitan",lat:-6.480000,lng:107.620000,kat:"industri",label:"I",emoji:"💼"},
  {nama:"Kawasan Industri Cibogo",lat:-6.538337,lng:107.834849,kat:"industri",label:"I",emoji:"💼"},
  {nama:"Alun-Alun Kabupaten Subang",lat:-6.569800,lng:107.759800,kat:"publik",label:"P",emoji:"🌳"},
  {nama:"Lapang Bintang Kota Subang",lat:-6.562000,lng:107.763000,kat:"publik",label:"P",emoji:"🌳"},
  {nama:"Stadion Persikas",lat:-6.558000,lng:107.755000,kat:"publik",label:"P",emoji:"⚽"},
];
const KAT_COLOR={rs:"#DC2626",kampus:"#059669",mall:"#7C3AED",tol:"#475569",pemda:"#1D4ED8",industri:"#92400E",publik:"#0891B2"};
const KAT_LABEL={rs:"RS/Klinik",kampus:"Kampus",mall:"Mall/Belanja",tol:"Transportasi",pemda:"Pemerintah",industri:"Industri",publik:"Ruang Publik"};
const TIPE_COLOR={subsidi:"#65A30D",mix:"#B45309"};
const TIPE_BG={subsidi:"#ECFCCB",mix:"#FEF3C7"};
const TIPE_LABEL={subsidi:"Subsidi",mix:"Mix-use"};
const ANCHOR_ID=1;

// ============================================================
// [P0 TAPERA] Data Tapera — field tambahan per perumahan + konteks pasar kabupaten
// ============================================================
// Struktur tapera per perumahan (opsional, backward compat via optional chain):
// {lastSynced, totalRealisasi, nominalFLPP, realisasiBulanan:[{bulan,unit}],
//  hargaRange, luasTanah, luasBangunan, tenorDominan, uangMukaRange, bankDominan,
//  profilPembeli:{pekerjaan,usia,penghasilan,gender}}

let MARKET_CONTEXT = {
  lastSynced: '2026-04-23',
  kabupaten: 'SUBANG',
  totalPerumahanTerdaftar: 132,
  totalUnit: 26647,
  totalTerjual: 17513,
  totalKavling: 8665,
  totalReadyStock: 295,
  totalDibooking: 157,
  totalPembangunan: 17,
  pctSubsidi: 91.86,
  pctKomersil: 8.14
};
function loadMarketContext(){
  try{ const s=localStorage.getItem('bm4_market_ctx'); if(s) MARKET_CONTEXT={...MARKET_CONTEXT, ...JSON.parse(s)}; }catch(_){}
}
function saveMarketContext(){
  try{ localStorage.setItem('bm4_market_ctx', JSON.stringify(MARKET_CONTEXT)); }catch(_){}
}
loadMarketContext();

// Helper: generate realisasi bulanan dummy untuk seed (24 bulan 2024-01 → 2025-12)
function _genBulananDummy(total, peak){
  const months=[];
  for(let y=2024;y<=2025;y++) for(let m=1;m<=12;m++) months.push(`${y}-${String(m).padStart(2,'0')}`);
  // distribusi: awal sedikit, naik ke puncak, lalu turun
  const curve=months.map((_,i)=>{
    const x=(i-12)/6; return Math.max(0, Math.round(peak*Math.exp(-x*x)));
  });
  const sum=curve.reduce((a,b)=>a+b,0);
  const scale=total/sum;
  return months.map((bulan,i)=>({bulan, unit:Math.round(curve[i]*scale)}));
}
// Seed dummy ke 3 perumahan contoh — pakai struktur realistis dari PDF Tapera
(function seedTaperaDummy(){
  const dummies = {
    2: { // GRIYA PUTRA RESIDENCE (mirip TOP PUTRA)
      totalRealisasi: 100, nominalFLPP: 12.8, peak: 12,
      harga: '150-175 Jt', lt:'60-90 m²', lb:'26-31 m²',
      tenor:'15-20 Tahun', um:'2-3%', bank:'BTN',
      profil: { pekerjaan:{swasta:85, wiraswasta:10, other:5}, usia:{'19-25':42,'26-30':28,'31-35':16,'36-40':9,'40+':5}, penghasilan:{'3-4Jt':30,'4-5Jt':40,'5-6Jt':18,'6-8Jt':8,other:4}, gender:{L:58, P:42} }
    },
    5: { // PRIMA TALAGA SUNDA
      totalRealisasi: 70, nominalFLPP: 8.9, peak: 8,
      harga: '150-175 Jt', lt:'60-90 m²', lb:'26-31 m²',
      tenor:'10-15 Tahun', um:'UM ≤ 1%', bank:'BTN',
      profil: { pekerjaan:{swasta:78, wiraswasta:15, other:7}, usia:{'19-25':38,'26-30':32,'31-35':18,'36-40':8,'40+':4}, penghasilan:{'3-4Jt':42,'4-5Jt':32,'5-6Jt':16,'6-8Jt':7,other:3}, gender:{L:62, P:38} }
    },
    6: { // BUMI GEMILANG ASRI 2
      totalRealisasi: 70, nominalFLPP: 9.1, peak: 7,
      harga: '150-175 Jt', lt:'60-90 m²', lb:'26-31 m²',
      tenor:'15-20 Tahun', um:'2-3%', bank:'BTN',
      profil: { pekerjaan:{swasta:82, wiraswasta:12, other:6}, usia:{'19-25':35,'26-30':30,'31-35':20,'36-40':10,'40+':5}, penghasilan:{'3-4Jt':28,'4-5Jt':38,'5-6Jt':20,'6-8Jt':10,other:4}, gender:{L:55, P:45} }
    }
  };
  Object.entries(dummies).forEach(([id,d])=>{
    const p = perumahan.find(x=>x.id===parseInt(id));
    if(!p) return;
    p.tapera = {
      lastSynced: '2026-04-23',
      totalRealisasi: d.totalRealisasi,
      nominalFLPP: d.nominalFLPP,
      realisasiBulanan: _genBulananDummy(d.totalRealisasi, d.peak),
      hargaRange: d.harga, luasTanah: d.lt, luasBangunan: d.lb,
      tenorDominan: d.tenor, uangMukaRange: d.um, bankDominan: d.bank,
      profilPembeli: d.profil,
      _dummy: true
    };
  });
})();

// [v17 fix] Seed dummy Tapera ke SEMUA perumahan lain yang belum punya data.
// Tujuannya supaya user bisa lihat tampilan tabel banding dengan data di semua kolom.
// Tandai _dummyAuto:true supaya bisa dibedakan dari seed asli (_dummy:true) dan data user (tanpa flag).
(function seedTaperaDummyAll(){
  // Pseudo-random deterministic berdasarkan seed (id) supaya nilai reproducible per reload
  function rng(seed){ let x = seed * 9301 + 49297; return ()=>{ x = (x*9301 + 49297) % 233280; return x/233280; }; }
  const hargaOpts = ['140-160 Jt','150-175 Jt','155-170 Jt','160-180 Jt','165-185 Jt','170-190 Jt'];
  const ltOpts = ['54-72 m²','60-84 m²','60-90 m²','66-96 m²','72-100 m²'];
  const lbOpts = ['24-28 m²','26-31 m²','27-33 m²','30-36 m²','32-40 m²'];
  const tenorOpts = ['10-15 Tahun','15-20 Tahun','15-20 Tahun','20 Tahun','20-25 Tahun'];
  const umOpts = ['UM ≤ 1%','1-2%','2-3%','2-3%','3-5%'];
  const bankOpts = ['BTN','BTN','BTN Syariah','BRI','BNI'];

  perumahan.forEach(p=>{
    if(p.tapera) return; // skip yang sudah ada (id 2, 5, 6 dari seed asli)
    const r = rng(p.id || 1);
    // Total realisasi skala dari p.realisasi; clamp 20-300
    const totalReal = Math.max(20, Math.min(300, Math.round((p.realisasi||60) * (0.8 + r()*0.5))));
    const peak = Math.max(4, Math.round(totalReal / 8 + r()*6));
    const nominalFLPP = +(totalReal * (0.12 + r()*0.03)).toFixed(1); // ~12-15% dari total realisasi
    // Profil pembeli: generate persen dengan variasi
    const swastaPct = 60 + Math.round(r()*30);
    const wiraPct = Math.round((100-swastaPct) * (0.5 + r()*0.3));
    const otherPct = 100 - swastaPct - wiraPct;
    const g_L = 45 + Math.round(r()*25);
    p.tapera = {
      lastSynced: '2026-04-23',
      totalRealisasi: totalReal,
      nominalFLPP: nominalFLPP,
      realisasiBulanan: _genBulananDummy(totalReal, peak),
      hargaRange: hargaOpts[Math.floor(r()*hargaOpts.length)],
      luasTanah: ltOpts[Math.floor(r()*ltOpts.length)],
      luasBangunan: lbOpts[Math.floor(r()*lbOpts.length)],
      tenorDominan: tenorOpts[Math.floor(r()*tenorOpts.length)],
      uangMukaRange: umOpts[Math.floor(r()*umOpts.length)],
      bankDominan: bankOpts[Math.floor(r()*bankOpts.length)],
      profilPembeli: {
        pekerjaan: {swasta: swastaPct, wiraswasta: wiraPct, other: otherPct},
        usia: {
          '19-25': 30 + Math.round(r()*15),
          '26-30': 25 + Math.round(r()*10),
          '31-35': 15 + Math.round(r()*10),
          '36-40': 8 + Math.round(r()*6),
          '40+': 4 + Math.round(r()*4)
        },
        penghasilan: {
          '3-4Jt': 25 + Math.round(r()*15),
          '4-5Jt': 30 + Math.round(r()*15),
          '5-6Jt': 15 + Math.round(r()*8),
          '6-8Jt': 6 + Math.round(r()*6),
          'other': 3 + Math.round(r()*4)
        },
        gender: {L: g_L, P: 100 - g_L}
      },
      _dummyAuto: true // flag untuk bedakan dari seed asli
    };
  });
})();


// ============================================================
// TARGET PASAR DATA
// ============================================================
const STATUS_STEPS=[{label:'Identifikasi',icon:'🔍'},{label:'Kontak Awal',icon:'📞'},{label:'Presentasi',icon:'🤝'},{label:'Negosiasi',icon:'💬'},{label:'Deal',icon:'✅'}];
const STATUS_COLOR=['#94A3B8','#2563EB','#7C3AED','#D97706','#15803D'];
let tpTargets=JSON.parse(localStorage.getItem('bm4_tp_targets')||'null')||[
  {id:1,nama:'PT Taifa Industrial Estate',jenis:'kawasan',lat:-6.516994,lng:107.801795,karyawan:5000,pic:'Bagian Marketing - 0811-xxxx',lastcontact:'2026-04-01',status:1,catatan:'Sudah kenalan dengan security, perlu cari kontak HRD.'},
  {id:2,nama:'PT Subang Smartpolitan',jenis:'kawasan',lat:-6.480000,lng:107.620000,karyawan:8000,pic:'Belum ada',lastcontact:'-',status:0,catatan:'Kawasan industri besar, estimasi ribuan karyawan.'},
  {id:3,nama:'PT Kahatex Subang',jenis:'pabrik',lat:-6.525000,lng:107.782000,karyawan:2000,pic:'Bu Sari HRD - 0812-xxxx',lastcontact:'2026-04-10',status:2,catatan:'Sudah presentasi ke HRD, mereka tertarik program KPR subsidi.'},
  {id:4,nama:'PT Indofood CBP Subang',jenis:'pabrik',lat:-6.558000,lng:107.810000,karyawan:1500,pic:'Pak Budi - 0813-xxxx',lastcontact:'2026-03-20',status:1,catatan:'Sudah hubungi, jadwal meeting masih koordinasi.'},
  {id:5,nama:'PT Len Industri',jenis:'perusahaan',lat:-6.572000,lng:107.763000,karyawan:800,pic:'Belum ada',lastcontact:'-',status:0,catatan:'BUMN elektronik, karyawan banyak di area Subang kota.'},
  {id:6,nama:'PT Perkebunan PTPN VIII',jenis:'perusahaan',lat:-6.568000,lng:107.762000,karyawan:600,pic:'Pak Hendra - 0814-xxxx',lastcontact:'2026-04-15',status:3,catatan:'Negosiasi harga, mereka minta diskon kolektif untuk 20 unit.'},
  {id:7,nama:'PT Kawasan Industri Cibogo',jenis:'kawasan',lat:-6.538337,lng:107.834849,karyawan:3000,pic:'Belum ada',lastcontact:'-',status:0,catatan:'Dekat dengan proyek kita, prioritas untuk didekati.'},
  {id:8,nama:'PT Kimia Farma Subang',jenis:'pabrik',lat:-6.545000,lng:107.775000,karyawan:400,pic:'Bu Wati HR - 0815-xxxx',lastcontact:'2026-04-05',status:2,catatan:'Sudah presentasi, menunggu approval manajemen.'},
];
let tpMap=null,tpMapInit=false,tpMarkers={},selectedTpId=null,tpFilter='semua',editingTpId=-1;

// ============================================================
// SCORING ENGINE
// ============================================================
let FORMULA={wAksesibilitas:50,wFasilitas:30,wFisik:20,wTol:40,wCBD:40,wTransport:20,wRS:30,wKampus:20,wMall:20,wPemda:10,wIndustri:10,wPublik:10,decayAks:8,decayFas:6};
function haversine(la1,ln1,la2,ln2){const R=6371,dL=(la2-la1)*Math.PI/180,dN=(ln2-ln1)*Math.PI/180,a=Math.sin(dL/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dN/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function travelMin(km){return Math.round(km/40*60);}
function fmt(n){return n.toLocaleString('id');}
function distToScore(km,decay){return Math.max(0,Math.round(100-(km*decay)));}
function nearestByKat(p){const res={};poi.forEach(x=>{const d=haversine(p.lat,p.lng,x.lat,x.lng);if(!res[x.kat]||d<res[x.kat].dist)res[x.kat]={...x,dist:d};});return res;}
function calcScoreFull(p){
  // [FIX #6] Gunakan road distance kalau sudah di-upgrade (via Tahap 2),
  // else haversine × ROUTE_HAVERSINE_FACTOR supaya skor konsisten dengan angka via jalan.
  const nbHav = nearestByKat(p);
  const nbRoad = p._roadNearest || {};
  const hasRoad = Object.keys(nbRoad).length > 0;
  const factor = hasRoad ? 1 : ROUTE_HAVERSINE_FACTOR; // road sudah pakai jarak riil; haversine butuh koreksi
  const getDist = (kat, fallback=20) => {
    if(nbRoad[kat]) return nbRoad[kat].dist;
    if(nbHav[kat]) return nbHav[kat].dist * ROUTE_HAVERSINE_FACTOR;
    return fallback;
  };
  const tolPOI=poi.filter(x=>x.kat==='tol'&&x.nama.includes('Exit'));
  const cbdPOI=poi.filter(x=>x.kat==='pemda');
  const trPOI=poi.filter(x=>x.kat==='tol'&&!x.nama.includes('Exit'));
  const distTol = nbRoad.tol ? nbRoad.tol.dist : (tolPOI.length?Math.min(...tolPOI.map(x=>haversine(p.lat,p.lng,x.lat,x.lng)))*ROUTE_HAVERSINE_FACTOR:15);
  const distCBD = nbRoad.pemda ? nbRoad.pemda.dist : (cbdPOI.length?Math.min(...cbdPOI.map(x=>haversine(p.lat,p.lng,x.lat,x.lng)))*ROUTE_HAVERSINE_FACTOR:15);
  const distTr  = trPOI.length?Math.min(...trPOI.map(x=>haversine(p.lat,p.lng,x.lat,x.lng)))*ROUTE_HAVERSINE_FACTOR:15;
  const scoreAks=Math.round((distToScore(distTol,FORMULA.decayAks)*FORMULA.wTol/100)+(distToScore(distCBD,FORMULA.decayAks)*FORMULA.wCBD/100)+(distToScore(distTr,FORMULA.decayFas)*FORMULA.wTransport/100));
  const dRS=getDist('rs'), dK=getDist('kampus'), dM=getDist('mall');
  const dP=getDist('pemda'), dI=getDist('industri'), dPu=getDist('publik');
  const scoreFas=Math.round((distToScore(dRS,FORMULA.decayFas)*FORMULA.wRS/100)+(distToScore(dK,FORMULA.decayFas)*FORMULA.wKampus/100)+(distToScore(dM,FORMULA.decayFas)*FORMULA.wMall/100)+(distToScore(dP,FORMULA.decayFas)*FORMULA.wPemda/100)+(distToScore(dI,FORMULA.decayFas)*FORMULA.wIndustri/100)+(distToScore(dPu,FORMULA.decayFas)*FORMULA.wPublik/100));
  const allDists=[dRS,dK,dM,dI,dPu].filter(d=>d<20);
  const avgDist=allDists.length?allDists.reduce((a,b)=>a+b,0)/allDists.length:15;
  const scoreFisik=Math.min(100,Math.round(distToScore(avgDist,3)*0.85+15));
  const overall=Math.round((scoreAks*FORMULA.wAksesibilitas/100)+(scoreFas*FORMULA.wFasilitas/100)+(scoreFisik*FORMULA.wFisik/100));
  return{overall,aksesibilitas:scoreAks,fasilitas:scoreFas,fisik:scoreFisik,_usedRoad:hasRoad,detail:{tol:{dist:distTol.toFixed(1),score:distToScore(distTol,FORMULA.decayAks)},cbd:{dist:distCBD.toFixed(1),score:distToScore(distCBD,FORMULA.decayAks)},transport:{dist:distTr.toFixed(1),score:distToScore(distTr,FORMULA.decayFas)},rs:{dist:dRS.toFixed(1),score:distToScore(dRS,FORMULA.decayFas)},kampus:{dist:dK.toFixed(1),score:distToScore(dK,FORMULA.decayFas)},mall:{dist:dM.toFixed(1),score:distToScore(dM,FORMULA.decayFas)}}};
}
function scoreGrade(s){if(s>=85)return{g:"Prime Location",c:"#15803D"};if(s>=75)return{g:"Sangat Strategis",c:"#2563EB"};if(s>=65)return{g:"Strategis",c:"#D97706"};if(s>=55)return{g:"Cukup Strategis",c:"#EA580C"};return{g:"Kurang Strategis",c:"#DC2626"};}
function recalcAll(){perumahan.forEach(p=>{const r=calcScoreFull(p);p.score=r.overall;p._scoreDetail=r;});}
recalcAll();

// ============================================================
// ANALISA MAP
// ============================================================
let analisaMap=null,analisaMapInit=false;
let markers={},poiMarkers={},heatmapLayer=null,heatmapVisible=false;
let currentFilter='all',selectedId=null;
let activePoi={rs:true,kampus:true,mall:true,tol:true,pemda:true,industri:true,publik:true};

function initAnalisaMap(){
  if(analisaMapInit){analisaMap.invalidateSize();return;}
  analisaMap=L.map('analisa-map').setView([-6.530,107.740],11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(analisaMap);
  analisaMapInit=true;
  perumahan.forEach(p=>{
    const isAnch=p.id===ANCHOR_ID,color=TIPE_COLOR[p.tipe]||'#666',sz=isAnch?20:15;
    const icon=L.divIcon({html:`<div style="width:${sz}px;height:${sz}px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.3);${isAnch?'border:3px solid #D97706;box-shadow:0 0 0 3px rgba(217,119,6,0.3);':''}"></div>${isAnch?'<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);font-size:12px;">⭐</div>':''}`,iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],className:'',});
    const m=L.marker([p.lat,p.lng],{icon}).addTo(analisaMap);
    m.bindTooltip(`<b>${escapeHtml(p.nama)}</b><br>${escapeHtml(p.area)} · Skor: <b>${p.score}</b>`,{direction:'top',offset:[0,-10]});
    m.on('click',()=>selectPerumahan(p.id));
    markers[p.id]={marker:m,data:p};
  });
  poi.forEach((x,i)=>{
    const color=KAT_COLOR[x.kat]||'#666';
    const icon=L.divIcon({html:`<div style="width:20px;height:20px;background:${color};border-radius:5px;border:1.5px solid rgba(255,255,255,0.8);box-shadow:0 1px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:700;">${x.label[0]}</div>`,iconSize:[20,20],iconAnchor:[10,10],className:''});
    const m=L.marker([x.lat,x.lng],{icon,zIndexOffset:-100});
    m.bindTooltip(`${x.emoji} ${escapeHtml(x.nama)}`,{direction:'top',offset:[0,-8]});
    poiMarkers[i]={marker:m,data:x};
    if(activePoi[x.kat])m.addTo(analisaMap);
  });
  buildRanking('overall');
  const sel=document.getElementById('perumahan-select');
  sel.innerHTML='<option value="">— Semua Perumahan —</option>';
  perumahan.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=(p.id===ANCHOR_ID?'⭐ ':'')+p.nama;sel.appendChild(o);});
  sel.onchange=function(){if(this.value)selectPerumahan(parseInt(this.value));};
  // [v17 B] Restore state Fokus Data dari localStorage
  try{
    const savedFocus = localStorage.getItem('bm4_focus_data');
    if(savedFocus === '1') applyFocusDataState(true);
  }catch(_){}
}

function setFilter(f,el){
  currentFilter=f;
  document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  applyFilter();
}
function applyFilter(){
  perumahan.forEach(p=>{
    const m=markers[p.id];if(!m)return;
    const show=currentFilter==='all'||p.tipe===currentFilter;
    if(show)m.marker.addTo(analisaMap);else analisaMap.removeLayer(m.marker);
  });
}
function togglePoi(kat,el){
  activePoi[kat]=!activePoi[kat];
  el.classList.toggle('active',activePoi[kat]);
  Object.values(poiMarkers).forEach(({marker,data})=>{
    if(data.kat===kat){if(activePoi[kat])marker.addTo(analisaMap);else analisaMap.removeLayer(marker);}
  });
}
// [v17 B] Mode Fokus Data — peta kecil, sidebar kanan lebar
function applyFocusDataState(enabled){
  const wrap = document.querySelector('.analisa-wrap');
  const btn  = document.getElementById('focus-data-fab');
  if(!wrap || !btn) return;
  wrap.classList.toggle('focus-data', enabled);
  btn.classList.toggle('active', enabled);
  btn.textContent = enabled ? '🗺️ Mode Peta' : '📊 Fokus Data';
  btn.title = enabled ? 'Perbesar peta — sidebar mengecil' : 'Perbesar panel data — peta mengecil';
  // Kasih waktu transisi CSS selesai, baru invalidateSize supaya Leaflet tahu ukuran baru
  setTimeout(()=>{
    if(analisaMapInit && analisaMap){ try{ analisaMap.invalidateSize(); }catch(_){} }
    // Refit highlight compare kalau aktif (biar tidak kepotong)
    if(_lastCompareCols){ try{ highlightCompareOnMainMap(_lastCompareCols); }catch(_){} }
  }, 320);
}
function toggleFocusData(){
  const wrap = document.querySelector('.analisa-wrap');
  if(!wrap) return;
  const enabled = !wrap.classList.contains('focus-data');
  applyFocusDataState(enabled);
  try{ localStorage.setItem('bm4_focus_data', enabled?'1':'0'); }catch(_){}
}

function toggleHeatmap(){
  heatmapVisible=!heatmapVisible;
  document.getElementById('heatmap-fab').classList.toggle('active',heatmapVisible);
  if(heatmapLayer){analisaMap.removeLayer(heatmapLayer);heatmapLayer=null;}
  if(!heatmapVisible)return;
  const layers=[];
  perumahan.forEach(p=>{
    const s=p.score;let r,g,b;
    if(s>=65){r=22;g=163;b=74;}else if(s>=50){r=217;g=119;b=6;}else{r=220;g=38;b=38;}
    layers.push(L.circle([p.lat,p.lng],{radius:1400,color:`rgb(${r},${g},${b})`,fillColor:`rgb(${r},${g},${b})`,fillOpacity:0.2,weight:0}));
  });
  heatmapLayer=L.layerGroup(layers).addTo(analisaMap);
}
function buildRanking(cat){
  const sorted=[...perumahan].sort((a,b)=>{
    if(cat==='overall')return b.score-a.score;
    const na=nearestByKat(a),nb=nearestByKat(b);
    return(na[cat]?na[cat].dist:999)-(nb[cat]?nb[cat].dist:999);
  });
  const list=document.getElementById('ranking-list');
  list.innerHTML=sorted.map((p,i)=>{
    const isAnch=p.id===ANCHOR_ID;
    let val,barPct;
    if(cat==='overall'){val=`${p.score}pts`;barPct=p.score;}
    else{const nb=nearestByKat(p),d=nb[cat]?nb[cat].dist.toFixed(1):'-';val=`${d}km`;barPct=nb[cat]?Math.max(0,100-(nb[cat].dist*8)):0;}
    const color=isAnch?'var(--anchor)':'var(--accent)';
    return`<div class="rank-item${selectedId===p.id?' selected':''}" onclick="selectPerumahan(${p.id})">
      <div class="rank-num">${i+1}</div>
      <div class="rank-body"><div class="rank-name">${isAnch?'⭐ ':''}${escapeHtml(p.nama)}</div>
      <div class="rank-bar-wrap"><div class="rank-bar-fill" style="width:${barPct}%;background:${color}"></div></div></div>
      <div class="rank-val" style="color:${color}">${val}</div></div>`;
  }).join('');
}
function selectPerumahan(id){
  // [TAHAP 4] Reset pembanding tambahan saat pindah ke perumahan berbeda
  if(selectedId !== id) _resetCompareExtrasOnSelect();
  selectedId=id;
  // [v12.4 STATE PERSISTENCE] Save state setiap kali pilih perumahan
  if(typeof triggerSaveAppState === 'function') triggerSaveAppState();
  buildRanking(document.getElementById('rank-cat-select').value);
  const p=perumahan.find(x=>x.id===id);if(!p)return;
  document.getElementById('detail-empty').style.display='none';
  const dc=document.getElementById('detail-content');dc.style.display='flex';
  if(analisaMapInit&&markers[id])analisaMap.panTo([p.lat,p.lng]);
  renderDetailOverview(p);
  renderDetailFasilitas(p);
  renderDetailCompare(p);
  renderDetailRadar(p);
  renderDetailNearby(p);
  // [TAHAP 2] Trigger lazy upgrade jarak via jalan (async, tidak blocking)
  // Skip kalau sudah: 'jalan' (full), 'mengukur' (sedang berjalan), 'partial' (sebagian berhasil, sudah coba)
  if(p._distMode !== 'jalan' && p._distMode !== 'mengukur' && p._distMode !== 'partial'){
    upgradeKompetitorToRoad(p);
  } else {
    _updateDistModeBadge(p);
  }
  // Reset to overview tab
  document.querySelectorAll('.tab-bar .tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(t=>t.classList.remove('active'));
  document.querySelector('.tab[data-atab="overview"]').classList.add('active');
  document.getElementById('tab-overview').classList.add('active');
  // Mobile: buka detail sebagai bottom sheet
  if(window.innerWidth<=768){
    document.getElementById('detail-sb')?.classList.add('open');
    document.getElementById('sb-backdrop')?.classList.add('open');
    document.getElementById('detail-close-mobile').style.display='flex';
    // Tutup sidebar filter kalau terbuka
    const sb=document.querySelector('#pane-analisa .sb');
    if(sb?.classList.contains('open')){sb.classList.remove('open');}
  }
}
function renderDetailOverview(p){
  const r=p._scoreDetail,gr=scoreGrade(r.overall),isAnch=p.id===ANCHOR_ID;
  const pct_p=p.unit>0?Math.min(100,Math.round(p.realisasi/p.unit*100)):0;
  document.getElementById('tab-overview').innerHTML=`
    <span class="pill" style="background:${TIPE_BG[p.tipe]||'#F0F0F0'};color:${TIPE_COLOR[p.tipe]||'#666'}">${TIPE_LABEL[p.tipe]||escapeHtml(p.tipe)}</span>
    ${isAnch?'<span class="anchor-badge">⭐ Anchor</span>':''}
    <button class="pdl-open-btn" style="float:right;" onclick="openPdlModal(${p.id})" title="Lihat detail lengkap per section">📄 Detail Lengkap</button>
    <div class="d-name">${escapeHtml(p.nama)}</div>
    <div class="d-area">📍 ${escapeHtml(p.area)} · Launching ${p.tahun}</div>
    <div style="margin:6px 0 8px;"><span id="dist-mode-badge" style="display:none;font-size:10px;font-weight:600;padding:3px 8px;border-radius:10px;align-items:center;gap:4px;"></span></div>
    <div class="score-card">
      <div><div class="score-label">Location Score</div><div class="score-big">${r.overall}</div><div style="margin-top:5px;"><div class="score-bar-wrap"><div class="score-bar-fill" style="width:${r.overall}%"></div></div></div></div>
      <div style="flex:1"><div class="score-label">Grade</div><div class="score-grade">${gr.g}</div><div style="font-size:10px;opacity:0.65;margin-top:3px;">dari 100 poin</div></div>
    </div>
    <div class="score-breakdown">
      <div style="font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Breakdown Skor 3 Faktor</div>
      <div class="sb-factor"><div class="sb-factor-header"><span class="sb-factor-name">🚗 Aksesibilitas (${FORMULA.wAksesibilitas}%)</span><span class="sb-factor-score" style="color:#2563EB">${r.aksesibilitas}</span></div>
      <div class="sb-factor-bar"><div class="sb-factor-fill" style="width:${r.aksesibilitas}%;background:#2563EB"></div></div>
      <div class="sb-sub"><span>Exit Tol: ${r.detail.tol.dist}km (${r.detail.tol.score}pts)</span><span>CBD: ${r.detail.cbd.dist}km</span><span>Transport: ${r.detail.transport.dist}km</span></div></div>
      <div class="sb-factor"><div class="sb-factor-header"><span class="sb-factor-name">🏥 Fasilitas (${FORMULA.wFasilitas}%)</span><span class="sb-factor-score" style="color:#059669">${r.fasilitas}</span></div>
      <div class="sb-factor-bar"><div class="sb-factor-fill" style="width:${r.fasilitas}%;background:#059669"></div></div>
      <div class="sb-sub"><span>RS: ${r.detail.rs.dist}km (${r.detail.rs.score}pts)</span><span>Kampus: ${r.detail.kampus.dist}km</span><span>Mall: ${r.detail.mall.dist}km</span></div></div>
      <div class="sb-factor"><div class="sb-factor-header"><span class="sb-factor-name">🏗️ Kondisi Fisik (${FORMULA.wFisik}%)</span><span class="sb-factor-score" style="color:#D97706">${r.fisik}</span></div>
      <div class="sb-factor-bar"><div class="sb-factor-fill" style="width:${r.fisik}%;background:#D97706"></div></div></div>
    </div>
    <div class="stats-grid">
      <div class="stat-box"><div class="sl">Total Unit</div><div class="sv">${fmt(p.unit)}</div></div>
      <div class="stat-box"><div class="sl">Realisasi</div><div class="sv">${fmt(p.realisasi)}</div></div>
      <div class="stat-box"><div class="sl">Tahun</div><div class="sv">${p.tahun}</div></div>
      <div class="stat-box"><div class="sl">Progress</div><div class="sv">${pct_p}%</div></div>
    </div>
    <div class="prog-wrap">
      <div class="prog-label"><span>Progress Realisasi</span><span style="font-weight:700">${pct_p}%</span></div>
      <div class="prog-bar"><div class="prog-fill" style="width:${pct_p}%;background:${TIPE_COLOR[p.tipe]||'#65A30D'}"></div></div>
    </div>
    <div class="stat-box" style="font-size:11px;line-height:1.5;"><div class="sl">Developer</div>${escapeHtml(p.developer||'')}</div>
    <div class="coords-small">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</div>
    ${_renderTaperaSection(p)}`;
  // [TAHAP 2] Update badge mode jarak setelah re-render DOM
  _updateDistModeBadge(p);
}

// ============================================================
// [P1 TAPERA] Render section data Tapera di tab Info
// ============================================================
function _renderTaperaSection(p){
  const t = p.tapera;
  if(!t){
    return `<div class="tpr-section">
      <div class="tpr-head"><div class="tpr-title">📊 Data Tapera</div></div>
      <div class="tpr-empty">Belum ada data Tapera untuk perumahan ini.<br>
        <span class="tpr-empty-cta" onclick="_openTaperaEditor(${p.id})">✏️ Isi dari Editor Data →</span>
      </div>
    </div>`;
  }
  const bulanan = Array.isArray(t.realisasiBulanan) ? t.realisasiBulanan : [];
  const sparkline = _renderTaperaSparkline(bulanan);
  const trend = _calcTaperaTrend(bulanan);
  const avgPerBulan = bulanan.length ? Math.round(bulanan.reduce((a,b)=>a+b.unit,0)/bulanan.length) : 0;
  const insights = _generateTaperaInsights(p, t, bulanan, trend, avgPerBulan);
  const badge = t._dummy
    ? '<span class="tpr-badge dummy">🧪 Dummy</span>'
    : (t.lastSynced ? `<span class="tpr-badge ok">✓ ${t.lastSynced}</span>` : '');

  return `<div class="tpr-section">
    <div class="tpr-head">
      <div class="tpr-title">📊 Data Tapera FLPP</div>
      ${badge}
    </div>

    <div class="tpr-summary">
      <div class="tpr-sum-box"><div class="tpr-sum-lbl">Total Realisasi</div>
        <div class="tpr-sum-val">${fmt(t.totalRealisasi||0)}</div>
        <div class="tpr-sum-sub">unit cair FLPP</div></div>
      <div class="tpr-sum-box"><div class="tpr-sum-lbl">Nominal FLPP</div>
        <div class="tpr-sum-val">${(t.nominalFLPP||0).toFixed(1)}<span style="font-size:10px;font-weight:500;color:var(--muted);"> M</span></div>
        <div class="tpr-sum-sub">miliar rupiah</div></div>
      <div class="tpr-sum-box"><div class="tpr-sum-lbl">Rata-rata/bulan</div>
        <div class="tpr-sum-val">${avgPerBulan}</div>
        <div class="tpr-sum-sub">unit/bulan</div></div>
      <div class="tpr-sum-box"><div class="tpr-sum-lbl">Trend</div>
        <div class="tpr-sum-val tpr-trend-${trend.dir}">${trend.icon} ${trend.pctStr}</div>
        <div class="tpr-sum-sub">${trend.label}</div></div>
    </div>

    ${sparkline}

    ${t.hargaRange||t.luasTanah||t.luasBangunan||t.tenorDominan||t.uangMukaRange||t.bankDominan ? `
    <div class="tpr-specs">
      ${t.hargaRange?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">Harga</span><span class="tpr-specs-val">${escapeHtml(t.hargaRange)}</span></div>`:''}
      ${t.luasTanah?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">LT</span><span class="tpr-specs-val">${escapeHtml(t.luasTanah)}</span></div>`:''}
      ${t.luasBangunan?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">LB</span><span class="tpr-specs-val">${escapeHtml(t.luasBangunan)}</span></div>`:''}
      ${t.tenorDominan?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">Tenor</span><span class="tpr-specs-val">${escapeHtml(t.tenorDominan)}</span></div>`:''}
      ${t.uangMukaRange?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">UM</span><span class="tpr-specs-val">${escapeHtml(t.uangMukaRange)}</span></div>`:''}
      ${t.bankDominan?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">Bank</span><span class="tpr-specs-val">${escapeHtml(t.bankDominan)}</span></div>`:''}
    </div>`:''}

    ${_renderTaperaProfil(t.profilPembeli)}

    ${insights.length?`<div class="tpr-insights">
      ${insights.map(i=>`<div class="tpr-insight-item">${i}</div>`).join('')}
    </div>`:''}
  </div>`;
}

// Sparkline SVG inline — tanpa library
function _renderTaperaSparkline(bulanan){
  if(!bulanan || bulanan.length<2) return '';
  const W=340, H=60, PAD_L=4, PAD_R=4, PAD_T=6, PAD_B=4;
  const iw=W-PAD_L-PAD_R, ih=H-PAD_T-PAD_B;
  const max=Math.max(1, ...bulanan.map(b=>b.unit));
  const n=bulanan.length;
  const step = n>1 ? iw/(n-1) : iw;
  const pts = bulanan.map((b,i)=>{
    const x = PAD_L + i*step;
    const y = PAD_T + ih - (b.unit/max)*ih;
    return [x,y];
  });
  const path = pts.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const fillPath = path + ` L${pts[pts.length-1][0].toFixed(1)},${(PAD_T+ih).toFixed(1)} L${pts[0][0].toFixed(1)},${(PAD_T+ih).toFixed(1)} Z`;
  const firstLabel = bulanan[0].bulan;
  const lastLabel = bulanan[n-1].bulan;
  const peakIdx = bulanan.reduce((best,b,i)=>b.unit>bulanan[best].unit?i:best, 0);
  const peak = bulanan[peakIdx];
  return `<div class="tpr-chart-wrap">
    <div class="tpr-chart-head"><span>📈 Realisasi per bulan</span><span>Puncak: ${peak.unit} unit (${peak.bulan})</span></div>
    <svg class="tpr-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path d="${fillPath}" fill="rgba(59,130,246,0.12)" stroke="none"/>
      <path d="${path}" fill="none" stroke="#2563EB" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${pts[peakIdx][0].toFixed(1)}" cy="${pts[peakIdx][1].toFixed(1)}" r="2.5" fill="#2563EB"/>
    </svg>
    <div class="tpr-chart-axis"><span>${firstLabel}</span><span>${lastLabel}</span></div>
  </div>`;
}

// Hitung trend: bandingkan rata-rata 3 bulan terakhir vs 6 bulan sebelum itu
function _calcTaperaTrend(bulanan){
  if(!bulanan || bulanan.length<4) return {dir:'flat', icon:'→', pctStr:'—', label:'data kurang'};
  const n=bulanan.length;
  const recent = bulanan.slice(Math.max(0,n-3)).map(b=>b.unit);
  const prior = bulanan.slice(Math.max(0,n-9), n-3).map(b=>b.unit);
  const avgRecent = recent.reduce((a,b)=>a+b,0)/recent.length;
  const avgPrior = prior.length ? prior.reduce((a,b)=>a+b,0)/prior.length : avgRecent;
  if(avgPrior===0) return {dir:'flat', icon:'→', pctStr:'—', label:'baseline 0'};
  const delta = ((avgRecent-avgPrior)/avgPrior)*100;
  if(delta>=10) return {dir:'up', icon:'↗', pctStr:`+${Math.round(delta)}%`, label:'3 bln terakhir naik'};
  if(delta<=-10) return {dir:'down', icon:'↘', pctStr:`${Math.round(delta)}%`, label:'3 bln terakhir turun'};
  return {dir:'flat', icon:'→', pctStr:`${delta>=0?'+':''}${Math.round(delta)}%`, label:'relatif stabil'};
}

// Render profil pembeli mini (4 section × top-3 label)
function _renderTaperaProfil(profil){
  if(!profil || Object.keys(profil).length===0) return '';
  const sections=[
    {key:'pekerjaan', lbl:'💼 Pekerjaan', color:'#2563EB'},
    {key:'usia', lbl:'🎂 Usia', color:'#059669'},
    {key:'penghasilan', lbl:'💰 Penghasilan', color:'#D97706'},
    {key:'gender', lbl:'👥 Gender', color:'#7C3AED'}
  ];
  const boxes=sections.map(s=>{
    const data=profil[s.key];
    if(!data) return '';
    const entries=Object.entries(data).sort((a,b)=>b[1]-a[1]).slice(0,3);
    if(entries.length===0) return '';
    const max=Math.max(...entries.map(e=>e[1]));
    const items=entries.map(([k,v])=>{
      const pct=max>0?Math.round((v/max)*100):0;
      return `<div class="tpr-profil-item">
        <span class="tpr-profil-name" title="${escapeHtml(k)}">${escapeHtml(k)}</span>
        <div class="tpr-profil-bar"><div class="tpr-profil-fill" style="width:${pct}%;background:${s.color};"></div></div>
        <span class="tpr-profil-pct">${v}${v>=100?'':'%'}</span>
      </div>`;
    }).join('');
    return `<div class="tpr-profil-box"><div class="tpr-profil-lbl">${s.lbl}</div>${items}</div>`;
  }).filter(Boolean).join('');
  if(!boxes) return '';
  return `<div class="tpr-profil-grid">${boxes}</div>`;
}

// Generate insight otomatis dari data Tapera
function _generateTaperaInsights(p, t, bulanan, trend, avgPerBulan){
  const ins=[];
  // 1. Kecepatan serap
  if(avgPerBulan>0){
    if(avgPerBulan>=30) ins.push(`🔥 Kecepatan serap tinggi: <b>${avgPerBulan} unit/bulan</b> — pasar menyerap sangat cepat.`);
    else if(avgPerBulan>=10) ins.push(`✓ Kecepatan serap sehat: <b>${avgPerBulan} unit/bulan</b>.`);
    else ins.push(`⚠ Kecepatan serap rendah: <b>${avgPerBulan} unit/bulan</b> — perlu perhatian strategi.`);
  }
  // 2. Trend
  if(trend.dir==='up') ins.push(`↗ Trend 3 bulan terakhir <b>naik ${trend.pctStr}</b> — momentum positif.`);
  else if(trend.dir==='down') ins.push(`↘ Trend 3 bulan terakhir <b>turun ${trend.pctStr.replace('-','')}</b> — pasar melambat.`);
  // 3. Target market dominan (dari profil)
  const profil = t.profilPembeli||{};
  if(profil.usia && profil.penghasilan){
    const topUsia = Object.entries(profil.usia).sort((a,b)=>b[1]-a[1])[0];
    const topPeng = Object.entries(profil.penghasilan).sort((a,b)=>b[1]-a[1])[0];
    if(topUsia && topPeng){
      ins.push(`🎯 Target dominan: usia <b>${topUsia[0]} thn</b>, penghasilan <b>${topPeng[0]}</b>.`);
    }
  }
  // 4. Sisa stok (pakai p.unit vs tapera.totalRealisasi)
  if(p.unit>0 && t.totalRealisasi>0){
    const pct=Math.round((t.totalRealisasi/p.unit)*100);
    if(pct>=80) ins.push(`📦 Realisasi ${pct}% dari total unit — <b>hampir habis</b>.`);
    else if(pct>=50) ins.push(`📦 Realisasi ${pct}% — stok tersisa ${fmt(p.unit-t.totalRealisasi)} unit.`);
  }
  return ins;
}

// CTA buka editor ke tab Tapera dengan perumahan ini terpilih
function _openTaperaEditor(id){
  // Pastikan editor terbuka
  const overlay=document.getElementById('editor-overlay');
  if(overlay && !overlay.classList.contains('open')){
    try{ toggleEditor(); }catch(_){}
  }
  // Pindah ke tab tapera (switchEtab panggil initTaperaEditor via setTimeout 50ms)
  setTimeout(()=>{
    const btn=document.querySelector('.editor-tabs .etab:nth-child(3)');
    if(btn) btn.click();
    // Delay lebih lama dari switchEtab (50ms) + initTaperaEditor restore selection
    setTimeout(()=>{
      const sel=document.getElementById('tpr-select');
      if(sel){
        sel.value=String(id);
        loadTaperaForm(String(id));
      }
    }, 150);
  }, 50);
}
function renderDetailFasilitas(p){
  // [TAHAP 2] Pakai _roadNearest kalau sudah di-upgrade, fallback ke haversine
  const nbHav = nearestByKat(p);
  const nbRoad = p._roadNearest || {};
  const nb = {};
  Object.keys(KAT_LABEL).forEach(k => {
    if(nbRoad[k]) nb[k] = nbRoad[k];
    else if(nbHav[k]) nb[k] = nbHav[k];
  });
  const usingRoad = Object.keys(nbRoad).length > 0;
  document.getElementById('tab-fasilitas').innerHTML=`
    <div class="section-title">Fasilitas Terdekat per Kategori ${usingRoad ? '<span style="font-size:9px;color:#15803D;font-weight:600;">🛣 via jalan</span>' : ''}</div>
    ${Object.entries(KAT_LABEL).map(([kat,lbl])=>{const x=nb[kat];if(!x)return'';return`
    <div class="poi-row">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
        <div class="poi-icon" style="background:${KAT_COLOR[kat]}">${x.emoji||x.label[0]}</div>
        <div><div class="poi-name">${escapeHtml(x.nama)}</div><div class="poi-cat">${lbl}</div></div>
      </div>
      <div class="poi-dist" style="flex-shrink:0;text-align:right;margin-left:8px;">
        <div class="km">${x.dist.toFixed(1)} km</div>
        <div class="mn">~${x.menit || travelMin(x.dist)} mnt</div>
      </div>
    </div>`;}).join('')}`;
}
// [TAHAP 4] State multi-banding: array ID kompetitor TAMBAHAN (di luar anchor & fokus)
let compareExtraIds = [];
const CMP_PALETTE = ['#185FA5','#0F6E56','#D85A30']; // biru, teal, coral untuk pembanding tambahan

// [v17 fix] Visibility toggle untuk row Tapera di tabel banding.
// Default: 3 row paling penting ON, 10 row detail OFF. Persisted di localStorage.
const TAPERA_ROW_DEFS = [
  {key:'tpr_avg',    label:'📊 Rata² realisasi/bln', group:'Realisasi', defaultOn:true},
  {key:'tpr_trend',  label:'📈 Trend 3-bln',         group:'Realisasi', defaultOn:true},
  {key:'tpr_total',  label:'🏆 Total Realisasi',     group:'Realisasi', defaultOn:false},
  {key:'tpr_flpp',   label:'💵 Nominal FLPP',        group:'Realisasi', defaultOn:false},
  {key:'tpr_harga',  label:'💰 Harga range',         group:'Spesifikasi', defaultOn:true},
  {key:'tpr_lt',     label:'📐 Luas Tanah',          group:'Spesifikasi', defaultOn:false},
  {key:'tpr_lb',     label:'🏠 Luas Bangunan',       group:'Spesifikasi', defaultOn:false},
  {key:'tpr_tenor',  label:'📅 Tenor Dominan',       group:'Spesifikasi', defaultOn:false},
  {key:'tpr_um',     label:'💳 Uang Muka',           group:'Spesifikasi', defaultOn:false},
  {key:'tpr_bank',   label:'🏦 Bank Dominan',        group:'Spesifikasi', defaultOn:false},
  {key:'tpr_pek',    label:'💼 Pekerjaan dominan',   group:'Profil Pembeli', defaultOn:false},
  {key:'tpr_usia',   label:'🎂 Usia dominan',        group:'Profil Pembeli', defaultOn:false},
  {key:'tpr_peng',   label:'💴 Penghasilan dominan', group:'Profil Pembeli', defaultOn:false},
  {key:'tpr_gender', label:'👥 Gender dominan',      group:'Profil Pembeli', defaultOn:false}
];
let taperaRowVisibility = {};
(function loadTaperaRowVis(){
  try{
    const raw = localStorage.getItem('bm4_tapera_row_vis');
    const saved = raw ? JSON.parse(raw) : null;
    TAPERA_ROW_DEFS.forEach(d=>{
      taperaRowVisibility[d.key] = (saved && saved[d.key]!=null) ? !!saved[d.key] : d.defaultOn;
    });
  }catch(_){
    TAPERA_ROW_DEFS.forEach(d=>{ taperaRowVisibility[d.key] = d.defaultOn; });
  }
})();
function _saveTaperaRowVis(){
  try{ localStorage.setItem('bm4_tapera_row_vis', JSON.stringify(taperaRowVisibility)); }catch(_){}
}
function toggleTaperaRow(key, checked){
  taperaRowVisibility[key] = !!checked;
  _saveTaperaRowVis();
  // Re-render tab compare
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}
function setTaperaRowPreset(preset){
  // preset: 'min' (3 default), 'all', 'none'
  TAPERA_ROW_DEFS.forEach(d=>{
    if(preset==='all') taperaRowVisibility[d.key] = true;
    else if(preset==='none') taperaRowVisibility[d.key] = false;
    else taperaRowVisibility[d.key] = d.defaultOn;
  });
  _saveTaperaRowVis();
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}
function toggleTaperaRowPanel(){
  const el = document.getElementById('tpr-col-panel');
  if(!el) return;
  el.classList.toggle('open');
}
// [v17 A1] cmpMiniMap/markers/lines dihapus — fungsinya dipindah ke peta besar.
// State baru: cmpHighlightLines, cmpHighlightIds, cmpHighlightOriginalIcons (lihat atas).

// ═══════════════════════════════════════════════════════════════════════════════
// [v18 SECTIONS] Master Row Registry + Sections untuk Tabel Vs Anchor
// ───────────────────────────────────────────────────────────────────────────────
// Setiap row di tabel Vs Anchor didefinisikan sekali di sini (key + label).
// Section di-map ke list row-key, bisa di-edit user lewat Hub Formula → Kategori.
// ═══════════════════════════════════════════════════════════════════════════════

// Master daftar semua row yang TERSEDIA di tabel. Key-nya dipakai sebagai ID.
// label = apa yang tampil di kolom "Faktor".
const VSA_ROW_DEFS = [
  // Skor
  {key:'skor_overall',  label:'🏆 Skor'},
  {key:'skor_aks',      label:'🚗 Aksesibilitas'},
  {key:'skor_fas',      label:'🏥 Fasilitas'},
  {key:'skor_fisik',    label:'🏗️ Fisik'},
  // Jarak POI (7 kategori)
  {key:'poi_rs',        label:'🏥 RS/Klinik'},
  {key:'poi_kampus',    label:'🎓 Kampus'},
  {key:'poi_mall',      label:'🏬 Mall/Belanja'},
  {key:'poi_tol',       label:'🛣️ Transportasi'},
  {key:'poi_pemda',     label:'🏛️ Pemerintah'},
  {key:'poi_industri',  label:'💼 Industri'},
  {key:'poi_publik',    label:'🌳 Ruang Publik'},
  // Data proyek
  {key:'proj_unit',     label:'Total Unit'},
  {key:'proj_realisasi',label:'Realisasi'},
  {key:'proj_progress', label:'Progress %'},
  // Jarak ke anchor
  {key:'dist_anchor',   label:'Jarak ke ⭐'},
  // Tapera - realisasi
  {key:'tpr_avg',       label:'📊 Tapera: rata²/bln'},
  {key:'tpr_trend',     label:'📈 Trend 3-bln'},
  {key:'tpr_total',     label:'🏆 Total Realisasi'},
  {key:'tpr_flpp',      label:'💵 Nominal FLPP'},
  // Tapera - spesifikasi
  {key:'tpr_harga',     label:'💰 Harga range'},
  {key:'tpr_lt',        label:'📐 Luas Tanah'},
  {key:'tpr_lb',        label:'🏠 Luas Bangunan'},
  {key:'tpr_tenor',     label:'📅 Tenor Dominan'},
  {key:'tpr_um',        label:'💳 Uang Muka'},
  {key:'tpr_bank',      label:'🏦 Bank Dominan'},
  // Tapera - profil pembeli
  {key:'tpr_pek',       label:'💼 Pekerjaan dominan'},
  {key:'tpr_usia',      label:'🎂 Usia dominan'},
  {key:'tpr_peng',      label:'💴 Penghasilan dominan'},
  {key:'tpr_gender',    label:'👥 Gender dominan'},
  // [TAHAP1] Promotion — gimmick jualan
  {key:'tpr_promo_aktif', label:'🎁 Promo Aktif'},
  {key:'tpr_promo_periode',label:'📅 Periode Promo'},
  {key:'tpr_promo_bonus', label:'🎉 Bonus Pembelian'},
  {key:'tpr_promo_iklan', label:'📱 Iklan di'},
  {key:'tpr_promo_bb',    label:'📢 Billboard/Spanduk'},
  // [TAHAP1] Go-to-Market — cara mereka jualan
  {key:'tpr_gtm_mkt',     label:'👥 Marketing In-house'},
  {key:'tpr_gtm_kanal',   label:'🏢 Struktur Kanal'},
  {key:'tpr_gtm_agent',   label:'🤝 Jumlah Agent'},
  {key:'tpr_gtm_fee_mkt', label:'💵 Fee Marketing'},
  {key:'tpr_gtm_fee_agt', label:'💵 Fee Agent'},
  {key:'tpr_gtm_dev',     label:'🏪 Brand Developer'}
];
const VSA_ROW_KEYS = VSA_ROW_DEFS.map(d=>d.key);
const VSA_ROW_LABEL = Object.fromEntries(VSA_ROW_DEFS.map(d=>[d.key, d.label]));

// [TAHAP2] Row keys yang punya data kompleks (list/multi-item) — tampil ringkas di tabel, detail di modal
const VSA_COMPLEX_ROWS = new Set([
  'tpr_promo_aktif',   // Multi promo: Free AJB, DP 1%, Cashback...
  'tpr_promo_bonus',   // Multi bonus: Kanopi, AC, Kitchen set...
  'tpr_promo_iklan'    // Platform list: R123, OLX, FB Ads...
]);
// Helper: parse comma/koma-separated string jadi array of items
function _parseComplexItems(str){
  if(!str || typeof str!=='string') return [];
  return str.split(/[,;]/).map(s=>s.trim()).filter(Boolean);
}

// Default sections (4P + Performance + Market Insight + Promotion + Go-to-Market)
const VSA_SECTIONS_DEFAULT = [
  {id:'ringkasan',  emoji:'📊', name:'Ringkasan',
    rows:['skor_overall','skor_aks','skor_fas','skor_fisik']},
  {id:'place',      emoji:'📍', name:'Place',
    rows:['poi_rs','poi_kampus','poi_mall','poi_tol','poi_pemda','poi_industri','poi_publik','dist_anchor']},
  {id:'product',    emoji:'🏠', name:'Product',
    rows:['tpr_lt','tpr_lb']},
  {id:'price',      emoji:'💰', name:'Price',
    rows:['tpr_harga','tpr_tenor','tpr_um','tpr_bank']},
  {id:'promotion',  emoji:'📢', name:'Promotion',
    rows:['tpr_promo_aktif','tpr_promo_periode','tpr_promo_bonus','tpr_promo_iklan','tpr_promo_bb']},
  {id:'performance',emoji:'📈', name:'Performance',
    rows:['proj_unit','proj_realisasi','proj_progress','tpr_avg','tpr_trend','tpr_total','tpr_flpp']},
  {id:'gtm',        emoji:'👔', name:'Go-to-Market',
    rows:['tpr_gtm_mkt','tpr_gtm_kanal','tpr_gtm_agent','tpr_gtm_fee_mkt','tpr_gtm_fee_agt','tpr_gtm_dev']},
  {id:'market',     emoji:'👥', name:'Market Insight',
    rows:['tpr_pek','tpr_usia','tpr_peng','tpr_gender']}
];

// State: section list (diedit user) + section yang aktif + visibility per row
let VSA_SECTIONS = [];
let vsaActiveSectionId = 'ringkasan';
let vsaRowVisibility = {}; // {row_key: true/false} — untuk toggle quick hide per section

// Load from localStorage
(function _loadVsaSections(){
  try{
    const raw = localStorage.getItem('bm4_vsa_sections');
    const saved = raw ? JSON.parse(raw) : null;
    if(Array.isArray(saved) && saved.length){
      // Validasi: pastikan setiap section punya id, name, emoji, rows[]
      VSA_SECTIONS = saved.filter(s => s && s.id && s.name && Array.isArray(s.rows))
                          .map(s => ({
                            id:String(s.id), emoji:String(s.emoji||'📁'),
                            name:String(s.name),
                            rows:s.rows.filter(k => VSA_ROW_KEYS.includes(k))
                          }));
      if(!VSA_SECTIONS.length) VSA_SECTIONS = JSON.parse(JSON.stringify(VSA_SECTIONS_DEFAULT));
      // [TAHAP1 MIGRATION] Auto-tambah section baru kalau user punya config lama
      const existingIds = VSA_SECTIONS.map(s=>s.id);
      VSA_SECTIONS_DEFAULT.forEach(defSec => {
        if(!existingIds.includes(defSec.id)){
          // Insert promotion setelah price, gtm setelah performance — kalau anchor ada
          if(defSec.id==='promotion'){
            const priceIdx = VSA_SECTIONS.findIndex(s=>s.id==='price');
            if(priceIdx>=0) VSA_SECTIONS.splice(priceIdx+1, 0, JSON.parse(JSON.stringify(defSec)));
            else VSA_SECTIONS.push(JSON.parse(JSON.stringify(defSec)));
          } else if(defSec.id==='gtm'){
            const perfIdx = VSA_SECTIONS.findIndex(s=>s.id==='performance');
            if(perfIdx>=0) VSA_SECTIONS.splice(perfIdx+1, 0, JSON.parse(JSON.stringify(defSec)));
            else VSA_SECTIONS.push(JSON.parse(JSON.stringify(defSec)));
          } else {
            VSA_SECTIONS.push(JSON.parse(JSON.stringify(defSec)));
          }
        }
      });
    } else {
      VSA_SECTIONS = JSON.parse(JSON.stringify(VSA_SECTIONS_DEFAULT));
    }
  }catch(_){
    VSA_SECTIONS = JSON.parse(JSON.stringify(VSA_SECTIONS_DEFAULT));
  }
  // Load row visibility
  try{
    const raw = localStorage.getItem('bm4_vsa_row_vis');
    const saved = raw ? JSON.parse(raw) : {};
    VSA_ROW_KEYS.forEach(k => { vsaRowVisibility[k] = saved[k] !== false; });
  }catch(_){
    VSA_ROW_KEYS.forEach(k => { vsaRowVisibility[k] = true; });
  }
  // Load active section
  try{
    const s = localStorage.getItem('bm4_vsa_active_section');
    if(s && VSA_SECTIONS.some(x=>x.id===s)) vsaActiveSectionId = s;
    else vsaActiveSectionId = VSA_SECTIONS[0]?.id || 'ringkasan';
  }catch(_){ vsaActiveSectionId = VSA_SECTIONS[0]?.id || 'ringkasan'; }
})();

function _saveVsaSections(){
  try{ localStorage.setItem('bm4_vsa_sections', JSON.stringify(VSA_SECTIONS)); }catch(_){}
}
function _saveVsaRowVis(){
  try{ localStorage.setItem('bm4_vsa_row_vis', JSON.stringify(vsaRowVisibility)); }catch(_){}
}
function _saveVsaActiveSection(){
  try{ localStorage.setItem('bm4_vsa_active_section', vsaActiveSectionId); }catch(_){}
}

// Helper: dapetin rows yang termasuk section aktif
function _getActiveSectionRows(){
  const sec = VSA_SECTIONS.find(s=>s.id===vsaActiveSectionId) || VSA_SECTIONS[0];
  return sec ? sec.rows : [];
}

// Event: user klik sub-tab section
function switchVsaSection(sectionId){
  vsaActiveSectionId = sectionId;
  _saveVsaActiveSection();
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}

// Event: toggle visibility 1 row di section aktif
function toggleVsaRow(rowKey, checked){
  vsaRowVisibility[rowKey] = !!checked;
  _saveVsaRowVis();
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}

function toggleVsaRowPanel(){
  const el = document.getElementById('vsa-row-panel');
  if(el) el.classList.toggle('open');
}

// [TAHAP2] Modal detail untuk row dengan data kompleks (list)
function openVsaDetail(rowKey){
  const cols = window._vsaDetailCols || [];
  if(!cols.length) return;
  // Mapping rowKey ke path di tapera object
  const DETAIL_MAP = {
    'tpr_promo_aktif':  {path:'promotion.promoAktif',   label:'🎁 Promo Aktif'},
    'tpr_promo_bonus':  {path:'promotion.bonus',        label:'🎉 Bonus Pembelian'},
    'tpr_promo_iklan':  {path:'promotion.iklanPlatform',label:'📱 Iklan di Platform'}
  };
  const meta = DETAIL_MAP[rowKey];
  if(!meta){ showToast('⚠ Row tidak punya detail view'); return; }
  // Set title
  document.getElementById('vsa-detail-title').textContent = meta.label;
  // Build body: 1 card per perumahan
  const body = document.getElementById('vsa-detail-body');
  const [p1,p2] = meta.path.split('.');
  const cardsHtml = cols.map(c=>{
    const perum = perumahan.find(x=>x.id===c.id);
    const raw = perum?.tapera?.[p1]?.[p2] || '';
    const items = _parseComplexItems(raw);
    const isAnchor = c.role==='anchor';
    const roleLbl = isAnchor ? '⭐ ANCHOR' : (c.role==='focus'?'🎯 FOKUS':'PEMBANDING');
    const itemsHtml = items.length
      ? `<ul class="vsa-detail-items">${items.map(it=>`<li><span>${escapeHtml(it)}</span></li>`).join('')}</ul>`
      : `<div class="vsa-detail-empty">Belum ada data</div>`;
    return `<div class="vsa-detail-card ${isAnchor?'anchor':''}">
      <div class="vsa-detail-card-head">${roleLbl}</div>
      <div class="vsa-detail-card-name">${escapeHtml(c.nama)}</div>
      ${itemsHtml}
    </div>`;
  }).join('');
  body.innerHTML = cardsHtml;
  // Show
  document.getElementById('vsa-detail-overlay').classList.add('open');
}
function closeVsaDetail(){
  document.getElementById('vsa-detail-overlay').classList.remove('open');
}
// ESC close handler untuk detail modal
document.addEventListener('keydown', function(e){
  if(e.key==='Escape'){
    const ov = document.getElementById('vsa-detail-overlay');
    if(ov && ov.classList.contains('open')) closeVsaDetail();
  }
});

// ============================================================
// [TAHAP3-IT1+IT2] Modal Detail Lengkap per Perumahan
// ============================================================
// Formula dengan bobot editable per komponen — disimpan di localStorage
const PDL_FORMULA_DEFAULTS = {
  product: {
    weights: {lt:25, lb:25, unit:25, launching:25},
    components: {
      lt: {label:'Luas Tanah terisi', check:(p,t)=>t.luasTanah && t.luasTanah.trim()},
      lb: {label:'Luas Bangunan terisi', check:(p,t)=>t.luasBangunan && t.luasBangunan.trim()},
      unit: {label:'Total unit > 0', check:(p,t)=>p.unit > 0},
      launching: {label:'Launching ≤ 3 tahun', check:(p,t)=>{
        const cur = new Date().getFullYear();
        return p.tahun && (cur - p.tahun) <= 3;
      }}
    }
  },
  price: {
    weights: {base:50, harga:20, tenor:10, dp:10, bank:10},
    components: {
      base: {label:'Base score', check:()=>true}, // selalu dapat
      harga: {label:'Harga Range terisi', check:(p,t)=>t.hargaRange && t.hargaRange.trim()},
      tenor: {label:'Tenor Dominan terisi', check:(p,t)=>t.tenorDominan && t.tenorDominan.trim()},
      dp: {label:'Uang Muka terisi', check:(p,t)=>t.uangMukaRange && t.uangMukaRange.trim()},
      bank: {label:'Bank Dominan terisi', check:(p,t)=>t.bankDominan && t.bankDominan.trim()}
    }
  },
  promotion: {
    weights: {promo:30, periode:10, bonus:20, iklan:30, billboard:10},
    components: {
      promo: {label:'Promo Aktif terisi', check:(p,t)=>{ const pr=t.promotion||{}; return pr.promoAktif && pr.promoAktif.trim(); }},
      periode: {label:'Periode Promo terisi', check:(p,t)=>{ const pr=t.promotion||{}; return pr.periode && pr.periode.trim(); }},
      bonus: {label:'Bonus Pembelian terisi', check:(p,t)=>{ const pr=t.promotion||{}; return pr.bonus && pr.bonus.trim(); }},
      iklan: {label:'Iklan Platform (per kanal, max 3)', calc:(p,t,w)=>{
        const pr = t.promotion||{};
        if(!pr.iklanPlatform || !pr.iklanPlatform.trim()) return 0;
        const nCh = _parseComplexItems(pr.iklanPlatform).length;
        return Math.min(w, Math.round(nCh * (w/3)));
      }},
      billboard: {label:'Billboard aktif (Ya/Yes)', check:(p,t)=>{ const pr=t.promotion||{}; return pr.billboard && /ya|yes/i.test(pr.billboard); }}
    }
  },
  performance: {
    weights: {progress:60, trend:25, historis:15},
    components: {
      progress: {label:'Progress % (0-100 proporsional)', calc:(p,t,w)=>{
        const pct = p.unit > 0 ? (p.realisasi || 0) / p.unit : 0;
        return Math.round(pct * w);
      }},
      trend: {label:'Trend naik(100%)/flat(60%)/turun(20%)', calc:(p,t,w)=>{
        const bulanan = t.realisasiBulanan || [];
        if(bulanan.length < 4) return 0;
        const trend = _calcTaperaTrend(bulanan);
        if(trend.dir === 'up') return w;
        if(trend.dir === 'flat') return Math.round(w*0.6);
        if(trend.dir === 'down') return Math.round(w*0.2);
        return 0;
      }},
      historis: {label:'Data bulanan ≥ 3', check:(p,t)=>{
        const b = t.realisasiBulanan || [];
        return b.length >= 3;
      }}
    }
  },
  gtm: {
    weights: {mkt:30, kanal:20, agent:25, feeMkt:10, feeAgent:10, brand:5},
    components: {
      mkt: {label:'Marketing in-house (5+ org = max)', calc:(p,t,w)=>{
        const gtm = t.gtm || {};
        if(gtm.marketingInhouse == null) return 0;
        return Math.min(w, Math.round(gtm.marketingInhouse * (w/5)));
      }},
      kanal: {label:'Struktur Kanal (agent=100%, lain=50%)', calc:(p,t,w)=>{
        const gtm = t.gtm || {};
        if(!gtm.strukturKanal) return 0;
        if(/agent/i.test(gtm.strukturKanal)) return w;
        return Math.round(w*0.5);
      }},
      agent: {label:'Jumlah agent (10+ = max)', calc:(p,t,w)=>{
        const gtm = t.gtm || {};
        if(gtm.jumlahAgent == null || gtm.jumlahAgent <= 0) return 0;
        return Math.min(w, Math.round(gtm.jumlahAgent * (w/10)));
      }},
      feeMkt: {label:'Fee Marketing terisi', check:(p,t)=>{ const g=t.gtm||{}; return g.feeMarketing && g.feeMarketing.trim(); }},
      feeAgent: {label:'Fee Agent terisi', check:(p,t)=>{ const g=t.gtm||{}; return g.feeAgent && g.feeAgent.trim(); }},
      brand: {label:'Brand Developer terisi', check:(p,t)=>{ const g=t.gtm||{}; return g.brandDeveloper && g.brandDeveloper.trim(); }}
    }
  }
};

// Active weights (editable, loaded from localStorage)
let PDL_WEIGHTS = {};
(function _loadPdlWeights(){
  try{
    const raw = localStorage.getItem('bm4_pdl_weights');
    const saved = raw ? JSON.parse(raw) : null;
    if(saved && typeof saved === 'object'){
      // Merge dengan defaults untuk safety (kalau ada section/key baru)
      Object.keys(PDL_FORMULA_DEFAULTS).forEach(sec => {
        PDL_WEIGHTS[sec] = {...PDL_FORMULA_DEFAULTS[sec].weights, ...(saved[sec]||{})};
      });
    } else {
      Object.keys(PDL_FORMULA_DEFAULTS).forEach(sec => {
        PDL_WEIGHTS[sec] = {...PDL_FORMULA_DEFAULTS[sec].weights};
      });
    }
  }catch(_){
    Object.keys(PDL_FORMULA_DEFAULTS).forEach(sec => {
      PDL_WEIGHTS[sec] = {...PDL_FORMULA_DEFAULTS[sec].weights};
    });
  }
})();
function _savePdlWeights(){
  try{ localStorage.setItem('bm4_pdl_weights', JSON.stringify(PDL_WEIGHTS)); }catch(_){}
}

// Generic calculator — baca weights aktif + spec dari PDL_FORMULA_DEFAULTS
function _calcSectionScore(sectionId, p){
  const spec = PDL_FORMULA_DEFAULTS[sectionId];
  if(!spec) return 0;
  const weights = PDL_WEIGHTS[sectionId] || spec.weights;
  const t = p.tapera || {};
  let score = 0;
  Object.keys(spec.components).forEach(key => {
    const comp = spec.components[key];
    const w = weights[key] || 0;
    if(w <= 0) return;
    if(typeof comp.calc === 'function'){
      score += comp.calc(p, t, w);
    } else if(typeof comp.check === 'function'){
      if(comp.check(p, t)) score += w;
    }
  });
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Place tetap pakai formula existing (aksesibilitas + fasilitas)
function _calcPlaceScore(p){
  const sd = p._scoreDetail || calcScoreFull(p);
  return Math.round(sd.aksesibilitas * 0.5 + sd.fasilitas * 0.5);
}

// Wrapper: hitung semua skor section + overall average
function _calcAllSectionScores(p){
  const place = _calcPlaceScore(p);
  const product = _calcSectionScore('product', p);
  const price = _calcSectionScore('price', p);
  const promotion = _calcSectionScore('promotion', p);
  const performance = _calcSectionScore('performance', p);
  const gtm = _calcSectionScore('gtm', p);
  const avg = Math.round((place + product + price + promotion + performance + gtm) / 6);
  return {place, product, price, promotion, performance, gtm, avg};
}

// ============================================================
// [TAHAP3-IT2] Formula Editor UI — di Hub Formula tab "Formula Detail"
// ============================================================
const PDL_FE_SECTION_META = {
  product:     {emoji:'🏠', name:'Product'},
  price:       {emoji:'💰', name:'Price'},
  promotion:   {emoji:'📢', name:'Promotion'},
  performance: {emoji:'📈', name:'Performance'},
  gtm:         {emoji:'👔', name:'Go-to-Market'}
};

function renderPdlFormulaEditor(){
  const host = document.getElementById('pdl-formula-editor');
  if(!host) return;
  host.innerHTML = Object.keys(PDL_FE_SECTION_META).map(sec => {
    const meta = PDL_FE_SECTION_META[sec];
    const spec = PDL_FORMULA_DEFAULTS[sec];
    const weights = PDL_WEIGHTS[sec] || spec.weights;
    const total = Object.values(weights).reduce((a,b)=>a+(Number(b)||0), 0);
    const isOk = total === 100;
    const rowsHtml = Object.keys(spec.components).map(key => {
      const comp = spec.components[key];
      const w = weights[key] || 0;
      const pct = Math.min(100, Math.max(0, w));
      return `<div class="pdl-fe-row">
        <div class="pdl-fe-row-lbl">${escapeHtml(comp.label)}</div>
        <div class="pdl-fe-row-bar"><div class="pdl-fe-row-bar-fill" style="width:${pct}%"></div></div>
        <input type="number" class="pdl-fe-row-input" min="0" max="100" step="1"
          value="${w}"
          data-pdl-sec="${sec}" data-pdl-key="${key}"
          oninput="onPdlWeightInput('${sec}','${key}', this.value)">
      </div>`;
    }).join('');
    return `<div class="pdl-fe-sec" id="pdl-fe-sec-${sec}">
      <div class="pdl-fe-head">
        <div class="pdl-fe-title">${meta.emoji} ${meta.name}</div>
        <div class="pdl-fe-total ${isOk?'ok':'warn'}" id="pdl-fe-total-${sec}">Total: ${total}/100</div>
      </div>
      <div class="pdl-fe-body">
        ${rowsHtml}
      </div>
      <div class="pdl-fe-hint">Bobot menentukan berapa poin maksimal komponen ini menyumbang ke skor akhir (0-100). Total bobot idealnya = 100.</div>
    </div>`;
  }).join('');
}

function onPdlWeightInput(sec, key, rawVal){
  let val = parseInt(rawVal);
  if(isNaN(val)) val = 0;
  if(val < 0) val = 0;
  if(val > 100) val = 100;
  if(!PDL_WEIGHTS[sec]) PDL_WEIGHTS[sec] = {...PDL_FORMULA_DEFAULTS[sec].weights};
  PDL_WEIGHTS[sec][key] = val;
  // Update total badge
  const total = Object.values(PDL_WEIGHTS[sec]).reduce((a,b)=>a+(Number(b)||0), 0);
  const totalEl = document.getElementById(`pdl-fe-total-${sec}`);
  if(totalEl){
    totalEl.textContent = `Total: ${total}/100`;
    totalEl.classList.toggle('ok', total === 100);
    totalEl.classList.toggle('warn', total !== 100);
  }
  // Update bar fill untuk row yang diubah
  const input = document.querySelector(`input[data-pdl-sec="${sec}"][data-pdl-key="${key}"]`);
  if(input){
    const bar = input.parentElement.querySelector('.pdl-fe-row-bar-fill');
    if(bar) bar.style.width = Math.min(100,val) + '%';
  }
}

function savePdlFormulas(){
  // Warn kalau ada total != 100
  const warnings = [];
  Object.keys(PDL_WEIGHTS).forEach(sec => {
    const total = Object.values(PDL_WEIGHTS[sec]).reduce((a,b)=>a+(Number(b)||0), 0);
    if(total !== 100) warnings.push(`${PDL_FE_SECTION_META[sec].name}: ${total}/100`);
  });
  if(warnings.length){
    if(!confirm(`⚠ Ada section dengan total bobot ≠ 100:\n\n${warnings.join('\n')}\n\nSkor masih bisa dihitung (akan di-clamp ke 0-100), tapi hasilnya bisa tidak konsisten. Simpan tetap?`)) return;
  }
  _savePdlWeights();
  showToast('✓ Formula detail disimpan');
  // Kalau modal PDL lagi terbuka, refresh
  const ov = document.getElementById('pdl-overlay');
  if(ov && ov.classList.contains('open') && _pdlCurrentId != null){
    _renderPdlBody(_pdlCurrentId);
  }
}

function resetPdlFormulasDefault(){
  if(!confirm('Reset semua formula ke default? Perubahanmu akan hilang.')) return;
  Object.keys(PDL_FORMULA_DEFAULTS).forEach(sec => {
    PDL_WEIGHTS[sec] = {...PDL_FORMULA_DEFAULTS[sec].weights};
  });
  _savePdlWeights();
  renderPdlFormulaEditor();
  showToast('↺ Formula direset ke default');
  const ov = document.getElementById('pdl-overlay');
  if(ov && ov.classList.contains('open') && _pdlCurrentId != null){
    _renderPdlBody(_pdlCurrentId);
  }
}

// ============================================================
// [TAHAP4B-1] FIELD MANAGER — Data Model & Render
// ============================================================

// [TAHAP4B-2] State Field Manager — disimpan di localStorage
// customFields: field yang BM tambahkan (custom atau dari template)
// hiddenFields: ID field yang disembunyikan (baik bawaan maupun custom)
// enabledTemplates: ID template yang sudah di-enable (supaya di library ditandai)
// fieldOverrides: edit label untuk field bawaan/custom
let FM_STATE = {
  customFields: {place:[], product:[], price:[], promotion:[], performance:[], gtm:[]},
  hiddenFields: [],
  enabledTemplates: [],
  fieldOverrides: {}
};

(function _loadFmState(){
  try{
    const raw = localStorage.getItem('bm4_fm_state');
    if(!raw) return;
    const saved = JSON.parse(raw);
    if(saved && typeof saved === 'object'){
      if(saved.customFields) FM_STATE.customFields = {...FM_STATE.customFields, ...saved.customFields};
      if(Array.isArray(saved.hiddenFields)) FM_STATE.hiddenFields = saved.hiddenFields;
      if(Array.isArray(saved.enabledTemplates)) FM_STATE.enabledTemplates = saved.enabledTemplates;
      if(saved.fieldOverrides && typeof saved.fieldOverrides === 'object') FM_STATE.fieldOverrides = saved.fieldOverrides;
    }
  }catch(_){}
})();

function _saveFmState(){
  try{ localStorage.setItem('bm4_fm_state', JSON.stringify(FM_STATE)); }catch(_){}
}

// Helper: dapatkan semua field aktif (bawaan + custom, minus hidden) untuk section
function _getFmActiveFields(sec){
  const bawaan = FM_BAWAAN_FIELDS[sec] || [];
  const custom = FM_STATE.customFields[sec] || [];
  const all = [...bawaan.map(f=>({...f, source:'bawaan'})), ...custom.map(f=>({...f, source:'custom'}))];
  // Apply overrides (label edits)
  return all.map(f => {
    const ov = FM_STATE.fieldOverrides[f.id];
    return ov ? {...f, ...ov, id:f.id, source:f.source} : f;
  });
}

// Helper: cek apakah field di-hide
function _isFieldHidden(id){ return FM_STATE.hiddenFields.includes(id); }

// Section meta
const FM_SECTION_META = {
  place:       {emoji:'📍', name:'Place'},
  product:     {emoji:'🏠', name:'Product'},
  price:       {emoji:'💰', name:'Price'},
  promotion:   {emoji:'📢', name:'Promotion'},
  performance: {emoji:'📈', name:'Performance'},
  gtm:         {emoji:'👔', name:'Go-to-Market'}
};

// BAWAAN — Field yang sudah ada di app, dikelompokkan per section
// Semua field ini tersedia di form Tapera & Modal Detail Lengkap
// [FIX B] POI (RS, Kampus, Mall, dll) TIDAK dicantumkan di Place karena dikelola
//         di halaman POI Management sendiri — menghindari fungsi dobel.
const FM_BAWAAN_FIELDS = {
  place: [
    // Place section cuma punya jarak-ke-anchor sebagai field non-POI
    // POI lainnya dikelola di POI Management terpisah
    {id:'dist_anchor',  label:'⭐ Jarak ke Anchor',  type:'number_km', desc:'Jarak ke perumahan anchor (via jalan) — dihitung otomatis', inScore:false}
  ],
  product: [
    {id:'tpr_lt',       label:'📐 Luas Tanah',       type:'text',      desc:'Range atau rata-rata luas tanah (m²)', inScore:true},
    {id:'tpr_lb',       label:'📐 Luas Bangunan',    type:'text',      desc:'Range atau rata-rata luas bangunan (m²)', inScore:true}
  ],
  price: [
    {id:'tpr_harga',    label:'💰 Harga Range',      type:'text',      desc:'Range harga jual (contoh: 150-175 Jt)', inScore:true},
    {id:'tpr_tenor',    label:'📅 Tenor KPR',        type:'text',      desc:'Tenor dominan (contoh: 15 / 20 thn)', inScore:true},
    {id:'tpr_um',       label:'💳 Uang Muka',        type:'text',      desc:'Range DP (contoh: 1-5%)', inScore:true},
    {id:'tpr_bank',     label:'🏦 Bank Dominan',     type:'text',      desc:'Bank KPR yang dominan (contoh: BTN, BRI)', inScore:true}
  ],
  promotion: [
    {id:'tpr_promo_aktif',   label:'🎁 Promo Aktif',     type:'list',    desc:'Daftar promo aktif (comma-separated)', inScore:true},
    {id:'tpr_promo_periode', label:'📅 Periode Promo',   type:'text',    desc:'Periode berlakunya promo', inScore:true},
    {id:'tpr_promo_bonus',   label:'🎉 Bonus Pembelian', type:'list',    desc:'Bonus saat beli (kanopi, AC, dll)', inScore:true},
    {id:'tpr_promo_iklan',   label:'📱 Iklan di Platform', type:'list',  desc:'Kanal iklan (Rumah123, OLX, dll)', inScore:true},
    {id:'tpr_promo_bb',      label:'📢 Billboard/Spanduk', type:'text',  desc:'Billboard aktif atau tidak', inScore:true}
  ],
  performance: [
    {id:'proj_unit',       label:'Total Unit',           type:'number', desc:'Total unit proyek', inScore:false},
    {id:'proj_realisasi',  label:'Realisasi',            type:'number', desc:'Unit yang sudah terjual', inScore:true},
    {id:'proj_progress',   label:'Progress %',           type:'percent',desc:'Persentase serap unit', inScore:true},
    {id:'tpr_avg',         label:'📊 Rata²/bulan',       type:'number', desc:'Rata-rata realisasi per bulan', inScore:false},
    {id:'tpr_trend',       label:'📈 Trend 3-bulan',     type:'text',   desc:'Trend naik/turun 3 bulan terakhir', inScore:true},
    {id:'tpr_total',       label:'Total Realisasi',      type:'number', desc:'Total realisasi Tapera kumulatif', inScore:false},
    {id:'tpr_flpp',        label:'Nominal FLPP',         type:'text',   desc:'Nominal FLPP (M)', inScore:false}
  ],
  gtm: [
    {id:'tpr_gtm_mkt',     label:'👥 Marketing In-house',type:'number',  desc:'Jumlah marketing in-house', inScore:true},
    {id:'tpr_gtm_kanal',   label:'🏢 Struktur Kanal',    type:'text',    desc:'In-house / Agent / Kombinasi', inScore:true},
    {id:'tpr_gtm_agent',   label:'🤝 Jumlah Agent',      type:'number',  desc:'Jumlah agent/mitra jualan', inScore:true},
    {id:'tpr_gtm_fee_mkt', label:'💵 Fee Marketing',     type:'text',    desc:'Fee/komisi marketing (% atau Rp/unit)', inScore:true},
    {id:'tpr_gtm_fee_agt', label:'💵 Fee Agent',         type:'text',    desc:'Fee/komisi agent', inScore:true},
    {id:'tpr_gtm_dev',     label:'🏪 Brand Developer',   type:'text',    desc:'Nama developer/perusahaan', inScore:true}
  ]
};

// LIBRARY TEMPLATE — Field siap pakai, belum aktif
// Dari daftar 88 field awal yang belum diimplementasi
const FM_TEMPLATE_FIELDS = {
  place: [
    {id:'tpl_posisi_jalan',  label:'🛣️ Posisi terhadap jalan', type:'dropdown', options:['Pinggir jalan utama','Masuk gang','Sekunder','Dalam perumahan'], desc:'Dropdown posisi lokasi'},
    {id:'tpl_lebar_jalan',   label:'📏 Lebar jalan masuk',      type:'dropdown', options:['1 mobil','2 mobil','2 mobil + shoulder'], desc:'Dropdown kapasitas jalan'},
    {id:'tpl_kondisi_jalan', label:'🛤️ Kondisi jalan',         type:'dropdown', options:['Aspal mulus','Aspal rusak','Beton','Tanah'], desc:'Dropdown kondisi jalan'},
    {id:'tpl_area_banjir',   label:'🌊 Area banjir?',           type:'yesno',    desc:'Ya/Tidak'},
    {id:'tpl_view',          label:'🏞️ View sekitar',          type:'text',     desc:'Gunung/sawah/pabrik/pemukiman'},
    {id:'tpl_gmaps_rating',  label:'⭐ Rating Google Maps',     type:'number',   desc:'Rating 0-5 dari review Google'}
  ],
  product: [
    {id:'tpl_tipe_rumah',    label:'🏠 Tipe rumah tersedia',    type:'list',     desc:'List tipe (30/60, 36/72, dll)'},
    {id:'tpl_jml_kt',        label:'🛏️ Jumlah KT',             type:'number',   desc:'Jumlah kamar tidur'},
    {id:'tpl_jml_km',        label:'🚿 Jumlah KM',              type:'number',   desc:'Jumlah kamar mandi'},
    {id:'tpl_material',      label:'🧱 Material dinding',       type:'dropdown', options:['Bata merah','Hebel','Batako'], desc:'Dropdown material'},
    {id:'tpl_atap',          label:'🏚️ Material atap',         type:'dropdown', options:['Genteng tanah','Beton','Metal','Lainnya'], desc:'Dropdown atap'},
    {id:'tpl_lantai',        label:'⬜ Material lantai',        type:'dropdown', options:['Keramik','Granit','Polish','Plester'], desc:'Dropdown lantai'},
    {id:'tpl_fasilitas',     label:'🏊 Fasilitas perumahan',   type:'multi',    options:['Gerbang','Satpam 24j','CCTV','Kolam renang','Masjid','Taman','Jogging track','Playground','Sport center','Club house'], desc:'Multi-checkbox fasilitas'},
    {id:'tpl_legalitas',     label:'📄 Legalitas',              type:'dropdown', options:['SHM','HGB','HGB+Strata','AJB'], desc:'Dropdown sertifikat'},
    {id:'tpl_imb',           label:'📜 Status IMB/PBG',         type:'dropdown', options:['Sudah','Proses','Belum'], desc:'Dropdown status IMB'}
  ],
  price: [
    {id:'tpl_harga_per_tipe',label:'💵 Harga per tipe',         type:'list',     desc:'Harga tiap tipe (contoh: 30/60:150Jt, 36/72:175Jt)'},
    {id:'tpl_dp_standar',    label:'💳 DP Standar',             type:'text',     desc:'DP default (contoh: 5% atau 10Jt)'},
    {id:'tpl_dp_promo',      label:'💳 DP Promo',               type:'text',     desc:'DP saat ada promo'},
    {id:'tpl_cicilan',       label:'📅 Cicilan per bulan',      type:'text',     desc:'Range cicilan bulanan'},
    {id:'tpl_skema_kpr',     label:'🏦 Skema KPR',              type:'multi',    options:['FLPP','BP2BT','KPR Subsidi','KPR Konvensional'], desc:'Skema KPR yang tersedia'},
    {id:'tpl_biaya_tambahan',label:'💸 Biaya tambahan',         type:'text',     desc:'Biaya AJB, BPHTB, notaris'}
  ],
  promotion: [
    {id:'tpl_tgl_mulai_promo',label:'📅 Tanggal mulai promo',   type:'date',     desc:'Tanggal mulai berlakunya'},
    {id:'tpl_tgl_akhir_promo',label:'📅 Tanggal akhir promo',   type:'date',     desc:'Tanggal berakhirnya'},
    {id:'tpl_event',          label:'🎪 Event/gathering',        type:'text',    desc:'Open house, pameran, dll'},
    {id:'tpl_hadiah_undian',  label:'🎁 Hadiah undian',          type:'text',    desc:'Grand prize undian (contoh: mobil tiap 100 unit)'},
    {id:'tpl_frek_sosmed',    label:'📱 Frekuensi sosmed',       type:'dropdown', options:['Harian','Mingguan','Jarang','Tidak aktif'], desc:'Seberapa aktif posting sosmed'},
    {id:'tpl_follower_ig',    label:'👥 Follower IG',            type:'number',  desc:'Jumlah follower Instagram'}
  ],
  performance: [
    {id:'tpl_proyeksi_soldout',label:'📊 Proyeksi sold-out',    type:'text',     desc:'Estimasi waktu habis unit'},
    {id:'tpl_gap_launching',   label:'⏱️ Gap launching-first sale', type:'number',  desc:'Bulan dari launching ke first sale'},
    {id:'tpl_booking_aktif',   label:'📋 Booking/NUP aktif',    type:'number',   desc:'Jumlah booking yang belum akad'},
    {id:'tpl_backout_rate',    label:'❌ Pembatalan rate',       type:'text',    desc:'% atau jumlah pembatalan'}
  ],
  gtm: [
    {id:'tpl_jml_agent',       label:'🤝 Jumlah agent/mitra',   type:'number',   desc:'Total agent dari semua tingkat'},
    {id:'tpl_reward_sys',      label:'🎯 Sistem reward',         type:'text',    desc:'Deskripsi reward (contoh: Komisi 1.5% + bonus 500rb/unit)'},
    {id:'tpl_showroom',        label:'🏢 Jumlah showroom',       type:'number',  desc:'Jumlah kantor pemasaran'},
    {id:'tpl_jam_buka',        label:'🕘 Jam buka showroom',    type:'text',     desc:'Contoh: 09:00-17:00'},
    {id:'tpl_thn_berdiri',     label:'📆 Tahun berdiri developer', type:'number',desc:'Tahun perusahaan berdiri'},
    {id:'tpl_reputation',      label:'👤 Reputation signal',    type:'dropdown', options:['Baik','Netral','Ada isu'], desc:'Dropdown reputasi developer'}
  ]
};

// Type labels untuk display
const FM_TYPE_LABELS = {
  text:'Teks', number:'Angka', number_km:'Angka (km)', percent:'Persen %',
  dropdown:'Dropdown', multi:'Multi-check', yesno:'Ya/Tidak', list:'List (,)', date:'Tanggal'
};

// State Field Manager (active section tab)
let _fmCurrentSection = 'place';

// Render tab navigation section
function _renderFmSectionNav(){
  const nav = document.getElementById('fm-section-nav');
  if(!nav) return;
  nav.innerHTML = Object.keys(FM_SECTION_META).map(sec => {
    const meta = FM_SECTION_META[sec];
    const n = (FM_BAWAAN_FIELDS[sec]||[]).length;
    const isActive = sec === _fmCurrentSection;
    return `<button class="fm-sec-btn ${isActive?'active':''}" onclick="fmSwitchSection('${sec}')">${meta.emoji} ${meta.name}<span class="fm-sec-count">(${n})</span></button>`;
  }).join('');
}

function fmSwitchSection(sec){
  _fmCurrentSection = sec;
  _renderFmSectionNav();
  _renderFmActivePanel();
  _renderFmTemplatePanel();
}

// Render panel field aktif (bawaan + custom, termasuk yang di-hide ditandai)
function _renderFmActivePanel(){
  const host = document.getElementById('fm-active-panel');
  if(!host) return;
  const sec = _fmCurrentSection;
  const meta = FM_SECTION_META[sec];
  const fields = _getFmActiveFields(sec);
  // [FIX B] Info box khusus Place: POI tidak muncul di sini
  const placeInfoBox = sec === 'place' ? `<div style="padding:10px 13px;background:#EFF6FF;border-bottom:1px solid var(--border);font-size:10px;color:#1D4ED8;line-height:1.5;">
    💡 <b>POI (RS, Kampus, Mall, Transportasi, Pemerintahan, Industri, Ruang Publik)</b> tidak muncul di sini karena dikelola di halaman <b>POI Management</b> tersendiri. Field Manager hanya untuk mengatur field data tambahan.
  </div>` : '';
  const visibleCount = fields.filter(f=>!_isFieldHidden(f.id)).length;
  const rowsHtml = fields.length ? fields.map(f => {
    const typeLabel = FM_TYPE_LABELS[f.type] || f.type;
    const inScore = f.inScore;
    const isHidden = _isFieldHidden(f.id);
    const isCustom = f.source === 'custom';
    const badge = isCustom
      ? `<span class="fm-badge fm-badge-custom">custom</span>`
      : `<span class="fm-badge fm-badge-bawaan">bawaan</span>`;
    const hiddenBadge = isHidden ? `<span class="fm-badge fm-badge-hidden">disembunyikan</span>` : '';
    return `<div class="fm-row ${isHidden?'hidden-field':''}" data-field-id="${f.id}">
      <div class="fm-row-drag" title="Drag untuk urutkan (segera)">⋮⋮</div>
      <div>
        <div class="fm-row-label">${f.label}${badge}${hiddenBadge}</div>
        <div class="fm-row-desc">${escapeHtml(f.desc||'')}</div>
      </div>
      <div class="fm-type-pill">${typeLabel}</div>
      <div class="fm-score-status ${inScore?'in':'out'}">${inScore?'✓ ke skor':'— display'}</div>
      <div class="fm-actions">
        <button class="fm-btn-icon" title="Edit label" onclick="fmOpenEditModal('${f.id}','${sec}')">✎</button>
        <button class="fm-btn-icon ${isHidden?'active-eye':''}" title="${isHidden?'Tampilkan lagi':'Sembunyikan'}" onclick="fmToggleHide('${f.id}','${sec}')">${isHidden?'👁‍🗨':'👁'}</button>
        <button class="fm-btn-icon del" title="${isCustom?'Hapus field':'Field bawaan tidak bisa dihapus — gunakan Sembunyikan'}" onclick="fmDeleteField('${f.id}','${sec}','${f.source}')">🗑</button>
      </div>
    </div>`;
  }).join('') : `<div class="fm-empty">Belum ada field aktif di section ini.</div>`;
  host.innerHTML = `<div class="fm-panel">
    <div class="fm-panel-head">
      <div>
        <div class="fm-panel-title">${meta.emoji} ${meta.name} — Field Aktif</div>
        <div class="fm-panel-sub">${fields.length} field total (${visibleCount} tampil) — muncul di form input, Vs Anchor, dan Detail Lengkap</div>
      </div>
      <button class="fm-add-btn" onclick="fmOpenCustomWizard('${sec}')" title="Tambah field custom">+ Tambah Custom</button>
    </div>
    ${placeInfoBox}
    ${rowsHtml}
  </div>`;
}

// Render panel template library
function _renderFmTemplatePanel(){
  const host = document.getElementById('fm-template-panel');
  if(!host) return;
  const sec = _fmCurrentSection;
  const meta = FM_SECTION_META[sec];
  const templates = FM_TEMPLATE_FIELDS[sec] || [];
  const rowsHtml = templates.length ? templates.map(t => {
    const typeLabel = FM_TYPE_LABELS[t.type] || t.type;
    const extraDesc = t.options ? ` · ${t.options.slice(0,3).join(' / ')}${t.options.length>3?'...':''}` : '';
    const isEnabled = FM_STATE.enabledTemplates.includes(t.id);
    const btn = isEnabled
      ? `<button class="fm-tpl-enable-btn disabled" disabled title="Sudah aktif">✓ Aktif</button>`
      : `<button class="fm-tpl-enable-btn" onclick="fmEnableTemplate('${t.id}','${sec}')" title="Aktifkan field ini">+ Enable</button>`;
    return `<div class="fm-tpl-row ${isEnabled?'hidden-field':''}" data-tpl-id="${t.id}">
      <div>
        <div class="fm-row-label">${t.label}</div>
        <div class="fm-row-desc">${escapeHtml(t.desc||'')}${extraDesc}</div>
      </div>
      <div class="fm-type-pill">${typeLabel}</div>
      ${btn}
    </div>`;
  }).join('') : `<div class="fm-empty">Tidak ada template untuk section ini.</div>`;
  host.innerHTML = `<div class="fm-panel">
    <div class="fm-panel-head">
      <div>
        <div class="fm-panel-title">🧰 Library Template — ${meta.name}</div>
        <div class="fm-panel-sub">Field siap pakai. Klik "+ Enable" untuk aktifkan.</div>
      </div>
    </div>
    ${rowsHtml}
  </div>`;
}

// ============================================================
// [TAHAP4B-2] Field Manager — Action Handlers (Modal wizard)
// ============================================================

let _fmwContext = null; // context data untuk wizard

function openFmWizard(title, bodyHtml, footerHtml){
  document.getElementById('fmw-title').textContent = title;
  document.getElementById('fmw-body').innerHTML = bodyHtml;
  document.getElementById('fmw-footer').innerHTML = footerHtml;
  document.getElementById('fmw-overlay').classList.add('open');
}
function closeFmWizard(){
  document.getElementById('fmw-overlay').classList.remove('open');
  _fmwContext = null;
}
// ESC handler
document.addEventListener('keydown', function(e){
  if(e.key==='Escape'){
    const ov = document.getElementById('fmw-overlay');
    if(ov && ov.classList.contains('open')) closeFmWizard();
  }
});

// === ENABLE TEMPLATE — aktifkan template jadi custom field ===
function fmEnableTemplate(tplId, sec){
  const tpl = (FM_TEMPLATE_FIELDS[sec]||[]).find(t=>t.id===tplId);
  if(!tpl) return;
  _fmwContext = {mode:'enable_tpl', sec, tpl};
  const optsDesc = tpl.options ? `<div style="margin-top:6px;font-size:10px;color:var(--muted);"><b>Opsi:</b> ${tpl.options.join(', ')}</div>` : '';
  const body = `
    <div class="fmw-info-box">
      Template akan di-enable sebagai field aktif di section <b>${FM_SECTION_META[sec].name}</b>.
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Label field <span class="fmw-label-hint">(bisa diedit)</span></label>
      <input type="text" class="fmw-input" id="fmw-label" value="${escapeHtml(tpl.label)}" />
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Deskripsi</label>
      <textarea class="fmw-textarea" id="fmw-desc">${escapeHtml(tpl.desc||'')}</textarea>
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Tipe input</label>
      <div style="padding:7px 10px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--muted);font-family:'DM Mono',monospace;">${FM_TYPE_LABELS[tpl.type]||tpl.type}</div>
      ${optsDesc}
    </div>
    <div class="fmw-field">
      <div class="fmw-checkbox-row">
        <input type="checkbox" id="fmw-inscore" />
        <label for="fmw-inscore">Masukkan ke perhitungan skor section</label>
      </div>
    </div>
    <div class="fmw-field">
      <div class="fmw-checkbox-row">
        <input type="checkbox" id="fmw-tovsa" checked />
        <label for="fmw-tovsa">Tampilkan di tabel Vs Anchor (direkomendasikan)</label>
      </div>
    </div>
  `;
  const footer = `
    <button class="fmw-btn-cancel" onclick="closeFmWizard()">Batal</button>
    <button class="fmw-btn-primary" onclick="fmConfirmEnableTemplate()">✓ Enable Field</button>
  `;
  openFmWizard(`➕ Enable Template: ${tpl.label}`, body, footer);
}

function fmConfirmEnableTemplate(){
  if(!_fmwContext || _fmwContext.mode !== 'enable_tpl') return;
  const {sec, tpl} = _fmwContext;
  const label = document.getElementById('fmw-label').value.trim() || tpl.label;
  const desc = document.getElementById('fmw-desc').value.trim() || tpl.desc || '';
  const inScore = document.getElementById('fmw-inscore').checked;
  const toVsa = document.getElementById('fmw-tovsa').checked;
  // Build field baru
  const newField = {
    id: tpl.id,  // pakai id template (stabil)
    label, desc,
    type: tpl.type,
    options: tpl.options || null,
    inScore
  };
  if(!FM_STATE.customFields[sec]) FM_STATE.customFields[sec] = [];
  // Cek duplikasi
  if(FM_STATE.customFields[sec].some(f=>f.id===newField.id)){
    alert('Field dengan ID ini sudah ada. Tidak bisa enable dua kali.');
    return;
  }
  FM_STATE.customFields[sec].push(newField);
  if(!FM_STATE.enabledTemplates.includes(tpl.id)) FM_STATE.enabledTemplates.push(tpl.id);
  _saveFmState();
  // Sync ke Kategori Vs Anchor kalau diminta
  if(toVsa) _fmSyncToVsaCategory(newField.id, label, sec);
  closeFmWizard();
  showToast(`✓ Field "${label}" aktif` + (toVsa?' & tampil di Vs Anchor':''));
  renderFieldManager();
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') try{renderDetailCompare(p);}catch(_){}
  }
}

// === TAMBAH CUSTOM FIELD WIZARD ===
function fmOpenCustomWizard(sec){
  _fmwContext = {mode:'add_custom', sec};
  const typeOpts = Object.keys(FM_TYPE_LABELS).map(t =>
    `<option value="${t}">${FM_TYPE_LABELS[t]}</option>`
  ).join('');
  const body = `
    <div class="fmw-info-box">
      Tambah field baru di section <b>${FM_SECTION_META[sec].name}</b>. Field ini akan muncul di form input, Detail Lengkap, dan (opsional) tabel Vs Anchor.
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Label field <span class="fmw-label-hint">(contoh: "Material lantai")</span></label>
      <input type="text" class="fmw-input" id="fmw-label" placeholder="Nama field yang BM lihat" />
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Deskripsi <span class="fmw-label-hint">(opsional, bantu BM ingat cara isi)</span></label>
      <textarea class="fmw-textarea" id="fmw-desc" placeholder="Contoh: Material utama lantai rumah — keramik / granit / polish"></textarea>
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Tipe input</label>
      <select class="fmw-select" id="fmw-type" onchange="_fmOnTypeChange(this.value)">${typeOpts}</select>
    </div>
    <div class="fmw-field" id="fmw-options-wrap" style="display:none;">
      <label class="fmw-label">Pilihan <span class="fmw-label-hint">(pisahkan dengan koma)</span></label>
      <input type="text" class="fmw-input" id="fmw-options" placeholder="Contoh: Keramik, Granit, Polish, Plester" />
    </div>
    <div class="fmw-field">
      <div class="fmw-checkbox-row">
        <input type="checkbox" id="fmw-inscore" />
        <label for="fmw-inscore">Masukkan ke perhitungan skor section</label>
      </div>
    </div>
    <div class="fmw-field">
      <div class="fmw-checkbox-row">
        <input type="checkbox" id="fmw-tovsa" checked />
        <label for="fmw-tovsa">Tampilkan di tabel Vs Anchor</label>
      </div>
    </div>
  `;
  const footer = `
    <button class="fmw-btn-cancel" onclick="closeFmWizard()">Batal</button>
    <button class="fmw-btn-primary" onclick="fmConfirmAddCustom()">+ Tambah Field</button>
  `;
  openFmWizard(`➕ Tambah Field Custom — ${FM_SECTION_META[sec].name}`, body, footer);
}

function _fmOnTypeChange(type){
  const wrap = document.getElementById('fmw-options-wrap');
  if(!wrap) return;
  wrap.style.display = (type === 'dropdown' || type === 'multi') ? 'block' : 'none';
}

function fmConfirmAddCustom(){
  if(!_fmwContext || _fmwContext.mode !== 'add_custom') return;
  const sec = _fmwContext.sec;
  const label = document.getElementById('fmw-label').value.trim();
  const desc = document.getElementById('fmw-desc').value.trim();
  const type = document.getElementById('fmw-type').value;
  const optsRaw = document.getElementById('fmw-options')?.value.trim() || '';
  const inScore = document.getElementById('fmw-inscore').checked;
  const toVsa = document.getElementById('fmw-tovsa').checked;
  if(!label){ alert('Label field wajib diisi.'); return; }
  let options = null;
  if(type === 'dropdown' || type === 'multi'){
    options = optsRaw.split(',').map(s=>s.trim()).filter(Boolean);
    if(options.length < 2){ alert('Dropdown/Multi butuh minimal 2 pilihan.'); return; }
  }
  // Generate unique ID
  const slugBase = label.toLowerCase()
    .replace(/[^\w\s]/g,'').trim()
    .replace(/\s+/g,'_').slice(0, 30);
  let id = `custom_${sec}_${slugBase}`;
  let counter = 1;
  const allIds = [...(FM_BAWAAN_FIELDS[sec]||[]), ...(FM_STATE.customFields[sec]||[])].map(f=>f.id);
  while(allIds.includes(id)){ id = `custom_${sec}_${slugBase}_${counter++}`; }
  const newField = { id, label, desc, type, options, inScore };
  if(!FM_STATE.customFields[sec]) FM_STATE.customFields[sec] = [];
  FM_STATE.customFields[sec].push(newField);
  _saveFmState();
  if(toVsa) _fmSyncToVsaCategory(id, label, sec);
  closeFmWizard();
  showToast(`✓ Field "${label}" ditambahkan` + (toVsa?' & tampil di Vs Anchor':''));
  renderFieldManager();
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') try{renderDetailCompare(p);}catch(_){}
  }
}

// === EDIT FIELD LABEL ===
function fmOpenEditModal(fieldId, sec){
  const fields = _getFmActiveFields(sec);
  const f = fields.find(x=>x.id===fieldId);
  if(!f) return;
  _fmwContext = {mode:'edit', fieldId, sec, field:f};
  const optionsHtml = (f.options && (f.type==='dropdown'||f.type==='multi')) ? `
    <div class="fmw-field">
      <label class="fmw-label">Pilihan</label>
      <input type="text" class="fmw-input" id="fmw-options" value="${escapeHtml(f.options.join(', '))}" />
    </div>
  ` : '';
  const sourceNote = f.source === 'bawaan'
    ? '<div class="fmw-info-box">ℹ️ Field ini adalah <b>bawaan</b> — kamu hanya bisa edit label & deskripsi. Tipe input dan logic skor tidak bisa diubah.</div>'
    : '';
  const body = `
    ${sourceNote}
    <div class="fmw-field">
      <label class="fmw-label">Label field</label>
      <input type="text" class="fmw-input" id="fmw-label" value="${escapeHtml(f.label)}" />
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Deskripsi</label>
      <textarea class="fmw-textarea" id="fmw-desc">${escapeHtml(f.desc||'')}</textarea>
    </div>
    ${f.source === 'custom' ? optionsHtml : ''}
    ${f.source === 'custom' ? `
      <div class="fmw-field">
        <div class="fmw-checkbox-row">
          <input type="checkbox" id="fmw-inscore" ${f.inScore?'checked':''} />
          <label for="fmw-inscore">Masukkan ke perhitungan skor section</label>
        </div>
      </div>
    ` : ''}
  `;
  const footer = `
    <button class="fmw-btn-cancel" onclick="closeFmWizard()">Batal</button>
    <button class="fmw-btn-primary" onclick="fmConfirmEdit()">💾 Simpan</button>
  `;
  openFmWizard(`✎ Edit Field: ${f.label}`, body, footer);
}

function fmConfirmEdit(){
  if(!_fmwContext || _fmwContext.mode !== 'edit') return;
  const {fieldId, sec, field} = _fmwContext;
  const label = document.getElementById('fmw-label').value.trim();
  const desc = document.getElementById('fmw-desc').value.trim();
  if(!label){ alert('Label tidak boleh kosong.'); return; }
  if(field.source === 'custom'){
    const optsRaw = document.getElementById('fmw-options')?.value.trim() || '';
    const inScore = document.getElementById('fmw-inscore')?.checked || false;
    const cf = FM_STATE.customFields[sec].find(x=>x.id===fieldId);
    if(cf){
      cf.label = label;
      cf.desc = desc;
      cf.inScore = inScore;
      if(field.type === 'dropdown' || field.type === 'multi'){
        cf.options = optsRaw.split(',').map(s=>s.trim()).filter(Boolean);
      }
    }
  } else {
    FM_STATE.fieldOverrides[fieldId] = {label, desc};
  }
  _saveFmState();
  // Update Kategori Vs Anchor label kalau ada
  _fmUpdateVsaCategoryLabel(fieldId, label);
  closeFmWizard();
  showToast(`✓ Field "${label}" diupdate`);
  renderFieldManager();
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') try{renderDetailCompare(p);}catch(_){}
  }
}

// === HIDE / SHOW FIELD ===
function fmToggleHide(fieldId, sec){
  const idx = FM_STATE.hiddenFields.indexOf(fieldId);
  if(idx >= 0){
    FM_STATE.hiddenFields.splice(idx, 1);
    showToast('👁 Field ditampilkan kembali');
  } else {
    FM_STATE.hiddenFields.push(fieldId);
    showToast('🫥 Field disembunyikan');
  }
  _saveFmState();
  renderFieldManager();
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') try{renderDetailCompare(p);}catch(_){}
  }
}

// === HAPUS FIELD ===
function fmDeleteField(fieldId, sec, source){
  if(source === 'bawaan'){
    alert('Field bawaan tidak bisa dihapus. Gunakan tombol 👁 untuk menyembunyikan.');
    return;
  }
  const cf = (FM_STATE.customFields[sec]||[]).find(x=>x.id===fieldId);
  if(!cf) return;
  _fmwContext = {mode:'delete', fieldId, sec};
  const body = `
    <div class="fmw-warn-box">
      ⚠️ <b>Hapus field "${escapeHtml(cf.label)}"?</b><br>
      Semua data yang sudah diisi BM di field ini akan ikut terhapus di semua perumahan. Aksi ini tidak bisa di-undo.
    </div>
  `;
  const footer = `
    <button class="fmw-btn-cancel" onclick="closeFmWizard()">Batal</button>
    <button class="fmw-btn-danger" onclick="fmConfirmDelete()">🗑 Ya, Hapus</button>
  `;
  openFmWizard(`🗑 Hapus Field`, body, footer);
}

function fmConfirmDelete(){
  if(!_fmwContext || _fmwContext.mode !== 'delete') return;
  const {fieldId, sec} = _fmwContext;
  // Hapus dari customFields
  FM_STATE.customFields[sec] = (FM_STATE.customFields[sec]||[]).filter(f=>f.id!==fieldId);
  // Hapus dari hiddenFields kalau ada
  FM_STATE.hiddenFields = FM_STATE.hiddenFields.filter(id=>id!==fieldId);
  // Hapus dari enabledTemplates kalau ada
  FM_STATE.enabledTemplates = FM_STATE.enabledTemplates.filter(id=>id!==fieldId);
  // Hapus override label kalau ada
  delete FM_STATE.fieldOverrides[fieldId];
  // Hapus data dari semua perumahan
  perumahan.forEach(p => {
    if(p.customFields && p.customFields[fieldId] !== undefined){
      delete p.customFields[fieldId];
    }
  });
  // Hapus dari VSA_SECTIONS
  VSA_SECTIONS.forEach(s => {
    if(Array.isArray(s.rows)) s.rows = s.rows.filter(k=>k!==fieldId);
  });
  _saveFmState();
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  try{ localStorage.setItem('bm4_vsa_sections', JSON.stringify(VSA_SECTIONS)); }catch(_){}
  closeFmWizard();
  showToast('🗑 Field dihapus');
  renderFieldManager();
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') try{renderDetailCompare(p);}catch(_){}
  }
}

// ============================================================
// [TAHAP4B-2] Sinkronisasi Field Manager → Kategori Vs Anchor
// ============================================================
// Tambah field baru ke section yang sesuai di VSA_SECTIONS
function _fmSyncToVsaCategory(fieldId, label, sec){
  // Section ID di Field Manager sama dengan di VSA_SECTIONS
  const vsaSec = VSA_SECTIONS.find(s=>s.id===sec);
  if(!vsaSec){
    // Section tidak ada di VSA — skip (seharusnya tidak terjadi)
    return;
  }
  // Cek kalau sudah ada
  if(!vsaSec.rows.includes(fieldId)){
    vsaSec.rows.push(fieldId);
  }
  // Juga tambah ke VSA_ROW_DEFS supaya bisa di-render
  const existsInDef = VSA_ROW_DEFS.some(d=>d.key===fieldId);
  if(!existsInDef){
    VSA_ROW_DEFS.push({key: fieldId, label: label});
    VSA_ROW_KEYS.push(fieldId);
    VSA_ROW_LABEL[fieldId] = label;
  }
  try{ localStorage.setItem('bm4_vsa_sections', JSON.stringify(VSA_SECTIONS)); }catch(_){}
}

// Update label di VSA_ROW_DEFS kalau user edit label di Field Manager
function _fmUpdateVsaCategoryLabel(fieldId, newLabel){
  const def = VSA_ROW_DEFS.find(d=>d.key===fieldId);
  if(def) def.label = newLabel;
  VSA_ROW_LABEL[fieldId] = newLabel;
}

// Boot-time: auto-register custom fields yang sudah ada ke VSA_ROW_DEFS
(function _fmBootRegisterCustomFields(){
  Object.keys(FM_STATE.customFields||{}).forEach(sec => {
    (FM_STATE.customFields[sec]||[]).forEach(f => {
      const existsInDef = VSA_ROW_DEFS.some(d=>d.key===f.id);
      if(!existsInDef){
        VSA_ROW_DEFS.push({key: f.id, label: f.label});
        if(!VSA_ROW_KEYS.includes(f.id)) VSA_ROW_KEYS.push(f.id);
        VSA_ROW_LABEL[f.id] = f.label;
      }
    });
  });
})();

// Render utama (dipanggil dari switchHubTab)
function renderFieldManager(){
  _renderFmSectionNav();
  _renderFmActivePanel();
  _renderFmTemplatePanel();
}

// ============================================================
// [GAP ANALYSIS] — Laporan kelengkapan data per perumahan
// ============================================================

// Filter state
let _gapFilter = {section:'all', sortBy:'completeness_asc'};

// Helper: dapatkan daftar field aktif yang terhitung untuk gap analysis
// Return: [{id, label, section, type, getter:function(p)}]
function _gapGetActiveFields(){
  const result = [];
  const sections = ['place','product','price','promotion','performance','gtm'];
  // Bawaan fields dengan path ke data-nya
  const BAWAAN_PATHS = {
    // Place — hanya dist_anchor (POI dihandle terpisah, hidden dari FM)
    'dist_anchor':   {section:'place', getter: p => p.lat != null && p.lng != null}, // anggap auto terisi kalau ada koordinat
    // Product
    'tpr_lt':        {section:'product',  getter: p => p.tapera?.luasTanah?.trim()},
    'tpr_lb':        {section:'product',  getter: p => p.tapera?.luasBangunan?.trim()},
    // Price
    'tpr_harga':     {section:'price',    getter: p => p.tapera?.hargaRange?.trim()},
    'tpr_tenor':     {section:'price',    getter: p => p.tapera?.tenorDominan?.trim()},
    'tpr_um':        {section:'price',    getter: p => p.tapera?.uangMukaRange?.trim()},
    'tpr_bank':      {section:'price',    getter: p => p.tapera?.bankDominan?.trim()},
    // Promotion
    'tpr_promo_aktif':   {section:'promotion', getter: p => p.tapera?.promotion?.promoAktif?.trim()},
    'tpr_promo_periode': {section:'promotion', getter: p => p.tapera?.promotion?.periode?.trim()},
    'tpr_promo_bonus':   {section:'promotion', getter: p => p.tapera?.promotion?.bonus?.trim()},
    'tpr_promo_iklan':   {section:'promotion', getter: p => p.tapera?.promotion?.iklanPlatform?.trim()},
    'tpr_promo_bb':      {section:'promotion', getter: p => p.tapera?.promotion?.billboard?.trim()},
    // Performance
    'proj_unit':         {section:'performance', getter: p => p.unit > 0},
    'proj_realisasi':    {section:'performance', getter: p => p.realisasi > 0},
    'proj_progress':     {section:'performance', getter: p => p.unit > 0 && p.realisasi != null},
    'tpr_avg':           {section:'performance', getter: p => (p.tapera?.realisasiBulanan||[]).length >= 2},
    'tpr_trend':         {section:'performance', getter: p => (p.tapera?.realisasiBulanan||[]).length >= 4},
    'tpr_total':         {section:'performance', getter: p => p.tapera?.totalRealisasi > 0},
    'tpr_flpp':          {section:'performance', getter: p => p.tapera?.nominalFLPP},
    // GTM
    'tpr_gtm_mkt':       {section:'gtm', getter: p => p.tapera?.gtm?.marketingInhouse != null},
    'tpr_gtm_kanal':     {section:'gtm', getter: p => p.tapera?.gtm?.strukturKanal?.trim()},
    'tpr_gtm_agent':     {section:'gtm', getter: p => p.tapera?.gtm?.jumlahAgent != null},
    'tpr_gtm_fee_mkt':   {section:'gtm', getter: p => p.tapera?.gtm?.feeMarketing?.trim()},
    'tpr_gtm_fee_agt':   {section:'gtm', getter: p => p.tapera?.gtm?.feeAgent?.trim()},
    'tpr_gtm_dev':       {section:'gtm', getter: p => p.tapera?.gtm?.brandDeveloper?.trim()}
  };
  // Tambahin bawaan yang aktif (not hidden)
  sections.forEach(secId => {
    (FM_BAWAAN_FIELDS[secId] || []).forEach(f => {
      if(_isFieldHidden(f.id)) return;
      const meta = BAWAAN_PATHS[f.id];
      if(!meta) return; // field yang belum di-map, skip
      result.push({
        id: f.id,
        label: f.label,
        section: meta.section,
        type: f.type,
        getter: meta.getter
      });
    });
  });
  // Tambahin custom fields
  sections.forEach(secId => {
    (FM_STATE.customFields[secId] || []).forEach(f => {
      if(_isFieldHidden(f.id)) return;
      result.push({
        id: f.id,
        label: f.label,
        section: secId,
        type: f.type,
        getter: p => {
          const v = p.customFields?.[f.id];
          if(v == null || v === '') return false;
          if(Array.isArray(v)) return v.length > 0;
          return true;
        }
      });
    });
  });
  return result;
}

// Helper: hitung kelengkapan per perumahan
function _gapCalcCompleteness(p, activeFields){
  const bySection = {place:{total:0,filled:0,missing:[]}, product:{total:0,filled:0,missing:[]},
    price:{total:0,filled:0,missing:[]}, promotion:{total:0,filled:0,missing:[]},
    performance:{total:0,filled:0,missing:[]}, gtm:{total:0,filled:0,missing:[]}};
  activeFields.forEach(f => {
    if(!bySection[f.section]) return;
    bySection[f.section].total++;
    let filled = false;
    try{ filled = !!f.getter(p); }catch(_){}
    if(filled) bySection[f.section].filled++;
    else bySection[f.section].missing.push({id:f.id, label:f.label});
  });
  const total = Object.values(bySection).reduce((a,b)=>a+b.total, 0);
  const filled = Object.values(bySection).reduce((a,b)=>a+b.filled, 0);
  const pct = total > 0 ? Math.round(filled/total*100) : 0;
  return {bySection, total, filled, missing:total-filled, pct};
}

// Main renderer
function renderGapAnalysis(){
  const activeFields = _gapGetActiveFields();
  if(!activeFields.length){
    document.getElementById('gap-stats-summary').innerHTML = '';
    document.getElementById('gap-analysis-body').innerHTML = `<div class="gap-empty">Tidak ada field aktif yang bisa dianalisa.</div>`;
    return;
  }
  // Hitung untuk semua perumahan
  const perumData = perumahan.map(p => ({
    p,
    gap: _gapCalcCompleteness(p, activeFields)
  }));
  // Sort
  const sorted = [...perumData];
  if(_gapFilter.sortBy === 'completeness_asc'){
    sorted.sort((a,b) => a.gap.pct - b.gap.pct);
  } else if(_gapFilter.sortBy === 'completeness_desc'){
    sorted.sort((a,b) => b.gap.pct - a.gap.pct);
  } else if(_gapFilter.sortBy === 'nama'){
    sorted.sort((a,b) => (a.p.nama||'').localeCompare(b.p.nama||''));
  }
  // Summary stats
  const totalPerum = perumData.length;
  const fullPerum = perumData.filter(x => x.gap.pct === 100).length;
  const partialPerum = perumData.filter(x => x.gap.pct > 0 && x.gap.pct < 100).length;
  const emptyPerum = perumData.filter(x => x.gap.pct === 0).length;
  const avgPct = totalPerum ? Math.round(perumData.reduce((a,b)=>a+b.gap.pct, 0) / totalPerum) : 0;
  const avgClass = avgPct >= 75 ? 'good' : (avgPct >= 50 ? 'mid' : 'bad');
  document.getElementById('gap-stats-summary').innerHTML = `<div class="gap-summary">
    <div class="gap-stat-card">
      <div class="gap-stat-val">${totalPerum}</div>
      <div class="gap-stat-lbl">Total Perum</div>
    </div>
    <div class="gap-stat-card">
      <div class="gap-stat-val ${avgClass}">${avgPct}%</div>
      <div class="gap-stat-lbl">Rata² Lengkap</div>
    </div>
    <div class="gap-stat-card">
      <div class="gap-stat-val good">${fullPerum}</div>
      <div class="gap-stat-lbl">100% Lengkap</div>
    </div>
    <div class="gap-stat-card">
      <div class="gap-stat-val bad">${emptyPerum}</div>
      <div class="gap-stat-lbl">Tanpa Data</div>
    </div>
  </div>`;
  // Filter section & sort
  const filterHtml = `<div class="gap-filters">
    <span class="gap-filter-lbl">Filter Section:</span>
    <select class="gap-filter-select" onchange="gapSetFilter('section', this.value)">
      <option value="all" ${_gapFilter.section==='all'?'selected':''}>Semua Section</option>
      <option value="place" ${_gapFilter.section==='place'?'selected':''}>📍 Place</option>
      <option value="product" ${_gapFilter.section==='product'?'selected':''}>🏠 Product</option>
      <option value="price" ${_gapFilter.section==='price'?'selected':''}>💰 Price</option>
      <option value="promotion" ${_gapFilter.section==='promotion'?'selected':''}>📢 Promotion</option>
      <option value="performance" ${_gapFilter.section==='performance'?'selected':''}>📈 Performance</option>
      <option value="gtm" ${_gapFilter.section==='gtm'?'selected':''}>👔 GTM</option>
    </select>
    <span class="gap-filter-lbl" style="margin-left:8px;">Urutkan:</span>
    <select class="gap-filter-select" onchange="gapSetFilter('sortBy', this.value)">
      <option value="completeness_asc" ${_gapFilter.sortBy==='completeness_asc'?'selected':''}>Paling tidak lengkap dulu</option>
      <option value="completeness_desc" ${_gapFilter.sortBy==='completeness_desc'?'selected':''}>Paling lengkap dulu</option>
      <option value="nama" ${_gapFilter.sortBy==='nama'?'selected':''}>Nama (A-Z)</option>
    </select>
  </div>`;
  // Render list
  const SEC_EMOJI = {place:'📍',product:'🏠',price:'💰',promotion:'📢',performance:'📈',gtm:'👔'};
  const rowsHtml = sorted.map(({p, gap}) => {
    // Kalau filter section aktif, hitung per section saja
    let displayPct, displayFilled, displayTotal, sectionFocus;
    if(_gapFilter.section !== 'all'){
      const s = gap.bySection[_gapFilter.section];
      displayPct = s.total > 0 ? Math.round(s.filled/s.total*100) : 0;
      displayFilled = s.filled;
      displayTotal = s.total;
      sectionFocus = _gapFilter.section;
    } else {
      displayPct = gap.pct;
      displayFilled = gap.filled;
      displayTotal = gap.total;
    }
    const barClass = displayPct >= 75 ? 'good' : (displayPct >= 40 ? 'mid' : 'bad');
    // Section dots (hanya kalau filter = all)
    const secDots = _gapFilter.section === 'all'
      ? `<div class="gap-row-sections">${Object.keys(gap.bySection).map(s => {
          const ss = gap.bySection[s];
          if(ss.total === 0) return '';
          const p2 = Math.round(ss.filled/ss.total*100);
          const cls = p2 === 100 ? 'full' : (p2 > 0 ? 'partial' : 'empty');
          return `<span class="gap-sec-dot ${cls}" title="${SEC_EMOJI[s]} ${p2}% (${ss.filled}/${ss.total})">${SEC_EMOJI[s]} ${p2}%</span>`;
        }).join('')}</div>`
      : '';
    const isAnchor = p.id === ANCHOR_ID;
    return `<div class="gap-row" onclick="gapOpenEditor(${p.id})">
      <div>
        <div class="gap-row-nama">${isAnchor?'<span class="anchor">⭐</span>':''}${escapeHtml(p.nama)}</div>
        <div class="gap-row-area">${escapeHtml(p.area||'—')} · ${escapeHtml(p.developer||'—')}</div>
        ${secDots}
      </div>
      <div class="gap-bar-wrap">
        <div class="gap-bar-fill ${barClass}" style="width:${displayPct}%"></div>
        <div class="gap-bar-text">${displayPct}%</div>
      </div>
      <div class="gap-missing-count"><b>${displayFilled}</b>/${displayTotal} field terisi</div>
      <button class="gap-action-btn" onclick="event.stopPropagation(); gapOpenEditor(${p.id})" title="Buka editor data">✎ Edit</button>
    </div>`;
  }).join('');
  document.getElementById('gap-analysis-body').innerHTML = filterHtml + `<div class="gap-list">${rowsHtml || '<div class="gap-empty">Tidak ada perumahan.</div>'}</div>`;
}

function gapSetFilter(key, val){
  _gapFilter[key] = val;
  renderGapAnalysis();
}

function gapOpenEditor(perumId){
  // Tutup Hub Formula modal, lalu buka Tapera editor untuk perumahan ini
  const ov = document.getElementById('admin-overlay');
  if(ov) ov.classList.remove('open');
  // Pastikan Tapera editor terbuka
  try{
    if(typeof switchEditorTab === 'function'){
      switchEditorTab('tapera');
    }
    const sel = document.getElementById('tpr-select');
    if(sel){
      sel.value = String(perumId);
      if(typeof loadTaperaForm === 'function') loadTaperaForm(String(perumId));
    }
    // Jika editor tidak terbuka otomatis, trigger toggleEditor() yang benar
    const editorOverlay = document.getElementById('editor-overlay');
    if(editorOverlay && !editorOverlay.classList.contains('open') && typeof toggleEditor === 'function'){
      toggleEditor();
      // Setelah editor terbuka, pilih perumahan yang di-klik di Gap Analysis
      setTimeout(() => {
        const sel2 = document.getElementById('tpr-select');
        if(sel2){
          sel2.value = String(perumId);
          if(typeof loadTaperaForm === 'function') loadTaperaForm(String(perumId));
        }
      }, 150);
    }
    showToast(`✎ Buka editor untuk "${(perumahan.find(x=>x.id===perumId)||{}).nama||'perumahan'}"`);
  }catch(e){
    console.warn('gap open editor err', e);
    showToast('Buka menu Edit Data manual untuk perumahan ini');
  }
}

// ============================================================
// [DASHBOARD RANKING] — Ranking perumahan dengan mini radar chart
// ============================================================

let _drnkState = {sortBy:'avg', limit:10};

function drnkSetSortBy(v){ _drnkState.sortBy = v; renderDashboardRanking(); }
function drnkSetLimit(v){ _drnkState.limit = parseInt(v)||0; renderDashboardRanking(); }

// Build SVG radar chart kecil (6 axis: Place, Product, Price, Promotion, Performance, GTM)
function _drnkBuildRadar(scores, size=92){
  const cx = size/2;
  const cy = size/2;
  const r = size/2 - 10; // padding untuk label kecil
  const axes = [
    {id:'place',       label:'P', angle:-90},
    {id:'product',     label:'Pr',angle:-30},
    {id:'price',       label:'$', angle: 30},
    {id:'promotion',   label:'M', angle: 90},
    {id:'performance', label:'%', angle:150},
    {id:'gtm',         label:'G', angle:210}
  ];
  // Grid polygon (2 ring: 50% & 100%)
  const ring = (frac) => axes.map(a => {
    const rad = a.angle * Math.PI/180;
    const x = cx + r*frac*Math.cos(rad);
    const y = cy + r*frac*Math.sin(rad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Data polygon
  const dataPts = axes.map(a => {
    const frac = Math.max(0, Math.min(100, scores[a.id]||0)) / 100;
    const rad = a.angle * Math.PI/180;
    const x = cx + r*frac*Math.cos(rad);
    const y = cy + r*frac*Math.sin(rad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Axis lines
  const axesLines = axes.map(a => {
    const rad = a.angle * Math.PI/180;
    const x = cx + r*Math.cos(rad);
    const y = cy + r*Math.sin(rad);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#E5E7EB" stroke-width="0.5"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;">
    <polygon points="${ring(1)}" fill="none" stroke="#E5E7EB" stroke-width="1"/>
    <polygon points="${ring(0.5)}" fill="none" stroke="#E5E7EB" stroke-width="0.5" stroke-dasharray="2,2"/>
    ${axesLines}
    <polygon points="${dataPts}" fill="rgba(37,99,235,0.25)" stroke="#2563EB" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

function renderDashboardRanking(){
  const host = document.getElementById('drnk-cards');
  if(!host) return;
  if(!Array.isArray(perumahan) || !perumahan.length){
    host.innerHTML = `<div class="drnk-empty">Belum ada perumahan. Tambah perumahan dulu di menu Edit Data.</div>`;
    return;
  }
  // Compute semua scores
  const data = perumahan.map(p => {
    let scores;
    try{ scores = _calcAllSectionScores(p); }
    catch(_){ scores = {place:0,product:0,price:0,promotion:0,performance:0,gtm:0,avg:0}; }
    return {p, scores};
  });
  // Sort
  const sortKey = _drnkState.sortBy;
  data.sort((a, b) => (b.scores[sortKey]||0) - (a.scores[sortKey]||0));
  // Limit
  const limit = _drnkState.limit;
  const shown = limit > 0 ? data.slice(0, limit) : data;
  // Section label untuk header card
  const SEC_LBL = {avg:'Rata² 6 Dimensi', place:'📍 Place', product:'🏠 Product', price:'💰 Price',
    promotion:'📢 Promotion', performance:'📈 Performance', gtm:'👔 GTM'};
  const sectagText = SEC_LBL[sortKey] || sortKey;
  // Render cards
  const cardsHtml = shown.map((item, idx) => {
    const {p, scores} = item;
    const displayedScore = scores[sortKey] || 0;
    const rankNum = idx + 1;
    const rankClass = rankNum === 1 ? 'top1' : (rankNum <= 3 ? 'top3' : '');
    const scoreClass = displayedScore >= 75 ? 'good' : (displayedScore >= 50 ? 'mid' : 'bad');
    const isAnchor = p.id === ANCHOR_ID;
    const radarSvg = _drnkBuildRadar(scores, 92);
    return `<div class="drnk-card ${isAnchor?'anchor':''}" onclick="drnkOpenDetail(${p.id})" title="Klik untuk detail lengkap">
      <div class="drnk-card-left">
        <div class="drnk-card-rank">
          <span class="drnk-rank-num ${rankClass}">#${rankNum}</span>
          ${isAnchor?'<span class="drnk-anchor-badge">⭐ ANCHOR</span>':''}
        </div>
        <div class="drnk-card-nama">${escapeHtml(p.nama)}</div>
        <div class="drnk-card-area">${escapeHtml(p.area||'—')}</div>
        <div class="drnk-card-score">
          <span class="drnk-card-score-num ${scoreClass}">${displayedScore}</span>
          <span class="drnk-card-score-max">/100</span>
        </div>
        <div class="drnk-card-sectag">${sectagText}</div>
      </div>
      <div class="drnk-card-radar" title="Skor 6 dimensi: P=Place, Pr=Product, $=Price, M=Promotion, %=Performance, G=GTM">${radarSvg}</div>
    </div>`;
  }).join('');
  host.innerHTML = cardsHtml || `<div class="drnk-empty">Tidak ada data perumahan.</div>`;
}

// Buka modal Detail Lengkap saat card diklik
function drnkOpenDetail(perumId){
  // Switch ke tab Analisa dulu supaya konteks perumahan aktif, baru buka PDL modal
  try{
    if(typeof openPdlModal === 'function'){
      openPdlModal(perumId);
    }
  }catch(e){
    console.warn('drnk open err', e);
    showToast('Klik ikon Analisa Lokasi lalu pilih perumahan untuk detail lengkap');
  }
}

// ============================================================
// [PDF EXPORT] — via window.print() + CSS @media print
// ============================================================

function printPdlModal(){
  // Pastikan modal sedang terbuka
  const ov = document.getElementById('pdl-overlay');
  if(!ov || !ov.classList.contains('open')){
    showToast('Buka Detail Lengkap dulu sebelum cetak');
    return;
  }
  document.body.classList.add('printing-pdl');
  // Tunggu sejenak supaya CSS applied sebelum print dialog muncul
  setTimeout(() => {
    try{
      window.print();
    }catch(e){
      console.warn('print err', e);
      showToast('⚠️ Gagal membuka dialog print');
    }
    // Cleanup setelah print dialog ditutup
    setTimeout(() => {
      document.body.classList.remove('printing-pdl');
    }, 100);
  }, 100);
}

function printDashboardRanking(){
  // Pastikan dashboard aktif
  const dashPane = document.querySelector('[data-div="dashboard"].active, .divisi-pane.active');
  if(!document.getElementById('drnk-cards')){
    showToast('Buka tab Dashboard dulu sebelum cetak');
    return;
  }
  document.body.classList.add('printing-ranking');
  setTimeout(() => {
    try{
      window.print();
    }catch(e){
      console.warn('print err', e);
      showToast('⚠️ Gagal membuka dialog print');
    }
    setTimeout(() => {
      document.body.classList.remove('printing-ranking');
    }, 100);
  }, 100);
}

// Safety: clean up class kalau user menutup print dialog
window.addEventListener('afterprint', function(){
  document.body.classList.remove('printing-pdl');
  document.body.classList.remove('printing-ranking');
});

// Pilih class CSS berdasarkan skor
function _pdlScoreClass(score){
  if(score >= 75) return 's-high';
  if(score >= 50) return 's-mid';
  return 's-low';
}

// Generate verdict per section (auto-generated narasi)
function _genSectionVerdict(sectionId, p, score){
  const t = p.tapera || {};
  const sd = p._scoreDetail || calcScoreFull(p);
  switch(sectionId){
    case 'place': {
      const reasons = [];
      if(sd.aksesibilitas >= 75) reasons.push(`<b class="v-good">aksesibilitas kuat (${sd.aksesibilitas})</b>`);
      else if(sd.aksesibilitas < 50) reasons.push(`<b class="v-warn">aksesibilitas lemah (${sd.aksesibilitas})</b>`);
      if(sd.fasilitas >= 75) reasons.push(`<b class="v-good">fasilitas sekitar lengkap (${sd.fasilitas})</b>`);
      else if(sd.fasilitas < 50) reasons.push(`<b class="v-warn">fasilitas sekitar minim (${sd.fasilitas})</b>`);
      // Jarak POI terdekat
      const d = sd.detail || {};
      const near = [];
      if(d.rs?.dist < 3) near.push(`RS ${d.rs.dist}km`);
      if(d.kampus?.dist < 3) near.push(`Kampus ${d.kampus.dist}km`);
      if(d.mall?.dist < 3) near.push(`Mall ${d.mall.dist}km`);
      if(near.length) reasons.push(`dekat dengan ${near.join(', ')}`);
      if(!reasons.length) reasons.push('data lokasi standar');
      return `Skor ${score}/100 karena ${reasons.join(' dan ')}.`;
    }
    case 'product': {
      const reasons = [];
      if(t.luasTanah) reasons.push(`LT ${escapeHtml(t.luasTanah)}`);
      if(t.luasBangunan) reasons.push(`LB ${escapeHtml(t.luasBangunan)}`);
      if(p.unit > 0) reasons.push(`${p.unit} unit`);
      const curYear = new Date().getFullYear();
      if(p.tahun && (curYear - p.tahun) <= 3) reasons.push(`<b class="v-good">proyek baru (${p.tahun})</b>`);
      else if(p.tahun && (curYear - p.tahun) > 6) reasons.push(`<b class="v-warn">proyek lama (${p.tahun})</b>`);
      if(score < 50) return `Skor ${score}/100 — <b class="v-warn">data produk belum lengkap</b>. Perlu input spek lebih detail.`;
      return `Skor ${score}/100 karena ${reasons.length ? reasons.join(', ') : 'kelengkapan data standar'}.`;
    }
    case 'price': {
      const reasons = [];
      if(t.hargaRange) reasons.push(`harga ${escapeHtml(t.hargaRange)}`);
      if(t.tenorDominan) reasons.push(`tenor ${escapeHtml(t.tenorDominan)}`);
      if(t.uangMukaRange) reasons.push(`DP ${escapeHtml(t.uangMukaRange)}`);
      if(t.bankDominan) reasons.push(`via ${escapeHtml(t.bankDominan)}`);
      if(!reasons.length) return `Skor ${score}/100 — <b class="v-warn">data harga belum diisi</b>.`;
      return `Skor ${score}/100 dengan ${reasons.join(', ')}.`;
    }
    case 'promotion': {
      const promo = t.promotion || {};
      const reasons = [];
      if(promo.promoAktif) reasons.push(`<b class="v-good">promo aktif: ${escapeHtml(promo.promoAktif)}</b>`);
      else reasons.push(`<b class="v-warn">tidak ada promo aktif</b>`);
      if(promo.iklanPlatform){
        const n = _parseComplexItems(promo.iklanPlatform).length;
        reasons.push(`${n} kanal iklan`);
      }
      if(promo.billboard && /ya/i.test(promo.billboard)) reasons.push(`billboard aktif`);
      return `Skor ${score}/100 — ${reasons.join(', ')}.`;
    }
    case 'performance': {
      const pct = p.unit > 0 ? Math.round((p.realisasi || 0) / p.unit * 100) : 0;
      const bulanan = t.realisasiBulanan || [];
      const reasons = [`progress ${pct}%`];
      if(bulanan.length >= 4){
        const trend = _calcTaperaTrend(bulanan);
        if(trend.dir === 'up') reasons.push(`<b class="v-good">trend naik (${trend.pctStr})</b>`);
        else if(trend.dir === 'down') reasons.push(`<b class="v-warn">trend turun (${trend.pctStr})</b>`);
        else reasons.push(`trend flat`);
      } else if(bulanan.length){
        reasons.push(`data ${bulanan.length} bulan`);
      } else {
        reasons.push(`<b class="v-warn">belum ada data bulanan</b>`);
      }
      return `Skor ${score}/100 — ${reasons.join(', ')}.`;
    }
    case 'gtm': {
      const gtm = t.gtm || {};
      const reasons = [];
      if(gtm.marketingInhouse != null) reasons.push(`${gtm.marketingInhouse} marketing in-house`);
      if(gtm.strukturKanal) reasons.push(`kanal ${escapeHtml(gtm.strukturKanal)}`);
      if(gtm.jumlahAgent != null && gtm.jumlahAgent > 0) reasons.push(`<b class="v-good">${gtm.jumlahAgent} agent</b>`);
      else if(gtm.jumlahAgent === 0) reasons.push(`<b class="v-warn">tanpa agent</b>`);
      if(!reasons.length) return `Skor ${score}/100 — <b class="v-warn">data GTM belum lengkap</b>.`;
      return `Skor ${score}/100 dengan ${reasons.join(', ')}.`;
    }
    default: return `Skor ${score}/100.`;
  }
}

// Generate verdict akhir berdasarkan semua skor section
function _genFinalVerdict(scores, p){
  const entries = [
    ['Place', scores.place], ['Product', scores.product], ['Price', scores.price],
    ['Promotion', scores.promotion], ['Performance', scores.performance], ['GTM', scores.gtm]
  ];
  const strong = entries.filter(([n,s])=>s >= 75).map(([n])=>n);
  const weak = entries.filter(([n,s])=>s < 50).map(([n])=>n);
  let narasi = '';
  if(strong.length && weak.length){
    narasi = `Perumahan ini <b class="v-good">kuat di ${strong.join(', ')}</b> (skor ≥75) namun <b class="v-warn">lemah di ${weak.join(', ')}</b> (skor <50). Skor rata-rata: <b>${scores.avg}/100</b>.`;
  } else if(strong.length){
    narasi = `Perumahan ini <b class="v-good">kuat di ${strong.join(', ')}</b>. Skor rata-rata: <b>${scores.avg}/100</b>.`;
  } else if(weak.length){
    narasi = `Perumahan ini <b class="v-warn">perlu perbaikan di ${weak.join(', ')}</b>. Skor rata-rata: <b>${scores.avg}/100</b>.`;
  } else {
    narasi = `Perumahan ini punya profil yang <b>seimbang</b> di semua aspek. Skor rata-rata: <b>${scores.avg}/100</b>.`;
  }
  // Unggul/Risiko list
  const unggul = [];
  const risiko = [];
  if(scores.place >= 75) unggul.push(`Lokasi strategis (${scores.place})`);
  else if(scores.place < 50) risiko.push(`Lokasi kurang kompetitif (${scores.place})`);
  if(scores.product >= 75) unggul.push(`Spek produk lengkap (${scores.product})`);
  else if(scores.product < 50) risiko.push(`Data produk minim (${scores.product})`);
  if(scores.price >= 75) unggul.push(`Harga kompetitif (${scores.price})`);
  else if(scores.price < 50) risiko.push(`Data harga belum lengkap (${scores.price})`);
  if(scores.promotion >= 75) unggul.push(`Promo kuat (${scores.promotion})`);
  else if(scores.promotion < 50) risiko.push(`Promo lemah/kosong (${scores.promotion})`);
  if(scores.performance >= 75) unggul.push(`Penjualan sehat (${scores.performance})`);
  else if(scores.performance < 50) risiko.push(`Penjualan lambat (${scores.performance})`);
  if(scores.gtm >= 75) unggul.push(`Tim jualan kuat (${scores.gtm})`);
  else if(scores.gtm < 50) risiko.push(`Tim jualan kecil (${scores.gtm})`);
  // Rekomendasi
  const rekomendasi = [];
  if(scores.promotion < 50) rekomendasi.push('Siapkan paket promo untuk tingkatkan daya tarik');
  if(scores.gtm < 50) rekomendasi.push('Tambah kapasitas tim marketing dan/atau jaringan agent');
  if(scores.performance < 50 && p.unit > 0 && (p.realisasi||0)/p.unit < 0.3) rekomendasi.push('Audit strategi penjualan — velocity masih rendah');
  if(scores.price < 50) rekomendasi.push('Lengkapi data harga, DP, dan skema KPR');
  if(!rekomendasi.length && scores.avg >= 75) rekomendasi.push('Pertahankan momentum; monitor kompetitor secara berkala');
  return {
    narasi,
    unggul: unggul.slice(0,4),
    risiko: risiko.slice(0,4),
    rekomendasi: rekomendasi.slice(0,3).join('. ') + (rekomendasi.length ? '.' : '')
  };
}

// ============================================================
// [TAHAP3-IT3] Verdict Override — Manual Edit Per Section
// ============================================================
// Helper: get override text (null if not set / section uses auto)
function _getVerdictOverride(p, sectionId){
  const notes = p?.tapera?.verdictSectionNotes || {};
  const val = notes[sectionId];
  return (typeof val === 'string' && val.trim()) ? val : null;
}

// Helper: get final verdict override
function _getFinalVerdictOverride(p){
  const val = p?.tapera?.verdictFinalNote;
  return (typeof val === 'string' && val.trim()) ? val : null;
}

// Render section verdict block — support manual override
function _renderSectionVerdict(sectionId, p, score, autoText){
  const override = _getVerdictOverride(p, sectionId);
  const isManual = !!override;
  const displayText = isManual ? escapeHtml(override).replace(/\n/g,'<br>') : autoText;
  const tag = isManual
    ? `<span class="pdl-sec-verdict-manual-tag">manual</span>`
    : `<span class="pdl-sec-verdict-auto-tag">auto</span>`;
  const revertBtn = isManual
    ? `<button class="pdl-sec-verdict-btn revert" onclick="revertVerdictOverride('${sectionId}', ${p.id})" title="Kembalikan ke auto-generated">↺ Auto</button>`
    : '';
  return `<div class="pdl-sec-verdict ${isManual?'manual':''}" id="pdl-sv-${sectionId}">
    <div class="pdl-sec-verdict-lbl">
      <span>📝 Verdict ${_sectionLabel(sectionId)}</span>
      <span class="pdl-sec-verdict-actions">
        ${tag}
        <button class="pdl-sec-verdict-btn" onclick="editVerdictOverride('${sectionId}', ${p.id})" title="Edit manual">✎</button>
        ${revertBtn}
      </span>
    </div>
    <div class="pdl-sec-verdict-content" id="pdl-sv-content-${sectionId}">${displayText}</div>
  </div>`;
}

function _sectionLabel(id){
  const map = {place:'Place', product:'Product', price:'Price', promotion:'Promotion', performance:'Performance', gtm:'GTM'};
  return map[id] || id;
}

// Enter edit mode untuk section verdict
function editVerdictOverride(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  const block = document.getElementById(`pdl-sv-${sectionId}`);
  if(!block) return;
  const current = _getVerdictOverride(p, sectionId) || '';
  // Kalau kosong, kasih starter: auto text (plain) supaya BM bisa modify dari situ
  let starter = current;
  if(!starter){
    // Ambil auto text dari DOM (sudah di-render) — strip HTML jadi plain
    const contentEl = document.getElementById(`pdl-sv-content-${sectionId}`);
    if(contentEl){
      const tmp = document.createElement('div');
      tmp.innerHTML = contentEl.innerHTML;
      starter = tmp.textContent || tmp.innerText || '';
    }
  }
  block.innerHTML = `
    <div class="pdl-sec-verdict-lbl">
      <span>✎ Edit Verdict ${_sectionLabel(sectionId)}</span>
      <span class="pdl-sec-verdict-manual-tag">editing</span>
    </div>
    <textarea class="pdl-sec-verdict-editarea" id="pdl-sv-ta-${sectionId}" placeholder="Tulis verdict manual...">${escapeHtml(starter)}</textarea>
    <div class="pdl-sec-verdict-edit-row">
      <button class="pdl-sec-verdict-edit-cancel" onclick="cancelVerdictOverride('${sectionId}', ${perumId})">Batal</button>
      <button class="pdl-sec-verdict-edit-save" onclick="saveVerdictOverride('${sectionId}', ${perumId})">💾 Simpan</button>
    </div>
  `;
  const ta = document.getElementById(`pdl-sv-ta-${sectionId}`);
  if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function saveVerdictOverride(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  if(!p.tapera.verdictSectionNotes) p.tapera.verdictSectionNotes = {};
  const ta = document.getElementById(`pdl-sv-ta-${sectionId}`);
  if(!ta) return;
  const val = ta.value.trim();
  if(val){
    p.tapera.verdictSectionNotes[sectionId] = val;
  } else {
    // Kalau dikosongkan, hapus (balik ke auto)
    delete p.tapera.verdictSectionNotes[sectionId];
  }
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast(val ? '✓ Verdict manual disimpan' : '↺ Kembali ke auto');
  _renderPdlBody(perumId);
}

function cancelVerdictOverride(sectionId, perumId){
  _renderPdlBody(perumId);
}

function revertVerdictOverride(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!confirm(`Kembalikan Verdict ${_sectionLabel(sectionId)} ke auto-generated? Teks manual akan terhapus.`)) return;
  if(p.tapera?.verdictSectionNotes){
    delete p.tapera.verdictSectionNotes[sectionId];
  }
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast('↺ Verdict dikembalikan ke auto');
  _renderPdlBody(perumId);
}

// === Final verdict override handlers ===
function editFinalVerdictOverride(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  const block = document.getElementById('pdl-final-block');
  if(!block) return;
  const current = _getFinalVerdictOverride(p) || '';
  let starter = current;
  if(!starter){
    const narEl = document.getElementById('pdl-final-narasi');
    if(narEl){
      const tmp = document.createElement('div');
      tmp.innerHTML = narEl.innerHTML;
      starter = tmp.textContent || tmp.innerText || '';
    }
  }
  block.innerHTML = `
    <div class="pdl-final-head">🎯 VERDICT AKHIR — Edit Manual <span class="pdl-final-manual-tag">editing</span></div>
    <textarea class="pdl-final-editarea" id="pdl-final-ta" placeholder="Tulis verdict akhir manual...">${escapeHtml(starter)}</textarea>
    <div class="pdl-sec-verdict-edit-row">
      <button class="pdl-sec-verdict-edit-cancel" onclick="cancelFinalVerdictOverride(${perumId})">Batal</button>
      <button class="pdl-sec-verdict-edit-save" onclick="saveFinalVerdictOverride(${perumId})">💾 Simpan</button>
    </div>
  `;
  const ta = document.getElementById('pdl-final-ta');
  if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function saveFinalVerdictOverride(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  const ta = document.getElementById('pdl-final-ta');
  if(!ta) return;
  const val = ta.value.trim();
  if(val) p.tapera.verdictFinalNote = val;
  else delete p.tapera.verdictFinalNote;
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast(val ? '✓ Verdict akhir disimpan' : '↺ Kembali ke auto');
  _renderPdlBody(perumId);
}

function cancelFinalVerdictOverride(perumId){ _renderPdlBody(perumId); }

function revertFinalVerdictOverride(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!confirm('Kembalikan Verdict Akhir ke auto-generated? Teks manual akan terhapus.')) return;
  if(p.tapera) delete p.tapera.verdictFinalNote;
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast('↺ Verdict akhir dikembalikan ke auto');
  _renderPdlBody(perumId);
}

// ============================================================
// [TAHAP4A] Per-section verdicts di Vs Anchor tab
// Re-use engine dari PDL (Detail Lengkap) biar sinkron
// ============================================================

// Build semua 6 section verdict + final verdict untuk target perumahan di Vs Anchor
// [FIX A] Filter berdasarkan section aktif:
// - ringkasan = tampilkan SEMUA 6 verdict + verdict akhir
// - place/product/price/promotion/performance/gtm = hanya verdict section itu saja
// - market (Market Insight) = tampilkan Verdict Akhir saja (tidak ada verdict khusus market)
function buildVsaSectionVerdicts(target){
  if(!target || !target.p) return '';
  const p = target.p;
  const scores = _calcAllSectionScores(p);
  const allSectionMeta = [
    {id:'place',       emoji:'📍', name:'Place'},
    {id:'product',     emoji:'🏠', name:'Product'},
    {id:'price',       emoji:'💰', name:'Price'},
    {id:'promotion',   emoji:'📢', name:'Promotion'},
    {id:'performance', emoji:'📈', name:'Performance'},
    {id:'gtm',         emoji:'👔', name:'Go-to-Market'}
  ];
  // Tentukan section mana yang di-render berdasarkan section aktif
  const activeSection = (typeof vsaActiveSectionId === 'string' && vsaActiveSectionId) ? vsaActiveSectionId : 'ringkasan';
  const verdictSectionIds = ['place','product','price','promotion','performance','gtm'];
  let sectionMeta;
  let showFinalVerdict;
  let headerLabel;
  if(activeSection === 'ringkasan'){
    sectionMeta = allSectionMeta;           // semua
    showFinalVerdict = true;
    headerLabel = 'Verdict Per Section';
  } else if(verdictSectionIds.includes(activeSection)){
    sectionMeta = allSectionMeta.filter(m=>m.id===activeSection);
    showFinalVerdict = false;
    headerLabel = `Verdict ${allSectionMeta.find(m=>m.id===activeSection)?.name||''}`;
  } else {
    // section lain (market, custom, dll) — tidak punya verdict khusus, skip
    return '';
  }

  const itemsHtml = sectionMeta.map(meta => {
    const score = scores[meta.id];
    const autoText = _genSectionVerdict(meta.id, p, score);
    const override = _getVerdictOverride(p, meta.id);
    const isManual = !!override;
    const displayText = isManual ? escapeHtml(override).replace(/\n/g,'<br>') : autoText;
    const tag = isManual
      ? `<span class="vsa-sv-tag manual">manual</span>`
      : `<span class="vsa-sv-tag auto">auto</span>`;
    const revertBtn = isManual
      ? `<button class="vsa-sv-btn revert" onclick="vsaEditVerdictRevert('${meta.id}', ${p.id})" title="Kembali ke auto">↺ Auto</button>`
      : '';
    return `<div class="vsa-sv-item ${isManual?'manual':''}" id="vsa-sv-${meta.id}-${p.id}">
      <div class="vsa-sv-item-head">
        <div class="vsa-sv-item-title">${meta.emoji} ${meta.name}</div>
        <div class="vsa-sv-actions">
          <span class="vsa-sv-score ${_pdlScoreClass(score)}">${score}/100</span>
          ${tag}
          <button class="vsa-sv-btn" onclick="vsaEditVerdictStart('${meta.id}', ${p.id})" title="Edit manual">✎</button>
          ${revertBtn}
        </div>
      </div>
      <div class="vsa-sv-text" id="vsa-sv-text-${meta.id}-${p.id}">${displayText}</div>
    </div>`;
  }).join('');

  // Final verdict (hanya di Ringkasan)
  let finalBlockHtml = '';
  if(showFinalVerdict){
    const finalV = _genFinalVerdict(scores, p);
    const finalOverride = _getFinalVerdictOverride(p);
    const isFinalManual = !!finalOverride;
    const finalNarasiHtml = isFinalManual
      ? escapeHtml(finalOverride).replace(/\n/g,'<br>')
      : finalV.narasi;
    const finalTag = isFinalManual
      ? `<span class="vsa-sv-tag manual">manual</span>`
      : `<span class="vsa-sv-tag auto">auto-generated</span>`;
    const finalRevertBtn = isFinalManual
      ? `<button class="vsa-sv-btn revert" onclick="vsaEditFinalVerdictRevert(${p.id})" title="Kembali ke auto">↺ Auto</button>`
      : '';
    const unggulHtml = finalV.unggul.length ? `<ul>${finalV.unggul.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>` : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
    const risikoHtml = finalV.risiko.length ? `<ul>${finalV.risiko.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>` : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
    finalBlockHtml = `<div class="vsa-final ${isFinalManual?'manual':''}" id="vsa-final-block-${p.id}">
      <div class="vsa-final-head">
        <span>🎯 VERDICT AKHIR — Skor rata² ${scores.avg}/100</span>
        <span class="vsa-sv-actions">
          ${finalTag}
          <button class="vsa-sv-btn" onclick="vsaEditFinalVerdictStart(${p.id})" title="Edit manual">✎ Edit</button>
          ${finalRevertBtn}
        </span>
      </div>
      <div class="vsa-final-narasi" id="vsa-final-narasi-${p.id}">${finalNarasiHtml}</div>
      <div class="vsa-final-grid">
        <div class="vsa-final-card v-good"><div class="vsa-final-card-lbl">✓ Unggul</div>${unggulHtml}</div>
        <div class="vsa-final-card v-warn"><div class="vsa-final-card-lbl">⚠ Risiko</div>${risikoHtml}</div>
      </div>
      ${finalV.rekomendasi ? `<div class="vsa-final-rekom"><div class="vsa-final-rekom-lbl">💡 Rekomendasi Action</div>${escapeHtml(finalV.rekomendasi)}</div>` : ''}
    </div>`;
  }

  return `<div class="vsa-sec-verdict-container">
    <div class="vsa-sec-verdict-header">
      <span>📝 ${headerLabel}</span>
      <span class="nama-target">⭐ ${escapeHtml(p.nama)}</span>
    </div>
    <div class="vsa-sec-verdict-stack">${itemsHtml}</div>
    ${finalBlockHtml}
  </div>`;
}

// Handlers edit khusus Vs Anchor (re-render Vs Anchor, bukan PDL body)
function _vsaReRender(){
  // Re-render tab-compare berdasarkan perumahan fokus/anchor yang aktif
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') renderDetailCompare(p);
  }
}

function vsaEditVerdictStart(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  const block = document.getElementById(`vsa-sv-${sectionId}-${perumId}`);
  if(!block) return;
  const current = _getVerdictOverride(p, sectionId) || '';
  let starter = current;
  if(!starter){
    const txtEl = document.getElementById(`vsa-sv-text-${sectionId}-${perumId}`);
    if(txtEl){
      const tmp = document.createElement('div');
      tmp.innerHTML = txtEl.innerHTML;
      starter = tmp.textContent || tmp.innerText || '';
    }
  }
  const labelMap = {place:'Place',product:'Product',price:'Price',promotion:'Promotion',performance:'Performance',gtm:'GTM'};
  block.innerHTML = `
    <div class="vsa-sv-item-head">
      <div class="vsa-sv-item-title">✎ Edit Verdict ${labelMap[sectionId]||sectionId}</div>
      <span class="vsa-sv-tag manual">editing</span>
    </div>
    <textarea class="vsa-sv-editarea" id="vsa-sv-ta-${sectionId}-${perumId}" placeholder="Tulis verdict manual...">${escapeHtml(starter)}</textarea>
    <div class="vsa-sv-edit-row">
      <button class="vsa-sv-edit-cancel" onclick="vsaEditVerdictCancel('${sectionId}', ${perumId})">Batal</button>
      <button class="vsa-sv-edit-save" onclick="vsaEditVerdictSave('${sectionId}', ${perumId})">💾 Simpan</button>
    </div>
  `;
  const ta = document.getElementById(`vsa-sv-ta-${sectionId}-${perumId}`);
  if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function vsaEditVerdictSave(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  if(!p.tapera.verdictSectionNotes) p.tapera.verdictSectionNotes = {};
  const ta = document.getElementById(`vsa-sv-ta-${sectionId}-${perumId}`);
  if(!ta) return;
  const val = ta.value.trim();
  if(val) p.tapera.verdictSectionNotes[sectionId] = val;
  else delete p.tapera.verdictSectionNotes[sectionId];
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast(val ? '✓ Verdict disimpan' : '↺ Kembali ke auto');
  _vsaReRender();
}

function vsaEditVerdictCancel(sectionId, perumId){ _vsaReRender(); }

function vsaEditVerdictRevert(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  const labelMap = {place:'Place',product:'Product',price:'Price',promotion:'Promotion',performance:'Performance',gtm:'GTM'};
  if(!confirm(`Kembalikan Verdict ${labelMap[sectionId]||sectionId} ke auto-generated? Teks manual akan terhapus.`)) return;
  if(p.tapera?.verdictSectionNotes){ delete p.tapera.verdictSectionNotes[sectionId]; }
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast('↺ Verdict dikembalikan ke auto');
  _vsaReRender();
}

// Final verdict handlers
function vsaEditFinalVerdictStart(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  const block = document.getElementById(`vsa-final-block-${perumId}`);
  if(!block) return;
  const current = _getFinalVerdictOverride(p) || '';
  let starter = current;
  if(!starter){
    const narEl = document.getElementById(`vsa-final-narasi-${perumId}`);
    if(narEl){
      const tmp = document.createElement('div');
      tmp.innerHTML = narEl.innerHTML;
      starter = tmp.textContent || tmp.innerText || '';
    }
  }
  block.innerHTML = `
    <div class="vsa-final-head">
      <span>🎯 VERDICT AKHIR — Edit Manual</span>
      <span class="vsa-sv-tag manual">editing</span>
    </div>
    <textarea class="vsa-sv-editarea" id="vsa-final-ta-${perumId}" placeholder="Tulis verdict akhir manual...">${escapeHtml(starter)}</textarea>
    <div class="vsa-sv-edit-row">
      <button class="vsa-sv-edit-cancel" onclick="vsaEditFinalVerdictCancel(${perumId})">Batal</button>
      <button class="vsa-sv-edit-save" onclick="vsaEditFinalVerdictSave(${perumId})">💾 Simpan</button>
    </div>
  `;
  const ta = document.getElementById(`vsa-final-ta-${perumId}`);
  if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
function vsaEditFinalVerdictSave(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  const ta = document.getElementById(`vsa-final-ta-${perumId}`);
  if(!ta) return;
  const val = ta.value.trim();
  if(val) p.tapera.verdictFinalNote = val;
  else delete p.tapera.verdictFinalNote;
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast(val ? '✓ Verdict akhir disimpan' : '↺ Kembali ke auto');
  _vsaReRender();
}
function vsaEditFinalVerdictCancel(perumId){ _vsaReRender(); }
function vsaEditFinalVerdictRevert(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!confirm('Kembalikan Verdict Akhir ke auto-generated? Teks manual akan terhapus.')) return;
  if(p.tapera) delete p.tapera.verdictFinalNote;
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast('↺ Verdict akhir dikembalikan ke auto');
  _vsaReRender();
}

// Modal control
let _pdlCurrentId = null;
function openPdlModal(perumId){
  _pdlCurrentId = perumId;
  window.__currentPdlPerumId = perumId;
  _renderPdlSelector();
  _renderPdlBody(perumId);
  document.getElementById('pdl-overlay').classList.add('open');
  // [v12.4 STATE PERSISTENCE] Save state agar setelah refresh modal masih terbuka
  if(typeof triggerSaveAppState === 'function') triggerSaveAppState();
}
function closePdlModal(){
  document.getElementById('pdl-overlay').classList.remove('open');
  _pdlCurrentId = null;
  window.__currentPdlPerumId = null;
  // [v12.4 STATE PERSISTENCE] Update state setelah modal ditutup
  if(typeof triggerSaveAppState === 'function') triggerSaveAppState();
}
function switchPdlPerum(perumId){
  const id = parseInt(perumId);
  if(isNaN(id)) return;
  _pdlCurrentId = id;
  _renderPdlBody(id);
}
function _renderPdlSelector(){
  const sel = document.getElementById('pdl-selector');
  if(!sel) return;
  const sorted = [...perumahan].sort((a,b)=>{
    if(a.id===ANCHOR_ID) return -1;
    if(b.id===ANCHOR_ID) return 1;
    return (a.nama||'').localeCompare(b.nama||'');
  });
  sel.innerHTML = sorted.map(p=>{
    const isAnch = p.id === ANCHOR_ID;
    return `<option value="${p.id}" ${p.id===_pdlCurrentId?'selected':''}>${isAnch?'⭐ ':''}${escapeHtml(p.nama)} · ${escapeHtml(p.area||'')}</option>`;
  }).join('');
}
function _renderPdlBody(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p){ document.getElementById('pdl-body').innerHTML = '<div style="padding:40px;text-align:center;color:var(--faint);">Perumahan tidak ditemukan.</div>'; return; }
  // Update header
  document.getElementById('pdl-head-title').textContent = p.nama + (p.id===ANCHOR_ID?' ⭐':'');
  document.getElementById('pdl-head-sub').textContent = `${p.area||'—'} · Launching ${p.tahun||'—'} · ${p.developer||'—'}`;
  const scores = _calcAllSectionScores(p);
  const finalV = _genFinalVerdict(scores, p);
  const t = p.tapera || {};
  const sd = p._scoreDetail || calcScoreFull(p);
  const curYear = new Date().getFullYear();
  // Helper untuk data row
  const dataRow = (lbl, val, empty=false) => `<div class="pdl-data-row"><div class="pdl-data-lbl">${lbl}</div><div class="pdl-data-val ${empty?'empty':''}">${val}</div></div>`;
  const optVal = (v, fallback='—') => (v!=null && v!=='' && v!==false) ? escapeHtml(String(v)) : `<span style="color:var(--faint);font-style:italic;">${fallback}</span>`;
  // [TAHAP4B-2] Render custom/template fields yang sudah aktif untuk section tertentu
  const customRows = (secId) => {
    const cust = (FM_STATE.customFields[secId] || []).filter(f => !_isFieldHidden(f.id));
    if(!cust.length) return '';
    const rows = cust.map(f => {
      const val = p.customFields?.[f.id];
      let displayVal;
      if(val == null || val === '' || (Array.isArray(val) && !val.length)){
        displayVal = `<span style="color:var(--faint);font-style:italic;">—</span>`;
      } else if(Array.isArray(val)){
        displayVal = escapeHtml(val.join(', '));
      } else if(f.type === 'yesno'){
        displayVal = val ? 'Ya' : 'Tidak';
      } else {
        displayVal = escapeHtml(String(val));
      }
      return dataRow(escapeHtml(f.label), displayVal);
    }).join('');
    return rows;
  };
  // ─── SECTION BUILDERS ───
  const secPlace = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">📍 Place (Lokasi)</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.place)}">${scores.place}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Koordinat', `${p.lat?.toFixed(5)}, ${p.lng?.toFixed(5)}`)}
        ${dataRow('Area', optVal(p.area))}
        ${dataRow('Skor Aksesibilitas', sd.aksesibilitas+'/100')}
        ${dataRow('Skor Fasilitas', sd.fasilitas+'/100')}
        ${dataRow('Skor Fisik', sd.fisik+'/100')}
        ${dataRow('Jarak RS terdekat', sd.detail?.rs?.dist!=null ? sd.detail.rs.dist+' km' : '—')}
        ${dataRow('Jarak Kampus', sd.detail?.kampus?.dist!=null ? sd.detail.kampus.dist+' km' : '—')}
        ${dataRow('Jarak Mall', sd.detail?.mall?.dist!=null ? sd.detail.mall.dist+' km' : '—')}
        ${customRows('place')}
      </div>
      ${_renderSectionVerdict('place', p, scores.place, _genSectionVerdict('place', p, scores.place))}
    </div>
  </div>`;
  const secProduct = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">🏠 Product</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.product)}">${scores.product}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Total Unit', p.unit ? fmt(p.unit) : '—')}
        ${dataRow('Tahun Launching', p.tahun || '—')}
        ${dataRow('Umur Proyek', p.tahun ? (curYear-p.tahun)+' tahun' : '—')}
        ${dataRow('Tipe Perumahan', TIPE_LABEL[p.tipe] || optVal(p.tipe))}
        ${dataRow('Luas Tanah', optVal(t.luasTanah))}
        ${dataRow('Luas Bangunan', optVal(t.luasBangunan))}
        ${customRows('product')}
      </div>
      ${_renderSectionVerdict('product', p, scores.product, _genSectionVerdict('product', p, scores.product))}
    </div>
  </div>`;
  const secPrice = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">💰 Price</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.price)}">${scores.price}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Harga Range', optVal(t.hargaRange))}
        ${dataRow('Tenor Dominan', optVal(t.tenorDominan))}
        ${dataRow('Uang Muka', optVal(t.uangMukaRange))}
        ${dataRow('Bank Dominan', optVal(t.bankDominan))}
        ${dataRow('Nominal FLPP', t.nominalFLPP ? t.nominalFLPP+' M' : '—')}
        ${customRows('price')}
      </div>
      ${_renderSectionVerdict('price', p, scores.price, _genSectionVerdict('price', p, scores.price))}
    </div>
  </div>`;
  const promo = t.promotion || {};
  const secPromo = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">📢 Promotion</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.promotion)}">${scores.promotion}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Promo Aktif', optVal(promo.promoAktif))}
        ${dataRow('Periode Promo', optVal(promo.periode))}
        ${dataRow('Bonus Pembelian', optVal(promo.bonus))}
        ${dataRow('Iklan di Platform', optVal(promo.iklanPlatform))}
        ${dataRow('Billboard/Spanduk', optVal(promo.billboard))}
        ${customRows('promotion')}
      </div>
      ${_renderSectionVerdict('promotion', p, scores.promotion, _genSectionVerdict('promotion', p, scores.promotion))}
    </div>
  </div>`;
  const bulanan = t.realisasiBulanan || [];
  const trend = bulanan.length >= 4 ? _calcTaperaTrend(bulanan) : null;
  const pct = p.unit > 0 ? Math.round((p.realisasi||0)/p.unit*100) : 0;
  const secPerf = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">📈 Performance</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.performance)}">${scores.performance}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Total Unit', p.unit ? fmt(p.unit) : '—')}
        ${dataRow('Realisasi', p.realisasi ? fmt(p.realisasi) : '—')}
        ${dataRow('Progress', pct+'%')}
        ${dataRow('Total Realisasi Tapera', t.totalRealisasi ? fmt(t.totalRealisasi)+' unit' : '—')}
        ${dataRow('Data Bulanan', bulanan.length ? bulanan.length+' bulan' : '—')}
        ${dataRow('Trend 3-bln', trend ? `${trend.arrow} ${trend.pctStr}` : '—')}
        ${customRows('performance')}
      </div>
      ${_renderSectionVerdict('performance', p, scores.performance, _genSectionVerdict('performance', p, scores.performance))}
    </div>
  </div>`;
  const gtm = t.gtm || {};
  const secGtm = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">👔 Go-to-Market</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.gtm)}">${scores.gtm}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Marketing In-house', gtm.marketingInhouse!=null ? gtm.marketingInhouse+' org' : '—')}
        ${dataRow('Struktur Kanal', optVal(gtm.strukturKanal))}
        ${dataRow('Jumlah Agent', gtm.jumlahAgent!=null ? gtm.jumlahAgent+' agent' : '—')}
        ${dataRow('Fee Marketing', optVal(gtm.feeMarketing))}
        ${dataRow('Fee Agent', optVal(gtm.feeAgent))}
        ${dataRow('Brand Developer', optVal(gtm.brandDeveloper))}
        ${customRows('gtm')}
      </div>
      ${_renderSectionVerdict('gtm', p, scores.gtm, _genSectionVerdict('gtm', p, scores.gtm))}
    </div>
  </div>`;
  // Final verdict
  const unggulHtml = finalV.unggul.length ? `<ul>${finalV.unggul.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>` : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
  const risikoHtml = finalV.risiko.length ? `<ul>${finalV.risiko.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>` : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
  const finalOverride = _getFinalVerdictOverride(p);
  const isFinalManual = !!finalOverride;
  const finalNarasiHtml = isFinalManual
    ? escapeHtml(finalOverride).replace(/\n/g,'<br>')
    : finalV.narasi;
  const finalTag = isFinalManual
    ? `<span class="pdl-final-manual-tag">manual</span>`
    : `<span style="font-size:10px;font-weight:600;color:var(--accent);background:white;padding:2px 8px;border-radius:10px;">auto-generated</span>`;
  const finalRevertBtn = isFinalManual
    ? `<button class="pdl-final-edit-btn revert" onclick="revertFinalVerdictOverride(${p.id})" title="Kembalikan ke auto">↺ Auto</button>`
    : '';
  const finalBlock = `<div class="pdl-final ${isFinalManual?'manual':''}" id="pdl-final-block">
    <div class="pdl-final-head">
      <span>🎯 VERDICT AKHIR</span>
      <span class="pdl-final-actions">
        ${finalTag}
        <button class="pdl-final-edit-btn" onclick="editFinalVerdictOverride(${p.id})" title="Edit verdict akhir">✎ Edit</button>
        ${finalRevertBtn}
      </span>
    </div>
    <div class="pdl-final-narasi" id="pdl-final-narasi">${finalNarasiHtml}</div>
    <div class="pdl-final-grid">
      <div class="pdl-final-card v-good"><div class="pdl-final-card-lbl">✓ Unggul</div>${unggulHtml}</div>
      <div class="pdl-final-card v-warn"><div class="pdl-final-card-lbl">⚠ Risiko</div>${risikoHtml}</div>
    </div>
    ${finalV.rekomendasi ? `<div class="pdl-rekom"><div class="pdl-rekom-lbl">💡 Rekomendasi Action</div>${escapeHtml(finalV.rekomendasi)}</div>` : ''}
  </div>`;
  // ─── ASSEMBLE ───
  const overallBanner = `<div class="pdl-overall">
    <div class="pdl-overall-score">${scores.avg}<small>/100</small></div>
    <div class="pdl-overall-info">
      <div class="pdl-overall-nama">${escapeHtml(p.nama)} ${p.id===ANCHOR_ID?'⭐':''}</div>
      <div class="pdl-overall-dev">${escapeHtml(p.developer||'—')}</div>
      <div class="pdl-overall-meta">Skor rata-rata dari 6 dimensi · ${p.area||'—'} · ${p.tahun||'—'}</div>
    </div>
  </div>`;
  document.getElementById('pdl-body').innerHTML = overallBanner + secPlace + secProduct + secPrice + secPromo + secPerf + secGtm + finalBlock;
  // Scroll to top on switch
  document.getElementById('pdl-body').scrollTop = 0;
}
// ESC to close PDL modal
document.addEventListener('keydown', function(e){
  if(e.key==='Escape'){
    const ov = document.getElementById('pdl-overlay');
    if(ov && ov.classList.contains('open')) closePdlModal();
  }
});

// [TAHAP2] Verdict generator — auto analisa unggul/risiko + narasi
function generateVerdict(cols, sds, distToAnchor){
  const anchorIdx = cols.findIndex(c=>c.role==='anchor');
  const focusIdx = cols.findIndex(c=>c.role==='focus');
  // Target verdict: perumahan FOKUS (kalau tidak ada focus, pakai anchor)
  const targetIdx = focusIdx>=0 ? focusIdx : anchorIdx;
  const target = cols[targetIdx];
  if(!target) return null;
  const targetSd = sds[targetIdx];
  const others = cols.filter((c,i)=>i!==targetIdx);
  const othersSd = sds.filter((s,i)=>i!==targetIdx);
  const unggul = [];
  const risiko = [];
  // --- Analisa Skor ---
  if(othersSd.length){
    const avgOverall = Math.round(othersSd.reduce((a,b)=>a+b.overall,0)/othersSd.length);
    const avgAks = Math.round(othersSd.reduce((a,b)=>a+b.aksesibilitas,0)/othersSd.length);
    const avgFas = Math.round(othersSd.reduce((a,b)=>a+b.fasilitas,0)/othersSd.length);
    if(targetSd.overall - avgOverall >= 8) unggul.push(`Skor overall ${targetSd.overall} (vs rata² ${avgOverall})`);
    else if(avgOverall - targetSd.overall >= 8) risiko.push(`Skor overall ${targetSd.overall} di bawah rata² grup (${avgOverall})`);
    if(targetSd.aksesibilitas >= 80) unggul.push(`Aksesibilitas tinggi (${targetSd.aksesibilitas})`);
    if(targetSd.fasilitas >= 80) unggul.push(`Fasilitas lengkap (${targetSd.fasilitas})`);
    if(targetSd.aksesibilitas <= 55) risiko.push(`Aksesibilitas rendah (${targetSd.aksesibilitas})`);
  }
  // --- Analisa Velocity Tapera ---
  const tVal = target.p.tapera;
  if(tVal?.realisasiBulanan?.length >= 4){
    const trend = _calcTaperaTrend(tVal.realisasiBulanan);
    if(trend.dir==='up') unggul.push(`Trend penjualan naik (${trend.pctStr})`);
    else if(trend.dir==='down') risiko.push(`Trend penjualan turun (${trend.pctStr})`);
  }
  const tProgress = target.p.unit>0 ? (target.p.realisasi||0)/target.p.unit : 0;
  if(tProgress >= 0.8) unggul.push(`Serap unit tinggi (${Math.round(tProgress*100)}%)`);
  else if(tProgress < 0.2 && target.p.realisasi>0) risiko.push(`Serap unit masih rendah (${Math.round(tProgress*100)}%)`);
  // --- Analisa Go-to-Market ---
  const gtm = tVal?.gtm;
  if(gtm){
    if(gtm.marketingInhouse!=null && gtm.marketingInhouse<=2 && (gtm.jumlahAgent==null || gtm.jumlahAgent===0)){
      risiko.push(`Tim marketing kecil (${gtm.marketingInhouse} org, tanpa agent)`);
    }
    if(gtm.strukturKanal && /agent/i.test(gtm.strukturKanal) && gtm.jumlahAgent>=10){
      unggul.push(`Jaringan agent kuat (${gtm.jumlahAgent} agent)`);
    }
  }
  // --- Analisa Promotion ---
  const promo = tVal?.promotion;
  if(promo){
    const hasPromo = promo.promoAktif && promo.promoAktif.trim();
    const othersHasPromo = others.filter(c=>c.p.tapera?.promotion?.promoAktif?.trim()).length;
    if(!hasPromo && othersHasPromo>=1) risiko.push(`Tidak ada promo aktif (${othersHasPromo} kompetitor gencar promo)`);
    else if(hasPromo && othersHasPromo===0) unggul.push('Satu-satunya yang promo aktif');
  }
  // Build narasi
  const goodTxt = unggul.length ? unggul.slice(0,2).map(t=>`<b class="v-good">${escapeHtml(t)}</b>`).join(' dan ') : '';
  const warnTxt = risiko.length ? risiko.slice(0,2).map(t=>`<b class="v-warn">${escapeHtml(t)}</b>`).join(' dan ') : '';
  let narasi = '';
  if(goodTxt && warnTxt){
    narasi = `Perumahan ini <b class="v-good">unggul</b> di ${goodTxt}. Namun ${warnTxt}.`;
  } else if(goodTxt){
    narasi = `Perumahan ini <b class="v-good">unggul</b> di ${goodTxt}.`;
  } else if(warnTxt){
    narasi = `Perumahan ini <b class="v-warn">perlu perhatian</b>: ${warnTxt}.`;
  } else {
    narasi = 'Data belum cukup untuk menarik kesimpulan. Lengkapi data Tapera, promotion, dan GTM untuk verdict yang akurat.';
  }
  // Rekomendasi action (simple rule-based)
  const rekomendasi = [];
  if(risiko.some(r=>/tim marketing kecil/i.test(r))) rekomendasi.push('Pertimbangkan rekrut agent marketing tambahan');
  if(risiko.some(r=>/tidak ada promo/i.test(r))) rekomendasi.push('Siapkan paket promo untuk bersaing');
  if(risiko.some(r=>/trend penjualan turun/i.test(r))) rekomendasi.push('Audit kampanye dan saluran jualan');
  if(unggul.some(u=>/jaringan agent kuat/i.test(u))) rekomendasi.push('Leverage jaringan agent untuk dorong velocity');
  const rekomendasiTxt = rekomendasi.length ? rekomendasi.join('. ') + '.' : '';
  return {
    targetId: target.p.id,
    targetNama: target.p.nama,
    narasi,
    unggul: unggul.slice(0,4),
    risiko: risiko.slice(0,4),
    rekomendasi: rekomendasiTxt
  };
}

// [TAHAP2] Build HTML block verdict (dipanggil dari renderDetailCompare)
function buildVerdictHtml(verdict){
  if(!verdict) return '';
  const p = perumahan.find(x=>x.id===verdict.targetId);
  const bmNote = p?.tapera?.verdictBmNote || '';
  const bmNoteHtml = bmNote.trim()
    ? `<div class="vsa-verdict-bm-text">${escapeHtml(bmNote)}</div>`
    : `<div class="vsa-verdict-bm-text empty">Belum ada catatan. Klik "✎ Edit" untuk menambah observasi lapangan.</div>`;
  const unggulHtml = verdict.unggul.length
    ? `<ul>${verdict.unggul.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>`
    : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
  const risikoHtml = verdict.risiko.length
    ? `<ul>${verdict.risiko.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>`
    : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
  const rekomHtml = verdict.rekomendasi
    ? `<div style="padding:9px 11px;background:#FAFAF8;border:1px solid var(--border);border-radius:7px;margin-bottom:8px;">
         <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--muted);margin-bottom:4px;">💡 Rekomendasi Action <span class="vsa-verdict-auto-tag">auto</span></div>
         <div style="font-size:11px;line-height:1.55;color:var(--text);">${escapeHtml(verdict.rekomendasi)}</div>
       </div>`
    : '';
  return `<div class="vsa-verdict" id="vsa-verdict-block">
    <div class="vsa-verdict-head">
      <div class="vsa-verdict-title">📝 Verdict — ${escapeHtml(verdict.targetNama)}</div>
      <span class="vsa-verdict-auto-tag">auto-generated</span>
    </div>
    <div class="vsa-verdict-narasi">${verdict.narasi}</div>
    <div class="vsa-verdict-grid">
      <div class="vsa-verdict-card v-good">
        <div class="vsa-verdict-card-lbl">✓ Unggul</div>
        ${unggulHtml}
      </div>
      <div class="vsa-verdict-card v-warn">
        <div class="vsa-verdict-card-lbl">⚠ Risiko</div>
        ${risikoHtml}
      </div>
    </div>
    ${rekomHtml}
    <div class="vsa-verdict-bm" id="vsa-verdict-bm-wrap">
      <div class="vsa-verdict-bm-head">
        <span>📌 Catatan BM (manual)</span>
        <button class="vsa-verdict-bm-edit" onclick="toggleVerdictBmEdit(${verdict.targetId})">✎ Edit</button>
      </div>
      ${bmNoteHtml}
    </div>
  </div>`;
}

// [TAHAP2] Toggle edit mode untuk catatan BM
function toggleVerdictBmEdit(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  const wrap = document.getElementById('vsa-verdict-bm-wrap');
  if(!wrap) return;
  const current = p.tapera.verdictBmNote || '';
  wrap.innerHTML = `
    <div class="vsa-verdict-bm-head">
      <span>📌 Catatan BM (manual) — Edit</span>
    </div>
    <textarea class="vsa-verdict-bm-editarea" id="vsa-verdict-bm-ta" placeholder="Ketik observasi lapangan...">${escapeHtml(current)}</textarea>
    <div style="display:flex;gap:6px;justify-content:flex-end;">
      <button style="background:#FAFAF8;color:var(--muted);border:1px solid var(--border);padding:4px 10px;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;" onclick="cancelVerdictBmEdit(${perumId})">Batal</button>
      <button style="background:var(--accent);color:white;border:none;padding:4px 10px;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;" onclick="saveVerdictBmEdit(${perumId})">💾 Simpan</button>
    </div>
  `;
  document.getElementById('vsa-verdict-bm-ta').focus();
}
function saveVerdictBmEdit(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  const ta = document.getElementById('vsa-verdict-bm-ta');
  if(!ta) return;
  p.tapera.verdictBmNote = ta.value.trim();
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast('✓ Catatan BM disimpan');
  // Re-render verdict
  renderDetailCompare(p);
}
function cancelVerdictBmEdit(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(p) renderDetailCompare(p);
}

function renderDetailCompare(p){
  const anchor=perumahan.find(x=>x.id===ANCHOR_ID);
  const isAnch=p.id===ANCHOR_ID;
  // [TAHAP 4] Jika user klik anchor sendiri, tetap bisa banding — tapi "fokus" dianggap anchor
  // dan kolom lain harus dari compareExtraIds. Kalau extras kosong, tampilkan prompt.
  if(isAnch && compareExtraIds.length===0){
    document.getElementById('tab-compare').innerHTML = `
      <div style="text-align:center;padding:32px 16px;color:var(--faint);font-size:12px;line-height:1.8">
        Ini adalah proyek Anchor.<br>
        Tambahkan pembanding untuk mulai banding multi.
        <div style="margin-top:14px;"><button class="cmp-add-btn" onclick="openCmpPicker()">+ Tambah pembanding</button></div>
      </div>`;
    return;
  }

  // [TAHAP 4] Bersihkan compareExtraIds dari ID yang sudah tidak valid, anchor, atau fokus
  compareExtraIds = compareExtraIds.filter(id => id!==ANCHOR_ID && id!==p.id && perumahan.some(x=>x.id===id));

  // Susun daftar proyek dalam urutan kolom: [anchor, fokus, ...extras]
  // Kalau fokus === anchor, tidak duplicate
  const cols = [];
  cols.push({p:anchor, role:'anchor', color:'var(--anchor)', label:'⭐ Anchor'});
  if(!isAnch) cols.push({p, role:'focus', color:(TIPE_COLOR[p.tipe]||'#666'), label:'🎯 Dipilih'});
  compareExtraIds.forEach((id,i)=>{
    const extra = perumahan.find(x=>x.id===id);
    if(extra) cols.push({p:extra, role:'extra', color:CMP_PALETTE[i%CMP_PALETTE.length], label:`Pembanding ${i+1}`});
  });

  // Helper nearest POI yang aware road upgrade
  const _nb = (x) => {
    const hav = nearestByKat(x), road = x._roadNearest || {};
    const out = {};
    Object.keys(KAT_LABEL).forEach(k => { out[k] = road[k] || hav[k]; });
    return out;
  };
  const nbs = cols.map(c=>_nb(c.p));
  const sds = cols.map(c=>c.p._scoreDetail || calcScoreFull(c.p));

  // Jarak tiap kolom ke anchor (untuk insight)
  const distToAnchor = cols.map(c=>{
    if(c.role==='anchor') return 0;
    const rk = c.p._roadPerum && c.p._roadPerum[ANCHOR_ID];
    return rk ? rk.km : haversine(c.p.lat,c.p.lng,anchor.lat,anchor.lng) * ROUTE_HAVERSINE_FACTOR;
  });
  const anyRoad = cols.some((c,i)=>c.role!=='anchor' && c.p._roadPerum && c.p._roadPerum[ANCHOR_ID] && c.p._roadPerum[ANCHOR_ID].viaRoad);

  // Kategori untuk row jarak ke POI
  const cats = Object.keys(KAT_LABEL);

  // Helper: highlight best/worst untuk nilai numerik (lebih tinggi = lebih baik untuk skor; lebih rendah = lebih baik untuk jarak)
  const highlightClass = (values, idx, lowerIsBetter) => {
    if(values.length<2) return 'cmp-val-mid';
    const valid = values.filter(v=>v!=null && !isNaN(v));
    if(valid.length<2) return 'cmp-val-mid';
    const best = lowerIsBetter ? Math.min(...valid) : Math.max(...valid);
    const worst= lowerIsBetter ? Math.max(...valid) : Math.min(...valid);
    if(values[idx]===best && best!==worst) return 'cmp-val-best';
    if(values[idx]===worst && best!==worst) return 'cmp-val-worst';
    return 'cmp-val-mid';
  };

  // Row builder — { key, label, values, lowerIsBetter, formatter }
  // [v18 SECTIONS] Setiap row sekarang punya `key` wajib — untuk mapping ke section.
  const rows = [
    {key:'skor_overall',label:VSA_ROW_LABEL.skor_overall, values: sds.map(s=>s.overall),        lowerIsBetter:false, fmt:(v)=>v},
    {key:'skor_aks',    label:VSA_ROW_LABEL.skor_aks,     values: sds.map(s=>s.aksesibilitas),  lowerIsBetter:false, fmt:(v)=>v},
    {key:'skor_fas',    label:VSA_ROW_LABEL.skor_fas,     values: sds.map(s=>s.fasilitas),      lowerIsBetter:false, fmt:(v)=>v},
    {key:'skor_fisik',  label:VSA_ROW_LABEL.skor_fisik,   values: sds.map(s=>s.fisik),          lowerIsBetter:false, fmt:(v)=>v},
  ];
  // Jarak ke POI per kategori — map kategori -> key
  const catToKey = {rs:'poi_rs', kampus:'poi_kampus', mall:'poi_mall', tol:'poi_tol', pemda:'poi_pemda', industri:'poi_industri', publik:'poi_publik'};
  cats.forEach(k=>{
    const vals = nbs.map(nb => nb[k] ? nb[k].dist : null);
    const rkey = catToKey[k];
    const label = rkey ? VSA_ROW_LABEL[rkey] : `${(poi.find(x=>x.kat===k)||{}).emoji||'📍'} ${KAT_LABEL[k]}`;
    rows.push({key:rkey, label, values:vals, lowerIsBetter:true, fmt:(v)=>v==null?'—':v.toFixed(1)+' km'});
  });
  // Data proyek
  rows.push({key:'proj_unit',     label:VSA_ROW_LABEL.proj_unit,      values: cols.map(c=>c.p.unit||0),      lowerIsBetter:false, fmt:(v)=>fmt(v)});
  rows.push({key:'proj_realisasi',label:VSA_ROW_LABEL.proj_realisasi, values: cols.map(c=>c.p.realisasi||0), lowerIsBetter:false, fmt:(v)=>fmt(v)});
  rows.push({key:'proj_progress', label:VSA_ROW_LABEL.proj_progress,  values: cols.map(c=>c.p.unit>0?Math.round((c.p.realisasi||0)/c.p.unit*100):0), lowerIsBetter:false, fmt:(v)=>v+'%'});

  // [v17 C] Row data Tapera — hanya tampil kalau minimal 1 kolom punya data Tapera
  const anyTapera = cols.some(c => c.p.tapera && c.p.tapera.realisasiBulanan && c.p.tapera.realisasiBulanan.length);
  if(anyTapera){
    // Helper untuk ambil top-1 label dari objek profil (misal {swasta:80, wiraswasta:15, other:5} → "swasta 80%")
    const topLabel = (obj) => {
      if(!obj || typeof obj !== 'object') return null;
      const entries = Object.entries(obj);
      if(!entries.length) return null;
      entries.sort((a,b)=>b[1]-a[1]);
      return entries[0]; // [key, val]
    };

    // Rata-rata unit/bulan (dari realisasiBulanan)
    const avgPerBulanVals = cols.map(c=>{
      const b = c.p.tapera?.realisasiBulanan;
      if(!b || !b.length) return null;
      const sum = b.reduce((a,x)=>a+(x.unit||0),0);
      return Math.round(sum/b.length * 10)/10;
    });
    rows.push({key:'tpr_avg', label:'📊 Tapera: rata²/bln', values: avgPerBulanVals, lowerIsBetter:false, fmt:(v)=>v==null?'—':v+' unit'});

    // Trend 3-bln terakhir
    const trendVals = cols.map(c=>{
      const b = c.p.tapera?.realisasiBulanan;
      if(!b || b.length<4) return null;
      const t = _calcTaperaTrend(b);
      const n = parseFloat(String(t.pctStr).replace('%','').replace('+',''));
      return isNaN(n) ? null : {num:n, icon:t.icon, str:t.pctStr, dir:t.dir};
    });
    rows.push({
      key:'tpr_trend', label:'📈 Trend 3-bln',
      values: trendVals.map(v=>v==null?null:v.num),
      lowerIsBetter:false,
      fmt:(v,i)=>{
        const t = trendVals[i];
        if(!t) return '—';
        const color = t.dir==='up'?'#15803D':(t.dir==='down'?'#B91C1C':'var(--muted)');
        return `<span style="color:${color};font-weight:700;">${t.icon} ${t.str}</span>`;
      }
    });

    // Total Realisasi Tapera
    rows.push({
      key:'tpr_total', label:'🏆 Total Realisasi', lowerIsBetter:false,
      values: cols.map(c=>c.p.tapera?.totalRealisasi ?? null),
      fmt:(v)=>v==null?'—':fmt(v)+' unit'
    });
    // Nominal FLPP
    rows.push({
      key:'tpr_flpp', label:'💵 Nominal FLPP', lowerIsBetter:false,
      values: cols.map(c=>c.p.tapera?.nominalFLPP ?? null),
      fmt:(v)=>v==null?'—':v+' M'
    });
    // Harga range
    rows.push({
      key:'tpr_harga', label:'💰 Harga range', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.hargaRange||null),
      fmt:(v)=>v||'—'
    });
    // Luas Tanah
    rows.push({
      key:'tpr_lt', label:'📐 Luas Tanah', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.luasTanah||null),
      fmt:(v)=>v||'—'
    });
    // Luas Bangunan
    rows.push({
      key:'tpr_lb', label:'🏠 Luas Bangunan', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.luasBangunan||null),
      fmt:(v)=>v||'—'
    });
    // Tenor Dominan
    rows.push({
      key:'tpr_tenor', label:'📅 Tenor Dominan', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.tenorDominan||null),
      fmt:(v)=>v||'—'
    });
    // Uang Muka Range
    rows.push({
      key:'tpr_um', label:'💳 Uang Muka', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.uangMukaRange||null),
      fmt:(v)=>v||'—'
    });
    // Bank Dominan
    rows.push({
      key:'tpr_bank', label:'🏦 Bank Dominan', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.bankDominan||null),
      fmt:(v)=>v||'—'
    });
    // Profil: Pekerjaan dominan
    rows.push({
      key:'tpr_pek', label:'💼 Pekerjaan dominan', noHighlight:true,
      values: cols.map(c=>topLabel(c.p.tapera?.profilPembeli?.pekerjaan)),
      fmt:(v)=>v?`${escapeHtml(v[0])} (${v[1]}%)`:'—'
    });
    // Profil: Usia dominan
    rows.push({
      key:'tpr_usia', label:'🎂 Usia dominan', noHighlight:true,
      values: cols.map(c=>topLabel(c.p.tapera?.profilPembeli?.usia)),
      fmt:(v)=>v?`${escapeHtml(v[0])}`:'—'
    });
    // Profil: Penghasilan dominan
    rows.push({
      key:'tpr_peng', label:'💴 Penghasilan dominan', noHighlight:true,
      values: cols.map(c=>topLabel(c.p.tapera?.profilPembeli?.penghasilan)),
      fmt:(v)=>v?`${escapeHtml(v[0])}`:'—'
    });
    // Profil: Gender dominan
    rows.push({
      key:'tpr_gender', label:'👥 Gender dominan', noHighlight:true,
      values: cols.map(c=>topLabel(c.p.tapera?.profilPembeli?.gender)),
      fmt:(v)=>v?`${escapeHtml(v[0])} (${v[1]}%)`:'—'
    });
    // [TAHAP1] Promotion rows
    rows.push({
      key:'tpr_promo_aktif', label:'🎁 Promo Aktif', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.promotion?.promoAktif||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_promo_periode', label:'📅 Periode Promo', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.promotion?.periode||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_promo_bonus', label:'🎉 Bonus Pembelian', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.promotion?.bonus||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_promo_iklan', label:'📱 Iklan di', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.promotion?.iklanPlatform||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_promo_bb', label:'📢 Billboard/Spanduk', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.promotion?.billboard||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    // [TAHAP1] Go-to-Market rows
    rows.push({
      key:'tpr_gtm_mkt', label:'👥 Marketing In-house', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.marketingInhouse||null),
      fmt:(v)=>v==null?'—':v+' org'
    });
    rows.push({
      key:'tpr_gtm_kanal', label:'🏢 Struktur Kanal', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.strukturKanal||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_gtm_agent', label:'🤝 Jumlah Agent', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.jumlahAgent||null),
      fmt:(v)=>v==null?'—':(v===0?'0':v+' agent')
    });
    rows.push({
      key:'tpr_gtm_fee_mkt', label:'💵 Fee Marketing', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.feeMarketing||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_gtm_fee_agt', label:'💵 Fee Agent', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.feeAgent||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_gtm_dev', label:'🏪 Brand Developer', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.brandDeveloper||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
  }

  // [TAHAP4B-2] Custom fields rows — per section, baca dari p.customFields[fieldId]
  try{
    Object.keys(FM_STATE.customFields||{}).forEach(secId => {
      (FM_STATE.customFields[secId]||[]).forEach(f => {
        if(_isFieldHidden(f.id)) return;
        rows.push({
          key: f.id,
          label: escapeHtml(f.label),
          noHighlight: true,
          values: cols.map(c => {
            const v = c.p.customFields?.[f.id];
            return v == null || v === '' ? null : v;
          }),
          fmt: (v) => {
            if(v == null) return '—';
            if(Array.isArray(v)) return v.length ? escapeHtml(v.join(', ')) : '—';
            if(f.type === 'yesno') return v===true?'Ya':(v===false?'Tidak':'—');
            return escapeHtml(String(v));
          }
        });
      });
    });
  }catch(e){ console.warn('custom rows err', e); }

  rows.push({label:'Launching', values: cols.map(c=>c.p.tahun||0), lowerIsBetter:false, fmt:(v)=>v||'—'});
  // Jarak ke anchor (skip di baris anchor sendiri — "—")
  rows.push({key:'dist_anchor', label:VSA_ROW_LABEL.dist_anchor, values: distToAnchor.map((d,i)=>cols[i].role==='anchor'?null:d), lowerIsBetter:true, fmt:(v)=>v==null?'—':v.toFixed(1)+' km'});

  // Build HTML
  const chipsHtml = cols.map((c,i)=>{
    const isRemovable = c.role==='extra';
    const isFocus = c.role==='focus';
    const isAnchorChip = c.role==='anchor';
    const nameShort = escapeHtml(c.p.nama);
    const bg = isAnchorChip ? 'var(--anchor-light)' : (isFocus ? 'rgba(59,130,246,0.12)' : c.color+'22');
    const txt = isAnchorChip ? 'var(--anchor)' : (isFocus ? '#1D4ED8' : c.color);
    const border = isAnchorChip ? 'var(--anchor)' : (isFocus ? '#1D4ED8' : c.color);
    return `<span class="cmp-chip" style="background:${bg};color:${txt};border:1px solid ${border};">
      <span class="cmp-chip-name" title="${nameShort}">${isAnchorChip?'⭐ ':(isFocus?'🎯 ':'')}${nameShort}</span>
      ${isRemovable?`<button class="cmp-chip-remove" onclick="removeCmpExtra(${c.p.id})" aria-label="Hapus">×</button>`:''}
    </span>`;
  }).join('');
  const remaining = 3 - compareExtraIds.length;
  const addBtn = remaining>0
    ? `<button class="cmp-add-btn" onclick="openCmpPicker()">+ tambah (${remaining} lagi)</button>`
    : `<button class="cmp-add-btn" disabled title="Max 3 pembanding">+ tambah (penuh)</button>`;

  const tableHead = `<tr><th class="cmp-lbl">Faktor</th>${cols.map(c=>`<th class="${c.role==='anchor'?'cmp-h-anchor':''}" title="${escapeHtml(c.p.nama)}" style="${c.role==='extra'?'color:'+c.color:''}">${c.role==='anchor'?'⭐':(c.role==='focus'?'🎯':(c.p.nama.substring(0,8)))}</th>`).join('')}</tr>`;

  // [v18 SECTIONS] Filter rows berdasarkan section aktif + quick-visibility toggle
  // 1) Ambil keys yang di-assign ke section aktif
  const activeSectionKeys = _getActiveSectionRows();
  // 2) Map row by key untuk lookup cepat
  const rowsByKey = {};
  rows.forEach(r => { if(r.key) rowsByKey[r.key] = r; });
  // 3) Build visibleRows mengikuti URUTAN di section config (bukan urutan rows asli)
  const visibleRows = activeSectionKeys
    .map(k => rowsByKey[k])
    .filter(r => r && vsaRowVisibility[r.key] !== false)
    // Row Tapera hanya tampil kalau ada data Tapera di salah satu kolom
    .filter(r => {
      if(r.key && r.key.startsWith('tpr_')) return anyTapera;
      return true;
    });

  // [TAHAP2] Simpan mapping colIdx -> perumahan id untuk modal detail
  const vsaColsForDetail = cols.map(c=>({id:c.p.id, nama:c.p.nama, role:c.role}));
  window._vsaDetailCols = vsaColsForDetail;

  const tableBody = visibleRows.length ? visibleRows.map(r=>{
    // [TAHAP2] Kalau row masuk VSA_COMPLEX_ROWS, tambah badge 📋 yang bisa diklik
    const isComplex = r.key && VSA_COMPLEX_ROWS.has(r.key);
    const labelHtml = isComplex
      ? `${r.label}<span class="vsa-complex-badge" onclick="openVsaDetail('${r.key}')" title="Lihat detail lengkap">📋 detail</span>`
      : r.label;
    return `<tr><td class="cmp-lbl">${labelHtml}</td>${
      r.values.map((v,i)=>{
        const cls = r.noHighlight ? 'cmp-val-mid' : highlightClass(r.values, i, r.lowerIsBetter);
        return `<td class="${cls}">${r.fmt(v,i)}</td>`;
      }).join('')
    }</tr>`;
  }).join('') : '';

  // Insight multi — rata-rata selisih skor, rata-rata realisasi, overlap/jauh
  const focusSd = sds[cols.findIndex(c=>c.role==='focus')] || sds[0];
  const others = cols.filter(c=>c.role!=='anchor');
  const avgScore = others.length ? Math.round(others.map(c=>(c.p._scoreDetail||calcScoreFull(c.p)).overall).reduce((a,b)=>a+b,0)/others.length) : 0;
  const anchorScore = sds[0].overall;
  const deltaAvg = anchorScore - avgScore;
  const insights = [];
  if(others.length>=2){
    if(deltaAvg>=10) insights.push({type:'good',text:`Anchor unggul rata-rata ${deltaAvg} poin vs ${others.length} kompetitor — posisi kuat.`});
    else if(deltaAvg<=-10) insights.push({type:'warn',text:`Anchor kalah rata-rata ${Math.abs(deltaAvg)} poin dari grup kompetitor — perlu strategi.`});
    else insights.push({type:'neutral',text:`Selisih rata-rata hanya ${Math.abs(deltaAvg)} poin — persaingan ketat.`});
  }
  const closeComp = others.filter((c,i)=>{const idx=cols.findIndex(x=>x.p.id===c.p.id); return distToAnchor[idx]<3;}).length;
  if(closeComp>=2) insights.push({type:'warn',text:`${closeComp} kompetitor dalam radius 3 km dari anchor — target market overlap tinggi.`});
  const matureComp = others.filter(c=>c.p.unit>0 && (c.p.realisasi/c.p.unit)>=0.8).length;
  if(matureComp>0) insights.push({type:'warn',text:`${matureComp} kompetitor realisasi ≥80% — pasar sekitar sudah terserap mayoritas.`});
  const youngComp = others.filter(c=>c.p.unit>0 && (c.p.realisasi/c.p.unit)<0.3).length;
  if(youngComp>0) insights.push({type:'good',text:`${youngComp} kompetitor realisasi <30% — ruang serap pasar masih tersedia.`});

  // [v17 C] Insight Tapera — bandingkan trend antar kolom
  if(anyTapera){
    const colsWithTapera = cols.filter(c=>c.p.tapera?.realisasiBulanan?.length>=4);
    if(colsWithTapera.length>=2){
      const trends = colsWithTapera.map(c=>({nama:c.p.nama, role:c.role, t:_calcTaperaTrend(c.p.tapera.realisasiBulanan)}));
      const anchorTrend = trends.find(x=>x.role==='anchor');
      const othersTrend = trends.filter(x=>x.role!=='anchor');
      const rising = othersTrend.filter(x=>x.t.dir==='up').length;
      const falling = othersTrend.filter(x=>x.t.dir==='down').length;
      if(anchorTrend && anchorTrend.t.dir==='up' && falling>=1){
        insights.push({type:'good',text:`Anchor trend naik (${anchorTrend.t.pctStr}) sementara ${falling} kompetitor turun — momentum menguntungkan.`});
      } else if(anchorTrend && anchorTrend.t.dir==='down' && rising>=1){
        insights.push({type:'warn',text:`Anchor trend turun (${anchorTrend.t.pctStr}) sementara ${rising} kompetitor naik — perlu audit strategi.`});
      } else if(rising>=2){
        insights.push({type:'warn',text:`${rising} kompetitor trend naik — tekanan persaingan meningkat.`});
      }
    }
    // Kompetitor tanpa data Tapera
    const missing = others.filter(c=>!(c.p.tapera?.realisasiBulanan?.length));
    if(missing.length && missing.length<=3){
      insights.push({type:'neutral',text:`${missing.length} kompetitor belum punya data Tapera — banding lebih lengkap butuh input manual.`});
    }
  }
  if(others.length===1 && others[0].role==='focus'){
    // Mode 1-vs-1 lama — insight detail tentang fokus
    const c = others[0];
    if(c.p.tipe===anchor.tipe) insights.push({type:'warn',text:'Tipe proyek sama — kompetitor langsung.'});
    else insights.push({type:'good',text:'Tipe proyek berbeda — segmen berbeda.'});
  }
  const insightsHtml = insights.length
    ? insights.map(i=>`<div style="font-size:11px;line-height:1.5;padding:4px 0;color:${i.type==='good'?'#15803D':(i.type==='warn'?'#B45309':'var(--muted)')};">${i.type==='good'?'✓':(i.type==='warn'?'⚠':'·')} ${i.text}</div>`).join('')
    : '<div style="font-size:11px;color:var(--muted);font-style:italic;">Tambah pembanding untuk melihat insight grup.</div>';

  // Badge jarak mode
  const nCmp = others.length;
  const headerCount = nCmp===0 ? 'Belum ada pembanding' : `${nCmp} pembanding${anyRoad?' · 🛣 via jalan':' · 📏 perkiraan'}`;

  // [v18 SECTIONS] Build sub-tab section bar
  // Pastikan vsaActiveSectionId masih valid (kalau user baru saja delete section aktif, fallback ke yang pertama)
  if(!VSA_SECTIONS.some(s=>s.id===vsaActiveSectionId)){
    vsaActiveSectionId = VSA_SECTIONS[0]?.id || 'ringkasan';
    _saveVsaActiveSection();
  }
  const sectionTabsHtml = VSA_SECTIONS.map(s=>{
    // Hitung berapa row di section ini yang ACTUALLY punya data (untuk badge count)
    const availableRows = s.rows.filter(k=>{
      const r = rowsByKey[k];
      if(!r) return false;
      if(k.startsWith('tpr_')) return anyTapera;
      return true;
    });
    const count = availableRows.filter(k => vsaRowVisibility[k] !== false).length;
    const isActive = s.id === vsaActiveSectionId;
    return `<button class="vsa-stab ${isActive?'active':''}" onclick="switchVsaSection('${s.id}')" title="${escapeHtml(s.name)}">${s.emoji} ${escapeHtml(s.name)} <span class="vsa-count">${count}</span></button>`;
  }).join('');

  // [v18 SECTIONS] Build quick toggle panel — scoped ke section aktif saja
  const activeSection = VSA_SECTIONS.find(s=>s.id===vsaActiveSectionId) || VSA_SECTIONS[0];
  const sectionRowKeysForPanel = (activeSection?.rows || []).filter(k=>{
    const r = rowsByKey[k];
    if(!r) return false;
    if(k.startsWith('tpr_')) return anyTapera;
    return true;
  });
  const quickTogglePanelHtml = (function(){
    if(!sectionRowKeysForPanel.length) return '';
    const activeCount = sectionRowKeysForPanel.filter(k=>vsaRowVisibility[k]!==false).length;
    const total = sectionRowKeysForPanel.length;
    const items = sectionRowKeysForPanel.map(k=>{
      const checked = vsaRowVisibility[k]!==false ? 'checked' : '';
      return `<label class="tpr-col-opt"><input type="checkbox" ${checked} onchange="toggleVsaRow('${k}', this.checked)"> <span>${VSA_ROW_LABEL[k]||k}</span></label>`;
    }).join('');
    return `
    <div class="vsa-row-wrap">
      <button class="vsa-row-toggle" onclick="toggleVsaRowPanel()" title="Atur baris di section ini">
        ⚙️ Baris <span class="vsa-row-count">${activeCount}/${total}</span>
      </button>
      <div class="vsa-row-panel" id="vsa-row-panel">
        <div class="tpr-col-head">
          <span>Baris di "${escapeHtml(activeSection.name)}"</span>
        </div>
        <div>${items}</div>
      </div>
    </div>`;
  })();

  // Empty state kalau section tidak punya row yang bisa ditampilkan
  const emptyStateHtml = visibleRows.length ? '' : `
    <div class="vsa-empty-section">
      <div style="font-size:18px;margin-bottom:4px;">${activeSection?.emoji||'📁'}</div>
      <b>Tidak ada baris di section "${escapeHtml(activeSection?.name||'?')}"</b><br>
      ${sectionRowKeysForPanel.length
        ? 'Semua baris di section ini di-hide. Klik <b>⚙️ Baris</b> untuk tampilkan lagi.'
        : 'Section ini kosong. Tambahkan baris lewat <b>⚙️ Hub Formula → Kategori Vs Anchor</b>.'}
    </div>`;

  // [TAHAP4A] Per-section verdicts — sinkron dengan Detail Lengkap
  const anchorIdx = cols.findIndex(c=>c.role==='anchor');
  const focusIdx = cols.findIndex(c=>c.role==='focus');
  const targetIdx = focusIdx>=0 ? focusIdx : anchorIdx;
  const target = targetIdx>=0 ? cols[targetIdx] : null;
  const verdictHtml = target ? buildVsaSectionVerdicts(target) : '';

  document.getElementById('tab-compare').innerHTML = `
    <div class="cmp-multi-controls">
      ${chipsHtml}
      ${addBtn}
    </div>
    <div class="vsa-sections">
      ${sectionTabsHtml}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
      <div style="font-size:10px;color:var(--faint);letter-spacing:0.3px;">${headerCount}</div>
      <div style="display:flex;gap:6px;align-items:center;">
        ${quickTogglePanelHtml}
        ${nCmp>0?'<button class="cmp-fit-btn" onclick="refitCompareOnMap()" title="Zoom peta besar ke semua pembanding">🎯 Fit peta</button>':''}
      </div>
    </div>
    ${visibleRows.length ? `
    <div class="cmp-multi-table-wrap">
      <table class="cmp-multi-table"><thead>${tableHead}</thead><tbody>${tableBody}</tbody></table>
    </div>` : emptyStateHtml}
    <div class="section-title">💡 Insight Strategis</div>
    <div style="background:var(--bg);border-radius:6px;padding:8px 12px;">${insightsHtml}</div>
    ${verdictHtml}
  `;

  // [v17 A1] Highlight di peta besar (bukan mini-map lagi) — simpan cols untuk refit manual.
  _lastCompareCols = cols;
  setTimeout(()=>highlightCompareOnMainMap(cols), 0);
}

// Tombol "Fit peta" di tab compare — pakai cols terakhir yang di-render
let _lastCompareCols = null;
function refitCompareOnMap(){
  if(!_lastCompareCols || !analisaMap) return;
  try{
    const bounds = L.latLngBounds(_lastCompareCols.map(c=>[c.p.lat,c.p.lng]));
    analisaMap.fitBounds(bounds, {padding:[50,50], maxZoom:14, animate:true});
  }catch(_){}
}

// [v17 A1] Highlight pembanding di peta besar (menggantikan mini-map lama).
// State: simpan polyline compare + id marker yang di-boost supaya bisa di-restore saat clear.
let cmpHighlightLines = [];
let cmpHighlightIds = []; // ids yang marker-nya di-boost (untuk restore icon/z-index)
let cmpHighlightOriginalIcons = {}; // id -> original L.divIcon (untuk restore)

function _makeCompareMarkerIcon(p, role, color){
  const isAnch = role==='anchor';
  const isFocus = role==='focus';
  const sz = isAnch ? 28 : (isFocus ? 24 : 22);
  const ring = isAnch ? '3px solid #D97706' : '3px solid '+color;
  const glow = isAnch ? '0 0 0 4px rgba(217,119,6,0.28)'
             : (isFocus ? '0 0 0 4px rgba(59,130,246,0.22)' : '0 0 0 3px '+color+'33');
  const badge = isAnch ? '⭐' : (isFocus ? '🎯' : '');
  const inner = `<div style="width:${sz}px;height:${sz}px;background:${color};border:${ring};border-radius:50%;box-shadow:${glow},0 2px 6px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;color:white;font-size:${isAnch?13:11}px;font-weight:700;">${badge}</div>`;
  return L.divIcon({html:inner, iconSize:[sz,sz], iconAnchor:[sz/2,sz/2], className:''});
}

// Highlight marker kompetitor yang masuk banding di peta besar.
// Dipanggil dari renderDetailCompare; clearCompareHighlight dipanggil saat reset/pindah tab.
function highlightCompareOnMainMap(cols){
  if(!analisaMapInit || !analisaMap) return;
  // Bersihkan state lama dulu (tanpa reset role-color-nya — kita rebuild sekarang)
  clearCompareHighlight();
  if(!cols || cols.length===0) return;
  const anchor = cols.find(c=>c.role==='anchor')?.p;
  if(!anchor) return;

  cols.forEach(c=>{
    const entry = markers[c.p.id];
    if(!entry || !entry.marker) return;
    // Simpan icon original supaya bisa di-restore (pakai opsi internal Leaflet)
    try{ cmpHighlightOriginalIcons[c.p.id] = entry.marker.options.icon; }catch(_){}
    const newIcon = _makeCompareMarkerIcon(c.p, c.role, c.color);
    entry.marker.setIcon(newIcon);
    entry.marker.setZIndexOffset(1000); // angkat ke atas
    // Update tooltip singkat biar lihat role
    try{
      const sd = c.p._scoreDetail || calcScoreFull(c.p);
      const prefix = c.role==='anchor' ? '⭐ Anchor · ' : (c.role==='focus' ? '🎯 Dipilih · ' : 'Pembanding · ');
      entry.marker.setTooltipContent(`<b>${prefix}${escapeHtml(c.p.nama)}</b><br>${escapeHtml(c.p.area||'')} · Skor: <b>${sd.overall}</b>`);
    }catch(_){}
    cmpHighlightIds.push(c.p.id);

    // Polyline dashed anchor → pembanding
    if(c.role!=='anchor'){
      const line = L.polyline([[anchor.lat,anchor.lng],[c.p.lat,c.p.lng]], {
        color: c.color, weight: 3, opacity: 0.65, dashArray: '8,6'
      }).addTo(analisaMap);
      // Tooltip jarak on-hover
      try{ line.bindTooltip(_distToAnchorStr(c.p, anchor), {sticky:true, direction:'top'}); }catch(_){}
      cmpHighlightLines.push(line);
    }
  });

  // Auto-fit bounds ke semua kolom (pilihan user: fit otomatis)
  if(cols.length >= 2){
    try{
      const bounds = L.latLngBounds(cols.map(c=>[c.p.lat,c.p.lng]));
      analisaMap.fitBounds(bounds, {padding:[50,50], maxZoom:14, animate:true});
    }catch(_){}
  }
}

function clearCompareHighlight(){
  // Hapus garis
  cmpHighlightLines.forEach(line=>{ try{ analisaMap && analisaMap.removeLayer(line); }catch(_){} });
  cmpHighlightLines = [];
  // Restore marker icon & tooltip + z-index
  cmpHighlightIds.forEach(id=>{
    const entry = markers[id];
    if(!entry || !entry.marker) return;
    const orig = cmpHighlightOriginalIcons[id];
    if(orig){ try{ entry.marker.setIcon(orig); }catch(_){} }
    try{ entry.marker.setZIndexOffset(0); }catch(_){}
    // Restore tooltip default
    try{
      const p = entry.data;
      entry.marker.setTooltipContent(`<b>${escapeHtml(p.nama)}</b><br>${escapeHtml(p.area||'')} · Skor: <b>${p.score}</b>`);
    }catch(_){}
  });
  cmpHighlightIds = [];
  cmpHighlightOriginalIcons = {};
}
function _distToAnchorStr(p, anchor){
  const rk = p._roadPerum && p._roadPerum[ANCHOR_ID];
  if(rk && rk.viaRoad) return `🛣 ${rk.km.toFixed(1)} km`;
  const d = haversine(p.lat,p.lng,anchor.lat,anchor.lng)*ROUTE_HAVERSINE_FACTOR;
  return `📏 ~${d.toFixed(1)} km`;
}

// [TAHAP 4] Picker overlay logic
function openCmpPicker(){
  if(compareExtraIds.length>=3){ showToast('Maksimal 3 pembanding tambahan'); return; }
  document.getElementById('cmp-picker-search').value='';
  renderCmpPickerList();
  document.getElementById('cmp-picker-overlay').classList.add('open');
}
function closeCmpPicker(){
  document.getElementById('cmp-picker-overlay').classList.remove('open');
}
function renderCmpPickerList(){
  const q = (document.getElementById('cmp-picker-search').value||'').toLowerCase().trim();
  const excludeIds = new Set([ANCHOR_ID, selectedId, ...compareExtraIds]);
  const list = perumahan
    .filter(p => !excludeIds.has(p.id))
    .filter(p => !q || p.nama.toLowerCase().includes(q) || (p.area||'').toLowerCase().includes(q));
  const el = document.getElementById('cmp-picker-list');
  if(list.length===0){ el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--faint);font-size:11px;">Tidak ada hasil.</div>'; return; }
  el.innerHTML = list.slice(0,50).map(p=>{
    const sd = p._scoreDetail || calcScoreFull(p);
    return `<div class="cmp-picker-item" onclick="addCmpExtra(${p.id})">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.nama)}</div>
        <div class="cmp-picker-item-sub">${escapeHtml(p.area||'-')} · ${p.tipe||''}</div>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--accent);font-family:'DM Mono',monospace;">${sd.overall}</div>
    </div>`;
  }).join('');
}
function addCmpExtra(id){
  if(compareExtraIds.includes(id)) return;
  if(compareExtraIds.length>=3){ showToast('Maksimal 3 pembanding'); return; }
  if(id===ANCHOR_ID || id===selectedId) return;
  compareExtraIds.push(id);
  closeCmpPicker();
  // Re-render tab
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}
function removeCmpExtra(id){
  compareExtraIds = compareExtraIds.filter(x=>x!==id);
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}
// Reset extras saat pindah perumahan — clear highlight di peta besar
function _resetCompareExtrasOnSelect(){
  compareExtraIds = [];
  _lastCompareCols = null;
  if(typeof clearCompareHighlight === 'function') clearCompareHighlight();
}

async function hitungJarakViaJalanCompare(pid){
  const p=perumahan.find(x=>x.id===pid);if(!p)return;
  const anchor=perumahan.find(x=>x.id===ANCHOR_ID);if(!anchor)return;
  const el=document.getElementById('cmp-jarak-road');
  if(el){el.textContent='menghitung...';el.style.cursor='default';}
  const r=await getRouteDistance(p.lat,p.lng,anchor.lat,anchor.lng);
  if(!el)return;
  if(r.viaRoad){
    el.innerHTML=`<b>${r.km.toFixed(1)} km via jalan · ${r.menit} mnt berkendara</b>`;
    el.style.textDecoration='none';el.style.cursor='default';
  } else {
    el.innerHTML=`⚠ Server rute tidak tersedia · ${r.km.toFixed(1)} km (estimasi)`;el.style.textDecoration='none';
  }
}
function renderDetailRadar(p){
  const isAnch=p.id===ANCHOR_ID;
  const anchor=perumahan.find(x=>x.id===ANCHOR_ID);
  // [TAHAP 2] Pakai _roadNearest kalau ada, fallback ke haversine
  const _nb = (x) => {
    const hav = nearestByKat(x), road = x._roadNearest || {};
    const out = {};
    Object.keys(KAT_LABEL).forEach(k => { out[k] = road[k] || hav[k]; });
    return out;
  };
  const nb_a = isAnch ? null : _nb(anchor);
  document.getElementById('tab-radar').innerHTML=`
    <div style="font-size:11px;color:var(--muted);text-align:center;margin-bottom:10px;">Profil kekuatan lokasi per kategori fasilitas</div>
    <canvas id="radar-canvas" width="260" height="245" style="width:100%;max-width:260px;display:block;margin:0 auto 8px;"></canvas>
    ${!isAnch?`<div style="display:flex;gap:14px;justify-content:center;font-size:10px;color:var(--muted)">
      <span style="display:flex;align-items:center;gap:3px;"><span style="width:10px;height:3px;background:#2563EB;display:inline-block;border-radius:2px;"></span>Dipilih</span>
      <span style="display:flex;align-items:center;gap:3px;"><span style="width:10px;height:3px;background:#D97706;display:inline-block;border-radius:2px;"></span>Anchor</span>
    </div>`:''}`;
  setTimeout(()=>drawRadar(_nb(p),nb_a),50);
}
function renderDetailNearby(p){
  // [TAHAP 2] Pakai _roadPerum (jarak antar perumahan via jalan) jika tersedia
  const roadPerum = p._roadPerum || {};
  const near=[...perumahan].filter(x=>x.id!==p.id).map(x=>{
    if(roadPerum[x.id]){
      return {...x, dist: roadPerum[x.id].km, menit: roadPerum[x.id].menit, viaRoad: roadPerum[x.id].viaRoad};
    }
    return {...x, dist: haversine(p.lat,p.lng,x.lat,x.lng) * ROUTE_HAVERSINE_FACTOR, menit: null, viaRoad: false};
  }).sort((a,b)=>a.dist-b.dist).slice(0,6);
  const anyRoad = near.some(x => x.viaRoad);
  document.getElementById('tab-nearby').innerHTML=`
    <div class="section-title">6 Perumahan Terdekat ${anyRoad ? '<span style="font-size:9px;color:#15803D;font-weight:600;">🛣 via jalan</span>' : ''}</div>
    ${near.map(x=>`<div class="nearby-row">
      <div style="display:flex;align-items:center;gap:7px;flex:1;min-width:0">
        <span class="nearby-dot" style="background:${TIPE_COLOR[x.tipe]||'#65A30D'}"></span>
        <div><div class="nearby-name">${x.id===ANCHOR_ID?'⭐ ':''}${escapeHtml(x.nama)}</div>
        <div class="nearby-sub">${escapeHtml(x.area)} · ${TIPE_LABEL[x.tipe]||escapeHtml(x.tipe)} · Skor: ${x.score}</div></div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="nearby-dist">${x.dist.toFixed(1)} km${x.viaRoad?'':' <span style="font-size:8px;color:#94a3b8">~</span>'}</div>
        <div class="nearby-min">~${x.menit || travelMin(x.dist)} mnt</div>
      </div>
    </div>`).join('')}`;
}
function drawRadar(nb,nb_a){
  const canvas=document.getElementById('radar-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const cats=Object.keys(KAT_LABEL);
  const W=260,H=245,cx=130,cy=128,R=85,n=cats.length;
  ctx.clearRect(0,0,W,H);
  const angles=cats.map((_,i)=>(-Math.PI/2)+(2*Math.PI*i/n));
  for(let rv=0.25;rv<=1;rv+=0.25){ctx.beginPath();angles.forEach((a,i)=>{const x=cx+R*rv*Math.cos(a),y=cy+R*rv*Math.sin(a);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.closePath();ctx.strokeStyle=`rgba(0,0,0,${rv===1?0.12:0.05})`;ctx.lineWidth=rv===1?1.5:1;ctx.stroke();}
  angles.forEach(a=>{ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+R*Math.cos(a),cy+R*Math.sin(a));ctx.strokeStyle='rgba(0,0,0,0.06)';ctx.lineWidth=1;ctx.stroke();});
  ctx.font='bold 8px DM Sans,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#5F5E5A';
  angles.forEach((a,i)=>{const lx=cx+(R+14)*Math.cos(a),ly=cy+(R+14)*Math.sin(a);ctx.fillText(cats[i].toUpperCase().slice(0,4),lx,ly);});
  function sc(nbD,k){if(!nbD||!nbD[k])return 0;return Math.max(0,Math.min(1,(100-(nbD[k].dist*FORMULA.decayFas))/100));}
  function shape(nbD,color,alpha){ctx.beginPath();angles.forEach((a,i)=>{const s=sc(nbD,cats[i]),x=cx+R*s*Math.cos(a),y=cy+R*s*Math.sin(a);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.closePath();ctx.fillStyle=color.replace('rgb','rgba').replace(')',`,${alpha})`);ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();angles.forEach((a,i)=>{const s=sc(nbD,cats[i]),x=cx+R*s*Math.cos(a),y=cy+R*s*Math.sin(a);ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=1.5;ctx.stroke();});}
  if(nb_a)shape(nb_a,'rgb(217,119,6)',0.12);
  shape(nb,'rgb(37,99,235)',0.18);
}
function switchTab(t,el){
  document.querySelectorAll('.tab-bar .tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(x=>x.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-'+t).classList.add('active');
  // [v12.4 STATE PERSISTENCE]
  if(typeof triggerSaveAppState === 'function') triggerSaveAppState();
  if(t==='radar'&&selectedId){
    const p=perumahan.find(x=>x.id===selectedId);
    const anchor=perumahan.find(x=>x.id===ANCHOR_ID);
    setTimeout(()=>drawRadar(nearestByKat(p),p.id===ANCHOR_ID?null:nearestByKat(anchor)),50);
  }
  // [v17 A1] Highlight di peta besar hanya saat tab compare aktif
  if(t==='compare'){
    if(_lastCompareCols) setTimeout(()=>highlightCompareOnMainMap(_lastCompareCols), 30);
  } else {
    if(typeof clearCompareHighlight === 'function') clearCompareHighlight();
  }
}

// ============================================================
// STRATEGI / TARGET PASAR MAP
// ============================================================
function initStratMap(){
  if(tpMapInit){tpMap.invalidateSize();renderTPList(tpFilter);renderTPMarkers();return;}
  tpMap=L.map('strat-map').setView([-6.530,107.740],11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(tpMap);
  const anchorIcon=L.divIcon({html:`<div style="width:20px;height:20px;background:#D97706;border-radius:50%;border:3px solid white;box-shadow:0 0 0 3px rgba(217,119,6,0.4);display:flex;align-items:center;justify-content:center;font-size:10px;">⭐</div>`,iconSize:[20,20],iconAnchor:[10,10],className:''});
  const proj=currentProyek?PROYEK[currentProyek]:PROYEK.gwc;
  L.marker([proj.lat,proj.lng],{icon:anchorIcon}).addTo(tpMap).bindTooltip(`<b>⭐ ${escapeHtml(proj.nama)}</b><br>Proyek Kita`,{direction:'top'});
  tpMapInit=true;
  renderTPMarkers();
  renderTPList(tpFilter);
  updateTpDashCount();
}
function saveTpData(){
  localStorage.setItem('bm4_tp_targets',JSON.stringify(tpTargets));
  if(USE_SHEETS)saveTpToSheets();
  updateTpDashCount();
}
async function saveTpToSheets(){
  try{
    await fetch(GAS_URL, {
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: gasPost({action:'saveTargetPasar', rows:tpTargets})
    });
  }catch(e){console.warn('Gagal sync TP:',e);}
}
async function loadTpFromSheets(){
  if(!USE_SHEETS)return false;
  try{
    const r=await fetch(gasGet('getTargetPasar')).then(res=>res.json());
    if(r.success&&r.data&&r.data.length>0){
      tpTargets=r.data.map(row=>({id:parseInt(row.id),nama:row.nama,jenis:row.jenis,lat:parseFloat(row.lat),lng:parseFloat(row.lng),karyawan:parseInt(row.karyawan)||0,pic:row.pic||'',lastcontact:row.lastcontact||'-',status:parseInt(row.status)||0,catatan:row.catatan||''}));
      localStorage.setItem('bm4_tp_targets',JSON.stringify(tpTargets));
      return true;
    }return false;
  }catch(e){return false;}
}
function updateTpDashCount(){
  document.getElementById('d-target').textContent=tpTargets.length;
  document.getElementById('d-deal').textContent=tpTargets.filter(t=>t.status===4).length;
  document.getElementById('tp-total').textContent=tpTargets.length;
}
function renderTPMarkers(){
  if(!tpMapInit)return;
  Object.values(tpMarkers).forEach(m=>tpMap.removeLayer(m));tpMarkers={};
  const filtered=tpFilter==='semua'?tpTargets:tpTargets.filter(t=>t.jenis===tpFilter);
  const proj=currentProyek?PROYEK[currentProyek]:PROYEK.gwc;
  filtered.forEach(t=>{
    const color=STATUS_COLOR[t.status]||'#94A3B8';
    const icon=L.divIcon({html:`<div style="width:16px;height:16px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.35);"></div>`,iconSize:[16,16],iconAnchor:[8,8],className:''});
    const m=L.marker([t.lat,t.lng],{icon}).addTo(tpMap);
    const dist=haversine(proj.lat,proj.lng,t.lat,t.lng).toFixed(1);
    m.bindTooltip(`<b>${escapeHtml(t.nama)}</b><br>${STATUS_STEPS[t.status].icon} ${STATUS_STEPS[t.status].label} · ${dist} km`,{direction:'top'});
    m.on('click',()=>selectTP(t.id));
    tpMarkers[t.id]=m;
  });
}
function renderTPList(filter){
  const list=document.getElementById('tp-list');
  const filtered=filter==='semua'?tpTargets:tpTargets.filter(t=>t.jenis===filter);
  const proj=currentProyek?PROYEK[currentProyek]:PROYEK.gwc;
  list.innerHTML=filtered.map(t=>{
    const color=STATUS_COLOR[t.status]||'#94A3B8';
    const dist=haversine(proj.lat,proj.lng,t.lat,t.lng).toFixed(1);
    const ji=t.jenis==='pabrik'?'🏭':t.jenis==='kawasan'?'🏗️':'🏢';
    const st=STATUS_STEPS[t.status]||{label:'—',icon:'•'};
    const potensi=calcPotensiUnit(t.karyawan);
    return`<div class="tp-item${selectedTpId===t.id?' selected':''}" onclick="selectTP(${t.id})">
      <div class="tp-item-head-v11">
        <div class="tp-item-badge-v11" style="background:${color}22;color:${color};border:1px solid ${color}44;">
          <span>${st.icon}</span><span>${escapeHtml(st.label).toUpperCase()}</span>
        </div>
        <button class="tp-item-edit-v11" onclick="event.stopPropagation();openTpModal(${t.id});" title="Edit target">✎</button>
      </div>
      <div class="tp-item-top" style="margin-top:4px;">
        <div class="tp-item-icon" style="background:${color}20;">${ji}</div>
        <div class="tp-item-name">${escapeHtml(t.nama)}</div>
      </div>
      <div class="tp-item-meta">${dist} km · ${Number(t.karyawan||0).toLocaleString('id')} karyawan · <b style="color:var(--accent);">${potensi} unit potensi</b></div>
    </div>`;
  }).join('');
  document.getElementById('tp-total').textContent=tpTargets.length;
}
function filterTP(f,el){
  document.querySelectorAll('.tp-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');tpFilter=f;
  renderTPList(f);renderTPMarkers();
}
function selectTP(id){
  selectedTpId=id;
  // Tutup popup sebelumnya sebelum pilih target baru
  if(tpMap) tpMap.closePopup();
  clearTpJumpRoute();
  const t=tpTargets.find(x=>x.id===id);if(!t)return;
  renderTPList(tpFilter);
  const proj=currentProyek?PROYEK[currentProyek]:PROYEK.gwc;
  const dist=haversine(proj.lat,proj.lng,t.lat,t.lng).toFixed(1);
  const menit=Math.round(parseFloat(dist)/40*60);
  const potensi=calcPotensiUnit(t.karyawan);
  const ji=t.jenis==='pabrik'?'🏭 Pabrik / Manufaktur':t.jenis==='kawasan'?'🏗️ Kawasan Industri':'🏢 Perusahaan';

  // Status Hero Box (v11+)
  const st=STATUS_STEPS[t.status]||{label:'—',icon:'•'};
  const stColor=STATUS_COLOR[t.status]||'#94A3B8';
  const heroEl=document.getElementById('tp-d-status-hero');
  if(heroEl){
    heroEl.style.background=stColor+'15';
    heroEl.style.border=`1px solid ${stColor}40`;
    heroEl.innerHTML=`
      <div class="icon" style="color:${stColor};">${st.icon}</div>
      <div class="lbl" style="color:${stColor};">STATUS SAAT INI</div>
      <div class="val" style="color:${stColor};">${st.label}</div>
    `;
  }

  document.getElementById('tp-d-name').textContent=t.nama;
  document.getElementById('tp-d-type').textContent=ji;
  document.getElementById('tp-d-jarak').innerHTML=`${dist} km lurus · ±${menit} mnt <a id="tp-d-jarak-road" style="display:inline-block;margin-left:6px;font-size:10px;color:white;background:var(--accent);padding:3px 9px;border-radius:10px;cursor:pointer;font-weight:600;letter-spacing:0.3px;" onclick="hitungJarakViaJalanTP(${id})">🗺️ TAMPILKAN RUTE</a>`;
  document.getElementById('tp-d-karyawan').textContent=`~${t.karyawan.toLocaleString('id')} orang`;
  document.getElementById('tp-d-potensi').textContent=`~${potensi} unit (est. ${POTENSI_PCT}%)`;
  document.getElementById('tp-d-pic').textContent=t.pic||'—';
  document.getElementById('tp-d-lastcontact').textContent=t.lastcontact&&t.lastcontact!=='-'?formatTanggalID(t.lastcontact):'Belum ada';
  document.getElementById('tp-d-catatan').textContent=t.catatan||'—';
  document.getElementById('tp-d-progres').innerHTML=STATUS_STEPS.map((s,i)=>{
    let cls=i<t.status?'done':i===t.status?'current':'pending';
    return`<div class="tp-progres-item ${cls}"><span style="width:16px;text-align:center;">${i<t.status?'✓':s.icon}</span>${s.label}</div>`;
  }).join('');
  document.getElementById('tp-d-editbtn').onclick=()=>openTpModal(id);
  document.getElementById('tp-d-deletebtn').onclick=()=>deleteTP(id);
  document.getElementById('tp-detail').classList.add('show');
  if(tpMap&&tpMarkers[id])tpMap.panTo([t.lat,t.lng]);
}

let tpJumpLine=null;
let tpJumpPulse=null;

async function hitungJarakViaJalanTP(id){
  const t=tpTargets.find(x=>x.id===id);if(!t)return;
  const proj=currentProyek?PROYEK[currentProyek]:PROYEK.gwc;
  const el=document.getElementById('tp-d-jarak-road');
  if(el){el.textContent='menghitung...';el.style.cursor='default';}

  const r=await getRouteDistance(proj.lat,proj.lng,t.lat,t.lng);
  const span=document.getElementById('tp-d-jarak-road');

  if(!span)return;
  if(r.viaRoad){
    span.innerHTML=`<b style="color:var(--accent);">${r.km.toFixed(1)} km via jalan</b> <span style="color:var(--muted);">(${r.menit} mnt)</span>`;
    span.style.textDecoration='none';
  } else {
    span.innerHTML=`<span style="color:#B45309;">⚠ Rute tidak tersedia · ${r.km.toFixed(1)} km (estimasi via jalan)</span>`;
    span.style.textDecoration='none';
  }

  // Gambar rute di peta strategi
  if(tpMap && tpMapInit){
    if(tpJumpLine){tpMap.removeLayer(tpJumpLine);tpJumpLine=null;}
    if(tpJumpPulse){tpMap.removeLayer(tpJumpPulse);tpJumpPulse=null;}

    const lineStyle=r.viaRoad
      ? {color:'#D97706',weight:4,opacity:0.85}
      : {color:'#D97706',weight:3,opacity:0.7,dashArray:'8,6'};
    tpJumpLine=L.polyline(r.coords,lineStyle).addTo(tpMap);

    // Pulsing circle
    tpJumpPulse=L.circleMarker([t.lat,t.lng],{
      radius:32,color:'#D97706',fillColor:'#FBBF24',
      fillOpacity:0.4,weight:3
    }).addTo(tpMap);
    let opacity=0.4;
    const pulseInterval=setInterval(()=>{
      opacity-=0.018;
      if(opacity<=0){
        clearInterval(pulseInterval);
        if(tpJumpPulse){tpMap.removeLayer(tpJumpPulse);tpJumpPulse=null;}
      } else if(tpJumpPulse){
        tpJumpPulse.setStyle({fillOpacity:opacity,opacity:Math.min(1,opacity*2)});
      }
    },60);

    // Fit bounds ke rute lengkap
    tpMap.fitBounds(tpJumpLine.getBounds(),{padding:[50,50],maxZoom:14,animate:true});

    // Popup di marker target
    const tpM=tpMarkers[t.id];
    if(tpM){
      const ji={pabrik:'🏭',perusahaan:'🏢',kawasan:'🏗️'};
      const jarakLabel=r.viaRoad
        ? `<b>${r.km.toFixed(1)} km via jalan</b> (${r.menit} mnt)`
        : `<b>${r.km.toFixed(1)} km</b> ${r.isEstimate ? '<span style="color:#B45309;font-size:9px;">(estimasi via jalan)</span>' : 'jarak udara'}`;
      tpM.unbindTooltip();
      tpM.bindPopup(`
        <div style="padding:4px 6px;min-width:200px;">
          <div style="font-size:13px;font-weight:700;color:#1C1C1A;margin-bottom:3px;">${ji[t.jenis]||'🏢'} ${escapeHtml(t.nama)}</div>
          <div style="font-size:11px;color:#666;margin-bottom:8px;">${fmt(t.karyawan)} karyawan</div>
          <div style="background:#FEF3C7;padding:7px 10px;border-radius:6px;font-size:12px;color:#92400E;margin-bottom:4px;">${jarakLabel}</div>
          <div style="font-size:10px;color:#666;">dari ${escapeHtml(proj.nama)}</div>
        </div>
      `,{closeButton:true,autoClose:false}).openPopup();
    }
  }
}

// Clear rute jalan saat pilih target lain atau tutup detail
function clearTpJumpRoute(){
  if(tpJumpLine && tpMap){tpMap.removeLayer(tpJumpLine);tpJumpLine=null;}
  if(tpJumpPulse && tpMap){tpMap.removeLayer(tpJumpPulse);tpJumpPulse=null;}
  // Tutup semua popup marker di peta
  if(tpMap) tpMap.closePopup();
  // Kembalikan tooltip marker yang sempat di-unbind
  if(tpMarkers){
    Object.values(tpMarkers).forEach(m=>{
      try{ if(m.getPopup()) m.closePopup(); }catch(e){}
    });
  }
}
function closeTpDetail(){document.getElementById('tp-detail').classList.remove('show');selectedTpId=null;renderTPList(tpFilter);clearTpJumpRoute();if(tpMap)tpMap.closePopup();}
function deleteTP(id){
  if(!confirm('Hapus target ini?'))return;
  tpTargets=tpTargets.filter(t=>t.id!==id);
  saveTpData();
  // [v12.1 FIX] Explicit soft delete di Sheets (pakai no-cors)
  if(USE_SHEETS){
    try{
      fetch(GAS_URL, {
        method:'POST',
        mode:'no-cors',
        headers:{'Content-Type':'text/plain'},
        body: gasPost({action:'deleteTargetPasar', id:id})
      }).catch(e=>console.warn('Gagal soft-delete TP:',e));
    }catch(e){}
  }
  closeTpDetail();renderTPList(tpFilter);renderTPMarkers();showToast('🗑️ Target dihapus');
}
function openTpModal(id){
  editingTpId=id;
  if(id===-1){
    document.getElementById('tp-modal-title').textContent='Tambah Target Pasar';
    ['tpf-nama','tpf-lat','tpf-lng','tpf-karyawan','tpf-pic','tpf-catatan'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('tpf-jenis').value='pabrik';
    document.getElementById('tpf-lastcontact').value='';
    document.getElementById('tpf-status').value='0';
  }else{
    const t=tpTargets.find(x=>x.id===id);if(!t)return;
    document.getElementById('tp-modal-title').textContent='Edit: '+t.nama;
    document.getElementById('tpf-nama').value=t.nama;
    document.getElementById('tpf-jenis').value=t.jenis;
    document.getElementById('tpf-lat').value=t.lat;
    document.getElementById('tpf-lng').value=t.lng;
    document.getElementById('tpf-karyawan').value=t.karyawan;
    document.getElementById('tpf-pic').value=t.pic||'';
    document.getElementById('tpf-lastcontact').value=t.lastcontact!=='-'?t.lastcontact:'';
    document.getElementById('tpf-status').value=t.status;
    document.getElementById('tpf-catatan').value=t.catatan||'';
  }
  document.getElementById('tp-modal').classList.add('open');
  // [v13 SMART-INPUT] Reset smart-input field & init/focus map
  const smi=document.getElementById('smi-tp-input');if(smi)smi.value='';
  const fb=document.getElementById('smi-tp-fb');if(fb){fb.className='smart-input-fb';fb.textContent='';}
  document.getElementById('tpf-lat').classList.remove('filled');
  document.getElementById('tpf-lng').classList.remove('filled');
  setTimeout(()=>{_initTpMiniMapOnce();_wireTpSmartInputOnce();
    // Kalau mode edit, arahkan pin ke lokasi existing
    if(id!==-1 && tpMiniMap){
      const t=tpTargets.find(x=>x.id===id);
      if(t && !isNaN(t.lat) && !isNaN(t.lng)){tpMiniMap.setPin(t.lat,t.lng);}
    } else if(tpMiniMap){
      tpMiniMap.clearPin();
      tpMiniMap.focus(-6.5578,107.8131,12);
    }
    if(tpMiniMap) tpMiniMap.invalidateSize();
  },100);
}

// [v13 SMART-INPUT] Init mini-map modal TP (lazy, sekali)
function _initTpMiniMapOnce(){
  const el=document.getElementById('tpmodal-minimap');
  if(!el || el._leaflet_id) return;
  tpMiniMap=createMiniMap('tpmodal-minimap',{
    center:[-6.5578,107.8131],zoom:12,
    onPick:(lat,lng)=>{
      const lEl=document.getElementById('tpf-lat'),gEl=document.getElementById('tpf-lng');
      lEl.value=lat.toFixed(7);lEl.classList.add('filled');
      gEl.value=lng.toFixed(7);gEl.classList.add('filled');
      const fb=document.getElementById('smi-tp-fb');
      if(fb){fb.className='smart-input-fb ok';fb.innerHTML=`✓ Dari klik peta: <b>${lat.toFixed(6)}, ${lng.toFixed(6)}</b>`;}
    },
    onMove:(lat,lng)=>{
      const lEl=document.getElementById('tpf-lat'),gEl=document.getElementById('tpf-lng');
      lEl.value=lat.toFixed(7);lEl.classList.add('filled');
      gEl.value=lng.toFixed(7);gEl.classList.add('filled');
    }
  });
  // Ref markers: tampilkan target pasar existing sebagai latar
  if(tpMiniMap && typeof tpTargets!=='undefined'){
    tpMiniMap.addReferences(tpTargets.map(t=>({lat:t.lat,lng:t.lng,label:t.nama,color:'#A855F7'})));
  }
}

let _smartInputWiredTp=false;
function _wireTpSmartInputOnce(){
  if(_smartInputWiredTp) return;
  _smartInputWiredTp=true;
  wireSmartInput({
    inputId:'smi-tp-input',btnId:'smi-tp-btn',fbId:'smi-tp-fb',
    helpBtnId:'smi-tp-helpbtn',helpBoxId:'smi-tp-help',
    latFieldId:'tpf-lat',lngFieldId:'tpf-lng',
    onPick:(lat,lng)=>{if(tpMiniMap)tpMiniMap.setPin(lat,lng);}
  });
}
function closeTpModal(){document.getElementById('tp-modal').classList.remove('open');}
function saveTpTarget(){
  const nama=document.getElementById('tpf-nama').value.trim();
  const lat=parseFloat(document.getElementById('tpf-lat').value);
  const lng=parseFloat(document.getElementById('tpf-lng').value);
  if(!nama||isNaN(lat)||isNaN(lng)){alert('Nama, Latitude, dan Longitude wajib diisi!');return;}
  const data={nama,jenis:document.getElementById('tpf-jenis').value,lat,lng,karyawan:parseInt(document.getElementById('tpf-karyawan').value)||0,pic:document.getElementById('tpf-pic').value.trim(),lastcontact:document.getElementById('tpf-lastcontact').value||'-',status:parseInt(document.getElementById('tpf-status').value),catatan:document.getElementById('tpf-catatan').value.trim()};
  if(editingTpId===-1){const newId=tpTargets.length>0?Math.max(...tpTargets.map(t=>t.id))+1:1;tpTargets.push({id:newId,...data});}
  else{const idx=tpTargets.findIndex(x=>x.id===editingTpId);if(idx!==-1)tpTargets[idx]={...tpTargets[idx],...data};}
  saveTpData();closeTpModal();renderTPList(tpFilter);renderTPMarkers();
  if(editingTpId!==-1)selectTP(editingTpId);
  showToast('✅ Data tersimpan!');
}

// ============================================================
// CHART
// ============================================================
function buildChart(){
  const bars=document.getElementById('chart-bars');if(!bars)return;
  const sorted=[...perumahan].sort((a,b)=>(b.realisasi/b.unit)-(a.realisasi/a.unit));
  bars.innerHTML=sorted.map(p=>{const pc=p.unit>0?Math.min(100,Math.round(p.realisasi/p.unit*100)):0;const color=TIPE_COLOR[p.tipe]||'#65A30D';const nmEsc=escapeHtml(p.nama);return`<div class="bar-col"><div class="bar-bg"><div class="bar-pct">${pc}%</div><div class="bar-fill" style="height:${pc}%;background:${color};"></div></div><div class="bar-lbl" title="${nmEsc}">${escapeHtml(p.nama.split(' ').slice(0,2).join(' '))}</div></div>`;}).join('');
}
function toggleChart(){
  const panel=document.getElementById('chart-panel');const btn=document.getElementById('chart-fab');
  const open=!panel.classList.contains('open');panel.classList.toggle('open',open);btn.classList.toggle('active',open);
  if(open)buildChart();
}

// ============================================================
// EDITOR DATA
// ============================================================
const KAT_EMOJI_E={rs:'🏥',kampus:'🎓',mall:'🏬',tol:'🛣️',pemda:'🏛️',industri:'💼',publik:'🌳'};
const KAT_LBL_E={rs:'RS',kampus:'U',mall:'M',tol:'T',pemda:'G',industri:'I',publik:'P'};
// ============================================================
// [v12 EDITOR] Editor Data — State, Validation, Search, Sort, Dirty, Discard
// ============================================================

// Indonesia bounding box (sedikit longgar untuk buffer perbatasan)
const EDITOR_LAT_MIN = -11.5, EDITOR_LAT_MAX = 6.5;
const EDITOR_LNG_MIN = 94.5,  EDITOR_LNG_MAX = 141.5;

// State editor — semua yang tidak ada di data model
const editorState = {
  dirty: false,                 // ada perubahan belum tersinkron ke Sheets
  syncing: false,               // sedang sync
  snapshot: null,               // {perumahan, poi} terakhir yang tersinkron — untuk discard
  search: { perumahan:'', poi:'' },
  sort:   { perumahan:{key:null,dir:1}, poi:{key:null,dir:1} },
};

function _snapshotData(){
  // deep clone minimal: data record adalah plain object/array primitif
  return {
    perumahan: perumahan.map(p=>({...p})),
    poi: poi.map(x=>({...x})),
  };
}

function setEditorDirty(v){
  editorState.dirty = !!v;
  const badge=document.getElementById('editor-dirty-badge');
  const txt=document.getElementById('editor-dirty-text');
  const btnSync=document.getElementById('btn-sync-now');
  const btnDiscard=document.getElementById('btn-discard');
  if(!badge) return; // editor belum dirender
  if(v){
    badge.classList.remove('clean');
    txt.textContent='Belum tersinkron';
    if(btnSync) btnSync.disabled=false;
    if(btnDiscard) btnDiscard.disabled=false;
  } else {
    badge.classList.add('clean');
    txt.textContent='Tersinkron';
    if(btnSync) btnSync.disabled=true;
    if(btnDiscard) btnDiscard.disabled=true;
  }
}

function markDirtyAndPersist(){
  // Simpan ke localStorage (supaya aman kalau tab ditutup), TIDAK auto-sync ke Sheets
  try{localStorage.setItem('bm4_data',JSON.stringify({perumahan,poi}));}catch(e){}
  setEditorDirty(true);
}

// Validasi lat/lng: return {ok, msg}
function validateLat(v){
  const n=parseFloat(v);
  if(isNaN(n)) return {ok:false,msg:'Lat tidak valid'};
  if(n<EDITOR_LAT_MIN||n>EDITOR_LAT_MAX) return {ok:false,msg:`Lat di luar Indonesia (${EDITOR_LAT_MIN}..${EDITOR_LAT_MAX})`};
  return {ok:true,value:n};
}
function validateLng(v){
  const n=parseFloat(v);
  if(isNaN(n)) return {ok:false,msg:'Lng tidak valid'};
  if(n<EDITOR_LNG_MIN||n>EDITOR_LNG_MAX) return {ok:false,msg:`Lng di luar Indonesia (${EDITOR_LNG_MIN}..${EDITOR_LNG_MAX})`};
  return {ok:true,value:n};
}

// Handler inline edit untuk field lat/lng (dengan validasi visual)
function editCoordP(idx,field,inp){
  const res = field==='lat'?validateLat(inp.value):validateLng(inp.value);
  if(!res.ok){
    inp.classList.add('invalid');
    inp.title=res.msg;
    showToast('⚠ '+res.msg);
    return;
  }
  inp.classList.remove('invalid');
  inp.title='';
  perumahan[idx][field]=res.value;
  markDirtyAndPersist();
}
function editCoordPoi(idx,field,inp){
  const res = field==='lat'?validateLat(inp.value):validateLng(inp.value);
  if(!res.ok){
    inp.classList.add('invalid');
    inp.title=res.msg;
    showToast('⚠ '+res.msg);
    return;
  }
  inp.classList.remove('invalid');
  inp.title='';
  poi[idx][field]=res.value;
  markDirtyAndPersist();
}

// ============================================================
// [v13 SMART-INPUT] Helper parse link Google Maps / koordinat + Mini-map controller
// REUSABLE: dipakai di Editor (perumahan & POI) dan Modal Target Pasar
// ============================================================

/**
 * Parse input user (link Maps atau koordinat mentah) → {ok, lat, lng, src, shortlink?}
 * Format yang dikenali:
 *  1. "-6.5578, 107.8131" (klik kanan Google Maps → copy koordinat)
 *  2. "...@-6.5578,107.8131..." (link panjang Google Maps)
 *  3. "...?q=-6.5578,107.8131" atau "...&q=-6.5578,107.8131"
 *  4. "...!3d-6.5578!4d107.8131..." (data parameter Google Maps)
 *  5. Shortlink maps.app.goo.gl → ok:false, shortlink:true (user harus resolve dulu)
 */
function parseMapsInput(raw){
  if(!raw) return {ok:false,msg:'Kosong'};
  const s = String(raw).trim();

  // Deteksi shortlink dulu — tidak bisa di-parse JS karena CORS
  if(/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(s)){
    return {ok:false,shortlink:true,url:s,msg:'Shortlink tidak bisa otomatis — klik tombol "Buka Link" untuk resolve'};
  }

  // Pola 1: koordinat langsung "lat, lng"
  let m = s.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
  if(m) return _validateParsed(+m[1],+m[2],'koordinat langsung');

  // Pola 2: @lat,lng (format paling umum di URL Maps)
  m = s.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if(m) return _validateParsed(+m[1],+m[2],'link Maps (@)');

  // Pola 3: !3dlat!4dlng (data param)
  m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if(m) return _validateParsed(+m[1],+m[2],'link Maps (data)');

  // Pola 4: ?q=lat,lng atau &q=lat,lng atau &ll=lat,lng
  m = s.match(/[?&](?:q|ll|query)=(-?\d+\.?\d+),\s*(-?\d+\.?\d+)/);
  if(m) return _validateParsed(+m[1],+m[2],'link Maps (?q=)');

  // Gagal
  return {ok:false,msg:'Format tidak dikenal. Paste koordinat "lat, lng" atau link panjang Maps.'};
}

function _validateParsed(lat,lng,src){
  if(isNaN(lat)||isNaN(lng)) return {ok:false,msg:'Koordinat tidak valid'};
  if(lat<EDITOR_LAT_MIN||lat>EDITOR_LAT_MAX||lng<EDITOR_LNG_MIN||lng>EDITOR_LNG_MAX){
    return {ok:false,msg:`Koordinat di luar Indonesia (lat=${lat}, lng=${lng})`};
  }
  return {ok:true,lat,lng,src};
}

/**
 * SmartInput: wire up a smart-input block to a lat/lng field pair.
 * Parameter:
 *  - inputId: id input text smart-input
 *  - btnId: id tombol "Ambil"
 *  - fbId: id div feedback
 *  - helpBtnId, helpBoxId: tombol & box bantuan
 *  - latFieldId, lngFieldId: target form field
 *  - onPick: callback(lat, lng) — untuk update mini-map
 */
function wireSmartInput(cfg){
  const {inputId,btnId,fbId,helpBtnId,helpBoxId,latFieldId,lngFieldId,onPick}=cfg;
  const inp=document.getElementById(inputId);
  const btn=document.getElementById(btnId);
  const fb=document.getElementById(fbId);
  const helpBtn=document.getElementById(helpBtnId);
  const helpBox=document.getElementById(helpBoxId);
  if(!inp||!btn||!fb) return; // komponen tidak ada di DOM

  const handleParse=()=>{
    const val=inp.value.trim();
    if(!val){fb.className='smart-input-fb warn';fb.textContent='⚠ Kosong. Paste link atau koordinat dulu.';return;}
    const r=parseMapsInput(val);
    if(r.ok){
      fb.className='smart-input-fb ok';
      fb.innerHTML=`✓ Terbaca dari <b>${r.src}</b>: <b>${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}</b>`;
      // Isi field
      const lEl=document.getElementById(latFieldId),gEl=document.getElementById(lngFieldId);
      if(lEl){lEl.value=r.lat.toFixed(7);lEl.classList.add('filled');}
      if(gEl){gEl.value=r.lng.toFixed(7);gEl.classList.add('filled');}
      // Callback (untuk mini-map)
      if(typeof onPick==='function') onPick(r.lat,r.lng);
    } else if(r.shortlink){
      fb.className='smart-input-fb warn';
      fb.innerHTML=`⚠ Shortlink terdeteksi — tidak bisa otomatis.<br>Klik <b>"Buka Link"</b> di bawah, lalu copy URL lengkap (yang ada <code>@lat,lng</code>) dari tab yang terbuka, paste kembali ke sini.`;
      // Tambahkan tombol sementara buat buka link
      _ensureShortlinkOpener(fb,r.url);
    } else {
      fb.className='smart-input-fb err';
      fb.textContent='❌ '+r.msg;
    }
  };

  btn.onclick=handleParse;
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();handleParse();}});
  // Auto-parse saat paste (jeda pendek supaya value sudah ter-update)
  inp.addEventListener('paste',()=>setTimeout(handleParse,50));

  if(helpBtn && helpBox){
    helpBtn.onclick=()=>helpBox.classList.toggle('open');
  }
}

function _ensureShortlinkOpener(fb,url){
  // Cek apakah tombol sudah ada
  if(fb.querySelector('.shortlink-open')) return;
  const btn=document.createElement('a');
  btn.className='smart-input-btn alt shortlink-open';
  btn.href=url;
  btn.target='_blank';
  btn.rel='noopener noreferrer';
  btn.textContent='↗ Buka Link';
  btn.style.cssText='display:inline-block;margin-top:6px;text-decoration:none;padding:4px 10px;font-size:10px;';
  fb.appendChild(document.createElement('br'));
  fb.appendChild(btn);
}

/**
 * MiniMap controller: simple wrapper over Leaflet untuk 1 pin draggable.
 * Satu instance per lokasi (editor atau modal TP).
 */
function createMiniMap(containerId,opts={}){
  const el=document.getElementById(containerId);
  if(!el) return null;
  // Guard kalau sudah ada map di element itu (hindari double init)
  if(el._leaflet_id) return el._miniMapInstance || null;

  const center=opts.center||[-6.5578,107.8131]; // default Subang
  const zoom=opts.zoom||13;
  // [v17 fix] zoomControl opt-out supaya mini-map editor bisa non-aktifkan tombol +/-
  // (yang kadang "lepas" ke pojok kiri atas editor overlay saat container 0x0 di init).
  // User tetap bisa zoom pakai scroll wheel / pinch.
  const useZoomCtrl = opts.zoomControl !== false;
  const map=L.map(containerId,{zoomControl:useZoomCtrl,attributionControl:false}).setView(center,zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'© OSM'
  }).addTo(map);

  let pin=null;
  let refMarkers=[]; // marker referensi (kompetitor lain) — optional

  const api={
    map,
    setPin(lat,lng,{fit=true,label='📍 Lokasi baru'}={}){
      if(pin) map.removeLayer(pin);
      pin=L.marker([lat,lng],{draggable:true,title:label}).addTo(map);
      pin.bindTooltip('Drag untuk koreksi',{permanent:false,direction:'top'});
      pin.on('drag',e=>{
        const p=e.target.getLatLng();
        if(typeof opts.onMove==='function') opts.onMove(p.lat,p.lng);
      });
      if(fit) map.setView([lat,lng],16);
    },
    clearPin(){if(pin){map.removeLayer(pin);pin=null;}},
    addReferences(items,style={}){
      // items: [{lat,lng,label,color?}]
      refMarkers.forEach(m=>map.removeLayer(m));
      refMarkers=[];
      items.forEach(it=>{
        const color=it.color||style.color||'#6B7280';
        const icon=L.divIcon({
          html:`<div style="width:10px;height:10px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);opacity:0.75;"></div>`,
          iconSize:[10,10],iconAnchor:[5,5],className:''
        });
        const m=L.marker([it.lat,it.lng],{icon,zIndexOffset:-200}).addTo(map);
        if(it.label) m.bindTooltip(it.label,{direction:'top',offset:[0,-5]});
        refMarkers.push(m);
      });
    },
    focus(lat,lng,zoom=16){map.setView([lat,lng],zoom);},
    invalidateSize(){setTimeout(()=>map.invalidateSize(),50);},
    destroy(){map.remove();},
  };
  // Klik peta → set pin + callback
  map.on('click',e=>{
    const {lat,lng}=e.latlng;
    api.setPin(lat,lng,{fit:false});
    if(typeof opts.onPick==='function') opts.onPick(lat,lng);
  });
  el._miniMapInstance=api;
  return api;
}

// Instance holders (lazy init saat editor/modal dibuka pertama kali)
let editorMiniMap=null;   // mini-map dalam editor (dipakai perumahan & POI)
let tpMiniMap=null;       // mini-map dalam modal target pasar


function toggleEditor(){
  const ov=document.getElementById('editor-overlay');const btn=document.getElementById('btn-editor');
  const willOpen=!ov.classList.contains('open');
  if(!willOpen && editorState.dirty){
    if(!confirm('Ada perubahan yang belum tersinkron ke Sheets. Tutup editor? (Data tetap tersimpan lokal, tapi belum terkirim ke Sheets)')) return;
  }
  ov.classList.toggle('open',willOpen);
  btn.classList.toggle('active',willOpen);
  btn.textContent=willOpen?'✖ Tutup Editor':'✏️ Edit Data';
  if(willOpen){
    // Ambil snapshot saat membuka (kalau belum ada) untuk basis discard
    if(!editorState.snapshot) editorState.snapshot=_snapshotData();
    renderEPerumahan();renderEPoi();
    setEditorDirty(editorState.dirty); // refresh badge state
    // [v13 SMART-INPUT] Init mini-map & wire smart-input (lazy, sekali saja)
    setTimeout(()=>{_initEditorMiniMapOnce();_wireEditorSmartInputsOnce();},60);
  }
}

// [v13 SMART-INPUT] Init mini-map editor (perumahan + POI) — lazy, sekali
function _initEditorMiniMapOnce(){
  const elP=document.getElementById('editor-minimap');
  if(elP && !elP._leaflet_id){
    editorMiniMap=createMiniMap('editor-minimap',{
      center:[-6.5578,107.8131],zoom:13,zoomControl:false,
      onPick:(lat,lng)=>{
        const lEl=document.getElementById('enp-lat'),gEl=document.getElementById('enp-lng');
        if(lEl){lEl.value=lat.toFixed(7);lEl.classList.add('filled');}
        if(gEl){gEl.value=lng.toFixed(7);gEl.classList.add('filled');}
        const fb=document.getElementById('smi-p-fb');
        if(fb){fb.className='smart-input-fb ok';fb.innerHTML=`✓ Dari klik peta: <b>${lat.toFixed(6)}, ${lng.toFixed(6)}</b>`;}
      },
      onMove:(lat,lng)=>{
        const lEl=document.getElementById('enp-lat'),gEl=document.getElementById('enp-lng');
        if(lEl){lEl.value=lat.toFixed(7);lEl.classList.add('filled');}
        if(gEl){gEl.value=lng.toFixed(7);gEl.classList.add('filled');}
      }
    });
    if(editorMiniMap){
      editorMiniMap.addReferences(perumahan.map(p=>({lat:p.lat,lng:p.lng,label:p.nama,color:(typeof TIPE_COLOR!=='undefined'?TIPE_COLOR[p.tipe]:null)||'#9CA3AF'})));
      // [v17 fix] Paksa invalidateSize multi-pass supaya Leaflet recompute posisi control.
      // Kalau tidak, tombol +/- bisa "lepas" ke pojok kiri atas editor overlay karena
      // container sempat 0×0 saat init.
      setTimeout(()=>{ try{ editorMiniMap.map.invalidateSize(true); }catch(_){} }, 20);
      setTimeout(()=>{ try{ editorMiniMap.map.invalidateSize(true); }catch(_){} }, 200);
    }
  }
  const elPoi=document.getElementById('editor-minimap-poi');
  if(elPoi && !elPoi._leaflet_id){
    const poiMap=createMiniMap('editor-minimap-poi',{
      center:[-6.5578,107.8131],zoom:13,zoomControl:false,
      onPick:(lat,lng)=>{
        const lEl=document.getElementById('epoi-lat'),gEl=document.getElementById('epoi-lng');
        if(lEl){lEl.value=lat.toFixed(7);lEl.classList.add('filled');}
        if(gEl){gEl.value=lng.toFixed(7);gEl.classList.add('filled');}
        const fb=document.getElementById('smi-poi-fb');
        if(fb){fb.className='smart-input-fb ok';fb.innerHTML=`✓ Dari klik peta: <b>${lat.toFixed(6)}, ${lng.toFixed(6)}</b>`;}
      },
      onMove:(lat,lng)=>{
        const lEl=document.getElementById('epoi-lat'),gEl=document.getElementById('epoi-lng');
        if(lEl){lEl.value=lat.toFixed(7);lEl.classList.add('filled');}
        if(gEl){gEl.value=lng.toFixed(7);gEl.classList.add('filled');}
      }
    });
    if(poiMap){
      poiMap.addReferences(poi.map(x=>({lat:x.lat,lng:x.lng,label:x.nama,color:(typeof KAT_COLOR!=='undefined'?KAT_COLOR[x.kat]:null)||'#9CA3AF'})));
      elPoi._poiMiniMap=poiMap;
      // [v17 fix] Paksa invalidateSize multi-pass (sama seperti editorMiniMap)
      setTimeout(()=>{ try{ poiMap.map.invalidateSize(true); }catch(_){} }, 20);
      setTimeout(()=>{ try{ poiMap.map.invalidateSize(true); }catch(_){} }, 200);
    }
  }
}

let _smartInputWiredEditor=false;
function _wireEditorSmartInputsOnce(){
  if(_smartInputWiredEditor) return;
  _smartInputWiredEditor=true;
  wireSmartInput({
    inputId:'smi-p-input',btnId:'smi-p-btn',fbId:'smi-p-fb',
    helpBtnId:'smi-p-helpbtn',helpBoxId:'smi-p-help',
    latFieldId:'enp-lat',lngFieldId:'enp-lng',
    onPick:(lat,lng)=>{if(editorMiniMap)editorMiniMap.setPin(lat,lng);}
  });
  wireSmartInput({
    inputId:'smi-poi-input',btnId:'smi-poi-btn',fbId:'smi-poi-fb',
    helpBtnId:'smi-poi-helpbtn',helpBoxId:'smi-poi-help',
    latFieldId:'epoi-lat',lngFieldId:'epoi-lng',
    onPick:(lat,lng)=>{
      const el=document.getElementById('editor-minimap-poi');
      if(el && el._poiMiniMap) el._poiMiniMap.setPin(lat,lng);
    }
  });
}
function switchEtab(name,el){
  document.getElementById('etab-perumahan').style.display=name==='perumahan'?'':'none';
  document.getElementById('etab-poi').style.display=name==='poi'?'':'none';
  const taperaEl=document.getElementById('etab-tapera');
  if(taperaEl) taperaEl.style.display=name==='tapera'?'':'none';
  const skbEl=document.getElementById('etab-sikumbang');
  if(skbEl) skbEl.style.display=name==='sikumbang'?'':'none';
  document.querySelectorAll('.editor-tabs .etab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  // [v13 SMART-INPUT] Leaflet butuh invalidateSize kalau container sebelumnya display:none
  setTimeout(()=>{
    if(name==='perumahan' && editorMiniMap) editorMiniMap.invalidateSize();
    if(name==='poi'){
      const e=document.getElementById('editor-minimap-poi');
      if(e && e._poiMiniMap) e._poiMiniMap.invalidateSize();
    }
    if(name==='tapera') initTaperaEditor();
    if(name==='sikumbang' && typeof initSikumbangEditor === 'function') initSikumbangEditor();
  },50);
}

// ============================================================
// [P0 TAPERA] Editor form untuk data Tapera per perumahan
// ============================================================
function initTaperaEditor(){
  const sel = document.getElementById('tpr-select');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = perumahan.map(p => {
    const has = p.tapera ? '✓' : '—';
    return `<option value="${p.id}">${has} ${escapeHtml(p.nama)}</option>`;
  }).join('');
  if(current && perumahan.some(p => String(p.id) === String(current))) sel.value = current;
  loadTaperaForm(sel.value);
  loadMarketCtxForm();
  // Update counter badge di tab editor
  const cnt = document.getElementById('ecnt-tapera');
  if(cnt){
    const n = perumahan.filter(p => p.tapera).length;
    cnt.textContent = n ? `(${n})` : '';
  }
  // [v2 TPR] Restore mode terakhir (card/wizard) dari localStorage
  try {
    const savedMode = localStorage.getItem('bm4_tpr2_mode') || 'card';
    if(savedMode === 'wizard') tpr2SwitchMode('wizard');
    else tpr2SwitchMode('card');
  } catch(_){ tpr2SwitchMode('card'); }
}


// Render form input untuk custom fields per section (dipanggil di loadTaperaForm)
function renderTaperaCustomFields(p){
  // [v3] Render custom fields per section ke kontainer #tpr-section-fields-{secid}
  // Backward compat: kontainer #tpr-custom-fields-container masih ada (display:none) untuk
  // function lama yang mungkin masih reference, tapi tidak digunakan untuk display.
  const sections = ['place','product','price','promotion','performance','gtm'];
  const custData = (p && p.customFields) || {};

  sections.forEach(secId => {
    const host = document.getElementById(`tpr-section-fields-${secId}`);
    if(!host) return;
    const fields = (FM_STATE.customFields[secId] || []).filter(f => !_isFieldHidden(f.id));
    if(!fields.length){ host.innerHTML = ''; return; }
    const rowsHtml = fields.map(f => {
      const currentVal = custData[f.id];
      const inputId = `tpr-custom-${f.id}`;
      let inputHtml = '';
      switch(f.type){
        case 'number':
        case 'number_km':
        case 'percent': {
          const v = currentVal != null ? escapeHtml(String(currentVal)) : '';
          inputHtml = `<input type="number" step="any" id="${inputId}" value="${v}" data-cf-id="${f.id}" data-cf-type="${f.type}" placeholder="Angka">`;
          break;
        }
        case 'yesno': {
          const yesChecked = currentVal === true ? 'checked' : '';
          const noChecked = currentVal === false ? 'checked' : '';
          const emptyChecked = (currentVal == null) ? 'checked' : '';
          inputHtml = `<div style="display:flex;gap:10px;padding-top:4px;">
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:400;cursor:pointer;"><input type="radio" name="${inputId}" value="" ${emptyChecked} data-cf-id="${f.id}" data-cf-type="yesno">—</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:400;cursor:pointer;"><input type="radio" name="${inputId}" value="yes" ${yesChecked} data-cf-id="${f.id}" data-cf-type="yesno">Ya</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:400;cursor:pointer;"><input type="radio" name="${inputId}" value="no" ${noChecked} data-cf-id="${f.id}" data-cf-type="yesno">Tidak</label>
          </div>`;
          break;
        }
        case 'dropdown': {
          const opts = (f.options||[]).map(o => `<option value="${escapeHtml(o)}" ${currentVal===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
          inputHtml = `<select id="${inputId}" data-cf-id="${f.id}" data-cf-type="dropdown"><option value="">— Pilih —</option>${opts}</select>`;
          break;
        }
        case 'multi': {
          const arr = Array.isArray(currentVal) ? currentVal : [];
          const checks = (f.options||[]).map(o => {
            const isChecked = arr.includes(o) ? 'checked' : '';
            return `<label style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:400;cursor:pointer;margin-right:8px;"><input type="checkbox" value="${escapeHtml(o)}" ${isChecked} data-cf-id="${f.id}" data-cf-type="multi" data-cf-multi="1">${escapeHtml(o)}</label>`;
          }).join('');
          inputHtml = `<div style="padding:4px 0;">${checks}</div>`;
          break;
        }
        case 'date': {
          const v = currentVal ? escapeHtml(String(currentVal)) : '';
          inputHtml = `<input type="date" id="${inputId}" value="${v}" data-cf-id="${f.id}" data-cf-type="date">`;
          break;
        }
        case 'list':
        case 'text':
        default: {
          const v = currentVal != null ? escapeHtml(String(currentVal)) : '';
          inputHtml = `<input type="text" id="${inputId}" value="${v}" data-cf-id="${f.id}" data-cf-type="${f.type}" placeholder="${escapeHtml(f.desc||'')}">`;
        }
      }
      return `<div class="ef" style="margin-bottom:8px;">
        <label>${f.label} ${f.inScore?'<span style="font-size:9px;color:#059669;margin-left:3px;">✓ ke skor</span>':''}</label>
        ${inputHtml}
      </div>`;
    }).join('');
    host.innerHTML = `<div class="tpr2-custom-divider">
        <span class="tpr2-custom-label">+ Custom field (dari Field Manager)</span>
      </div>
      <div class="tpr2-grid-2">${rowsHtml}</div>`;
  });
}

// Baca value dari form custom fields
function _readTaperaCustomFields(){
  const result = {};
  const container = document.getElementById('tpr-custom-fields-container');
  if(!container) return result;
  // Text/number/dropdown/date inputs
  container.querySelectorAll('input[data-cf-id], select[data-cf-id]').forEach(el => {
    const id = el.dataset.cfId;
    const type = el.dataset.cfType;
    if(type === 'multi'){
      // handled below
      return;
    }
    if(type === 'yesno'){
      if(el.checked){
        const v = el.value;
        if(v === 'yes') result[id] = true;
        else if(v === 'no') result[id] = false;
        // else: kosong — skip (jangan set)
      }
      return;
    }
    if(type === 'number' || type === 'number_km' || type === 'percent'){
      const raw = el.value.trim();
      if(raw === '') return;
      const n = parseFloat(raw);
      if(!isNaN(n)) result[id] = n;
      return;
    }
    const raw = (el.value||'').trim();
    if(raw !== '') result[id] = raw;
  });
  // Multi checkboxes — group by data-cf-id
  const multiIds = new Set();
  container.querySelectorAll('input[data-cf-multi="1"]').forEach(el => multiIds.add(el.dataset.cfId));
  multiIds.forEach(id => {
    const checked = container.querySelectorAll(`input[data-cf-multi="1"][data-cf-id="${id}"]:checked`);
    const vals = Array.from(checked).map(el => el.value);
    if(vals.length) result[id] = vals;
  });
  return result;
}

function loadTaperaForm(id){
  const p = perumahan.find(x => String(x.id) === String(id));
  const formEl = document.getElementById('tpr-form');
  const statusEl = document.getElementById('tpr-status');
  if(!p){ if(formEl) formEl.style.display = 'none'; return; }
  if(formEl) formEl.style.display = 'block';
  const t = p.tapera || {};
  // [TPR-IDENTITAS] Auto-fill nama perumahan dari profil + tahun realisasi + kab/kota
  const setVal0 = (id, v) => { const el = document.getElementById(id); if(el) el.value = v == null ? '' : v; };
  setVal0('tpr-nama-perumahan', p.nama || '');
  setVal0('tpr-tahun-realisasi', t.tahunRealisasi || '');
  setVal0('tpr-kab-kota', t.kabKota || '');
  document.getElementById('tpr-total').value = t.totalRealisasi || '';
  document.getElementById('tpr-nominal').value = t.nominalFLPP || '';
  const bulananStr = (t.realisasiBulanan || []).map(b => `${b.bulan}:${b.unit}`).join(', ');
  document.getElementById('tpr-bulanan').value = bulananStr;
  document.getElementById('tpr-harga').value = t.hargaRange || '';
  document.getElementById('tpr-lt').value = t.luasTanah || '';
  document.getElementById('tpr-lb').value = t.luasBangunan || '';
  document.getElementById('tpr-tenor').value = t.tenorDominan || '';
  document.getElementById('tpr-um').value = t.uangMukaRange || '';
  document.getElementById('tpr-bank').value = t.bankDominan || '';
  const profil = t.profilPembeli || {};
  document.getElementById('tpr-pekerjaan').value = _profilToStr(profil.pekerjaan);
  document.getElementById('tpr-usia').value = _profilToStr(profil.usia);
  document.getElementById('tpr-penghasilan').value = _profilToStr(profil.penghasilan);
  document.getElementById('tpr-gender').value = _profilToStr(profil.gender);
  // [TAHAP1] Promotion
  const promo = t.promotion || {};
  const setVal = (id, v) => { const el = document.getElementById(id); if(el) el.value = v == null ? '' : v; };
  setVal('tpr-promo-aktif', promo.promoAktif);
  setVal('tpr-promo-periode', promo.periode);
  setVal('tpr-promo-bonus', promo.bonus);
  setVal('tpr-promo-iklan', promo.iklanPlatform);
  setVal('tpr-promo-bb', promo.billboard);
  // [TAHAP1] Go-to-Market
  const gtm = t.gtm || {};
  setVal('tpr-gtm-mkt', gtm.marketingInhouse);
  setVal('tpr-gtm-kanal', gtm.strukturKanal);
  setVal('tpr-gtm-agent', gtm.jumlahAgent);
  setVal('tpr-gtm-fee-mkt', gtm.feeMarketing);
  setVal('tpr-gtm-fee-agt', gtm.feeAgent);
  setVal('tpr-gtm-dev', gtm.brandDeveloper);
  // [TAHAP4B-2] Custom fields
  try { renderTaperaCustomFields(p); } catch(e){ console.warn('custom fields render err', e); }
  // Status badge
  if(statusEl){
    if(t._dummy) statusEl.textContent = '🧪 Dummy data';
    else if(t.lastSynced) statusEl.textContent = `✓ Update ${t.lastSynced}`;
    else if(p.tapera) statusEl.textContent = '✓ Ada data';
    else statusEl.textContent = 'Belum ada data';
  }
  // [v2 TPR] Re-render UI baru (card summaries + wizard live preview)
  try { tpr2RefreshAll(); } catch(e){ console.warn('tpr2 refresh err', e); }
}

function saveTaperaForm(){
  const id = document.getElementById('tpr-select').value;
  const p = perumahan.find(x => String(x.id) === String(id));
  if(!p){ showToast('⚠ Perumahan tidak ditemukan'); return; }
  // [v2 TPR] Sebelum save, sync dari mode aktif ke field hidden ID-lama
  // (kalau user terakhir edit di mode card visual, pastikan textarea bulanan
  //  & input pekerjaan/usia/penghasilan/gender ter-update dulu)
  try { tpr2FlushVisualToRaw(); } catch(_){}

  const total = parseInt(document.getElementById('tpr-total').value) || 0;
  const nominal = parseFloat(document.getElementById('tpr-nominal').value) || 0;
  const bulanan = _parseBulanan(document.getElementById('tpr-bulanan').value);
  const profil = {};
  const pek = _parseProfil(document.getElementById('tpr-pekerjaan').value); if(pek) profil.pekerjaan = pek;
  const usia = _parseProfil(document.getElementById('tpr-usia').value); if(usia) profil.usia = usia;
  const pen = _parseProfil(document.getElementById('tpr-penghasilan').value); if(pen) profil.penghasilan = pen;
  const gen = _parseProfil(document.getElementById('tpr-gender').value); if(gen) profil.gender = gen;
  p.tapera = {
    lastSynced: new Date().toISOString().slice(0,10),
    tahunRealisasi: (function(){ const v = parseInt(document.getElementById('tpr-tahun-realisasi')?.value); return isNaN(v) ? null : v; })(),
    kabKota: (document.getElementById('tpr-kab-kota')?.value || '').trim().toUpperCase(),
    totalRealisasi: total,
    nominalFLPP: nominal,
    realisasiBulanan: bulanan,
    hargaRange: document.getElementById('tpr-harga').value.trim(),
    luasTanah: document.getElementById('tpr-lt').value.trim(),
    luasBangunan: document.getElementById('tpr-lb').value.trim(),
    tenorDominan: document.getElementById('tpr-tenor').value.trim(),
    uangMukaRange: document.getElementById('tpr-um').value.trim(),
    bankDominan: document.getElementById('tpr-bank').value.trim(),
    profilPembeli: profil,
    promotion: {
      promoAktif: document.getElementById('tpr-promo-aktif')?.value.trim() || '',
      periode: document.getElementById('tpr-promo-periode')?.value.trim() || '',
      bonus: document.getElementById('tpr-promo-bonus')?.value.trim() || '',
      iklanPlatform: document.getElementById('tpr-promo-iklan')?.value.trim() || '',
      billboard: document.getElementById('tpr-promo-bb')?.value.trim() || ''
    },
    gtm: {
      marketingInhouse: (function(){ const v = parseInt(document.getElementById('tpr-gtm-mkt')?.value); return isNaN(v) ? null : v; })(),
      strukturKanal: document.getElementById('tpr-gtm-kanal')?.value.trim() || '',
      jumlahAgent: (function(){ const v = parseInt(document.getElementById('tpr-gtm-agent')?.value); return isNaN(v) ? null : v; })(),
      feeMarketing: document.getElementById('tpr-gtm-fee-mkt')?.value.trim() || '',
      feeAgent: document.getElementById('tpr-gtm-fee-agt')?.value.trim() || '',
      brandDeveloper: document.getElementById('tpr-gtm-dev')?.value.trim() || ''
    }
  };
  // Custom fields
  try {
    const cust = _readTaperaCustomFields();
    if(Object.keys(cust).length){
      p.customFields = cust;
    } else {
      delete p.customFields;
    }
  } catch(e){ console.warn('custom save err', e); }
  try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(_){}
  if(typeof setEditorDirty === 'function') try { setEditorDirty(true); } catch(_){}
  initTaperaEditor();
  showToast(`✓ Data Tapera "${p.nama}" disimpan`);
  if(typeof selectedId !== 'undefined' && selectedId === p.id && typeof renderDetailOverview === 'function'){
    try { renderDetailOverview(p); } catch(_){}
  }
}

function _profilToStr(obj){
  if(!obj) return '';
  return Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(', ');
}

function _parseProfil(s){
  if(!s || !s.trim()) return null;
  const out = {};
  s.split(',').forEach(pair => {
    const [k, v] = pair.split(':').map(x => x.trim());
    if(k && v !== undefined && !isNaN(parseFloat(v))) out[k] = parseFloat(v);
  });
  return Object.keys(out).length ? out : null;
}

function _parseBulanan(s){
  if(!s || !s.trim()) return [];
  const out = [];
  s.split(',').forEach(pair => {
    const [bulan, unit] = pair.split(':').map(x => x.trim());
    if(bulan && /^\d{4}-\d{2}$/.test(bulan) && unit !== undefined && !isNaN(parseInt(unit))){
      out.push({ bulan, unit: parseInt(unit) });
    }
  });
  return out.sort((a, b) => a.bulan.localeCompare(b.bulan));
}
function clearTaperaData(){
  const id=document.getElementById('tpr-select').value;
  const p=perumahan.find(x=>String(x.id)===String(id));
  if(!p || !p.tapera) return;
  if(!confirm(`Hapus data Tapera untuk "${p.nama}"?`)) return;
  delete p.tapera;
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  initTaperaEditor();
  showToast('🗑 Data Tapera dihapus');
}
function loadMarketCtxForm(){
  const m=MARKET_CONTEXT||{};
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=v==null?'':v; };
  set('mctx-kab', m.kabupaten);
  set('mctx-totperum', m.totalPerumahanTerdaftar);
  set('mctx-totunit', m.totalUnit);
  set('mctx-terjual', m.totalTerjual);
  set('mctx-kavling', m.totalKavling);
  set('mctx-ready', m.totalReadyStock);
  set('mctx-subsidi', m.pctSubsidi);
  set('mctx-komersil', m.pctKomersil);
}
function saveMarketCtxForm(){
  const getN=(id)=>{ const v=parseFloat(document.getElementById(id)?.value); return isNaN(v)?0:v; };
  MARKET_CONTEXT={
    ...MARKET_CONTEXT,
    kabupaten: document.getElementById('mctx-kab').value.trim()||'—',
    totalPerumahanTerdaftar: getN('mctx-totperum'),
    totalUnit: getN('mctx-totunit'),
    totalTerjual: getN('mctx-terjual'),
    totalKavling: getN('mctx-kavling'),
    totalReadyStock: getN('mctx-ready'),
    pctSubsidi: getN('mctx-subsidi'),
    pctKomersil: getN('mctx-komersil'),
    lastSynced: new Date().toISOString().slice(0,10)
  };
  saveMarketContext();
  showToast('✓ Market Context disimpan');
}


// ── Search ────────────────────────────────────────────────
function onSearchPerumahan(v){
  editorState.search.perumahan=v.trim().toLowerCase();
  document.getElementById('clear-search-p').classList.toggle('show',!!v);
  renderEPerumahan();
}
function clearSearchPerumahan(){
  document.getElementById('search-perumahan').value='';
  onSearchPerumahan('');
}
function onSearchPoi(v){
  editorState.search.poi=v.trim().toLowerCase();
  document.getElementById('clear-search-poi').classList.toggle('show',!!v);
  renderEPoi();
}
function clearSearchPoi(){
  document.getElementById('search-poi').value='';
  onSearchPoi('');
}

// ── Sort ───────────────────────────────────────────────────
function sortPerumahan(key){
  const s=editorState.sort.perumahan;
  if(s.key===key) s.dir=-s.dir; else {s.key=key;s.dir=1;}
  renderEPerumahan();
}
function sortPoi(key){
  const s=editorState.sort.poi;
  if(s.key===key) s.dir=-s.dir; else {s.key=key;s.dir=1;}
  renderEPoi();
}
function _applySort(arr,sort){
  if(!sort.key) return arr;
  const k=sort.key, d=sort.dir;
  return [...arr].sort((a,b)=>{
    const av=a[k], bv=b[k];
    if(av==null && bv==null) return 0;
    if(av==null) return 1;
    if(bv==null) return -1;
    if(typeof av==='number' && typeof bv==='number') return (av-bv)*d;
    return String(av).localeCompare(String(bv),'id',{numeric:true})*d;
  });
}
function _updateSortIndicators(tbodyId,sort){
  const tbody=document.getElementById(tbodyId);
  if(!tbody) return;
  const table=tbody.closest('table');
  if(!table) return;
  table.querySelectorAll('th.sortable').forEach(th=>{
    th.classList.remove('sort-asc','sort-desc');
    if(th.dataset.sort===sort.key){
      th.classList.add(sort.dir>0?'sort-asc':'sort-desc');
    }
  });
}

// ── Render ─────────────────────────────────────────────────
function renderEPerumahan(){
  document.getElementById('ecnt-p').textContent='('+perumahan.length+')';
  const q=editorState.search.perumahan;
  // attach original index supaya handler onchange tetap mereferensi item yang benar
  let rows=perumahan.map((p,origIdx)=>({p,origIdx}));
  if(q){
    rows=rows.filter(({p})=>{
      return (p.nama||'').toLowerCase().includes(q)
          || (p.area||'').toLowerCase().includes(q)
          || (p.developer||'').toLowerCase().includes(q);
    });
  }
  rows=_applySort(rows.map(r=>({...r.p,_i:r.origIdx})),editorState.sort.perumahan).map(r=>({p:r,origIdx:r._i}));

  const info=document.getElementById('filter-info-p');
  if(q) info.textContent=`${rows.length} / ${perumahan.length} hasil`;
  else info.textContent=`${perumahan.length} perumahan`;

  const tb=document.getElementById('etbody-p');
  if(rows.length===0){
    tb.innerHTML=`<tr><td colspan="11" class="empty-state">${q?'Tidak ada hasil untuk "'+escapeHtml(q)+'". ':'Belum ada data. '}Tambah perumahan lewat form di bawah.</td></tr>`;
  } else {
    tb.innerHTML=rows.map(({p,origIdx})=>{
      const i=origIdx;
      const displayNum = origIdx+1; // posisi asli di data array
      const isAnchor = p.id===ANCHOR_ID;
      return `<tr><td style="color:var(--faint);font-size:10px;font-family:'DM Mono',monospace;">${displayNum}${isAnchor?'⭐':''}</td>
      <td><input type="text" value="${escapeHtml(p.nama)}" onchange="perumahan[${i}].nama=this.value;markDirtyAndPersist()" style="min-width:140px;"></td>
      <td><input type="text" value="${escapeHtml(p.area)}" onchange="perumahan[${i}].area=this.value;markDirtyAndPersist()" style="min-width:80px;"></td>
      <td><select onchange="perumahan[${i}].tipe=this.value;markDirtyAndPersist()"><option value="subsidi" ${p.tipe==='subsidi'?'selected':''}>Subsidi</option><option value="mix" ${p.tipe==='mix'?'selected':''}>Mix</option></select></td>
      <td><input type="number" value="${p.lat}" onchange="editCoordP(${i},'lat',this)" step="0.0000001" style="min-width:95px;font-family:'DM Mono',monospace;font-size:11px;"></td>
      <td><input type="number" value="${p.lng}" onchange="editCoordP(${i},'lng',this)" step="0.0000001" style="min-width:95px;font-family:'DM Mono',monospace;font-size:11px;"></td>
      <td><input type="text" value="${escapeHtml(p.developer||'')}" onchange="perumahan[${i}].developer=this.value;markDirtyAndPersist()" style="min-width:120px;"></td>
      <td><input type="number" value="${p.unit}" onchange="perumahan[${i}].unit=parseInt(this.value)||0;markDirtyAndPersist()" style="min-width:50px;"></td>
      <td><input type="number" value="${p.realisasi}" onchange="perumahan[${i}].realisasi=parseInt(this.value)||0;markDirtyAndPersist()" style="min-width:60px;"></td>
      <td><input type="number" value="${p.tahun}" onchange="perumahan[${i}].tahun=parseInt(this.value)||2024;markDirtyAndPersist()" style="min-width:58px;"></td>
      <td><button class="btn-sm-danger" onclick="delEP(${i})">Hapus</button></td></tr>`;
    }).join('');
  }
  _updateSortIndicators('etbody-p',editorState.sort.perumahan);
}

function renderEPoi(){
  document.getElementById('ecnt-poi').textContent='('+poi.length+')';
  const q=editorState.search.poi;
  let rows=poi.map((x,origIdx)=>({x,origIdx}));
  if(q){
    rows=rows.filter(({x})=>{
      return (x.nama||'').toLowerCase().includes(q)
          || (x.kat||'').toLowerCase().includes(q)
          || (KAT_LABEL[x.kat]||'').toLowerCase().includes(q);
    });
  }
  rows=_applySort(rows.map(r=>({...r.x,_i:r.origIdx})),editorState.sort.poi).map(r=>({x:r,origIdx:r._i}));

  const info=document.getElementById('filter-info-poi');
  if(q) info.textContent=`${rows.length} / ${poi.length} hasil`;
  else info.textContent=`${poi.length} POI`;

  const tb=document.getElementById('etbody-poi');
  if(rows.length===0){
    tb.innerHTML=`<tr><td colspan="6" class="empty-state">${q?'Tidak ada hasil untuk "'+escapeHtml(q)+'". ':'Belum ada POI. '}Tambah POI lewat form di bawah.</td></tr>`;
  } else {
    tb.innerHTML=rows.map(({x,origIdx})=>{
      const i=origIdx;
      const displayNum=origIdx+1;
      return `<tr><td style="color:var(--faint);font-size:10px;font-family:'DM Mono',monospace;">${displayNum}</td>
      <td><input type="text" value="${escapeHtml(x.nama)}" onchange="poi[${i}].nama=this.value;markDirtyAndPersist()" style="min-width:180px;"></td>
      <td><select onchange="poi[${i}].kat=this.value;poi[${i}].label=KAT_LBL_E[this.value];poi[${i}].emoji=KAT_EMOJI_E[this.value];markDirtyAndPersist();">${Object.entries(KAT_LABEL).map(([k,v])=>`<option value="${k}" ${x.kat===k?'selected':''}>${v}</option>`).join('')}</select></td>
      <td><input type="number" value="${x.lat}" onchange="editCoordPoi(${i},'lat',this)" step="0.0000001" style="min-width:95px;font-family:'DM Mono',monospace;font-size:11px;"></td>
      <td><input type="number" value="${x.lng}" onchange="editCoordPoi(${i},'lng',this)" step="0.0000001" style="min-width:95px;font-family:'DM Mono',monospace;font-size:11px;"></td>
      <td><button class="btn-sm-danger" onclick="delEPoi(${i})">Hapus</button></td></tr>`;
    }).join('');
  }
  _updateSortIndicators('etbody-poi',editorState.sort.poi);
}

// ── Sync eksplisit ─────────────────────────────────────────
async function syncEditorNow(){
  if(editorState.syncing) return;
  if(!editorState.dirty){showToast('✓ Sudah tersinkron');return;}
  editorState.syncing=true;
  const btn=document.getElementById('btn-sync-now');
  const statusEl=document.getElementById('editor-sync-status');
  if(btn){btn.disabled=true;btn.textContent='⏳ Syncing...';}
  if(statusEl){statusEl.className='sync-status';statusEl.textContent='Mengirim...';}

  // [v12.3 OPTIMISTIC UI] Asumsi sync sukses — update UI duluan, sync di background
  // Ini bikin user nggak perlu nunggu 5-15 detik fetch ke Apps Script
  // Simpan lokal (redundan tapi aman, kalau tab ditutup data tetap ada)
  try{localStorage.setItem('bm4_data',JSON.stringify({perumahan,poi}));}catch(e){}

  // Hitung yang dihapus (snapshot vs now)
  const snapshot = editorState.snapshot || {perumahan:[],poi:[]};
  const snapIdsP = new Set((snapshot.perumahan||[]).map(p=>String(p.id)));
  const snapNamesPoi = new Set((snapshot.poi||[]).map(p=>String(p.nama)));
  const nowIdsP = new Set(perumahan.map(p=>String(p.id)));
  const nowNamesPoi = new Set(poi.map(p=>String(p.nama)));
  const deletedP = [...snapIdsP].filter(id=>!nowIdsP.has(id));
  const deletedPoi = [...snapNamesPoi].filter(n=>!nowNamesPoi.has(n));
  const totalDel = deletedP.length + deletedPoi.length;

  // [OPTIMISTIC] Update UI segera — anggap sukses
  editorState.snapshot=_snapshotData();
  setEditorDirty(false);
  const delInfo=totalDel?` (−${totalDel} dihapus)`:'';
  if(statusEl){statusEl.className='sync-status ok';statusEl.textContent=`✓ Sync ${new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}`;}
  setSyncStatus('synced',`Tersinkron: ${perumahan.length} perumahan, ${poi.length} POI${delInfo}`);
  showToast(`✅ Tersinkron (${perumahan.length} perumahan, ${poi.length} POI${delInfo})`);
  if(btn){btn.textContent='💾 Sync ke Sheets';btn.disabled=true;}
  editorState.syncing=false;

  // [PARALLEL BACKGROUND] Kirim request ke Sheets paralel — user nggak perlu nunggu
  // Kalau gagal, kasih notifikasi (jarang terjadi)
  const requests = [
    fetch(GAS_URL, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: gasPost({action:'savePerumahan', rows:perumahan})
    }),
    fetch(GAS_URL, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: gasPost({action:'savePoi', rows:poi})
    })
  ];
  // Tambahkan delete requests (parallel juga)
  for(const id of deletedP){
    requests.push(fetch(GAS_URL, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: gasPost({action:'deletePerumahan', id:id})
    }));
  }
  for(const nama of deletedPoi){
    requests.push(fetch(GAS_URL, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: gasPost({action:'deletePoi', nama:nama})
    }));
  }

  // Track all parallel — kalau ada yang gagal, beri notifikasi
  Promise.allSettled(requests).then(results => {
    const failed = results.filter(r=>r.status==='rejected').length;
    if(failed > 0){
      console.warn('[syncEditorNow] '+failed+' background requests gagal:', results);
      setSyncStatus('offline', `${failed} request gagal, klik sync lagi`);
      showToast(`⚠️ ${failed} sync gagal — klik Sync ke Sheets lagi`);
      // Re-mark dirty supaya user bisa retry
      setEditorDirty(true);
    } else {
      // All good — log activity
      try{if(typeof logActivity==='function' && currentUser) logActivity(currentUser.username,'editor_sync',`${perumahan.length}P+${poi.length}POI, del ${deletedP.length}P+${deletedPoi.length}POI`);}catch(e){}
    }
  });
}

// ── Discard (revert ke snapshot) ───────────────────────────
function discardEditorChanges(){
  if(!editorState.dirty) return;
  if(!editorState.snapshot){showToast('⚠ Tidak ada snapshot untuk direvert');return;}
  if(!confirm('Batalkan semua perubahan dan kembalikan ke state terakhir yang tersinkron?')) return;
  perumahan.length=0;editorState.snapshot.perumahan.forEach(p=>perumahan.push({...p}));
  poi.length=0;editorState.snapshot.poi.forEach(x=>poi.push({...x}));
  try{localStorage.setItem('bm4_data',JSON.stringify({perumahan,poi}));}catch(e){}
  setEditorDirty(false);
  renderEPerumahan();renderEPoi();
  showToast('↶ Perubahan dibatalkan');
}

// ── CRUD ───────────────────────────────────────────────────
function delEP(i){
  if(!confirm('Hapus "'+perumahan[i].nama+'"?'))return;
  perumahan.splice(i,1);
  perumahan.forEach((p,idx)=>p.id=idx+1);
  renderEPerumahan();markDirtyAndPersist();showToast('🗑️ Dihapus (belum tersinkron)');
}
function delEPoi(i){
  if(!confirm('Hapus "'+poi[i].nama+'"?'))return;
  poi.splice(i,1);
  renderEPoi();markDirtyAndPersist();showToast('🗑️ Dihapus (belum tersinkron)');
}

function _markFieldInvalid(id,msg){
  const el=document.getElementById(id);
  if(!el) return;
  el.classList.add('invalid');
  el.title=msg||'Tidak valid';
  setTimeout(()=>{el.classList.remove('invalid');el.title='';},2500);
}
function _clearAddFields(ids){ids.forEach(id=>{const el=document.getElementById(id);if(el){el.value='';el.classList.remove('invalid');}});}

function addEPerumahan(){
  const nama=document.getElementById('enp-nama').value.trim();
  const area=document.getElementById('enp-area').value.trim();
  const latRaw=document.getElementById('enp-lat').value;
  const lngRaw=document.getElementById('enp-lng').value;
  let bad=false;
  if(!nama){_markFieldInvalid('enp-nama','Nama wajib');bad=true;}
  if(!area){_markFieldInvalid('enp-area','Area wajib');bad=true;}
  const vLat=validateLat(latRaw); if(!vLat.ok){_markFieldInvalid('enp-lat',vLat.msg);bad=true;}
  const vLng=validateLng(lngRaw); if(!vLng.ok){_markFieldInvalid('enp-lng',vLng.msg);bad=true;}
  if(bad){showToast('⚠️ Periksa field yang merah');return;}

  const newId=perumahan.length>0?Math.max(...perumahan.map(p=>p.id))+1:1;
  perumahan.push({
    id:newId,nama:nama.toUpperCase(),lat:vLat.value,lng:vLng.value,
    tipe:document.getElementById('enp-tipe').value,
    realisasi:parseInt(document.getElementById('enp-real').value)||0,
    unit:parseInt(document.getElementById('enp-unit').value)||80,
    tahun:parseInt(document.getElementById('enp-tahun').value)||2024,
    developer:document.getElementById('enp-dev').value.trim()||'-',area
  });
  _clearAddFields(['enp-nama','enp-area','enp-lat','enp-lng','enp-dev','enp-unit','enp-real','enp-tahun']);
  renderEPerumahan();markDirtyAndPersist();
  document.getElementById('enp-nama').focus();
  showToast('✅ Ditambahkan (belum tersinkron)');
}

function addEPoi(){
  const nama=document.getElementById('epoi-nama').value.trim();
  const latRaw=document.getElementById('epoi-lat').value;
  const lngRaw=document.getElementById('epoi-lng').value;
  let bad=false;
  if(!nama){_markFieldInvalid('epoi-nama','Nama wajib');bad=true;}
  const vLat=validateLat(latRaw); if(!vLat.ok){_markFieldInvalid('epoi-lat',vLat.msg);bad=true;}
  const vLng=validateLng(lngRaw); if(!vLng.ok){_markFieldInvalid('epoi-lng',vLng.msg);bad=true;}
  if(bad){showToast('⚠️ Periksa field yang merah');return;}

  const kat=document.getElementById('epoi-kat').value;
  poi.push({nama,lat:vLat.value,lng:vLng.value,kat,label:KAT_LBL_E[kat],emoji:KAT_EMOJI_E[kat]});
  _clearAddFields(['epoi-nama','epoi-lat','epoi-lng']);
  renderEPoi();markDirtyAndPersist();
  document.getElementById('epoi-nama').focus();
  showToast('✅ Ditambahkan (belum tersinkron)');
}

function resetEditorData(){
  if(!confirm('Reset semua data ke default? Perubahan belum tersinkron akan hilang.'))return;
  localStorage.removeItem('bm4_data');location.reload();
}

function applyEditorToPeta(){
  recalcAll();
  if(analisaMapInit){
    Object.values(markers).forEach(({marker})=>analisaMap.removeLayer(marker));
    Object.values(poiMarkers).forEach(({marker})=>analisaMap.removeLayer(marker));
    markers={};poiMarkers={};
    perumahan.forEach(p=>{const isAnch=p.id===ANCHOR_ID,color=TIPE_COLOR[p.tipe]||'#666',sz=isAnch?20:15;const icon=L.divIcon({html:`<div style="width:${sz}px;height:${sz}px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.3);${isAnch?'border:3px solid #D97706;box-shadow:0 0 0 3px rgba(217,119,6,0.3);':''}"></div>${isAnch?'<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);font-size:12px;">⭐</div>':''}`,iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],className:''});const m=L.marker([p.lat,p.lng],{icon}).addTo(analisaMap);m.bindTooltip(`<b>${p.nama}</b><br>${p.area} · Skor: <b>${p.score}</b>`,{direction:'top',offset:[0,-10]});m.on('click',()=>selectPerumahan(p.id));markers[p.id]={marker:m,data:p};});
    poi.forEach((x,i)=>{const color=KAT_COLOR[x.kat]||'#666';const icon=L.divIcon({html:`<div style="width:20px;height:20px;background:${color};border-radius:5px;border:1.5px solid rgba(255,255,255,0.8);box-shadow:0 1px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:700;">${(x.label||'P')[0]}</div>`,iconSize:[20,20],iconAnchor:[10,10],className:''});const m=L.marker([x.lat,x.lng],{icon,zIndexOffset:-100});m.bindTooltip(`${x.emoji||'📍'} ${x.nama}`,{direction:'top',offset:[0,-8]});poiMarkers[i]={marker:m,data:x};if(activePoi[x.kat])m.addTo(analisaMap);});
    const sel=document.getElementById('perumahan-select');sel.innerHTML='<option value="">— Semua Perumahan —</option>';perumahan.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=(p.id===ANCHOR_ID?'⭐ ':'')+p.nama;sel.appendChild(o);});
    buildRanking('overall');
  }
  // [v12 EDITOR] Terapkan = update peta saja. Sync tetap manual.
  if(editorState.dirty){
    showToast('✅ Peta diperbarui — jangan lupa klik "Sync ke Sheets"');
  } else {
    showToast('✅ Peta diperbarui');
  }
  toggleEditor();
}

// ============================================================
// FORMULA EDITOR
// ============================================================
function syncNum(rId,nId){document.getElementById(nId).value=document.getElementById(rId).value;}
function syncRng(nId,rId){document.getElementById(rId).value=document.getElementById(nId).value;}
function updateWTotal(){const total=parseInt(document.getElementById('w-aksesibilitas').value||0)+parseInt(document.getElementById('w-fasilitas').value||0)+parseInt(document.getElementById('w-fisik').value||0);const el=document.getElementById('weight-total-display');el.textContent=`Total: ${total}% ${total===100?'✓':'⚠ harus = 100%'}`;el.className='weight-total '+(total===100?'ok':'bad');}
['w-aksesibilitas','w-fasilitas','w-fisik'].forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('input',updateWTotal);});
function loadAdminValues(){
  document.getElementById('w-aksesibilitas').value=FORMULA.wAksesibilitas;
  document.getElementById('w-fasilitas').value=FORMULA.wFasilitas;
  document.getElementById('w-fisik').value=FORMULA.wFisik;
  document.getElementById('sw-tol').value=FORMULA.wTol;document.getElementById('sn-tol').value=FORMULA.wTol;
  document.getElementById('sw-cbd').value=FORMULA.wCBD;document.getElementById('sn-cbd').value=FORMULA.wCBD;
  document.getElementById('sw-transport').value=FORMULA.wTransport;document.getElementById('sn-transport').value=FORMULA.wTransport;
  document.getElementById('sw-rs').value=FORMULA.wRS;document.getElementById('sn-rs').value=FORMULA.wRS;
  document.getElementById('sw-kampus').value=FORMULA.wKampus;document.getElementById('sn-kampus').value=FORMULA.wKampus;
  document.getElementById('sw-mall').value=FORMULA.wMall;document.getElementById('sn-mall').value=FORMULA.wMall;
  document.getElementById('sw-pemda').value=FORMULA.wPemda;document.getElementById('sn-pemda').value=FORMULA.wPemda;
  document.getElementById('sw-industri').value=FORMULA.wIndustri;document.getElementById('sn-industri').value=FORMULA.wIndustri;
  document.getElementById('sw-publik').value=FORMULA.wPublik;document.getElementById('sn-publik').value=FORMULA.wPublik;
  document.getElementById('sw-decay-aks').value=FORMULA.decayAks;document.getElementById('sn-decay-aks').value=FORMULA.decayAks;
  document.getElementById('sw-decay-fas').value=FORMULA.decayFas;document.getElementById('sn-decay-fas').value=FORMULA.decayFas;
  updateWTotal();
}
document.getElementById('formula-trigger').addEventListener('click',()=>{loadAdminValues();switchHubTab('scoring');document.getElementById('admin-overlay').classList.add('open');});
document.getElementById('admin-overlay').addEventListener('click',e=>{if(e.target===document.getElementById('admin-overlay'))document.getElementById('admin-overlay').classList.remove('open');});
function applyFormula(){
  const wA=parseInt(document.getElementById('w-aksesibilitas').value),wF=parseInt(document.getElementById('w-fasilitas').value),wFi=parseInt(document.getElementById('w-fisik').value);
  if(wA+wF+wFi!==100){alert('Total bobot faktor utama harus = 100%\nSekarang: '+(wA+wF+wFi)+'%');return;}
  FORMULA.wAksesibilitas=wA;FORMULA.wFasilitas=wF;FORMULA.wFisik=wFi;
  FORMULA.wTol=parseInt(document.getElementById('sn-tol').value);FORMULA.wCBD=parseInt(document.getElementById('sn-cbd').value);FORMULA.wTransport=parseInt(document.getElementById('sn-transport').value);
  FORMULA.wRS=parseInt(document.getElementById('sn-rs').value);FORMULA.wKampus=parseInt(document.getElementById('sn-kampus').value);FORMULA.wMall=parseInt(document.getElementById('sn-mall').value);
  FORMULA.wPemda=parseInt(document.getElementById('sn-pemda').value);FORMULA.wIndustri=parseInt(document.getElementById('sn-industri').value);FORMULA.wPublik=parseInt(document.getElementById('sn-publik').value);
  FORMULA.decayAks=parseFloat(document.getElementById('sn-decay-aks').value);FORMULA.decayFas=parseFloat(document.getElementById('sn-decay-fas').value);
  try{localStorage.setItem('bm4_formula',JSON.stringify(FORMULA));}catch(e){}
  recalcAll();
  if(analisaMapInit){Object.entries(markers).forEach(([id,{marker,data}])=>{marker.setTooltipContent(`<b>${data.nama}</b><br>${data.area} · Skor: <b>${data.score}</b>`);});buildRanking(document.getElementById('rank-cat-select').value);}
  if(selectedId)selectPerumahan(selectedId);
  document.getElementById('admin-overlay').classList.remove('open');
  showToast('✅ Formula diperbarui & skor dihitung ulang!');
  const t=document.getElementById('formula-trigger');t.textContent='✓';t.style.background='#ECFDF5';setTimeout(()=>{t.textContent='⚙️';t.style.background='white';},1500);
}
function resetFormula(){if(!confirm('Reset formula ke default?'))return;FORMULA={wAksesibilitas:50,wFasilitas:30,wFisik:20,wTol:40,wCBD:40,wTransport:20,wRS:30,wKampus:20,wMall:20,wPemda:10,wIndustri:10,wPublik:10,decayAks:8,decayFas:6};loadAdminValues();}

// ============================================================
// [TAHAP 3] HUB FORMULA — Tab switcher + Potensi + Cache
// ============================================================
function switchHubTab(tab){
  document.querySelectorAll('.hub-tab').forEach(b=>b.classList.toggle('active', b.dataset.hubTab===tab));
  document.querySelectorAll('.hub-pane').forEach(p=>p.classList.toggle('active', p.dataset.hubPane===tab));
  if(tab==='potensi') loadHubPotensiValues();
  if(tab==='cache') refreshCacheStats();
  if(tab==='kategori') renderKategoriEditor();
  if(tab==='pdl_formula') renderPdlFormulaEditor();
  if(tab==='field_mgr') renderFieldManager();
  if(tab==='gap_analysis') renderGapAnalysis();
}

// Potensi Unit ─────────────────────────────────────
function loadHubPotensiValues(){
  const input=document.getElementById('hub-formula-pct');
  const saveBtn=document.getElementById('hub-potensi-save');
  const locked=document.getElementById('hub-potensi-locked');
  if(!input) return;
  input.value=POTENSI_PCT;
  document.getElementById('hub-formula-pct-disp').textContent=POTENSI_PCT;
  document.getElementById('hub-formula-pct-disp2').textContent=POTENSI_PCT;
  document.getElementById('hub-formula-sample').textContent=(typeof fmt==='function'?fmt(calcPotensiUnit(5000)):calcPotensiUnit(5000));
  // Role guard — hanya BM yang bisa edit
  const isBM = (typeof currentUser!=='undefined' && currentUser && currentUser.role==='bm');
  input.disabled = !isBM;
  if(saveBtn) saveBtn.style.display = isBM ? '' : 'none';
  if(locked) locked.style.display = isBM ? 'none' : 'block';
}
function previewHubFormulaPotensi(){
  const v=parseFloat(document.getElementById('hub-formula-pct').value)||0;
  document.getElementById('hub-formula-pct-disp').textContent=v;
  document.getElementById('hub-formula-pct-disp2').textContent=v;
  document.getElementById('hub-formula-sample').textContent=(typeof fmt==='function'?fmt(Math.round((5000*v)/100)):Math.round((5000*v)/100));
}
function saveHubFormulaPotensi(){
  const v=parseFloat(document.getElementById('hub-formula-pct').value);
  if(isNaN(v)||v<1||v>100){alert('Persentase harus antara 1–100');return;}
  savePotensiFormula(v);
  // Sync ke Settings (kalau field-nya sudah ter-render)
  const legacyInput=document.getElementById('set-formula-pct');
  if(legacyInput){
    legacyInput.value=v;
    const d1=document.getElementById('set-formula-pct-disp'); if(d1) d1.textContent=v;
    const d2=document.getElementById('set-formula-pct-disp2'); if(d2) d2.textContent=v;
    const s=document.getElementById('set-formula-sample'); if(s) s.textContent=(typeof fmt==='function'?fmt(calcPotensiUnit(5000)):calcPotensiUnit(5000));
  }
  // Re-render detail target pasar kalau sedang terbuka
  if(typeof renderTpList==='function') try{renderTpList();}catch(_){}
  showToast('✅ Formula Potensi disimpan');
}

// Route Cache ─────────────────────────────────────
function refreshCacheStats(){
  const countEl=document.getElementById('hub-cache-count');
  const sizeEl=document.getElementById('hub-cache-size');
  const oldestEl=document.getElementById('hub-cache-oldest');
  if(!countEl) return;
  let count=0, sizeBytes=0, oldestTs=null;
  try{
    const raw=localStorage.getItem(ROUTE_CACHE_KEY);
    if(raw){
      sizeBytes=raw.length; // rough — 1 char ≈ 1 byte di UTF-16 LS impl, tapi cukup untuk UI
      const parsed=JSON.parse(raw);
      const entries=Object.values(parsed||{});
      count=entries.length;
      entries.forEach(e=>{ if(e && e._t && (!oldestTs || e._t<oldestTs)) oldestTs=e._t; });
    }
  }catch(_){}
  countEl.textContent=count.toLocaleString('id-ID');
  sizeEl.textContent = sizeBytes<1024 ? sizeBytes+' B' : (sizeBytes/1024).toFixed(1)+' KB';
  if(oldestTs){
    const days=Math.floor((Date.now()-oldestTs)/86400000);
    oldestEl.textContent = days<=0 ? 'entri tertua: hari ini' : `entri tertua: ${days} hari lalu`;
  } else {
    oldestEl.textContent = 'belum ada entri';
  }
}
function clearRouteCacheUI(){
  const countEl=document.getElementById('hub-cache-count');
  const n=countEl ? parseInt(countEl.textContent.replace(/\D/g,''))||0 : 0;
  const msg = n>0 ? `Hapus ${n} entri cache route? Jarak via jalan akan dihitung ulang saat dibutuhkan.` : 'Cache sudah kosong. Tetap lanjutkan reset?';
  if(!confirm(msg)) return;
  if(typeof clearRouteCache==='function') clearRouteCache();
  // Reset _roadNearest/_roadPerum di semua perumahan + mode-nya
  if(typeof perumahan!=='undefined' && Array.isArray(perumahan)){
    perumahan.forEach(p=>{ delete p._roadNearest; delete p._roadPerum; p._distMode='estimasi'; });
  }
  refreshCacheStats();
  showToast('🗑 Cache route dihapus');
  // Re-render detail kalau ada yang terpilih
  if(typeof selectedId!=='undefined' && selectedId && typeof selectPerumahan==='function') try{selectPerumahan(selectedId);}catch(_){}
}

// Load saved formula
try{const sf=localStorage.getItem('bm4_formula');if(sf)FORMULA={...FORMULA,...JSON.parse(sf)};recalcAll();}catch(e){}
// Load saved data
try{const sd=localStorage.getItem('bm4_data');if(sd){const d=JSON.parse(sd);if(d.perumahan&&d.perumahan.length>0){perumahan.length=0;d.perumahan.forEach(p=>perumahan.push(p));}if(d.poi&&d.poi.length>0){poi.length=0;d.poi.forEach(x=>poi.push(x));}recalcAll();}}catch(e){}

// ============================================================
// SCREENS & NAVIGATION
// ============================================================
// [v9 SECURITY] showScreen dengan auth guard — mencegah bypass via DevTools console.
// Screen sensitif (s-app, s-proyek, s-settings) butuh session aktif.
function showScreen(id){
  const PROTECTED = ['s-app','s-proyek','s-settings'];
  if(PROTECTED.includes(id)){
    const authed = sessionStorage.getItem(SESSION_KEY) === 'ok';
    if(!authed){
      // Paksa ke login
      document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
      const loginEl = document.getElementById('s-login');
      if(loginEl) loginEl.classList.add('active');
      console.warn('[BM4] Akses ditolak: belum login.');
      return;
    }
  }
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const target = document.getElementById(id);
  if(target) target.classList.add('active');
  // [v14 PROYEK] Re-render card saat masuk screen pilih proyek
  if(id === 's-proyek' && typeof renderProyekCards === 'function'){
    renderProyekCards();
  }
}
function switchDiv(div,el){
  document.querySelectorAll('.divisi-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.divisi-pane').forEach(p=>p.classList.remove('active'));
  if(el)el.classList.add('active');
  document.getElementById('pane-'+div).classList.add('active');
  if(div==='analisa'){setTimeout(()=>{initAnalisaMap();},100);}
  if(div==='strategi'){setTimeout(()=>{initStratMap();loadTpFromSheets().then(ok=>{if(ok){renderTPList(tpFilter);renderTPMarkers();updateTpDashCount();}});},100);}
  if(div==='proyek'){setTimeout(()=>{renderProyek();},50);} // [v14 PROYEK]
  if(typeof switchDivHook === 'function') switchDivHook(div, el);
}
function selectProyek(id){
  currentProyek=id;
  const p=PROYEK[id];
  document.getElementById('tb-proyek-name').textContent=`📍 ${p.nama}`;
  document.getElementById('dash-proyek-title').textContent=p.nama;
  document.getElementById('dash-proyek-sub').textContent=`${p.area} · ${p.tipe}`;
  document.getElementById('dash-unit').textContent=p.unit>0?fmt(p.unit):'—';
  document.getElementById('dash-real').textContent='—';
  // Anchor score for dashboard
  const anchorScore=perumahan.find(x=>x.id===ANCHOR_ID);
  if(anchorScore)document.getElementById('d-anchor-score').textContent=anchorScore.score+' pts';
  // [v12] Kata Hari Ini di dashboard
  const dq=document.getElementById('dash-quote-text');
  if(dq)dq.textContent='"'+dailyQuote()+'"';
  // [DASHBOARD RANKING] Render ranking saat dashboard dibuka
  try{ renderDashboardRanking(); }catch(e){ console.warn('dash ranking err', e); }
  updateTpDashCount();
  tpMapInit=false;tpMap=null;tpMarkers={};
  showScreen('s-app');
  switchDiv('dashboard',document.querySelector('[data-div="dashboard"]'));
  // [v12.4 STATE PERSISTENCE] Coba restore state terakhir setelah app loaded
  // Delay 100ms supaya DOM ready, lalu restore (kalau ada saved state)
  setTimeout(()=>{
    try {
      if(typeof restoreAppState === 'function') restoreAppState();
    } catch(e){ console.warn('restoreAppState err:', e); }
  }, 100);
}
function backToProyek(){
  analisaMapInit=false;analisaMap=null;markers={};poiMarkers={};
  tpMapInit=false;tpMap=null;tpMarkers={};
  showScreen('s-proyek');
}
function doLogout(){
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem('bm4_session_start');
  // [v12.4 STATE PERSISTENCE] Clear saved state on logout
  try { if(typeof clearAppState === 'function') clearAppState(); } catch(e){}
  showScreen('s-login');
  setTimeout(()=>document.getElementById('login-input').focus(),100);
}
// [v9 SECURITY] doLoginOld() dihapus — dulu mereferensi BM4_PASSWORD yang sudah tidak ada.
// Sekarang login hanya lewat doLoginNew() yang di-expose via window.doLogin (lihat bawah file).

// ============================================================
// GOOGLE SHEETS SYNC (Kompetitor)
// ============================================================
async function loadFromSheets(){
  if(!USE_SHEETS)return false;
  setSyncStatus('loading','Memuat data dari Google Sheets...');
  try{
    const[rP,rPoi]=await Promise.all([fetch(gasGet('getPerumahan')).then(r=>r.json()),fetch(gasGet('getPoi')).then(r=>r.json())]);
    let updated=false;
    if(rP.success&&rP.data.length>0){perumahan.length=0;rP.data.forEach(r=>perumahan.push({id:parseInt(r.id),nama:r.nama,area:r.area,tipe:r.tipe,lat:parseFloat(r.lat),lng:parseFloat(r.lng),developer:r.developer,unit:parseInt(r.unit)||0,realisasi:parseInt(r.realisasi)||0,tahun:parseInt(r.tahun)||2024}));updated=true;}
    if(rPoi.success&&rPoi.data.length>0){poi.length=0;rPoi.data.forEach(r=>poi.push({nama:r.nama,lat:parseFloat(r.lat),lng:parseFloat(r.lng),kat:r.kat,label:r.label||'P',emoji:r.emoji||'📍'}));updated=true;}
    if(updated){
      // Simpan ke localStorage sebagai cache offline
      try{localStorage.setItem('bm4_data',JSON.stringify({perumahan,poi}));}catch(e){}
      recalcAll();
      // Re-render peta & UI kalau sudah di-render sebelumnya
      try{if(typeof renderMarkers==='function') renderMarkers();}catch(_){}
      try{if(typeof renderRanking==='function') renderRanking();}catch(_){}
      try{if(typeof renderDashboardRanking==='function') renderDashboardRanking();}catch(_){}
      try{if(typeof renderEPerumahan==='function') renderEPerumahan();}catch(_){}
      try{if(typeof renderEPoi==='function') renderEPoi();}catch(_){}
    }
    setSyncStatus('synced',`Data dari Sheets: ${perumahan.length} perumahan, ${poi.length} POI`);
    return true;
  }catch(e){
    setSyncStatus('offline','Gagal koneksi ke Sheets — pakai data lokal');
    console.warn('[loadFromSheets] Gagal:',e);
    return false;
  }
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}

// ============================================================
// ACCOUNT MANAGEMENT SYSTEM (NEW)
// ============================================================
const ACCOUNTS_KEY = 'bm4_accounts';
const ACCLOG_KEY = 'bm4_acclog';
const CURRENT_USER_KEY = 'bm4_current_user';

// Default accounts (akan dipakai pertama kali, lalu disimpan di localStorage/Sheets)
// Default accounts diambil dari localStorage (tidak ada plaintext password di source code)
// Pertama kali dijalankan, password diambil dari getDefaultAccounts() yang baca localStorage
function getDefaultAccounts(){
  const saved = localStorage.getItem('bm4_default_accounts');
  if(saved){ try{ return JSON.parse(saved); }catch(e){} }
  // Hanya pertama kali — default awal disimpan ke localStorage
  const defaults = [
    {username:'bm4',         password:'bm4property2024', nama:'Branch Manager Area 4', jabatan:'Branch Manager', role:'bm',         foto:'', bio:'Memimpin dengan hati, bergerak dengan strategi.', akses:['dashboard','analisa','strategi','sales','konstruksi','legal','finance','tim']},
    {username:'sales1',      password:'sales123',        nama:'Sales 1',                jabatan:'Sales Executive', role:'sales',    foto:'', bio:'', akses:['dashboard','sales']},
    {username:'sales2',      password:'sales123',        nama:'Sales 2',                jabatan:'Sales Executive', role:'sales',    foto:'', bio:'', akses:['dashboard','sales']},
    {username:'sales3',      password:'sales123',        nama:'Sales 3',                jabatan:'Sales Executive', role:'sales',    foto:'', bio:'', akses:['dashboard','sales']},
    {username:'strategi1',   password:'strat123',        nama:'Strategi 1',             jabatan:'Strategi & Promo',role:'strategi', foto:'', bio:'', akses:['dashboard','strategi']},
    {username:'strategi2',   password:'strat123',        nama:'Strategi 2',             jabatan:'Strategi & Promo',role:'strategi', foto:'', bio:'', akses:['dashboard','strategi']},
    {username:'konstruksi1', password:'kons123',         nama:'Konstruksi 1',           jabatan:'Tim Konstruksi',  role:'konstruksi', foto:'', bio:'', akses:['dashboard','konstruksi']},
    {username:'konstruksi2', password:'kons123',         nama:'Konstruksi 2',           jabatan:'Tim Konstruksi',  role:'konstruksi', foto:'', bio:'', akses:['dashboard','konstruksi']},
    {username:'konstruksi3', password:'kons123',         nama:'Konstruksi 3',           jabatan:'Tim Konstruksi',  role:'konstruksi', foto:'', bio:'', akses:['dashboard','konstruksi']}
  ];
  localStorage.setItem('bm4_default_accounts', JSON.stringify(defaults));
  return defaults;
}

let accounts = [];         // array of accounts
let accountLogs = [];      // array of log entries
let currentUser = null;    // user saat ini login
let editingAccUsername = null; // untuk mode edit

// Load accounts dari localStorage (fallback) atau default
function loadAccounts(){
  try{
    const saved = localStorage.getItem(ACCOUNTS_KEY);
    if(saved){
      accounts = JSON.parse(saved);
    } else {
      accounts = JSON.parse(JSON.stringify(getDefaultAccounts()));
      saveAccountsLocal();
    }
  }catch(e){
    accounts = JSON.parse(JSON.stringify(getDefaultAccounts()));
  }
  try{
    const savedLog = localStorage.getItem(ACCLOG_KEY);
    accountLogs = savedLog ? JSON.parse(savedLog) : [];
  }catch(e){ accountLogs = []; }
}

function saveAccountsLocal(){
  try{ localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); }catch(e){}
}
function saveLogsLocal(){
  try{ localStorage.setItem(ACCLOG_KEY, JSON.stringify(accountLogs)); }catch(e){}
}

// Sync ke Google Sheets (opsional, kalau GAS sudah mendukung)
async function syncAccountsToSheets(){
  if(!USE_SHEETS) return;
  try{
    await fetch(GAS_URL, {
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: gasPost({action:'saveAccounts', data: accounts})
    });
  }catch(e){ console.warn('Sync accounts failed', e); }
}

async function loadAccountsFromSheets(){
  if(!USE_SHEETS) return false;
  try{
    const r = await fetch(gasGet('getAccounts')).then(r=>r.json());
    if(r && r.success && Array.isArray(r.data) && r.data.length > 0){
      accounts = r.data.map(a => ({
        username: a.username,
        password: a.password,
        nama: a.nama || '',
        jabatan: a.jabatan || '',
        role: a.role || 'sales',
        foto: a.foto || '',
        bio: a.bio || '',
        akses: typeof a.akses === 'string' ? a.akses.split(',').map(x=>x.trim()).filter(Boolean) : (a.akses || [])
      }));
      saveAccountsLocal();
      return true;
    }
  }catch(e){ console.warn('Load accounts from sheets failed', e); }
  return false;
}

async function logActivity(username, action, detail){
  const entry = {
    timestamp: new Date().toISOString(),
    username, action, detail
  };
  accountLogs.unshift(entry);
  if(accountLogs.length > 100) accountLogs = accountLogs.slice(0, 100);
  saveLogsLocal();
  // Sync log ke Sheets (opsional)
  if(USE_SHEETS){
    try{
      await fetch(GAS_URL, {
        method:'POST', mode:'no-cors',
        headers:{'Content-Type':'text/plain'},
        body: gasPost({action:'logActivity', data: entry})
      });
    }catch(e){}
  }
}

function findAccount(username){
  return accounts.find(a => a.username.toLowerCase() === (username||'').toLowerCase());
}

// ============================================================
// LOGIN FLOW (MULTI-USER) — REPLACEMENT
// ============================================================

// ─── BRUTE FORCE PROTECTION ───────────────────────────────
let _loginAttempts = 0;
let _loginLockUntil = 0;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 menit

function checkLoginLockout(){
  const now = Date.now();
  if(_loginLockUntil > now){
    const remaining = Math.ceil((_loginLockUntil - now) / 1000);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return `Terlalu banyak percobaan. Tunggu ${mins}m ${secs}s lagi.`;
  }
  if(_loginLockUntil && _loginLockUntil <= now){
    _loginAttempts = 0;
    _loginLockUntil = 0;
  }
  return null;
}

function recordLoginFailure(){
  _loginAttempts++;
  if(_loginAttempts >= MAX_LOGIN_ATTEMPTS){
    _loginLockUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
}

function resetLoginAttempts(){
  _loginAttempts = 0;
  _loginLockUntil = 0;
}
// ──────────────────────────────────────────────────────────
// [v9 SECURITY] doLoginNew() adalah fungsi login utama (async, pakai hash verification)
async function doLoginNew(){
  const username = (document.getElementById('login-username').value || '').trim();
  const password = document.getElementById('login-input').value;
  const err = document.getElementById('login-error');

  // Cek lockout brute force
  const lockMsg = checkLoginLockout();
  if(lockMsg){ err.textContent = lockMsg; err.classList.add('show'); return; }

  // [v9 SECURITY] Fallback master password — HANYA jalan kalau master pw sudah diset secara manual.
  const masterPw = getMasterPassword();
  if(!username && masterPw && password === masterPw){
    currentUser = accounts.find(a => a.role === 'bm') || accounts[0];
    sessionStorage.setItem(SESSION_KEY, 'ok');
    sessionStorage.setItem(CURRENT_USER_KEY, currentUser.username);
    err.classList.remove('show');
    applyUserAccess();
    resetLoginAttempts();
    startSessionTimer();
    logActivity(currentUser.username, 'login', 'Login via master password');
    showScreen('s-proyek');
    return;
  }

  const acc = findAccount(username);
  // [v10 CONTROL] Block login untuk akun yang di-suspend
  if(acc && acc.suspended){
    err.textContent = '⛔ Akun Anda sedang dinonaktifkan. Hubungi Branch Manager.';
    err.classList.add('show');
    recordLoginFailure();
    logActivity(acc.username, 'login ditolak', 'Akun suspended mencoba login');
    return;
  }
  // [v9 SECURITY] verifyPassword kompatibel dengan plaintext legacy + hash baru
  const ok = acc ? await verifyPassword(password, acc.password) : false;
  if(acc && ok){
    // Auto-migrasi password plaintext → hash
    if(acc.password && !acc.password.startsWith(PW_HASH_PREFIX)){
      acc.password = await hashPassword(password);
      saveAccountsLocal();
      if(USE_SHEETS) syncAccountsToSheets();
    }
    currentUser = acc;
    sessionStorage.setItem(SESSION_KEY, 'ok');
    sessionStorage.setItem(CURRENT_USER_KEY, acc.username);
    // [v10 CONTROL] Catat kapan session ini dimulai (untuk force-logout detection)
    sessionStorage.setItem('bm4_session_start', String(Date.now()));
    err.classList.remove('show');
    applyUserAccess();
    resetLoginAttempts();
    startSessionTimer();
    logActivity(acc.username, 'login', 'Login berhasil');
    showScreen('s-proyek');
  } else {
    recordLoginFailure();
    err.classList.add('show');
    document.getElementById('login-input').value = '';
    document.getElementById('login-input').focus();
  }
}

// Terapkan hak akses: sembunyikan tab yang tidak boleh diakses, update profile di topbar
function applyUserAccess(){
  if(!currentUser) return;

  // Update profile button
  const avEl = document.getElementById('tb-profile-avatar');
  const nmEl = document.getElementById('tb-profile-name');
  const rlEl = document.getElementById('tb-profile-role');
  if(avEl){
    if(currentUser.foto){
      avEl.innerHTML = renderFotoHtml(currentUser.foto, '');
    } else {
      avEl.textContent = (currentUser.nama||currentUser.username||'?').charAt(0).toUpperCase();
    }
  }
  if(nmEl) nmEl.textContent = currentUser.nama || currentUser.username;
  if(rlEl) rlEl.textContent = currentUser.jabatan || roleLabel(currentUser.role);

  // Tampilkan/sembunyikan tab sesuai akses
  const akses = currentUser.akses || [];
  document.querySelectorAll('.divisi-tab[data-div]').forEach(tab => {
    const div = tab.getAttribute('data-div');
    if(div === 'dashboard'){ tab.style.display = ''; return; } // dashboard selalu ada
    if(div === 'galeri'){ tab.style.display = ''; return; } // galeri selalu ada untuk semua user
    if(div === 'tim'){
      // Tab Tim BM4 hanya untuk BM
      tab.style.display = (currentUser.role === 'bm') ? '' : 'none';
      return;
    }
    if(div === 'proyek'){
      // [v14 PROYEK] Tab Kelola Proyek hanya untuk BM
      tab.style.display = (currentUser.role === 'bm') ? '' : 'none';
      return;
    }
    tab.style.display = akses.includes(div) ? '' : 'none';
  });
}

function roleLabel(role){
  return {bm:'Branch Manager',sales:'Sales',strategi:'Strategi',konstruksi:'Konstruksi',legal:'Legal',finance:'Finance'}[role] || role;
}

function roleBadgeClass(role){
  return {bm:'tim-role-bm',sales:'tim-role-sales',strategi:'tim-role-strategi',konstruksi:'tim-role-konstruksi',legal:'tim-role-sales',finance:'tim-role-sales'}[role] || 'tim-role-sales';
}

// ============================================================
// [v14 PROYEK] KELOLA PROYEK — CRUD (BM only)
// ============================================================
function escProyek(s){ return String(s==null?'':s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function slugifyKode(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,12) || ('p'+Date.now().toString(36).slice(-5));
}

function renderProyek(){
  const grid = document.getElementById('pry-grid');
  if(!grid) return;
  if(!PROYEK_LIST || PROYEK_LIST.length === 0){
    grid.innerHTML = '<div class="pry-empty">Belum ada proyek. Klik <b>➕ Tambah Proyek</b> untuk mulai.</div>';
    return;
  }
  grid.innerHTML = '';
  PROYEK_LIST.forEach(p => {
    const card = document.createElement('div');
    card.className = 'pry-card';
    const statusClass = (p.status||'Aktif').toLowerCase();
    const fotoHtml = p.foto
      ? `<img src="${escProyek(p.foto)}" alt="${escProyek(p.nama)}" onerror="this.style.display='none';this.parentElement.innerHTML='<div class=\\'pry-card-photo-placeholder\\'>${escProyek(p.ikon||'🏘️')}</div>';">`
      : `<div class="pry-card-photo-placeholder">${escProyek(p.ikon||'🏘️')}</div>`;
    const unitTxt = (p.unit>0) ? fmt(p.unit)+' Unit' : '— Unit';
    const devTxt = p.developer ? `<span class="pry-card-chip">${escProyek(p.developer)}</span>` : '';
    const descTxt = p.deskripsi ? `<div class="pry-card-desc">"${escProyek(p.deskripsi)}"</div>` : '';
    card.innerHTML = `
      <div class="pry-card-photo" style="background:linear-gradient(135deg, ${escProyek(p.warna||'#F1F5F9')}22 0%, ${escProyek(p.warna||'#E2E8F0')}11 100%);">
        ${fotoHtml}
        <div class="pry-card-status ${statusClass}">${escProyek(p.status||'Aktif')}</div>
      </div>
      <div class="pry-card-body">
        <div class="pry-card-name">${escProyek(p.ikon||'🏘️')} ${escProyek(p.nama)}</div>
        <div class="pry-card-area">📍 ${escProyek(p.area||'—')}</div>
        <div class="pry-card-meta">
          <span class="pry-card-chip tipe">${escProyek(p.tipe||'—')}</span>
          <span class="pry-card-chip">${unitTxt}</span>
          ${devTxt}
        </div>
        ${descTxt}
      </div>
      <div class="pry-card-actions">
        <button class="pry-card-btn" onclick="editProyek('${escProyek(p.id)}')">✏️ Edit</button>
        <button class="pry-card-btn danger" onclick="deleteProyek('${escProyek(p.id)}')">🗑️ Hapus</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function openProyekModal(){
  // Reset form — mode tambah
  document.getElementById('pry-modal-title').textContent = 'Tambah Proyek Baru';
  document.getElementById('pry-edit-id').value = '';
  document.getElementById('pry-nama').value = '';
  document.getElementById('pry-kode').value = '';
  document.getElementById('pry-area').value = '';
  document.getElementById('pry-tipe').value = 'Mix-use';
  document.getElementById('pry-status').value = 'Aktif';
  document.getElementById('pry-unit').value = '';
  document.getElementById('pry-developer').value = '';
  document.getElementById('pry-lat').value = '';
  document.getElementById('pry-lng').value = '';
  document.getElementById('pry-ikon').value = '🏘️';
  document.getElementById('pry-warna').value = '#3B82F6';
  document.getElementById('pry-deskripsi').value = '';
  document.getElementById('pry-modal').classList.add('open');
  // [v15 PROYEK] reset foto + init mini-map & smart-input
  _prepPryModalExtras('', '', '');
  setTimeout(()=>{ const el=document.getElementById('pry-nama'); if(el) el.focus(); }, 50);
}

function closeProyekModal(){
  document.getElementById('pry-modal').classList.remove('open');
}

function editProyek(id){
  const p = getProyek(id);
  if(!p){ showToast('Proyek tidak ditemukan'); return; }
  document.getElementById('pry-modal-title').textContent = 'Edit Proyek: ' + p.nama;
  document.getElementById('pry-edit-id').value = p.id;
  document.getElementById('pry-nama').value = p.nama || '';
  document.getElementById('pry-kode').value = (p.kode || p.id || '').toUpperCase();
  document.getElementById('pry-area').value = p.area || '';
  document.getElementById('pry-tipe').value = p.tipe || 'Mix-use';
  document.getElementById('pry-status').value = p.status || 'Aktif';
  document.getElementById('pry-unit').value = p.unit || 0;
  document.getElementById('pry-developer').value = p.developer || '';
  document.getElementById('pry-lat').value = p.lat;
  document.getElementById('pry-lng').value = p.lng;
  document.getElementById('pry-ikon').value = p.ikon || '🏘️';
  document.getElementById('pry-warna').value = p.warna || '#3B82F6';
  document.getElementById('pry-deskripsi').value = p.deskripsi || '';
  document.getElementById('pry-modal').classList.add('open');
  // [v15 PROYEK] isi foto state + mini-map pin dari data existing
  _prepPryModalExtras(p.foto || '', p.lat, p.lng);
}

function saveProyek(){
  const editId = (document.getElementById('pry-edit-id').value || '').trim();
  const nama = (document.getElementById('pry-nama').value || '').trim();
  const kode = (document.getElementById('pry-kode').value || '').trim().toUpperCase();
  const area = (document.getElementById('pry-area').value || '').trim();
  const tipe = document.getElementById('pry-tipe').value;
  const status = document.getElementById('pry-status').value;
  const unit = parseInt(document.getElementById('pry-unit').value) || 0;
  const developer = (document.getElementById('pry-developer').value || '').trim();
  const latStr = (document.getElementById('pry-lat').value || '').trim();
  const lngStr = (document.getElementById('pry-lng').value || '').trim();
  const ikon = (document.getElementById('pry-ikon').value || '🏘️').trim();
  const warna = document.getElementById('pry-warna').value || '#3B82F6';
  const deskripsi = (document.getElementById('pry-deskripsi').value || '').trim();

  // Validasi
  if(!nama){ showToast('Nama proyek wajib diisi'); return; }
  if(!kode){ showToast('Kode singkat wajib diisi'); return; }
  if(!/^[A-Z0-9]{2,8}$/.test(kode)){ showToast('Kode harus huruf/angka 2-8 karakter'); return; }
  if(!area){ showToast('Area wajib diisi'); return; }
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if(isNaN(lat) || isNaN(lng)){ showToast('Koordinat lat/lng wajib diisi'); return; }
  // Pakai validator yg sudah ada dari v12
  if(typeof validateLat === 'function' && !validateLat(lat)){ showToast('Latitude di luar range Indonesia (-11.5..6.5)'); return; }
  if(typeof validateLng === 'function' && !validateLng(lng)){ showToast('Longitude di luar range Indonesia (94.5..141.5)'); return; }

  const id = editId || slugifyKode(kode);

  // Cek duplikat kode/id (hanya untuk tambah baru atau kalau kode diubah)
  if(!editId){
    if(PROYEK_LIST.some(p => p.id === id || (p.kode||'').toUpperCase() === kode)){
      showToast('Kode "' + kode + '" sudah dipakai proyek lain');
      return;
    }
  }

  const data = { id, nama, kode, area, tipe, status, unit, developer, lat, lng, ikon, warna, deskripsi, foto: _pryFotoState || '' };

  if(editId){
    const idx = PROYEK_LIST.findIndex(p => p.id === editId);
    if(idx >= 0){
      PROYEK_LIST[idx] = data;
      showToast('✓ Proyek "' + nama + '" diperbarui');
    }
  } else {
    PROYEK_LIST.push(data);
    showToast('✓ Proyek "' + nama + '" ditambahkan');
  }

  saveProyekLocal();
  if(typeof syncProyekToSheets === 'function') syncProyekToSheets(); // [v15 PROYEK] sync
  renderProyek();
  // Refresh screen pilih proyek juga biar sinkron kalau user keluar
  if(typeof renderProyekCards === 'function') renderProyekCards();
  closeProyekModal();
}

function deleteProyek(id){
  const p = getProyek(id);
  if(!p){ showToast('Proyek tidak ditemukan'); return; }
  // Safety: jangan izinkan hapus kalau cuma tersisa 1 proyek
  if(PROYEK_LIST.length <= 1){
    showToast('Minimal harus ada 1 proyek. Tambah yang lain dulu sebelum menghapus.');
    return;
  }
  // Safety: jangan hapus proyek yang sedang aktif dipilih
  if(currentProyek === id){
    showToast('Tidak bisa hapus proyek yang sedang dipilih. Keluar ke daftar proyek dulu.');
    return;
  }
  if(!confirm('Hapus proyek "' + p.nama + '"?\nTindakan ini tidak bisa di-undo.')) return;

  PROYEK_LIST = PROYEK_LIST.filter(x => x.id !== id);
  saveProyekLocal();
  if(typeof syncProyekToSheets === 'function') syncProyekToSheets(); // [v15 PROYEK] sync
  renderProyek();
  if(typeof renderProyekCards === 'function') renderProyekCards();
  showToast('✓ Proyek "' + p.nama + '" dihapus');
}

// Render ulang card di screen pilih proyek (s-proyek) — dinamis dari PROYEK_LIST
function renderProyekCards(){
  const wrap = document.getElementById('proyek-cards');
  if(!wrap) return;
  wrap.innerHTML = '';
  PROYEK_LIST.forEach(p => {
    const card = document.createElement('div');
    card.className = 'proyek-card';
    card.onclick = () => selectProyek(p.id);
    const unitTxt = (p.unit > 0) ? fmt(p.unit) + ' Unit' : '— Unit';
    card.innerHTML = `
      <div class="proyek-card-icon">${escProyek(p.ikon||'🏘️')}</div>
      <div class="proyek-card-name">${escProyek(p.nama)}</div>
      <div class="proyek-card-area">${escProyek(p.area||'—')} · ${escProyek(p.tipe||'—')}</div>
      <div class="proyek-card-badge">${unitTxt}</div>
    `;
    wrap.appendChild(card);
  });
  // [v14.1] Kartu "Tambah Proyek" di screen ini dihapus — tambah proyek kini hanya via menu 🏗️ Proyek
}
// ============================================================

// ============================================================
// [v15 PROYEK Batch B] FOTO + SMART-INPUT + MINI-MAP + SYNC SHEETS
// ============================================================

// State foto modal proyek (data URL dari upload compressed, atau URL eksternal, atau '' = kosong)
let _pryFotoState = '';

// Render preview foto di modal berdasarkan state
function _renderPryFotoPreview(){
  const prev = document.getElementById('pry-foto-preview');
  const delBtn = document.getElementById('pry-foto-remove-btn');
  if(!prev) return;
  if(_pryFotoState){
    prev.classList.add('has-img');
    prev.innerHTML = `<img src="${_pryFotoState}" alt="Preview" onerror="this.parentElement.innerHTML='<div class=\\'pry-photo-preview-empty\\' style=color:#DC2626;>⚠ Gambar tidak bisa dimuat (URL salah atau diblokir)</div>';">`;
    if(delBtn) delBtn.style.display = '';
  } else {
    prev.classList.remove('has-img');
    prev.innerHTML = '<div class="pry-photo-preview-empty">Belum ada foto — klik <b>Upload</b> atau <b>URL</b> di atas</div>';
    if(delBtn) delBtn.style.display = 'none';
  }
}

// Toggle row input URL
function togglePryFotoUrl(){
  const row = document.getElementById('pry-foto-url-row');
  if(!row) return;
  row.classList.toggle('open');
  if(row.classList.contains('open')){
    const inp = document.getElementById('pry-foto-url-input');
    if(inp){ inp.value = ''; setTimeout(()=>inp.focus(), 30); }
  }
}

// Apply URL eksternal jadi foto. Auto-convert Drive sharing URL → direct image URL.
function applyPryFotoUrl(){
  const inp = document.getElementById('pry-foto-url-input');
  const status = document.getElementById('pry-foto-status');
  if(!inp) return;
  let url = (inp.value || '').trim();
  if(!url){
    if(status){ status.className = 'pry-photo-status err'; status.textContent = '⚠ URL kosong'; }
    return;
  }
  if(!/^https?:\/\//i.test(url)){
    if(status){ status.className = 'pry-photo-status err'; status.textContent = '⚠ URL harus diawali http:// atau https://'; }
    return;
  }
  // Auto-convert Drive URL kalau detect
  if(typeof _driveExtractId === 'function'){
    const driveId = _driveExtractId(url);
    if(driveId){
      const converted = _driveToImageUrl(url, 'w1200');
      if(converted){
        url = converted;
        if(status){ status.className = 'pry-photo-status ok'; status.textContent = '✓ Link Drive di-convert otomatis ke direct image URL'; }
      }
    }
  }
  _pryFotoState = url;
  _renderPryFotoPreview();
  document.getElementById('pry-foto-url-row').classList.remove('open');
  if(status && !status.textContent.includes('Drive')){ status.className = 'pry-photo-status ok'; status.textContent = '✓ URL foto diterapkan'; }
}

// Hapus foto dari state
function removePryFoto(){
  _pryFotoState = '';
  _renderPryFotoPreview();
  const status = document.getElementById('pry-foto-status');
  if(status){ status.className = 'pry-photo-status'; status.textContent = '📁 Upload file (auto-compress 600px) ATAU 🔗 paste link Google Drive (resolusi penuh, direkomendasi)'; }
}

// Handler file upload → auto-compress
function handlePryFotoFile(event){
  const file = event.target.files && event.target.files[0];
  event.target.value = ''; // biar bisa pilih file sama lagi
  if(!file) return;
  const status = document.getElementById('pry-foto-status');
  if(!file.type || !file.type.startsWith('image/')){
    if(status){ status.className = 'pry-photo-status err'; status.textContent = '⚠ File harus berupa gambar'; }
    return;
  }
  if(file.size > 5 * 1024 * 1024){
    if(status){ status.className = 'pry-photo-status err'; status.textContent = '⚠ File terlalu besar (maksimal 5 MB)'; }
    return;
  }
  if(status){ status.className = 'pry-photo-status'; status.textContent = '⏳ Compress...'; }
  _compressPryFoto(file).then(dataUrl => {
    _pryFotoState = dataUrl;
    _renderPryFotoPreview();
    // Tampilkan ukuran hasil
    const kb = Math.round((dataUrl.length * 0.75) / 1024); // approx base64→bytes
    if(status){ status.className = 'pry-photo-status ok'; status.textContent = `✓ Foto di-compress (~${kb} KB)`; }
  }).catch(err => {
    if(status){ status.className = 'pry-photo-status err'; status.textContent = '⚠ Gagal memproses gambar'; }
    console.warn('Compress foto proyek gagal:', err);
  });
}

// Compress image: max side 600px, quality 0.72 → JPEG data URL
function _compressPryFoto(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 600;
          let w = img.naturalWidth, h = img.naturalHeight;
          if(w > h && w > MAX){ h = Math.round(h * MAX / w); w = MAX; }
          else if(h > MAX){ w = Math.round(w * MAX / h); h = MAX; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF'; // bg putih kalau PNG transparan
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        } catch(err){ reject(err); }
      };
      img.onerror = () => reject(new Error('Gambar tidak bisa dimuat'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Gagal baca file'));
    reader.readAsDataURL(file);
  });
}

// [v11.6 AVATAR COMPRESS] Khusus foto avatar user — crop square + resize 256px + JPEG 0.78
// Target output: ~15-25 KB (aman untuk Google Sheets 50k char limit)
// Crop ke square (1:1) supaya avatar nggak gepeng/terdistorsi
function _compressAvatar(file){
  return new Promise((resolve, reject) => {
    if(!file || !file.type || !file.type.startsWith('image/')){
      return reject(new Error('File bukan gambar'));
    }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        try {
          const SIZE = 256; // target 256x256 pixel — cukup sharp untuk avatar
          const srcW = img.naturalWidth, srcH = img.naturalHeight;
          // Crop tengah jadi square
          const minDim = Math.min(srcW, srcH);
          const sx = (srcW - minDim) / 2;
          const sy = (srcH - minDim) / 2;
          const canvas = document.createElement('canvas');
          canvas.width = SIZE; canvas.height = SIZE;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, SIZE, SIZE);
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, SIZE, SIZE);
          // Coba quality 0.78, kalau masih kegedean coba 0.6, lalu 0.45
          let dataUrl = canvas.toDataURL('image/jpeg', 0.78);
          if(dataUrl.length > 45000) dataUrl = canvas.toDataURL('image/jpeg', 0.6);
          if(dataUrl.length > 45000) dataUrl = canvas.toDataURL('image/jpeg', 0.45);
          if(dataUrl.length > 45000){
            // Last resort: resize 128px
            const c2 = document.createElement('canvas');
            c2.width = 128; c2.height = 128;
            const ctx2 = c2.getContext('2d');
            ctx2.fillStyle = '#FFFFFF';
            ctx2.fillRect(0, 0, 128, 128);
            ctx2.drawImage(img, sx, sy, minDim, minDim, 0, 0, 128, 128);
            dataUrl = c2.toDataURL('image/jpeg', 0.7);
          }
          resolve(dataUrl);
        } catch(err){ reject(err); }
      };
      img.onerror = () => reject(new Error('Gambar tidak bisa dimuat'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Gagal baca file'));
    reader.readAsDataURL(file);
  });
}

// Mini-map controller (lazy init, sekali)
let pryMiniMap = null;
function _initPryMiniMapOnce(){
  const el = document.getElementById('pry-minimap');
  if(!el || el._leaflet_id) return;
  if(typeof L === 'undefined' || typeof createMiniMap !== 'function') return;
  pryMiniMap = createMiniMap('pry-minimap', {
    center: [-6.5578, 107.8131], zoom: 12,
    onPick: (lat, lng) => {
      const lEl = document.getElementById('pry-lat'), gEl = document.getElementById('pry-lng');
      if(lEl){ lEl.value = lat.toFixed(7); lEl.classList.add('filled'); }
      if(gEl){ gEl.value = lng.toFixed(7); gEl.classList.add('filled'); }
      const fb = document.getElementById('smi-pry-fb');
      if(fb){ fb.className = 'smart-input-fb ok'; fb.innerHTML = `✓ Dari klik peta: <b>${lat.toFixed(6)}, ${lng.toFixed(6)}</b>`; }
    },
    onMove: (lat, lng) => {
      const lEl = document.getElementById('pry-lat'), gEl = document.getElementById('pry-lng');
      if(lEl){ lEl.value = lat.toFixed(7); lEl.classList.add('filled'); }
      if(gEl){ gEl.value = lng.toFixed(7); gEl.classList.add('filled'); }
    }
  });
  // Ref markers: proyek existing sebagai latar (abu-abu)
  if(pryMiniMap && Array.isArray(PROYEK_LIST)){
    pryMiniMap.addReferences(
      PROYEK_LIST.filter(p => !isNaN(p.lat) && !isNaN(p.lng))
                 .map(p => ({lat: p.lat, lng: p.lng, label: p.nama, color: '#9CA3AF'}))
    );
  }
}

// Wire smart-input (sekali)
let _smartInputWiredPry = false;
function _wirePrySmartInputOnce(){
  if(_smartInputWiredPry) return;
  if(typeof wireSmartInput !== 'function') return;
  _smartInputWiredPry = true;
  wireSmartInput({
    inputId: 'smi-pry-input', btnId: 'smi-pry-btn', fbId: 'smi-pry-fb',
    helpBtnId: 'smi-pry-helpbtn', helpBoxId: 'smi-pry-help',
    latFieldId: 'pry-lat', lngFieldId: 'pry-lng',
    onPick: (lat, lng) => { if(pryMiniMap) pryMiniMap.setPin(lat, lng); }
  });
}

// Dipanggil dari openProyekModal/editProyek — reset/isi state foto & mini-map
function _prepPryModalExtras(foto, lat, lng){
  _pryFotoState = foto || '';
  _renderPryFotoPreview();
  const urlRow = document.getElementById('pry-foto-url-row');
  if(urlRow) urlRow.classList.remove('open');
  const status = document.getElementById('pry-foto-status');
  if(status){ status.className = 'pry-photo-status'; status.textContent = '📁 Upload file (auto-compress 600px) ATAU 🔗 paste link Google Drive (resolusi penuh, direkomendasi)'; }
  // Smart-input feedback reset
  const smInp = document.getElementById('smi-pry-input');
  const smFb = document.getElementById('smi-pry-fb');
  if(smInp) smInp.value = '';
  if(smFb){ smFb.className = 'smart-input-fb'; smFb.innerHTML = ''; }
  // Mini-map — delay biar modal sudah visible (Leaflet butuh ukuran container)
  setTimeout(() => {
    _initPryMiniMapOnce();
    _wirePrySmartInputOnce();
    if(pryMiniMap){
      // Refresh referensi (proyek lain) tiap buka modal
      pryMiniMap.addReferences(
        PROYEK_LIST.filter(p => !isNaN(p.lat) && !isNaN(p.lng) && p.id !== (document.getElementById('pry-edit-id').value||''))
                   .map(p => ({lat: p.lat, lng: p.lng, label: p.nama, color: '#9CA3AF'}))
      );
      if(!isNaN(lat) && !isNaN(lng) && lat !== '' && lng !== ''){
        pryMiniMap.setPin(parseFloat(lat), parseFloat(lng));
      } else {
        pryMiniMap.clearPin();
        pryMiniMap.focus(-6.5578, 107.8131, 12);
      }
      pryMiniMap.invalidateSize();
    }
  }, 150);
}

// Sync ke Google Sheets — ikut pattern syncAccountsToSheets (v10)
async function syncProyekToSheets(){
  if(typeof USE_SHEETS === 'undefined' || !USE_SHEETS) return;
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {'Content-Type':'text/plain'},
      body: gasPost({action: 'saveProyek', data: PROYEK_LIST})
    });
  } catch(e){ console.warn('Sync proyek failed', e); }
}

async function loadProyekFromSheets(){
  if(typeof USE_SHEETS === 'undefined' || !USE_SHEETS) return false;
  try {
    const r = await fetch(gasGet('getProyek')).then(res => res.json());
    if(r && r.success && Array.isArray(r.data) && r.data.length > 0){
      PROYEK_LIST = r.data.map(p => ({
        id: String(p.id || '').trim(),
        nama: p.nama || '',
        kode: (p.kode || '').toString().toUpperCase(),
        area: p.area || '',
        tipe: p.tipe || 'Mix-use',
        unit: parseInt(p.unit) || 0,
        lat: parseFloat(p.lat) || 0,
        lng: parseFloat(p.lng) || 0,
        developer: p.developer || '',
        ikon: p.ikon || '🏘️',
        warna: p.warna || '#3B82F6',
        status: p.status || 'Aktif',
        deskripsi: p.deskripsi || '',
        foto: p.foto || ''
      })).filter(p => p.id && p.nama);
      if(PROYEK_LIST.length > 0){
        saveProyekLocal();
        return true;
      }
    }
  } catch(e){ console.warn('Load proyek from sheets failed', e); }
  return false;
}

// ============================================================
// TIM BM4 RENDERING
// ============================================================
function renderTim(){
  const grid = document.getElementById('tim-grid');
  if(!grid) return;
  grid.innerHTML = '';
  accounts.forEach((a, idx) => {
    const card = document.createElement('div');
    card.className = 'tim-card';
    // [v10 CONTROL] Visual indicator kalau akun di-suspend
    if(a.suspended) card.style.opacity = '0.55';
    const initial = (a.nama || a.username || '?').charAt(0).toUpperCase();
    // [v9 SECURITY] Pakai renderFotoHtml untuk validasi URL foto
    const avatarHtml = a.foto ? renderFotoHtml(a.foto, escapeHtml(a.nama||''), initial) : initial;
    const aksesHtml = (a.akses || []).map(k => `<span class="tim-access-chip">${escapeHtml(k)}</span>`).join('');
    const bioPreview = a.bio ? `<div style="font-size:11px;color:var(--muted);font-style:italic;padding:6px 9px;background:#FAFAF8;border-radius:6px;border-left:2px solid var(--accent);margin-bottom:8px;">"${escapeHtml(a.bio)}"</div>` : '';
    const suspendedBadge = a.suspended
      ? `<span style="background:#FEE2E2;color:#B91C1C;font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:6px;letter-spacing:0.4px;">⛔ NONAKTIF</span>`
      : '';
    const usernameEsc = escapeHtml(a.username).replace(/'/g,"\\'");
    const isSelf = a.username === currentUser?.username;
    card.innerHTML = `
      <div class="tim-card-head">
        <div class="tim-avatar-wrap">
          <div class="tim-avatar">${avatarHtml}</div>
          <button class="tim-avatar-edit-btn" onclick="bmEditPhoto('${usernameEsc}')" title="Ganti foto">📷</button>
        </div>
        <div style="flex:1;min-width:0;">
          <div class="tim-info-name">${escapeHtml(a.nama || a.username)}${suspendedBadge}</div>
          <div class="tim-info-jabatan">${escapeHtml(a.jabatan || '-')}</div>
          <span class="tim-role-badge ${roleBadgeClass(a.role)}">${roleLabel(a.role)}</span>
        </div>
      </div>
      ${bioPreview}
      <div class="tim-details">
        <div class="tim-detail-row"><span class="tim-detail-lbl">Username:</span><span class="tim-detail-val">${escapeHtml(a.username)}</span></div>
        <div class="tim-detail-row">
          <span class="tim-detail-lbl">Password:</span>
          <span class="tim-detail-val">
            <span style="color:var(--faint);font-size:10px;font-style:italic;">🔒 Terenkripsi</span>
            <button class="tim-pw-toggle" onclick="bmResetPassword('${usernameEsc}')">🔑 Reset</button>
          </span>
        </div>
        <div style="margin-top:6px;"><div class="tim-detail-lbl" style="font-size:10px;">Akses:</div><div class="tim-access-list">${aksesHtml||'<span style="font-size:10px;color:var(--faint);">—</span>'}</div></div>
      </div>

      <!-- [v10 CONTROL] Panel kontrol BM -->
      <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #E2E8F0;display:flex;flex-wrap:wrap;gap:6px;">
        <button onclick="bmShowAuditPerUser('${usernameEsc}')" style="flex:1;min-width:80px;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:6px;padding:6px 10px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;">📊 Audit</button>
        ${isSelf ? '' : `<button onclick="bmForceLogout('${usernameEsc}')" style="flex:1;min-width:80px;background:#FFF7ED;color:#C2410C;border:1px solid #FED7AA;border-radius:6px;padding:6px 10px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;" title="Paksa user keluar dari sesinya">🚪 Force Logout</button>`}
        ${isSelf ? '' : `<button onclick="bmToggleSuspend('${usernameEsc}')" style="flex:1;min-width:80px;background:${a.suspended ? '#ECFDF5' : '#FEF2F2'};color:${a.suspended ? '#15803D' : '#B91C1C'};border:1px solid ${a.suspended ? '#A7F3D0' : '#FECACA'};border-radius:6px;padding:6px 10px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;">${a.suspended ? '✓ Aktifkan' : '⛔ Nonaktifkan'}</button>`}
      </div>

      <div class="tim-actions">
        <button class="tim-btn-edit" onclick="openAccModal('edit','${usernameEsc}')">✏️ Edit</button>
        ${a.role==='bm' && accounts.filter(x=>x.role==='bm').length<=1 ? '' : `<button class="tim-btn-del" onclick="deleteAccount('${usernameEsc}')">🗑</button>`}
      </div>
    `;
    grid.appendChild(card);
  });
  renderMonitorStats();
  populateLogFilterUsers();
  renderLogList();
}

// BM edit photo langsung (upload foto ke user lain)
function bmEditPhoto(username){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (event) => {
    const file = event.target.files[0];
    if(!file) return;
    // [v9 SECURITY] Validasi MIME type
    if(!file.type || !file.type.startsWith('image/')){
      showToast('⚠ File harus berupa gambar'); return;
    }
    if(file.size > 10 * 1024 * 1024){ showToast('⚠ Ukuran foto maksimal 10MB'); return; }
    showToast('⚙️ Memproses foto...');
    _compressAvatar(file).then(dataUrl => {
      if(!dataUrl.startsWith('data:image/')){ showToast('⚠ File tidak valid'); return; }
      const sizeKB = Math.round((dataUrl.length * 0.75) / 1024);
      const idx = accounts.findIndex(a => a.username === username);
      if(idx >= 0){
        accounts[idx].foto = dataUrl;
        if(currentUser?.username === username){
          currentUser.foto = dataUrl;
          document.getElementById('tb-profile-avatar').innerHTML = `<img src="${dataUrl}" alt="">`;
        }
        saveAccountsLocal();
        syncAccountsToSheets();
        logActivity(currentUser.username, 'ganti foto', `BM mengubah foto akun: ${username} (${sizeKB}KB)`);
        renderTim();
        showToast(`✓ Foto ${username} diperbarui (${sizeKB}KB)`);
      }
    }).catch(err => {
      console.error('Compress avatar error:', err);
      showToast('⚠️ Gagal memproses foto: ' + err.message);
    });
  };
  input.click();
}

// [v10 CONTROL] Reset password dengan menampilkan password baru sekali (copy-able).
// User wajib login dengan password ini lalu ganti ke password pilihannya sendiri.
async function bmResetPassword(username){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const acc = findAccount(username);
  if(!acc){ showToast('⚠ Akun tidak ditemukan'); return; }

  // Generate password acak yang mudah dibaca (8 karakter, mix huruf+angka, tanpa simbol membingungkan)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let newPw = '';
  for(let i = 0; i < 10; i++){
    newPw += chars[Math.floor(Math.random() * chars.length)];
  }

  if(!confirm(`Reset password untuk "${username}"?\n\nPassword baru akan di-generate otomatis dan ditampilkan SEKALI. Catat atau kirim ke user yang bersangkutan.`)) return;

  const hashed = await hashPassword(newPw);
  const idx = accounts.findIndex(a => a.username === username);
  if(idx < 0) return;

  accounts[idx].password = hashed;
  // Force logout user tersebut karena password berubah
  accounts[idx].sessionValidFrom = Date.now();
  if(currentUser.username === username) currentUser.password = hashed;
  saveAccountsLocal();
  syncAccountsToSheets();
  logActivity(currentUser.username, 'reset password', `Reset password akun: ${username}`);

  // Tampilkan modal dengan password baru (sekali saja)
  showResetPasswordModal(username, newPw);
  renderTim();
}

// [v10 CONTROL] Modal untuk menampilkan password baru setelah reset (sekali saja)
function showResetPasswordModal(username, newPw){
  // Buat modal ad-hoc — tidak perlu predefined HTML
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:white;border-radius:14px;padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
      <div style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:6px;">🔑 Password Baru</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:18px;line-height:1.5;">Password baru untuk <b>${escapeHtml(username)}</b>. <b style="color:#DC2626;">Catat atau salin sekarang</b> — tidak akan ditampilkan lagi.</div>
      <div style="background:#F1F5F9;border:2px dashed #CBD5E1;border-radius:10px;padding:16px;text-align:center;margin-bottom:16px;">
        <div id="reset-pw-value" style="font-family:'DM Mono',monospace;font-size:22px;font-weight:700;letter-spacing:2px;color:#0F172A;user-select:all;">${escapeHtml(newPw)}</div>
      </div>
      <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:11px;color:#92400E;line-height:1.5;">
        ℹ️ User harus login dengan password ini lalu segera mengganti ke password pilihannya sendiri di menu Settings.
      </div>
      <div style="display:flex;gap:8px;">
        <button id="reset-pw-copy" style="flex:1;background:var(--accent);color:white;border:none;border-radius:8px;padding:11px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;">📋 Salin ke Clipboard</button>
        <button id="reset-pw-close" style="background:#E2E8F0;color:var(--text);border:none;border-radius:8px;padding:11px 20px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;">Tutup</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('reset-pw-copy').onclick = () => {
    navigator.clipboard?.writeText(newPw).then(() => {
      showToast('✓ Password disalin');
    }).catch(() => {
      // Fallback: select text
      const el = document.getElementById('reset-pw-value');
      const range = document.createRange();
      range.selectNode(el);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      showToast('⚠ Salin manual dari kotak');
    });
  };
  document.getElementById('reset-pw-close').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
}

// [v10 CONTROL] Toggle suspend akun
function bmToggleSuspend(username){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const idx = accounts.findIndex(a => a.username === username);
  if(idx < 0) return;
  const acc = accounts[idx];

  // Proteksi: tidak bisa suspend diri sendiri
  if(acc.username === currentUser.username){
    showToast('⚠ Tidak bisa suspend akun sendiri'); return;
  }
  // Proteksi: tidak bisa suspend BM terakhir
  if(acc.role === 'bm' && !acc.suspended){
    const activeBM = accounts.filter(a => a.role === 'bm' && !a.suspended).length;
    if(activeBM <= 1){ showToast('⚠ Minimal harus ada 1 BM aktif'); return; }
  }

  const willSuspend = !acc.suspended;
  const confirmMsg = willSuspend
    ? `Nonaktifkan akun "${username}"?\n\nUser ini tidak akan bisa login sampai diaktifkan kembali. Sesi aktifnya juga akan dihentikan.`
    : `Aktifkan kembali akun "${username}"?`;
  if(!confirm(confirmMsg)) return;

  acc.suspended = willSuspend;
  if(willSuspend){
    // Force logout user yang lagi aktif
    acc.sessionValidFrom = Date.now();
  }
  saveAccountsLocal();
  syncAccountsToSheets();
  logActivity(currentUser.username, willSuspend ? 'suspend akun' : 'aktifkan akun', `${willSuspend ? 'Menonaktifkan' : 'Mengaktifkan'} akun: ${username}`);
  showToast(willSuspend ? `⛔ Akun ${username} dinonaktifkan` : `✓ Akun ${username} diaktifkan`);
  renderTim();
}

// [v10 CONTROL] Force logout user (tanpa suspend)
function bmForceLogout(username){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const idx = accounts.findIndex(a => a.username === username);
  if(idx < 0) return;
  if(accounts[idx].username === currentUser.username){
    showToast('⚠ Tidak bisa force logout diri sendiri. Gunakan tombol Keluar.'); return;
  }
  if(!confirm(`Paksa logout "${username}"?\n\nUser akan otomatis keluar pada aktivitas berikutnya (biasanya dalam beberapa detik).`)) return;

  accounts[idx].sessionValidFrom = Date.now();
  saveAccountsLocal();
  syncAccountsToSheets();
  logActivity(currentUser.username, 'force logout', `Paksa logout akun: ${username}`);
  showToast(`🚪 ${username} akan logout otomatis`);
  renderTim();
}

// [v10 CONTROL] Tampilkan modal audit per-akun (semua aktivitas user tsb)
function bmShowAuditPerUser(username){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const userLogs = accountLogs.filter(l => l.username === username);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';

  const logsHtml = userLogs.length === 0
    ? '<div style="padding:40px 20px;text-align:center;color:var(--muted);font-size:12px;font-style:italic;">Belum ada aktivitas tercatat untuk user ini.</div>'
    : userLogs.slice(0, 100).map(l => {
        const t = new Date(l.timestamp);
        const timeStr = t.toLocaleDateString('id',{day:'2-digit',month:'short',year:'2-digit'}) + ' ' + t.toLocaleTimeString('id',{hour:'2-digit',minute:'2-digit'});
        const action = (l.action || '').toLowerCase();
        let color = '#64748B';
        if(action === 'login') color = '#059669';
        else if(action === 'logout') color = '#64748B';
        else if(action.includes('ditolak') || action.includes('suspend') || action.includes('hapus')) color = '#DC2626';
        else if(action.includes('edit') || action.includes('ganti') || action.includes('reset') || action.includes('force')) color = '#D97706';
        return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 12px;border-bottom:1px solid #F1F5F9;gap:10px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">${escapeHtml(l.action)}</div>
            <div style="font-size:11px;color:var(--muted);line-height:1.4;">${escapeHtml(l.detail || '-')}</div>
          </div>
          <div style="font-size:10px;color:var(--faint);white-space:nowrap;font-family:'DM Mono',monospace;">${timeStr}</div>
        </div>`;
      }).join('');

  overlay.innerHTML = `
    <div style="background:white;border-radius:14px;max-width:520px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
      <div style="padding:20px 24px;border-bottom:1px solid #F1F5F9;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--text);">📊 Audit Aktivitas</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">User: <b>${escapeHtml(username)}</b> · ${userLogs.length} aktivitas</div>
        </div>
        <button id="audit-close" style="background:transparent;border:none;font-size:20px;cursor:pointer;color:var(--muted);padding:4px 8px;">✕</button>
      </div>
      <div style="flex:1;overflow-y:auto;">
        ${logsHtml}
      </div>
      <div style="padding:12px 20px;border-top:1px solid #F1F5F9;font-size:10px;color:var(--faint);text-align:center;">
        Menampilkan maks 100 aktivitas terbaru
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('audit-close').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
}

function renderLogList(){
  const list = document.getElementById('tim-log-list');
  if(!list) return;
  const filterUser = document.getElementById('monitor-filter-user')?.value || '';
  const filterAction = document.getElementById('monitor-filter-action')?.value || '';
  const filterRange = document.getElementById('monitor-filter-range')?.value || 'all';

  let filtered = [...accountLogs];
  if(filterUser) filtered = filtered.filter(l => l.username === filterUser);
  if(filterAction) filtered = filtered.filter(l => (l.action||'').toLowerCase() === filterAction.toLowerCase());
  if(filterRange !== 'all'){
    const now = new Date();
    let cutoff;
    if(filterRange === 'today'){
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if(filterRange === '7d'){
      cutoff = new Date(now.getTime() - 7*24*60*60*1000);
    } else if(filterRange === '30d'){
      cutoff = new Date(now.getTime() - 30*24*60*60*1000);
    }
    filtered = filtered.filter(l => new Date(l.timestamp) >= cutoff);
  }

  if(filtered.length === 0){
    list.innerHTML = '<div class="monitor-empty-state">Tidak ada aktivitas sesuai filter.</div>';
    return;
  }
  list.innerHTML = filtered.slice(0, 100).map(l => {
    const t = new Date(l.timestamp);
    const timeStr = t.toLocaleDateString('id',{day:'2-digit',month:'short',year:'2-digit'})+' '+t.toLocaleTimeString('id',{hour:'2-digit',minute:'2-digit'});
    const action = (l.action||'').toLowerCase();
    let badgeClass = 'badge-edit';
    if(action === 'login') badgeClass = 'badge-login';
    else if(action === 'logout') badgeClass = 'badge-logout';
    else if(action === 'tambah akun') badgeClass = 'badge-tambah';
    else if(action === 'hapus akun') badgeClass = 'badge-hapus';
    else if(action === 'ganti password') badgeClass = 'badge-password';
    else if(action === 'ganti foto') badgeClass = 'badge-foto';
    else if(action === 'ganti bio') badgeClass = 'badge-bio';
    return `<div class="tim-log-item"><div class="tim-log-text"><span class="monitor-action-badge ${badgeClass}">${escapeHtml(l.action)}</span><b>${escapeHtml(l.username)}</b>${l.detail?' — '+escapeHtml(l.detail):''}</div><div class="tim-log-time">${timeStr}</div></div>`;
  }).join('');
}

function renderMonitorStats(){
  const container = document.getElementById('monitor-stats');
  if(!container) return;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekAgo = new Date(today.getTime() - 7*24*60*60*1000);

  const totalLogs = accountLogs.length;
  const todayLogs = accountLogs.filter(l => new Date(l.timestamp) >= todayStart).length;
  const loginsToday = accountLogs.filter(l => new Date(l.timestamp) >= todayStart && (l.action||'').toLowerCase() === 'login').length;
  const activeUsers = new Set(accountLogs.filter(l => new Date(l.timestamp) >= weekAgo).map(l => l.username)).size;

  container.innerHTML = `
    <div class="monitor-stat"><div class="monitor-stat-val">${totalLogs}</div><div class="monitor-stat-lbl">Total Aktivitas</div></div>
    <div class="monitor-stat"><div class="monitor-stat-val">${todayLogs}</div><div class="monitor-stat-lbl">Aktivitas Hari Ini</div></div>
    <div class="monitor-stat"><div class="monitor-stat-val">${loginsToday}</div><div class="monitor-stat-lbl">Login Hari Ini</div></div>
    <div class="monitor-stat"><div class="monitor-stat-val">${activeUsers}</div><div class="monitor-stat-lbl">User Aktif 7 Hari</div></div>
  `;
}

function populateLogFilterUsers(){
  const sel = document.getElementById('monitor-filter-user');
  if(!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">👤 Semua User</option>' +
    accounts.map(a => `<option value="${escapeHtml(a.username)}">${escapeHtml(a.nama || a.username)}</option>`).join('');
  sel.value = prev;
}

function exportLogCSV(){
  if(accountLogs.length === 0){ showToast('⚠ Belum ada log untuk diekspor'); return; }
  const header = 'Timestamp,Username,Action,Detail\n';
  const rows = accountLogs.map(l => {
    const detail = (l.detail||'').replace(/"/g,'""');
    return `"${l.timestamp}","${l.username}","${l.action}","${detail}"`;
  }).join('\n');
  const csv = header + rows;
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bm4_aktivitas_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Log berhasil diexport');
}

// ============================================================
// GALERI TIM RENDERING (v11 — Premium Elegan)
// ============================================================

// Bank kutipan properti / sales / motivasi kerja
const GALERI_QUOTES = [
  "Properti terbaik bukan yang termahal, tapi yang paling dicari.",
  "Setiap closing adalah cerita baru yang layak dirayakan.",
  "Lokasi bisa dihitung, tapi kepercayaan harus dibangun.",
  "Pasar tidak pernah tidur — yang tidur hanyalah kesempatan yang terlewat.",
  "Target bukan beban, target adalah undangan untuk bertumbuh.",
  "Hari ini satu langkah kecil, bulan depan satu penjualan besar.",
  "Rumah bukan hanya bangunan, tapi masa depan yang sedang dicicil.",
  "Kompetitor mengajari kita apa yang harus dilakukan lebih baik.",
  "Data berbicara, tapi intuisi yang menutup deal.",
  "Peta tanpa arah hanyalah gambar — strategi yang membuatnya bernilai.",
  "Senyum pertama menentukan kunjungan kedua.",
  "Yang membedakan kita bukan produk, tapi cara kita hadir.",
  "Negosiasi terbaik adalah ketika kedua pihak pulang tersenyum.",
  "Pelanggan membeli kenyamanan, bukan material bangunan.",
  "Konsistensi mengalahkan intensitas — setiap hari, setiap kali.",
  "Satu tim yang solid lebih kuat dari sepuluh bintang individu.",
  "Kerja keras itu wajib, kerja cerdas itu pilihan, kerja tuntas itu karakter.",
  "Mimpi besar dimulai dari langkah kecil yang dilakukan hari ini.",
  "Branch manager bukan jabatan, tapi tanggung jawab membawa tim naik.",
  "Peluang sering datang dalam bentuk pekerjaan yang tidak nyaman.",
  "Kegagalan hari ini adalah brief untuk kemenangan besok.",
  "Kolega hebat tidak dilahirkan — mereka dibentuk oleh kepercayaan.",
  "Jangan jual rumah, jual kehidupan di dalamnya.",
  "Setiap prospek layak diperlakukan seperti closing.",
  "Integritas lebih mahal dari komisi tertinggi sekalipun.",
  "Kalau mudah, semua orang akan melakukannya. Kalau sulit, kamulah yang dicari.",
  "Peta lokasi memberitahu di mana, tim yang hebat memberitahu mengapa.",
  "Hasil besar adalah akumulasi dari tindakan kecil yang tepat.",
  "Menang hari ini dimulai dari persiapan tadi malam.",
  "Kalau bukan sekarang, kapan lagi? Kalau bukan kita, siapa lagi?"
];

// Ambil kutipan random (opsional: kecualikan satu index)
function randomQuote(exclude){
  let idx;
  do { idx = Math.floor(Math.random() * GALERI_QUOTES.length); }
  while(idx === exclude && GALERI_QUOTES.length > 1);
  return { idx: idx, text: GALERI_QUOTES[idx] };
}

// Kutipan harian - seed pakai tanggal supaya satu hari sama untuk semua user
function dailyQuote(){
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth()+1) * 100 + d.getDate();
  const idx = seed % GALERI_QUOTES.length;
  return GALERI_QUOTES[idx];
}

// State untuk modal - simpan data user yang sedang dibuka
let gmodalCurrentUser = null;
let gmodalCurrentQuoteIdx = -1;

function renderGaleri(){
  const grid = document.getElementById('galeri-grid');
  if(!grid) return;
  grid.innerHTML = '';

  // Set kata hari ini
  const dailyEl = document.getElementById('galeri-daily-text');
  if(dailyEl) dailyEl.textContent = '"' + dailyQuote() + '"';

  accounts.forEach((a, idx) => {
    const card = document.createElement('div');
    card.className = 'galeri-card';
    const initial = (a.nama || a.username || '?').charAt(0).toUpperCase();
    const role = a.role || 'sales';
    const photoInner = a.foto
      ? renderFotoHtml(a.foto, escapeHtml(a.nama || ''))
      : `<div class="galeri-card-initial">${initial}</div>`;
    const bioHtml = a.bio
      ? `<div class="galeri-card-bio">"${escapeHtml(a.bio)}"</div>`
      : `<div class="galeri-card-bio empty">— Belum ada kata motivasi —</div>`;

    card.innerHTML = `
      <div class="galeri-card-photo ${role}">
        ${photoInner}
        <div class="galeri-card-badge ${role}">${roleLabel(role)}</div>
        <div class="galeri-card-hint">✦ Klik untuk kata hari ini</div>
      </div>
      <div class="galeri-card-body">
        <div class="galeri-card-name">${escapeHtml(a.nama || a.username)}</div>
        <div class="galeri-card-jabatan">${escapeHtml(a.jabatan || '-')}</div>
        <div class="galeri-card-divider"></div>
        ${bioHtml}
      </div>
    `;
    card.onclick = () => openGmodal(a.username);
    grid.appendChild(card);

    // Animasi masuk bertahap
    setTimeout(() => card.classList.add('show'), 60 * idx);
  });
}

// Buka modal dengan kutipan random
function openGmodal(username){
  const a = findAccount(username);
  if(!a) return;
  gmodalCurrentUser = a;

  const role = a.role || 'sales';
  const initial = (a.nama || a.username || '?').charAt(0).toUpperCase();
  const photoEl = document.getElementById('gmodal-photo');
  photoEl.className = 'gmodal-photo ' + role;
  // [v9 SECURITY] Pakai safeFotoSrc untuk validasi data URL/URL
  const safeFoto = safeFotoSrc(a.foto);
  const photoInner = safeFoto
    ? `<img src="${safeFoto}" alt="">`
    : `<div class="gmodal-photo-initial">${initial}</div>`;
  photoEl.innerHTML = photoInner + '<button class="gmodal-close" onclick="closeGmodal()">✕</button>';

  document.getElementById('gmodal-name').textContent = a.nama || a.username;
  document.getElementById('gmodal-jabatan').textContent = a.jabatan || '-';

  const q = randomQuote(-1);
  gmodalCurrentQuoteIdx = q.idx;
  document.getElementById('gmodal-quote').textContent = q.text;

  const bioEl = document.getElementById('gmodal-bio');
  if(a.bio){
    bioEl.className = 'gmodal-bio';
    bioEl.textContent = '— ' + a.bio;
  } else {
    bioEl.className = 'gmodal-bio empty';
    bioEl.textContent = '';
  }

  document.getElementById('gmodal-backdrop').classList.add('show');
}

// Ganti kutipan tanpa menutup modal
function refreshGmodalQuote(){
  const q = randomQuote(gmodalCurrentQuoteIdx);
  gmodalCurrentQuoteIdx = q.idx;
  const el = document.getElementById('gmodal-quote');
  // Efek fade cepat
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = q.text;
    el.style.opacity = '1';
  }, 150);
}

function closeGmodal(e){
  if(e && e.target && !e.target.classList.contains('gmodal-backdrop')) return;
  document.getElementById('gmodal-backdrop').classList.remove('show');
  gmodalCurrentUser = null;
}

// Tutup modal dengan tombol ESC
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape'){
    const m = document.getElementById('gmodal-backdrop');
    if(m && m.classList.contains('show')) closeGmodal();
  }
});

// ============================================================
// BIO HELPERS
// ============================================================
function updateBioCounter(inputId, counterId){
  const input = document.getElementById(inputId);
  const counter = document.getElementById(counterId);
  if(!input || !counter) return;
  const len = input.value.length;
  counter.textContent = `${len} / 150`;
  counter.style.color = len > 140 ? '#DC2626' : 'var(--faint)';
}

function saveBioChange(){
  if(!currentUser) return;
  const newBio = document.getElementById('set-bio').value.trim();
  if(newBio.length > 150){ showToast('⚠ Bio maksimal 150 karakter'); return; }
  const idx = accounts.findIndex(a => a.username === currentUser.username);
  if(idx >= 0){
    accounts[idx].bio = newBio;
    currentUser.bio = newBio;
    saveAccountsLocal();
    syncAccountsToSheets();
    logActivity(currentUser.username, 'ganti bio', 'User mengubah bio/motivasi');
    showToast('✓ Bio berhasil disimpan');
  }
}


// ─── SAFE FOTO HELPER (XSS prevention) ───────────────────
function safeFotoSrc(url){
  if(!url) return '';
  const s = String(url).trim();
  if(s.startsWith('data:image/')) return s;
  if(/^https?:\/\//i.test(s)) return s;
  return '';
}
function renderFotoHtml(url, alt, fallback){
  const src = safeFotoSrc(url);
  return src ? `<img src="${src}" alt="${alt||''}">` : (fallback || '');
}
// ──────────────────────────────────────────────────────────

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============================================================
// MODAL TAMBAH/EDIT AKUN
// ============================================================
function openAccModal(mode, username){
  editingAccUsername = null;
  document.getElementById('acc-modal-title').textContent = mode === 'edit' ? 'Edit Akun' : 'Tambah Akun Baru';
  // Reset form
  document.getElementById('acc-username').value = '';
  document.getElementById('acc-password').value = '';
  document.getElementById('acc-nama').value = '';
  document.getElementById('acc-jabatan').value = '';
  document.getElementById('acc-bio').value = '';
  document.getElementById('acc-role').value = 'sales';
  updateBioCounter('acc-bio','acc-bio-counter');
  document.querySelectorAll('#acc-access-grid input').forEach(cb => {
    cb.checked = cb.value === 'dashboard';
  });

  if(mode === 'edit' && username){
    const a = findAccount(username);
    if(a){
      editingAccUsername = a.username;
      document.getElementById('acc-username').value = a.username;
      // [v9 SECURITY] Password field kosong saat edit — pengisian opsional.
      // Kosongkan = password tidak berubah; Isi = ganti ke password baru.
      document.getElementById('acc-password').value = '';
      document.getElementById('acc-password').placeholder = 'Kosongkan jika tidak ingin ganti password';
      document.getElementById('acc-nama').value = a.nama || '';
      document.getElementById('acc-jabatan').value = a.jabatan || '';
      document.getElementById('acc-bio').value = a.bio || '';
      document.getElementById('acc-role').value = a.role || 'sales';
      updateBioCounter('acc-bio','acc-bio-counter');
      document.querySelectorAll('#acc-access-grid input').forEach(cb => {
        cb.checked = (a.akses || []).includes(cb.value) || cb.value === 'dashboard';
      });
    }
  } else {
    document.getElementById('acc-password').placeholder = 'Minimal 8 karakter';
    onRoleChange(); // set checkbox default sesuai role
  }
  document.getElementById('acc-modal').classList.add('open');
}

function closeAccModal(){
  document.getElementById('acc-modal').classList.remove('open');
  editingAccUsername = null;
}

function onRoleChange(){
  const role = document.getElementById('acc-role').value;
  const preset = {
    bm:['dashboard','analisa','strategi','sales','konstruksi','legal','finance'],
    sales:['dashboard','sales'],
    strategi:['dashboard','strategi'],
    konstruksi:['dashboard','konstruksi'],
    legal:['dashboard','legal'],
    finance:['dashboard','finance']
  }[role] || ['dashboard'];
  document.querySelectorAll('#acc-access-grid input').forEach(cb => {
    cb.checked = preset.includes(cb.value);
  });
}

async function saveAccount(){
  const username = document.getElementById('acc-username').value.trim().toLowerCase();
  const password = document.getElementById('acc-password').value;
  const nama = document.getElementById('acc-nama').value.trim();
  const jabatan = document.getElementById('acc-jabatan').value.trim();
  const bio = document.getElementById('acc-bio').value.trim();
  const role = document.getElementById('acc-role').value;
  const akses = Array.from(document.querySelectorAll('#acc-access-grid input:checked')).map(cb => cb.value);

  if(!username){ showToast('⚠ Username wajib diisi'); return; }
  // [v9 SECURITY] Saat edit, password kosong = tidak ganti. Saat tambah, wajib min 8.
  if(!editingAccUsername){
    if(!password || password.length < 8){ showToast('⚠ Password minimal 8 karakter'); return; }
  } else {
    if(password && password.length < 8){ showToast('⚠ Password baru minimal 8 karakter (atau kosongkan untuk tidak ganti)'); return; }
  }
  if(!nama){ showToast('⚠ Nama wajib diisi'); return; }
  if(bio.length > 150){ showToast('⚠ Bio maksimal 150 karakter'); return; }

  // Cek duplikat username (kecuali saat edit username yang sama)
  if(editingAccUsername !== username){
    if(accounts.some(a => a.username.toLowerCase() === username)){
      showToast('⚠ Username sudah dipakai'); return;
    }
  }

  // [v9 SECURITY] Tentukan password final:
  // - Tambah akun: hash password baru
  // - Edit akun, field password kosong: pakai password lama apa adanya
  // - Edit akun, field password diisi: hash password baru
  let finalPassword;
  if(editingAccUsername){
    const old = accounts.find(a => a.username === editingAccUsername);
    if(!password){
      finalPassword = old ? old.password : '';
    } else {
      finalPassword = await hashPassword(password);
    }
  } else {
    finalPassword = await hashPassword(password);
  }

  if(editingAccUsername){
    const idx = accounts.findIndex(a => a.username === editingAccUsername);
    if(idx >= 0){
      const old = accounts[idx];
      accounts[idx] = {...old, username, password: finalPassword, nama, jabatan, bio, role, akses};
      logActivity(currentUser?.username || 'system', 'edit akun', `Mengubah akun: ${username}`);
      showToast('✓ Akun diperbarui');
    }
  } else {
    accounts.push({username, password: finalPassword, nama, jabatan, bio, role, akses, foto:''});
    logActivity(currentUser?.username || 'system', 'tambah akun', `Akun baru: ${username}`);
    showToast('✓ Akun ditambahkan');
  }

  saveAccountsLocal();
  syncAccountsToSheets();
  closeAccModal();
  renderTim();
}

function deleteAccount(username){
  if(!confirm('Hapus akun "'+username+'"?')) return;
  const idx = accounts.findIndex(a => a.username === username);
  if(idx < 0) return;
  if(accounts[idx].username === currentUser?.username){
    showToast('⚠ Tidak bisa menghapus akun sendiri'); return;
  }
  accounts.splice(idx, 1);
  logActivity(currentUser?.username || 'system', 'hapus akun', `Akun dihapus: ${username}`);
  saveAccountsLocal();
  // [v12.1 FIX] Sync ke Sheets + explicit soft delete (pakai no-cors)
  syncAccountsToSheets();
  if(USE_SHEETS){
    try{
      fetch(GAS_URL, {
        method:'POST',
        mode:'no-cors',
        headers:{'Content-Type':'text/plain'},
        body: gasPost({action:'deleteAccount', username:username})
      }).catch(e=>console.warn('Gagal soft-delete account:',e));
    }catch(e){}
  }
  renderTim();
  showToast('🗑 Akun dihapus');
}

// ============================================================
// PENGATURAN AKUN (untuk user sendiri)
// ============================================================
function openSettings(){
  if(!currentUser) return;
  const avEl = document.getElementById('settings-avatar');
  if(currentUser.foto){
    avEl.innerHTML = renderFotoHtml(currentUser.foto, '');
  } else {
    avEl.textContent = (currentUser.nama || currentUser.username || '?').charAt(0).toUpperCase();
  }
  document.getElementById('settings-name').textContent = currentUser.nama || currentUser.username;
  document.getElementById('settings-meta').textContent = (currentUser.jabatan||'') + ' · @' + currentUser.username;
  document.getElementById('set-bio').value = currentUser.bio || '';
  updateBioCounter('set-bio','set-bio-counter');
  document.getElementById('set-pw-old').value = '';
  document.getElementById('set-pw-new').value = '';
  document.getElementById('set-pw-new2').value = '';

  // [v11+] Formula Potensi Unit — hanya BM yang lihat
  const formulaSection=document.getElementById('settings-formula-section');
  if(formulaSection){
    if(currentUser.role==='bm'){
      formulaSection.style.display='block';
      document.getElementById('set-formula-pct').value=POTENSI_PCT;
      document.getElementById('set-formula-pct-disp').textContent=POTENSI_PCT;
      document.getElementById('set-formula-pct-disp2').textContent=POTENSI_PCT;
      document.getElementById('set-formula-sample').textContent=fmt(calcPotensiUnit(5000));
    } else {
      formulaSection.style.display='none';
    }
  }

  // [v9 SECURITY] Master Password section — hanya BM
  const masterpwSection = document.getElementById('settings-masterpw-section');
  if(masterpwSection){
    if(currentUser.role === 'bm'){
      masterpwSection.style.display = 'block';
      document.getElementById('set-masterpw-new').value = '';
      document.getElementById('set-masterpw-new2').value = '';
      refreshMasterPwStatus();
    } else {
      masterpwSection.style.display = 'none';
    }
  }

  // [v11 BACKUP] Backup & Restore section — hanya BM
  const backupSection = document.getElementById('settings-backup-section');
  if(backupSection){
    if(currentUser.role === 'bm'){
      backupSection.style.display = 'block';
      refreshBackupStatus();
    } else {
      backupSection.style.display = 'none';
    }
  }

  showScreen('s-settings');
}

// [v9 SECURITY] Master password UI helpers
function refreshMasterPwStatus(){
  const statusEl = document.getElementById('set-masterpw-status');
  if(!statusEl) return;
  const mpw = getMasterPassword();
  if(mpw){
    statusEl.style.background = '#ECFDF5';
    statusEl.style.borderColor = '#86EFAC';
    statusEl.style.color = '#15803D';
    statusEl.innerHTML = '✓ Status: <b>Sudah diset</b> — master login aktif';
  } else {
    statusEl.style.background = '#FEF2F2';
    statusEl.style.borderColor = '#FECACA';
    statusEl.style.color = '#B91C1C';
    statusEl.innerHTML = '⚠️ Status: <b>Belum diset</b> — fitur master login nonaktif';
  }
}
function saveMasterPassword(){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const n1 = document.getElementById('set-masterpw-new').value;
  const n2 = document.getElementById('set-masterpw-new2').value;
  if(!n1 || n1.length < 8){ showToast('⚠ Master password minimal 8 karakter'); return; }
  if(n1 !== n2){ showToast('⚠ Konfirmasi tidak cocok'); return; }
  if(setMasterPassword(n1)){
    logActivity(currentUser.username, 'ganti master pw', 'Master password diubah');
    document.getElementById('set-masterpw-new').value = '';
    document.getElementById('set-masterpw-new2').value = '';
    refreshMasterPwStatus();
    showToast('✓ Master password disimpan');
  } else {
    showToast('⚠ Gagal menyimpan master password');
  }
}
function clearMasterPassword(){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  if(!confirm('Hapus master password?\nFitur login tanpa username akan dinonaktifkan.')) return;
  try {
    localStorage.removeItem('bm4_master_pw');
    logActivity(currentUser.username, 'hapus master pw', 'Master password dihapus');
    refreshMasterPwStatus();
    showToast('🗑 Master password dihapus');
  } catch(e){ showToast('⚠ Gagal menghapus'); }
}

// ============================================================
// [v11 BACKUP] BACKUP & RESTORE SYSTEM
// ============================================================
const BACKUP_LAST_KEY = 'bm4_backup_last';
const BACKUP_VERSION = '1.0'; // untuk kompatibilitas jangka panjang

// Update panel backup: tampilkan tanggal backup terakhir + ringkasan data
function refreshBackupStatus(){
  const lastEl = document.getElementById('backup-last-date');
  const warnEl = document.getElementById('backup-warning');
  if(!lastEl) return;

  const last = localStorage.getItem(BACKUP_LAST_KEY);
  if(last){
    const d = new Date(last);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    const dateStr = formatTanggalID(last, 'short');
    const timeStr = d.toLocaleTimeString('id', {hour:'2-digit',minute:'2-digit'});
    let relative = '';
    if(diffDays === 0) relative = ' (hari ini)';
    else if(diffDays === 1) relative = ' (kemarin)';
    else if(diffDays < 30) relative = ` (${diffDays} hari lalu)`;
    else relative = ` (${Math.floor(diffDays/30)} bulan lalu)`;
    lastEl.textContent = `${dateStr}, ${timeStr}${relative}`;

    // Warning kalau >7 hari
    if(warnEl) warnEl.style.display = diffDays > 7 ? 'block' : 'none';
  } else {
    lastEl.textContent = 'Belum pernah';
    if(warnEl){
      warnEl.textContent = '⚠️ Belum ada backup. Disarankan backup sekarang sebagai langkah pencegahan.';
      warnEl.style.display = 'block';
    }
  }

  // Update ringkasan jumlah data
  const setCnt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  setCnt('backup-cnt-accounts', accounts.length);
  setCnt('backup-cnt-logs', accountLogs.length);
  setCnt('backup-cnt-perumahan', perumahan.length);
  setCnt('backup-cnt-poi', poi.length);
  setCnt('backup-cnt-tp', tpTargets.length);
}

// Build payload backup — kumpulkan semua data aplikasi
function buildBackupPayload(){
  return {
    _meta: {
      version: BACKUP_VERSION,
      appVersion: 'v11',
      exportedAt: new Date().toISOString(),
      exportedBy: currentUser?.username || 'unknown',
      note: 'BM4 Property Intelligence — backup lengkap. Jangan edit manual.'
    },
    accounts: accounts,
    accountLogs: accountLogs,
    perumahan: perumahan,
    poi: poi,
    tpTargets: tpTargets,
    formula: FORMULA,
    potensiPct: POTENSI_PCT,
    masterPwHash: localStorage.getItem('bm4_master_pw') || null,
  };
}

// Export: generate file JSON dan trigger download
function exportBackup(){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  try {
    const payload = buildBackupPayload();
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Naming file: bm4_backup_YYYY-MM-DD_HHMM.json
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    const filename = `bm4_backup_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;

    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    // Catat waktu backup terakhir
    localStorage.setItem(BACKUP_LAST_KEY, new Date().toISOString());
    logActivity(currentUser.username, 'export backup', `File: ${filename}`);
    refreshBackupStatus();
    showToast(`✓ Backup berhasil: ${filename}`);
  } catch(e){
    console.error('Export backup gagal:', e);
    showToast('⚠ Gagal membuat backup: ' + (e.message || 'unknown'));
  }
}

// Validasi struktur file backup sebelum restore
function validateBackupPayload(payload){
  if(!payload || typeof payload !== 'object') return 'File tidak valid (bukan JSON object)';
  if(!payload._meta || !payload._meta.version) return 'File bukan backup BM4 (missing _meta.version)';
  // Cek kompatibilitas versi
  const ver = payload._meta.version;
  if(ver !== BACKUP_VERSION && !ver.startsWith('1.')){
    return `Versi backup (${ver}) tidak kompatibel dengan aplikasi saat ini (${BACKUP_VERSION})`;
  }
  // Cek field wajib
  const required = ['accounts', 'perumahan', 'poi', 'tpTargets'];
  for(const key of required){
    if(!Array.isArray(payload[key])){
      return `Field "${key}" hilang atau bukan array`;
    }
  }
  return null; // valid
}

// Handler saat user pilih file untuk import
function handleBackupImport(event){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const file = event.target.files[0];
  if(!file) return;

  // Reset input biar bisa pilih file sama lagi
  event.target.value = '';

  // Batasi ukuran file (10 MB)
  if(file.size > 10 * 1024 * 1024){
    showToast('⚠ File terlalu besar (maksimal 10 MB)');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    let payload;
    try {
      payload = JSON.parse(e.target.result);
    } catch(err){
      showToast('⚠ File tidak valid (bukan JSON)');
      return;
    }

    const validationError = validateBackupPayload(payload);
    if(validationError){
      showToast('⚠ ' + validationError);
      return;
    }

    // Tampilkan preview & konfirmasi sebelum restore
    showRestorePreviewModal(payload, file.name);
  };
  reader.onerror = () => showToast('⚠ Gagal membaca file');
  reader.readAsText(file);
}

// Modal preview sebelum restore (dengan konfirmasi eksplisit)
function showRestorePreviewModal(payload, filename){
  const meta = payload._meta || {};
  const exportedAt = meta.exportedAt ? formatTanggalID(meta.exportedAt, 'short') + ' ' + new Date(meta.exportedAt).toLocaleTimeString('id',{hour:'2-digit',minute:'2-digit'}) : '—';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:white;border-radius:14px;max-width:500px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.4);overflow:hidden;">
      <div style="padding:20px 24px;background:#FEF2F2;border-bottom:1px solid #FECACA;">
        <div style="font-size:17px;font-weight:700;color:#B91C1C;margin-bottom:4px;">⚠️ Konfirmasi Restore Data</div>
        <div style="font-size:12px;color:#991B1B;line-height:1.5;">Semua data saat ini akan <b>diganti</b> dengan isi file backup. Aksi ini tidak bisa dibatalkan.</div>
      </div>
      <div style="padding:20px 24px;">
        <div style="font-size:11px;color:var(--muted);line-height:1.6;margin-bottom:14px;">
          <div style="font-weight:700;color:var(--text);margin-bottom:4px;">📁 ${escapeHtml(filename)}</div>
          <div>Versi: <b>${escapeHtml(meta.version || '—')}</b> · App: <b>${escapeHtml(meta.appVersion || '—')}</b></div>
          <div>Dibuat: <b>${exportedAt}</b> oleh <b>${escapeHtml(meta.exportedBy || '—')}</b></div>
        </div>
        <div style="background:#F1F5F9;border-radius:8px;padding:10px 12px;font-size:11px;line-height:1.6;margin-bottom:14px;">
          <div style="font-weight:700;margin-bottom:4px;color:var(--muted);font-size:10px;letter-spacing:0.5px;text-transform:uppercase;">Isi backup:</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;">
            <div>👥 ${(payload.accounts||[]).length} akun</div>
            <div>📝 ${(payload.accountLogs||[]).length} log</div>
            <div>🏘️ ${(payload.perumahan||[]).length} perumahan</div>
            <div>📍 ${(payload.poi||[]).length} POI</div>
            <div>🏭 ${(payload.tpTargets||[]).length} target pasar</div>
            <div>⚙️ Formula & settings</div>
          </div>
        </div>
        <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:11px;color:#92400E;line-height:1.5;">
          <b>Yang akan terjadi:</b>
          <ul style="margin:4px 0 0 18px;padding:0;">
            <li>Data di perangkat ini akan diganti dengan data dari file backup</li>
            <li>Jika sinkron ke Sheets aktif, data baru akan di-push ke Sheets</li>
            <li>Anda mungkin perlu login ulang jika akun Anda berubah</li>
          </ul>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="restore-cancel" style="flex:1;background:#E2E8F0;color:var(--text);border:none;border-radius:8px;padding:11px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;">Batal</button>
          <button id="restore-confirm" style="flex:1;background:#DC2626;color:white;border:none;border-radius:8px;padding:11px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;">Ya, Restore Sekarang</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('restore-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
  document.getElementById('restore-confirm').onclick = () => {
    overlay.remove();
    performRestore(payload);
  };
}

// Eksekusi restore — overwrite semua data dengan isi payload
async function performRestore(payload){
  try {
    showToast('⏳ Restoring data...');

    // Replace data in-memory
    accounts = payload.accounts || [];
    accountLogs = payload.accountLogs || [];
    perumahan.length = 0; (payload.perumahan || []).forEach(p => perumahan.push(p));
    poi.length = 0; (payload.poi || []).forEach(p => poi.push(p));
    tpTargets = payload.tpTargets || [];

    // Formula & settings
    if(payload.formula && typeof payload.formula === 'object'){
      Object.assign(FORMULA, payload.formula);
    }
    if(typeof payload.potensiPct === 'number' && payload.potensiPct > 0 && payload.potensiPct <= 100){
      POTENSI_PCT = payload.potensiPct;
      localStorage.setItem(POTENSI_KEY, String(POTENSI_PCT));
    }
    if(payload.masterPwHash){
      localStorage.setItem('bm4_master_pw', payload.masterPwHash);
    }

    // Persist ke localStorage
    saveAccountsLocal();
    saveLogsLocal();
    localStorage.setItem('bm4_tp_targets', JSON.stringify(tpTargets));
    try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(e){}

    // Recalculate scoring
    recalcAll();

    // Sync ke Sheets (best effort, tidak blocking kalau gagal)
    if(USE_SHEETS){
      try {
        await Promise.all([
          fetch(GAS_URL, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body:gasPost({action:'savePerumahan', rows:perumahan})}),
          fetch(GAS_URL, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body:gasPost({action:'savePoi', rows:poi})}),
          fetch(GAS_URL, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body:gasPost({action:'saveTargetPasar', rows:tpTargets})}),
          syncAccountsToSheets(),
        ]);
      } catch(e){
        console.warn('Sync to Sheets gagal saat restore:', e);
      }
    }

    logActivity(currentUser?.username || 'system', 'restore backup', `Restore dari file backup (${accounts.length} akun, ${perumahan.length} perumahan)`);
    showToast('✓ Restore berhasil! Halaman akan di-reload...');

    // Reload halaman setelah 2 detik supaya semua tampilan fresh
    setTimeout(() => { location.reload(); }, 2000);
  } catch(e){
    console.error('Restore gagal:', e);
    showToast('⚠ Restore gagal: ' + (e.message || 'unknown'));
  }
}

// Placeholder lama agar tidak ganda — openSettings asli di atas sudah di-override

function previewFormulaPotensi(){
  const v=parseFloat(document.getElementById('set-formula-pct').value)||0;
  document.getElementById('set-formula-pct-disp').textContent=v;
  document.getElementById('set-formula-pct-disp2').textContent=v;
  document.getElementById('set-formula-sample').textContent=fmt(Math.round(5000*v/100));
}

function saveFormulaPotensi(){
  const v=parseFloat(document.getElementById('set-formula-pct').value);
  if(isNaN(v)||v<=0||v>100){showToast('⚠ Persentase harus 1–100');return;}
  savePotensiFormula(v);
  logActivity(currentUser?.username||'system','edit',`Ubah formula potensi unit: ${v}%`);
  showToast(`✓ Formula disimpan: ${v}%`);
  // Refresh detail target jika terbuka
  if(selectedTpId!==null){
    const t=tpTargets.find(x=>x.id===selectedTpId);
    if(t){
      const el=document.getElementById('tp-d-potensi');
      if(el)el.textContent=`~${calcPotensiUnit(t.karyawan)} unit (est. ${POTENSI_PCT}%)`;
    }
  }
}

function closeSettings(){
  showScreen('s-app');
}

function uploadAvatar(event){
  const file = event.target.files[0];
  if(!file) return;
  // [v9 SECURITY] Validasi MIME type — hanya image/* yang diperbolehkan
  if(!file.type || !file.type.startsWith('image/')){
    showToast('⚠ File harus berupa gambar (JPG/PNG/WebP)');
    return;
  }
  if(file.size > 10 * 1024 * 1024){ // batas 10MB — nanti auto-compress
    showToast('⚠ Ukuran foto maksimal 10MB');
    return;
  }
  showToast('⚙️ Memproses foto...');
  _compressAvatar(file).then(dataUrl => {
    // [v9 SECURITY] Double-check: pastikan hasil base64 benar-benar image
    if(!dataUrl.startsWith('data:image/')){
      showToast('⚠ File tidak valid');
      return;
    }
    const sizeKB = Math.round((dataUrl.length * 0.75) / 1024);
    // Simpan ke current user
    const idx = accounts.findIndex(a => a.username === currentUser.username);
    if(idx >= 0){
      accounts[idx].foto = dataUrl;
      currentUser.foto = dataUrl;
      saveAccountsLocal();
      syncAccountsToSheets();
      logActivity(currentUser.username, 'ganti foto', `User mengubah foto profil (${sizeKB}KB)`);
      document.getElementById('settings-avatar').innerHTML = `<img src="${dataUrl}" alt="">`;
      document.getElementById('tb-profile-avatar').innerHTML = `<img src="${dataUrl}" alt="">`;
      showToast(`✓ Foto profil diperbarui (${sizeKB}KB)`);
    }
  }).catch(err => {
    console.error('Compress avatar error:', err);
    showToast('⚠️ Gagal memproses foto: ' + err.message);
  });
}

async function savePasswordChange(){
  const oldPw = document.getElementById('set-pw-old').value;
  const newPw = document.getElementById('set-pw-new').value;
  const newPw2 = document.getElementById('set-pw-new2').value;

  // [v9 SECURITY] Pakai verifyPassword — kompatibel dengan hash + plaintext legacy
  const oldOk = await verifyPassword(oldPw, currentUser.password);
  if(!oldOk){ showToast('⚠ Password lama salah'); return; }
  if(!newPw || newPw.length < 8){ showToast('⚠ Password baru minimal 8 karakter'); return; }
  if(newPw !== newPw2){ showToast('⚠ Konfirmasi password tidak cocok'); return; }

  const idx = accounts.findIndex(a => a.username === currentUser.username);
  if(idx >= 0){
    const hashed = await hashPassword(newPw);
    accounts[idx].password = hashed;
    currentUser.password = hashed;
    saveAccountsLocal();
    syncAccountsToSheets();
    logActivity(currentUser.username, 'ganti password', 'User mengubah password sendiri');
    showToast('✓ Password berhasil diubah');
    document.getElementById('set-pw-old').value = '';
    document.getElementById('set-pw-new').value = '';
    document.getElementById('set-pw-new2').value = '';
  }
}

// ============================================================
// MOBILE SIDEBAR TOGGLE (untuk Analisa Lokasi)
// ============================================================
function toggleMobileSidebar(){
  const sb = document.querySelector('#pane-analisa .sb');
  const backdrop = document.getElementById('sb-backdrop');
  if(!sb) return;
  sb.classList.toggle('open');
  backdrop.classList.toggle('open');
}

// Tutup detail bottom sheet (Analisa)
function closeDetailMobile(){
  document.getElementById('detail-sb')?.classList.remove('open');
  document.getElementById('sb-backdrop')?.classList.remove('open');
  document.getElementById('detail-close-mobile').style.display='none';
}

// Toggle sidebar Target Pasar (Strategi) di mobile
function toggleMobileStratSidebar(){
  const sidebar = document.querySelector('#pane-strategi .tp-sidebar');
  const backdrop = document.getElementById('strat-backdrop');
  if(!sidebar) return;
  const isOpen = sidebar.classList.toggle('open');
  backdrop.classList.toggle('open', isOpen);
}

function updateMobileStratBtn(){
  const btn = document.getElementById('mobile-strat-btn');
  if(!btn) return;
  const isMobile = window.innerWidth <= 768;
  const strActive = document.getElementById('pane-strategi')?.classList.contains('active');
  const appScreenActive = document.getElementById('s-app')?.classList.contains('active');
  btn.style.display = (isMobile && strActive && appScreenActive) ? 'flex' : 'none';
}

function updateMobileMenuBtn(){
  const btn = document.getElementById('mobile-menu-btn');
  if(!btn) return;
  const isMobile = window.innerWidth <= 768;
  const analisaActive = document.getElementById('pane-analisa')?.classList.contains('active');
  const appScreenActive = document.getElementById('s-app')?.classList.contains('active');
  btn.style.display = (isMobile && analisaActive && appScreenActive) ? 'flex' : 'none';
}

// Hook yang dipanggil dari dalam switchDiv asli — tidak mengubah behavior asli, hanya menambah
function switchDivHook(div, el){
  // [v12.5 SAFETY] BM selalu punya akses ke semua menu — bypass check
  const isBM = currentUser?.role === 'bm';
  // Cek akses — blokir jika tidak boleh (kecuali dashboard, tim, galeri, proyek yg diatur terpisah)
  if(!isBM && currentUser && div !== 'dashboard' && div !== 'tim' && div !== 'galeri' && div !== 'proyek'){
    const akses = currentUser.akses || [];
    if(!akses.includes(div)){
      showToast('⚠ Anda tidak memiliki akses ke menu ini');
      // Kembali ke dashboard
      setTimeout(()=>{
        const dashTab = document.querySelector('[data-div=dashboard]');
        if(dashTab) switchDiv('dashboard', dashTab);
      }, 50);
      return;
    }
  }
  // [v12.4 STATE PERSISTENCE] Save state setiap kali ganti tab — DI AKHIR supaya tidak block navigation
  if(typeof triggerSaveAppState === 'function') {
    try { triggerSaveAppState(); } catch(e){ console.warn('save state err:', e); }
  }
  if(div === 'tim'){
    if(currentUser?.role !== 'bm'){
      showToast('⚠ Hanya Branch Manager yang bisa akses');
      setTimeout(()=>{
        const dashTab = document.querySelector('[data-div=dashboard]');
        if(dashTab) switchDiv('dashboard', dashTab);
      }, 50);
      return;
    }
    renderTim();
  }
  if(div === 'proyek'){
    // [v14 PROYEK] Hanya BM yang boleh akses Kelola Proyek
    if(currentUser?.role !== 'bm'){
      showToast('⚠ Hanya Branch Manager yang bisa akses');
      setTimeout(()=>{
        const dashTab = document.querySelector('[data-div=dashboard]');
        if(dashTab) switchDiv('dashboard', dashTab);
      }, 50);
      return;
    }
    renderProyek();
  }
  if(div === 'galeri'){
    renderGaleri();
  }
  // Tutup sidebar mobile analisa kalau terbuka
  const sb = document.querySelector('#pane-analisa .sb');
  const backdrop = document.getElementById('sb-backdrop');
  if(sb?.classList.contains('open')){ sb.classList.remove('open'); backdrop?.classList.remove('open'); }
  // Tutup detail bottom sheet analisa kalau terbuka
  const detailSb = document.getElementById('detail-sb');
  const detailCloseBtn = document.getElementById('detail-close-mobile');
  if(detailSb?.classList.contains('open')){ detailSb.classList.remove('open'); if(detailCloseBtn) detailCloseBtn.style.display='none'; }
  // Tutup sidebar strategi kalau terbuka
  const stratSb = document.querySelector('#pane-strategi .tp-sidebar');
  if(stratSb?.classList.contains('open')){ stratSb.classList.remove('open'); document.getElementById('strat-backdrop')?.classList.remove('open'); }
  updateMobileMenuBtn();
  updateMobileStratBtn();

  // [TAHAP 1] Toggle body class agar tombol .analisa-only ikut visible/hidden via CSS
  // Bersihkan semua class div-* lama, lalu set yang baru sesuai divisi aktif
  document.body.className = document.body.className.replace(/\bdiv-\S+/g, '').trim();
  if(div) document.body.classList.add('div-' + div);

  // [TAHAP 1] Auto-tutup overlay Editor & Formula saat pindah dari Analisa ke divisi lain
  if(div !== 'analisa'){
    const editorOv = document.getElementById('editor-overlay');
    if(editorOv?.classList.contains('open')) editorOv.classList.remove('open');
    const adminOv = document.getElementById('admin-overlay');
    if(adminOv?.classList.contains('open')) adminOv.classList.remove('open');
  }
}

window.addEventListener('resize', ()=>{ updateMobileMenuBtn(); updateMobileStratBtn(); });


// ─── SESSION TIMEOUT (8 jam) ──────────────────────────────
const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000;
let _sessionTimer = null;
let _lastActivity = Date.now();

function startSessionTimer(){
  clearTimeout(_sessionTimer);
  _lastActivity = Date.now();
  _sessionTimer = setTimeout(function(){
    if(currentUser){
      logActivity(currentUser.username, 'logout', 'Auto-logout: sesi habis (8 jam)');
      doLogout();
      setTimeout(()=>showToast('⏱ Sesi habis. Silakan login kembali.'), 300);
    }
  }, SESSION_TIMEOUT_MS);
}

function resetSessionTimer(){
  if(!currentUser) return;
  // [v10 CONTROL] Cek apakah session user ini sudah di-invalidasi oleh BM (force logout)
  const acc = findAccount(currentUser.username);
  if(acc){
    const sessionStart = parseInt(sessionStorage.getItem('bm4_session_start') || '0');
    const validFrom = parseInt(acc.sessionValidFrom || '0');
    if(validFrom > sessionStart){
      // Session dimulai sebelum validFrom → sudah di-invalidasi
      logActivity(currentUser.username, 'logout', 'Auto-logout: session di-force oleh BM');
      doLogout();
      setTimeout(()=>showToast('🚪 Sesi Anda diakhiri oleh Branch Manager.'), 300);
      return;
    }
    // Cek juga kalau akun ini baru saja di-suspend
    if(acc.suspended){
      logActivity(currentUser.username, 'logout', 'Auto-logout: akun di-suspend');
      doLogout();
      setTimeout(()=>showToast('⛔ Akun Anda dinonaktifkan. Hubungi BM.'), 300);
      return;
    }
  }
  _lastActivity = Date.now();
  clearTimeout(_sessionTimer);
  _sessionTimer = setTimeout(function(){
    if(currentUser){
      logActivity(currentUser.username, 'logout', 'Auto-logout: sesi habis (8 jam)');
      doLogout();
      setTimeout(()=>showToast('⏱ Sesi habis. Silakan login kembali.'), 300);
    }
  }, SESSION_TIMEOUT_MS);
}

// Reset timer on user activity
['click','keydown','mousemove','touchstart'].forEach(evt =>
  document.addEventListener(evt, ()=>{ if(currentUser) resetSessionTimer(); }, {passive:true})
);
// ──────────────────────────────────────────────────────────

// Override doLogin — pakai window agar aman
window.doLogin = function(){ doLoginNew(); };

// Override doLogout untuk bersihkan currentUser
const _origDoLogout = window.doLogout || doLogout;
window.doLogout = function(){
  if(currentUser){
    logActivity(currentUser.username, 'logout', 'User keluar');
  }
  sessionStorage.removeItem(CURRENT_USER_KEY);
  currentUser = null;
  _origDoLogout();
};



// ═══════════════════════════════════════════════════════════════════════════════
// BAGIAN B — APPEND ke akhir <script>
// Semua function di sini punya prefix tpr2* — tidak bertabrakan dengan yang lama.
// ═══════════════════════════════════════════════════════════════════════════════

// State internal untuk UI baru
const TPR2_STATE = {
  mode: 'card',       // 'card' | 'wizard'
  wizStep: 1,         // 1..6
  bulananMode: 'picker',  // 'picker' | 'raw'
  profilMode: 'visual',   // 'visual' | 'raw'
  bulanan: [],        // [{bulan:'YYYY-MM', unit:N}] — mirror dari textarea raw
  profil: {           // mirror dari input teks raw
    pekerjaan: {},
    usia: {},
    penghasilan: {},
    gender: {}
  },
  cardOpen: { identitas:true, place:false, product:true, price:true, promotion:false, performance:true, gtm:false }
};

// ─── MODE TOGGLE (Card vs Wizard) ────────────────────────────────────────────
function tpr2SwitchMode(mode){
  TPR2_STATE.mode = mode;
  document.getElementById('tpr2-mode-btn-card')?.classList.toggle('active', mode === 'card');
  document.getElementById('tpr2-mode-btn-wizard')?.classList.toggle('active', mode === 'wizard');
  document.getElementById('tpr2-mode-card')?.classList.toggle('active', mode === 'card');
  document.getElementById('tpr2-mode-wizard')?.classList.toggle('active', mode === 'wizard');
  try { localStorage.setItem('bm4_tpr2_mode', mode); } catch(_){}
  if(mode === 'wizard'){
    tpr2WizRenderStep(TPR2_STATE.wizStep);
  } else {
    tpr2RefreshCardSummaries();
  }
}

// ─── REFRESH ALL UI (dipanggil setelah loadTaperaForm) ───────────────────────
function tpr2RefreshAll(){
  // Sync state dari ID-lama (textarea bulanan & input profil teks)
  TPR2_STATE.bulanan = _parseBulanan(document.getElementById('tpr-bulanan')?.value || '');
  TPR2_STATE.profil.pekerjaan = _parseProfil(document.getElementById('tpr-pekerjaan')?.value || '') || {};
  TPR2_STATE.profil.usia = _parseProfil(document.getElementById('tpr-usia')?.value || '') || {};
  TPR2_STATE.profil.penghasilan = _parseProfil(document.getElementById('tpr-penghasilan')?.value || '') || {};
  TPR2_STATE.profil.gender = _parseProfil(document.getElementById('tpr-gender')?.value || '') || {};
  // Render
  tpr2RenderBulananPicker();
  tpr2RenderBulananChart();
  ['pekerjaan','usia','penghasilan','gender'].forEach(k => tpr2RenderProfilBars(k));
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
  if(TPR2_STATE.mode === 'wizard') tpr2WizRenderStep(TPR2_STATE.wizStep);
}

// ─── CARD COLLAPSIBLE (Mode 1) ───────────────────────────────────────────────
function tpr2ToggleCard(cardId){
  const card = document.querySelector(`.tpr2-card[data-tpr-card="${cardId}"]`);
  if(!card) return;
  card.classList.toggle('collapsed');
  TPR2_STATE.cardOpen[cardId] = !card.classList.contains('collapsed');
}

// Update teks summary di header card berdasarkan field yang sudah terisi
function tpr2RefreshCardSummaries(){
  // [v3] Summary per section FM (place/product/price/promotion/performance/gtm)
  const setSum = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
  const _v = (id) => (document.getElementById(id)?.value||'').trim();

  // Helper: hitung custom field terisi di section
  const countCustomFilled = (secId) => {
    const fields = (FM_STATE?.customFields?.[secId] || []).filter(f => !_isFieldHidden?.(f.id));
    return fields.filter(f => {
      const el = document.getElementById(`tpr-custom-${f.id}`);
      if(!el) return false;
      if(f.type === 'multi'){
        const checks = document.querySelectorAll(`input[data-cf-id="${f.id}"][data-cf-multi="1"]:checked`);
        return checks.length > 0;
      }
      if(f.type === 'yesno'){
        const checks = document.querySelectorAll(`input[data-cf-id="${f.id}"]:checked`);
        for(const c of checks) if(c.value) return true;
        return false;
      }
      return (el.value||'').trim().length > 0;
    }).length;
  };

  // 📍 Place
  const placeCustomCnt = countCustomFilled('place');
  setSum('tpr2-sum-place',
    placeCustomCnt > 0 ? `${placeCustomCnt} field terisi` : '— belum diisi');

  // 🆔 Identitas Tapera (nama auto-fill dari profil + tahun + kab/kota)
  const tahunR = _v('tpr-tahun-realisasi');
  const kabK = _v('tpr-kab-kota');
  const namaR = _v('tpr-nama-perumahan');
  const idParts = [];
  if(tahunR) idParts.push(`Tahun ${tahunR}`);
  if(kabK) idParts.push(kabK);
  setSum('tpr2-sum-identitas',
    idParts.length ? idParts.join(' · ') : (namaR ? `📌 ${namaR}` : '— belum diisi'));

  // 🏠 Product (LT, LB + custom)
  const productBawaan = ['tpr-lt','tpr-lb'].filter(id => _v(id)).length;
  const productCustomCnt = countCustomFilled('product');
  const productTotal = productBawaan + productCustomCnt;
  const lt = _v('tpr-lt'); const lb = _v('tpr-lb');
  setSum('tpr2-sum-product',
    productTotal > 0 ? `${productTotal} field${lt ? ' · LT ' + lt : ''}${lb ? ' · LB ' + lb : ''}` : '— belum diisi');

  // 💰 Price (harga, tenor, um, bank, FLPP + custom)
  const priceBawaan = ['tpr-harga','tpr-tenor','tpr-um','tpr-bank','tpr-nominal'].filter(id => _v(id)).length;
  const priceCustomCnt = countCustomFilled('price');
  const harga = _v('tpr-harga'); const bank = _v('tpr-bank');
  const priceTotal = priceBawaan + priceCustomCnt;
  setSum('tpr2-sum-price',
    priceTotal > 0 ? `${priceTotal} field${harga ? ' · ' + harga : ''}${bank ? ' · ' + bank : ''}` : '— belum diisi');

  // 📢 Promotion (5 bawaan + custom)
  const promoBawaan = ['tpr-promo-aktif','tpr-promo-periode','tpr-promo-bonus','tpr-promo-iklan','tpr-promo-bb'].filter(id => _v(id)).length;
  const promoCustomCnt = countCustomFilled('promotion');
  const promoAktif = _v('tpr-promo-aktif');
  const promoTotal = promoBawaan + promoCustomCnt;
  setSum('tpr2-sum-promotion',
    promoTotal > 0 ? `${promoTotal} field${promoAktif ? ' · "' + promoAktif + '" aktif' : ''}` : '— belum diisi');

  // 📈 Performance (total + bulanan + profil pembeli + custom)
  const total = _v('tpr-total');
  const bul = TPR2_STATE.bulanan;
  const pDims = ['pekerjaan','usia','penghasilan','gender'];
  const pFilled = pDims.filter(k => Object.keys(TPR2_STATE.profil[k] || {}).length > 0).length;
  const perfCustomCnt = countCustomFilled('performance');
  const parts = [];
  if(total) parts.push(`${fmt(parseInt(total))} unit`);
  if(bul.length){
    const peak = bul.reduce((a, b) => b.unit > a.unit ? b : a, bul[0]);
    parts.push(`${bul.length} bln · puncak ${peak.bulan}`);
  }
  if(pFilled) parts.push(`profil ${pFilled}/4 dimensi`);
  if(perfCustomCnt) parts.push(`+${perfCustomCnt} custom`);
  setSum('tpr2-sum-performance', parts.length ? parts.join(' · ') : '— belum diisi');

  // 👔 GTM
  const gtmBawaan = ['tpr-gtm-mkt','tpr-gtm-kanal','tpr-gtm-agent','tpr-gtm-fee-mkt','tpr-gtm-fee-agt','tpr-gtm-dev'].filter(id => _v(id)).length;
  const gtmCustomCnt = countCustomFilled('gtm');
  const gtmTotal = gtmBawaan + gtmCustomCnt;
  const mkt = _v('tpr-gtm-mkt'); const agent = _v('tpr-gtm-agent');
  let gtmExtra = '';
  if(mkt || agent) gtmExtra = ` · ${mkt || 0} in-house + ${agent || 0} agent`;
  setSum('tpr2-sum-gtm', gtmTotal > 0 ? `${gtmTotal} field${gtmExtra}` : '— belum diisi');
}

// Update progress bar (X dari 6 section terisi minimal 1 field)
function tpr2UpdateProgress(){
  const _v = (id) => (document.getElementById(id)?.value||'').trim();
  const hasCustom = (secId) => {
    const fields = (FM_STATE?.customFields?.[secId] || []).filter(f => !_isFieldHidden?.(f.id));
    return fields.some(f => {
      const el = document.getElementById(`tpr-custom-${f.id}`);
      if(!el) return false;
      if(f.type === 'multi'){
        return document.querySelectorAll(`input[data-cf-id="${f.id}"][data-cf-multi="1"]:checked`).length > 0;
      }
      if(f.type === 'yesno'){
        const checks = document.querySelectorAll(`input[data-cf-id="${f.id}"]:checked`);
        for(const c of checks) if(c.value) return true;
        return false;
      }
      return (el.value||'').trim().length > 0;
    });
  };

  let filled = 0;
  // Place: cuma custom (tidak ada bawaan input di tab Tapera)
  if(hasCustom('place')) filled++;
  // Product: LT/LB atau custom
  if(['tpr-lt','tpr-lb'].some(id => _v(id)) || hasCustom('product')) filled++;
  // Price: 5 bawaan atau custom
  if(['tpr-harga','tpr-tenor','tpr-um','tpr-bank','tpr-nominal'].some(id => _v(id)) || hasCustom('price')) filled++;
  // Promotion
  if(['tpr-promo-aktif','tpr-promo-periode','tpr-promo-bonus','tpr-promo-iklan','tpr-promo-bb'].some(id => _v(id)) || hasCustom('promotion')) filled++;
  // Performance: total/bulanan/profil/custom
  if(_v('tpr-total') || TPR2_STATE.bulanan.length > 0 ||
     ['pekerjaan','usia','penghasilan','gender'].some(k => Object.keys(TPR2_STATE.profil[k]||{}).length) ||
     hasCustom('performance')) filled++;
  // GTM
  if(['tpr-gtm-mkt','tpr-gtm-kanal','tpr-gtm-agent','tpr-gtm-fee-mkt','tpr-gtm-fee-agt','tpr-gtm-dev'].some(id => _v(id)) || hasCustom('gtm')) filled++;

  const total = 6;
  const pct = Math.round(filled / total * 100);
  const fillEl = document.getElementById('tpr2-progress-fill');
  const txtEl = document.getElementById('tpr2-progress-text');
  if(fillEl) fillEl.style.width = pct + '%';
  if(txtEl) txtEl.textContent = `${filled} dari ${total} section`;
}

// Handler global: setiap input berubah → re-render summary + progress
function tpr2OnFieldInput(){
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
  // Kalau wizard mode aktif, refresh preview-nya
  if(TPR2_STATE.mode === 'wizard') tpr2WizRenderPreview();
}

// ─── BULANAN: picker mode (chip + add row) vs raw textarea ───────────────────
function tpr2BulananSwitchMode(mode){
  TPR2_STATE.bulananMode = mode;
  document.getElementById('tpr2-bul-mode-picker')?.classList.toggle('active', mode === 'picker');
  document.getElementById('tpr2-bul-mode-raw')?.classList.toggle('active', mode === 'raw');
  document.getElementById('tpr2-bul-picker')?.classList.toggle('active', mode === 'picker');
  document.getElementById('tpr2-bul-raw')?.classList.toggle('active', mode === 'raw');
  if(mode === 'picker') tpr2RenderBulananPicker();
}

function tpr2BulananAdd(){
  const monthEl = document.getElementById('tpr2-bul-input-month');
  const unitEl = document.getElementById('tpr2-bul-input-unit');
  const month = monthEl?.value;
  const unit = parseInt(unitEl?.value);
  if(!month || !/^\d{4}-\d{2}$/.test(month)){ showToast('⚠ Pilih bulan dulu'); return; }
  if(isNaN(unit) || unit < 0){ showToast('⚠ Isi unit (angka >= 0)'); return; }
  const idx = TPR2_STATE.bulanan.findIndex(b => b.bulan === month);
  if(idx >= 0) TPR2_STATE.bulanan[idx].unit = unit;
  else TPR2_STATE.bulanan.push({ bulan: month, unit: unit });
  TPR2_STATE.bulanan.sort((a,b) => a.bulan.localeCompare(b.bulan));
  tpr2SyncBulananToTextarea();
  tpr2RenderBulananPicker();
  tpr2RenderBulananChart();
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
  if(monthEl) monthEl.value = '';
  if(unitEl) unitEl.value = '';
}

function tpr2BulananRemove(bulan){
  TPR2_STATE.bulanan = TPR2_STATE.bulanan.filter(b => b.bulan !== bulan);
  tpr2SyncBulananToTextarea();
  tpr2RenderBulananPicker();
  tpr2RenderBulananChart();
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
}

function tpr2BulananEditUnit(bulan, newVal){
  const v = parseInt(newVal);
  if(isNaN(v) || v < 0) return;
  const item = TPR2_STATE.bulanan.find(b => b.bulan === bulan);
  if(item){
    item.unit = v;
    tpr2SyncBulananToTextarea();
    tpr2RenderBulananChart();
    tpr2RefreshCardSummaries();
  }
}

function tpr2SyncBulananToTextarea(){
  const ta = document.getElementById('tpr-bulanan');
  if(ta) ta.value = TPR2_STATE.bulanan.map(b => `${b.bulan}:${b.unit}`).join(', ');
}

function tpr2OnRawBulananInput(){
  // User edit textarea raw langsung — sync ke state
  TPR2_STATE.bulanan = _parseBulanan(document.getElementById('tpr-bulanan')?.value || '');
  tpr2RenderBulananChart();
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
}

function tpr2RenderBulananPicker(){
  const host = document.getElementById('tpr2-bul-chips');
  if(!host) return;
  if(TPR2_STATE.bulanan.length === 0){
    host.innerHTML = '<div class="tpr2-bul-empty">Belum ada bulan. Tambahkan dengan picker di atas.</div>';
    return;
  }
  const peak = TPR2_STATE.bulanan.reduce((a, b) => b.unit > a.unit ? b : a, TPR2_STATE.bulanan[0]);
  // Tampilkan chronological terbaru duluan supaya lebih intuitif
  const sorted = [...TPR2_STATE.bulanan].sort((a,b) => b.bulan.localeCompare(a.bulan));
  host.innerHTML = sorted.map(b => {
    const isPeak = b.bulan === peak.bulan;
    return `<div class="tpr2-bul-chip${isPeak ? ' peak' : ''}">
      <span class="tpr2-bul-chip-label">${isPeak ? '★ ' : ''}${escapeHtml(b.bulan)}</span>
      <input type="number" value="${b.unit}" min="0" class="tpr2-bul-chip-input" oninput="tpr2BulananEditUnit('${b.bulan}', this.value)">
      <span class="tpr2-bul-chip-unit">unit</span>
      <button type="button" class="tpr2-bul-chip-remove" onclick="tpr2BulananRemove('${b.bulan}')" title="Hapus">✕</button>
    </div>`;
  }).join('');
}

// Render mini bar chart inline di card bulanan
function tpr2RenderBulananChart(){
  const wrap = document.getElementById('tpr2-bulanan-chart-wrap');
  const bars = document.getElementById('tpr2-bulanan-bars');
  const axis = document.getElementById('tpr2-bulanan-axis');
  if(!wrap || !bars) return;
  if(TPR2_STATE.bulanan.length === 0){
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  const sorted = [...TPR2_STATE.bulanan].sort((a,b) => a.bulan.localeCompare(b.bulan));
  const max = Math.max(1, ...sorted.map(b => b.unit));
  const peak = sorted.reduce((a,b) => b.unit > a.unit ? b : a, sorted[0]);
  bars.innerHTML = sorted.map(b => {
    const h = Math.max(2, Math.round((b.unit / max) * 100));
    const isPeak = b.bulan === peak.bulan;
    return `<div class="tpr2-chart-bar${isPeak ? ' peak' : ''}" style="height:${h}%;" title="${b.bulan}: ${b.unit} unit"></div>`;
  }).join('');
  if(axis){
    axis.innerHTML = `<span>${sorted[0].bulan}</span>` +
      `<span class="peak-label">▲ puncak ${peak.bulan} (${peak.unit})</span>` +
      `<span>${sorted[sorted.length-1].bulan}</span>`;
  }
}

// ─── PROFIL PEMBELI: visual bars vs raw text ─────────────────────────────────
function tpr2ProfilSwitchMode(mode){
  TPR2_STATE.profilMode = mode;
  document.getElementById('tpr2-prof-mode-visual')?.classList.toggle('active', mode === 'visual');
  document.getElementById('tpr2-prof-mode-raw')?.classList.toggle('active', mode === 'raw');
  document.getElementById('tpr2-prof-visual')?.classList.toggle('active', mode === 'visual');
  document.getElementById('tpr2-prof-raw')?.classList.toggle('active', mode === 'raw');
  if(mode === 'visual') ['pekerjaan','usia','penghasilan','gender'].forEach(k => tpr2RenderProfilBars(k));
}

// Render bar visual untuk satu kategori profil (pekerjaan/usia/penghasilan/gender)
function tpr2RenderProfilBars(kat){
  const host = document.getElementById(`tpr2-prof-bars-${kat}`);
  const totalEl = document.getElementById(`tpr2-prof-total-${kat}`);
  if(!host) return;
  const data = TPR2_STATE.profil[kat] || {};
  const entries = Object.entries(data);
  const total = entries.reduce((a, [k,v]) => a + v, 0);

  // Color palette per kategori (single ramp per block)
  const RAMP = {
    pekerjaan: ['#7F77DD','#AFA9EC','#CECBF6','#EEEDFE','#EEEDFE'],
    usia:      ['#1D9E75','#5DCAA5','#9FE1CB','#9FE1CB','#E1F5EE'],
    penghasilan:['#BA7517','#EF9F27','#FAC775','#FAEEDA','#FAEEDA'],
    gender:    ['#185FA5','#D4537E','#888780','#888780','#888780']
  }[kat] || ['#888780'];

  // Special render: gender pakai stacked bar horizontal
  if(kat === 'gender' && entries.length){
    let stackHtml = '<div class="tpr2-gender-stack">';
    entries.forEach(([k, v], i) => {
      const w = total > 0 ? (v / total) * 100 : 0;
      const c = RAMP[i % RAMP.length];
      stackHtml += `<div class="tpr2-gender-stack-seg" style="width:${w}%;background:${c};">${escapeHtml(k)} ${Math.round(v)}%</div>`;
    });
    stackHtml += '</div>';
    stackHtml += entries.map(([k, v], i) => {
      return `<div class="tpr2-prof-row">
        <span class="tpr2-prof-name">${escapeHtml(k)}</span>
        <input type="range" min="0" max="100" value="${v}" oninput="tpr2ProfilEdit('${kat}','${escapeHtml(k)}',this.value)">
        <input type="number" min="0" max="100" value="${v}" class="tpr2-prof-num" oninput="tpr2ProfilEdit('${kat}','${escapeHtml(k)}',this.value)">
        <button type="button" class="tpr2-prof-remove" onclick="tpr2ProfilRemove('${kat}','${escapeHtml(k)}')">✕</button>
      </div>`;
    }).join('');
    host.innerHTML = stackHtml;
  } else if(entries.length === 0){
    host.innerHTML = '<div class="tpr2-prof-empty">Belum ada data — isi kategori di bawah.</div>';
  } else {
    host.innerHTML = entries.map(([k, v], i) => {
      const pct = total > 0 ? (v / total) * 100 : 0;
      const c = RAMP[Math.min(i, RAMP.length-1)];
      return `<div class="tpr2-prof-row">
        <span class="tpr2-prof-name" title="${escapeHtml(k)}">${escapeHtml(k)}</span>
        <div class="tpr2-prof-track">
          <div class="tpr2-prof-fill" style="width:${pct}%;background:${c};"></div>
        </div>
        <input type="number" min="0" max="100" value="${v}" class="tpr2-prof-num" oninput="tpr2ProfilEdit('${kat}','${escapeHtml(k)}',this.value)">
        <button type="button" class="tpr2-prof-remove" onclick="tpr2ProfilRemove('${kat}','${escapeHtml(k)}')" title="Hapus">✕</button>
      </div>`;
    }).join('');
  }
  if(totalEl){
    const totalRound = Math.round(total);
    const ok = totalRound === 100;
    totalEl.textContent = `total ${totalRound}%`;
    totalEl.className = 'tpr2-prof-total ' + (ok ? 'ok' : (total > 0 ? 'warn' : ''));
  }
}

function tpr2ProfilAddCat(kat){
  const keyEl = document.getElementById(`tpr2-prof-newkey-${kat}`);
  const valEl = document.getElementById(`tpr2-prof-newval-${kat}`);
  const k = (keyEl?.value || '').trim();
  const v = parseFloat(valEl?.value);
  if(!k){ showToast('⚠ Isi label/kategori'); return; }
  if(isNaN(v) || v < 0 || v > 100){ showToast('⚠ Isi persen (0-100)'); return; }
  if(!TPR2_STATE.profil[kat]) TPR2_STATE.profil[kat] = {};
  TPR2_STATE.profil[kat][k] = v;
  tpr2SyncProfilToInput(kat);
  tpr2RenderProfilBars(kat);
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
  if(keyEl) keyEl.value = '';
  if(valEl) valEl.value = '';
}

function tpr2ProfilEdit(kat, key, newVal){
  const v = parseFloat(newVal);
  if(isNaN(v) || v < 0 || v > 100) return;
  if(!TPR2_STATE.profil[kat]) TPR2_STATE.profil[kat] = {};
  TPR2_STATE.profil[kat][key] = v;
  tpr2SyncProfilToInput(kat);
  tpr2RenderProfilBars(kat);
  tpr2RefreshCardSummaries();
}

function tpr2ProfilRemove(kat, key){
  if(TPR2_STATE.profil[kat]) delete TPR2_STATE.profil[kat][key];
  tpr2SyncProfilToInput(kat);
  tpr2RenderProfilBars(kat);
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
}

function tpr2SyncProfilToInput(kat){
  const inp = document.getElementById(`tpr-${kat}`);
  if(inp) inp.value = _profilToStr(TPR2_STATE.profil[kat] || {});
}

function tpr2OnRawProfilInput(kat, val){
  // User edit input teks raw langsung — sync ke state
  TPR2_STATE.profil[kat] = _parseProfil(val) || {};
  tpr2RenderProfilBars(kat);
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
}

// Sebelum save: pastikan field hidden ID-lama ter-update dari mode visual
function tpr2FlushVisualToRaw(){
  // Bulanan
  tpr2SyncBulananToTextarea();
  // Profil
  ['pekerjaan','usia','penghasilan','gender'].forEach(k => tpr2SyncProfilToInput(k));
}


// ═══════════════════════════════════════════════════════════════════════════════
// WIZARD MODE
// Setiap step = render input pane (kiri) + preview pane (kanan).
// Input field di wizard SHARE dengan input di mode card lewat ID lama.
// ═══════════════════════════════════════════════════════════════════════════════

const TPR2_WIZ_STEPS = [
  { num:1, key:'place',       label:'Place',       icon:'📍', color:'#854F0B', bg:'#FAEEDA' },
  { num:2, key:'product',     label:'Product',     icon:'🏠', color:'#0F6E56', bg:'#E1F5EE' },
  { num:3, key:'price',       label:'Price',       icon:'💰', color:'#993556', bg:'#FBEAF0' },
  { num:4, key:'promotion',   label:'Promotion',   icon:'📢', color:'#993556', bg:'#FBEAF0' },
  { num:5, key:'performance', label:'Performance', icon:'📈', color:'#185FA5', bg:'#E6F1FB' },
  { num:6, key:'gtm',         label:'GTM',         icon:'👔', color:'#3C3489', bg:'#EEEDFE' }
];

function tpr2WizGoStep(n){
  if(n < 1 || n > TPR2_WIZ_STEPS.length) return;
  TPR2_STATE.wizStep = n;
  tpr2WizRenderStep(n);
}
function tpr2WizPrev(){ if(TPR2_STATE.wizStep > 1) tpr2WizGoStep(TPR2_STATE.wizStep - 1); }
function tpr2WizNext(){
  if(TPR2_STATE.wizStep < TPR2_WIZ_STEPS.length) tpr2WizGoStep(TPR2_STATE.wizStep + 1);
  else { saveTaperaForm(); }
}

function tpr2WizRenderStep(n){
  const step = TPR2_WIZ_STEPS[n - 1];
  if(!step) return;
  // Update stepper visual
  document.querySelectorAll('.tpr2-wiz-step').forEach(el => {
    const sn = parseInt(el.dataset.wizStep);
    el.classList.toggle('active', sn === n);
    el.classList.toggle('done', sn < n);
  });
  // Update progress
  const pct = Math.round(n / TPR2_WIZ_STEPS.length * 100);
  const fill = document.getElementById('tpr2-wiz-progress-fill');
  if(fill) fill.style.width = pct + '%';
  document.getElementById('tpr2-wiz-progress-pct').textContent = pct + '%';
  document.getElementById('tpr2-wiz-stepinfo').innerHTML = `Step <strong>${n} dari ${TPR2_WIZ_STEPS.length}</strong> · ${step.label}`;
  // Update next btn label
  const nextBtn = document.getElementById('tpr2-wiz-next');
  if(nextBtn) nextBtn.innerHTML = (n === TPR2_WIZ_STEPS.length) ? '💾 Simpan & Selesai' : `Berikutnya: ${TPR2_WIZ_STEPS[n]?.label || ''} →`;
  // Render input + preview
  tpr2WizRenderInputPane(step);
  tpr2WizRenderPreview();
}

// Render input pane untuk step tertentu
// Field input di sini di-bind ke ID lama lewat oninput handler yang panggil
// document.getElementById(idLama).value = this.value, supaya save tetap konsisten.
function tpr2WizRenderInputPane(step){
  const host = document.getElementById('tpr2-wiz-input');
  if(!host) return;
  const head = `<div class="tpr2-wiz-input-head">
    <div class="tpr2-card-icon" style="background:${step.bg};color:${step.color};">${step.icon}</div>
    <h4>${step.label}</h4>
  </div>`;
  let body = '';
  switch(step.key){
    case 'place':
      body = `<p class="tpr2-wiz-hint">Field lokasi & lingkungan dari Field Manager → Place. Kalau belum ada custom field di FM, tambah di Hub Formula.</p>
        <div class="tpr2-wiz-fmnote">📍 Field Place dari Field Manager akan muncul di sini setelah ditambahkan.</div>`;
      break;
    case 'product':
      body = `<p class="tpr2-wiz-hint">Spesifikasi unit dominan di perumahan ini.</p>
        <div class="tpr2-grid-2">
          <div class="ef"><label>📐 Luas Tanah</label><input type="text" value="${_v('tpr-lt')}" placeholder="60-90 m²" oninput="_wizSync('tpr-lt',this.value)"></div>
          <div class="ef"><label>📐 Luas Bangunan</label><input type="text" value="${_v('tpr-lb')}" placeholder="26-31 m²" oninput="_wizSync('tpr-lb',this.value)"></div>
        </div>
        <p class="tpr2-wiz-hint" style="margin-top:8px;">💡 Field lain (custom Product) muncul di <strong>Mode Card</strong>.</p>`;
      break;
    case 'price':
      body = `<p class="tpr2-wiz-hint">Harga, KPR, bank dominan, nominal FLPP.</p>
        <div class="tpr2-grid-2">
          <div class="ef"><label>💰 Harga Range</label><input type="text" value="${_v('tpr-harga')}" placeholder="150-175 Jt" oninput="_wizSync('tpr-harga',this.value)"></div>
          <div class="ef"><label>🏦 Bank Dominan</label><input type="text" value="${_v('tpr-bank')}" placeholder="BTN" oninput="_wizSync('tpr-bank',this.value)"></div>
          <div class="ef"><label>📅 Tenor Dominan</label><input type="text" value="${_v('tpr-tenor')}" placeholder="15-20 Tahun" oninput="_wizSync('tpr-tenor',this.value)"></div>
          <div class="ef"><label>💳 Uang Muka Range</label><input type="text" value="${_v('tpr-um')}" placeholder="2-3%" oninput="_wizSync('tpr-um',this.value)"></div>
          <div class="ef" style="grid-column:span 2;"><label>💵 Nominal FLPP (Miliar Rp)</label><input type="number" value="${_v('tpr-nominal')}" step="0.1" min="0" oninput="_wizSync('tpr-nominal',this.value)"></div>
        </div>`;
      break;
    case 'promotion':
      body = `<p class="tpr2-wiz-hint">Aktivitas promo & marketing yang sedang berjalan. Kosongkan kalau tidak tahu.</p>
        <div class="tpr2-grid-2">
          <div class="ef"><label>🎁 Promo Aktif</label><input type="text" value="${_v('tpr-promo-aktif')}" oninput="_wizSync('tpr-promo-aktif',this.value)"></div>
          <div class="ef"><label>📅 Periode Promo</label><input type="text" value="${_v('tpr-promo-periode')}" oninput="_wizSync('tpr-promo-periode',this.value)"></div>
          <div class="ef"><label>🎉 Bonus Pembelian</label><input type="text" value="${_v('tpr-promo-bonus')}" oninput="_wizSync('tpr-promo-bonus',this.value)"></div>
          <div class="ef"><label>📱 Iklan di Platform</label><input type="text" value="${_v('tpr-promo-iklan')}" oninput="_wizSync('tpr-promo-iklan',this.value)"></div>
          <div class="ef" style="grid-column:span 2;"><label>📢 Billboard/Spanduk</label><input type="text" value="${_v('tpr-promo-bb')}" oninput="_wizSync('tpr-promo-bb',this.value)"></div>
        </div>`;
      break;
    case 'performance':
      body = `<p class="tpr2-wiz-hint">Total realisasi, bulanan, dan profil pembeli. Editor visual lengkap di <strong>Mode Card</strong>.</p>
        <div class="ef"><label>Total Realisasi (unit)</label>
          <input type="number" value="${_v('tpr-total')}" min="0" oninput="_wizSync('tpr-total',this.value)"></div>
        <div style="margin-top:10px;">
          <label style="font-size:11px;color:var(--muted);">Realisasi bulanan</label>
          <div class="tpr2-bul-add-row" style="margin-top:4px;">
            <input type="month" id="tpr2-wiz-bul-month">
            <input type="number" id="tpr2-wiz-bul-unit" placeholder="unit" min="0">
            <button type="button" class="btn-sm-primary" onclick="tpr2WizBulAdd()">+ Tambah</button>
          </div>
          <div class="tpr2-bul-chips" id="tpr2-wiz-bul-chips"></div>
          <details class="tpr2-wiz-rawtoggle"><summary>📋 Atau paste raw text</summary>
            <textarea rows="2" class="tpr2-bul-raw-textarea" placeholder="2024-01:7, 2024-02:8" oninput="_wizSync('tpr-bulanan',this.value);tpr2OnRawBulananInput()">${_v('tpr-bulanan')}</textarea>
          </details>
        </div>
        <div class="tpr2-grid-2" style="margin-top:10px;">
          <div class="ef"><label>💼 Pekerjaan</label><input type="text" value="${_v('tpr-pekerjaan')}" placeholder="swasta:89, wira:8" oninput="_wizSync('tpr-pekerjaan',this.value);tpr2OnRawProfilInput('pekerjaan',this.value)"></div>
          <div class="ef"><label>🎂 Usia</label><input type="text" value="${_v('tpr-usia')}" placeholder="19-25:42, 26-30:28" oninput="_wizSync('tpr-usia',this.value);tpr2OnRawProfilInput('usia',this.value)"></div>
          <div class="ef"><label>💴 Penghasilan</label><input type="text" value="${_v('tpr-penghasilan')}" placeholder="3-4Jt:30, 4-5Jt:40" oninput="_wizSync('tpr-penghasilan',this.value);tpr2OnRawProfilInput('penghasilan',this.value)"></div>
          <div class="ef"><label>🚻 Gender</label><input type="text" value="${_v('tpr-gender')}" placeholder="L:58, P:42" oninput="_wizSync('tpr-gender',this.value);tpr2OnRawProfilInput('gender',this.value)"></div>
        </div>`;
      break;
    case 'gtm':
      body = `<p class="tpr2-wiz-hint">Struktur tim jualan & cara mereka go-to-market.</p>
        <div class="tpr2-grid-2">
          <div class="ef"><label>👥 Marketing In-house</label><input type="number" value="${_v('tpr-gtm-mkt')}" min="0" oninput="_wizSync('tpr-gtm-mkt',this.value)"></div>
          <div class="ef"><label>🏢 Struktur Kanal</label><input type="text" value="${_v('tpr-gtm-kanal')}" oninput="_wizSync('tpr-gtm-kanal',this.value)"></div>
          <div class="ef"><label>🤝 Jumlah Agent</label><input type="number" value="${_v('tpr-gtm-agent')}" min="0" oninput="_wizSync('tpr-gtm-agent',this.value)"></div>
          <div class="ef"><label>🏪 Brand Developer</label><input type="text" value="${_v('tpr-gtm-dev')}" oninput="_wizSync('tpr-gtm-dev',this.value)"></div>
          <div class="ef"><label>💵 Fee Marketing</label><input type="text" value="${_v('tpr-gtm-fee-mkt')}" oninput="_wizSync('tpr-gtm-fee-mkt',this.value)"></div>
          <div class="ef"><label>💵 Fee Agent</label><input type="text" value="${_v('tpr-gtm-fee-agt')}" oninput="_wizSync('tpr-gtm-fee-agt',this.value)"></div>
        </div>`;
      break;
  }
  host.innerHTML = head + body;
  // Special init: bulanan picker chips
  // Special init: performance step punya picker bulanan chips
  if(step.key === 'performance') tpr2WizRenderBulChips();
}

// Helper: ambil value dari ID lama (kosong-safe + escape)
function _v(id){
  const el = document.getElementById(id);
  const v = el ? (el.value || '') : '';
  return String(v).replace(/"/g, '&quot;');
}

// Helper: sync wizard input → ID lama + trigger refresh
function _wizSync(id, val){
  const el = document.getElementById(id);
  if(el){ el.value = val; }
  tpr2OnFieldInput();
}

// Wizard bulanan add/render — pakai TPR2_STATE.bulanan langsung
function tpr2WizBulAdd(){
  const monthEl = document.getElementById('tpr2-wiz-bul-month');
  const unitEl = document.getElementById('tpr2-wiz-bul-unit');
  const month = monthEl?.value;
  const unit = parseInt(unitEl?.value);
  if(!month || !/^\d{4}-\d{2}$/.test(month)){ showToast('⚠ Pilih bulan dulu'); return; }
  if(isNaN(unit) || unit < 0){ showToast('⚠ Isi unit'); return; }
  const idx = TPR2_STATE.bulanan.findIndex(b => b.bulan === month);
  if(idx >= 0) TPR2_STATE.bulanan[idx].unit = unit;
  else TPR2_STATE.bulanan.push({ bulan: month, unit: unit });
  TPR2_STATE.bulanan.sort((a,b) => a.bulan.localeCompare(b.bulan));
  tpr2SyncBulananToTextarea();
  tpr2WizRenderBulChips();
  tpr2RenderBulananPicker();   // sync ke mode card juga
  tpr2RenderBulananChart();
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
  tpr2WizRenderPreview();
  if(monthEl) monthEl.value = '';
  if(unitEl) unitEl.value = '';
}

function tpr2WizRenderBulChips(){
  const host = document.getElementById('tpr2-wiz-bul-chips');
  if(!host) return;
  if(TPR2_STATE.bulanan.length === 0){
    host.innerHTML = '<div class="tpr2-bul-empty">Belum ada bulan.</div>';
    return;
  }
  const sorted = [...TPR2_STATE.bulanan].sort((a,b) => b.bulan.localeCompare(a.bulan));
  host.innerHTML = sorted.map(b => {
    return `<div class="tpr2-bul-chip">
      <span class="tpr2-bul-chip-label">${escapeHtml(b.bulan)}</span>
      <span class="tpr2-bul-chip-input" style="display:inline-flex;align-items:center;width:auto;padding:0 6px;font-weight:500;">${b.unit}</span>
      <span class="tpr2-bul-chip-unit">unit</span>
      <button type="button" class="tpr2-bul-chip-remove" onclick="tpr2BulananRemove('${b.bulan}');tpr2WizRenderBulChips();tpr2WizRenderPreview();">✕</button>
    </div>`;
  }).join('');
}

// Render preview pane berdasarkan step aktif
function tpr2WizRenderPreview(){
  const host = document.getElementById('tpr2-wiz-preview');
  if(!host) return;
  const n = TPR2_STATE.wizStep;
  const step = TPR2_WIZ_STEPS[n - 1];
  if(!step){ host.innerHTML = ''; return; }
  let html = `<div class="tpr2-wiz-preview-head"><span class="tpr2-wiz-preview-dot"></span>Live preview</div>`;
  switch(step.key){
    case 'place': {
      // Place: tampilkan info FM custom fields yg terisi (kalau ada)
      const customFields = (FM_STATE?.customFields?.place || []).filter(f => !_isFieldHidden?.(f.id));
      if(customFields.length === 0){
        html += `<div class="tpr2-wiz-empty">Belum ada custom field Place. Tambah lewat Hub Formula → Field Manager → Place.</div>`;
      } else {
        const filled = customFields.filter(f => {
          const el = document.getElementById(`tpr-custom-${f.id}`);
          return el && (el.value||'').trim();
        }).length;
        html += `<div class="tpr2-wiz-stat-grid">
          <div class="tpr2-wiz-stat"><div class="lbl">Custom field aktif</div><div class="val">${customFields.length}<small> field</small></div></div>
          <div class="tpr2-wiz-stat"><div class="lbl">Sudah terisi</div><div class="val">${filled}<small> dari ${customFields.length}</small></div></div>
        </div>`;
      }
      break;
    }
    case 'product': {
      const lt = document.getElementById('tpr-lt')?.value?.trim();
      const lb = document.getElementById('tpr-lb')?.value?.trim();
      html += `<div class="tpr2-wiz-spec-list">
        <div class="tpr2-wiz-spec-row${lt ? ' filled' : ''}"><span class="lbl">Luas Tanah</span><span class="val">${lt ? escapeHtml(lt) : '—'}</span></div>
        <div class="tpr2-wiz-spec-row${lb ? ' filled' : ''}"><span class="lbl">Luas Bangunan</span><span class="val">${lb ? escapeHtml(lb) : '—'}</span></div>
      </div>`;
      const customFields = (FM_STATE?.customFields?.product || []).filter(f => !_isFieldHidden?.(f.id));
      if(customFields.length){
        html += `<div class="tpr2-wiz-insight">+ ${customFields.length} custom field Product (lihat Mode Card untuk edit).</div>`;
      }
      break;
    }
    case 'price': {
      const fields = [
        ['Harga', 'tpr-harga'], ['Bank', 'tpr-bank'],
        ['Tenor', 'tpr-tenor'], ['UM', 'tpr-um'], ['Nominal FLPP', 'tpr-nominal']
      ];
      html += `<div class="tpr2-wiz-spec-list">` +
        fields.map(([lbl, id]) => {
          const v = document.getElementById(id)?.value?.trim() || '';
          return `<div class="tpr2-wiz-spec-row${v ? ' filled' : ''}"><span class="lbl">${lbl}</span><span class="val">${v ? escapeHtml(v) : '—'}</span></div>`;
        }).join('') + `</div>`;
      const filled = fields.filter(([_, id]) => (document.getElementById(id)?.value||'').trim()).length;
      if(filled === fields.length){
        html += `<div class="tpr2-wiz-insight">✓ Semua ${filled} field Price terisi.</div>`;
      } else {
        html += `<div class="tpr2-wiz-insight">${filled} dari ${fields.length} field terisi.</div>`;
      }
      break;
    }
    case 'promotion': {
      const promo = document.getElementById('tpr-promo-aktif')?.value?.trim();
      const periode = document.getElementById('tpr-promo-periode')?.value?.trim();
      const bonus = document.getElementById('tpr-promo-bonus')?.value?.trim();
      const iklan = document.getElementById('tpr-promo-iklan')?.value?.trim();
      const bb = document.getElementById('tpr-promo-bb')?.value?.trim();
      if(!promo && !periode && !bonus && !iklan && !bb){
        html += `<div class="tpr2-wiz-empty">Belum ada data promo. Isi minimal 1 field.</div>`;
      } else {
        html += `<div class="tpr2-wiz-spec-list">
          <div class="tpr2-wiz-spec-row${promo ? ' filled' : ''}"><span class="lbl">Promo</span><span class="val">${promo ? escapeHtml(promo) : '—'}</span></div>
          <div class="tpr2-wiz-spec-row${periode ? ' filled' : ''}"><span class="lbl">Periode</span><span class="val">${periode ? escapeHtml(periode) : '—'}</span></div>
          <div class="tpr2-wiz-spec-row${bonus ? ' filled' : ''}"><span class="lbl">Bonus</span><span class="val">${bonus ? escapeHtml(bonus) : '—'}</span></div>
          <div class="tpr2-wiz-spec-row${iklan ? ' filled' : ''}"><span class="lbl">Iklan</span><span class="val">${iklan ? escapeHtml(iklan) : '—'}</span></div>
          <div class="tpr2-wiz-spec-row${bb ? ' filled' : ''}"><span class="lbl">Billboard</span><span class="val">${bb ? escapeHtml(bb) : '—'}</span></div>
        </div>`;
      }
      break;
    }
    case 'performance': {
      const total = parseInt(document.getElementById('tpr-total')?.value) || 0;
      const bul = TPR2_STATE.bulanan;
      const pDims = ['pekerjaan','usia','penghasilan','gender'];
      const pFilled = pDims.filter(k => Object.keys(TPR2_STATE.profil[k] || {}).length > 0).length;

      // Stat
      html += `<div class="tpr2-wiz-stat-grid">
        <div class="tpr2-wiz-stat"><div class="lbl">Total realisasi</div><div class="val">${total ? fmt(total) : '—'}<small>${total ? ' unit' : ''}</small></div></div>
        <div class="tpr2-wiz-stat"><div class="lbl">Bulan terisi</div><div class="val">${bul.length}<small>${bul.length ? ' bulan' : ''}</small></div></div>
      </div>`;

      // Chart bulanan kalau ada
      if(bul.length > 0){
        const max = Math.max(1, ...bul.map(b => b.unit));
        const peak = bul.reduce((a,b) => b.unit > a.unit ? b : a, bul[0]);
        const sum = bul.reduce((a,b) => a + b.unit, 0);
        const avg = (sum / bul.length).toFixed(1);
        html += `<div class="tpr2-wiz-chart">
          ${bul.map(b => {
            const h = Math.max(2, Math.round((b.unit / max) * 100));
            const isPeak = b.bulan === peak.bulan;
            return `<div class="tpr2-wiz-chart-bar${isPeak ? ' peak' : ''}" style="height:${h}%;" title="${b.bulan}: ${b.unit}"></div>`;
          }).join('')}
        </div>
        <div class="tpr2-wiz-chart-axis"><span>${bul[0].bulan}</span><span>★ ${peak.bulan}</span><span>${bul[bul.length-1].bulan}</span></div>
        <div class="tpr2-wiz-stat-grid">
          <div class="tpr2-wiz-stat"><div class="lbl">Rata² / bulan</div><div class="val">${avg}<small> unit</small></div></div>
          <div class="tpr2-wiz-stat"><div class="lbl">Puncak</div><div class="val">${peak.unit}<small> · ${peak.bulan}</small></div></div>
        </div>`;
      }

      // Persona
      if(pFilled > 0){
        const pek = TPR2_STATE.profil.pekerjaan;
        const usia = TPR2_STATE.profil.usia;
        const peng = TPR2_STATE.profil.penghasilan;
        if(pek && Object.keys(pek).length && usia && Object.keys(usia).length){
          const topPek = Object.entries(pek).sort((a,b) => b[1] - a[1])[0];
          const topUsia = Object.entries(usia).sort((a,b) => b[1] - a[1])[0];
          const topPeng = peng && Object.keys(peng).length ? Object.entries(peng).sort((a,b) => b[1] - a[1])[0] : null;
          let persona = `${escapeHtml(topPek[0])} usia ${escapeHtml(topUsia[0])}`;
          if(topPeng) persona += `, penghasilan ${escapeHtml(topPeng[0])}`;
          html += `<div class="tpr2-wiz-insight">🎯 Persona target: <strong>${persona}</strong>.</div>`;
        } else {
          html += `<div class="tpr2-wiz-insight">${pFilled} dari 4 dimensi profil terisi.</div>`;
        }
      }
      break;
    }
    case 'gtm': {
      const mkt = document.getElementById('tpr-gtm-mkt')?.value;
      const agent = document.getElementById('tpr-gtm-agent')?.value;
      const kanal = document.getElementById('tpr-gtm-kanal')?.value?.trim();
      const dev = document.getElementById('tpr-gtm-dev')?.value?.trim();
      const totalTeam = (parseInt(mkt) || 0) + (parseInt(agent) || 0);
      html += `<div class="tpr2-wiz-stat-grid">
        <div class="tpr2-wiz-stat"><div class="lbl">In-house</div><div class="val">${mkt || '—'}<small>${mkt ? ' org' : ''}</small></div></div>
        <div class="tpr2-wiz-stat"><div class="lbl">Agent</div><div class="val">${agent || '—'}<small>${agent ? ' agent' : ''}</small></div></div>
        <div class="tpr2-wiz-stat"><div class="lbl">Total tim</div><div class="val">${totalTeam || '—'}<small>${totalTeam ? ' org' : ''}</small></div></div>
      </div>`;
      if(kanal || dev){
        html += `<div class="tpr2-wiz-spec-list" style="margin-top:8px;">
          ${kanal ? `<div class="tpr2-wiz-spec-row filled"><span class="lbl">Kanal</span><span class="val">${escapeHtml(kanal)}</span></div>` : ''}
          ${dev ? `<div class="tpr2-wiz-spec-row filled"><span class="lbl">Developer</span><span class="val">${escapeHtml(dev)}</span></div>` : ''}
        </div>`;
      }
      if(totalTeam >= 10){
        html += `<div class="tpr2-wiz-insight">💪 Tim cukup besar (${totalTeam} orang) — kapasitas jualan kuat.</div>`;
      } else if(totalTeam > 0 && totalTeam < 5){
        html += `<div class="tpr2-wiz-insight">⚠ Tim kecil (${totalTeam} orang) — bisa jadi bottleneck velocity.</div>`;
      }
      break;
    }
  }
  host.innerHTML = html;
}



// ============================================================
// [SIKUMBANG v2] Editor form untuk data Sikumbang per perumahan
// Mirror dashboard sikumbang.tapera.go.id — split Komersil + Subsidi × 5 status
// ============================================================

// State internal Sikumbang
const SKB_STATE = {
  mode: 'card',  // 'card' | 'flat'
  cardOpen: { identitas:true, stok:true, galeri:false, crosscheck:false, insight:false }
};

// ─── INIT & FORM LOAD/SAVE ──────────────────────────────────────

function initSikumbangEditor(){
  const sel = document.getElementById('skb-select');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = perumahan.map(p => {
    const has = p.sikumbang ? '✓' : '—';
    return `<option value="${p.id}">${has} ${escapeHtml(p.nama)}</option>`;
  }).join('');
  if(current && perumahan.some(p => String(p.id) === String(current))) sel.value = current;
  loadSikumbangForm(sel.value);
  // Counter badge
  const cnt = document.getElementById('ecnt-sikumbang');
  if(cnt){
    const n = perumahan.filter(p => p.sikumbang).length;
    cnt.textContent = n ? `(${n})` : '';
  }
  // Restore mode dari localStorage
  try {
    const savedMode = localStorage.getItem('bm4_skb_mode') || 'card';
    skbSwitchMode(savedMode === 'flat' ? 'flat' : 'card');
  } catch(_){ skbSwitchMode('card'); }
}

// Helper: migrasi data lama (struktur v1) ke struktur v2
function _skbMigrate(s){
  if(!s) return null;
  // Sudah struktur v2 (ada komersil/subsidi nested) — pastikan galeri ada
  if(s.komersil && s.subsidi){
    if(!Array.isArray(s.galeri)) s.galeri = [];
    return s;
  }
  // Struktur v1 lama: unitTerjual/readyStock/kavling — assume semua subsidi
  const v2 = {
    idLokasi: s.idLokasi || '',
    status: s.status || '',
    tahunMulai: s.tahunMulai || null,
    komersil: { kavling:0, pembangunan:0, ready:0, dipesan:0, terjual:0 },
    subsidi:  { kavling:0, pembangunan:0, ready:0, proses:0, terjual:0 },
    galeri: Array.isArray(s.galeri) ? s.galeri : [],
    lastSynced: s.lastSynced || '',
    syncedBy: s.syncedBy || ''
  };
  // Map v1 → v2 subsidi (anggap semua data lama itu subsidi)
  if(typeof s.unitTerjual === 'number') v2.subsidi.terjual = s.unitTerjual;
  if(typeof s.readyStock === 'number') v2.subsidi.ready = s.readyStock;
  if(typeof s.kavling === 'number') v2.subsidi.kavling = s.kavling;
  return v2;
}

function loadSikumbangForm(id){
  const p = perumahan.find(x => String(x.id) === String(id));
  const formEl = document.getElementById('skb-form');
  const statusEl = document.getElementById('skb-status');
  if(!p){ if(formEl) formEl.style.display = 'none'; return; }
  if(formEl) formEl.style.display = 'block';

  const s = _skbMigrate(p.sikumbang) || {};
  const k = s.komersil || {};
  const su = s.subsidi || {};

  const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = v == null ? '' : v; };
  set('skb-id-lokasi', s.idLokasi);
  set('skb-status-proj', s.status || '');
  set('skb-tahun', s.tahunMulai);

  // Komersil
  set('skb-k-kavling', k.kavling || '');
  set('skb-k-pembangunan', k.pembangunan || '');
  set('skb-k-ready', k.ready || '');
  set('skb-k-dipesan', k.dipesan || '');
  set('skb-k-terjual', k.terjual || '');
  // Subsidi
  set('skb-s-kavling', su.kavling || '');
  set('skb-s-pembangunan', su.pembangunan || '');
  set('skb-s-ready', su.ready || '');
  set('skb-s-proses', su.proses || '');
  set('skb-s-terjual', su.terjual || '');

  // Status badge
  if(statusEl){
    if(s.lastSynced) statusEl.textContent = `✓ Update ${s.lastSynced}`;
    else if(p.sikumbang) statusEl.textContent = '✓ Ada data';
    else statusEl.textContent = 'Belum ada data';
  }
  // Sync info
  const line1 = document.getElementById('skb-sync-line1');
  const line2 = document.getElementById('skb-sync-line2');
  if(line1 && line2){
    if(s.lastSynced){
      line1.textContent = `Last sync: ${s.lastSynced}`;
      line2.textContent = s.syncedBy ? `oleh ${s.syncedBy}` : 'oleh tim BM4';
    } else {
      line1.textContent = 'Belum pernah disinkron';
      line2.textContent = 'isi data lalu klik Simpan untuk merekam waktu sync';
    }
  }

  // Refresh visual
  skbRefreshAll();
}

function saveSikumbangForm(){
  const id = document.getElementById('skb-select').value;
  const p = perumahan.find(x => String(x.id) === String(id));
  if(!p){ showToast('⚠ Perumahan tidak ditemukan'); return; }
  const getN = (id) => { const v = parseInt(document.getElementById(id)?.value); return isNaN(v) ? 0 : v; };
  const getS = (id) => (document.getElementById(id)?.value || '').trim();

  const idLokasi = getS('skb-id-lokasi');
  const status = getS('skb-status-proj');
  const tahun = (function(){ const v = parseInt(getS('skb-tahun')); return isNaN(v) ? null : v; })();

  const komersil = {
    kavling: getN('skb-k-kavling'),
    pembangunan: getN('skb-k-pembangunan'),
    ready: getN('skb-k-ready'),
    dipesan: getN('skb-k-dipesan'),
    terjual: getN('skb-k-terjual')
  };
  const subsidi = {
    kavling: getN('skb-s-kavling'),
    pembangunan: getN('skb-s-pembangunan'),
    ready: getN('skb-s-ready'),
    proses: getN('skb-s-proses'),
    terjual: getN('skb-s-terjual')
  };

  const totK = Object.values(komersil).reduce((a,b) => a+b, 0);
  const totS = Object.values(subsidi).reduce((a,b) => a+b, 0);

  if(totK === 0 && totS === 0 && !idLokasi && !status && tahun === null){
    // Cek dulu — kalau galeri ada, masih boleh save
    const existingGaleri = p.sikumbang?.galeri || [];
    if(existingGaleri.length === 0){
      showToast('⚠ Isi minimal 1 field sebelum simpan');
      return;
    }
  }

  // Get current user
  let userName = '';
  try {
    if(typeof CURRENT_USER !== 'undefined' && CURRENT_USER) userName = CURRENT_USER.nama || CURRENT_USER.username || '';
    else if(window.CURRENT_USER) userName = window.CURRENT_USER.nama || window.CURRENT_USER.username || '';
  } catch(_){}

  // Preserve galeri yang sudah ada (jangan ke-overwrite saat save form)
  const existingGaleri = (p.sikumbang?.galeri && Array.isArray(p.sikumbang.galeri)) ? p.sikumbang.galeri : [];

  p.sikumbang = {
    idLokasi: idLokasi,
    status: status,
    tahunMulai: tahun,
    komersil: komersil,
    subsidi: subsidi,
    galeri: existingGaleri,
    lastSynced: new Date().toISOString().slice(0,10),
    syncedBy: userName || 'tim BM4'
  };
  try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(_){}
  if(typeof setEditorDirty === 'function') try { setEditorDirty(true); } catch(_){}
  initSikumbangEditor();
  showToast(`✓ Data Sikumbang "${p.nama}" disimpan`);
  if(typeof selectedId !== 'undefined' && selectedId === p.id && typeof renderDetailOverview === 'function'){
    try { renderDetailOverview(p); } catch(_){}
  }
}

function clearSikumbangData(){
  const id = document.getElementById('skb-select').value;
  const p = perumahan.find(x => String(x.id) === String(id));
  if(!p){ return; }
  if(!p.sikumbang){ showToast('⚠ Belum ada data Sikumbang untuk dihapus'); return; }
  if(!confirm(`Hapus data Sikumbang untuk "${p.nama}"?`)) return;
  delete p.sikumbang;
  try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(_){}
  if(typeof setEditorDirty === 'function') try { setEditorDirty(true); } catch(_){}
  initSikumbangEditor();
  showToast(`🗑 Data Sikumbang "${p.nama}" dihapus`);
}

// ─── MODE TOGGLE & CARD COLLAPSIBLE ─────────────────────────────

function skbSwitchMode(mode){
  SKB_STATE.mode = mode;
  document.getElementById('skb-mode-btn-card')?.classList.toggle('active', mode === 'card');
  document.getElementById('skb-mode-btn-flat')?.classList.toggle('active', mode === 'flat');
  const cards = document.querySelectorAll('#etab-sikumbang .tpr2-card[data-skb-card]');
  cards.forEach(c => {
    if(mode === 'flat'){
      c.classList.remove('collapsed');
      c.classList.add('skb-flat-mode');
    } else {
      c.classList.remove('skb-flat-mode');
      const key = c.getAttribute('data-skb-card');
      if(SKB_STATE.cardOpen[key] === false) c.classList.add('collapsed');
      else c.classList.remove('collapsed');
    }
  });
  try { localStorage.setItem('bm4_skb_mode', mode); } catch(_){}
}

function skbToggleCard(cardId){
  if(SKB_STATE.mode === 'flat') return;
  const card = document.querySelector(`#etab-sikumbang .tpr2-card[data-skb-card="${cardId}"]`);
  if(!card) return;
  card.classList.toggle('collapsed');
  SKB_STATE.cardOpen[cardId] = !card.classList.contains('collapsed');
}

// ─── REFRESH UI ─────────────────────────────────────────────────

function skbRefreshAll(){
  skbRenderStockBar();
  skbRefreshSummaries();
  skbRenderInsight();
  skbCrossCheckTapera();
  skbUpdateSiteplanLink();
  skbRenderGaleri();
}

function skbOnFieldInput(){
  skbRenderStockBar();
  skbRefreshSummaries();
  skbRenderInsight();
  skbCrossCheckTapera();
  skbUpdateSiteplanLink();
}

// Helper: ambil semua angka komersil dan subsidi
function _skbReadStock(){
  const getN = (id) => { const v = parseInt(document.getElementById(id)?.value); return isNaN(v) ? 0 : v; };
  return {
    k: {
      kavling: getN('skb-k-kavling'),
      pembangunan: getN('skb-k-pembangunan'),
      ready: getN('skb-k-ready'),
      dipesan: getN('skb-k-dipesan'),
      terjual: getN('skb-k-terjual')
    },
    s: {
      kavling: getN('skb-s-kavling'),
      pembangunan: getN('skb-s-pembangunan'),
      ready: getN('skb-s-ready'),
      proses: getN('skb-s-proses'),
      terjual: getN('skb-s-terjual')
    }
  };
}

function _skbSum(o){ return Object.values(o).reduce((a,b) => a+b, 0); }

function skbRefreshSummaries(){
  const setSum = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };

  const stk = _skbReadStock();
  const totK = _skbSum(stk.k);
  const totS = _skbSum(stk.s);
  const total = totK + totS;

  // Update jenis program auto-detect
  const jenisEl = document.getElementById('skb-jenis');
  if(jenisEl){
    if(totK > 0 && totS > 0) jenisEl.value = '★ Campuran';
    else if(totK > 0) jenisEl.value = 'Komersil only';
    else if(totS > 0) jenisEl.value = 'Subsidi only';
    else jenisEl.value = '';
  }

  // Update total per segmen
  const totKEl = document.getElementById('skb-tot-komersil');
  const totSEl = document.getElementById('skb-tot-subsidi');
  if(totKEl) totKEl.textContent = totK;
  if(totSEl) totSEl.textContent = totS;

  // Identitas summary
  const idLokasi = (document.getElementById('skb-id-lokasi')?.value || '').trim();
  const status = document.getElementById('skb-status-proj')?.value;
  const STATUS_LABEL = { aktif:'🟢 Aktif', soldout:'🔴 Sold out', launching:'🟡 Segera launching' };
  const parts = [];
  if(idLokasi) parts.push(idLokasi);
  if(status) parts.push(STATUS_LABEL[status] || status);
  setSum('skb-sum-identitas', parts.length ? parts.join(' · ') : '— belum diisi');

  // Stok summary
  if(total === 0){
    setSum('skb-sum-stok', '— belum diisi');
  } else {
    const terjualTotal = stk.k.terjual + stk.s.terjual;
    const sellPct = Math.round(terjualTotal / total * 100);
    const segLbl = totK > 0 && totS > 0 ? `${totK} K + ${totS} S` :
                   totK > 0 ? `${totK} komersil` : `${totS} subsidi`;
    setSum('skb-sum-stok', `${total} unit · ${segLbl} · ${sellPct}% terjual`);
  }
}

// ─── VISUAL STACK BAR (overall) ─────────────────────────────────

function skbRenderStockBar(){
  const wrap = document.getElementById('skb-overall-wrap');
  const bar = document.getElementById('skb-overall-bar');
  const totalEl = document.getElementById('skb-overall-total');
  const legendEl = document.getElementById('skb-overall-legend');
  if(!wrap || !bar) return;

  const stk = _skbReadStock();
  const total = _skbSum(stk.k) + _skbSum(stk.s);

  if(total === 0){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if(totalEl) totalEl.textContent = total;

  // Combined view: 5 categories cross-segment
  const categories = [
    { lbl: 'Terjual',     color: '#A32D2D', val: stk.k.terjual + stk.s.terjual },
    { lbl: 'Proses bank', color: '#378ADD', val: stk.s.proses },
    { lbl: 'Dipesan',     color: '#534AB7', val: stk.k.dipesan },
    { lbl: 'Ready',       color: '#1D9E75', val: stk.k.ready + stk.s.ready },
    { lbl: 'Pembangunan', color: '#EF9F27', val: stk.k.pembangunan + stk.s.pembangunan },
    { lbl: 'Kavling',     color: '#FAC775', val: stk.k.kavling + stk.s.kavling }
  ];

  const segments = categories.filter(c => c.val > 0);
  bar.innerHTML = segments.map(c => {
    const pct = (c.val / total * 100);
    const showLabel = pct >= 8;
    return `<div class="skb-overall-seg" style="width:${pct}%;background:${c.color};">${showLabel ? `${c.lbl} ${c.val}` : ''}</div>`;
  }).join('');

  if(legendEl){
    legendEl.innerHTML = segments.map(c => {
      const pct = Math.round(c.val / total * 100);
      return `<span><span class="skb-legend-dot" style="background:${c.color};"></span>${c.lbl} ${pct}%</span>`;
    }).join('');
  }
}

// ─── SITEPLAN LINK + EMBED IFRAME ───────────────────────────────

function skbUpdateSiteplanLink(){
  const idLokasi = (document.getElementById('skb-id-lokasi')?.value || '').trim();
  const wrap = document.getElementById('skb-siteplan-link-wrap');
  const linkEl = document.getElementById('skb-siteplan-link');
  const urlEl = document.getElementById('skb-siteplan-url');
  if(!wrap) return;
  if(!idLokasi){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  // Format URL Sikumbang
  const url = `https://sikumbang.tapera.go.id/lokasi-perumahan/${encodeURIComponent(idLokasi)}/siteplan`;
  if(linkEl) linkEl.href = url;
  if(urlEl) urlEl.textContent = url.replace('https://','');
}

// ─── DRIVE IMAGE URL HELPER (reusable) ─────────────────────────

// Convert berbagai format URL Google Drive → direct thumbnail URL yang bisa di-<img>
// Input contoh:
//   https://drive.google.com/file/d/1abc...XYZ/view?usp=sharing
//   https://drive.google.com/open?id=1abc...XYZ
//   https://drive.google.com/uc?id=1abc...XYZ
//   https://drive.google.com/thumbnail?id=1abc...XYZ
// Output: https://drive.google.com/thumbnail?id={ID}&sz=w2000
// Atau null kalau bukan URL Drive.
function _driveExtractId(url){
  if(!url || typeof url !== 'string') return null;
  url = url.trim();
  // Pattern 1: /file/d/ID/view atau /file/d/ID/...
  let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
  if(m) return m[1];
  // Pattern 2: ?id=ID atau &id=ID
  m = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if(m) return m[1];
  // Pattern 3: /open?id=ID (sudah di-handle pattern 2)
  return null;
}
function _driveToImageUrl(url, size = 'w2000'){
  if(!url) return null;
  // Kalau bukan Drive URL, return apa adanya (mungkin URL gambar dari sumber lain)
  const id = _driveExtractId(url);
  if(!id){
    // Validasi minimal: harus URL gambar valid
    if(/^https?:\/\//.test(url)) return url;
    return null;
  }
  return `https://drive.google.com/thumbnail?id=${id}&sz=${size}`;
}
function _driveToOpenUrl(url){
  // URL untuk "Buka di Drive" — preview Drive penuh
  const id = _driveExtractId(url);
  if(!id) return url;
  return `https://drive.google.com/file/d/${id}/view`;
}

// ─── GALERI SITEPLAN ───────────────────────────────────────────

// Render daftar gambar galeri saat ini
function skbRenderGaleri(){
  const host = document.getElementById('skb-galeri-list');
  const sumEl = document.getElementById('skb-sum-galeri');
  if(!host) return;
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));
  const galeri = (p?.sikumbang?.galeri) || [];
  if(galeri.length === 0){
    host.innerHTML = '<div class="skb-galeri-empty">Belum ada gambar. Tambah lewat form di bawah ↓</div>';
    if(sumEl) sumEl.textContent = '— belum ada gambar';
    return;
  }
  host.innerHTML = galeri.map((g, idx) => {
    const imgUrl = _driveToImageUrl(g.url, 'w800');
    const fullUrl = _driveToImageUrl(g.url, 'w2000');
    const openUrl = _driveToOpenUrl(g.url);
    return `<div class="skb-galeri-item" data-galeri-idx="${idx}">
      <div class="skb-galeri-img-wrap">
        ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(g.label||'gambar')}" loading="lazy" onclick="skbGaleriZoom(${idx})" onerror="this.parentElement.classList.add('error');this.style.display='none';">` : ''}
        <div class="skb-galeri-error">⚠️ Gambar tidak bisa di-load. Cek sharing Drive (harus "Anyone with link").</div>
      </div>
      <div class="skb-galeri-meta">
        <div class="skb-galeri-label">${escapeHtml(g.label || 'Gambar')}</div>
        <div class="skb-galeri-actions">
          <button type="button" class="skb-galeri-btn" onclick="skbGaleriZoom(${idx})" title="Zoom full">🔍</button>
          <a href="${escapeHtml(openUrl)}" target="_blank" rel="noopener noreferrer" class="skb-galeri-btn" title="Buka di Drive">↗</a>
          <button type="button" class="skb-galeri-btn danger" onclick="skbGaleriRemove(${idx})" title="Hapus">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
  if(sumEl){
    const labels = galeri.map(g => g.label).filter(Boolean).slice(0,3).join(', ');
    sumEl.textContent = galeri.length + ' gambar' + (labels ? ' · ' + labels : '');
  }
}

function skbGaleriAdd(){
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));
  if(!p){ showToast('⚠ Perumahan tidak ditemukan'); return; }
  const labelSel = document.getElementById('skb-galeri-label')?.value || 'Lainnya';
  const labelCustom = (document.getElementById('skb-galeri-label-custom')?.value || '').trim();
  const url = (document.getElementById('skb-galeri-url')?.value || '').trim();
  const statusEl = document.getElementById('skb-galeri-add-status');

  if(!url){
    if(statusEl){ statusEl.textContent = '⚠ URL kosong. Paste link Google Drive dulu.'; statusEl.className = 'skb-galeri-add-status err'; }
    return;
  }
  // Validasi URL
  const driveId = _driveExtractId(url);
  if(!driveId && !/^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)/i.test(url)){
    if(statusEl){ statusEl.textContent = '⚠ Bukan URL Google Drive valid. Format: https://drive.google.com/file/d/.../view'; statusEl.className = 'skb-galeri-add-status err'; }
    return;
  }
  const label = labelSel === 'Lainnya' && labelCustom ? labelCustom : labelSel;

  // Tambah ke galeri
  if(!p.sikumbang) p.sikumbang = { idLokasi:'', status:'', tahunMulai:null, komersil:{kavling:0,pembangunan:0,ready:0,dipesan:0,terjual:0}, subsidi:{kavling:0,pembangunan:0,ready:0,proses:0,terjual:0}, galeri:[] };
  if(!Array.isArray(p.sikumbang.galeri)) p.sikumbang.galeri = [];
  p.sikumbang.galeri.push({
    url: url,
    label: label,
    addedAt: new Date().toISOString().slice(0,10)
  });
  // Save
  try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(_){}
  if(typeof setEditorDirty === 'function') try { setEditorDirty(true); } catch(_){}
  // Reset form
  document.getElementById('skb-galeri-url').value = '';
  document.getElementById('skb-galeri-label').value = 'Siteplan';
  document.getElementById('skb-galeri-label-custom').value = '';
  document.getElementById('skb-galeri-label-custom').style.display = 'none';
  if(statusEl){ statusEl.textContent = `✓ "${label}" ditambahkan ke galeri`; statusEl.className = 'skb-galeri-add-status ok'; setTimeout(() => { statusEl.textContent=''; statusEl.className='skb-galeri-add-status'; }, 4000); }
  skbRenderGaleri();
}

function skbGaleriRemove(idx){
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));
  if(!p?.sikumbang?.galeri) return;
  const item = p.sikumbang.galeri[idx];
  if(!item) return;
  if(!confirm(`Hapus gambar "${item.label || 'tanpa label'}" dari galeri?`)) return;
  p.sikumbang.galeri.splice(idx, 1);
  try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(_){}
  if(typeof setEditorDirty === 'function') try { setEditorDirty(true); } catch(_){}
  showToast('🗑 Gambar dihapus');
  skbRenderGaleri();
}

function skbGaleriZoom(idx){
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));
  const galeri = p?.sikumbang?.galeri || [];
  const item = galeri[idx];
  if(!item) return;
  const imgUrl = _driveToImageUrl(item.url, 'w2000');
  if(!imgUrl) return;
  // Simple modal zoom
  let modal = document.getElementById('skb-galeri-zoom-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'skb-galeri-zoom-modal';
    modal.className = 'skb-galeri-zoom-modal';
    modal.onclick = (e) => { if(e.target === modal) skbGaleriZoomClose(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="skb-galeri-zoom-inner">
      <div class="skb-galeri-zoom-head">
        <div class="skb-galeri-zoom-title">${escapeHtml(item.label || 'Gambar')}</div>
        <div class="skb-galeri-zoom-actions">
          <a href="${escapeHtml(_driveToOpenUrl(item.url))}" target="_blank" rel="noopener noreferrer" class="skb-galeri-btn">↗ Buka di Drive</a>
          <button type="button" class="skb-galeri-btn" onclick="skbGaleriZoomClose()">✕ Tutup</button>
        </div>
      </div>
      <div class="skb-galeri-zoom-body">
        <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(item.label||'')}">
      </div>
    </div>`;
  modal.style.display = 'flex';
}
function skbGaleriZoomClose(){
  const modal = document.getElementById('skb-galeri-zoom-modal');
  if(modal) modal.style.display = 'none';
}
function skbToggleGaleriHelp(){
  const help = document.getElementById('skb-galeri-help');
  if(help) help.style.display = help.style.display === 'none' ? 'block' : 'none';
}

// Listener: kalau label dropdown = "Lainnya", show input custom
(function(){
  document.addEventListener('change', (e) => {
    if(e.target?.id === 'skb-galeri-label'){
      const custom = document.getElementById('skb-galeri-label-custom');
      if(custom) custom.style.display = e.target.value === 'Lainnya' ? '' : 'none';
    }
  });
})();

// ─── INSIGHT STRATEGIS (auto-compute) ───────────────────────────

function skbRenderInsight(){
  const host = document.getElementById('skb-insight-content');
  const sumEl = document.getElementById('skb-sum-insight');
  if(!host) return;

  const stk = _skbReadStock();
  const totK = _skbSum(stk.k);
  const totS = _skbSum(stk.s);
  const total = totK + totS;

  if(total === 0){
    host.innerHTML = '<div class="skb-cross-empty">Isi data stok di atas untuk melihat sell-through rate, sisa inventory, ratio subsidi/komersil, dan estimasi habis stok.</div>';
    if(sumEl) sumEl.textContent = '— hitungan otomatis dari data stok';
    return;
  }

  const terjual = stk.k.terjual + stk.s.terjual;
  const ready = stk.k.ready + stk.s.ready;
  const kavling = stk.k.kavling + stk.s.kavling;
  const pembangunan = stk.k.pembangunan + stk.s.pembangunan;
  const inProcess = stk.k.dipesan + stk.s.proses;  // unit yang lagi dalam proses transaksi
  const sisaTersedia = ready + kavling + pembangunan;  // unit yang masih bisa dijual
  const sellPct = Math.round(terjual / total * 100);

  // Rasio subsidi vs komersil
  let ratioStr = '';
  if(totK > 0 && totS > 0){
    const pctK = Math.round(totK / total * 100);
    const pctS = 100 - pctK;
    ratioStr = `<strong>${pctS}% subsidi · ${pctK}% komersil</strong>`;
  } else if(totK > 0){
    ratioStr = '<strong>100% komersil</strong> (tidak ada subsidi)';
  } else {
    ratioStr = '<strong>100% subsidi</strong> (tidak ada komersil)';
  }

  // Velocity dari Tapera (kalau ada)
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));
  let velocity = null;
  let estHabisStr = '<span style="color:var(--faint);">tidak bisa dihitung</span>';
  let estHabisColor = '#888780';
  let velocityStr = '<span style="color:var(--faint);">tidak diketahui (data Tapera kosong)</span>';
  try {
    if(p?.tapera?.realisasiBulanan?.length){
      const sortedB = [...p.tapera.realisasiBulanan].sort((a,b) => a.bulan.localeCompare(b.bulan));
      const last6 = sortedB.slice(-6);
      const sumLast6 = last6.reduce((a,b) => a + (b.unit||0), 0);
      velocity = last6.length > 0 ? (sumLast6 / last6.length) : 0;
      velocityStr = `<strong>${velocity.toFixed(1)} unit/bln</strong> (rata-rata 6 bln Tapera)`;
      if(velocity > 0 && sisaTersedia > 0){
        const months = Math.round(sisaTersedia / velocity);
        estHabisStr = `~<strong>${months} bulan lagi</strong>`;
        if(months <= 6) estHabisColor = '#A32D2D';
        else if(months <= 12) estHabisColor = '#BA7517';
        else estHabisColor = '#0F6E56';
      } else if(velocity === 0 && sisaTersedia > 0){
        estHabisStr = '<span style="color:#A32D2D;">stuck (velocity 0)</span>';
        estHabisColor = '#A32D2D';
      }
    }
  } catch(_){}

  // Rekomendasi strategis
  let rekomendasi = '';
  if(sellPct >= 80){
    rekomendasi = `Sell-through ${sellPct}% dengan stok tersedia ${sisaTersedia} unit. <strong>Kompetitor di fase tail-end</strong> — opportunity buat agresif marketing sebelum mereka launching cluster baru.`;
  } else if(sellPct >= 50){
    rekomendasi = `Sell-through ${sellPct}% — kompetitor di mid-cycle. Stok tersedia ${sisaTersedia} unit ${velocity ? `+ velocity ${velocity.toFixed(1)}/bln` : ''}, mereka <strong>masih akan agresif</strong>.`;
  } else if(sellPct >= 20){
    rekomendasi = `Sell-through baru ${sellPct}% — early stage. <strong>Window buat ambil market share</strong> sebelum mereka mature.`;
  } else {
    rekomendasi = `Sell-through ${sellPct}% — sangat awal atau slow-moving. <strong>Cek penyebab</strong>: harga ketinggian? Lokasi sulit? Promo kurang?`;
  }

  host.innerHTML = `
    <div class="skb-insight-grid">
      <div class="skb-insight-stat">
        <div class="lbl">Sell-through rate</div>
        <div class="val" style="color:${sellPct >= 50 ? '#1D9E75' : '#BA7517'};">${sellPct}% <span class="meta">(${terjual}/${total})</span></div>
      </div>
      <div class="skb-insight-stat">
        <div class="lbl">Stok tersedia</div>
        <div class="val">${sisaTersedia} <span class="meta">unit (R+K+P)</span></div>
      </div>
      <div class="skb-insight-stat">
        <div class="lbl">Dalam proses</div>
        <div class="val">${inProcess} <span class="meta">unit (dipesan+proses)</span></div>
      </div>
      <div class="skb-insight-stat">
        <div class="lbl">Komposisi pasar</div>
        <div class="val small">${ratioStr}</div>
      </div>
      <div class="skb-insight-stat" style="grid-column:span 2;">
        <div class="lbl">Estimasi habis stok</div>
        <div class="val small" style="color:${estHabisColor};">${estHabisStr}</div>
        <div class="meta">${velocityStr}</div>
      </div>
    </div>
    <div class="skb-insight-rec">
      <div class="skb-insight-rec-lbl">💡 Rekomendasi strategis:</div>
      <div class="skb-insight-rec-body">${rekomendasi}</div>
    </div>
  `;
  if(sumEl) sumEl.textContent = `sell-through ${sellPct}% · ${sisaTersedia} unit tersedia`;
}

// ─── CROSS-CHECK SIKUMBANG vs TAPERA FLPP ──────────────────────

function skbCrossCheckTapera(){
  const host = document.getElementById('skb-crosscheck-content');
  const sumEl = document.getElementById('skb-sum-cross');
  if(!host) return;
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));

  const stk = _skbReadStock();
  // Total terjual subsidi (yang bisa dibandingkan dengan Tapera FLPP)
  const subsidiTerjual = stk.s.terjual;
  const totK = _skbSum(stk.k);
  const totS = _skbSum(stk.s);
  const totalAll = totK + totS;

  if(!p?.tapera?.totalRealisasi && totalAll === 0){
    host.innerHTML = '<div class="skb-cross-empty">Isi data Sikumbang + Tapera FLPP untuk perumahan ini supaya cross-check otomatis muncul.</div>';
    if(sumEl) sumEl.textContent = '— isi data Sikumbang dulu';
    return;
  }
  if(!p?.tapera?.totalRealisasi){
    host.innerHTML = '<div class="skb-cross-empty">Data Sikumbang sudah ada, tapi <strong>Tapera FLPP belum diisi</strong>. Buka tab Tapera, isi total realisasi.</div>';
    if(sumEl) sumEl.textContent = '— Tapera FLPP belum diisi';
    return;
  }
  if(totalAll === 0){
    host.innerHTML = '<div class="skb-cross-empty">Tapera sudah ada (' + p.tapera.totalRealisasi + ' unit), tapi <strong>Sikumbang belum diisi</strong>. Lengkapi di atas.</div>';
    if(sumEl) sumEl.textContent = '— Sikumbang belum diisi';
    return;
  }

  const taperaTotal = p.tapera.totalRealisasi;
  // Logic cross-check baru: compare subsidi.terjual ke Tapera FLPP (apple-to-apple)
  const diff = subsidiTerjual - taperaTotal;
  const absDiff = Math.abs(diff);
  let analysis = '';
  let ringColor = '#1D9E75';
  let summary = '';

  if(taperaTotal === 0 && subsidiTerjual > 0){
    analysis = `<span style="color:#854F0B;">⚠ Tapera 0 unit cair</span>, padahal Sikumbang <strong>subsidi terjual ${subsidiTerjual}</strong>. Mungkin Tapera FLPP belum di-sync — atau pembeli pakai non-FLPP (cek skema KPR).`;
    ringColor = '#854F0B';
    summary = '⚠ Tapera 0 vs Sikumbang positif';
  } else if(diff === 0){
    analysis = `<span style="color:#0F6E56;">✓ Match persis</span> — Sikumbang subsidi terjual & Tapera FLPP sama-sama ${subsidiTerjual} unit. <strong>Konsisten</strong>.`;
    ringColor = '#0F6E56';
    summary = '✓ subsidi match Tapera';
  } else if(diff < 0){
    // Tapera > Sikumbang subsidi → anomali (Tapera nggak mungkin lebih besar dari Sikumbang)
    analysis = `<span style="color:#A32D2D;">⚠ Anomali</span> — Tapera FLPP <strong>${taperaTotal}</strong> > Sikumbang subsidi terjual <strong>${subsidiTerjual}</strong>. Selisih ${absDiff} unit. Kemungkinan: Sikumbang belum di-update, atau salah input. Cek kembali.`;
    ringColor = '#A32D2D';
    summary = `⚠ selisih -${absDiff} unit`;
  } else {
    // Sikumbang subsidi > Tapera (selisih positif = subsidi non-FLPP atau belum cair)
    const pctNonFLPP = Math.round(diff / subsidiTerjual * 100);
    analysis = `Tapera FLPP <strong>${taperaTotal}</strong> dari ${subsidiTerjual} subsidi terjual. Selisih <strong>+${diff} unit (${pctNonFLPP}%)</strong> = subsidi tapi <strong>belum cair / non-FLPP</strong> (mis. KPR konvensional disubsidi developer).`;
    ringColor = '#0F6E56';
    summary = `${pctNonFLPP}% subsidi non-FLPP`;
  }

  // Komersil insight terpisah
  const komersilTerjual = stk.k.terjual;
  let komersilNote = '';
  if(komersilTerjual > 0){
    komersilNote = `<div class="skb-cross-row" style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
      <span class="skb-cross-icon" style="background:#FAEEDA;color:#854F0B;">⬜</span>
      <span class="skb-cross-lbl">Komersil terjual (di luar Tapera)</span>
      <span class="skb-cross-val">${komersilTerjual} unit</span>
    </div>`;
  }

  host.innerHTML = `
    <div class="skb-cross-grid">
      <div class="skb-cross-row">
        <span class="skb-cross-icon" style="background:#FAEEDA;color:#854F0B;">🟡</span>
        <span class="skb-cross-lbl">Sikumbang subsidi terjual</span>
        <span class="skb-cross-val">${subsidiTerjual} unit</span>
      </div>
      <div class="skb-cross-row">
        <span class="skb-cross-icon" style="background:#E6F1FB;color:#185FA5;">💰</span>
        <span class="skb-cross-lbl">Tapera FLPP cair</span>
        <span class="skb-cross-val">${taperaTotal} unit</span>
      </div>
      <div class="skb-cross-row" style="border-top:1px dashed var(--border);padding-top:8px;">
        <span class="skb-cross-icon" style="background:${diff > 0 ? '#FAEEDA' : (diff < 0 ? '#FCEBEB' : '#E1F5EE')};color:${ringColor};">${diff > 0 ? '+' : (diff < 0 ? '−' : '=')}</span>
        <span class="skb-cross-lbl">Selisih (subsidi non-FLPP)</span>
        <span class="skb-cross-val" style="color:${ringColor};">${diff > 0 ? '+' : ''}${diff} unit</span>
      </div>
      ${komersilNote}
    </div>
    <div class="skb-cross-analysis" style="border-left-color:${ringColor};">${analysis}</div>
  `;
  if(sumEl) sumEl.textContent = summary;
}

// ─── PASTE FROM CLIPBOARD ──────────────────────────────────────

async function skbPasteFromClipboard(){
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch(e){
    showToast('⚠ Tidak bisa baca clipboard. Paste manual ke field, ya.');
    return;
  }
  if(!text || !text.trim()){
    showToast('⚠ Clipboard kosong');
    return;
  }

  const lower = text.toLowerCase();

  // Parse ID Lokasi (format SNG... atau seperti dari URL)
  const idMatch = text.match(/\b([A-Z]{3}\d{10,15}[A-Z]\d{3})\b/) ||
                  text.match(/lokasi-perumahan\/([A-Z0-9]+)/);
  const idLokasi = idMatch ? idMatch[1] : null;

  // Parse 10 angka dari format Sikumbang dashboard
  // Sikumbang format: angka diikuti label "Kavling/Pembangunan/Ready Stock/Dipesan/Proses Bank/Terjual"
  // Pattern dashboard: KOMERSIL block then SUBSIDI block, masing-masing 5 status
  const findInBlock = (blockText, label) => {
    const re = new RegExp(`(\\d[\\d.,]*)\\s*(?:unit\\s*)?${label}|${label}[\\s:]+(\\d[\\d.,]*)`, 'i');
    const m = blockText.match(re);
    if(!m) return null;
    const raw = (m[1] || m[2] || '').replace(/[.,]/g, '');
    const n = parseInt(raw);
    return isNaN(n) ? null : n;
  };

  // Coba split text jadi blok komersil & subsidi
  let komersilText = '';
  let subsidiText = '';
  const lowSplit = lower;
  const kIdx = lowSplit.indexOf('komersil');
  const sIdx = lowSplit.indexOf('subsidi');
  if(kIdx >= 0 && sIdx >= 0){
    if(kIdx < sIdx){
      komersilText = text.substring(kIdx, sIdx);
      subsidiText = text.substring(sIdx);
    } else {
      subsidiText = text.substring(sIdx, kIdx);
      komersilText = text.substring(kIdx);
    }
  } else if(sIdx >= 0){
    // Cuma ada subsidi
    subsidiText = text;
  } else if(kIdx >= 0){
    komersilText = text;
  } else {
    // Tidak ada keyword segmen — anggap semua subsidi
    subsidiText = text;
  }

  // Parse 5 status per segmen
  const k = {
    kavling: findInBlock(komersilText, 'kavling'),
    pembangunan: findInBlock(komersilText, 'pembangunan'),
    ready: findInBlock(komersilText, 'ready\\s*stock'),
    dipesan: findInBlock(komersilText, 'dipesan'),
    terjual: findInBlock(komersilText, 'terjual')
  };
  const s = {
    kavling: findInBlock(subsidiText, 'kavling'),
    pembangunan: findInBlock(subsidiText, 'pembangunan'),
    ready: findInBlock(subsidiText, 'ready\\s*stock'),
    proses: findInBlock(subsidiText, 'proses\\s*bank'),
    terjual: findInBlock(subsidiText, 'terjual')
  };

  // Tahun mulai
  const tahunMatch = text.match(/\b(20[1-3]\d)\b/);
  const tahun = tahunMatch ? parseInt(tahunMatch[1]) : null;

  // Status proyek
  let status = '';
  if(/sold\s*out|habis|terjual\s*habis/i.test(text)) status = 'soldout';
  else if(/launching|coming|segera/i.test(text)) status = 'launching';
  else if(/aktif|active|berjalan/i.test(text)) status = 'aktif';

  // Apply
  const setIf = (id, v) => { if(v !== null && v !== '' && v !== undefined){ const el = document.getElementById(id); if(el) el.value = v; }};
  if(idLokasi) setIf('skb-id-lokasi', idLokasi);
  if(tahun) setIf('skb-tahun', tahun);
  if(status){ const e = document.getElementById('skb-status-proj'); if(e) e.value = status; }
  setIf('skb-k-kavling', k.kavling);
  setIf('skb-k-pembangunan', k.pembangunan);
  setIf('skb-k-ready', k.ready);
  setIf('skb-k-dipesan', k.dipesan);
  setIf('skb-k-terjual', k.terjual);
  setIf('skb-s-kavling', s.kavling);
  setIf('skb-s-pembangunan', s.pembangunan);
  setIf('skb-s-ready', s.ready);
  setIf('skb-s-proses', s.proses);
  setIf('skb-s-terjual', s.terjual);

  // Count detected
  const allFound = [
    idLokasi, tahun, status,
    k.kavling, k.pembangunan, k.ready, k.dipesan, k.terjual,
    s.kavling, s.pembangunan, s.ready, s.proses, s.terjual
  ].filter(v => v !== null && v !== undefined && v !== '').length;

  if(allFound === 0){
    showToast('⚠ Tidak ada data ke-detect. Isi manual.');
  } else {
    showToast(`✓ ${allFound} field auto-terisi dari clipboard`);
    skbOnFieldInput();
  }
}


// ============================================================
// STARTUP
// ============================================================
(function init(){
  // [v14 PROYEK] Load proyek dulu (dipakai di banyak tempat lewat getProyek/PROYEK proxy)
  loadProyek();

  // Load accounts dulu
  loadAccounts();

  // [v9 SECURITY] Migrasi password plaintext → hash (async, non-blocking).
  // Berjalan sekali saat startup. Akun yang sudah ter-hash akan di-skip.
  setTimeout(() => { migratePasswordsIfNeeded().catch(e => console.warn('Migrasi gagal:', e)); }, 500);

  // Coba load dari Sheets (async, tidak blocking)
  if(USE_SHEETS){
    loadAccountsFromSheets().then(loaded => {
      // [v9 SECURITY] Setelah load dari Sheets, migrasi lagi (kalau Sheets masih kirim plaintext)
      if(loaded) migratePasswordsIfNeeded().catch(()=>{});
      // Kalau user sudah login, re-apply access supaya tab muncul sesuai data terbaru
      const savedUser = sessionStorage.getItem(CURRENT_USER_KEY);
      if(savedUser){
        currentUser = findAccount(savedUser);
        if(currentUser) applyUserAccess();
      }
    });
    // [v15 PROYEK] Load proyek dari Sheets — kalau ada, override local
    loadProyekFromSheets().then(loaded => {
      if(loaded){
        // Refresh grid & screen pilih proyek kalau sudah di-render
        if(typeof renderProyek === 'function') renderProyek();
        if(typeof renderProyekCards === 'function') renderProyekCards();
      }
    });
  }

  // Cek session login
  if(sessionStorage.getItem(SESSION_KEY)==='ok'){
    const savedUser = sessionStorage.getItem(CURRENT_USER_KEY);
    if(savedUser){
      currentUser = findAccount(savedUser);
    }
    if(!currentUser){
      // Default ke BM jika tidak ada current user (backward compat dari sesi lama)
      currentUser = accounts.find(a => a.role === 'bm') || accounts[0];
      if(currentUser) sessionStorage.setItem(CURRENT_USER_KEY, currentUser.username);
    }
    if(currentUser) applyUserAccess();
    // [v12.4 STATE PERSISTENCE] Coba auto-pilih proyek terakhir agar tidak balik ke screen pemilih
    let restoredProyek = false;
    try {
      const saved = loadAppState();
      if(saved && saved.proyek && typeof PROYEK !== 'undefined' && PROYEK[saved.proyek]){
        // Auto-select proyek dan masuk ke s-app
        selectProyek(saved.proyek);
        restoredProyek = true;
      }
    } catch(e){ console.warn('auto restore proyek failed:', e); }
    if(!restoredProyek){
      showScreen('s-proyek');
    }
  } else {
    setTimeout(()=>{
      const u = document.getElementById('login-username');
      if(u) u.focus();
    },100);
  }
  if(USE_SHEETS) loadFromSheets();
  updateMobileMenuBtn();
  updateMobileStratBtn();

  // [v12 EDITOR] Enter-to-submit di form tambah perumahan & POI
  const bindEnter=(ids,handler)=>{
    ids.forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();handler();}});
    });
  };
  bindEnter(['enp-nama','enp-area','enp-lat','enp-lng','enp-dev','enp-unit','enp-real','enp-tahun'], addEPerumahan);
  bindEnter(['epoi-nama','epoi-lat','epoi-lng'], addEPoi);

  // [v12 EDITOR] Warning kalau close/reload tab dengan perubahan editor belum tersinkron
  window.addEventListener('beforeunload', (e)=>{
    if(editorState.dirty){
      e.preventDefault();
      e.returnValue='Ada perubahan editor yang belum tersinkron ke Sheets.';
      return e.returnValue;
    }
  });
})();
// ═══════════════════════════════════════════════════════════════════════════════
// [TPR PASTE] Tempel dari Tapera — parse text dari tapera.go.id/realisasi
// ───────────────────────────────────────────────────────────────────────────────
// Workflow: BM buka tapera.go.id/realisasi/, filter perumahan, select-all + copy.
// Tombol "Tempel dari Tapera" di card Identitas → parse → preview modal → Apply.
// Field yang bisa di-parse:
//   - Total UNIT (angka besar di stat cards)
//   - Nominal FLPP (43,0B atau 43.0 Miliar)
//   - Pekerjaan: SWASTA/WIRASWASTA/PNS/Other %
//   - Gender: L/P %
//   - Kelompok Penghasilan (range vs count)
//   - Kelompok Harga Rumah (range vs count)
//   - FLPP - Tahun Realisasi: Bulan + angka per bulan
//   - Tahun Realisasi (header filter)
//   - Kab/Kota (header filter)
// ═══════════════════════════════════════════════════════════════════════════════

let _tprPasteParsed = null; // hasil parse, dipakai modal preview

async function tprPasteFromClipboard(){
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch(e){
    showToast('⚠ Tidak bisa baca clipboard. Cek izin browser.');
    return;
  }
  if(!text || !text.trim()){
    showToast('⚠ Clipboard kosong');
    return;
  }
  const parsed = _tprParsePasteText(text);
  if(!parsed || Object.keys(parsed).length === 0){
    showToast('⚠ Tidak ada data Tapera yang dikenali. Pastikan teks dari tapera.go.id/realisasi');
    return;
  }
  _tprPasteParsed = parsed;
  _tprShowPastePreview(parsed);
}

// Parse berbagai format angka Indonesia:
//   "359"     → 359
//   "1.058"   → 1058 (titik = ribuan)
//   "43,0"    → 43.0 (koma = desimal)
//   "1,234.56"→ 1234.56 (US format, jarang)
function _tprParseNumber(s){
  if(!s) return null;
  s = String(s).trim();
  // Hapus spasi
  s = s.replace(/\s+/g, '');
  // Heuristik: kalau ada baik . dan ,
  // - kalau , muncul terakhir → koma desimal (ID format) → hapus titik, ganti koma jadi titik
  // - kalau . muncul terakhir → titik desimal (US format) → hapus koma
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if(lastDot >= 0 && lastComma >= 0){
    if(lastComma > lastDot){
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if(lastComma >= 0){
    // hanya koma — kalau setelah koma ada 3 angka, anggap ribuan; selainnya desimal
    const afterComma = s.length - lastComma - 1;
    if(afterComma === 3 && !/,\d{3}\D|\d,\d{3}$/.test(s.slice(0, lastComma+4))){
      // Ambigu, default ke desimal Indonesia
      s = s.replace(',', '.');
    } else {
      s = s.replace(',', '.');
    }
  } else if(lastDot >= 0){
    // hanya titik — kalau setelah titik ada 3 angka, anggap ribuan ID
    const afterDot = s.length - lastDot - 1;
    if(afterDot === 3){
      s = s.replace(/\./g, '');
    }
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function _tprParsePasteText(text){
  const out = {};
  const lower = text.toLowerCase();

  // ── Tahun Realisasi (header filter) ──
  // Pattern: "Tahun Realisasi" diikuti angka, atau angka 4-digit "2026"
  const tahunM = text.match(/tahun\s*realisasi[:\s]*(\d{4})/i);
  if(tahunM){
    out.tahunRealisasi = parseInt(tahunM[1]);
  } else {
    // fallback: cari angka 2020-2035 sebagai pivot
    const anyTahun = text.match(/\b(202[0-9]|203[0-5])\b/);
    if(anyTahun) out.tahunRealisasi = parseInt(anyTahun[1]);
  }

  // ── Kab/Kota (header filter) ──
  // Pattern: "Kabupaten/Kota" diikuti "KAB XXX" atau "KOTA XXX"
  const kabM = text.match(/(?:kabupaten\/kota|kab(?:upaten)?\/kota)[:\s\n×]*((?:KAB|KOTA)\s+[A-Z][A-Z\s]+?)(?:\n|×|$|\s{3,}|tahun|bank|asosiasi|provinsi|nama|tipe|pekerjaan)/i);
  if(kabM){
    out.kabKota = kabM[1].trim().replace(/\s+/g,' ');
  } else {
    // fallback langsung
    const anyKab = text.match(/\b((?:KAB|KOTA)\s+[A-Z][A-Z\s]{2,30}?)(?:\n|\s{2,}|$)/);
    if(anyKab) out.kabKota = anyKab[1].trim().replace(/\s+/g,' ');
  }

  // ── Total UNIT ──
  // Pattern: angka diikuti "UNIT" (case-insensitive) — biasanya stat card paling pertama
  const unitM = text.match(/([\d.,]+)\s*\n?\s*unit\b/i);
  if(unitM){
    const n = _tprParseNumber(unitM[1]);
    if(n !== null) out.totalRealisasi = Math.round(n);
  }

  // ── Nominal FLPP ──
  // Pattern: angka diikuti "B" atau "Miliar" diikuti "Nominal FLPP" / "FLPP"
  const nomM = text.match(/([\d.,]+)\s*B\s*\n?\s*nominal\s*flpp/i) ||
               text.match(/nominal\s*flpp[:\s\n]*([\d.,]+)\s*B/i) ||
               text.match(/([\d.,]+)\s*miliar.*?flpp/i);
  if(nomM){
    const n = _tprParseNumber(nomM[1]);
    if(n !== null) out.nominalFLPP = n;
  }

  // ── Profil Pekerjaan ──
  // Pattern: "SWAS..." atau "SWASTA" diikuti % → "92,20%" / "92.20%"
  const pekerjaanKeys = [
    {key:'swasta', re:/swas[a-z.]*\s*([\d.,]+)\s*%/i},
    {key:'wiraswasta', re:/wiras[a-z.]*\s*([\d.,]+)\s*%/i},
    {key:'pns', re:/\bpns\b\s*([\d.,]+)\s*%/i},
    {key:'tni_polri', re:/tni[\/\s-]*polri\s*([\d.,]+)\s*%/i},
    {key:'bumn', re:/\bbumn\b\s*([\d.,]+)\s*%/i},
    {key:'other', re:/\b(?:other|lain[a-z\s-]*)\s*([\d.,]+)\s*%/i}
  ];
  const pekerjaan = {};
  pekerjaanKeys.forEach(({key, re}) => {
    const m = text.match(re);
    if(m){
      const n = _tprParseNumber(m[1]);
      if(n !== null) pekerjaan[key] = Math.round(n);
    }
  });
  if(Object.keys(pekerjaan).length > 0) out.pekerjaan = pekerjaan;

  // ── Profil Gender ──
  // Pattern: "L 63,2%" / "P 36,8%" — perlu hati-hati supaya tidak match L dari word lain
  const gender = {};
  // Cari di sekitar kata "Jenis Kelamin"
  let genderBlock = text;
  const jkIdx = lower.indexOf('jenis kelamin');
  if(jkIdx >= 0){
    genderBlock = text.substring(jkIdx, jkIdx + 300);
  }
  const lM = genderBlock.match(/\bL\s+([\d.,]+)\s*%/);
  const pM = genderBlock.match(/\bP\s+([\d.,]+)\s*%/);
  if(lM){
    const n = _tprParseNumber(lM[1]);
    if(n !== null) gender['L'] = Math.round(n);
  }
  if(pM){
    const n = _tprParseNumber(pM[1]);
    if(n !== null) gender['P'] = Math.round(n);
  }
  if(Object.keys(gender).length > 0) out.gender = gender;

  // ── Kelompok Penghasilan ──
  // Pattern: "3 Jt < Penghasilan ≤ 4 Jt    146"
  // atau: "4 Jt ≤ 5 Jt    96"
  const penghasilan = {};
  // Cari di sekitar "Kelompok Penghasilan"
  const kpIdx = lower.indexOf('kelompok penghasilan');
  let kpBlock = text;
  if(kpIdx >= 0){
    // Ambil 600 char setelahnya, sampai keyword berikutnya
    kpBlock = text.substring(kpIdx, kpIdx + 800);
    // Stop di section berikutnya
    const stopIdx = kpBlock.search(/profesi\s*segmentasi|kelompok\s*harga|jenis\s*rumah|kelompok\s*uang/i);
    if(stopIdx > 0) kpBlock = kpBlock.substring(0, stopIdx);
  }
  // Pattern row: angka jt + sign + angka jt + count
  const phRowRe = /(\d+)\s*Jt\s*([<≤>≥]?)\s*Penghasilan\s*([<≤>≥]?)\s*(\d+)\s*Jt\s+(\d+)/gi;
  let phM;
  while((phM = phRowRe.exec(kpBlock)) !== null){
    const lo = phM[1], hi = phM[4];
    const count = parseInt(phM[5]);
    const k = `${lo}-${hi}Jt`;
    penghasilan[k] = count;
  }
  // Pattern lebih sederhana untuk row tanpa kata "Penghasilan"
  if(Object.keys(penghasilan).length === 0){
    const phSimpleRe = /(\d+)\s*Jt\s*[<≤>≥]?\s*[a-z\s]*[<≤>≥]\s*(\d+)\s*Jt\s+(\d+)/gi;
    let m;
    while((m = phSimpleRe.exec(kpBlock)) !== null){
      penghasilan[`${m[1]}-${m[2]}Jt`] = parseInt(m[3]);
    }
  }
  // "Other (3)  17"
  const otherM = kpBlock.match(/other\s*\(\d+\)\s+(\d+)/i);
  if(otherM) penghasilan['other'] = parseInt(otherM[1]);
  if(Object.keys(penghasilan).length > 0) out.penghasilan = penghasilan;

  // ── Kelompok Harga Rumah ──
  // Pattern: "150 Jt < Harga Rumah ≤ 175 Jt    359"
  const khIdx = lower.indexOf('kelompok harga');
  let khBlock = text;
  if(khIdx >= 0){
    khBlock = text.substring(khIdx, khIdx + 600);
    const stopIdx = khBlock.search(/kelompok\s*uang|kelompok\s*tenor|jenis\s*rumah|profesi/i);
    if(stopIdx > 0) khBlock = khBlock.substring(0, stopIdx);
  }
  const harga = [];
  const hRowRe = /(\d+)\s*Jt\s*[<≤>≥]?\s*Harga\s*Rumah\s*[<≤>≥]?\s*(\d+)\s*Jt\s+(\d+)/gi;
  let hM;
  while((hM = hRowRe.exec(khBlock)) !== null){
    harga.push({ range: `${hM[1]}-${hM[2]}Jt`, count: parseInt(hM[3]) });
  }
  if(harga.length > 0){
    // Sederhanakan jadi range dominan: range yang count terbanyak
    harga.sort((a,b) => b.count - a.count);
    out.hargaRange = harga[0].range;
    out._hargaBreakdown = harga;
  }

  // ── Realisasi Bulanan dari "FLPP - Tahun Realisasi" chart ──
  // Pattern: "January 2026  47", "March 2026  134", dll
  // Atau format: bulan + angka secara umum
  const monthsId = {
    januari:'01', january:'01', jan:'01',
    februari:'02', february:'02', feb:'02',
    maret:'03', march:'03', mar:'03',
    april:'04', apr:'04',
    mei:'05', may:'05',
    juni:'06', june:'06', jun:'06',
    juli:'07', july:'07', jul:'07',
    agustus:'08', august:'08', aug:'08',
    september:'09', sep:'09', sept:'09',
    oktober:'10', october:'10', oct:'10',
    november:'11', nov:'11',
    desember:'12', december:'12', dec:'12'
  };
  const bulanan = [];
  // Pattern: bulan + tahun + angka (di sekitar atau dipisah whitespace/newline)
  const monthRe = new RegExp(`\\b(${Object.keys(monthsId).join('|')})\\s+(20\\d{2})[\\s\\n]+(\\d+)\\b`, 'gi');
  let mbM;
  while((mbM = monthRe.exec(text)) !== null){
    const monthName = mbM[1].toLowerCase();
    const monthNum = monthsId[monthName];
    const year = mbM[2];
    const unit = parseInt(mbM[3]);
    if(monthNum && unit > 0 && unit < 10000){
      bulanan.push({ ym: `${year}-${monthNum}`, unit });
    }
  }
  // Format alt: "47 January 2026" (angka di depan)
  if(bulanan.length === 0){
    const monthRe2 = new RegExp(`(\\d+)[\\s\\n]+\\b(${Object.keys(monthsId).join('|')})\\s+(20\\d{2})`, 'gi');
    let m2;
    while((m2 = monthRe2.exec(text)) !== null){
      const monthName = m2[2].toLowerCase();
      const monthNum = monthsId[monthName];
      const year = m2[3];
      const unit = parseInt(m2[1]);
      if(monthNum && unit > 0 && unit < 10000){
        bulanan.push({ ym: `${year}-${monthNum}`, unit });
      }
    }
  }
  if(bulanan.length > 0){
    // Dedupe + sort by ym
    const seen = new Map();
    bulanan.forEach(b => seen.set(b.ym, b.unit));
    const sortedKeys = [...seen.keys()].sort();
    out.bulanan = sortedKeys.map(k => ({ ym: k, unit: seen.get(k) }));
    // Periode = bulan terakhir
    out.periode = sortedKeys[sortedKeys.length - 1];
  }

  return out;
}

// ─── PREVIEW MODAL ───────────────────────────────────────────────

function _tprShowPastePreview(p){
  // Generate preview rows
  const rows = [];
  const get = id => document.getElementById(id)?.value?.trim() || '';

  if(p.tahunRealisasi !== undefined) rows.push({
    key:'tahunRealisasi', label:'📅 Tahun Realisasi',
    current: get('tpr-tahun-realisasi'), parsed: String(p.tahunRealisasi),
    targetId:'tpr-tahun-realisasi'
  });
  if(p.kabKota) rows.push({
    key:'kabKota', label:'📍 Kabupaten/Kota',
    current: get('tpr-kab-kota'), parsed: p.kabKota,
    targetId:'tpr-kab-kota'
  });
  if(p.totalRealisasi !== undefined) rows.push({
    key:'totalRealisasi', label:'📊 Total Realisasi (unit)',
    current: get('tpr-total'), parsed: String(p.totalRealisasi),
    targetId:'tpr-total'
  });
  if(p.nominalFLPP !== undefined) rows.push({
    key:'nominalFLPP', label:'💵 Nominal FLPP (Miliar Rp)',
    current: get('tpr-nominal'), parsed: String(p.nominalFLPP),
    targetId:'tpr-nominal'
  });
  if(p.periode) rows.push({
    key:'periode', label:'📅 Periode data sampai',
    current: get('tpr-periode'), parsed: p.periode,
    targetId:'tpr-periode'
  });
  if(p.bulanan && p.bulanan.length > 0){
    const bStr = p.bulanan.map(b => `${b.ym}:${b.unit}`).join(', ');
    rows.push({
      key:'bulanan', label:`📈 Realisasi bulanan (${p.bulanan.length} bulan)`,
      current: get('tpr-bulanan'),
      parsed: bStr,
      targetId:'tpr-bulanan'
    });
  }
  if(p.pekerjaan){
    const pStr = Object.entries(p.pekerjaan).map(([k,v]) => `${k}:${v}`).join(', ');
    rows.push({
      key:'pekerjaan', label:'👔 Profil pekerjaan',
      current: get('tpr-pekerjaan'),
      parsed: pStr,
      targetId:'tpr-pekerjaan'
    });
  }
  if(p.gender){
    const gStr = Object.entries(p.gender).map(([k,v]) => `${k}:${v}`).join(', ');
    rows.push({
      key:'gender', label:'⚥ Profil gender',
      current: get('tpr-gender'),
      parsed: gStr,
      targetId:'tpr-gender'
    });
  }
  if(p.penghasilan){
    const pStr = Object.entries(p.penghasilan).map(([k,v]) => `${k}:${v}`).join(', ');
    rows.push({
      key:'penghasilan', label:'💰 Profil penghasilan',
      current: get('tpr-penghasilan'),
      parsed: pStr,
      targetId:'tpr-penghasilan'
    });
  }
  if(p.hargaRange){
    rows.push({
      key:'hargaRange', label:'🏠 Kelompok harga rumah (dominan)',
      current: get('tpr-harga'),
      parsed: p.hargaRange,
      targetId:'tpr-harga'
    });
  }

  if(rows.length === 0){
    showToast('⚠ Tidak ada field yang bisa di-apply');
    return;
  }

  // Build modal
  let modal = document.getElementById('tpr-paste-preview-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'tpr-paste-preview-modal';
    modal.className = 'tpr-paste-modal';
    modal.innerHTML = `
      <div class="tpr-paste-modal-backdrop" onclick="tprPasteModalClose()"></div>
      <div class="tpr-paste-modal-content">
        <div class="tpr-paste-modal-head">
          <div>
            <div class="tpr-paste-modal-title">📋 Preview hasil parse Tapera</div>
            <div class="tpr-paste-modal-sub">Centang field yang mau di-apply. Field tidak dicentang akan di-skip.</div>
          </div>
          <button class="tpr-paste-modal-close" onclick="tprPasteModalClose()">×</button>
        </div>
        <div class="tpr-paste-modal-body" id="tpr-paste-modal-rows"></div>
        <div class="tpr-paste-modal-foot">
          <button class="btn-sm" onclick="tprPasteToggleAll(true)">☑ Centang semua</button>
          <button class="btn-sm" onclick="tprPasteToggleAll(false)">☐ Uncheck semua</button>
          <div style="flex:1;"></div>
          <button class="btn-sm" onclick="tprPasteModalClose()">Batal</button>
          <button class="btn-sm-primary" onclick="tprPasteApply()">✓ Apply terpilih</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // Render rows
  const body = document.getElementById('tpr-paste-modal-rows');
  body.innerHTML = rows.map((r, i) => {
    const same = (r.current === r.parsed);
    const isEmpty = !r.current;
    const badge = same ? '<span class="tpr-paste-badge tpr-paste-badge-same">= sama</span>'
                       : (isEmpty ? '<span class="tpr-paste-badge tpr-paste-badge-new">+ baru</span>'
                                  : '<span class="tpr-paste-badge tpr-paste-badge-change">↻ ganti</span>');
    return `
      <div class="tpr-paste-row ${same ? 'is-same' : ''}">
        <label class="tpr-paste-row-check">
          <input type="checkbox" data-row="${i}" ${same ? '' : 'checked'}>
          <span></span>
        </label>
        <div class="tpr-paste-row-body">
          <div class="tpr-paste-row-label">${r.label} ${badge}</div>
          <div class="tpr-paste-row-values">
            <div class="tpr-paste-val-current">
              <div class="tpr-paste-val-tag">Sekarang</div>
              <div class="tpr-paste-val-text">${r.current ? escapeHtml(r.current) : '<i class="tpr-paste-empty">(kosong)</i>'}</div>
            </div>
            <div class="tpr-paste-val-arrow">→</div>
            <div class="tpr-paste-val-parsed">
              <div class="tpr-paste-val-tag">Hasil parse</div>
              <div class="tpr-paste-val-text">${escapeHtml(r.parsed)}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Store rows for apply
  modal._rows = rows;
  modal.style.display = 'flex';
}

function tprPasteModalClose(){
  const modal = document.getElementById('tpr-paste-preview-modal');
  if(modal) modal.style.display = 'none';
}

function tprPasteToggleAll(check){
  document.querySelectorAll('#tpr-paste-modal-rows input[type=checkbox]').forEach(cb => {
    cb.checked = check;
  });
}

function tprPasteApply(){
  const modal = document.getElementById('tpr-paste-preview-modal');
  if(!modal || !modal._rows) return;
  const rows = modal._rows;
  let appliedCount = 0;
  rows.forEach((r, i) => {
    const cb = document.querySelector(`#tpr-paste-modal-rows input[data-row="${i}"]`);
    if(!cb || !cb.checked) return;
    const el = document.getElementById(r.targetId);
    if(!el) return;
    el.value = r.parsed;
    appliedCount++;
  });
  // Trigger update
  if(typeof tpr2OnFieldInput === 'function') tpr2OnFieldInput();
  if(typeof tpr2RefreshAll === 'function') tpr2RefreshAll();
  tprPasteModalClose();
  showToast(`✓ Apply ${appliedCount} field dari Tapera`);
}

function tprShowPasteHelp(){
  const html = `
    <b>Cara pakai "Tempel dari Tapera":</b><br><br>
    <b>1.</b> Klik tombol <b>"🔗 Buka Realisasi FLPP resmi di Tapera"</b> di card ini.<br>
    <b>2.</b> Di halaman Tapera, filter dengan:<br>
    &nbsp;&nbsp;&nbsp;• <b>Tahun Realisasi</b> (misal 2026)<br>
    &nbsp;&nbsp;&nbsp;• <b>Kabupaten/Kota</b> (misal KAB SUBANG)<br>
    &nbsp;&nbsp;&nbsp;• <b>Nama Perumahan</b> (sesuai nama di sini)<br>
    <b>3.</b> Tunggu data muncul (angka stat cards + chart).<br>
    <b>4.</b> Tekan <b>Ctrl+A</b> untuk select all halaman.<br>
    <b>5.</b> Tekan <b>Ctrl+C</b> untuk copy.<br>
    <b>6.</b> Balik ke aplikasi → klik <b>"📋 Tempel dari Tapera"</b>.<br>
    <b>7.</b> Preview muncul → centang field yang mau diisi → klik <b>"Apply"</b>.<br><br>
    <i>Tips: kalau parse tidak lengkap, BM bisa edit field manual setelah Apply.</i>
  `;
  // Reuse showInfoModal kalau ada, fallback ke alert
  if(typeof showInfoModal === 'function'){
    showInfoModal('❓ Cara pakai Tempel dari Tapera', html);
  } else {
    const tmp = html.replace(/<br>/g,'\n').replace(/<\/?[^>]+>/g,'').replace(/&nbsp;/g,' ');
    alert(tmp);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// [PERF DASH L1] Performance Dashboard — Layer 1 Snapshot Logic
// ───────────────────────────────────────────────────────────────────────────────
// Auto-compute insight dari data Tapera + Sikumbang yang sudah ada.
// Tidak modify data, hanya analyze & render.
//
// Kunci interpretasi:
// - "Velocity" = rata-rata realisasi 3 bulan terakhir (unit/bulan)
// - "Trend"    = velocity 3 bulan terakhir vs 3 bulan sebelumnya
// - "Market share" = realisasi kita / total realisasi area
// - "Posisi"   = ranking dari skor strategis (Hub Formula) atau composite
// - "Sisa stok" = (Sikumbang ready+kavling+pembangunan) / velocity → estimasi bulan
// ═══════════════════════════════════════════════════════════════════════════════

const PERF_STATE = {
  area: '',
  filterMode: 'all', // all | anchor | non-anchor
  data: null,        // hasil compute terakhir
};

function openPerfDashboard(){
  const overlay = document.getElementById('perf-overlay');
  if(!overlay) return;
  overlay.classList.add('open');
  // Initial render
  renderPerfDashboard();
}

function closePerfDashboard(){
  const overlay = document.getElementById('perf-overlay');
  if(overlay) overlay.classList.remove('open');
}

// ─── COMPUTE: Analyze data semua perumahan dalam area ───────────

function _perfComputeData(){
  if(typeof perumahan === 'undefined' || !Array.isArray(perumahan)){
    return { perumahan: [], us: null, area: '—', total: 0 };
  }

  const filterMode = PERF_STATE.filterMode;
  let list = perumahan.filter(p => {
    if(filterMode === 'anchor') return p.role === 'anchor';
    if(filterMode === 'non-anchor') return p.role !== 'anchor';
    return true;
  });

  // Identify "us" (perumahan kita = role 'focus' atau yang diset sebagai milik kita)
  const us = perumahan.find(p => p.role === 'focus') || null;

  // Determine area dominan
  const areaMap = {};
  list.forEach(p => {
    const a = (p.tapera?.kabKota || p.area || '—').toUpperCase();
    areaMap[a] = (areaMap[a] || 0) + 1;
  });
  const dominantArea = Object.entries(areaMap).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';

  // Compute per-perumahan metrics
  const enriched = list.map(p => {
    const t = p.tapera || {};
    const s = p.sikumbang || {};
    const bulanan = t.realisasiBulanan || [];

    // Velocity: avg 3 bulan terakhir
    const last3 = bulanan.slice(-3);
    const prev3 = bulanan.slice(-6, -3);
    const velocity = last3.length > 0
      ? Math.round(last3.reduce((a,b) => a + (b.unit || 0), 0) / last3.length)
      : 0;
    const velocityPrev = prev3.length > 0
      ? Math.round(prev3.reduce((a,b) => a + (b.unit || 0), 0) / prev3.length)
      : 0;
    const trendPct = velocityPrev > 0 ? Math.round((velocity - velocityPrev) / velocityPrev * 100) : 0;

    // Total realisasi
    const total = t.totalRealisasi || 0;

    // Sikumbang stok
    const sk = s.komersil || {};
    const ss = s.subsidi || {};
    const stokTotal = (sk.kavling || 0) + (sk.pembangunan || 0) + (sk.ready || 0)
                    + (ss.kavling || 0) + (ss.pembangunan || 0) + (ss.ready || 0);
    const terjualTotal = (sk.terjual || 0) + (ss.terjual || 0);

    // Sisa stok dalam bulan
    const stokBulan = velocity > 0 && stokTotal > 0 ? Math.round(stokTotal / velocity * 10) / 10 : null;

    // Skor strategis (dari Hub Formula kalau ada)
    const skor = (typeof p.skor !== 'undefined') ? p.skor :
                 (typeof p.scoring?.total !== 'undefined' ? p.scoring.total : null);

    return {
      id: p.id,
      nama: p.nama || `Perumahan ${p.id}`,
      role: p.role || 'extra',
      isUs: us && p.id === us.id,
      area: (t.kabKota || p.area || '—').toUpperCase(),
      total,
      velocity,
      velocityPrev,
      trendPct,
      stokTotal,
      terjualTotal,
      stokBulan,
      skor: skor !== null ? Math.round(skor * 10) / 10 : null,
      promo: t.promotion?.promoAktif || '',
      pekerjaan: t.profilPembeli?.pekerjaan || {},
      gender: t.profilPembeli?.gender || {},
    };
  });

  // Total area
  const totalArea = enriched.reduce((a,b) => a + (b.total || 0), 0);
  // Velocity rata-rata per perumahan (yang punya data)
  const withVelocity = enriched.filter(p => p.velocity > 0);
  const avgVelocity = withVelocity.length > 0
    ? Math.round(withVelocity.reduce((a,b) => a + b.velocity, 0) / withVelocity.length)
    : 0;

  // Market share kita
  const usData = enriched.find(p => p.isUs);
  const marketShare = totalArea > 0 && usData ? Math.round(usData.total / totalArea * 100) : 0;

  // Ranking (sort by skor desc, fallback velocity)
  const ranked = [...enriched].sort((a, b) => {
    const sa = a.skor !== null ? a.skor : -1;
    const sb = b.skor !== null ? b.skor : -1;
    if(sa !== sb) return sb - sa;
    return (b.velocity || 0) - (a.velocity || 0);
  });
  ranked.forEach((p, i) => p.rank = i + 1);
  const usRank = ranked.find(p => p.isUs)?.rank || null;

  // Trend total area: this 3 months vs last 3
  let totalLast3 = 0, totalPrev3 = 0;
  enriched.forEach(p => {
    totalLast3 += (p.velocity || 0) * 3;
    totalPrev3 += (p.velocityPrev || 0) * 3;
  });
  const trendTotal = totalPrev3 > 0 ? Math.round((totalLast3 - totalPrev3) / totalPrev3 * 100) : 0;

  // Trend market share kita (compare 3 bulan terakhir vs 3 bulan sebelumnya)
  let usLast = (usData?.velocity || 0) * 3;
  let usPrev = (usData?.velocityPrev || 0) * 3;
  let totalLastForShare = enriched.reduce((a,b) => a + (b.velocity || 0) * 3, 0);
  let totalPrevForShare = enriched.reduce((a,b) => a + (b.velocityPrev || 0) * 3, 0);
  const shareNow = totalLastForShare > 0 ? (usLast / totalLastForShare * 100) : 0;
  const sharePrev = totalPrevForShare > 0 ? (usPrev / totalPrevForShare * 100) : 0;
  const shareTrendDelta = Math.round(shareNow - sharePrev);

  return {
    area: dominantArea,
    perumahan: enriched,
    ranked,
    us: usData,
    usRank,
    totalArea,
    avgVelocity,
    marketShare,
    trendTotal,
    shareTrendDelta,
    asOf: new Date().toISOString().slice(0, 10),
  };
}

// ─── RENDER: Main entry point ────────────────────────────────────

function renderPerfDashboard(){
  PERF_STATE.filterMode = document.getElementById('perf-filter-mode')?.value || 'all';
  const data = _perfComputeData();
  PERF_STATE.data = data;

  // Header info
  const subtitleEl = document.getElementById('perf-area-info');
  if(subtitleEl){
    subtitleEl.textContent = data.area && data.area !== '—'
      ? `Area: ${data.area} · ${data.perumahan.length} perumahan · update ${data.asOf}`
      : `${data.perumahan.length} perumahan · update ${data.asOf}`;
  }

  _perfRenderMetrics(data);
  _perfRenderHeatmap(data);
  _perfRenderAlerts(data);

  // Footer
  const lastUpdEl = document.getElementById('perf-last-update');
  if(lastUpdEl){
    lastUpdEl.textContent = `Snapshot: ${data.asOf} · ${data.perumahan.length} perumahan dianalisa`;
  }
}

// ─── RENDER: 4 Big Metrics ─────────────────────────────────────

function _perfRenderMetrics(data){
  const fmt = (n) => {
    if(n === null || n === undefined || isNaN(n)) return '—';
    return new Intl.NumberFormat('id-ID').format(Math.round(n));
  };

  const setEl = (id, val) => { const el = document.getElementById(id); if(el) el.innerHTML = val; };
  const setTrendEl = (id, deltaPct, label) => {
    const el = document.getElementById(id);
    if(!el) return;
    if(deltaPct === null || deltaPct === undefined || isNaN(deltaPct)){
      el.className = 'perf-metric-trend';
      el.textContent = label || '—';
      return;
    }
    const arrow = deltaPct > 2 ? '↗' : (deltaPct < -2 ? '↘' : '→');
    const cls = deltaPct > 2 ? 'perf-trend-up' : (deltaPct < -2 ? 'perf-trend-down' : 'perf-trend-flat');
    el.className = 'perf-metric-trend ' + cls;
    const sign = deltaPct > 0 ? '+' : '';
    el.textContent = `${arrow} ${sign}${deltaPct}% vs 3bln lalu`;
  };

  // Total Realisasi YTD
  setEl('perf-m-total', fmt(data.totalArea));
  setTrendEl('perf-m-total-trend', data.trendTotal, '— belum cukup data');

  // Velocity rata-rata
  setEl('perf-m-velocity', fmt(data.avgVelocity));
  setEl('perf-m-velocity-sub', 'unit/bln per perumahan');

  // Market share kita
  if(data.us){
    setEl('perf-m-share', `${data.marketShare}%`);
    setTrendEl('perf-m-share-trend', data.shareTrendDelta, '— belum cukup data');
  } else {
    setEl('perf-m-share', '—');
    setEl('perf-m-share-trend', 'Set 1 perumahan sebagai "focus"');
  }

  // Posisi kita
  if(data.us && data.usRank){
    setEl('perf-m-rank', `#${data.usRank}`);
    const skorDisplay = data.us.skor !== null ? `dari ${data.perumahan.length} (skor ${data.us.skor})` : `dari ${data.perumahan.length}`;
    setEl('perf-m-rank-sub', skorDisplay);
  } else {
    setEl('perf-m-rank', '—');
    setEl('perf-m-rank-sub', 'tidak ada perumahan focus');
  }
}

// ─── RENDER: Heatmap ───────────────────────────────────────────

function _perfRenderHeatmap(data){
  const wrap = document.getElementById('perf-heatmap-wrap');
  if(!wrap) return;

  // Sort perumahan by velocity desc untuk visual sequence
  const sorted = [...data.perumahan].sort((a, b) => (b.velocity || 0) - (a.velocity || 0));

  // Find max velocity untuk normalize warna
  const maxV = Math.max(...sorted.map(p => p.velocity || 0), 1);

  // Color scale: 0 = abu-abu, low = teal, mid = amber, high = red
  const _getColor = (v) => {
    if(!v) return '#F1EFE8';
    const ratio = v / maxV;
    if(ratio < 0.2) return '#9FE1CB';
    if(ratio < 0.4) return '#C0DD97';
    if(ratio < 0.6) return '#FAC775';
    if(ratio < 0.8) return '#EF9F27';
    return '#E24B4A';
  };

  const cells = sorted.map(p => {
    const color = _getColor(p.velocity);
    const isEmpty = !p.velocity;
    const tooltip = `${escapeHtml(p.nama)}\n${p.velocity} unit/bln · total ${p.total}`;
    return `<div class="perf-heatmap-cell ${p.isUs ? 'is-us' : ''} ${isEmpty ? 'is-empty' : ''}"
              style="background:${color};"
              onclick="_perfHeatmapClick(${p.id})">
              <span class="perf-heatmap-tooltip">${escapeHtml(p.nama)} · ${p.velocity}/bln</span>
            </div>`;
  }).join('');

  wrap.innerHTML = cells || '<div style="color:var(--muted);font-size:11px;padding:12px;">Belum ada data perumahan untuk dianalisa.</div>';
}

function _perfHeatmapClick(id){
  // Future: drill-down ke detail perumahan
  // Untuk Layer 1, cukup tunjukkan toast info
  const p = perumahan.find(x => x.id === id);
  if(!p) return;
  if(typeof showToast === 'function'){
    showToast(`📌 ${p.nama} · velocity ${PERF_STATE.data?.perumahan.find(x => x.id === id)?.velocity || 0}/bln`);
  }
}

// ─── RENDER: Alerts (auto-detect 3 paling penting) ──────────────

function _perfRenderAlerts(data){
  const wrap = document.getElementById('perf-alerts-wrap');
  if(!wrap) return;

  const alerts = [];

  // ── Alert 1: Kompetitor stok hampir habis (sold-through tinggi) ──
  data.perumahan.forEach(p => {
    if(p.isUs) return;
    if(p.stokBulan !== null && p.stokBulan < 3 && p.velocity > 10){
      const sellThrough = p.terjualTotal && p.stokTotal
        ? Math.round(p.terjualTotal / (p.terjualTotal + p.stokTotal) * 100)
        : null;
      alerts.push({
        priority: 1,
        type: 'red',
        icon: '🔴',
        title: `${p.nama} ${sellThrough ? 'sold-through ' + sellThrough + '%, ' : ''}stok habis ~${p.stokBulan} bln`,
        detail: `Velocity ${p.velocity}/bln · sisa stok ${p.stokTotal} unit. Kompetitor akan "hilang" dari pasar dalam ${Math.ceil(p.stokBulan)} bulan.`,
      });
    }
  });

  // ── Alert 2: Velocity kita turun ──
  if(data.us && data.us.trendPct < -10 && data.us.velocityPrev > 0){
    alerts.push({
      priority: 2,
      type: 'amber',
      icon: '🟡',
      title: `Velocity kita turun ${Math.abs(data.us.trendPct)}% dibanding 3 bulan lalu`,
      detail: `Sekarang ${data.us.velocity}/bln (sebelumnya ${data.us.velocityPrev}/bln). ${data.us.promo ? `Promo aktif: "${data.us.promo}" — perlu evaluasi efektivitas.` : 'Belum ada promo aktif yang tercatat.'}`,
    });
  }

  // ── Alert 3: Kompetitor velocity tinggi & naik ──
  const fastRising = data.perumahan
    .filter(p => !p.isUs && p.velocity > (data.avgVelocity * 1.5) && p.trendPct > 10)
    .sort((a, b) => b.velocity - a.velocity);
  if(fastRising.length > 0){
    const top = fastRising[0];
    alerts.push({
      priority: 2,
      type: 'amber',
      icon: '⚠️',
      title: `${top.nama} velocity ${top.velocity}/bln (naik +${top.trendPct}%)`,
      detail: `Kompetitor agresif. ${top.promo ? `Promo aktif: "${top.promo}".` : ''} Pertimbangkan analisa lebih dalam untuk respon strategis.`,
    });
  }

  // ── Alert 4: Profil pembeli area dominan (insight strategis) ──
  // Aggregate profil pekerjaan & gender dari semua perumahan yang ada datanya
  const aggPekerjaan = {};
  const aggGender = {};
  let nWith = 0;
  data.perumahan.forEach(p => {
    if(Object.keys(p.pekerjaan || {}).length > 0){
      Object.entries(p.pekerjaan).forEach(([k, v]) => { aggPekerjaan[k] = (aggPekerjaan[k] || 0) + v; });
      nWith++;
    }
    if(Object.keys(p.gender || {}).length > 0){
      Object.entries(p.gender).forEach(([k, v]) => { aggGender[k] = (aggGender[k] || 0) + v; });
    }
  });
  if(nWith > 0){
    const topJob = Object.entries(aggPekerjaan).sort((a,b) => b[1]-a[1])[0];
    const topGen = Object.entries(aggGender).sort((a,b) => b[1]-a[1])[0];
    if(topJob && topGen){
      const jobPct = Math.round(topJob[1] / nWith);
      const genPct = Math.round(topGen[1] / nWith);
      alerts.push({
        priority: 3,
        type: 'blue',
        icon: '💡',
        title: `Profil pembeli area: ${jobPct}% ${topJob[0]}, ${genPct}% ${topGen[0]}`,
        detail: `Berdasarkan ${nWith} perumahan dengan data Tapera. Pertimbangkan apakah targeting marketing kita match dengan profil ini.`,
      });
    }
  }

  // ── Alert 5: Market share kita turun signifikan ──
  if(data.us && data.shareTrendDelta < -3){
    alerts.push({
      priority: 1,
      type: 'red',
      icon: '📉',
      title: `Market share kita turun ${Math.abs(data.shareTrendDelta)}% poin`,
      detail: `Sekarang ${data.marketShare}% (sebelumnya ~${data.marketShare - data.shareTrendDelta}%). Kompetitor menggerus pangsa pasar.`,
    });
  }

  // ── Alert positif: kalau kita unggul ──
  if(data.us && data.usRank === 1){
    alerts.push({
      priority: 4,
      type: 'green',
      icon: '🏆',
      title: `Kita di posisi #1 di area ini`,
      detail: `Skor strategis tertinggi. Pertahankan momentum dan pantau kompetitor #2 yang naik.`,
    });
  }

  // Sort by priority + ambil top 3
  alerts.sort((a, b) => a.priority - b.priority);
  const top3 = alerts.slice(0, 3);

  if(top3.length === 0){
    wrap.innerHTML = `
      <div class="perf-alert is-empty">
        <div class="perf-alert-icon">ℹ️</div>
        <div class="perf-alert-body">
          <div class="perf-alert-title" style="color:var(--muted);">Belum ada insight signifikan</div>
          <div class="perf-alert-detail" style="color:var(--muted);">Tambah data Tapera + Sikumbang untuk lebih banyak perumahan supaya alert auto-detect bisa jalan.</div>
        </div>
      </div>
    `;
    return;
  }

  wrap.innerHTML = top3.map(a => `
    <div class="perf-alert is-${a.type}">
      <div class="perf-alert-icon">${a.icon}</div>
      <div class="perf-alert-body">
        <div class="perf-alert-title">${escapeHtml(a.title)}</div>
        <div class="perf-alert-detail">${escapeHtml(a.detail)}</div>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// [v18 SECTIONS] Editor Kategori Vs Anchor — render & handlers
// ───────────────────────────────────────────────────────────────────────────────
// Editor ini hidup di Hub Formula → tab "⚖️ Kategori Vs Anchor".
// User bisa: tambah/hapus section, rename, ubah emoji, reorder (drag), edit row assignment.
// Semua perubahan buffered di VSA_SECTIONS_DRAFT dulu — baru commit ke VSA_SECTIONS saat Simpan.
// ═══════════════════════════════════════════════════════════════════════════════

let VSA_SECTIONS_DRAFT = null; // buffer: deep-clone dari VSA_SECTIONS saat editor dibuka
let _katRowEditTargetId = null; // section yang sedang di-edit row-nya
let _katDragSrcIdx = null;      // index sumber drag
const KAT_EMOJI_OPTIONS = ['📊','📍','🏠','💰','📢','📈','👥','🎯','🏆','⚖️','🗺️','🧭','🔍','💡','📋','📅','🏗️','🎨','🛒','🚗','🏥','🎓','🏬','🛣️','🏛️','💼','🌳','🏭','📁','⭐','🔥','💎'];

function renderKategoriEditor(){
  // Deep clone saat pertama buka (atau setelah simpan/reset)
  if(!VSA_SECTIONS_DRAFT) VSA_SECTIONS_DRAFT = JSON.parse(JSON.stringify(VSA_SECTIONS));

  const list = document.getElementById('kat-list');
  if(!list) return;

  list.innerHTML = VSA_SECTIONS_DRAFT.map((s, idx)=>{
    const availableRows = s.rows.filter(k => VSA_ROW_KEYS.includes(k));
    const rowCount = availableRows.length;
    const canDelete = VSA_SECTIONS_DRAFT.length > 1; // min 1 section
    return `
      <div class="kat-item" draggable="true" data-kat-idx="${idx}"
           ondragstart="katDragStart(event, ${idx})"
           ondragover="katDragOver(event, ${idx})"
           ondragleave="katDragLeave(event)"
           ondrop="katDrop(event, ${idx})"
           ondragend="katDragEnd(event)">
        <span class="kat-handle" title="Drag untuk urutkan">⇅</span>
        <span class="kat-emoji" onclick="openKatEmojiPicker(event, ${idx})" title="Ganti emoji">${s.emoji}</span>
        <input type="text" class="kat-name" value="${escapeHtml(s.name)}"
               oninput="updateKatName(${idx}, this.value)"
               placeholder="Nama section...">
        <span class="kat-rows-count">${rowCount} baris</span>
        <button class="kat-edit-btn ${rowCount>0?'has-active':''}" onclick="openKatRowEdit('${s.id}')">Edit baris</button>
        <button class="kat-del-btn" onclick="deleteKatSection(${idx})" ${canDelete?'':'disabled'} title="${canDelete?'Hapus section':'Minimal 1 section harus ada'}">🗑</button>
      </div>`;
  }).join('');

  // Update warning baris yang belum di-assign
  _updateUnassignedWarning();
}

function _updateUnassignedWarning(){
  const assigned = new Set();
  VSA_SECTIONS_DRAFT.forEach(s => s.rows.forEach(k => assigned.add(k)));
  const unassigned = VSA_ROW_KEYS.filter(k => !assigned.has(k));
  const warn = document.getElementById('kat-unassigned-warn');
  const cnt = document.getElementById('kat-unassigned-count');
  if(!warn || !cnt) return;
  if(unassigned.length){
    warn.style.display = '';
    cnt.textContent = unassigned.length;
    warn.title = 'Baris: ' + unassigned.map(k=>VSA_ROW_LABEL[k]||k).join(', ');
  } else {
    warn.style.display = 'none';
  }
}

function updateKatName(idx, val){
  if(!VSA_SECTIONS_DRAFT[idx]) return;
  VSA_SECTIONS_DRAFT[idx].name = val;
  // Tidak perlu re-render (input sudah sync)
}

function openKatEmojiPicker(ev, idx){
  ev.stopPropagation();
  // Hapus picker lama kalau ada
  const old = document.getElementById('kat-emoji-picker-active');
  if(old) old.remove();

  const picker = document.createElement('div');
  picker.className = 'kat-emoji-picker open';
  picker.id = 'kat-emoji-picker-active';
  picker.innerHTML = KAT_EMOJI_OPTIONS.map(e=>`<span onclick="selectKatEmoji(${idx}, '${e}')">${e}</span>`).join('');

  // Positioning — pakai getBoundingClientRect dari target (emoji span)
  const rect = ev.target.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.top = (rect.bottom + 4) + 'px';
  picker.style.left = rect.left + 'px';
  document.body.appendChild(picker);

  // Close saat klik di luar
  setTimeout(()=>{
    const closeHandler = (e)=>{
      if(!picker.contains(e.target)){
        picker.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 10);
}

function selectKatEmoji(idx, emoji){
  if(!VSA_SECTIONS_DRAFT[idx]) return;
  VSA_SECTIONS_DRAFT[idx].emoji = emoji;
  const picker = document.getElementById('kat-emoji-picker-active');
  if(picker) picker.remove();
  renderKategoriEditor();
}

function addKategoriSection(){
  // Generate id unik
  let idBase = 'section', n = 1;
  while(VSA_SECTIONS_DRAFT.some(s=>s.id===idBase+n)) n++;
  VSA_SECTIONS_DRAFT.push({
    id: idBase+n,
    emoji: '📁',
    name: 'Section Baru',
    rows: []
  });
  renderKategoriEditor();
}

function deleteKatSection(idx){
  if(VSA_SECTIONS_DRAFT.length <= 1){
    showToast('⚠ Minimal 1 section harus ada');
    return;
  }
  const sec = VSA_SECTIONS_DRAFT[idx];
  if(!sec) return;
  if(!confirm(`Hapus section "${sec.emoji} ${sec.name}"?\nBaris di dalamnya akan jadi un-assigned — bisa kamu pindahkan ke section lain lewat "Edit baris".`)) return;
  VSA_SECTIONS_DRAFT.splice(idx, 1);
  renderKategoriEditor();
}

// Drag & drop handlers
function katDragStart(ev, idx){
  _katDragSrcIdx = idx;
  ev.dataTransfer.effectAllowed = 'move';
  try{ ev.dataTransfer.setData('text/plain', String(idx)); }catch(_){}
  const el = ev.currentTarget;
  if(el) el.classList.add('dragging');
}
function katDragOver(ev, idx){
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  if(_katDragSrcIdx === null || _katDragSrcIdx === idx) return;
  const el = ev.currentTarget;
  if(el) el.classList.add('drag-over');
}
function katDragLeave(ev){
  const el = ev.currentTarget;
  if(el) el.classList.remove('drag-over');
}
function katDrop(ev, idx){
  ev.preventDefault();
  document.querySelectorAll('.kat-item').forEach(el=>el.classList.remove('drag-over','dragging'));
  if(_katDragSrcIdx === null || _katDragSrcIdx === idx) return;
  const moved = VSA_SECTIONS_DRAFT.splice(_katDragSrcIdx, 1)[0];
  VSA_SECTIONS_DRAFT.splice(idx, 0, moved);
  _katDragSrcIdx = null;
  renderKategoriEditor();
}
function katDragEnd(ev){
  document.querySelectorAll('.kat-item').forEach(el=>el.classList.remove('drag-over','dragging'));
  _katDragSrcIdx = null;
}

// Sub-modal: edit row assignment untuk 1 section
function openKatRowEdit(sectionId){
  const sec = VSA_SECTIONS_DRAFT.find(s=>s.id===sectionId);
  if(!sec) return;
  _katRowEditTargetId = sectionId;

  document.getElementById('kat-rowedit-title').innerHTML = `${sec.emoji} ${escapeHtml(sec.name)}`;
  document.getElementById('kat-rowedit-sub').textContent = 'Centang baris yang ingin muncul di section ini. Badge menunjukkan section lain yang sudah punya baris tersebut.';

  // Grouping untuk readability — pakai kelompok natural dari urutan VSA_ROW_DEFS
  const GROUPS = [
    {name:'Skor', prefix:['skor_']},
    {name:'Jarak POI', prefix:['poi_','dist_']},
    {name:'Data Proyek', prefix:['proj_']},
    {name:'Tapera — Realisasi', keys:['tpr_avg','tpr_trend','tpr_total','tpr_flpp']},
    {name:'Tapera — Spesifikasi', keys:['tpr_harga','tpr_lt','tpr_lb','tpr_tenor','tpr_um','tpr_bank']},
    {name:'Tapera — Profil Pembeli', keys:['tpr_pek','tpr_usia','tpr_peng','tpr_gender']}
  ];

  // Helper: di section lain mana aja key ini sudah ter-assign?
  const whereElse = (key) => {
    return VSA_SECTIONS_DRAFT
      .filter(s => s.id !== sectionId && s.rows.includes(key))
      .map(s => `${s.emoji} ${s.name}`);
  };

  const groupsHtml = GROUPS.map(g=>{
    const keys = g.keys
      ? g.keys
      : VSA_ROW_KEYS.filter(k => g.prefix.some(pref => k.startsWith(pref)));
    if(!keys.length) return '';
    const items = keys.map(k=>{
      const checked = sec.rows.includes(k) ? 'checked' : '';
      const elsewhere = whereElse(k);
      const badge = elsewhere.length
        ? `<span class="assign-badge" title="Juga ada di section lain">${elsewhere[0]}${elsewhere.length>1?' +'+(elsewhere.length-1):''}</span>`
        : '';
      return `<label class="kat-rowedit-opt">
        <input type="checkbox" ${checked} data-rowkey="${k}">
        <span class="rowlbl">${VSA_ROW_LABEL[k]||k}</span>
        ${badge}
      </label>`;
    }).join('');
    return `<div class="kat-rowedit-group">
      <div class="kat-rowedit-group-lbl">${g.name}</div>
      ${items}
    </div>`;
  }).join('');

  document.getElementById('kat-rowedit-body').innerHTML = groupsHtml;
  document.getElementById('kat-rowedit-overlay').classList.add('open');
}

function applyKatRowEdit(){
  const sec = VSA_SECTIONS_DRAFT.find(s=>s.id===_katRowEditTargetId);
  if(!sec){ closeKatRowEdit(); return; }

  // Kumpulkan key yang checked, preserve urutan di VSA_ROW_KEYS (konsisten)
  const checkboxes = document.querySelectorAll('#kat-rowedit-body input[type="checkbox"]');
  const selected = new Set();
  checkboxes.forEach(cb => { if(cb.checked) selected.add(cb.dataset.rowkey); });

  // Pertahankan urutan lama untuk key yang masih tercentang,
  // lalu tambahkan key baru (yg belum ada di rows lama) di akhir sesuai urutan VSA_ROW_KEYS
  const oldOrdered = sec.rows.filter(k => selected.has(k));
  const oldSet = new Set(oldOrdered);
  const newKeys = VSA_ROW_KEYS.filter(k => selected.has(k) && !oldSet.has(k));
  sec.rows = [...oldOrdered, ...newKeys];

  closeKatRowEdit();
  renderKategoriEditor();
}

function closeKatRowEdit(){
  document.getElementById('kat-rowedit-overlay').classList.remove('open');
  _katRowEditTargetId = null;
}

function resetKategoriDefault(){
  if(!confirm('Reset semua section ke default (4P + Performance + Market Insight)?\nNama dan urutan section custom akan hilang.')) return;
  VSA_SECTIONS_DRAFT = JSON.parse(JSON.stringify(VSA_SECTIONS_DEFAULT));
  renderKategoriEditor();
}

function saveKategoriChanges(){
  // Validasi nama section tidak boleh kosong
  const empty = VSA_SECTIONS_DRAFT.find(s => !String(s.name||'').trim());
  if(empty){
    alert('Nama section tidak boleh kosong. Silakan isi dulu.');
    return;
  }

  // Commit draft → state aktual
  VSA_SECTIONS = JSON.parse(JSON.stringify(VSA_SECTIONS_DRAFT));
  _saveVsaSections();

  // Kalau section aktif sudah tidak ada, fallback ke yg pertama
  if(!VSA_SECTIONS.some(s=>s.id===vsaActiveSectionId)){
    vsaActiveSectionId = VSA_SECTIONS[0]?.id || 'ringkasan';
    _saveVsaActiveSection();
  }

  // Reset draft supaya next open pakai state baru
  VSA_SECTIONS_DRAFT = null;

  // Re-render tabel Vs Anchor kalau sedang ke-buka
  const p = perumahan.find(x=>x.id===selectedId);
  if(p && document.getElementById('tab-compare').innerHTML.trim()) renderDetailCompare(p);

  showToast('✅ Kategori Vs Anchor disimpan');
  document.getElementById('admin-overlay').classList.remove('open');
}

// Reset draft saat modal Hub Formula ditutup tanpa simpan (supaya next open fresh)
(function _hookHubClose(){
  const overlay = document.getElementById('admin-overlay');
  if(!overlay) return;
  // Tambahkan observer kalau class 'open' hilang — reset draft
  const observer = new MutationObserver(()=>{
    if(!overlay.classList.contains('open')){
      VSA_SECTIONS_DRAFT = null;
    }
  });
  observer.observe(overlay, {attributes:true, attributeFilter:['class']});
})();
