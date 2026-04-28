// Backup, restore, mobile/sidebar, session startup
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
