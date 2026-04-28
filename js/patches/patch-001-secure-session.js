// ============================================================
// BM4 SECURE SESSION ADAPTER
// Frontend adapter untuk Google Sheet Secure Mode.
// Login, verify, logout dilakukan ke Apps Script.
// ============================================================
(function(window){
  // Secure Mode di core dideklarasikan sebagai `const BM4_SECURE_MODE = true`.
  // Global `const` tidak otomatis menjadi `window.BM4_SECURE_MODE`, jadi patch
  // harus membaca dua kemungkinan ini supaya adapter benar-benar aktif.
  const secureModeOn = !!(
    window.BM4_SECURE_MODE ||
    (typeof BM4_SECURE_MODE !== 'undefined' && BM4_SECURE_MODE === true)
  );
  if(!secureModeOn) return;
  window.BM4_SECURE_MODE = true;

  function rememberEnabled(){
    // Login UI saat ini belum punya checkbox remember me. Default: sesi browser saja.
    return false;
  }

  function notify(msg){
    try { if(typeof showToast === 'function') showToast(msg); else alert(msg); }
    catch(e){ try { alert(msg); } catch(_){} }
  }

  function gotoSecurityCenter(){
    try {
      const tab = document.getElementById('tab-security');
      if(typeof switchDiv === 'function') switchDiv('security', tab || null);
      else if(typeof showScreen === 'function') showScreen('s-main');
      if(typeof bm4SecRefresh === 'function') setTimeout(()=>bm4SecRefresh(), 80);
    } catch(e){ notify('Buka tab Security untuk mengatur user, password, akses, dan session.'); }
  }

  function exposeCurrentUser(user){
    if(!user) return;
    try { currentUser = user; } catch(e){}
    try { window.currentUser = user; } catch(e){}
  }

  function isSecureMode(){
    return !!(window.BM4_SECURE_MODE || (typeof BM4_SECURE_MODE !== 'undefined' && BM4_SECURE_MODE === true));
  }

  function lockLegacyTeamControls(){
    if(!isSecureMode()) return;
    try {
      const pane = document.getElementById('pane-tim') || document;
      const host = pane.querySelector('.divisi-pane-head, .pane-head, h2, .section-head') || pane.firstElementChild || pane;
      if(host && !pane.querySelector('#bm4-tim-readonly-note')){
        const note = document.createElement('div');
        note.id = 'bm4-tim-readonly-note';
        note.style.cssText = 'margin:10px 0 14px;padding:10px 12px;border:1px solid #BFDBFE;background:#EFF6FF;color:#1D4ED8;border-radius:10px;font-size:12px;line-height:1.45;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;';
        note.innerHTML = '<span>ℹ️ Secure Mode aktif: menu ini menjadi <b>Profil Tim</b>. Reset password, akses, nonaktifkan user, force logout, session, audit, dan backup pakai tab <b>Security</b>.</span><button type="button" id="bm4-open-security-from-tim" style="border:1px solid #93C5FD;background:white;color:#1D4ED8;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;">Buka Security</button>';
        if(host.parentNode) host.parentNode.insertBefore(note, host.nextSibling);
        else pane.insertBefore(note, pane.firstChild);
        const btn = note.querySelector('#bm4-open-security-from-tim');
        if(btn) btn.onclick = gotoSecurityCenter;
      }

      const selectors = [
        'button[onclick*="openAccModal"]',
        'button[onclick*="deleteAccount"]',
        'button[onclick*="bmResetPassword"]',
        'button[onclick*="bmForceLogout"]',
        'button[onclick*="bmToggleSuspend"]',
        'button[onclick*="bmShowAuditPerUser"]',
        'button[onclick*="bmEditPhoto"]',
        '.tim-avatar-edit-btn',
        '.tim-btn-edit',
        '.tim-btn-del',
        '.tim-pw-toggle'
      ];
      pane.querySelectorAll(selectors.join(',')).forEach(el => { el.style.display = 'none'; });

      pane.querySelectorAll('.tim-card > div').forEach(div => {
        const t = (div.textContent || '').toLowerCase();
        if(t.includes('force logout') || t.includes('nonaktifkan') || t.includes('aktifkan') || t.includes('audit')){
          div.style.display = 'none';
        }
      });
    } catch(e){ console.warn('[BM4Secure] lockLegacyTeamControls failed:', e); }
  }

  function protectLegacyTeamFunctions(){
    if(window.__BM4_SECURE_PROTECTED_LEGACY_TEAM__) return;
    window.__BM4_SECURE_PROTECTED_LEGACY_TEAM__ = true;
    const msg = 'Secure Mode aktif. Pengaturan user/password/akses/session dipindahkan ke tab Security.';
    ['openAccModal','saveAccount','deleteAccount','bmResetPassword','bmForceLogout','bmToggleSuspend','bmShowAuditPerUser'].forEach(name => {
      try {
        const oldFn = window[name];
        window['__legacy_' + name] = oldFn;
        window[name] = function(){ notify(msg); gotoSecurityCenter(); return false; };
      } catch(e){}
    });
  }

  function saveSecureUser(user){
    if(!user) return;
    try {
      sessionStorage.setItem(BM4_SESSION_USER_KEY, JSON.stringify(user));
      localStorage.setItem('bm4_last_username', user.username || '');
    } catch(e){}
    exposeCurrentUser(user);
    // Supaya fungsi lama findAccount/applyUserAccess tetap bekerja, injeksi user server ke accounts lokal runtime.
    try {
      if(Array.isArray(window.accounts)){
        const idx = window.accounts.findIndex(a => String(a.username).toLowerCase() === String(user.username).toLowerCase());
        const normalized = Object.assign({ password:'', foto:'', bio:'' }, user, { akses: user.akses || [] });
        if(idx >= 0) window.accounts[idx] = Object.assign({}, window.accounts[idx], normalized);
        else window.accounts.push(normalized);
      } else if(typeof accounts !== 'undefined' && Array.isArray(accounts)){
        const idx = accounts.findIndex(a => String(a.username).toLowerCase() === String(user.username).toLowerCase());
        const normalized = Object.assign({ password:'', foto:'', bio:'' }, user, { akses: user.akses || [] });
        if(idx >= 0) accounts[idx] = Object.assign({}, accounts[idx], normalized);
        else accounts.push(normalized);
      }
    } catch(e){}
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
      const err = new Error(msg);
      err.response = json;
      throw err;
    }
    return json;
  }

  async function login(){
    const usernameEl = document.getElementById('login-username');
    const passwordEl = document.getElementById('login-input');
    const errEl = document.getElementById('login-error');
    const username = (usernameEl && usernameEl.value || '').trim();
    const password = passwordEl && passwordEl.value || '';

    if(errEl){ errEl.classList.remove('show'); errEl.textContent = 'Username atau password salah. Coba lagi.'; }
    if(!username || !password){
      if(errEl){ errEl.textContent = 'Username dan password wajib diisi.'; errEl.classList.add('show'); }
      return;
    }

    try{
      setSyncStatus && setSyncStatus('loading','Login ke server aman...');
      const r = await request('auth_login', {
        username,
        password,
        deviceInfo: navigator.userAgent || 'browser'
      });
      setBm4SessionToken(r.sessionToken, rememberEnabled());
      saveSecureUser(r.user);
      exposeCurrentUser(r.user);
      sessionStorage.setItem(SESSION_KEY, 'ok');
      sessionStorage.setItem(CURRENT_USER_KEY, r.user.username);
      sessionStorage.setItem('bm4_session_start', String(Date.now()));
      if(passwordEl) passwordEl.value = '';
      if(typeof applyUserAccess === 'function') applyUserAccess();
      protectLegacyTeamFunctions();
      lockLegacyTeamControls();
      if(typeof startSessionTimer === 'function') startSessionTimer();
      setSyncStatus && setSyncStatus('synced','Login aman berhasil');
      showScreen('s-proyek');
      // Muat data setelah session valid.
      setTimeout(()=>{
        try { if(typeof loadFromSheets === 'function') loadFromSheets(); } catch(e){}
        try { if(typeof loadTpFromSheets === 'function') loadTpFromSheets(); } catch(e){}
        try { if(typeof loadProyekFromSheets === 'function') loadProyekFromSheets().then(()=>{ if(typeof renderProyekCards==='function') renderProyekCards(); }); } catch(e){}
      }, 100);
    }catch(e){
      clearBm4SessionToken();
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(CURRENT_USER_KEY);
      if(errEl){ errEl.textContent = e.message || 'Login gagal.'; errEl.classList.add('show'); }
      setSyncStatus && setSyncStatus('offline','Login gagal');
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
        exposeCurrentUser(r.user);
        sessionStorage.setItem(SESSION_KEY, 'ok');
        sessionStorage.setItem(CURRENT_USER_KEY, r.user.username);
        if(typeof applyUserAccess === 'function') applyUserAccess();
        protectLegacyTeamFunctions();
        lockLegacyTeamControls();
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
    try { window.currentUser = null; } catch(e){}
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
      if(oldEl) oldEl.value = '';
      if(newEl) newEl.value = '';
      if(new2El) new2El.value = '';
      notify('✓ Password berhasil diubah di Secure Mode.');
    }catch(e){
      notify('Gagal ubah password: ' + (e.message || e));
    }
  }

  const oldSavePasswordChange = window.savePasswordChange;
  window.savePasswordChange = function(){
    if(isSecureMode()) return changeOwnPassword();
    if(typeof oldSavePasswordChange === 'function') return oldSavePasswordChange.apply(this, arguments);
  };

  const oldOpenSettings = window.openSettings;
  window.openSettings = function(){
    const ret = typeof oldOpenSettings === 'function' ? oldOpenSettings.apply(this, arguments) : undefined;
    try {
      const np = document.getElementById('set-pw-new');
      const np2 = document.getElementById('set-pw-new2');
      if(np) np.placeholder = 'Min. 8 karakter';
      if(np2) np2.placeholder = 'Ulangi password baru';
      const masterSection = document.getElementById('settings-masterpw-section');
      if(masterSection && isSecureMode()) masterSection.style.display = 'none';
    } catch(e){}
    return ret;
  };

  window.BM4Secure = { login, verifySession, logout, request };

  try {
    const oldRenderTim = window.renderTim;
    if(typeof oldRenderTim === 'function'){
      window.renderTim = function(){
        const ret = oldRenderTim.apply(this, arguments);
        setTimeout(lockLegacyTeamControls, 0);
        return ret;
      };
      try { renderTim = window.renderTim; } catch(e){}
    }
    protectLegacyTeamFunctions();
    setTimeout(lockLegacyTeamControls, 700);
    setTimeout(lockLegacyTeamControls, 1500);
  } catch(e){}

  // Override logout lama: logout server + bersihkan token lokal.
  const oldLogout = window.doLogout;
  window.doLogout = function(){
    logout().finally(()=>{
      if(typeof oldLogout === 'function') oldLogout();
      else {
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(CURRENT_USER_KEY);
        showScreen('s-login');
      }
    });
  };

  // Validasi session tersimpan setelah semua script lama selesai startup.
  setTimeout(()=>{
    if(sessionStorage.getItem(SESSION_KEY) === 'ok' || getBm4SessionToken()){
      verifySession().then(ok => {
        if(!ok){
          if(typeof showScreen === 'function') showScreen('s-login');
          if(typeof showToast === 'function') showToast('Sesi tidak valid / sudah kedaluwarsa. Silakan login ulang.');
        }
      });
    }
  }, 500);
})(window);
