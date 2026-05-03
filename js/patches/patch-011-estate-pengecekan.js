/**
 * BM4 Patch 011 — Estate Pengecekan Harian (Sub-2 UI Sesi B)
 *
 * Sub-tab "✅ Pengecekan Harian" di Estate Management.
 * Untuk security/cleaning officer cek harian area prioritas.
 *
 * Fitur:
 *   - Date picker (default hari ini)
 *   - Stats card: "X dari Y blok prioritas dicek (Z%)"
 *   - Siteplan dengan SEMUA blok prioritas, color-coded by status hari ini:
 *       ✓ Hijau  = bersih
 *       ⚠ Kuning = perhatian
 *       ✗ Merah  = bermasalah
 *       ○ Abu    = belum dicek
 *   - Klik pin → modal cek lengkap:
 *       - Status (3-tombol radio)
 *       - Catatan
 *       - Foto upload (camera + file)
 *       - History cek hari ini per blok
 *   - Sidebar: list blok bermasalah hari ini + list belum dicek
 *
 * Dependency:
 *   - SiteplanCanvas (180-siteplan-canvas.js)
 *   - BM4Api (11-api-layer.js)
 *
 * Backend yang dipakai (Code.gs v5):
 *   - getEstateBlok          (filter prioritasOnly=true)
 *   - getEstatePengecekan    (filter tanggal+proyek)
 *   - getPengecekanStats     (agregat harian)
 *   - saveEstatePengecekan   (upsert smart same-day)
 */
(function(global){
  'use strict';

  // ============================================================
  // STATE
  // ============================================================
  let _inited = false;
  let _canvas = null;
  let _proyekId = null;
  let _selectedDate = _todayStr();   // YYYY-MM-DD
  let _prioritasBlok = [];            // Hanya blok dengan isPrioritas=true
  let _cekToday = [];                 // Pengecekan untuk _selectedDate
  let _cekByBlokId = {};              // Map: blokId -> latest pengecekan record (hari ini)
  let _stats = null;
  let _editingCek = null;             // { blokId, blokNama, existingRecord? }
  let _photoDataUrl = '';
  let _searchQuery = '';
  let _filterMode = 'semua';          // semua | bermasalah | belum

  const TAB_KEY = 'pengecekan';

  const STATUS_META = {
    bersih:     { label: 'Bersih',     icon: '✓', color: '#10B981' },
    perhatian:  { label: 'Perhatian',  icon: '⚠', color: '#F59E0B' },
    bermasalah: { label: 'Bermasalah', icon: '✗', color: '#EF4444' }
  };
  const COLOR_BELUM = '#94A3B8';

  // ============================================================
  // INJECT MARKUP
  // ============================================================
  function _injectMarkup(){
    const subnav = document.querySelector('.estate-subnav');
    if(!subnav) return false;
    if(subnav.querySelector('[data-section="' + TAB_KEY + '"]')) return true;

    // Tombol tab
    const tabBtn = document.createElement('button');
    tabBtn.className = 'estate-subtab';
    tabBtn.setAttribute('data-section', TAB_KEY);
    tabBtn.innerHTML = '✅ Pengecekan Harian';
    tabBtn.onclick = function(){ _switchTo(this); };

    const spacer = subnav.querySelector('.estate-subnav-spacer');
    if(spacer){
      subnav.insertBefore(tabBtn, spacer);
    } else {
      subnav.appendChild(tabBtn);
    }

    // Section panel
    const pane = document.getElementById('pane-estate');
    if(!pane) return false;
    if(document.getElementById('estate-section-' + TAB_KEY)) return true;

    const section = document.createElement('div');
    section.className = 'estate-section';
    section.id = 'estate-section-' + TAB_KEY;
    section.innerHTML = _buildSectionHTML();
    pane.appendChild(section);

    return true;
  }

  function _buildSectionHTML(){
    return '' +
      '<div class="cek-wrap">' +
      // Top bar: tanggal + stats + reload
      '  <div class="cek-topbar">' +
      '    <div class="cek-topbar-left">' +
      '      <label class="cek-date-label">📅 Tanggal Cek:</label>' +
      '      <input type="date" id="cek-date" class="cek-date-input">' +
      '      <button class="cek-btn-mini" id="cek-btn-today">Hari ini</button>' +
      '    </div>' +
      '    <div class="cek-topbar-right">' +
      '      <button class="cek-btn-secondary" id="cek-btn-reload">🔄 Reload</button>' +
      '    </div>' +
      '  </div>' +
      // Stats cards
      '  <div class="cek-stats-grid" id="cek-stats">' +
      '    <div class="cek-stat-card cek-stat-progress">' +
      '      <div class="cek-stat-label">Progress Hari Ini</div>' +
      '      <div class="cek-stat-value" id="cek-stat-progress">— / —</div>' +
      '      <div class="cek-stat-bar"><div class="cek-stat-bar-fill" id="cek-stat-bar"></div></div>' +
      '    </div>' +
      '    <div class="cek-stat-card cek-stat-bersih">' +
      '      <div class="cek-stat-label">✓ Bersih</div>' +
      '      <div class="cek-stat-value" id="cek-stat-bersih">—</div>' +
      '    </div>' +
      '    <div class="cek-stat-card cek-stat-perhatian">' +
      '      <div class="cek-stat-label">⚠ Perhatian</div>' +
      '      <div class="cek-stat-value" id="cek-stat-perhatian">—</div>' +
      '    </div>' +
      '    <div class="cek-stat-card cek-stat-bermasalah">' +
      '      <div class="cek-stat-label">✗ Bermasalah</div>' +
      '      <div class="cek-stat-value" id="cek-stat-bermasalah">—</div>' +
      '    </div>' +
      '  </div>' +
      // Legend
      '  <div class="cek-legend">' +
      '    <span class="cek-legend-item"><span class="cek-dot" style="background:#10B981"></span> Bersih</span>' +
      '    <span class="cek-legend-item"><span class="cek-dot" style="background:#F59E0B"></span> Perhatian</span>' +
      '    <span class="cek-legend-item"><span class="cek-dot" style="background:#EF4444"></span> Bermasalah</span>' +
      '    <span class="cek-legend-item"><span class="cek-dot" style="background:#94A3B8"></span> Belum dicek</span>' +
      '    <span class="cek-legend-hint">Klik blok di siteplan untuk cek</span>' +
      '  </div>' +
      // Main: canvas + sidebar
      '  <div class="cek-main">' +
      '    <div class="cek-canvas-area">' +
      '      <div class="cek-canvas-empty" id="cek-canvas-empty">' +
      '        <div class="cek-empty-icon">✅</div>' +
      '        <div class="cek-empty-title">Belum ada blok prioritas</div>' +
      '        <div class="cek-empty-sub">Tag blok prioritas dulu di tab "⭐ Setup Prioritas".</div>' +
      '      </div>' +
      '      <div class="cek-canvas-container" id="cek-canvas-container" style="display:none;"></div>' +
      '    </div>' +
      '    <aside class="cek-sidebar">' +
      '      <div class="cek-filter-tabs">' +
      '        <button class="cek-filter-tab active" data-filter="semua">Semua</button>' +
      '        <button class="cek-filter-tab" data-filter="bermasalah">⚠/✗ Bermasalah</button>' +
      '        <button class="cek-filter-tab" data-filter="belum">Belum dicek</button>' +
      '      </div>' +
      '      <input type="text" id="cek-search" class="cek-search" placeholder="🔍 Cari blok...">' +
      '      <div class="cek-list" id="cek-list">' +
      '        <div class="cek-list-empty">Loading...</div>' +
      '      </div>' +
      '    </aside>' +
      '  </div>' +
      '</div>' +
      // Modal Cek
      '<div class="cek-modal-overlay" id="cek-modal">' +
      '  <div class="cek-modal" role="dialog">' +
      '    <div class="cek-modal-head">' +
      '      <div class="cek-modal-title" id="cek-modal-title">Cek Blok</div>' +
      '      <div class="cek-modal-sub" id="cek-modal-date">—</div>' +
      '      <button class="cek-modal-close" id="cek-modal-close" aria-label="Tutup">×</button>' +
      '    </div>' +
      '    <div class="cek-modal-body">' +
      '      <label class="cek-form-label">Status <span class="cek-required">*</span></label>' +
      '      <div class="cek-status-group" id="cek-status-group">' +
      '        <button class="cek-status-btn" data-status="bersih"><span class="cek-status-icon">✓</span> Bersih</button>' +
      '        <button class="cek-status-btn" data-status="perhatian"><span class="cek-status-icon">⚠</span> Perhatian</button>' +
      '        <button class="cek-status-btn" data-status="bermasalah"><span class="cek-status-icon">✗</span> Bermasalah</button>' +
      '      </div>' +
      '      <label class="cek-form-label">Catatan <small id="cek-catatan-hint">(opsional kalau bersih)</small></label>' +
      '      <textarea id="cek-catatan" rows="3" maxlength="500" placeholder="Deskripsi kondisi atau masalah..."></textarea>' +
      '      <label class="cek-form-label">Foto <small id="cek-foto-hint">(wajib kalau ⚠/✗)</small></label>' +
      '      <div class="cek-foto-area">' +
      '        <input type="file" id="cek-foto-file" accept="image/*" capture="environment" style="display:none;">' +
      '        <button class="cek-foto-btn" id="cek-foto-btn">📷 Ambil / Upload Foto</button>' +
      '        <div class="cek-foto-preview" id="cek-foto-preview" style="display:none;">' +
      '          <img id="cek-foto-img" alt="Preview">' +
      '          <button class="cek-foto-clear" id="cek-foto-clear" title="Hapus foto">×</button>' +
      '        </div>' +
      '      </div>' +
      '      <div class="cek-history-box" id="cek-history-box">' +
      '        <div class="cek-history-title">📋 History Cek (' + 'hari ini' + ')</div>' +
      '        <div class="cek-history-list" id="cek-history-list"></div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="cek-modal-foot">' +
      '      <button class="cek-btn-secondary" id="cek-modal-cancel">Batal</button>' +
      '      <button class="cek-btn-primary" id="cek-modal-save">💾 Simpan Cek</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  // ============================================================
  // TAB SWITCH
  // ============================================================
  function _switchTo(btnEl){
    document.querySelectorAll('.estate-subtab').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
    document.querySelectorAll('.estate-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('estate-section-' + TAB_KEY);
    if(target) target.classList.add('active');
    _initSection();
  }

  function _initSection(){
    const proyekId = _getProyekId();
    if(!proyekId){
      _showEmpty('🏘️', 'Pilih proyek dulu', 'Kembali ke halaman pilih proyek, lalu masuk lagi ke Pengecekan Harian.');
      return;
    }
    _bindControls();
    if(_proyekId !== proyekId){
      _proyekId = proyekId;
      _loadAll();
    } else {
      _loadAll();
    }
  }

  function _bindControls(){
    const dateEl = document.getElementById('cek-date');
    if(dateEl && !dateEl.dataset.bound){
      dateEl.dataset.bound = '1';
      dateEl.value = _selectedDate;
      dateEl.onchange = function(){
        _selectedDate = this.value || _todayStr();
        _loadAll();
      };
    }
    const todayBtn = document.getElementById('cek-btn-today');
    if(todayBtn && !todayBtn.dataset.bound){
      todayBtn.dataset.bound = '1';
      todayBtn.onclick = function(){
        _selectedDate = _todayStr();
        const d = document.getElementById('cek-date');
        if(d) d.value = _selectedDate;
        _loadAll();
      };
    }
    const reloadBtn = document.getElementById('cek-btn-reload');
    if(reloadBtn && !reloadBtn.dataset.bound){
      reloadBtn.dataset.bound = '1';
      reloadBtn.onclick = _loadAll;
    }
    const searchEl = document.getElementById('cek-search');
    if(searchEl && !searchEl.dataset.bound){
      searchEl.dataset.bound = '1';
      searchEl.oninput = function(){ _searchQuery = this.value; _renderList(); };
    }
    document.querySelectorAll('.cek-filter-tab').forEach(btn => {
      if(btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.onclick = function(){
        document.querySelectorAll('.cek-filter-tab').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        _filterMode = this.dataset.filter || 'semua';
        _renderList();
      };
    });

    // Modal bindings
    const closeBtn = document.getElementById('cek-modal-close');
    if(closeBtn && !closeBtn.dataset.bound){
      closeBtn.dataset.bound = '1';
      closeBtn.onclick = _closeModal;
    }
    const cancelBtn = document.getElementById('cek-modal-cancel');
    if(cancelBtn && !cancelBtn.dataset.bound){
      cancelBtn.dataset.bound = '1';
      cancelBtn.onclick = _closeModal;
    }
    const saveBtn = document.getElementById('cek-modal-save');
    if(saveBtn && !saveBtn.dataset.bound){
      saveBtn.dataset.bound = '1';
      saveBtn.onclick = _saveCek;
    }
    document.querySelectorAll('.cek-status-btn').forEach(btn => {
      if(btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.onclick = function(){
        document.querySelectorAll('.cek-status-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        _updateRequiredHint();
      };
    });
    const fotoBtn = document.getElementById('cek-foto-btn');
    const fotoFile = document.getElementById('cek-foto-file');
    if(fotoBtn && !fotoBtn.dataset.bound){
      fotoBtn.dataset.bound = '1';
      fotoBtn.onclick = function(){ if(fotoFile) fotoFile.click(); };
    }
    if(fotoFile && !fotoFile.dataset.bound){
      fotoFile.dataset.bound = '1';
      fotoFile.onchange = _handlePhotoUpload;
    }
    const clearBtn = document.getElementById('cek-foto-clear');
    if(clearBtn && !clearBtn.dataset.bound){
      clearBtn.dataset.bound = '1';
      clearBtn.onclick = _clearPhoto;
    }
  }

  // ============================================================
  // DATA LOAD
  // ============================================================
  async function _loadAll(){
    if(!global.BM4Api){
      _toast('⚠️ BM4Api belum tersedia');
      return;
    }
    try {
      // Load 3 hal paralel
      const [resBlok, resCek, resStats] = await Promise.all([
        global.BM4Api.get('getEstateBlok', { proyekId: _proyekId, prioritasOnly: true, aktifOnly: true }),
        global.BM4Api.get('getEstatePengecekan', { proyekId: _proyekId, tanggalCek: _selectedDate }),
        global.BM4Api.get('getPengecekanStats', { proyekId: _proyekId, tanggal: _selectedDate })
      ]);

      _prioritasBlok = (resBlok && resBlok.success && resBlok.data) ? resBlok.data : [];
      _cekToday = (resCek && resCek.success && resCek.data) ? resCek.data : [];
      _stats = (resStats && resStats.success) ? resStats : null;

      // Build map blokId → latest cek
      _cekByBlokId = {};
      _cekToday.forEach(c => {
        const bid = String(c.blokId);
        if(!_cekByBlokId[bid] ||
           String(c.updatedAt || c.createdAt) > String(_cekByBlokId[bid].updatedAt || _cekByBlokId[bid].createdAt)){
          _cekByBlokId[bid] = c;
        }
      });

      _renderStats();
      _renderCanvas();
      _renderList();
    } catch(e){
      console.error('[patch-011] load error', e);
      _toast('⚠️ Error load: ' + (e.message || e));
    }
  }

  // ============================================================
  // STATS RENDER
  // ============================================================
  function _renderStats(){
    if(!_stats){
      _setText('cek-stat-progress', '— / —');
      _setText('cek-stat-bersih', '—');
      _setText('cek-stat-perhatian', '—');
      _setText('cek-stat-bermasalah', '—');
      const bar = document.getElementById('cek-stat-bar');
      if(bar) bar.style.width = '0%';
      return;
    }
    _setText('cek-stat-progress', _stats.dicek + ' / ' + _stats.totalPrioritas + ' (' + _stats.persenDicek + '%)');
    _setText('cek-stat-bersih', _stats.bersih);
    _setText('cek-stat-perhatian', _stats.perhatian);
    _setText('cek-stat-bermasalah', _stats.bermasalah);
    const bar = document.getElementById('cek-stat-bar');
    if(bar) bar.style.width = _stats.persenDicek + '%';
  }

  // ============================================================
  // CANVAS RENDER (color by status)
  // ============================================================
  function _renderCanvas(){
    const empty = document.getElementById('cek-canvas-empty');
    const container = document.getElementById('cek-canvas-container');

    if(_prioritasBlok.length === 0){
      if(empty){
        empty.style.display = '';
        empty.querySelector('.cek-empty-icon').textContent = '⭐';
        empty.querySelector('.cek-empty-title').textContent = 'Belum ada blok prioritas';
        empty.querySelector('.cek-empty-sub').textContent = 'Tag blok prioritas dulu di tab "⭐ Setup Prioritas".';
      }
      if(container) container.style.display = 'none';
      return;
    }

    if(empty) empty.style.display = 'none';
    if(container) container.style.display = '';

    if(!global.SiteplanCanvas){
      _toast('⚠️ SiteplanCanvas belum dimuat');
      return;
    }

    if(_canvas){
      _canvas.setBlok(_prioritasBlok);
      _canvas.render();
      return;
    }

    _canvas = new global.SiteplanCanvas(container, {
      imageUrl: _getSiteplanUrl(_proyekId),
      mode: 'inspect',
      blokList: _prioritasBlok,
      colorFn: (blok) => {
        if(!blok || !blok.id) return COLOR_BELUM;
        const cek = _cekByBlokId[String(blok.id)];
        if(!cek) return COLOR_BELUM;
        const meta = STATUS_META[String(cek.status).toLowerCase()];
        return meta ? meta.color : COLOR_BELUM;
      },
      onTap: (blok) => {
        if(blok) _openModal(blok);
      }
    });
    _canvas.render();
  }

  // ============================================================
  // LIST RENDER (sidebar)
  // ============================================================
  function _renderList(){
    const listEl = document.getElementById('cek-list');
    if(!listEl) return;

    let items = _prioritasBlok.slice();

    // Apply filter
    if(_filterMode === 'bermasalah'){
      items = items.filter(b => {
        const c = _cekByBlokId[String(b.id)];
        return c && (c.status === 'perhatian' || c.status === 'bermasalah');
      });
    } else if(_filterMode === 'belum'){
      items = items.filter(b => !_cekByBlokId[String(b.id)]);
    }

    // Search
    if(_searchQuery){
      const q = _searchQuery.toLowerCase();
      items = items.filter(b => String(b.nama || '').toLowerCase().includes(q));
    }

    if(items.length === 0){
      const emptyMsg = _filterMode === 'bermasalah' ? 'Tidak ada blok bermasalah.<br><small>Bagus! Semua aman.</small>' :
                       _filterMode === 'belum'      ? 'Semua blok prioritas sudah dicek hari ini! 🎉' :
                                                      'Tidak ada hasil.';
      listEl.innerHTML = '<div class="cek-list-empty">' + emptyMsg + '</div>';
      return;
    }

    // Sort: bermasalah > perhatian > belum > bersih, lalu by nama
    items.sort((a,b) => {
      const sa = _statusPriority(_cekByBlokId[String(a.id)]);
      const sb = _statusPriority(_cekByBlokId[String(b.id)]);
      if(sa !== sb) return sa - sb;
      return String(a.nama).localeCompare(String(b.nama), undefined, {numeric:true});
    });

    listEl.innerHTML = items.map(b => {
      const cek = _cekByBlokId[String(b.id)];
      const status = cek ? cek.status : null;
      const meta = status ? STATUS_META[status] : null;
      const statusBadge = meta
        ? '<span class="cek-list-badge" style="background:' + meta.color + '">' + meta.icon + ' ' + meta.label + '</span>'
        : '<span class="cek-list-badge" style="background:' + COLOR_BELUM + '">○ Belum</span>';
      const catatan = cek && cek.catatan ? '<div class="cek-list-note">📝 ' + _escape(cek.catatan).slice(0, 80) + (cek.catatan.length > 80 ? '...' : '') + '</div>' : '';
      const time = cek ? '<span class="cek-list-time">' + _formatTime(cek.updatedAt || cek.createdAt) + ' · ' + _escape(cek.updatedBy || cek.createdBy || '—') + '</span>' : '';
      return '<div class="cek-list-item" data-id="' + _escape(b.id) + '">' +
        '<div class="cek-list-row">' +
        '  <span class="cek-list-name">⭐ ' + _escape(b.nama) + '</span>' +
        '  ' + statusBadge +
        '</div>' +
        catatan +
        (time ? '<div class="cek-list-meta">' + time + '</div>' : '') +
        '<button class="cek-list-cta" data-id="' + _escape(b.id) + '">' + (cek ? '✏️ Update Cek' : '➕ Cek Sekarang') + '</button>' +
        '</div>';
    }).join('');

    listEl.querySelectorAll('.cek-list-cta').forEach(btn => {
      btn.onclick = function(e){
        e.stopPropagation();
        const id = this.dataset.id;
        const blok = _prioritasBlok.find(b => String(b.id) === String(id));
        if(blok) _openModal(blok);
      };
    });
  }

  function _statusPriority(cek){
    if(!cek) return 2; // belum dicek
    const s = cek.status;
    if(s === 'bermasalah') return 0;
    if(s === 'perhatian') return 1;
    if(s === 'bersih') return 3;
    return 4;
  }

  // ============================================================
  // MODAL CEK
  // ============================================================
  function _openModal(blok){
    if(!blok) return;
    _editingCek = { blokId: blok.id, blokNama: blok.nama };
    _photoDataUrl = '';

    const existing = _cekByBlokId[String(blok.id)];
    if(existing){
      _editingCek.existingId = existing.id;
      _photoDataUrl = existing.foto || '';
    }

    _setText('cek-modal-title', '⭐ ' + blok.nama);
    _setText('cek-modal-date', 'Tanggal: ' + _selectedDate);

    // Reset form
    document.querySelectorAll('.cek-status-btn').forEach(b => b.classList.remove('active'));
    if(existing && existing.status){
      const target = document.querySelector('.cek-status-btn[data-status="' + existing.status + '"]');
      if(target) target.classList.add('active');
    }
    const catatanEl = document.getElementById('cek-catatan');
    if(catatanEl) catatanEl.value = existing ? (existing.catatan || '') : '';

    _renderPhotoPreview();
    _updateRequiredHint();
    _renderHistoryInModal(blok.id);

    const overlay = document.getElementById('cek-modal');
    if(overlay) overlay.classList.add('open');
  }

  function _closeModal(){
    _editingCek = null;
    _photoDataUrl = '';
    const overlay = document.getElementById('cek-modal');
    if(overlay) overlay.classList.remove('open');
    const fileEl = document.getElementById('cek-foto-file');
    if(fileEl) fileEl.value = '';
  }

  function _renderHistoryInModal(blokId){
    const listEl = document.getElementById('cek-history-list');
    if(!listEl) return;
    const history = _cekToday.filter(c => String(c.blokId) === String(blokId));
    if(history.length === 0){
      listEl.innerHTML = '<div class="cek-history-empty">Belum ada cek hari ini.</div>';
      return;
    }
    history.sort((a,b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    listEl.innerHTML = history.map(h => {
      const meta = STATUS_META[h.status];
      const icon = meta ? meta.icon : '○';
      const color = meta ? meta.color : '#94a3b8';
      const time = _formatTime(h.updatedAt || h.createdAt);
      const who = _escape(h.updatedBy || h.createdBy || '—');
      const cat = h.catatan ? ' · ' + _escape(h.catatan).slice(0, 60) + (h.catatan.length > 60 ? '...' : '') : '';
      return '<div class="cek-history-row">' +
        '<span class="cek-history-status" style="color:' + color + '">' + icon + '</span>' +
        '<span class="cek-history-time">' + time + '</span>' +
        '<span class="cek-history-by">' + who + '</span>' +
        '<span class="cek-history-cat">' + cat + '</span>' +
        '</div>';
    }).join('');
  }

  function _updateRequiredHint(){
    const activeBtn = document.querySelector('.cek-status-btn.active');
    const status = activeBtn ? activeBtn.dataset.status : '';
    const catatanHint = document.getElementById('cek-catatan-hint');
    const fotoHint = document.getElementById('cek-foto-hint');
    if(status === 'bersih'){
      if(catatanHint){ catatanHint.textContent = '(opsional)'; catatanHint.style.color = ''; }
      if(fotoHint){ fotoHint.textContent = '(opsional)'; fotoHint.style.color = ''; }
    } else if(status === 'perhatian' || status === 'bermasalah'){
      if(catatanHint){ catatanHint.textContent = '(disarankan)'; catatanHint.style.color = '#92400e'; }
      if(fotoHint){ fotoHint.textContent = '(WAJIB untuk bukti)'; fotoHint.style.color = '#dc2626'; }
    } else {
      if(catatanHint){ catatanHint.textContent = '(opsional kalau bersih)'; catatanHint.style.color = ''; }
      if(fotoHint){ fotoHint.textContent = '(wajib kalau ⚠/✗)'; fotoHint.style.color = ''; }
    }
  }

  // ============================================================
  // PHOTO UPLOAD
  // ============================================================
  function _handlePhotoUpload(e){
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    if(!file.type.startsWith('image/')){
      _toast('⚠️ File harus berupa gambar');
      return;
    }
    // Compress untuk save bandwidth: max 1024px wide
    _compressImage(file, 1024, 0.85).then(dataUrl => {
      _photoDataUrl = dataUrl;
      _renderPhotoPreview();
    }).catch(err => {
      console.error('[patch-011] compress error', err);
      // Fallback: read raw
      const reader = new FileReader();
      reader.onload = (ev) => {
        _photoDataUrl = ev.target.result;
        _renderPhotoPreview();
      };
      reader.readAsDataURL(file);
    });
  }

  function _compressImage(file, maxW, quality){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if(w > maxW){
            h = Math.round(h * maxW / w);
            w = maxW;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function _renderPhotoPreview(){
    const previewBox = document.getElementById('cek-foto-preview');
    const img = document.getElementById('cek-foto-img');
    const btn = document.getElementById('cek-foto-btn');
    if(_photoDataUrl){
      if(img) img.src = _photoDataUrl;
      if(previewBox) previewBox.style.display = '';
      if(btn) btn.style.display = 'none';
    } else {
      if(previewBox) previewBox.style.display = 'none';
      if(btn) btn.style.display = '';
    }
  }

  function _clearPhoto(){
    _photoDataUrl = '';
    const fileEl = document.getElementById('cek-foto-file');
    if(fileEl) fileEl.value = '';
    _renderPhotoPreview();
  }

  // ============================================================
  // SAVE CEK
  // ============================================================
  async function _saveCek(){
    if(!_editingCek) return;
    const activeBtn = document.querySelector('.cek-status-btn.active');
    if(!activeBtn){
      _toast('⚠️ Pilih status dulu');
      return;
    }
    const status = activeBtn.dataset.status;
    const catatanEl = document.getElementById('cek-catatan');
    const catatan = catatanEl ? String(catatanEl.value || '').trim() : '';

    // Validation: foto wajib kalau bukan bersih
    if((status === 'perhatian' || status === 'bermasalah') && !_photoDataUrl){
      if(!confirm('⚠️ Status ' + status + ' tanpa foto.\nSebaiknya upload foto sebagai bukti.\n\nLanjutkan tanpa foto?')) return;
    }

    const payload = {
      tanggalCek: _selectedDate,
      proyekId: _proyekId,
      blokId: _editingCek.blokId,
      blokNama: _editingCek.blokNama,
      status: status,
      catatan: catatan,
      foto: _photoDataUrl || ''
    };
    if(_editingCek.existingId){
      payload.id = _editingCek.existingId;
    }

    const saveBtn = document.getElementById('cek-modal-save');
    if(saveBtn){ saveBtn.disabled = true; saveBtn.innerHTML = '⏳ Menyimpan...'; }

    try {
      const res = await global.BM4Api.post('saveEstatePengecekan', payload);
      if(res && res.success){
        _toast('✅ Cek tersimpan: ' + _editingCek.blokNama + ' → ' + status);
        _closeModal();
        await _loadAll();
      } else {
        _toast('⚠️ Save gagal: ' + (res && res.message || res && res.error || 'unknown'));
      }
    } catch(e){
      console.error('[patch-011] save error', e);
      _toast('⚠️ Error: ' + (e.message || e));
    } finally {
      if(saveBtn){ saveBtn.disabled = false; saveBtn.innerHTML = '💾 Simpan Cek'; }
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================
  function _todayStr(){
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function _formatTime(iso){
    if(!iso) return '—';
    try {
      const d = new Date(iso);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return h + ':' + m;
    } catch(_){ return '—'; }
  }

  // ============================================================
  // PROYEK ID HELPER — multi-source fallback
  // FIX rc18.1: di kode existing `let currentProyek = null` adalah top-level
  // closure variable, BUKAN di window. `window.currentProyek` SELALU undefined.
  // Solusi: pakai sumber yang reliable cross-IIFE = localStorage app state.
  // Pattern ini disalin dari _getProyekId() di 181-estate-module.js.
  // ============================================================
  function _getProyekId(){
    // 1. Coba scope chain (currentProyek tanpa window.)
    try {
      if(typeof currentProyek !== 'undefined' && currentProyek){
        return String(currentProyek);
      }
    } catch(_){}

    // 2. Fallback paling reliable: localStorage app state.
    try {
      const raw = localStorage.getItem('bm4_app_state');
      if(raw){
        const state = JSON.parse(raw);
        if(state && state.proyek) return String(state.proyek);
      }
    } catch(_){}

    // 3. Fallback: window.currentProyek (kalau ada yang explicit set)
    try {
      if(global.currentProyek){
        if(typeof global.currentProyek === 'string') return global.currentProyek;
        if(global.currentProyek.id) return String(global.currentProyek.id);
      }
    } catch(_){}

    return null;
  }

  // ============================================================
  // SITEPLAN URL — convention based
  // FIX rc18.1: tidak lagi pakai global._estateGetSiteplanUrl.
  // ============================================================
  function _getSiteplanUrl(proyekId){
    if(!proyekId) return 'assets/gwc_siteplan.png';

    // 1. Cek PROYEK_LIST kalau ada
    try {
      let list = null;
      try {
        if(typeof PROYEK_LIST !== 'undefined' && Array.isArray(PROYEK_LIST)){
          list = PROYEK_LIST;
        } else if(Array.isArray(global.PROYEK_LIST)){
          list = global.PROYEK_LIST;
        }
      } catch(_){}
      if(list){
        const p = list.find(x => String(x.id || '').toLowerCase() === String(proyekId).toLowerCase());
        if(p && p.siteplanUrl) return p.siteplanUrl;
      }
    } catch(_){}

    // 2. Convention fallback
    return 'assets/' + String(proyekId).toLowerCase() + '_siteplan.png';
  }

  function _showEmpty(icon, title, sub){
    const empty = document.getElementById('cek-canvas-empty');
    const container = document.getElementById('cek-canvas-container');
    if(empty){
      empty.style.display = '';
      empty.querySelector('.cek-empty-icon').textContent = icon;
      empty.querySelector('.cek-empty-title').textContent = title;
      empty.querySelector('.cek-empty-sub').textContent = sub;
    }
    if(container) container.style.display = 'none';
  }

  function _toast(msg){
    if(typeof global.showToast === 'function') global.showToast(msg);
    else console.log('[patch-011]', msg);
  }

  function _setText(id, text){
    const el = document.getElementById(id);
    if(el) el.textContent = text;
  }

  function _escape(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ============================================================
  // INIT
  // ============================================================
  function _tryInit(){
    if(_inited) return;
    if(!document.querySelector('.estate-subnav')) return;
    _inited = _injectMarkup();
    if(_inited) console.log('[patch-011] Pengecekan Harian tab injected');
  }

  global.EstatePengecekan = {
    _state: () => ({ blok: _prioritasBlok, cek: _cekToday, stats: _stats, date: _selectedDate }),
    _reload: _loadAll,
    _injectMarkup: _injectMarkup
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _tryInit);
  } else {
    _tryInit();
  }
  setTimeout(_tryInit, 500);
  setTimeout(_tryInit, 1500);

  console.log('[patch-011] estate-pengecekan loaded');
})(typeof window !== 'undefined' ? window : this);
