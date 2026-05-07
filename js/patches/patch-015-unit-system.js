/**
 * BM4 PATCH 015 — UNIT SYSTEM (Desktop) — Daftar Unit
 *
 * Tab baru "🏘️ Unit System" di sidebar Desktop, sejajar dengan Estate / Sales / Konstruksi.
 *
 * Fitur Sesi 2 ini (Daftar Unit):
 *   - List/table semua unit di proyek aktif
 *   - Filter: blok, tipe, tahap, status aktif, search
 *   - Add unit manual (modal form)
 *   - Edit unit (modal form)
 *   - Delete unit (cascade ke 4 sheet divisi)
 *   - Quick view: total unit, breakdown per tipe
 *
 * Endpoint dipakai:
 *   - getUnit (proyekId, filter)
 *   - saveUnit (create/update)
 *   - deleteUnit (cascade)
 *   - getUnitStats (untuk angka header)
 *
 * Permission check:
 *   - Tab muncul kalau role punya permission unit_system.view
 *   - Button "Tambah Unit" muncul kalau punya unit_system.create
 *   - Tombol Edit muncul kalau punya unit_system.edit
 *   - Tombol Delete muncul kalau punya unit_system.delete
 *
 * Idempotent — aman di-load berkali-kali.
 *
 * Dependency:
 *   - BM4Api (11-api-layer.js)
 *   - localStorage 'bm4_app_state' (untuk current proyekId)
 *   - window.currentUser (dari auth)
 *   - window.__mobilePermissionsCache (untuk permission check)
 */

(function(global){
  'use strict';

  if(global._patch015UnitSystemLoaded) return;
  global._patch015UnitSystemLoaded = true;

  // ============================================================
  // CONST
  // ============================================================
  const TIPE_OPTIONS = [
    { value: 'rumah',     label: 'Rumah',     icon: '🏠' },
    { value: 'kavling',   label: 'Kavling',   icon: '📐' },
    { value: 'ruko',      label: 'Ruko',      icon: '🏪' },
    { value: 'apartemen', label: 'Apartemen', icon: '🏢' }
  ];

  // ============================================================
  // STATE
  // ============================================================
  let _proyekId = null;
  let _unitList = [];
  let _blokList = [];
  let _stats = null;

  let _filterBlok = '';
  let _filterTipe = '';
  let _filterTahap = '';
  let _filterAktif = 'all'; // all | aktif | nonaktif
  let _searchQuery = '';

  let _editingUnit = null; // null = create mode, object = edit mode
  let _isLoading = false;

  // ============================================================
  // HELPERS
  // ============================================================
  function _getProyekId(){
    try {
      const state = JSON.parse(localStorage.getItem('bm4_app_state') || '{}');
      return state.currentProyekId || state.proyekId || null;
    } catch(e){ return null; }
  }

  function _getCurrentUser(){
    return global.currentUser || {};
  }

  function _hasPermission(action){
    // action: view | create | edit | delete
    const u = _getCurrentUser();
    if(!u || !u.role) return false;
    if(['bm','owner','admin'].indexOf(String(u.role).toLowerCase()) >= 0) return true;

    const mp = global.__mobilePermissionsCache;
    if(!Array.isArray(mp)) return false;
    const row = mp.find(p =>
      String(p.role||'').toLowerCase() === String(u.role).toLowerCase() &&
      String(p.module||'').toLowerCase() === 'unit_system'
    );
    return row ? !!row[action] : false;
  }

  function _toast(msg, type){
    type = type || 'info';
    if(global.toast){ global.toast(msg, type); return; }
    if(global.showToast){ global.showToast(msg, type); return; }
    console.log('[' + type.toUpperCase() + ']', msg);
    if(type === 'error') alert('❌ ' + msg);
  }

  function _formatNum(n){
    if(n === null || n === undefined || n === '') return '—';
    const num = Number(n);
    if(isNaN(num)) return '—';
    return num.toLocaleString('id-ID');
  }

  function _escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  function _tipeIcon(tipe){
    const t = TIPE_OPTIONS.find(o => o.value === tipe);
    return t ? t.icon : '📦';
  }

  // ============================================================
  // INJECT TAB & PANE
  // ============================================================
  function injectTabIfNeeded(){
    if(document.getElementById('tab-unit')) return;

    const navContainer = document.querySelector('.divisi-nav');
    if(!navContainer) return;

    const btn = document.createElement('button');
    btn.className = 'divisi-tab';
    btn.dataset.div = 'unit';
    btn.id = 'tab-unit';
    btn.style.display = 'none';
    btn.innerHTML = '🏘️ Unit System';
    btn.onclick = function(){
      if(typeof global.switchDiv === 'function'){
        global.switchDiv('unit', this);
      }
    };

    // Sisipkan setelah tab-estate kalau ada, kalau tidak setelah konstruksi
    const tabEstate = document.getElementById('tab-estate');
    const tabKons = navContainer.querySelector('[data-div="konstruksi"]');
    const refNode = tabEstate || tabKons;
    if(refNode && refNode.nextSibling){
      navContainer.insertBefore(btn, refNode.nextSibling);
    } else {
      navContainer.appendChild(btn);
    }
  }

  function injectPaneIfNeeded(){
    if(document.getElementById('pane-unit')) return;

    const contentArea = document.querySelector('.content-area');
    if(!contentArea) return;

    const pane = document.createElement('div');
    pane.className = 'divisi-pane';
    pane.id = 'pane-unit';
    pane.innerHTML = renderPaneHtml();
    contentArea.appendChild(pane);

    bindPaneEvents();
  }

  function renderPaneHtml(){
    return `
      <div class="unit-wrap">
        <div class="unit-header">
          <div class="unit-header-left">
            <div class="unit-header-title">🏘️ Unit System</div>
            <div class="unit-header-sub" id="unit-header-sub">Memuat daftar unit…</div>
          </div>
          <div class="unit-header-right">
            <button class="unit-btn-primary" id="unit-btn-add" style="display:none;">
              <span>+</span> Tambah Unit
            </button>
            <button class="unit-btn-secondary" id="unit-btn-refresh" title="Refresh data">
              ↻
            </button>
          </div>
        </div>

        <div class="unit-stats-bar" id="unit-stats-bar">
          <div class="unit-stat-card">
            <div class="unit-stat-label">Total Unit</div>
            <div class="unit-stat-value" id="unit-stat-total">—</div>
          </div>
          <div class="unit-stat-card">
            <div class="unit-stat-label">🏠 Rumah</div>
            <div class="unit-stat-value" id="unit-stat-rumah">—</div>
          </div>
          <div class="unit-stat-card">
            <div class="unit-stat-label">📐 Kavling</div>
            <div class="unit-stat-value" id="unit-stat-kavling">—</div>
          </div>
          <div class="unit-stat-card">
            <div class="unit-stat-label">🏪 Ruko</div>
            <div class="unit-stat-value" id="unit-stat-ruko">—</div>
          </div>
          <div class="unit-stat-card">
            <div class="unit-stat-label">🏢 Apartemen</div>
            <div class="unit-stat-value" id="unit-stat-apartemen">—</div>
          </div>
        </div>

        <div class="unit-filter-bar">
          <input type="text" class="unit-filter-search" id="unit-filter-search" placeholder="🔍 Cari nomor / blok…" />
          <select class="unit-filter-select" id="unit-filter-blok">
            <option value="">Semua Blok</option>
          </select>
          <select class="unit-filter-select" id="unit-filter-tipe">
            <option value="">Semua Tipe</option>
            ${TIPE_OPTIONS.map(t => `<option value="${t.value}">${t.icon} ${t.label}</option>`).join('')}
          </select>
          <select class="unit-filter-select" id="unit-filter-tahap">
            <option value="">Semua Tahap</option>
          </select>
          <select class="unit-filter-select" id="unit-filter-aktif">
            <option value="all">Semua Status</option>
            <option value="aktif">Aktif</option>
            <option value="nonaktif">Non-aktif</option>
          </select>
        </div>

        <div class="unit-table-wrap">
          <table class="unit-table">
            <thead>
              <tr>
                <th style="width:50px;">#</th>
                <th>Blok</th>
                <th>Nomor</th>
                <th>Tipe</th>
                <th>Subtipe</th>
                <th style="text-align:right;">Luas Tanah</th>
                <th style="text-align:right;">Luas Bangunan</th>
                <th>Tahap</th>
                <th style="text-align:center;">Status</th>
                <th style="width:120px; text-align:center;">Aksi</th>
              </tr>
            </thead>
            <tbody id="unit-table-body">
              <tr><td colspan="10" class="unit-empty">Memuat…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- MODAL FORM -->
      <div class="unit-modal-backdrop" id="unit-modal-backdrop" style="display:none;">
        <div class="unit-modal">
          <div class="unit-modal-head">
            <div class="unit-modal-title" id="unit-modal-title">Tambah Unit</div>
            <button class="unit-modal-close" id="unit-modal-close">×</button>
          </div>
          <div class="unit-modal-body">
            <div class="unit-form-row">
              <div class="unit-form-field">
                <label>Nama Blok <span class="req">*</span></label>
                <input type="text" id="unit-form-blokNama" placeholder="A, B, C, dst" maxlength="50" />
              </div>
              <div class="unit-form-field">
                <label>Nomor Unit <span class="req">*</span></label>
                <input type="text" id="unit-form-nomor" placeholder="1, 2, 01, A-01, dst" maxlength="20" />
              </div>
            </div>

            <div class="unit-form-row">
              <div class="unit-form-field">
                <label>Tipe <span class="req">*</span></label>
                <select id="unit-form-tipe">
                  ${TIPE_OPTIONS.map(t => `<option value="${t.value}">${t.icon} ${t.label}</option>`).join('')}
                </select>
              </div>
              <div class="unit-form-field">
                <label>Subtipe</label>
                <input type="text" id="unit-form-subtipe" placeholder="36/72, 45/90, dst" maxlength="50" />
              </div>
            </div>

            <div class="unit-form-row">
              <div class="unit-form-field">
                <label>Luas Tanah (m²)</label>
                <input type="number" id="unit-form-luasTanah" min="0" step="0.01" />
              </div>
              <div class="unit-form-field">
                <label>Luas Bangunan (m²)</label>
                <input type="number" id="unit-form-luasBangunan" min="0" step="0.01" />
              </div>
            </div>

            <div class="unit-form-row">
              <div class="unit-form-field">
                <label>Tahap</label>
                <input type="text" id="unit-form-tahap" placeholder="Tahap 1, 2, dst" maxlength="50" />
              </div>
              <div class="unit-form-field">
                <label>Status</label>
                <select id="unit-form-aktif">
                  <option value="true">Aktif</option>
                  <option value="false">Non-aktif</option>
                </select>
              </div>
            </div>

            <div class="unit-form-field">
              <label>Catatan</label>
              <textarea id="unit-form-catatan" rows="2" maxlength="500" placeholder="Catatan opsional…"></textarea>
            </div>

            <div class="unit-form-info" id="unit-form-info" style="display:none;"></div>
          </div>
          <div class="unit-modal-foot">
            <button class="unit-btn-secondary" id="unit-form-cancel">Batal</button>
            <button class="unit-btn-primary" id="unit-form-save">💾 Simpan</button>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================
  // EVENT BINDING
  // ============================================================
  function bindPaneEvents(){
    const $ = id => document.getElementById(id);

    $('unit-btn-add') && ($('unit-btn-add').onclick = () => openForm(null));
    $('unit-btn-refresh') && ($('unit-btn-refresh').onclick = () => loadData(true));
    $('unit-modal-close') && ($('unit-modal-close').onclick = closeForm);
    $('unit-form-cancel') && ($('unit-form-cancel').onclick = closeForm);
    $('unit-form-save') && ($('unit-form-save').onclick = saveForm);

    $('unit-modal-backdrop') && ($('unit-modal-backdrop').onclick = (e) => {
      if(e.target.id === 'unit-modal-backdrop') closeForm();
    });

    $('unit-filter-search') && ($('unit-filter-search').oninput = debounce(() => {
      _searchQuery = ($('unit-filter-search').value || '').trim();
      renderTable();
    }, 250));

    $('unit-filter-blok') && ($('unit-filter-blok').onchange = () => {
      _filterBlok = $('unit-filter-blok').value;
      renderTable();
    });
    $('unit-filter-tipe') && ($('unit-filter-tipe').onchange = () => {
      _filterTipe = $('unit-filter-tipe').value;
      renderTable();
    });
    $('unit-filter-tahap') && ($('unit-filter-tahap').onchange = () => {
      _filterTahap = $('unit-filter-tahap').value;
      renderTable();
    });
    $('unit-filter-aktif') && ($('unit-filter-aktif').onchange = () => {
      _filterAktif = $('unit-filter-aktif').value;
      renderTable();
    });
  }

  function debounce(fn, ms){
    let t;
    return function(){
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  // ============================================================
  // DATA LOADING
  // ============================================================
  async function loadData(forceRefresh){
    if(_isLoading) return;
    _isLoading = true;

    _proyekId = _getProyekId();
    if(!_proyekId){
      const sub = document.getElementById('unit-header-sub');
      if(sub) sub.textContent = '⚠️ Pilih proyek dulu di Dashboard.';
      const tbody = document.getElementById('unit-table-body');
      if(tbody) tbody.innerHTML = '<tr><td colspan="10" class="unit-empty">Pilih proyek dulu untuk melihat unit.</td></tr>';
      _isLoading = false;
      return;
    }

    const sub = document.getElementById('unit-header-sub');
    if(sub) sub.textContent = 'Memuat daftar unit…';

    try {
      if(!global.BM4Api){
        throw new Error('BM4Api belum siap. Pastikan layer API ter-load.');
      }

      const [unitRes, blokRes, statsRes] = await Promise.all([
        global.BM4Api.get('getUnit', { proyekId: _proyekId }),
        global.BM4Api.get('getEstateBlok', { proyekId: _proyekId, aktifOnly: true }).catch(() => ({ data: [] })),
        global.BM4Api.get('getUnitStats', { proyekId: _proyekId }).catch(() => null)
      ]);

      _unitList = (unitRes && unitRes.data) || [];
      _blokList = (blokRes && blokRes.data) || [];
      _stats = statsRes && statsRes.success ? statsRes : null;

      populateFilters();
      renderStats();
      renderTable();
      updateHeaderSub();
    } catch(e){
      console.error('[patch-015] loadData err:', e);
      _toast('Gagal memuat unit: ' + (e.message || e), 'error');
      const tbody = document.getElementById('unit-table-body');
      if(tbody) tbody.innerHTML = `<tr><td colspan="10" class="unit-empty">❌ Gagal memuat: ${_escapeHtml(e.message || String(e))}</td></tr>`;
    } finally {
      _isLoading = false;
    }
  }

  function updateHeaderSub(){
    const sub = document.getElementById('unit-header-sub');
    if(!sub) return;
    const proyekLbl = (_proyekId || '—').toUpperCase();
    sub.textContent = `${proyekLbl} · ${_unitList.length} unit terdaftar`;
  }

  function populateFilters(){
    // Blok options dari unit list (unik)
    const blokSet = new Set();
    _unitList.forEach(u => { if(u.blokNama) blokSet.add(u.blokNama); });
    const blokSel = document.getElementById('unit-filter-blok');
    if(blokSel){
      const cur = blokSel.value;
      blokSel.innerHTML = '<option value="">Semua Blok</option>' +
        Array.from(blokSet).sort().map(b => `<option value="${_escapeHtml(b)}">${_escapeHtml(b)}</option>`).join('');
      blokSel.value = cur;
    }

    // Tahap options dari unit list (unik)
    const tahapSet = new Set();
    _unitList.forEach(u => { if(u.tahap) tahapSet.add(u.tahap); });
    const tahapSel = document.getElementById('unit-filter-tahap');
    if(tahapSel){
      const cur = tahapSel.value;
      tahapSel.innerHTML = '<option value="">Semua Tahap</option>' +
        Array.from(tahapSet).sort().map(t => `<option value="${_escapeHtml(t)}">${_escapeHtml(t)}</option>`).join('');
      tahapSel.value = cur;
    }
  }

  function renderStats(){
    const $ = id => document.getElementById(id);
    if(_stats){
      $('unit-stat-total') && ($('unit-stat-total').textContent = _formatNum(_stats.total));
      $('unit-stat-rumah') && ($('unit-stat-rumah').textContent = _formatNum(_stats.perTipe.rumah));
      $('unit-stat-kavling') && ($('unit-stat-kavling').textContent = _formatNum(_stats.perTipe.kavling));
      $('unit-stat-ruko') && ($('unit-stat-ruko').textContent = _formatNum(_stats.perTipe.ruko));
      $('unit-stat-apartemen') && ($('unit-stat-apartemen').textContent = _formatNum(_stats.perTipe.apartemen));
    } else {
      // Fallback: hitung dari _unitList
      const t = { rumah:0, kavling:0, ruko:0, apartemen:0 };
      _unitList.forEach(u => { if(t[u.tipe] !== undefined) t[u.tipe]++; });
      $('unit-stat-total') && ($('unit-stat-total').textContent = _formatNum(_unitList.length));
      $('unit-stat-rumah') && ($('unit-stat-rumah').textContent = _formatNum(t.rumah));
      $('unit-stat-kavling') && ($('unit-stat-kavling').textContent = _formatNum(t.kavling));
      $('unit-stat-ruko') && ($('unit-stat-ruko').textContent = _formatNum(t.ruko));
      $('unit-stat-apartemen') && ($('unit-stat-apartemen').textContent = _formatNum(t.apartemen));
    }
  }

  function renderTable(){
    const tbody = document.getElementById('unit-table-body');
    if(!tbody) return;

    let rows = _unitList.slice();

    // Filter
    if(_filterBlok) rows = rows.filter(u => u.blokNama === _filterBlok);
    if(_filterTipe) rows = rows.filter(u => u.tipe === _filterTipe);
    if(_filterTahap) rows = rows.filter(u => u.tahap === _filterTahap);
    if(_filterAktif === 'aktif') rows = rows.filter(u => u.aktif);
    else if(_filterAktif === 'nonaktif') rows = rows.filter(u => !u.aktif);

    if(_searchQuery){
      const q = _searchQuery.toLowerCase();
      rows = rows.filter(u =>
        String(u.nomor || '').toLowerCase().indexOf(q) >= 0 ||
        String(u.blokNama || '').toLowerCase().indexOf(q) >= 0 ||
        (u.blokNama + '-' + u.nomor).toLowerCase().indexOf(q) >= 0
      );
    }

    if(!rows.length){
      const empty = _unitList.length === 0
        ? 'Belum ada unit terdaftar di proyek ini. Klik <b>+ Tambah Unit</b> untuk memulai.'
        : 'Tidak ada unit yang cocok dengan filter.';
      tbody.innerHTML = `<tr><td colspan="10" class="unit-empty">${empty}</td></tr>`;
      return;
    }

    const canEdit = _hasPermission('edit');
    const canDelete = _hasPermission('delete');

    tbody.innerHTML = rows.map((u, i) => {
      const tipeOpt = TIPE_OPTIONS.find(t => t.value === u.tipe);
      const tipeLbl = tipeOpt ? `${tipeOpt.icon} ${tipeOpt.label}` : u.tipe;
      const statusBadge = u.aktif
        ? '<span class="unit-badge unit-badge-active">Aktif</span>'
        : '<span class="unit-badge unit-badge-inactive">Non-aktif</span>';
      const actions = [];
      if(canEdit){
        actions.push(`<button class="unit-action-btn unit-action-edit" data-id="${_escapeHtml(u.id)}" title="Edit">✏️</button>`);
      }
      if(canDelete){
        actions.push(`<button class="unit-action-btn unit-action-delete" data-id="${_escapeHtml(u.id)}" title="Hapus">🗑️</button>`);
      }
      return `
        <tr>
          <td>${i + 1}</td>
          <td><b>${_escapeHtml(u.blokNama)}</b></td>
          <td>${_escapeHtml(u.nomor)}</td>
          <td>${tipeLbl}</td>
          <td>${_escapeHtml(u.subtipe || '—')}</td>
          <td style="text-align:right;">${u.luasTanah ? _formatNum(u.luasTanah) + ' m²' : '—'}</td>
          <td style="text-align:right;">${u.luasBangunan ? _formatNum(u.luasBangunan) + ' m²' : '—'}</td>
          <td>${_escapeHtml(u.tahap || '—')}</td>
          <td style="text-align:center;">${statusBadge}</td>
          <td style="text-align:center;">${actions.join(' ')}</td>
        </tr>
      `;
    }).join('');

    // Bind action buttons
    tbody.querySelectorAll('.unit-action-edit').forEach(btn => {
      btn.onclick = () => {
        const u = _unitList.find(x => String(x.id) === String(btn.dataset.id));
        if(u) openForm(u);
      };
    });
    tbody.querySelectorAll('.unit-action-delete').forEach(btn => {
      btn.onclick = () => deleteUnit(btn.dataset.id);
    });
  }

  // ============================================================
  // FORM (ADD/EDIT)
  // ============================================================
  function openForm(unit){
    _editingUnit = unit ? Object.assign({}, unit) : null;

    const $ = id => document.getElementById(id);
    $('unit-modal-title').textContent = unit ? '✏️ Edit Unit' : '+ Tambah Unit';
    $('unit-form-blokNama').value = unit ? (unit.blokNama || '') : '';
    $('unit-form-nomor').value = unit ? (unit.nomor || '') : '';
    $('unit-form-tipe').value = unit ? (unit.tipe || 'rumah') : 'rumah';
    $('unit-form-subtipe').value = unit ? (unit.subtipe || '') : '';
    $('unit-form-luasTanah').value = unit && unit.luasTanah ? unit.luasTanah : '';
    $('unit-form-luasBangunan').value = unit && unit.luasBangunan ? unit.luasBangunan : '';
    $('unit-form-tahap').value = unit ? (unit.tahap || '') : '';
    $('unit-form-aktif').value = unit ? (unit.aktif ? 'true' : 'false') : 'true';
    $('unit-form-catatan').value = unit ? (unit.catatan || '') : '';
    $('unit-form-info').style.display = 'none';
    $('unit-form-info').textContent = '';

    $('unit-modal-backdrop').style.display = 'flex';
    setTimeout(() => $('unit-form-blokNama').focus(), 50);
  }

  function closeForm(){
    const bd = document.getElementById('unit-modal-backdrop');
    if(bd) bd.style.display = 'none';
    _editingUnit = null;
  }

  async function saveForm(){
    const $ = id => document.getElementById(id);
    const info = $('unit-form-info');
    const showError = (msg) => {
      info.style.display = 'block';
      info.className = 'unit-form-info unit-form-info-error';
      info.textContent = '❌ ' + msg;
    };

    const blokNama = ($('unit-form-blokNama').value || '').trim();
    const nomor = ($('unit-form-nomor').value || '').trim();
    if(!blokNama){ showError('Nama blok wajib diisi.'); return; }
    if(!nomor){ showError('Nomor unit wajib diisi.'); return; }

    const payload = {
      proyekId: _proyekId,
      blokNama: blokNama,
      nomor: nomor,
      tipe: $('unit-form-tipe').value,
      subtipe: ($('unit-form-subtipe').value || '').trim(),
      luasTanah: $('unit-form-luasTanah').value || '',
      luasBangunan: $('unit-form-luasBangunan').value || '',
      tahap: ($('unit-form-tahap').value || '').trim(),
      aktif: $('unit-form-aktif').value === 'true',
      catatan: ($('unit-form-catatan').value || '').trim()
    };

    if(_editingUnit){
      payload.id = _editingUnit.id;
      // Preserve blokId, koordinat, siteplanBlokVersion existing
      if(_editingUnit.blokId !== undefined) payload.blokId = _editingUnit.blokId;
      if(_editingUnit.siteplanBlokVersion) payload.siteplanBlokVersion = _editingUnit.siteplanBlokVersion;
      if(_editingUnit.pixelXBlok !== '') payload.pixelXBlok = _editingUnit.pixelXBlok;
      if(_editingUnit.pixelYBlok !== '') payload.pixelYBlok = _editingUnit.pixelYBlok;
      if(_editingUnit.pixelWBlok !== '') payload.pixelWBlok = _editingUnit.pixelWBlok;
      if(_editingUnit.pixelHBlok !== '') payload.pixelHBlok = _editingUnit.pixelHBlok;
    }

    info.style.display = 'block';
    info.className = 'unit-form-info';
    info.textContent = '⏳ Menyimpan…';
    $('unit-form-save').disabled = true;

    try {
      const res = await global.BM4Api.post('saveUnit', payload);
      if(!res || !res.success){
        throw new Error((res && res.message) || (res && res.error) || 'Gagal simpan');
      }
      _toast(_editingUnit ? '✅ Unit diperbarui' : '✅ Unit ditambahkan', 'success');
      closeForm();
      await loadData(true);
    } catch(e){
      console.error('[patch-015] saveForm err:', e);
      showError(e.message || String(e));
    } finally {
      $('unit-form-save').disabled = false;
    }
  }

  async function deleteUnit(id){
    const u = _unitList.find(x => String(x.id) === String(id));
    if(!u) return;

    const confirmMsg = `Hapus unit ${u.blokNama}-${u.nomor}?\n\nJika unit ini punya data Sales, Konstruksi, Estate, atau Legal, semua data divisi akan ikut terhapus (cascade).`;
    if(!confirm(confirmMsg)) return;

    try {
      const res = await global.BM4Api.post('deleteUnit', { id: id });
      if(!res || !res.success){
        throw new Error((res && res.message) || 'Gagal hapus');
      }
      const cascade = res.cascade || {};
      const cascadeMsg = (cascade.sales || cascade.konstruksi || cascade.estate || cascade.legal)
        ? ` (cascade: S${cascade.sales||0} K${cascade.konstruksi||0} E${cascade.estate||0} L${cascade.legal||0})`
        : '';
      _toast(`✅ Unit ${u.blokNama}-${u.nomor} dihapus${cascadeMsg}`, 'success');
      await loadData(true);
    } catch(e){
      console.error('[patch-015] deleteUnit err:', e);
      _toast('Gagal hapus: ' + (e.message || e), 'error');
    }
  }

  // ============================================================
  // PERMISSION-AWARE TAB VISIBILITY
  // ============================================================
  function refreshTabVisibility(){
    const tab = document.getElementById('tab-unit');
    if(!tab) return false;

    // Tunggu currentUser siap dulu
    const u = _getCurrentUser();
    if(!u || !u.role){
      // currentUser belum ready, sembunyikan dulu tab-nya
      tab.style.display = 'none';
      return false;
    }

    const canView = _hasPermission('view');
    tab.style.display = canView ? '' : 'none';

    const btnAdd = document.getElementById('unit-btn-add');
    if(btnAdd) btnAdd.style.display = _hasPermission('create') ? '' : 'none';

    return canView;
  }

  // ============================================================
  // HOOK switchDiv UNTUK AUTO-LOAD
  // ============================================================
  function hookSwitchDiv(){
    const orig = global.switchDiv;
    if(!orig || global._patch015_switchDivHooked) return;
    global._patch015_switchDivHooked = true;

    global.switchDiv = function(div, btn){
      const result = orig.apply(this, arguments);
      if(div === 'unit'){
        const newProyekId = _getProyekId();
        if(newProyekId !== _proyekId || _unitList.length === 0){
          loadData();
        } else {
          // Cuma render ulang permission-related UI
          refreshTabVisibility();
        }
      }
      return result;
    };
  }

  // ============================================================
  // INIT
  // ============================================================
  function init(){
    injectTabIfNeeded();
    injectPaneIfNeeded();
    refreshTabVisibility();
    hookSwitchDiv();
    monkeyPatchVisibilityToggler(); // [v3] FIX UTAMA

    // [v2] Retry mechanism — ulang refreshTabVisibility selama 30 detik
    let retryCount = 0;
    const maxRetries = 30;
    const retryInterval = setInterval(() => {
      retryCount++;
      const visible = refreshTabVisibility();
      if(visible || retryCount >= maxRetries){
        clearInterval(retryInterval);
        if(visible){
          console.log('[patch-015] Tab Unit System aktif setelah retry ke-' + retryCount);
        }
      }
    }, 1000);

    // [v2] Hook ke event login (kalau ada)
    document.addEventListener('bm4:login', refreshTabVisibility);
    document.addEventListener('bm4:auth-ready', refreshTabVisibility);

    // [v2] MutationObserver
    try {
      const navContainer = document.querySelector('.divisi-nav');
      if(navContainer && global.MutationObserver){
        const observer = new MutationObserver(() => {
          if(!document.getElementById('tab-unit')){
            injectTabIfNeeded();
            refreshTabVisibility();
          }
        });
        observer.observe(navContainer, { childList: true });
      }
    } catch(e){ console.warn('[patch-015] MutationObserver setup err:', e); }
  }

  // ============================================================
  // [v3 FIX] MONKEY-PATCH applyTabsByAkses — override visibility logic
  // ============================================================
  function monkeyPatchVisibilityToggler(){
    // Fungsi `applyTabsByAkses` di js/100-accounts-auth.js dipanggil setelah login
    // untuk show/hide tab berdasarkan currentUser.akses.
    // Tab "unit" tidak ada di akses default user, jadi dia akan di-set display:none.
    // Solusi: kita intercept fungsi itu dan force tab unit visible jika user punya permission.
    if(global._patch015_visibilityHooked) return;
    global._patch015_visibilityHooked = true;

    // Cara 1: hook fungsi global applyTabsByAkses kalau ada
    if(typeof global.applyTabsByAkses === 'function'){
      const orig = global.applyTabsByAkses;
      global.applyTabsByAkses = function(){
        const result = orig.apply(this, arguments);
        // Setelah fungsi original jalan, force show tab Unit
        forceShowUnitTabIfPermitted();
        return result;
      };
      console.log('[patch-015] Hooked applyTabsByAkses');
    }

    // Cara 2 (defensive): pasang interval pendek 0.5s yang patroli visibility
    // selama 60 detik pertama. Kalau ada kode lain set display:none ke tab unit,
    // langsung kita kembalikan.
    let patrolCount = 0;
    const patrolMax = 120; // 120 x 0.5s = 60 detik
    const patrolInterval = setInterval(() => {
      patrolCount++;
      forceShowUnitTabIfPermitted();
      if(patrolCount >= patrolMax){
        clearInterval(patrolInterval);
      }
    }, 500);
  }

  function forceShowUnitTabIfPermitted(){
    const tab = document.getElementById('tab-unit');
    if(!tab) return;
    const u = _getCurrentUser();
    if(!u || !u.role) return; // user belum login, biarkan tersembunyi

    const canView = _hasPermission('view');
    if(canView){
      // Force show with !important supaya tidak ditimpa
      tab.style.cssText = 'display: inline-flex !important;';
    } else {
      tab.style.cssText = 'display: none !important;';
    }

    const btnAdd = document.getElementById('unit-btn-add');
    if(btnAdd){
      const canCreate = _hasPermission('create');
      btnAdd.style.cssText = canCreate
        ? 'display: inline-flex !important;'
        : 'display: none !important;';
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose untuk debugging
  global.BM4Patch015 = {
    reload: () => loadData(true),
    state: () => ({ proyekId: _proyekId, unitCount: _unitList.length, blokCount: _blokList.length, stats: _stats })
  };

})(window);
