// ============================================================
// BM4 SECURE SESSION ADAPTER + UX BRIDGE
// Tujuan:
// - Secure Mode tetap aktif server-side.
// - Tim BM4 kembali bisa dipakai untuk kelola user/profil/akses.
// - Tombol lama diarahkan ke API Secure Mode, bukan localStorage.
// - Security Center tetap untuk pantauan audit/session/backup.
// - Loading awal dibuat lebih ringan: daftar user hanya dimuat saat diperlukan.
// ============================================================
(function(window){
  const secureModeOn = !!(
    window.BM4_SECURE_MODE ||
    (typeof BM4_SECURE_MODE !== 'undefined' && BM4_SECURE_MODE === true)
  );
  if(!secureModeOn) return;
  window.BM4_SECURE_MODE = true;

  const ADMIN_ROLES = ['bm','owner','admin'];
  let teamCacheAt = 0;
  let teamLoading = false;

  function rememberEnabled(){ return false; }
  function notify(msg){ try { if(typeof showToast === 'function') showToast(msg); else alert(msg); } catch(e){ try{ alert(msg); }catch(_){} } }
  function esc(s){ try { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); } catch(e){ return String(s||''); } }
  function isSecureMode(){ return !!(window.BM4_SECURE_MODE || (typeof BM4_SECURE_MODE !== 'undefined' && BM4_SECURE_MODE === true)); }
  function isAdminUser(u){ return !!(u && ADMIN_ROLES.includes(String(u.role || '').toLowerCase())); }
  function getCurrent(){ try { return currentUser || window.currentUser || null; } catch(e){ return window.currentUser || null; } }
  function getAccounts(){ try { return Array.isArray(accounts) ? accounts : []; } catch(e){ return Array.isArray(window.accounts) ? window.accounts : []; } }
  function setAccounts(list){
    try { accounts = list; } catch(e){ window.accounts = list; }
    try { window.accounts = list; } catch(e){}
  }
  function setCurrentUser(user){
    if(!user) return;
    try { currentUser = user; } catch(e){}
    try { window.currentUser = user; } catch(e){}
  }
  function selectedAccessFromModal(){ return Array.from(document.querySelectorAll('#acc-access-grid input:checked')).map(cb => cb.value); }
  function normalizeAccess(v){ return Array.isArray(v) ? v : String(v||'').split(',').map(x=>x.trim()).filter(Boolean); }
  function activeToSuspended(u){ return !(u.active !== false && String(u.active).toLowerCase() !== 'false'); }
  function normalizeUser(u){
    return Object.assign({}, u, {
      username: String(u.username || '').toLowerCase(),
      password: '',
      akses: normalizeAccess(u.akses),
      suspended: activeToSuspended(u),
      active: !activeToSuspended(u),
      foto: u.foto || '',
      bio: u.bio || ''
    });
  }

  async function request(action, payload){
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: gasPost(Object.assign({ action }, payload || {})),
      cache: 'no-store'
    });
    let json;
    try { json = await res.json(); }
    catch(e){ throw new Error('Response Apps Script bukan JSON. Cek deployment Web App.'); }
    if(!json || json.success === false){
      const msg = json && (json.message || json.error) ? (json.message || json.error) : 'Request gagal';
      const err = new Error(msg); err.response = json; throw err;
    }
    return json;
  }

  function saveSecureUser(user){
    if(!user) return;
    const normalized = normalizeUser(user);
    try { sessionStorage.setItem(BM4_SESSION_USER_KEY, JSON.stringify(normalized)); localStorage.setItem('bm4_last_username', normalized.username || ''); } catch(e){}
    setCurrentUser(normalized);
    const list = getAccounts().slice();
    const idx = list.findIndex(a => String(a.username).toLowerCase() === String(normalized.username).toLowerCase());
    if(idx >= 0) list[idx] = Object.assign({}, list[idx], normalized);
    else list.push(normalized);
    setAccounts(list);
    try { if(typeof applyUserAccess === 'function') applyUserAccess(); } catch(e){}
  }

  function loadTeamCache(){
    try{
      const raw = localStorage.getItem('bm4_secure_team_cache');
      if(!raw) return false;
      const c = JSON.parse(raw);
      if(!c || !Array.isArray(c.users)) return false;
      setAccounts(c.users.map(normalizeUser));
      teamCacheAt = Number(c.ts || 0);
      return true;
    }catch(e){ return false; }
  }
  function saveTeamCache(users){
    try { localStorage.setItem('bm4_secure_team_cache', JSON.stringify({ ts:Date.now(), users })); } catch(e){}
  }

  async function syncTeamFromSecure(force){
    const me = getCurrent();
    if(!isSecureMode() || !isAdminUser(me)) return false;
    if(teamLoading) return false;
    if(!force && teamCacheAt && Date.now() - teamCacheAt < 60000 && getAccounts().length) return true;
    teamLoading = true;
    try{
      const r = await request('admin_users_list', {});
      const users = (r.data || []).map(normalizeUser);
      setAccounts(users);
      saveTeamCache(users);
      teamCacheAt = Date.now();
      const freshMe = users.find(u => String(u.username).toLowerCase() === String(me.username).toLowerCase());
      if(freshMe) setCurrentUser(freshMe);
      return true;
    }catch(e){
      console.warn('[BM4Secure] gagal sync daftar tim:', e);
      return false;
    }finally{ teamLoading = false; }
  }

  function addTeamBridgeNote(){
    const pane = document.getElementById('pane-tim');
    if(!pane || pane.querySelector('#bm4-tim-secure-bridge-note')) return;
    const title = pane.querySelector('h2, h3, .pane-title, .section-title') || pane.firstElementChild || pane;
    const note = document.createElement('div');
    note.id = 'bm4-tim-secure-bridge-note';
    note.style.cssText = 'margin:10px 0 14px;padding:10px 12px;border:1px solid #BBF7D0;background:#F0FDF4;color:#166534;border-radius:10px;font-size:12px;line-height:1.45;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;';
    note.innerHTML = '<span>✓ Secure Mode aktif. <b>Tim BM4 tetap dipakai</b> untuk nama, jabatan, foto, bio, role, akses, reset password, nonaktifkan, dan force logout — semua tersimpan ke server.</span><button type="button" id="bm4-refresh-team-secure" style="border:1px solid #86EFAC;background:white;color:#166534;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;">Refresh Tim</button>';
    if(title && title.parentNode) title.parentNode.insertBefore(note, title.nextSibling); else pane.insertBefore(note, pane.firstChild);
    const btn = note.querySelector('#bm4-refresh-team-secure');
    if(btn) btn.onclick = async () => { btn.disabled = true; await syncTeamFromSecure(true); if(typeof renderTim === 'function') renderTim(); btn.disabled = false; notify('✓ Data Tim BM4 diperbarui dari Secure Mode.'); };
  }

  function enhanceTeamUi(){
    if(!isSecureMode()) return;
    addTeamBridgeNote();
    // Label password supaya jelas bahwa tombol reset memakai server, bukan localStorage.
    document.querySelectorAll('.tim-pw-toggle').forEach(btn => {
      if((btn.textContent || '').toLowerCase().includes('reset')) btn.title = 'Reset password Secure Mode (server-side)';
    });
  }

  async function login(){
    const usernameEl = document.getElementById('login-username');
    const passwordEl = document.getElementById('login-input');
    const errEl = document.getElementById('login-error');
    const username = (usernameEl && usernameEl.value || '').trim();
    const password = passwordEl && passwordEl.value || '';
    if(errEl){ errEl.classList.remove('show'); errEl.textContent = 'Username atau password salah. Coba lagi.'; }
    if(!username || !password){ if(errEl){ errEl.textContent = 'Username dan password wajib diisi.'; errEl.classList.add('show'); } return; }
    try{
      if(typeof setSyncStatus === 'function') setSyncStatus('loading','Login ke server aman...');
      const r = await request('auth_login', { username, password, deviceInfo: navigator.userAgent || 'browser' });
      setBm4SessionToken(r.sessionToken, rememberEnabled());
      saveSecureUser(r.user);
      sessionStorage.setItem(SESSION_KEY, 'ok');
      sessionStorage.setItem(CURRENT_USER_KEY, r.user.username);
      sessionStorage.setItem('bm4_session_start', String(Date.now()));
      if(passwordEl) passwordEl.value = '';
      if(typeof startSessionTimer === 'function') startSessionTimer();
      if(typeof setSyncStatus === 'function') setSyncStatus('synced','Login aman berhasil');
      showScreen('s-proyek');
      // Data utama tetap dimuat, tapi daftar user/security tidak ikut dimuat di awal.
      setTimeout(()=>{
        try { if(typeof loadFromSheets === 'function') loadFromSheets(); } catch(e){}
        try { if(typeof loadTpFromSheets === 'function') loadTpFromSheets(); } catch(e){}
        try { if(typeof loadProyekFromSheets === 'function') loadProyekFromSheets().then(()=>{ if(typeof renderProyekCards==='function') renderProyekCards(); }); } catch(e){}
      }, 250);
    }catch(e){
      clearBm4SessionToken();
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(CURRENT_USER_KEY);
      if(errEl){ errEl.textContent = e.message || 'Login gagal.'; errEl.classList.add('show'); }
      if(typeof setSyncStatus === 'function') setSyncStatus('offline','Login gagal');
      if(passwordEl){ passwordEl.value = ''; passwordEl.focus(); }
    }
  }

  async function verifySession(){
    const token = getBm4SessionToken();
    if(!token) return false;
    try{
      const r = await request('auth_verify', { deviceInfo: navigator.userAgent || 'browser' });
      if(r.user){
        saveSecureUser(r.user);
        sessionStorage.setItem(SESSION_KEY, 'ok');
        sessionStorage.setItem(CURRENT_USER_KEY, r.user.username);
      }
      return true;
    }catch(e){
      clearBm4SessionToken();
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(CURRENT_USER_KEY);
      return false;
    }
  }

  async function logout(){
    try { await request('auth_logout', {}); } catch(e){}
    clearBm4SessionToken();
    try { window.currentUser = null; currentUser = null; } catch(e){}
  }

  async function changeOwnPassword(){
    const oldEl = document.getElementById('set-pw-old');
    const newEl = document.getElementById('set-pw-new');
    const new2El = document.getElementById('set-pw-new2');
    const oldPassword = oldEl && oldEl.value || '';
    const newPassword = newEl && newEl.value || '';
    const newPassword2 = new2El && new2El.value || '';
    if(!oldPassword){ notify('⚠ Password lama wajib diisi.'); return; }
    if(!newPassword || newPassword.length < 8){ notify('⚠ Password baru minimal 8 karakter.'); return; }
    if(newPassword !== newPassword2){ notify('⚠ Konfirmasi password tidak cocok.'); return; }
    try{
      await request('auth_change_password', { oldPassword, newPassword });
      if(oldEl) oldEl.value = ''; if(newEl) newEl.value = ''; if(new2El) new2El.value = '';
      notify('✓ Password berhasil diubah di Secure Mode.');
    }catch(e){ notify('Gagal ubah password: ' + (e.message || e)); }
  }

  async function saveOwnProfilePatch(profile){
    const r = await request('auth_update_profile', { profile });
    if(r.user) saveSecureUser(r.user);
    return r;
  }

  // ==========================================================
  // Bridge menu Tim BM4 ke Secure API
  // ==========================================================
  const oldRenderTim = window.renderTim;
  window.renderTim = function(){
    if(isSecureMode() && isAdminUser(getCurrent()) && !getAccounts().length) loadTeamCache();
    const ret = typeof oldRenderTim === 'function' ? oldRenderTim.apply(this, arguments) : undefined;
    enhanceTeamUi();
    if(isSecureMode() && isAdminUser(getCurrent())) syncTeamFromSecure(false).then(changed => {
      if(changed && typeof oldRenderTim === 'function') { oldRenderTim(); enhanceTeamUi(); }
    });
    return ret;
  };
  try { renderTim = window.renderTim; } catch(e){}

  const oldOpenAccModal = window.openAccModal;
  window.openAccModal = function(mode, username){
    if(isSecureMode() && isAdminUser(getCurrent())){
      // Pakai UI modal lama agar rasa aplikasi tidak berubah.
      const ret = typeof oldOpenAccModal === 'function' ? oldOpenAccModal.apply(this, arguments) : undefined;
      try{
        const pw = document.getElementById('acc-password');
        if(pw){
          pw.placeholder = mode === 'edit' ? 'Kosongkan jika tidak ingin ganti password' : 'Password awal min. 8 karakter';
        }
      }catch(e){}
      return ret;
    }
    if(typeof oldOpenAccModal === 'function') return oldOpenAccModal.apply(this, arguments);
  };

  window.saveAccount = async function(){
    if(!isSecureMode()) return window.__legacy_saveAccount ? window.__legacy_saveAccount() : undefined;
    const me = getCurrent();
    if(!isAdminUser(me)){ notify('⚠ Hanya BM/Admin.'); return; }
    const get = id => (document.getElementById(id) || {}).value || '';
    const username = get('acc-username').trim().toLowerCase();
    const password = get('acc-password');
    const nama = get('acc-nama').trim();
    const jabatan = get('acc-jabatan').trim();
    const bio = get('acc-bio').trim();
    const role = get('acc-role') || 'sales';
    const akses = selectedAccessFromModal();
    const editing = (typeof editingAccUsername !== 'undefined' && editingAccUsername) ? String(editingAccUsername).toLowerCase() : '';
    if(!username){ notify('⚠ Username wajib diisi'); return; }
    if(!editing && (!password || password.length < 8)){ notify('⚠ Password awal minimal 8 karakter'); return; }
    if(editing && password && password.length < 8){ notify('⚠ Password baru minimal 8 karakter atau kosongkan'); return; }
    if(!nama){ notify('⚠ Nama wajib diisi'); return; }
    if(bio.length > 150){ notify('⚠ Bio maksimal 150 karakter'); return; }
    const old = getAccounts().find(a => String(a.username).toLowerCase() === (editing || username));
    const user = { username, nama, jabatan, bio, role, akses, active: old ? !old.suspended : true, foto: old ? (old.foto || '') : '' };
    if(password) user.password = password;
    try{
      await request('admin_user_save', { user });
      notify(editing ? '✓ Akun diperbarui di server' : '✓ Akun baru dibuat di server');
      if(typeof closeAccModal === 'function') closeAccModal();
      await syncTeamFromSecure(true);
      if(typeof renderTim === 'function') renderTim();
    }catch(e){ notify('Gagal simpan akun: ' + (e.message || e)); }
  };

  window.deleteAccount = async function(username){
    if(!isSecureMode()) return;
    const me = getCurrent();
    if(!isAdminUser(me)){ notify('⚠ Hanya BM/Admin.'); return; }
    if(String(username).toLowerCase() === String(me.username).toLowerCase()){ notify('⚠ Tidak bisa menonaktifkan akun sendiri.'); return; }
    if(!confirm('Nonaktifkan akun "' + username + '"?\n\nDi Secure Mode akun tidak dihapus permanen, hanya dinonaktifkan.')) return;
    try{
      await request('admin_user_set_active', { username, active:false });
      notify('⛔ Akun dinonaktifkan.');
      await syncTeamFromSecure(true);
      if(typeof renderTim === 'function') renderTim();
    }catch(e){ notify('Gagal nonaktifkan akun: ' + (e.message || e)); }
  };

  window.bmResetPassword = async function(username){
    const me = getCurrent();
    if(!isAdminUser(me)){ notify('⚠ Hanya BM/Admin.'); return; }
    if(!confirm('Reset password untuk "' + username + '"?\n\nPassword sementara akan ditampilkan sekali.')) return;
    try{
      const r = await request('admin_user_reset_password', { username });
      if(typeof showResetPasswordModal === 'function') showResetPasswordModal(username, r.tempPassword);
      else alert('Password sementara untuk ' + username + ':\n\n' + r.tempPassword);
      await syncTeamFromSecure(true);
      if(typeof renderTim === 'function') renderTim();
    }catch(e){ notify('Gagal reset password: ' + (e.message || e)); }
  };

  window.bmToggleSuspend = async function(username){
    const me = getCurrent();
    if(!isAdminUser(me)){ notify('⚠ Hanya BM/Admin.'); return; }
    const acc = getAccounts().find(a => String(a.username).toLowerCase() === String(username).toLowerCase());
    if(!acc){ notify('⚠ Akun tidak ditemukan'); return; }
    if(String(acc.username).toLowerCase() === String(me.username).toLowerCase()){ notify('⚠ Tidak bisa nonaktifkan akun sendiri.'); return; }
    const willSuspend = !acc.suspended;
    if(!confirm((willSuspend ? 'Nonaktifkan' : 'Aktifkan') + ' akun "' + username + '"?')) return;
    try{
      await request('admin_user_set_active', { username, active: !willSuspend });
      notify(willSuspend ? '⛔ Akun dinonaktifkan.' : '✓ Akun diaktifkan.');
      await syncTeamFromSecure(true);
      if(typeof renderTim === 'function') renderTim();
    }catch(e){ notify('Gagal update status akun: ' + (e.message || e)); }
  };

  window.bmForceLogout = async function(username){
    const me = getCurrent();
    if(!isAdminUser(me)){ notify('⚠ Hanya BM/Admin.'); return; }
    if(String(username).toLowerCase() === String(me.username).toLowerCase()){ notify('⚠ Tidak bisa force logout diri sendiri. Gunakan tombol Keluar.'); return; }
    if(!confirm('Paksa logout semua session "' + username + '"?')) return;
    try{
      const r = await request('admin_user_force_logout', { username });
      notify('🚪 Force logout selesai. Session dicabut: ' + (r.revoked || 0));
    }catch(e){ notify('Gagal force logout: ' + (e.message || e)); }
  };

  window.bmShowAuditPerUser = async function(username){
    const me = getCurrent();
    if(!isAdminUser(me)){ notify('⚠ Hanya BM/Admin.'); return; }
    try{
      const r = await request('admin_audit_list', { limit:300 });
      const rows = (r.data || []).filter(x => String(x.username || '').toLowerCase() === String(username).toLowerCase()).slice(0,100);
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
      const logsHtml = rows.length ? rows.map(l => `<div style="display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid #F1F5F9;"><div><div style="font-size:11px;font-weight:700;color:#1D4ED8;text-transform:uppercase;">${esc(l.action||'-')}</div><div style="font-size:11px;color:#64748B;line-height:1.4;">${esc(l.module||'')} ${esc(l.message||'')}</div></div><div style="font-size:10px;color:#94A3B8;white-space:nowrap;">${esc(l.timestamp||'')}</div></div>`).join('') : '<div style="padding:40px 20px;text-align:center;color:#64748B;font-size:12px;">Belum ada audit user ini.</div>';
      overlay.innerHTML = `<div style="background:white;border-radius:14px;max-width:560px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);"><div style="padding:18px 22px;border-bottom:1px solid #F1F5F9;display:flex;justify-content:space-between;align-items:center;"><div><div style="font-size:16px;font-weight:700;">📊 Audit Aktivitas</div><div style="font-size:12px;color:#64748B;margin-top:2px;">User: <b>${esc(username)}</b> · ${rows.length} aktivitas</div></div><button id="audit-close" style="background:transparent;border:none;font-size:20px;cursor:pointer;color:#64748B;">✕</button></div><div style="overflow:auto;">${logsHtml}</div></div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#audit-close').onclick = () => overlay.remove();
      overlay.onclick = e => { if(e.target === overlay) overlay.remove(); };
    }catch(e){ notify('Gagal ambil audit: ' + (e.message || e)); }
  };

  window.bmEditPhoto = function(username){
    const me = getCurrent();
    if(!isAdminUser(me)){ notify('⚠ Hanya BM/Admin.'); return; }
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = event => {
      const file = event.target.files && event.target.files[0]; if(!file) return;
      if(!file.type || !file.type.startsWith('image/')){ notify('⚠ File harus berupa gambar'); return; }
      if(file.size > 10 * 1024 * 1024){ notify('⚠ Ukuran foto maksimal 10MB'); return; }
      notify('⚙️ Memproses foto...');
      _compressAvatar(file).then(async dataUrl => {
        const acc = getAccounts().find(a => String(a.username).toLowerCase() === String(username).toLowerCase());
        if(!acc) throw new Error('Akun tidak ditemukan');
        await request('admin_user_save', { user:Object.assign({}, acc, { foto:dataUrl, active:!acc.suspended }) });
        if(String(username).toLowerCase() === String(me.username).toLowerCase()) saveSecureUser(Object.assign({}, me, { foto:dataUrl }));
        await syncTeamFromSecure(true); if(typeof renderTim === 'function') renderTim();
        notify('✓ Foto diperbarui di server');
      }).catch(e => notify('Gagal update foto: ' + (e.message || e)));
    };
    input.click();
  };

  // Settings user sendiri: foto, bio, password tetap memakai halaman lama, backend-nya Secure Mode.
  const oldSaveBioChange = window.saveBioChange;
  window.saveBioChange = async function(){
    if(!isSecureMode()) return typeof oldSaveBioChange === 'function' ? oldSaveBioChange.apply(this, arguments) : undefined;
    const el = document.getElementById('set-bio'); const bio = el && el.value ? el.value.trim() : '';
    if(bio.length > 150){ notify('⚠ Bio maksimal 150 karakter'); return; }
    try{ await saveOwnProfilePatch({ bio }); notify('✓ Bio berhasil disimpan di server'); }
    catch(e){ notify('Gagal simpan bio: ' + (e.message || e)); }
  };

  const oldUploadAvatar = window.uploadAvatar;
  window.uploadAvatar = function(event){
    if(!isSecureMode()) return typeof oldUploadAvatar === 'function' ? oldUploadAvatar.apply(this, arguments) : undefined;
    const file = event && event.target && event.target.files && event.target.files[0]; if(!file) return;
    if(!file.type || !file.type.startsWith('image/')){ notify('⚠ File harus berupa gambar'); return; }
    if(file.size > 10 * 1024 * 1024){ notify('⚠ Ukuran foto maksimal 10MB'); return; }
    notify('⚙️ Memproses foto...');
    _compressAvatar(file).then(async dataUrl => {
      await saveOwnProfilePatch({ foto:dataUrl });
      const av = document.getElementById('settings-avatar'); if(av) av.innerHTML = `<img src="${dataUrl}" alt="">`;
      const tb = document.getElementById('tb-profile-avatar'); if(tb) tb.innerHTML = `<img src="${dataUrl}" alt="">`;
      notify('✓ Foto profil diperbarui di server');
    }).catch(e => notify('Gagal update foto: ' + (e.message || e)));
  };

  const oldSavePasswordChange = window.savePasswordChange;
  window.savePasswordChange = function(){
    if(isSecureMode()) return changeOwnPassword();
    if(typeof oldSavePasswordChange === 'function') return oldSavePasswordChange.apply(this, arguments);
  };

  const oldOpenSettings = window.openSettings;
  window.openSettings = function(){
    const ret = typeof oldOpenSettings === 'function' ? oldOpenSettings.apply(this, arguments) : undefined;
    try{
      const masterSection = document.getElementById('settings-masterpw-section');
      if(masterSection && isSecureMode()) masterSection.style.display = 'none';
      const np = document.getElementById('set-pw-new'); if(np) np.placeholder = 'Min. 8 karakter';
      const np2 = document.getElementById('set-pw-new2'); if(np2) np2.placeholder = 'Ulangi password baru';
    }catch(e){}
    return ret;
  };

  // Override logout lama: logout server + bersihkan token lokal.
  const oldLogout = window.doLogout;
  window.doLogout = function(){
    logout().finally(()=>{
      if(typeof oldLogout === 'function') oldLogout();
      else { sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(CURRENT_USER_KEY); showScreen('s-login'); }
    });
  };

  window.BM4Secure = Object.assign(window.BM4Secure || {}, { login, verifySession, logout, request, refreshAccounts: syncTeamFromSecure });

  // Validasi session tersimpan setelah startup. Tidak memuat Security Center/daftar user.
  setTimeout(()=>{
    if(sessionStorage.getItem(SESSION_KEY) === 'ok' || getBm4SessionToken()){
      verifySession().then(ok => {
        if(!ok){
          if(typeof showScreen === 'function') showScreen('s-login');
          notify('Sesi tidak valid / sudah kedaluwarsa. Silakan login ulang.');
        }
      });
    }
  }, 500);
})(window);
