/**
 * Estate Module — Desktop UI handler
 *
 * Sesi A: SKELETON (DONE)
 *   - initEstateModule() dipanggil saat user klik tab Estate
 *   - switchEstateSection() untuk pindah antar sub-menu
 *   - Update info bar (proyek aktif)
 *   - Cache mobile permissions untuk visibility check
 *   - Plotter SiteplanCanvas init (placeholder, belum interaktif)
 *
 * Sesi B: FULL PLOTTER LOGIC (current)
 *   - Plot mode: tap canvas → modal form (nama, tipe, catatan) → save lokal
 *   - Edit mode: drag pin → reposisi (auto _dirty), klik pin → modal edit
 *   - Inspect mode: hover tooltip via SiteplanCanvas, klik pin → focus & highlight di list
 *   - Sidebar list: render, search realtime, click-to-focus, edit/hapus per item
 *   - Save logic: bulk save via bulkSaveEstateBlok API, counter "X tersimpan · Y belum"
 *   - Reload: fetch ulang dari Sheet (peringatan kalau ada unsaved)
 *   - beforeunload guard kalau ada unsaved changes
 *   - Versi siteplan dasar (v1 default, dropdown disabled — diaktifkan saat user Buat Versi Baru)
 *
 * Dependency: SiteplanCanvas (180-siteplan-canvas.js), BM4Api (11-api-layer.js)
 */
(function(global){
  'use strict';

  // ============================================================
  // STATE
  // ============================================================
  let _estateInited = false;
  let _siteplanCanvas = null;
  let _currentSection = 'siteplan';

  // Plotter state
  let _blokList = [];           // Semua blok (saved + dirty + new)
  let _currentMode = 'plot';    // plot | edit | inspect
  let _currentVersion = 'v1';
  let _currentProyekId = null;  // proyek yang sedang di-load
  let _searchQuery = '';
  let _editingBlokId = null;    // blok id yang sedang di-edit di modal (null = plot baru)
  let _pendingNewPosition = null; // {x, y} saat user klik untuk plot baru

  // ============================================================
  // PROYEK ID HELPER — baca dari multiple sumber
  // FIX Sesi B-rev1: di kode existing `let currentProyek = null` di top-level
  // tidak ter-attach ke window object (karena let, bukan var). Jadi
  // `global.currentProyek` (= window.currentProyek) selalu undefined.
  // Fix: baca dari sumber yang reliable.
  // ============================================================
  function _getProyekId(){
    // 1. Coba scope chain (currentProyek tanpa window.) — works karena IIFE
    //    di-load setelah file 10-core-security-config-state.js
    try {
      if(typeof currentProyek !== 'undefined' && currentProyek){
        return String(currentProyek);
      }
    } catch(_){}

    // 2. Fallback: window.currentProyek (kalau ada yang explicit set)
    try {
      if(global.currentProyek){
        return String(global.currentProyek);
      }
    } catch(_){}

    // 3. Fallback terakhir: baca dari localStorage app state
    try {
      const raw = localStorage.getItem('bm4_app_state');
      if(raw){
        const state = JSON.parse(raw);
        if(state && state.proyek) return String(state.proyek);
      }
    } catch(_){}

    return null;
  }

  // ============================================================
  // INIT & LIFECYCLE
  // ============================================================
  function initEstateModule(){
    const proyekId = _getProyekId();
    console.log('[estate-module] init called, proyekId:', proyekId);

    _updateProyekInfo();

    if(_currentSection === 'siteplan'){
      _initSiteplanSection();
    }

    if(_estateInited) return;
    _estateInited = true;

    // Pre-fetch mobile permissions cache
    _ensureMobilePermissionsCache();

    // beforeunload guard
    window.addEventListener('beforeunload', _beforeUnloadHandler);
  }

  function _beforeUnloadHandler(e){
    if(_hasUnsavedChanges()){
      e.preventDefault();
      e.returnValue = 'Ada perubahan blok yang belum disimpan. Yakin keluar?';
      return e.returnValue;
    }
  }

  function switchEstateSection(section, btnEl){
    if(!section) return;
    _currentSection = section;

    document.querySelectorAll('.estate-subtab').forEach(b => b.classList.remove('active'));
    if(btnEl) btnEl.classList.add('active');

    document.querySelectorAll('.estate-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('estate-section-' + section);
    if(target) target.classList.add('active');

    if(section === 'siteplan'){
      _initSiteplanSection();
    }

    console.log('[estate-module] switched to section:', section);
  }

  // ============================================================
  // SITEPLAN SECTION
  // ============================================================
  function _initSiteplanSection(){
    const proyekId = _getProyekId();

    const emptyEl = document.getElementById('plotter-canvas-empty');
    const containerEl = document.getElementById('plotter-canvas-container');

    if(!proyekId){
      // Tampilkan empty state khusus "belum pilih proyek"
      _showCanvasEmpty('🏘️',
        'Pilih proyek dulu',
        'Kembali ke halaman pilih proyek, lalu masuk lagi ke Estate Management.',
        'ℹ️ Plotter akan aktif setelah proyek dipilih.');
      _updatePlotterControlsEnabled(false);
      return;
    }

    const siteplanUrl = _getSiteplanUrlForProyek(proyekId);
    if(!siteplanUrl){
      _showCanvasEmpty('🗺️',
        'Siteplan belum dimuat',
        'Upload file <code>' + _escape(proyekId) + '_siteplan.png</code> ke <code>/assets/siteplan/</code>, atau set URL di Sheet <code>Proyek</code> kolom <code>siteplanUrl</code>.',
        'ℹ️ Plotter aktif begitu siteplan tersedia.');
      _updatePlotterControlsEnabled(false);
      return;
    }

    if(emptyEl) emptyEl.style.display = 'none';
    if(containerEl) containerEl.style.display = '';

    // Build / re-build SiteplanCanvas
    if(!_siteplanCanvas || _currentProyekId !== proyekId){
      _currentProyekId = proyekId;
      try {
        if(_siteplanCanvas){
          _siteplanCanvas.destroy();
          _siteplanCanvas = null;
        }
        _siteplanCanvas = new global.SiteplanCanvas(containerEl, {
          imageUrl: siteplanUrl,
          mode: _currentMode,
          blokList: _blokList,
          onTap: _handleCanvasTap,
          onMove: _handleCanvasMove
        });
        _siteplanCanvas.render();
        console.log('[estate-module] SiteplanCanvas initialized, proyek=' + proyekId);
      } catch(e){
        console.error('[estate-module] gagal init SiteplanCanvas:', e);
        _showCanvasEmpty('⚠️', 'Gagal memuat SiteplanCanvas',
          _escape(String(e && e.message || e)), '');
        _updatePlotterControlsEnabled(false);
        return;
      }
    } else {
      _siteplanCanvas.setImage(siteplanUrl);
    }

    // Aktifkan controls plotter
    _updatePlotterControlsEnabled(true);

    // Load blok dari server (kalau belum ada di state)
    if(_blokList.length === 0){
      _loadBlokFromServer();
    } else {
      _siteplanCanvas.setBlok(_blokList);
      _renderBlokList();
      _updateStatBar();
    }
  }

  function _showCanvasEmpty(icon, title, sub, hint){
    const emptyEl = document.getElementById('plotter-canvas-empty');
    const containerEl = document.getElementById('plotter-canvas-container');
    if(emptyEl){
      emptyEl.style.display = '';
      emptyEl.innerHTML =
        '<div class="plotter-empty-icon">' + icon + '</div>' +
        '<div class="plotter-empty-title">' + title + '</div>' +
        '<div class="plotter-empty-sub">' + sub + '</div>' +
        (hint ? '<div class="plotter-empty-hint">' + hint + '</div>' : '');
    }
    if(containerEl) containerEl.style.display = 'none';
  }

  function _updatePlotterControlsEnabled(enabled){
    document.querySelectorAll('.plotter-mode').forEach(b => { b.disabled = !enabled; });
    const search = document.getElementById('plotter-search');
    if(search) search.disabled = !enabled;
    const reloadBtn = document.querySelector('.plotter-toolbar-right .plotter-btn-secondary');
    if(reloadBtn) reloadBtn.disabled = !enabled;
    const newVerBtn = document.querySelector('.plotter-toolbar-left .plotter-btn-mini');
    if(newVerBtn) newVerBtn.disabled = !enabled;
    // Zoom buttons
    const zoomIn = document.getElementById('plotter-zoom-in');
    const zoomOut = document.getElementById('plotter-zoom-out');
    const zoomReset = document.getElementById('plotter-zoom-reset');
    if(zoomIn) zoomIn.disabled = !enabled;
    if(zoomOut) zoomOut.disabled = !enabled;
    if(zoomReset) zoomReset.disabled = !enabled;

    const hint = document.getElementById('plotter-mode-hint');
    if(hint){
      if(enabled){
        hint.innerHTML = _modeHint(_currentMode);
      } else {
        hint.textContent = 'Plotter belum aktif';
      }
    }

    // Save button enabled hanya kalau ada unsaved changes
    _updateSaveButtonState();
  }

  function _modeHint(mode){
    const zoomTip = ' · Scroll = zoom · <kbd>Space</kbd>+drag atau <kbd>klik kanan</kbd>+drag = pan';
    switch(mode){
      case 'plot': return 'Klik area di siteplan untuk plot blok baru' + zoomTip;
      case 'edit': return 'Drag pin untuk reposisi · Klik pin untuk edit' + zoomTip;
      case 'inspect': return 'Drag siteplan untuk pan · Klik pin untuk fokus' + ' · Scroll = zoom';
      default: return '';
    }
  }

  // ============================================================
  // LOAD & SAVE
  // ============================================================
  async function _loadBlokFromServer(){
    const proyekId = _getProyekId();
    if(!proyekId){ return; }
    if(!global.BM4Api || typeof global.BM4Api.get !== 'function'){
      console.warn('[estate-module] BM4Api tidak tersedia, skip load');
      _renderBlokList();
      return;
    }

    try {
      _setStat('Memuat blok...');
      const res = await global.BM4Api.get('getEstateBlok', {
        proyekId: proyekId,
        siteplanVersion: _currentVersion
      });

      if(res && res.success && Array.isArray(res.data)){
        _blokList = res.data.map(_normalizeBlok);
        console.log('[estate-module] loaded ' + _blokList.length + ' blok dari server');
      } else if(res && !res.success){
        console.warn('[estate-module] getEstateBlok gagal:', res.error || res.message);
        _blokList = [];
        _toast('Gagal memuat blok: ' + (res.error || res.message || 'unknown'));
      } else {
        _blokList = [];
      }
    } catch(e){
      console.warn('[estate-module] gagal fetch blok:', e);
      _blokList = [];
    }

    if(_siteplanCanvas) _siteplanCanvas.setBlok(_blokList);
    _renderBlokList();
    _updateStatBar();
  }

  function _normalizeBlok(b){
    return {
      id: String(b.id || ''),
      nama: String(b.nama || ''),
      tipe: String(b.tipe || 'rumah').toLowerCase(),
      proyekId: String(b.proyekId || ''),
      siteplanVersion: String(b.siteplanVersion || 'v1'),
      pixelX: Number(b.pixelX) || 0,
      pixelY: Number(b.pixelY) || 0,
      pixelW: Number(b.pixelW) || 0,
      pixelH: Number(b.pixelH) || 0,
      aktif: b.aktif === false ? false : true,
      catatan: String(b.catatan || ''),
      // Field placeholder untuk konstruksi/sales (tidak diisi di sesi ini)
      statusKonstruksi: b.statusKonstruksi || '',
      progressPersen: b.progressPersen || 0,
      targetSelesai: b.targetSelesai || '',
      statusSales: b.statusSales || '',
      pembeli: b.pembeli || '',
      tanggalBooking: b.tanggalBooking || '',
      harga: b.harga || 0,
      createdBy: b.createdBy || '',
      createdAt: b.createdAt || '',
      updatedBy: b.updatedBy || '',
      updatedAt: b.updatedAt || '',
      // Local-only flags
      _dirty: false,
      _new: false,
      _deleted: false
    };
  }

  async function plotterSaveAll(){
    if(!_hasUnsavedChanges()){
      _toast('Tidak ada perubahan untuk disimpan');
      return;
    }
    if(!global.BM4Api || typeof global.BM4Api.post !== 'function'){
      _toast('API tidak tersedia');
      return;
    }

    const proyekId = _getProyekId();
    if(!proyekId){
      _toast('Proyek belum dipilih');
      return;
    }

    // Kumpulkan blok yang perlu disimpan: dirty (termasuk new) atau deleted
    const toSave = _blokList
      .filter(b => b._dirty || b._new)
      .filter(b => !b._deleted)
      .map(b => ({
        id: b.id,
        nama: b.nama,
        tipe: b.tipe,
        proyekId: proyekId,
        siteplanVersion: _currentVersion,
        pixelX: b.pixelX,
        pixelY: b.pixelY,
        pixelW: b.pixelW || 0,
        pixelH: b.pixelH || 0,
        aktif: true,
        catatan: b.catatan || ''
      }));

    const toDelete = _blokList.filter(b => b._deleted && !b._new).map(b => b.id);

    const saveBtn = document.getElementById('plotter-btn-save');
    if(saveBtn){ saveBtn.disabled = true; saveBtn.textContent = '⏳ Menyimpan...'; }

    let savedCount = 0, deletedCount = 0, errorMsg = '';

    try {
      // Bulk save
      if(toSave.length > 0){
        const res = await global.BM4Api.post('bulkSaveEstateBlok', { data: toSave });
        if(res && res.success){
          savedCount = (res.savedCount != null ? res.savedCount : toSave.length);
        } else {
          errorMsg = (res && (res.error || res.message)) || 'Bulk save gagal';
          throw new Error(errorMsg);
        }
      }

      // Delete satu-satu (deleteEstateBlok endpoint single)
      for(const id of toDelete){
        try {
          const res = await global.BM4Api.post('deleteEstateBlok', { id: id });
          if(res && res.success){ deletedCount++; }
          else { console.warn('[estate-module] delete gagal id=' + id, res); }
        } catch(e){
          console.warn('[estate-module] delete error id=' + id, e);
        }
      }

      // Reset flags & remove deleted
      _blokList = _blokList
        .filter(b => !(b._deleted))
        .map(b => Object.assign({}, b, { _dirty: false, _new: false }));

      if(_siteplanCanvas) _siteplanCanvas.setBlok(_blokList);
      _renderBlokList();
      _updateStatBar();

      const msgParts = [];
      if(savedCount > 0) msgParts.push(savedCount + ' blok tersimpan');
      if(deletedCount > 0) msgParts.push(deletedCount + ' dihapus');
      _toast('✅ ' + msgParts.join(' · '));
    } catch(e){
      console.error('[estate-module] save error:', e);
      _toast('❌ Gagal save: ' + (e.message || e));
    } finally {
      if(saveBtn){ saveBtn.textContent = '💾 Save Semua'; }
      _updateSaveButtonState();
    }
  }

  async function plotterReload(){
    if(_hasUnsavedChanges()){
      const ok = confirm('Ada perubahan yang belum disimpan.\nReload akan membuang perubahan tersebut.\n\nLanjutkan?');
      if(!ok) return;
    }
    _blokList = [];
    await _loadBlokFromServer();
    _toast('🔄 Data blok dimuat ulang');
  }

  function plotterNewVersion(){
    _toast('Versi siteplan baru — fitur ini akan dikerjakan setelah user-base stabil');
    // Sesi B (sederhana): biarkan v1 saja. Versi baru bisa di-handle manual via Sheet.
  }

  // ============================================================
  // MODE & CANVAS HANDLERS
  // ============================================================
  function plotterSetMode(mode, btnEl){
    if(!_siteplanCanvas) return;
    _currentMode = mode;
    _siteplanCanvas.setMode(mode);

    document.querySelectorAll('.plotter-mode').forEach(b => b.classList.remove('active'));
    if(btnEl) btnEl.classList.add('active');

    const hint = document.getElementById('plotter-mode-hint');
    if(hint) hint.innerHTML = _modeHint(mode);

    console.log('[plotter] mode:', mode);
  }

  function _handleCanvasTap(blok, x, y, evt){
    if(_currentMode === 'plot'){
      if(blok){
        // Klik di blok existing → tampilkan info ringan, jangan plot baru
        _toast('Posisi sudah ditempati blok "' + blok.nama + '". Pakai mode Edit untuk ubah.');
        return;
      }
      // Klik area kosong → buka modal plot baru
      _pendingNewPosition = { x: x, y: y };
      _editingBlokId = null;
      _openBlokModal({
        nama: '',
        tipe: 'rumah',
        catatan: '',
        pixelX: x,
        pixelY: y
      }, false);
    } else if(_currentMode === 'edit'){
      if(blok){
        _editingBlokId = blok.id;
        _openBlokModal(blok, true);
      }
    } else if(_currentMode === 'inspect'){
      if(blok){
        if(_siteplanCanvas) _siteplanCanvas.highlight(blok.id);
        _highlightInList(blok.id);
        _scrollListToBlok(blok.id);
      } else {
        if(_siteplanCanvas) _siteplanCanvas.highlight(null);
        _highlightInList(null);
      }
    }
  }

  function _handleCanvasMove(blok, newX, newY){
    // Drag end → update posisi & mark dirty
    const idx = _blokList.findIndex(b => String(b.id) === String(blok.id));
    if(idx < 0) return;

    _blokList[idx].pixelX = newX;
    _blokList[idx].pixelY = newY;
    _blokList[idx]._dirty = true;

    if(_siteplanCanvas) _siteplanCanvas.setBlok(_blokList);
    _renderBlokList();
    _updateStatBar();
  }

  // ============================================================
  // MODAL: PLOT BLOK / EDIT BLOK
  // ============================================================
  function _openBlokModal(blok, isEdit){
    const modal = document.getElementById('plotter-modal');
    if(!modal){
      console.error('[estate-module] modal element tidak ditemukan');
      return;
    }

    document.getElementById('plotter-modal-title').textContent =
      isEdit ? 'Edit Blok' : 'Plot Blok Baru';
    document.getElementById('plotter-modal-pos').textContent =
      'Posisi: (' + Number(blok.pixelX) + ', ' + Number(blok.pixelY) + ')';

    document.getElementById('plotter-modal-nama').value = blok.nama || '';
    document.getElementById('plotter-modal-tipe').value = blok.tipe || 'rumah';
    document.getElementById('plotter-modal-catatan').value = blok.catatan || '';

    // Tombol Hapus hanya muncul di mode edit (blok existing)
    const delBtn = document.getElementById('plotter-modal-delete');
    if(delBtn){
      delBtn.style.display = isEdit ? '' : 'none';
    }

    // Tombol Save & Continue hanya muncul di mode plot baru
    const saveContBtn = document.getElementById('plotter-modal-save-continue');
    if(saveContBtn){
      saveContBtn.style.display = isEdit ? 'none' : '';
    }

    modal.style.display = 'flex';
    setTimeout(() => {
      const namaInput = document.getElementById('plotter-modal-nama');
      if(namaInput) namaInput.focus();
    }, 50);
  }

  function plotterModalCancel(){
    const modal = document.getElementById('plotter-modal');
    if(modal) modal.style.display = 'none';
    _editingBlokId = null;
    _pendingNewPosition = null;
  }

  function plotterModalSave(continuePlot){
    const nama = (document.getElementById('plotter-modal-nama').value || '').trim();
    const tipe = document.getElementById('plotter-modal-tipe').value || 'rumah';
    const catatan = (document.getElementById('plotter-modal-catatan').value || '').trim();

    if(!nama){
      _toast('Nama blok tidak boleh kosong');
      const namaInput = document.getElementById('plotter-modal-nama');
      if(namaInput) namaInput.focus();
      return;
    }

    if(_editingBlokId){
      // EDIT existing
      const idx = _blokList.findIndex(b => String(b.id) === String(_editingBlokId));
      if(idx < 0){ _toast('Blok tidak ditemukan'); return; }
      _blokList[idx].nama = nama;
      _blokList[idx].tipe = tipe;
      _blokList[idx].catatan = catatan;
      _blokList[idx]._dirty = true;
    } else {
      // PLOT BARU
      if(!_pendingNewPosition){ _toast('Posisi tidak ditemukan'); return; }
      const proyekId = _getProyekId();
      const newBlok = {
        id: 'blk_' + _genId(),
        nama: nama,
        tipe: tipe,
        proyekId: proyekId,
        siteplanVersion: _currentVersion,
        pixelX: _pendingNewPosition.x,
        pixelY: _pendingNewPosition.y,
        pixelW: 0,
        pixelH: 0,
        aktif: true,
        catatan: catatan,
        _dirty: true,
        _new: true,
        _deleted: false
      };
      _blokList.push(newBlok);
    }

    if(_siteplanCanvas) _siteplanCanvas.setBlok(_blokList);
    _renderBlokList();
    _updateStatBar();

    // Close atau continue
    if(continuePlot && !_editingBlokId){
      // Reset form, keep modal open in plot-baru mode? Tidak — kita close modal,
      // user klik lagi di canvas untuk plot baru. Konsisten dengan UX.
      plotterModalCancel();
      _toast('✓ "' + nama + '" ditambahkan. Klik area lain untuk plot blok berikutnya.');
    } else {
      plotterModalCancel();
      _toast('✓ "' + nama + '" tersimpan ke draft. Klik "Save Semua" untuk sync ke server.');
    }
  }

  function plotterModalDelete(){
    if(!_editingBlokId) return;
    const blok = _blokList.find(b => String(b.id) === String(_editingBlokId));
    if(!blok) return;

    const ok = confirm('Hapus blok "' + blok.nama + '"?\n\nKlik OK lalu Save Semua untuk konfirmasi.');
    if(!ok) return;

    if(blok._new){
      // Belum pernah disimpan ke server → langsung remove dari list
      _blokList = _blokList.filter(b => String(b.id) !== String(_editingBlokId));
    } else {
      // Mark deleted, akan di-sync via deleteEstateBlok saat Save Semua
      blok._deleted = true;
      blok._dirty = true;
    }

    if(_siteplanCanvas) _siteplanCanvas.setBlok(_blokList.filter(b => !b._deleted));
    _renderBlokList();
    _updateStatBar();
    plotterModalCancel();
    _toast('🗑️ Blok ditandai untuk dihapus. Klik "Save Semua" untuk konfirmasi.');
  }

  // ============================================================
  // SIDEBAR LIST
  // ============================================================
  function _renderBlokList(){
    const listEl = document.getElementById('plotter-list');
    const countEl = document.getElementById('plotter-sidebar-count');
    if(!listEl) return;

    const visible = _blokList.filter(b => !b._deleted);

    if(countEl) countEl.textContent = visible.length;

    if(visible.length === 0){
      listEl.innerHTML = '<div class="plotter-list-empty">Belum ada blok tersimpan</div>';
      return;
    }

    const q = _searchQuery.toLowerCase();
    const filtered = q ? visible.filter(b =>
      String(b.nama || '').toLowerCase().includes(q) ||
      String(b.tipe || '').toLowerCase().includes(q)
    ) : visible;

    if(filtered.length === 0){
      listEl.innerHTML = '<div class="plotter-list-empty">Tidak ada hasil untuk "' +
        _escape(_searchQuery) + '"</div>';
      return;
    }

    // Sort: dirty di atas, lalu alfabetis
    filtered.sort((a, b) => {
      const da = (a._dirty || a._new) ? 0 : 1;
      const db = (b._dirty || b._new) ? 0 : 1;
      if(da !== db) return da - db;
      return String(a.nama || '').localeCompare(String(b.nama || ''));
    });

    const colors = global.SITEPLAN_TIPE_COLORS || {};
    listEl.innerHTML = filtered.map(b => {
      const color = colors[String(b.tipe || 'rumah').toLowerCase()] || '#9B9A96';
      const dirtyBadge = (b._dirty || b._new)
        ? '<span class="plotter-list-item-dirty" title="Belum disimpan">●</span>'
        : '';
      const idAttr = _escape(b.id);
      const safeName = _escape(b.nama || '—');
      const safeTipe = _escape((b.tipe || 'rumah').toUpperCase());
      return (
        '<div class="plotter-list-item" data-blok-id="' + idAttr + '" ' +
          'onclick="EstateModule._listClick(\'' + idAttr + '\')">' +
          '<div class="plotter-list-item-dot" style="background:' + color + ';"></div>' +
          '<div class="plotter-list-item-name">' + safeName + ' ' + dirtyBadge + '</div>' +
          '<div class="plotter-list-item-tipe">' + safeTipe + '</div>' +
          '<div class="plotter-list-item-actions">' +
            '<button class="plotter-list-item-btn" title="Edit" ' +
              'onclick="event.stopPropagation();EstateModule._listEdit(\'' + idAttr + '\')">✏️</button>' +
            '<button class="plotter-list-item-btn" title="Hapus" ' +
              'onclick="event.stopPropagation();EstateModule._listDelete(\'' + idAttr + '\')">🗑️</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function _listClick(id){
    if(_siteplanCanvas) _siteplanCanvas.highlight(id);
    _highlightInList(id);
  }

  function _listEdit(id){
    const blok = _blokList.find(b => String(b.id) === String(id));
    if(!blok) return;
    _editingBlokId = id;
    _openBlokModal(blok, true);
  }

  function _listDelete(id){
    const blok = _blokList.find(b => String(b.id) === String(id));
    if(!blok) return;
    const ok = confirm('Hapus blok "' + blok.nama + '"?\n\nKlik OK lalu Save Semua untuk konfirmasi.');
    if(!ok) return;

    if(blok._new){
      _blokList = _blokList.filter(b => String(b.id) !== String(id));
    } else {
      blok._deleted = true;
      blok._dirty = true;
    }

    if(_siteplanCanvas) _siteplanCanvas.setBlok(_blokList.filter(b => !b._deleted));
    _renderBlokList();
    _updateStatBar();
  }

  function _highlightInList(id){
    document.querySelectorAll('.plotter-list-item').forEach(el => {
      el.classList.toggle('highlighted', el.getAttribute('data-blok-id') === String(id));
    });
  }

  function _scrollListToBlok(id){
    const el = document.querySelector('.plotter-list-item[data-blok-id="' + String(id).replace(/"/g, '\\"') + '"]');
    if(el && el.scrollIntoView){
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function plotterSearch(query){
    _searchQuery = String(query || '');
    _renderBlokList();
  }

  // ============================================================
  // STAT BAR & SAVE BUTTON STATE
  // ============================================================
  function _updateStatBar(){
    const visible = _blokList.filter(b => !b._deleted);
    const dirty = _blokList.filter(b => b._dirty || b._new || b._deleted);
    const dirtyDeleted = _blokList.filter(b => b._deleted);

    const savedEl = document.getElementById('plotter-stat-saved');
    const unsavedEl = document.getElementById('plotter-stat-unsaved');

    if(savedEl) savedEl.textContent = visible.length + ' blok tersimpan';

    if(unsavedEl){
      const unsavedCount = dirty.length;
      if(unsavedCount > 0){
        let txt = unsavedCount + ' belum disimpan';
        if(dirtyDeleted.length > 0){
          txt += ' (' + dirtyDeleted.length + ' akan dihapus)';
        }
        unsavedEl.textContent = txt;
        unsavedEl.style.display = '';
      } else {
        unsavedEl.style.display = 'none';
      }
    }

    _updateSaveButtonState();
  }

  function _setStat(text){
    const savedEl = document.getElementById('plotter-stat-saved');
    if(savedEl) savedEl.textContent = text;
  }

  function _updateSaveButtonState(){
    const saveBtn = document.getElementById('plotter-btn-save');
    if(!saveBtn) return;
    saveBtn.disabled = !_hasUnsavedChanges();
  }

  function _hasUnsavedChanges(){
    return _blokList.some(b => b._dirty || b._new || b._deleted);
  }

  // ============================================================
  // HELPERS
  // ============================================================
  function _getSiteplanUrlForProyek(proyekId){
    // 1. Cek di PROYEK_LIST kalau ada field siteplanUrl (dari Sheet)
    //    Note: PROYEK_LIST adalah `let` di top-level, perlu scope chain access
    try {
      let list = [];
      try {
        if(typeof PROYEK_LIST !== 'undefined' && Array.isArray(PROYEK_LIST)){
          list = PROYEK_LIST;
        } else if(Array.isArray(global.PROYEK_LIST)){
          list = global.PROYEK_LIST;
        }
      } catch(_){}
      const p = list.find(x => String(x.id || '').toLowerCase() === String(proyekId).toLowerCase());
      if(p && p.siteplanUrl) return p.siteplanUrl;
    } catch(_){}

    // 2. Convention fallback: assets/{id}_siteplan.png — sesuai struktur saat ini
    //    File yang sudah ada di repo berada di /assets/gwc_siteplan.png langsung.
    return 'assets/' + String(proyekId).toLowerCase() + '_siteplan.png';
  }

  function _updateProyekInfo(){
    const el = document.getElementById('estate-info-proyek');
    if(!el) return;
    try {
      const proyekId = _getProyekId();
      // PROYEK_LIST juga `let` di top-level — pakai scope chain access
      let list = [];
      try {
        if(typeof PROYEK_LIST !== 'undefined' && Array.isArray(PROYEK_LIST)){
          list = PROYEK_LIST;
        } else if(Array.isArray(global.PROYEK_LIST)){
          list = global.PROYEK_LIST;
        }
      } catch(_){}
      const p = list.find(x => String(x.id || '').toLowerCase() === String(proyekId || '').toLowerCase());
      el.textContent = p ? (p.nama || proyekId) : (proyekId || '—');
    } catch(e){
      el.textContent = _getProyekId() || '—';
    }
  }

  function _ensureMobilePermissionsCache(){
    if(global.__mobilePermissionsCache && Array.isArray(global.__mobilePermissionsCache)) return;
    if(!global.BM4Api || typeof global.BM4Api.get !== 'function') return;

    global.BM4Api.get('getMobilePermissions').then(res => {
      if(res && res.success && Array.isArray(res.data)){
        global.__mobilePermissionsCache = res.data;
        console.log('[estate-module] mobile permissions cached:', res.data.length, 'rows');
      }
    }).catch(e => {
      console.warn('[estate-module] gagal fetch mobile permissions:', e);
    });
  }

  function _genId(){
    return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function _toast(msg){
    if(typeof global.showToast === 'function'){
      global.showToast(msg);
    } else if(typeof global.toast === 'function'){
      global.toast(msg);
    } else {
      console.log('[toast]', msg);
    }
  }

  function _escape(s){
    return String(s||'').replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
    );
  }

  // ============================================================
  // ZOOM HANDLERS (Sesi B-rev2)
  // ============================================================
  function plotterZoomIn(){
    if(_siteplanCanvas) _siteplanCanvas.zoomIn();
  }

  function plotterZoomOut(){
    if(_siteplanCanvas) _siteplanCanvas.zoomOut();
  }

  function plotterZoomReset(){
    if(_siteplanCanvas) _siteplanCanvas.zoomReset();
  }

  // ============================================================
  // EXPOSE
  // ============================================================
  global.initEstateModule = initEstateModule;
  global.switchEstateSection = switchEstateSection;
  global.plotterSetMode = plotterSetMode;
  global.plotterSaveAll = plotterSaveAll;
  global.plotterReload = plotterReload;
  global.plotterNewVersion = plotterNewVersion;
  global.plotterModalCancel = plotterModalCancel;
  global.plotterModalSave = plotterModalSave;
  global.plotterModalDelete = plotterModalDelete;
  global.plotterSearch = plotterSearch;
  global.plotterZoomIn = plotterZoomIn;
  global.plotterZoomOut = plotterZoomOut;
  global.plotterZoomReset = plotterZoomReset;

  // Internal namespace untuk inline onclick di list
  global.EstateModule = {
    _listClick: _listClick,
    _listEdit: _listEdit,
    _listDelete: _listDelete
  };

  console.log('[estate-module] script loaded (Sesi B-rev2: zoom + pan + minimap)');
})(typeof window !== 'undefined' ? window : this);
