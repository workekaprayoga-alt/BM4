// ============================================================
// BM4 SECURE SESSION ADAPTER
// Frontend adapter untuk Google Sheet Secure Mode.
// Login, verify, logout dilakukan ke Apps Script.
// ============================================================
(function(window){
  if(!window.BM4_SECURE_MODE) return;

  function rememberEnabled(){
    // Login UI saat ini belum punya checkbox remember me. Default: sesi browser saja.
    return false;
  }

  function saveSecureUser(user){
    if(!user) return;
    try {
      sessionStorage.setItem(BM4_SESSION_USER_KEY, JSON.stringify(user));
      localStorage.setItem('bm4_last_username', user.username || '');
    } catch(e){}
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
      currentUser = r.user;
      sessionStorage.setItem(SESSION_KEY, 'ok');
      sessionStorage.setItem(CURRENT_USER_KEY, r.user.username);
      sessionStorage.setItem('bm4_session_start', String(Date.now()));
      if(passwordEl) passwordEl.value = '';
      if(typeof applyUserAccess === 'function') applyUserAccess();
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
        currentUser = r.user;
        sessionStorage.setItem(SESSION_KEY, 'ok');
        sessionStorage.setItem(CURRENT_USER_KEY, r.user.username);
        if(typeof applyUserAccess === 'function') applyUserAccess();
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
  }

  window.BM4Secure = { login, verifySession, logout, request };

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
