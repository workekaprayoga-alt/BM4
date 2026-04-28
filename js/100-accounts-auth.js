// Accounts, login, access control
// ============================================================
// ACCOUNT MANAGEMENT SYSTEM (NEW)
// ============================================================
const ACCOUNTS_KEY = 'bm4_accounts';
const ACCLOG_KEY = 'bm4_acclog';
const CURRENT_USER_KEY = 'bm4_current_user';

// ============================================================
// [PATCH KEAMANAN #1 — 2026-04-28]
// Plaintext password dihapus dari source code.
// Sebelumnya file ini berisi password seperti 'bm4property2024',
// 'sales123', 'strat123', 'kons123' — siapa pun yang melihat
// source di GitHub Pages bisa membacanya. Sekarang:
//
// - Password tim (sales/strategi/konstruksi) di-generate acak
//   sekali saat first-run, lalu disimpan di localStorage milik BM.
// - BM bisa melihat daftar password yang ter-generate dengan
//   memanggil BM4ShowDefaultPasswords() di console browser
//   SAAT BELUM LOGIN, lalu bagikan ke tim.
// - Setiap akun tim wajib ganti password saat login pertama
//   (mustChangePassword: true).
// - Akun BM (bm4) password kosong di-default → BM diminta
//   set password sendiri saat pertama kali login. Ini lebih
//   aman daripada generate random untuk akun super-admin
//   (mengurangi risiko BM terkunci dari akunnya sendiri).
//
// CATATAN: source code statis tidak bisa menyimpan rahasia.
// Patch ini menghilangkan kebocoran password lewat source,
// tapi password yang sudah ter-generate disimpan di localStorage
// browser BM dan masih plaintext di sana. Itu wajar untuk UAT.
// Untuk production penuh, pakai Secure Mode (Apps Script).
// ============================================================

// Generate password acak yang readable: 4 huruf + 4 angka
// Hindari huruf yang membingungkan (l, I, O, 0)
function _bm4GenerateRandomPassword(){
  const alpha = 'abcdefghjkmnpqrstuvwxyz';
  const num = '23456789';
  let pw = '';
  for(let i = 0; i < 4; i++){
    pw += alpha.charAt(Math.floor(Math.random() * alpha.length));
  }
  for(let i = 0; i < 4; i++){
    pw += num.charAt(Math.floor(Math.random() * num.length));
  }
  return pw;
}

// Default accounts — TIDAK ADA plaintext password di source code.
// Pertama kali dijalankan, password tim di-generate acak.
// Akun BM (bm4) password kosong → harus di-set saat login pertama.
function getDefaultAccounts(){
  const saved = localStorage.getItem('bm4_default_accounts');
  if(saved){ try{ return JSON.parse(saved); }catch(e){} }

  // Template akun tanpa password. Password diisi di bawah.
  const team = [
    {username:'bm4',         nama:'Branch Manager Area 4', jabatan:'Branch Manager',  role:'bm',         foto:'', bio:'Memimpin dengan hati, bergerak dengan strategi.', akses:['dashboard','analisa','strategi','sales','konstruksi','legal','finance','tim']},
    {username:'sales1',      nama:'Sales 1',                jabatan:'Sales Executive',  role:'sales',      foto:'', bio:'', akses:['dashboard','sales']},
    {username:'sales2',      nama:'Sales 2',                jabatan:'Sales Executive',  role:'sales',      foto:'', bio:'', akses:['dashboard','sales']},
    {username:'sales3',      nama:'Sales 3',                jabatan:'Sales Executive',  role:'sales',      foto:'', bio:'', akses:['dashboard','sales']},
    {username:'strategi1',   nama:'Strategi 1',             jabatan:'Strategi & Promo', role:'strategi',   foto:'', bio:'', akses:['dashboard','strategi']},
    {username:'strategi2',   nama:'Strategi 2',             jabatan:'Strategi & Promo', role:'strategi',   foto:'', bio:'', akses:['dashboard','strategi']},
    {username:'konstruksi1', nama:'Konstruksi 1',           jabatan:'Tim Konstruksi',   role:'konstruksi', foto:'', bio:'', akses:['dashboard','konstruksi']},
    {username:'konstruksi2', nama:'Konstruksi 2',           jabatan:'Tim Konstruksi',   role:'konstruksi', foto:'', bio:'', akses:['dashboard','konstruksi']},
    {username:'konstruksi3', nama:'Konstruksi 3',           jabatan:'Tim Konstruksi',   role:'konstruksi', foto:'', bio:'', akses:['dashboard','konstruksi']}
  ];

  // Isi password:
  // - bm4: kosong, harus di-set saat first login
  // - lainnya: random + mustChangePassword
  const generatedSummary = [];
  team.forEach(a => {
    if(a.username === 'bm4'){
      a.password = '';                   // kosong = trigger setup di first login
      a.mustSetPassword = true;          // flag khusus BM
      a.mustChangePassword = false;
    } else {
      const pw = _bm4GenerateRandomPassword();
      a.password = pw;                   // plaintext sementara, akan di-hash saat login pertama
      a.mustChangePassword = true;       // user wajib ganti saat login
      a.mustSetPassword = false;
      generatedSummary.push({ username: a.username, password: pw });
    }
  });

  // Simpan defaults & summary password ke localStorage BM (terpisah agar gampang dilihat)
  try {
    localStorage.setItem('bm4_default_accounts', JSON.stringify(team));
    localStorage.setItem('bm4_generated_passwords', JSON.stringify({
      generatedAt: new Date().toISOString(),
      note: 'Bagikan ke tim, lalu hapus item ini lewat BM4ClearGeneratedPasswords() setelah selesai.',
      passwords: generatedSummary
    }));
  } catch(e){ console.warn('[BM4] Gagal simpan default accounts:', e); }

  // Tampilkan ke console agar BM bisa langsung lihat
  console.log('%c[BM4] Akun default ter-generate. Panggil BM4ShowDefaultPasswords() untuk melihat password tim.', 'color:#2563EB;font-weight:bold;');

  return team;
}

// Helper console: BM panggil ini sebelum login untuk lihat password tim
window.BM4ShowDefaultPasswords = function(){
  const raw = localStorage.getItem('bm4_generated_passwords');
  if(!raw){
    console.log('%c[BM4] Tidak ada password ter-generate. Mungkin sudah dibersihkan, atau belum first-run.', 'color:#DC2626;');
    return null;
  }
  try {
    const data = JSON.parse(raw);
    console.log('%c[BM4] Password default tim (HANYA UNTUK LOGIN PERTAMA):', 'color:#059669;font-weight:bold;');
    console.table(data.passwords);
    console.log('Catatan:', data.note);
    console.log('Generated:', data.generatedAt);
    return data;
  } catch(e){
    console.error('[BM4] Format generated_passwords rusak:', e);
    return null;
  }
};

// Helper console: BM panggil ini setelah semua password dibagikan
window.BM4ClearGeneratedPasswords = function(){
  localStorage.removeItem('bm4_generated_passwords');
  console.log('%c[BM4] Password default sudah dihapus dari localStorage. Aman.', 'color:#059669;font-weight:bold;');
};

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

// ─── PASSWORD CHANGE PROMPT ─────────────────────────────
// Dipakai untuk mustSetPassword (BM) dan mustChangePassword (tim)
async function _bm4PromptNewPassword(username, isFirstSetup){
  const title = isFirstSetup
    ? `Akun "${username}" belum punya password.\nSilakan buat password baru (minimal 8 karakter).`
    : `Login pertama akun "${username}".\nWajib ganti password sekarang (minimal 8 karakter).`;

  for(let attempt = 0; attempt < 3; attempt++){
    const pw1 = prompt(title);
    if(pw1 === null) return null;             // user cancel
    if(!pw1 || pw1.length < 8){
      alert('Password minimal 8 karakter. Coba lagi.');
      continue;
    }
    const pw2 = prompt('Ketik ulang password baru untuk konfirmasi:');
    if(pw2 === null) return null;
    if(pw1 !== pw2){
      alert('Password tidak sama. Coba lagi.');
      continue;
    }
    return pw1;
  }
  alert('Gagal set password setelah 3 percobaan. Login dibatalkan.');
  return null;
}

// ──────────────────────────────────────────────────────────
// [v9 SECURITY] doLoginNew() adalah fungsi login utama (async, pakai hash verification)
async function doLoginNew(){
  if(window.BM4_SECURE_MODE && window.BM4Secure && typeof window.BM4Secure.login === 'function'){
    return window.BM4Secure.login();
  }
  const username = (document.getElementById('login-username').value || '').trim();
  const password = document.getElementById('login-input').value;
  const err = document.getElementById('login-error');

  // Cek lockout brute force
  const lockMsg = checkLoginLockout();
  if(lockMsg){ err.textContent = lockMsg; err.classList.add('show'); return; }

  // [PATCH KEAMANAN #2] Master password backdoor DIHAPUS.
  // Sebelumnya ada blok yang mengizinkan login tanpa username
  // jika password cocok dengan localStorage 'bm4_master_pw'.
  // Itu adalah backdoor dan sudah dihapus.

  const acc = findAccount(username);

  // [v10 CONTROL] Block login untuk akun yang di-suspend
  if(acc && acc.suspended){
    err.textContent = '⛔ Akun Anda sedang dinonaktifkan. Hubungi Branch Manager.';
    err.classList.add('show');
    recordLoginFailure();
    logActivity(acc.username, 'login ditolak', 'Akun suspended mencoba login');
    return;
  }

  // [PATCH KEAMANAN #1] Akun BM yang belum punya password
  // Khusus untuk akun BM4 dengan flag mustSetPassword: saat input
  // password kosong, izinkan masuk untuk SETUP password baru.
  if(acc && acc.mustSetPassword && (!acc.password || acc.password === '')){
    if(password !== ''){
      // BM mengetik sesuatu padahal akun belum punya password.
      // Tetap tolak untuk konsistensi UX, tapi beri pesan yang jelas.
      err.textContent = 'Akun BM belum punya password. Kosongkan field password untuk setup.';
      err.classList.add('show');
      return;
    }
    const newPw = await _bm4PromptNewPassword(acc.username, true);
    if(!newPw){
      err.textContent = 'Setup password dibatalkan.';
      err.classList.add('show');
      return;
    }
    acc.password = await hashPassword(newPw);
    acc.mustSetPassword = false;
    saveAccountsLocal();
    if(USE_SHEETS) syncAccountsToSheets();
    // Lanjut ke login normal di bawah
    currentUser = acc;
    sessionStorage.setItem(SESSION_KEY, 'ok');
    sessionStorage.setItem(CURRENT_USER_KEY, acc.username);
    sessionStorage.setItem('bm4_session_start', String(Date.now()));
    err.classList.remove('show');
    applyUserAccess();
    resetLoginAttempts();
    startSessionTimer();
    logActivity(acc.username, 'login', 'Login pertama + setup password');
    showScreen('s-proyek');
    return;
  }

  // [v9 SECURITY] verifyPassword kompatibel dengan plaintext legacy + hash baru
  const ok = acc ? await verifyPassword(password, acc.password) : false;
  if(acc && ok){

    // [PATCH KEAMANAN #1] Wajib ganti password di login pertama
    if(acc.mustChangePassword){
      const newPw = await _bm4PromptNewPassword(acc.username, false);
      if(!newPw){
        err.textContent = 'Login dibatalkan. Password harus diganti dulu.';
        err.classList.add('show');
        return;
      }
      acc.password = await hashPassword(newPw);
      acc.mustChangePassword = false;
      saveAccountsLocal();
      if(USE_SHEETS) syncAccountsToSheets();
      logActivity(acc.username, 'password_change', 'Ganti password di login pertama');
    } else {
      // Auto-migrasi password plaintext lama → hash (untuk akun yang sudah login)
      if(acc.password && !acc.password.startsWith(PW_HASH_PREFIX)){
        acc.password = await hashPassword(password);
        saveAccountsLocal();
        if(USE_SHEETS) syncAccountsToSheets();
      }
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
