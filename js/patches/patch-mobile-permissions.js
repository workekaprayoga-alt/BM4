// ============================================================
// PATCH: Mobile Permissions Panel UI (Step 3)
// ============================================================
// File: js/patches/patch-mobile-permissions.js
// Fungsi: Bangun tab "🔐 Akses Mobile" untuk BM atur permission tim
// Versi: 1.0
// Tanggal: 2026-05-01
//
// FITUR:
// 1. Tab navigation baru "🔐 Akses Mobile" — hanya untuk BM
// 2. Tabel matrix Role × Modul × (View/Add/Edit/Delete)
// 3. Toggle checkbox langsung edit
// 4. Save bulk ke Sheets via endpoint saveMobilePermissions
// 5. Audit log otomatis (siapa ngubah apa kapan)
// 6. Reset ke default
// ============================================================

(function(){
  'use strict';

  // ============================================================
  // CONFIG
  // ============================================================
  const ROLES = [
    { id: 'bm', label: 'Branch Manager', color: '#1E40AF', readOnly: true }, // BM selalu full access
    { id: 'strategi', label: 'Strategi', color: '#059669' },
    { id: 'sales', label: 'Sales', color: '#D97706' },
    { id: 'konstruksi', label: 'Konstruksi', color: '#7C3AED' },
    { id: 'legal', label: 'Legal', color: '#0891B2' },
    { id: 'finance', label: 'Finance', color: '#DB2777' }
  ];

  const MODULES = [
    { id: 'target_pasar', label: '🎯 Target Pasar', desc: 'List target market di mobile' },
    { id: 'detail_target', label: '📍 Detail Target', desc: 'Modal detail + rute jalan' }
  ];

  const ACTIONS = [
    { id: 'view', label: 'Lihat', icon: '👁' },
    { id: 'create', label: 'Tambah', icon: '➕' },
    { id: 'edit', label: 'Edit', icon: '✏️' },
    { id: 'delete', label: 'Hapus', icon: '🗑' }
  ];

  // Default permissions saat reset
  const DEFAULT_PERMISSIONS = {
    'bm|target_pasar':       { view:true, create:true, edit:true, delete:true },
    'bm|detail_target':      { view:true, create:true, edit:true, delete:true },
    'strategi|target_pasar': { view:true, create:true, edit:true, delete:false },
    'strategi|detail_target':{ view:true, create:true, edit:true, delete:false },
    'sales|target_pasar':    { view:true, create:false, edit:false, delete:false },
    'sales|detail_target':   { view:true, create:false, edit:false, delete:false },
    'konstruksi|target_pasar':  { view:false, create:false, edit:false, delete:false },
    'konstruksi|detail_target': { view:false, create:false, edit:false, delete:false },
    'legal|target_pasar':    { view:false, create:false, edit:false, delete:false },
    'legal|detail_target':   { view:false, create:false, edit:false, delete:false },
    'finance|target_pasar':  { view:false, create:false, edit:false, delete:false },
    'finance|detail_target': { view:false, create:false, edit:false, delete:false }
  };

  // ============================================================
  // STATE
  // ============================================================
  let permissions = {}; // { 'role|module': {view,create,edit,delete} }
  let originalSnapshot = {}; // untuk detect dirty
  let dirty = false;
  let loading = false;

  // ============================================================
  // INJECTION: Tab + Pane
  // ============================================================
  function injectTab(){
    const navBar = document.querySelector('.divisi-nav');
    if(!navBar) return;
    if(document.getElementById('tab-mobperm')) return; // sudah ada

    const btn = document.createElement('button');
    btn.className = 'divisi-tab';
    btn.id = 'tab-mobperm';
    btn.dataset.div = 'mobperm';
    btn.style.display = 'none'; // hidden by default, show kalau BM
    btn.innerHTML = '🔐 Akses Mobile';
    btn.onclick = () => switchDiv('mobperm', btn);

    // Insert sebelum tab-security (kalau ada) atau di akhir
    const secTab = document.getElementById('tab-security');
    if(secTab && secTab.parentNode === navBar){
      navBar.insertBefore(btn, secTab);
    } else {
      navBar.appendChild(btn);
    }
  }

  function injectPane(){
    const contentArea = document.querySelector('.content-area');
    if(!contentArea) return;
    if(document.getElementById('pane-mobperm')) return;

    const pane = document.createElement('div');
    pane.className = 'divisi-pane';
    pane.id = 'pane-mobperm';
    pane.innerHTML = `
      <div class="mobperm-wrap">
        <div class="mobperm-head">
          <div>
            <div class="mobperm-kicker">Step 3 — Akses Mobile</div>
            <h2>🔐 Pengaturan Akses Mobile</h2>
            <p>Atur hak akses tim per role × modul. Perubahan langsung sync ke Sheets dan diterapkan ke aplikasi mobile.</p>
          </div>
          <div class="mobperm-head-actions">
            <button class="mobperm-btn mobperm-btn-secondary" onclick="window.MobPerm.refresh()">↻ Refresh</button>
            <button class="mobperm-btn mobperm-btn-secondary" onclick="window.MobPerm.resetDefault()">↺ Reset Default</button>
            <button class="mobperm-btn mobperm-btn-primary" id="mobperm-save-btn" onclick="window.MobPerm.saveAll()" disabled>💾 Simpan Perubahan</button>
          </div>
        </div>

        <div class="mobperm-info" id="mobperm-info">
          Memuat data permissions...
        </div>

        <div class="mobperm-table-wrap" id="mobperm-table-wrap">
          <table class="mobperm-table">
            <thead>
              <tr>
                <th class="mobperm-col-role">Role</th>
                <th class="mobperm-col-mod">Modul</th>
                ${ACTIONS.map(a => `<th class="mobperm-col-act" title="${a.label}">${a.icon}<br><span>${a.label}</span></th>`).join('')}
              </tr>
            </thead>
            <tbody id="mobperm-tbody">
              <tr><td colspan="6" style="text-align:center;padding:40px;color:#9CA3AF;">Memuat...</td></tr>
            </tbody>
          </table>
        </div>

        <div class="mobperm-legend">
          <div class="mobperm-legend-item">
            <span class="mobperm-legend-dot" style="background:#1E40AF;"></span>
            <span>Branch Manager (BM) selalu full access — tidak bisa diubah</span>
          </div>
          <div class="mobperm-legend-item">
            <span class="mobperm-legend-dot" style="background:#10B981;"></span>
            <span>Centang = role boleh akses · Kosong = tidak boleh</span>
          </div>
          <div class="mobperm-legend-item">
            <span class="mobperm-legend-dot" style="background:#F59E0B;"></span>
            <span>Setelah klik Simpan, tim mobile harus logout-login untuk dapat update</span>
          </div>
        </div>
      </div>
    `;
    contentArea.appendChild(pane);
  }

  function injectStyle(){
    if(document.getElementById('mobperm-style')) return;
    const style = document.createElement('style');
    style.id = 'mobperm-style';
    style.textContent = `
      .mobperm-wrap{padding:24px 28px;max-width:1100px;margin:0 auto;}
      .mobperm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px;flex-wrap:wrap;}
      .mobperm-head h2{margin:4px 0 6px;font-size:22px;color:#0F172A;font-weight:700;}
      .mobperm-head p{margin:0;font-size:13px;color:#64748B;line-height:1.5;}
      .mobperm-kicker{font-size:11px;font-weight:700;color:#3B82F6;letter-spacing:1.5px;text-transform:uppercase;}
      .mobperm-head-actions{display:flex;gap:8px;flex-wrap:wrap;}
      .mobperm-btn{padding:8px 14px;border-radius:8px;border:1px solid transparent;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.15s;}
      .mobperm-btn-primary{background:#1E40AF;color:white;}
      .mobperm-btn-primary:hover:not(:disabled){background:#1E3A8A;}
      .mobperm-btn-primary:disabled{background:#94A3B8;cursor:not-allowed;}
      .mobperm-btn-secondary{background:white;color:#475569;border-color:#CBD5E1;}
      .mobperm-btn-secondary:hover{background:#F8FAFC;border-color:#94A3B8;}

      .mobperm-info{padding:12px 16px;border-radius:8px;font-size:12px;line-height:1.5;margin-bottom:16px;background:#EFF6FF;color:#1E40AF;border:1px solid #BFDBFE;}
      .mobperm-info.dirty{background:#FEF3C7;color:#92400E;border-color:#FDE68A;}
      .mobperm-info.success{background:#DCFCE7;color:#15803D;border-color:#86EFAC;}
      .mobperm-info.error{background:#FEE2E2;color:#B91C1C;border-color:#FCA5A5;}

      .mobperm-table-wrap{background:white;border-radius:12px;border:1px solid #E2E8F0;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);}
      .mobperm-table{width:100%;border-collapse:collapse;}
      .mobperm-table thead{background:#F8FAFC;border-bottom:2px solid #E2E8F0;}
      .mobperm-table th{padding:12px 14px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;}
      .mobperm-col-act{text-align:center !important;font-size:14px !important;}
      .mobperm-col-act span{font-size:9px;font-weight:600;color:#64748B;display:block;margin-top:2px;}
      .mobperm-table td{padding:12px 14px;border-bottom:1px solid #F1F5F9;font-size:13px;color:#0F172A;}
      .mobperm-table tr:last-child td{border-bottom:none;}
      .mobperm-table tr:hover{background:#FAFBFC;}

      .mobperm-role-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;color:white;}
      .mobperm-mod-name{font-weight:600;color:#0F172A;display:block;}
      .mobperm-mod-desc{font-size:10px;color:#94A3B8;margin-top:2px;}

      .mobperm-checkbox-cell{text-align:center;}
      .mobperm-check{width:22px;height:22px;cursor:pointer;accent-color:#10B981;}
      .mobperm-check:disabled{opacity:0.4;cursor:not-allowed;}
      .mobperm-check.dirty{outline:2px solid #F59E0B;outline-offset:2px;border-radius:4px;}

      .mobperm-readonly-row{background:#F8FAFC;}
      .mobperm-readonly-row .mobperm-check{accent-color:#1E40AF;}

      .mobperm-legend{margin-top:18px;padding:14px 18px;background:#F8FAFC;border-radius:8px;border:1px solid #E2E8F0;}
      .mobperm-legend-item{display:flex;align-items:center;gap:10px;font-size:11px;color:#475569;line-height:1.6;}
      .mobperm-legend-item:not(:last-child){margin-bottom:6px;}
      .mobperm-legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}

      @media (max-width: 768px){
        .mobperm-wrap{padding:16px;}
        .mobperm-head{flex-direction:column;}
        .mobperm-table th, .mobperm-table td{padding:8px;font-size:11px;}
        .mobperm-col-act{font-size:12px !important;}
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // CORE LOGIC
  // ============================================================
  function showInfo(msg, type){
    const el = document.getElementById('mobperm-info');
    if(!el) return;
    el.className = 'mobperm-info' + (type ? ' ' + type : '');
    el.textContent = msg;
  }

  function setDirty(isDirty){
    dirty = isDirty;
    const btn = document.getElementById('mobperm-save-btn');
    if(btn) btn.disabled = !isDirty;
    if(isDirty){
      showInfo('⚠️ Ada perubahan yang belum disimpan. Klik "Simpan Perubahan" untuk apply ke Sheets.', 'dirty');
    }
  }

  function permKey(role, module){
    return role + '|' + module;
  }

  function getPerm(role, module){
    return permissions[permKey(role, module)] || { view:false, create:false, edit:false, delete:false };
  }

  function updatePerm(role, module, action, value){
    const key = permKey(role, module);
    if(!permissions[key]) permissions[key] = { view:false, create:false, edit:false, delete:false };
    permissions[key][action] = value;
    // Cek dirty
    const orig = originalSnapshot[key] || {};
    const isDirty = orig[action] !== value;
    // Mark cell as dirty visually
    const cb = document.querySelector(`[data-perm-key="${key}"][data-perm-action="${action}"]`);
    if(cb) cb.classList.toggle('dirty', isDirty);
    // Cek apakah ada perubahan global
    const anyDirty = Object.keys(permissions).some(k => {
      const p = permissions[k];
      const o = originalSnapshot[k] || {};
      return ['view','create','edit','delete'].some(a => (p[a] || false) !== (o[a] || false));
    });
    setDirty(anyDirty);
  }

  // ============================================================
  // LOAD FROM SHEETS
  // ============================================================
  async function loadPermissions(){
    if(loading) return;
    loading = true;
    showInfo('⏳ Memuat data permissions dari Sheets...', '');

    try {
      let result;
      if(window.BM4Api && typeof window.BM4Api.get === 'function'){
        result = await window.BM4Api.get('getMobilePermissions');
      } else {
        throw new Error('BM4Api belum siap');
      }

      if(result && result.success && Array.isArray(result.data)){
        // Map data dari Sheets jadi format internal
        permissions = {};
        result.data.forEach(row => {
          const role = String(row.role||'').toLowerCase();
          const module = String(row.module||'').toLowerCase();
          if(!role || !module) return;
          permissions[permKey(role, module)] = {
            view: !!row.view,
            create: !!row.create,
            edit: !!row.edit,
            delete: !!row.delete
          };
        });
        // Snapshot untuk detect dirty
        originalSnapshot = JSON.parse(JSON.stringify(permissions));

        renderTable();
        showInfo(`✓ ${result.data.length} permission rules dimuat dari Sheets.`, 'success');
        setTimeout(() => {
          if(!dirty) showInfo('Klik checkbox untuk ubah akses. Branch Manager selalu full access.', '');
        }, 2500);
      } else {
        // Sheets kosong — pakai default
        showInfo('Sheets kosong — pakai default permissions. Klik Simpan untuk seed.', '');
        permissions = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
        originalSnapshot = {};
        renderTable();
        setDirty(true);
      }
    } catch(e){
      console.error('[MobPerm] load error:', e);
      showInfo('✗ Gagal load: ' + e.message + '. Pakai default.', 'error');
      permissions = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
      originalSnapshot = JSON.parse(JSON.stringify(permissions));
      renderTable();
    } finally {
      loading = false;
    }
  }

  // ============================================================
  // RENDER TABLE
  // ============================================================
  function renderTable(){
    const tbody = document.getElementById('mobperm-tbody');
    if(!tbody) return;

    let html = '';
    ROLES.forEach(role => {
      MODULES.forEach((mod, idx) => {
        const isFirstMod = idx === 0;
        const perm = getPerm(role.id, mod.id);
        const isReadOnly = role.readOnly;

        html += `<tr ${isReadOnly ? 'class="mobperm-readonly-row"' : ''}>`;
        if(isFirstMod){
          html += `<td rowspan="${MODULES.length}" style="vertical-align:top;">
            <span class="mobperm-role-badge" style="background:${role.color};">${escapeHtml(role.label)}</span>
            ${isReadOnly ? '<div style="font-size:9px;color:#64748B;margin-top:6px;font-style:italic;">Full access (locked)</div>' : ''}
          </td>`;
        }
        html += `<td>
          <span class="mobperm-mod-name">${escapeHtml(mod.label)}</span>
          <span class="mobperm-mod-desc">${escapeHtml(mod.desc)}</span>
        </td>`;
        ACTIONS.forEach(act => {
          const key = permKey(role.id, mod.id);
          const checked = perm[act.id] || isReadOnly;
          html += `<td class="mobperm-checkbox-cell">
            <input type="checkbox"
                   class="mobperm-check"
                   data-perm-key="${key}"
                   data-perm-action="${act.id}"
                   ${checked ? 'checked' : ''}
                   ${isReadOnly ? 'disabled' : ''}
                   onchange="window.MobPerm.onChange('${role.id}','${mod.id}','${act.id}',this.checked)">
          </td>`;
        });
        html += `</tr>`;
      });
    });
    tbody.innerHTML = html;
  }

  // ============================================================
  // SAVE TO SHEETS
  // ============================================================
  async function saveAll(){
    if(!dirty){
      showInfo('Tidak ada perubahan untuk disimpan.', '');
      return;
    }
    if(!confirm('Simpan perubahan permission ke Sheets?\n\nTim mobile harus logout-login untuk apply update.')){
      return;
    }

    showInfo('⏳ Menyimpan ke Sheets...', '');
    const btn = document.getElementById('mobperm-save-btn');
    if(btn) btn.disabled = true;

    try {
      // Build rows untuk dikirim ke Sheets
      const rows = [];
      ROLES.forEach(role => {
        MODULES.forEach(mod => {
          const perm = getPerm(role.id, mod.id);
          // BM selalu full access
          const finalPerm = role.readOnly ? { view:true, create:true, edit:true, delete:true } : perm;
          rows.push({
            role: role.id,
            module: mod.id,
            view: !!finalPerm.view,
            create: !!finalPerm.create,
            edit: !!finalPerm.edit,
            delete: !!finalPerm.delete
          });
        });
      });

      const result = await window.BM4Api.post('saveMobilePermissions', { rows: rows });

      if(result && result.success){
        // Update snapshot
        originalSnapshot = JSON.parse(JSON.stringify(permissions));
        // BM selalu full
        ROLES.filter(r => r.readOnly).forEach(role => {
          MODULES.forEach(mod => {
            originalSnapshot[permKey(role.id, mod.id)] = { view:true, create:true, edit:true, delete:true };
          });
        });
        setDirty(false);
        // Reset visual dirty markers
        document.querySelectorAll('.mobperm-check.dirty').forEach(el => el.classList.remove('dirty'));
        showInfo('✓ ' + (result.count || rows.length) + ' permission rules tersimpan ke Sheets! Tim mobile perlu logout-login untuk apply update.', 'success');
      } else {
        const errMsg = (result && result.error) || 'Server tidak konfirmasi sukses';
        showInfo('✗ Save gagal: ' + errMsg, 'error');
        if(btn) btn.disabled = false;
      }
    } catch(e){
      console.error('[MobPerm] save error:', e);
      showInfo('✗ Save error: ' + e.message, 'error');
      if(btn) btn.disabled = false;
    }
  }

  // ============================================================
  // RESET DEFAULT
  // ============================================================
  function resetDefault(){
    if(!confirm('Reset semua permission ke default?\n\nPerubahan belum tersimpan akan hilang.')) return;
    permissions = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
    renderTable();
    // Cek dirty: bandingkan dengan original
    const anyDirty = Object.keys(permissions).some(k => {
      const p = permissions[k];
      const o = originalSnapshot[k] || {};
      return ['view','create','edit','delete'].some(a => (p[a] || false) !== (o[a] || false));
    });
    setDirty(anyDirty);
    if(!anyDirty) showInfo('Default sama dengan yang sudah tersimpan.', '');
  }

  // ============================================================
  // ROLE-BASED ACCESS
  // ============================================================
  function isBM(){
    try {
      const u = window.currentUser;
      if(!u) return false;
      const role = String(u.role || '').toLowerCase();
      return role === 'bm' || role === 'owner' || role === 'admin';
    } catch(e){ return false; }
  }

  function updateTabAccess(){
    const tab = document.getElementById('tab-mobperm');
    if(tab) tab.style.display = isBM() ? '' : 'none';
  }

  // ============================================================
  // HOOKS
  // ============================================================
  // Hook ke switchDiv supaya saat user buka tab ini, otomatis load
  const origSwitchDiv = window.switchDiv;
  if(typeof origSwitchDiv === 'function'){
    window.switchDiv = function(div, el){
      origSwitchDiv.apply(this, arguments);
      if(div === 'mobperm'){
        // Load data saat tab dibuka
        if(Object.keys(permissions).length === 0){
          loadPermissions();
        }
      }
    };
  }

  // Hook ke selectProyek/login supaya saat BM login, tab muncul
  const origSelectProyek = window.selectProyek;
  if(typeof origSelectProyek === 'function'){
    window.selectProyek = function(){
      const result = origSelectProyek.apply(this, arguments);
      setTimeout(updateTabAccess, 100);
      return result;
    };
  }

  // ============================================================
  // EXPOSE API
  // ============================================================
  window.MobPerm = {
    onChange: function(role, module, action, value){
      updatePerm(role, module, action, value);
    },
    saveAll: saveAll,
    resetDefault: resetDefault,
    refresh: function(){
      if(dirty){
        if(!confirm('Ada perubahan belum disimpan. Refresh akan kehilangan perubahan. Lanjut?')) return;
      }
      loadPermissions();
    }
  };

  // ============================================================
  // HELPER
  // ============================================================
  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ============================================================
  // INIT
  // ============================================================
  function init(){
    injectStyle();
    injectTab();
    injectPane();
    updateTabAccess();
    // Watch for login/logout via interval (lightweight)
    setInterval(updateTabAccess, 2000);
    console.log('[patch-mobile-permissions] ✓ Loaded — Step 3 Permission Panel ready');
  }

  // Wait for DOM ready
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
