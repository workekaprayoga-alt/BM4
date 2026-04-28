// Screens, navigation, sheets load, toast
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
