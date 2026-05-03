/**
 * BM4 PATCH 012 — ESTATE LAPORAN (Desktop)
 *
 * Sub-1 Polish — Replace placeholder #estate-section-laporan dengan UI lengkap:
 *   - Filter: period (today/week/month/all), status, kategori, search
 *   - List laporan card (group by tanggal)
 *   - Detail modal (view + edit + delete)
 *   - Form tambah laporan baru (toolbar atas)
 *   - Pakai endpoint existing dari Code.gs v5:
 *       getEstateLaporan, saveEstateLaporan, deleteEstateLaporan, getEstateKategori
 *
 * Pattern: pola UI/UX adopted dari mobile-estate.html (renderLaporanCard, dst)
 *          tapi disesuaikan untuk desktop (lebar, search bar, modal lebih kaya).
 *
 * Auto-inject ke section #estate-section-laporan begitu DOM ready.
 *
 * Dependency:
 *   - BM4Api (11-api-layer.js)
 *   - 181-estate-module.js (untuk pattern proyekId resolution)
 *   - sessionStorage 'bm4_secure_user' (untuk current user)
 *   - localStorage 'bm4_app_state' (untuk current proyekId)
 *
 * Idempotent — aman di-load berkali-kali.
 */

(function(global){
  'use strict';

  if(global._patch012EstateLaporanLoaded) return;
  global._patch012EstateLaporanLoaded = true;

  // ============================================================
  // CONST & STATE
  // ============================================================
  const STATUS_LABELS = ['Selesai', 'Proses', 'Tertunda'];
  const STATUS_KEYS = ['selesai', 'proses', 'tertunda'];
  const STATUS_ICONS = ['✅', '🔄', '⏸'];
  const STATUS_BG = ['#DCFCE7', '#FEF3C7', '#F1F5F9'];
  const STATUS_FG = ['#166534', '#92400E', '#475569'];

  const KATEGORI_FALLBACK = [
    { id:'pertamanan', label:'Pertamanan',     icon:'🌿' },
    { id:'kebersihan', label:'Kebersihan',     icon:'🧹' },
    { id:'drainase',   label:'Drainase',       icon:'💧' },
    { id:'jalan',      label:'Jalan & Fasum',  icon:'🛣️' },
    { id:'utilitas',   label:'Listrik & Air',  icon:'💡' },
    { id:'keamanan',   label:'Keamanan',       icon:'🛡️' },
    { id:'perbaikan',  label:'Perbaikan',      icon:'🔧' },
    { id:'lainnya',    label:'Lainnya',        icon:'📋' }
  ];

  let _kategoriList = KATEGORI_FALLBACK.slice();
  let _laporanList = [];
  let _proyekId = null;
  let _isLoading = false;
  let _currentDetailId = null;

  // Filter state
  let _filterPeriod = 'all';        // today | week | month | all
  let _filterStatus = 'all';        // all | 0 | 1 | 2 (index ke STATUS_KEYS)
  let _filterKategori = 'all';      // all | <kategori-id>
  let _filterSearch = '';           // freetext

  // ============================================================
  // PROYEK ID HELPER (sama dengan patch-010/011 rc18.1)
  // ============================================================
  function _getProyekId(){
    try {
      if(typeof currentProyek !== 'undefined' && currentProyek){
        return String(currentProyek);
      }
    } catch(_){}
    try {
      const raw = localStorage.getItem('bm4_app_state');
      if(raw){
        const state = JSON.parse(raw);
        if(state && state.proyek) return String(state.proyek);
      }
    } catch(_){}
    try {
      if(global.currentProyek){
        if(typeof global.currentProyek === 'string') return global.currentProyek;
        if(global.currentProyek.id) return String(global.currentProyek.id);
      }
    } catch(_){}
    return null;
  }

  // ============================================================
  // CURRENT USER HELPER (untuk role-based permission check)
  // ============================================================
  function _getCurrentUser(){
    // 1. sessionStorage 'bm4_secure_user' (Secure Mode)
    try {
      const raw = sessionStorage.getItem('bm4_secure_user');
      if(raw){
        const u = JSON.parse(raw);
        if(u && u.username) return u;
      }
    } catch(_){}
    // 2. Scope chain (let currentUser di top-level 100-accounts-auth.js)
    try {
      if(typeof currentUser !== 'undefined' && currentUser){
        return currentUser;
      }
    } catch(_){}
    return null;
  }

  function _getRole(){
    const u = _getCurrentUser();
    return String((u && u.role) || 'viewer').toLowerCase();
  }

  // Permission map (mirror Code.gs ROLE_RULES untuk modul estate)
  // Read: hampir semua role bisa
  // Write/delete: bm/owner/admin/manager/konstruksi
  function _canCreate(){
    return ['bm','owner','admin','manager','konstruksi'].indexOf(_getRole()) >= 0;
  }
  function _canEdit(){
    return _canCreate();
  }
  function _canDelete(){
    return ['bm','owner','admin','konstruksi'].indexOf(_getRole()) >= 0;
  }

  // ============================================================
  // INIT — Replace placeholder dengan UI baru
  // ============================================================
  function init(){
    const section = document.getElementById('estate-section-laporan');
    if(!section){
      console.warn('[patch-012] #estate-section-laporan tidak ditemukan');
      return;
    }
    if(section.dataset.patch012Inited === '1') return;
    section.dataset.patch012Inited = '1';

    section.innerHTML = _buildShellHtml();
    _bindToolbarEvents();

    // Listener: kalau user pindah section ke 'laporan', auto-load data
    const subnav = document.querySelector('.estate-subnav');
    if(subnav){
      subnav.addEventListener('click', _onSubnavClick);
    }

    // Auto-load kalau section laporan kebetulan udah active saat init
    if(section.classList.contains('active')){
      setTimeout(() => {
        _proyekId = _getProyekId();
        if(_proyekId) loadData();
      }, 100);
    }

    console.log('[patch-012] estate laporan UI injected');
  }

  function _onSubnavClick(e){
    const btn = e.target.closest('.estate-subtab[data-section="laporan"]');
    if(!btn) return;
    // Defer sampai DOM update
    setTimeout(() => {
      const newProyekId = _getProyekId();
      if(newProyekId !== _proyekId || _laporanList.length === 0){
        _proyekId = newProyekId;
        loadData();
      }
    }, 50);
  }

  // ============================================================
  // SHELL HTML
  // ============================================================
  function _buildShellHtml(){
    return `
      <div class="lap012-wrap">
        <!-- Toolbar atas -->
        <div class="lap012-toolbar">
          <div class="lap012-toolbar-left">
            <div class="lap012-stat" id="lap012-stat-total">0 laporan</div>
            <div class="lap012-stat lap012-stat-info" id="lap012-stat-filtered" style="display:none;"></div>
          </div>
          <div class="lap012-toolbar-mid">
            <input type="search" class="lap012-search" id="lap012-search"
              placeholder="🔍 Cari pekerjaan, lokasi, tim, atau catatan...">
          </div>
          <div class="lap012-toolbar-right">
            <button class="lap012-btn-secondary" id="lap012-btn-reload" onclick="window._patch012.loadData()">🔄 Refresh</button>
            <button class="lap012-btn-primary" id="lap012-btn-add" onclick="window._patch012.openAddModal()">➕ Tambah Laporan</button>
          </div>
        </div>

        <!-- Filter pills -->
        <div class="lap012-filters">
          <div class="lap012-filter-group">
            <span class="lap012-filter-lbl">Periode:</span>
            <div class="lap012-pill-row" data-filter-group="period">
              <button class="lap012-pill active" data-period="all" onclick="window._patch012.setPeriod('all')">Semua</button>
              <button class="lap012-pill" data-period="today" onclick="window._patch012.setPeriod('today')">Hari ini</button>
              <button class="lap012-pill" data-period="week" onclick="window._patch012.setPeriod('week')">7 hari</button>
              <button class="lap012-pill" data-period="month" onclick="window._patch012.setPeriod('month')">30 hari</button>
            </div>
          </div>
          <div class="lap012-filter-group">
            <span class="lap012-filter-lbl">Status:</span>
            <div class="lap012-pill-row" data-filter-group="status">
              <button class="lap012-pill active" data-status="all" onclick="window._patch012.setStatus('all')">Semua</button>
              <button class="lap012-pill" data-status="0" onclick="window._patch012.setStatus('0')">✅ Selesai</button>
              <button class="lap012-pill" data-status="1" onclick="window._patch012.setStatus('1')">🔄 Proses</button>
              <button class="lap012-pill" data-status="2" onclick="window._patch012.setStatus('2')">⏸ Tertunda</button>
            </div>
          </div>
          <div class="lap012-filter-group">
            <span class="lap012-filter-lbl">Kategori:</span>
            <select class="lap012-select" id="lap012-filter-kategori" onchange="window._patch012.setKategori(this.value)">
              <option value="all">Semua kategori</option>
            </select>
          </div>
        </div>

        <!-- Body: list laporan -->
        <div class="lap012-body" id="lap012-body">
          <div class="lap012-empty">
            <div class="lap012-empty-icon">📋</div>
            <div class="lap012-empty-title">Memuat data laporan…</div>
            <div class="lap012-empty-sub">Mohon tunggu sebentar.</div>
          </div>
        </div>
      </div>

      <!-- Modal Detail -->
      <div class="lap012-modal-overlay" id="lap012-modal-detail" onclick="if(event.target===this)window._patch012.closeDetail()">
        <div class="lap012-modal" role="dialog" aria-labelledby="lap012-d-title">
          <div class="lap012-modal-head">
            <div>
              <div class="lap012-modal-title" id="lap012-d-title">Detail Laporan</div>
              <div class="lap012-modal-sub" id="lap012-d-sub">—</div>
            </div>
            <button class="lap012-modal-close" onclick="window._patch012.closeDetail()" aria-label="Tutup">✕</button>
          </div>
          <div class="lap012-modal-body" id="lap012-d-body"></div>
          <div class="lap012-modal-foot" id="lap012-d-foot"></div>
        </div>
      </div>

      <!-- Modal Form (Tambah/Edit) -->
      <div class="lap012-modal-overlay" id="lap012-modal-form" onclick="if(event.target===this)window._patch012.closeForm()">
        <div class="lap012-modal" role="dialog">
          <div class="lap012-modal-head">
            <div>
              <div class="lap012-modal-title" id="lap012-f-title">Tambah Laporan Baru</div>
              <div class="lap012-modal-sub" id="lap012-f-sub">Isi data laporan harian estate</div>
            </div>
            <button class="lap012-modal-close" onclick="window._patch012.closeForm()" aria-label="Tutup">✕</button>
          </div>
          <div class="lap012-modal-body">
            <input type="hidden" id="lap012-f-id" value="">
            <div class="lap012-form-row">
              <div class="lap012-form-field">
                <label>📅 Tanggal *</label>
                <input type="date" id="lap012-f-tanggal" required>
              </div>
              <div class="lap012-form-field">
                <label>⚙️ Status *</label>
                <select id="lap012-f-status">
                  <option value="proses">🔄 Proses</option>
                  <option value="selesai">✅ Selesai</option>
                  <option value="tertunda">⏸ Tertunda</option>
                </select>
              </div>
            </div>
            <div class="lap012-form-row">
              <div class="lap012-form-field">
                <label>🏷️ Kategori</label>
                <select id="lap012-f-kategori">
                  <option value="">— pilih kategori —</option>
                </select>
              </div>
              <div class="lap012-form-field">
                <label>📍 Lokasi (blok / area)</label>
                <input type="text" id="lap012-f-lokasi" placeholder="contoh: Blok A, Taman pusat, Pos satpam" maxlength="100">
              </div>
            </div>
            <div class="lap012-form-field">
              <label>🔧 Pekerjaan / Deskripsi * <span class="lap012-form-hint">(min. 5 karakter)</span></label>
              <textarea id="lap012-f-pekerjaan" rows="3" placeholder="Misal: Pembersihan saluran air dan pembabatan rumput sekitar gate" maxlength="500"></textarea>
            </div>
            <div class="lap012-form-row">
              <div class="lap012-form-field">
                <label>👷 Tim / Petugas</label>
                <input type="text" id="lap012-f-tim" placeholder="contoh: Yana, Adi, Budi" maxlength="200">
              </div>
            </div>
            <div class="lap012-form-field">
              <label>📝 Catatan tambahan</label>
              <textarea id="lap012-f-catatan" rows="2" placeholder="opsional — info tambahan, kendala, dll" maxlength="500"></textarea>
            </div>
          </div>
          <div class="lap012-modal-foot">
            <button class="lap012-btn-secondary" onclick="window._patch012.closeForm()">Batal</button>
            <button class="lap012-btn-primary" id="lap012-f-save" onclick="window._patch012.saveForm()">💾 Simpan</button>
          </div>
        </div>
      </div>
    `;
  }

  function _bindToolbarEvents(){
    const search = document.getElementById('lap012-search');
    if(search){
      let timeout = null;
      search.addEventListener('input', function(){
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          _filterSearch = String(search.value || '').toLowerCase().trim();
          _render();
        }, 200);
      });
    }
  }

  // ============================================================
  // LOAD DATA
  // ============================================================
  async function loadData(){
    if(_isLoading) return;
    _isLoading = true;

    _proyekId = _getProyekId();
    if(!_proyekId){
      _showEmpty('🏗️', 'Pilih proyek dulu', 'Kembali ke halaman pilih proyek, lalu masuk lagi ke Daftar Laporan.');
      _isLoading = false;
      return;
    }

    if(!global.BM4Api){
      _showEmpty('⚠️', 'API tidak tersedia', 'BM4Api belum di-load. Coba refresh halaman.');
      _isLoading = false;
      return;
    }

    _showEmpty('⏳', 'Memuat data laporan…', 'Mengambil dari server.');

    try {
      // Parallel fetch laporan + kategori
      const [resLap, resKat] = await Promise.all([
        global.BM4Api.get('getEstateLaporan', { proyekId: _proyekId }),
        global.BM4Api.get('getEstateKategori').catch(() => ({ success:false }))
      ]);

      if(resLap && resLap.success && Array.isArray(resLap.data)){
        _laporanList = resLap.data;
      } else {
        _laporanList = [];
        console.warn('[patch-012] getEstateLaporan failed:', resLap);
      }

      if(resKat && resKat.success && Array.isArray(resKat.data) && resKat.data.length){
        _kategoriList = resKat.data;
      }

      _renderKategoriOptions();
      _render();
    } catch(e){
      console.error('[patch-012] load error:', e);
      _showEmpty('⚠️', 'Gagal memuat', String(e && e.message ? e.message : e));
    } finally {
      _isLoading = false;
    }
  }

  function _renderKategoriOptions(){
    // Filter dropdown
    const filterSel = document.getElementById('lap012-filter-kategori');
    if(filterSel){
      filterSel.innerHTML = '<option value="all">Semua kategori</option>' +
        _kategoriList.map(k => `<option value="${_esc(k.id)}">${_esc(k.icon || '')} ${_esc(k.label)}</option>`).join('');
      filterSel.value = _filterKategori;
    }
    // Form dropdown
    const formSel = document.getElementById('lap012-f-kategori');
    if(formSel){
      formSel.innerHTML = '<option value="">— pilih kategori —</option>' +
        _kategoriList.map(k => `<option value="${_esc(k.id)}">${_esc(k.icon || '')} ${_esc(k.label)}</option>`).join('');
    }
  }

  // ============================================================
  // FILTER & RENDER
  // ============================================================
  function _applyFilter(){
    let list = _laporanList.slice();

    // Period
    if(_filterPeriod !== 'all'){
      const today = new Date();
      today.setHours(0,0,0,0);
      const todayStr = _toIsoDate(today);
      if(_filterPeriod === 'today'){
        list = list.filter(l => String(l.tanggal).slice(0,10) === todayStr);
      } else if(_filterPeriod === 'week'){
        const ago = new Date(today);
        ago.setDate(ago.getDate() - 7);
        const agoStr = _toIsoDate(ago);
        list = list.filter(l => String(l.tanggal).slice(0,10) >= agoStr);
      } else if(_filterPeriod === 'month'){
        const ago = new Date(today);
        ago.setDate(ago.getDate() - 30);
        const agoStr = _toIsoDate(ago);
        list = list.filter(l => String(l.tanggal).slice(0,10) >= agoStr);
      }
    }

    // Status
    if(_filterStatus !== 'all'){
      const sIdx = parseInt(_filterStatus, 10);
      const sKey = STATUS_KEYS[sIdx];
      if(sKey){
        list = list.filter(l => String(l.status || '').toLowerCase() === sKey);
      }
    }

    // Kategori
    if(_filterKategori !== 'all'){
      list = list.filter(l => String(l.kategori || '') === _filterKategori);
    }

    // Search
    if(_filterSearch){
      const q = _filterSearch;
      list = list.filter(l => {
        const haystack = (
          (l.pekerjaan || '') + ' ' +
          (l.lokasi || '') + ' ' +
          (l.tim || '') + ' ' +
          (l.catatan || '') + ' ' +
          (l.kategori || '')
        ).toLowerCase();
        return haystack.indexOf(q) >= 0;
      });
    }

    return list;
  }

  function _render(){
    const filtered = _applyFilter();
    _updateStat(filtered.length);

    if(filtered.length === 0){
      if(_laporanList.length === 0){
        _showEmpty('📭', 'Belum ada laporan',
          _canCreate()
            ? 'Klik "➕ Tambah Laporan" untuk mulai input laporan harian estate.'
            : 'Belum ada laporan untuk proyek ini.');
      } else {
        _showEmpty('🔍', 'Tidak ada hasil',
          'Coba ubah filter atau hapus kata kunci pencarian.');
      }
      return;
    }

    // Group by tanggal (descending)
    const byDate = {};
    filtered.forEach(l => {
      const d = String(l.tanggal || '').slice(0,10) || 'Tanpa tanggal';
      if(!byDate[d]) byDate[d] = [];
      byDate[d].push(l);
    });
    const dateKeys = Object.keys(byDate).sort((a,b) => b.localeCompare(a));

    let html = '';
    dateKeys.forEach(d => {
      const arr = byDate[d];
      // Sort dalam grup: status proses dulu, baru selesai, baru tertunda
      arr.sort((a,b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      html += `<div class="lap012-day-header">${_formatDateHeader(d)} <span class="lap012-day-count">${arr.length}</span></div>`;
      html += '<div class="lap012-card-grid">';
      arr.forEach(l => { html += _renderCard(l); });
      html += '</div>';
    });

    const body = document.getElementById('lap012-body');
    if(body) body.innerHTML = html;
  }

  function _renderCard(l){
    const sIdx = STATUS_KEYS.indexOf(String(l.status || '').toLowerCase());
    const sLbl = STATUS_LABELS[sIdx] || '-';
    const sIc = STATUS_ICONS[sIdx] || '';
    const sClass = ['s-selesai', 's-proses', 's-tertunda'][sIdx] || 's-tertunda';

    const meta = [];
    if(l.lokasi) meta.push('📍 ' + _esc(l.lokasi));
    if(l.tim) meta.push('👷 ' + _esc(l.tim));
    if(l.kategori){
      const k = _kategoriList.find(x => x.id === l.kategori);
      if(k) meta.push((k.icon || '🏷️') + ' ' + _esc(k.label));
    }

    const pekerjaan = String(l.pekerjaan || '(tanpa deskripsi)');
    const truncated = pekerjaan.length > 120;
    const display = truncated ? pekerjaan.substring(0, 120) + '…' : pekerjaan;

    return `
      <div class="lap012-card ${sClass}" onclick="window._patch012.openDetail('${_esc(l.id)}')">
        <div class="lap012-card-head">
          <div class="lap012-card-title">${_esc(display)}</div>
          <div class="lap012-card-badge ${sClass}">${sIc} ${_esc(sLbl)}</div>
        </div>
        ${meta.length ? `<div class="lap012-card-meta">${meta.join(' · ')}</div>` : ''}
      </div>
    `;
  }

  function _updateStat(filteredCount){
    const elTotal = document.getElementById('lap012-stat-total');
    const elFilt = document.getElementById('lap012-stat-filtered');
    if(elTotal){
      const total = _laporanList.length;
      elTotal.textContent = total + ' laporan' + (_proyekId ? ' · ' + _proyekId.toUpperCase() : '');
    }
    if(elFilt){
      const isFiltered = (_filterPeriod !== 'all' || _filterStatus !== 'all' || _filterKategori !== 'all' || _filterSearch);
      if(isFiltered && filteredCount !== _laporanList.length){
        elFilt.textContent = '↓ ' + filteredCount + ' setelah filter';
        elFilt.style.display = '';
      } else {
        elFilt.style.display = 'none';
      }
    }
  }

  function _showEmpty(icon, title, sub){
    const body = document.getElementById('lap012-body');
    if(!body) return;
    body.innerHTML = `
      <div class="lap012-empty">
        <div class="lap012-empty-icon">${icon}</div>
        <div class="lap012-empty-title">${_esc(title)}</div>
        <div class="lap012-empty-sub">${_esc(sub)}</div>
      </div>
    `;
  }

  // ============================================================
  // FILTER SETTERS
  // ============================================================
  function setPeriod(p){
    _filterPeriod = p;
    _updatePillActive('period', p);
    _render();
  }
  function setStatus(s){
    _filterStatus = s;
    _updatePillActive('status', s);
    _render();
  }
  function setKategori(k){
    _filterKategori = k;
    _render();
  }

  function _updatePillActive(group, value){
    const container = document.querySelector(`[data-filter-group="${group}"]`);
    if(!container) return;
    container.querySelectorAll('.lap012-pill').forEach(b => {
      const v = b.dataset[group];
      b.classList.toggle('active', String(v) === String(value));
    });
  }

  // ============================================================
  // DETAIL MODAL
  // ============================================================
  function openDetail(id){
    const l = _laporanList.find(x => String(x.id) === String(id));
    if(!l){
      console.warn('[patch-012] laporan not found:', id);
      return;
    }
    _currentDetailId = id;

    const sIdx = STATUS_KEYS.indexOf(String(l.status || '').toLowerCase());
    const sLbl = STATUS_LABELS[sIdx] || '-';
    const sIc = STATUS_ICONS[sIdx] || '';
    const sBg = STATUS_BG[sIdx] || '#F1F5F9';
    const sFg = STATUS_FG[sIdx] || '#475569';

    const k = l.kategori ? _kategoriList.find(x => x.id === l.kategori) : null;

    document.getElementById('lap012-d-title').textContent = 'Detail Laporan';
    document.getElementById('lap012-d-sub').textContent = (l.proyekId || '—').toUpperCase();

    const body = document.getElementById('lap012-d-body');
    body.innerHTML = `
      <div class="lap012-d-status" style="background:${sBg};color:${sFg};">
        ${sIc} ${_esc(sLbl)}
      </div>
      <div class="lap012-d-pekerjaan">${_esc(l.pekerjaan || '(tanpa deskripsi)')}</div>
      <div class="lap012-d-table">
        <div class="lap012-d-row"><span>📅 Tanggal</span><span>${_esc(_formatDateHeader(String(l.tanggal || '').slice(0,10)))}</span></div>
        <div class="lap012-d-row"><span>📍 Lokasi</span><span>${_esc(l.lokasi || '-')}</span></div>
        <div class="lap012-d-row"><span>👷 Tim</span><span>${_esc(l.tim || '-')}</span></div>
        <div class="lap012-d-row"><span>🏷️ Kategori</span><span>${k ? _esc((k.icon || '') + ' ' + k.label) : '-'}</span></div>
        ${l.catatan ? `<div class="lap012-d-row lap012-d-row-full"><span>📝 Catatan</span><span>${_esc(l.catatan)}</span></div>` : ''}
      </div>
      <div class="lap012-d-meta">
        ${l.createdBy ? `Dibuat oleh <b>${_esc(l.createdBy)}</b>` : ''}
        ${l.createdAt ? ` · ${_formatRelativeTime(l.createdAt)}` : ''}
        ${l.updatedAt && l.updatedAt !== l.createdAt ? ` · Diedit ${_formatRelativeTime(l.updatedAt)}${l.updatedBy && l.updatedBy !== l.createdBy ? ' oleh <b>' + _esc(l.updatedBy) + '</b>' : ''}` : ''}
      </div>
    `;

    const foot = document.getElementById('lap012-d-foot');
    let footHtml = '<button class="lap012-btn-secondary" onclick="window._patch012.closeDetail()">Tutup</button>';
    if(_canDelete()){
      footHtml += '<button class="lap012-btn-danger" onclick="window._patch012.deleteCurrent()">🗑️ Hapus</button>';
    }
    if(_canEdit()){
      footHtml += '<button class="lap012-btn-primary" onclick="window._patch012.editCurrent()">✏️ Edit</button>';
    }
    foot.innerHTML = footHtml;

    document.getElementById('lap012-modal-detail').classList.add('open');
  }

  function closeDetail(){
    document.getElementById('lap012-modal-detail').classList.remove('open');
    _currentDetailId = null;
  }

  // ============================================================
  // FORM (TAMBAH/EDIT)
  // ============================================================
  function openAddModal(){
    if(!_canCreate()){
      _toast('🔒 Role kamu tidak punya akses tambah laporan');
      return;
    }
    if(!_proyekId){
      _toast('⚠️ Pilih proyek dulu');
      return;
    }
    _renderKategoriOptions();
    document.getElementById('lap012-f-id').value = '';
    document.getElementById('lap012-f-title').textContent = 'Tambah Laporan Baru';
    document.getElementById('lap012-f-sub').textContent = 'Isi data laporan harian estate · ' + _proyekId.toUpperCase();
    document.getElementById('lap012-f-tanggal').value = _toIsoDate(new Date());
    document.getElementById('lap012-f-status').value = 'proses';
    document.getElementById('lap012-f-kategori').value = '';
    document.getElementById('lap012-f-lokasi').value = '';
    document.getElementById('lap012-f-pekerjaan').value = '';
    document.getElementById('lap012-f-tim').value = '';
    document.getElementById('lap012-f-catatan').value = '';
    document.getElementById('lap012-modal-form').classList.add('open');
    setTimeout(() => { document.getElementById('lap012-f-pekerjaan').focus(); }, 100);
  }

  function editCurrent(){
    if(!_currentDetailId) return;
    const l = _laporanList.find(x => String(x.id) === String(_currentDetailId));
    if(!l) return;
    if(!_canEdit()){
      _toast('🔒 Role kamu tidak punya akses edit');
      return;
    }
    closeDetail();
    _renderKategoriOptions();
    document.getElementById('lap012-f-id').value = l.id;
    document.getElementById('lap012-f-title').textContent = 'Edit Laporan';
    document.getElementById('lap012-f-sub').textContent = 'Update data laporan · ' + (l.proyekId || _proyekId).toUpperCase();
    document.getElementById('lap012-f-tanggal').value = String(l.tanggal || '').slice(0,10);
    document.getElementById('lap012-f-status').value = String(l.status || 'proses').toLowerCase();
    document.getElementById('lap012-f-kategori').value = l.kategori || '';
    document.getElementById('lap012-f-lokasi').value = l.lokasi || '';
    document.getElementById('lap012-f-pekerjaan').value = l.pekerjaan || '';
    document.getElementById('lap012-f-tim').value = l.tim || '';
    document.getElementById('lap012-f-catatan').value = l.catatan || '';
    document.getElementById('lap012-modal-form').classList.add('open');
  }

  function closeForm(){
    document.getElementById('lap012-modal-form').classList.remove('open');
  }

  async function saveForm(){
    const id = document.getElementById('lap012-f-id').value;
    const tanggal = document.getElementById('lap012-f-tanggal').value;
    const status = document.getElementById('lap012-f-status').value;
    const kategori = document.getElementById('lap012-f-kategori').value;
    const lokasi = document.getElementById('lap012-f-lokasi').value.trim();
    const pekerjaan = document.getElementById('lap012-f-pekerjaan').value.trim();
    const tim = document.getElementById('lap012-f-tim').value.trim();
    const catatan = document.getElementById('lap012-f-catatan').value.trim();

    // Validation
    if(!tanggal){
      _toast('⚠️ Tanggal wajib diisi');
      return;
    }
    if(!pekerjaan || pekerjaan.length < 5){
      _toast('⚠️ Pekerjaan minimal 5 karakter');
      return;
    }

    const btnSave = document.getElementById('lap012-f-save');
    btnSave.disabled = true;
    const originalText = btnSave.textContent;
    btnSave.textContent = '⏳ Menyimpan...';

    try {
      const payload = {
        tanggal: tanggal,
        proyekId: _proyekId,
        lokasi: lokasi,
        pekerjaan: pekerjaan,
        tim: tim,
        status: status,
        catatan: catatan,
        kategori: kategori
      };
      if(id) payload.id = id;

      const res = await global.BM4Api.post('saveEstateLaporan', payload);

      if(res && res.success){
        _toast(id ? '✅ Laporan diperbarui' : '✅ Laporan baru disimpan');
        closeForm();
        // Update local list
        if(res.data){
          if(id){
            const idx = _laporanList.findIndex(x => String(x.id) === String(id));
            if(idx >= 0) _laporanList[idx] = res.data;
            else _laporanList.push(res.data);
          } else {
            _laporanList.push(res.data);
          }
        }
        _render();
      } else {
        _toast('❌ Gagal: ' + (res.message || res.error || 'unknown'));
      }
    } catch(e){
      console.error('[patch-012] save error:', e);
      _toast('❌ Error: ' + (e.message || e));
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = originalText;
    }
  }

  async function deleteCurrent(){
    if(!_currentDetailId) return;
    if(!_canDelete()){
      _toast('🔒 Role kamu tidak punya akses hapus');
      return;
    }
    const l = _laporanList.find(x => String(x.id) === String(_currentDetailId));
    if(!l) return;
    const confirmMsg = 'Hapus laporan ini?\n\n"' + String(l.pekerjaan || '').slice(0, 80) + '"\n\nAksi ini tidak bisa dibatalkan.';
    if(!confirm(confirmMsg)) return;

    try {
      const res = await global.BM4Api.post('deleteEstateLaporan', { id: _currentDetailId });
      if(res && res.success){
        _toast('🗑️ Laporan dihapus');
        _laporanList = _laporanList.filter(x => String(x.id) !== String(_currentDetailId));
        closeDetail();
        _render();
      } else {
        _toast('❌ Gagal hapus: ' + (res.message || res.error || 'unknown'));
      }
    } catch(e){
      console.error('[patch-012] delete error:', e);
      _toast('❌ Error: ' + (e.message || e));
    }
  }

  // ============================================================
  // UTIL
  // ============================================================
  function _esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function _toIsoDate(d){
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  function _formatDateHeader(iso){
    if(!iso || iso === 'Tanpa tanggal') return 'Tanpa tanggal';
    try {
      const d = new Date(iso + 'T00:00:00');
      const today = new Date();
      today.setHours(0,0,0,0);
      const target = new Date(d);
      target.setHours(0,0,0,0);
      const diff = Math.round((today.getTime() - target.getTime()) / 86400000);
      const labels = ['Hari ini', 'Kemarin', '2 hari lalu'];
      const dayName = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][d.getDay()];
      const monthName = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][d.getMonth()];
      const fullDate = dayName + ', ' + d.getDate() + ' ' + monthName + ' ' + d.getFullYear();
      if(diff >= 0 && diff <= 2 && labels[diff]){
        return labels[diff] + ' · ' + fullDate;
      }
      return fullDate;
    } catch(_){ return iso; }
  }

  function _formatRelativeTime(iso){
    if(!iso) return '-';
    try {
      const d = new Date(iso);
      const diff = Date.now() - d.getTime();
      const mins = Math.round(diff / 60000);
      if(mins < 1) return 'baru saja';
      if(mins < 60) return mins + ' menit lalu';
      const hours = Math.round(mins / 60);
      if(hours < 24) return hours + ' jam lalu';
      const days = Math.round(hours / 24);
      if(days < 7) return days + ' hari lalu';
      return d.toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
    } catch(_){ return iso; }
  }

  function _toast(msg){
    if(typeof global.showToast === 'function'){
      global.showToast(msg);
      return;
    }
    // Fallback: cari .toast element manual
    const t = document.getElementById('toast');
    if(t){
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 3000);
    } else {
      console.log('[patch-012]', msg);
    }
  }

  // ============================================================
  // EXPOSE & BOOT
  // ============================================================
  global._patch012 = {
    init: init,
    loadData: loadData,
    setPeriod: setPeriod,
    setStatus: setStatus,
    setKategori: setKategori,
    openDetail: openDetail,
    closeDetail: closeDetail,
    openAddModal: openAddModal,
    editCurrent: editCurrent,
    closeForm: closeForm,
    saveForm: saveForm,
    deleteCurrent: deleteCurrent
  };

  // Auto-init saat DOM ready
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  console.log('[patch-012] estate laporan loaded');
})(typeof window !== 'undefined' ? window : this);
