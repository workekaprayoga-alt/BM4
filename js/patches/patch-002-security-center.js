// ============================================================
// BM4 Secure Mode v2 — Security Center
// Admin/BM panel for users, sessions, audit log, and backups.
// ============================================================
(function(window){
  const ACCESS_ITEMS = [
    ['dashboard','Dashboard'], ['analisa','Analisa Lokasi'], ['strategi','Strategi & Promo'], ['sales','Sales'],
    ['konstruksi','Konstruksi'], ['legal','Legal'], ['finance','Finance'], ['galeri','Galeri Tim'], ['tim','Tim BM4'], ['proyek','Proyek']
  ];
  const ADMIN_ROLES = ['bm','owner','admin'];
  const state = { loaded:false, users:[], sessions:[], audit:[], backups:[], currentTab:'users' };

  function isAdmin(){
    try { return window.currentUser && ADMIN_ROLES.includes(String(window.currentUser.role||'').toLowerCase()); }
    catch(e){ return false; }
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtDate(s){
    if(!s) return '—';
    const d = new Date(s);
    if(isNaN(d.getTime())) return esc(s);
    return d.toLocaleDateString('id-ID') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  function notify(msg){ if(typeof showToast === 'function') showToast(msg); else alert(msg); }
  async function req(action, payload){
    if(window.BM4Secure && typeof window.BM4Secure.request === 'function') return window.BM4Secure.request(action, payload || {});
    if(window.BM4Api && typeof window.BM4Api.post === 'function') return window.BM4Api.post(action, payload || {});
    throw new Error('Secure API belum siap.');
  }

  function updateTabAccess(){
    const tab = document.getElementById('tab-security');
    if(tab) tab.style.display = isAdmin() ? '' : 'none';
  }

  function ensureAccessGrid(){
    const wrap = document.getElementById('sec-access-grid');
    if(!wrap || wrap.dataset.ready) return;
    wrap.innerHTML = ACCESS_ITEMS.map(([id,label]) =>
      `<label class="sec-check"><input type="checkbox" value="${esc(id)}" data-sec-access onchange="this.closest('.sec-check').classList.toggle('checked', this.checked)"> ${esc(label)}</label>`
    ).join('');
    wrap.dataset.ready = '1';
  }

  async function loadAll(){
    if(!isAdmin()) return;
    ensureAccessGrid();
    setBusy(true);
    try{
      const [u,s,a,b] = await Promise.all([
        req('admin_users_list', {}),
        req('admin_sessions_list', {}),
        req('admin_audit_list', { limit:120 }),
        req('admin_backup_status', { limit:20 })
      ]);
      state.users = u.data || [];
      state.sessions = s.data || [];
      state.audit = a.data || [];
      state.backups = b.data || [];
      state.loaded = true;
      renderAll();
      if(typeof setSyncStatus === 'function') setSyncStatus('synced','Security Center tersinkron');
    }catch(e){
      console.error(e);
      notify('Security Center gagal memuat: ' + (e.message || e));
      if(typeof setSyncStatus === 'function') setSyncStatus('offline','Security Center gagal');
    }finally{ setBusy(false); }
  }

  function setBusy(on){
    document.querySelectorAll('.sec-btn').forEach(b => { if(b.textContent.indexOf('Refresh') >= 0 || b.textContent.indexOf('Backup') >= 0) b.disabled = !!on; });
  }

  function renderAll(){ renderStats(); renderUsers(); renderSessions(); renderAudit(); renderBackups(); }
  function renderStats(){
    const activeUsers = state.users.filter(u => u.active !== false && String(u.active).toLowerCase() !== 'false').length;
    const activeSessions = state.sessions.filter(s => s.active !== false && String(s.active).toLowerCase() !== 'false').length;
    const lastBackup = state.backups[0] ? fmtDate(state.backups[0].timestamp || state.backups[0].createdAt) : 'Belum ada';
    const set = (id,val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
    set('sec-stat-users', activeUsers); set('sec-stat-sessions', activeSessions); set('sec-stat-audit', state.audit.length); set('sec-stat-backup', lastBackup);
  }

  function renderUsers(){
    const el = document.getElementById('sec-users-body'); if(!el) return;
    if(!state.users.length){ el.innerHTML = '<tr><td colspan="5">Belum ada user.</td></tr>'; return; }
    el.innerHTML = state.users.map(u => {
      const active = u.active !== false && String(u.active).toLowerCase() !== 'false';
      const akses = Array.isArray(u.akses) ? u.akses : String(u.akses||'').split(',').filter(Boolean);
      return `<tr>
        <td><b>${esc(u.nama || u.username)}</b><div class="sec-muted">@${esc(u.username)} · ${esc(u.jabatan||'')}</div></td>
        <td><span class="sec-pill role">${esc(u.role||'viewer')}</span></td>
        <td>${akses.slice(0,5).map(x=>`<span class="sec-muted">${esc(x)}</span>`).join(', ')}${akses.length>5?' …':''}</td>
        <td><span class="sec-pill ${active?'ok':'off'}">${active?'Aktif':'Nonaktif'}</span></td>
        <td><div class="sec-actions">
          <button class="sec-action-btn" onclick="bm4SecEditUser('${esc(u.username)}')">Edit</button>
          <button class="sec-action-btn" onclick="bm4SecResetPassword('${esc(u.username)}')">Reset PW</button>
          <button class="sec-action-btn danger" onclick="bm4SecSetUserActive('${esc(u.username)}', ${active?'false':'true'})">${active?'Nonaktifkan':'Aktifkan'}</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  function renderSessions(){
    const el = document.getElementById('sec-sessions-body'); if(!el) return;
    if(!state.sessions.length){ el.innerHTML = '<tr><td colspan="6">Tidak ada session aktif.</td></tr>'; return; }
    el.innerHTML = state.sessions.map(s => `<tr>
      <td><b>${esc(s.username)}</b><div class="sec-muted">${esc(s.userId||'')}</div></td>
      <td>${fmtDate(s.createdAt)}</td><td>${fmtDate(s.lastSeen)}</td><td>${fmtDate(s.expiresAt)}</td>
      <td><div class="sec-muted" style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.deviceInfo||'—')}</div></td>
      <td><button class="sec-action-btn danger" onclick="bm4SecRevokeSession('${esc(s.sessionId)}')">Logout paksa</button></td>
    </tr>`).join('');
  }

  function renderAudit(){
    const el = document.getElementById('sec-audit-body'); if(!el) return;
    const q = String((document.getElementById('sec-audit-q')||{}).value || '').toLowerCase();
    const st = String((document.getElementById('sec-audit-status')||{}).value || '').toLowerCase();
    let rows = state.audit.slice();
    if(q) rows = rows.filter(r => [r.username,r.action,r.module,r.message,r.role].join(' ').toLowerCase().includes(q));
    if(st) rows = rows.filter(r => String(r.status||'').toLowerCase() === st);
    if(!rows.length){ el.innerHTML = '<tr><td colspan="7">Audit log kosong.</td></tr>'; return; }
    el.innerHTML = rows.map(r => `<tr>
      <td>${fmtDate(r.timestamp)}</td><td>${esc(r.username||'—')}</td><td>${esc(r.role||'—')}</td>
      <td><b>${esc(r.action||'—')}</b></td><td>${esc(r.module||'—')}</td>
      <td><span class="sec-pill ${(String(r.status).toLowerCase()==='success')?'ok':'off'}">${esc(r.status||'—')}</span></td>
      <td><div class="sec-muted" style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.message||'')}</div></td>
    </tr>`).join('');
  }

  function renderBackups(){
    const el = document.getElementById('sec-backups-body'); if(!el) return;
    if(!state.backups.length){ el.innerHTML = '<tr><td colspan="4">Belum ada riwayat backup.</td></tr>'; return; }
    el.innerHTML = state.backups.map(b => `<tr>
      <td>${fmtDate(b.timestamp || b.createdAt)}</td><td><b>${esc(b.name||'Backup')}</b></td><td><span class="sec-muted">${esc(b.fileId||'')}</span></td><td>${esc(b.username||b.createdBy||'system')}</td>
    </tr>`).join('');
  }

  function selectedAccess(){ return Array.from(document.querySelectorAll('[data-sec-access]:checked')).map(x => x.value); }
  function setSelectedAccess(arr){
    arr = Array.isArray(arr) ? arr : String(arr||'').split(',').filter(Boolean);
    document.querySelectorAll('[data-sec-access]').forEach(x => { x.checked = arr.includes(x.value); if(x.closest('.sec-check')) x.closest('.sec-check').classList.toggle('checked', x.checked); });
  }

  window.bm4SecSwitchTab = function(tab, btn){
    state.currentTab = tab;
    document.querySelectorAll('.sec-tab').forEach(x=>x.classList.remove('active'));
    if(btn) btn.classList.add('active');
    document.querySelectorAll('.sec-panel').forEach(x=>x.classList.remove('active'));
    const p = document.getElementById('sec-panel-' + tab); if(p) p.classList.add('active');
    if(!state.loaded) loadAll();
  };
  window.bm4SecRefreshAll = loadAll;
  window.bm4SecRenderAudit = renderAudit;

  window.bm4SecClearUserForm = function(){
    ['sec-user-username','sec-user-nama','sec-user-jabatan','sec-user-password'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    const role=document.getElementById('sec-user-role'); if(role) role.value='viewer';
    setSelectedAccess(['dashboard','galeri']);
  };

  window.bm4SecEditUser = function(username){
    ensureAccessGrid();
    const u = state.users.find(x => String(x.username).toLowerCase() === String(username).toLowerCase());
    if(!u) return;
    const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=v||''; };
    set('sec-user-username', u.username); set('sec-user-nama', u.nama); set('sec-user-jabatan', u.jabatan); set('sec-user-role', u.role||'viewer'); set('sec-user-password','');
    setSelectedAccess(u.akses || []);
    notify('User dimuat ke form. Edit lalu klik Simpan User.');
  };

  window.bm4SecSaveUser = async function(){
    const data = {
      username: (document.getElementById('sec-user-username')||{}).value || '',
      nama: (document.getElementById('sec-user-nama')||{}).value || '',
      jabatan: (document.getElementById('sec-user-jabatan')||{}).value || '',
      role: (document.getElementById('sec-user-role')||{}).value || 'viewer',
      password: (document.getElementById('sec-user-password')||{}).value || '',
      akses: selectedAccess(), active: true
    };
    if(!data.username.trim()){ notify('Username wajib diisi.'); return; }
    try{ setBusy(true); await req('admin_user_save', { user:data }); notify('User tersimpan.'); bm4SecClearUserForm(); await loadAll(); }
    catch(e){ notify('Gagal simpan user: ' + (e.message||e)); }
    finally{ setBusy(false); }
  };

  window.bm4SecResetPassword = async function(username){
    if(!confirm('Reset password untuk ' + username + '?')) return;
    try{ const r = await req('admin_user_reset_password', { username }); alert('Password sementara untuk ' + username + ':\n\n' + r.tempPassword + '\n\nSegera minta user mengganti password setelah login.'); await loadAll(); }
    catch(e){ notify('Gagal reset password: ' + (e.message||e)); }
  };
  window.bm4SecSetUserActive = async function(username, active){
    try{ await req('admin_user_set_active', { username, active: !!active }); notify('Status user diperbarui.'); await loadAll(); }
    catch(e){ notify('Gagal update user: ' + (e.message||e)); }
  };
  window.bm4SecRevokeSession = async function(sessionId){
    if(!confirm('Logout paksa session ini?')) return;
    try{ await req('admin_session_revoke', { sessionId }); notify('Session dicabut.'); await loadAll(); }
    catch(e){ notify('Gagal cabut session: ' + (e.message||e)); }
  };
  window.bm4SecBackupNow = async function(){
    try{ setBusy(true); const r = await req('admin_backup_now', {}); notify('Backup berhasil: ' + (r.name || 'BM4 Backup')); await loadAll(); }
    catch(e){ notify('Backup gagal: ' + (e.message||e)); }
    finally{ setBusy(false); }
  };

  const oldApply = window.applyUserAccess;
  window.applyUserAccess = function(){ if(typeof oldApply === 'function') oldApply(); updateTabAccess(); };
  const oldSwitch = window.switchDiv;
  window.switchDiv = function(div, el){
    if(div === 'security' && !isAdmin()){ notify('Akses Security Center hanya untuk BM/Admin.'); return; }
    if(typeof oldSwitch === 'function') oldSwitch(div, el);
    if(div === 'security') setTimeout(loadAll, 50);
  };

  document.addEventListener('DOMContentLoaded', () => { ensureAccessGrid(); updateTabAccess(); bm4SecClearUserForm(); });
  setTimeout(()=>{ ensureAccessGrid(); updateTabAccess(); bm4SecClearUserForm(); }, 700);
})(window);
