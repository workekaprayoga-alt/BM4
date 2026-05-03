/**
 * BM4 Patch 010 — Estate Setup Prioritas (Sub-2 UI Sesi A)
 *
 * Menambah sub-tab "⭐ Setup Prioritas" di Estate Management.
 * Mode khusus untuk menandai blok mana yang dianggap area prioritas
 * (pos satpam, taman, bunderan, jalan utama, sarana ibadah, dll).
 *
 * Workflow:
 *   1. User buka tab "Setup Prioritas"
 *   2. Lihat siteplan dengan SEMUA blok visible
 *      - Blok prioritas: kuning ⭐
 *      - Blok biasa: abu-abu
 *   3. Klik blok di canvas → toggle prioritas (auto dirty)
 *   4. Optional: edit catatan prioritas via modal
 *   5. Klik "Save Semua" → bulk save via existing endpoint
 *
 * Dependency:
 *   - SiteplanCanvas (180-siteplan-canvas.js)
 *   - BM4Api.get/post (11-api-layer.js)
 *   - estate-module (181-estate-module.js) — kita inject sub-tab + section setelah init
 *
 * Backend yang dipakai:
 *   - getEstateBlok    — load all blok per proyek
 *   - bulkSaveEstateBlok — save with isPrioritas + prioritasNote update
 *
 * Self-init: patch ini auto-jalan saat DOMContentLoaded.
 */
(function(global){
  'use strict';

  // ============================================================
  // STATE
  // ============================================================
  let _inited = false;
  let _canvas = null;
  let _blokList = [];          // Semua blok di proyek
  let _dirtyIds = new Set();   // ID blok yang sudah di-toggle (perlu save)
  let _searchQuery = '';
  let _editingNoteBlokId = null;
  let _proyekId = null;

  const TAB_KEY = 'prioritas';

  // ============================================================
  // INJECTION: tambah sub-tab + section ke DOM existing
  // ============================================================
  function _injectMarkup(){
    // 1. Cari sub-nav estate
    const subnav = document.querySelector('.estate-subnav');
    if(!subnav){
      console.warn('[patch-010] .estate-subnav tidak ditemukan, skip inject');
      return false;
    }

    // 2. Cek apakah tab udah ada (idempotent)
    if(subnav.querySelector('[data-section="' + TAB_KEY + '"]')){
      return true;
    }

    // 3. Buat tombol tab
    const tabBtn = document.createElement('button');
    tabBtn.className = 'estate-subtab';
    tabBtn.setAttribute('data-section', TAB_KEY);
    tabBtn.innerHTML = '⭐ Setup Prioritas';
    tabBtn.onclick = function(){ _switchTo(this); };

    // 4. Insert sebelum spacer
    const spacer = subnav.querySelector('.estate-subnav-spacer');
    if(spacer){
      subnav.insertBefore(tabBtn, spacer);
    } else {
      subnav.appendChild(tabBtn);
    }

    // 5. Buat section panel
    const pane = document.getElementById('pane-estate');
    if(!pane){
      console.warn('[patch-010] #pane-estate tidak ditemukan');
      return false;
    }

    if(document.getElementById('estate-section-' + TAB_KEY)){
      return true;
    }

    const section = document.createElement('div');
    section.className = 'estate-section';
    section.id = 'estate-section-' + TAB_KEY;
    section.innerHTML = _buildSectionHTML();
    pane.appendChild(section);

    return true;
  }

  function _buildSectionHTML(){
    return '' +
      '<div class="prio-wrap">' +
      '  <div class="prio-toolbar">' +
      '    <div class="prio-toolbar-left">' +
      '      <span class="prio-hint">Klik blok di siteplan untuk menandai sebagai <strong>area prioritas</strong> (gate, taman, pos satpam, jalan utama, dll).</span>' +
      '    </div>' +
      '    <div class="prio-toolbar-right">' +
      '      <span class="prio-stat" id="prio-stat-count">0 prioritas</span>' +
      '      <span class="prio-stat warn" id="prio-stat-unsaved" style="display:none;">0 belum disimpan</span>' +
      '      <button class="prio-btn" id="prio-btn-save" disabled>💾 Save Semua</button>' +
      '      <button class="prio-btn-secondary" id="prio-btn-reload">🔄 Reload</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="prio-legend">' +
      '    <span class="prio-legend-item"><span class="prio-dot kuning"></span> Prioritas (akan dicek harian)</span>' +
      '    <span class="prio-legend-item"><span class="prio-dot abu"></span> Blok biasa</span>' +
      '  </div>' +
      '  <div class="prio-main">' +
      '    <div class="prio-canvas-area">' +
      '      <div class="prio-canvas-empty" id="prio-canvas-empty">' +
      '        <div class="prio-empty-icon">🏘️</div>' +
      '        <div class="prio-empty-title">Pilih proyek dulu</div>' +
      '        <div class="prio-empty-sub">Setup prioritas akan aktif setelah proyek dipilih.</div>' +
      '      </div>' +
      '      <div class="prio-canvas-container" id="prio-canvas-container" style="display:none;"></div>' +
      '    </div>' +
      '    <aside class="prio-sidebar">' +
      '      <div class="prio-sidebar-head">' +
      '        <input type="text" id="prio-search" class="prio-search" placeholder="🔍 Cari nama blok...">' +
      '      </div>' +
      '      <div class="prio-sidebar-list" id="prio-list">' +
      '        <div class="prio-list-empty">Belum ada data</div>' +
      '      </div>' +
      '    </aside>' +
      '  </div>' +
      '</div>' +
      // Modal note
      '<div class="prio-modal-overlay" id="prio-note-modal">' +
      '  <div class="prio-modal" role="dialog">' +
      '    <div class="prio-modal-head">' +
      '      <div class="prio-modal-title">Catatan Prioritas</div>' +
      '      <div class="prio-modal-sub" id="prio-note-blok-name">—</div>' +
      '    </div>' +
      '    <div class="prio-modal-body">' +
      '      <label class="prio-form-label">Kenapa blok ini prioritas? <small>(opsional)</small></label>' +
      '      <textarea id="prio-note-text" rows="3" maxlength="200" placeholder="Misal: gate utama, akses keluar masuk, ramai pengunjung..."></textarea>' +
      '    </div>' +
      '    <div class="prio-modal-foot">' +
      '      <button class="prio-btn-secondary" id="prio-note-cancel">Batal</button>' +
      '      <button class="prio-btn" id="prio-note-save">Simpan Catatan</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  // ============================================================
  // TAB SWITCHING (intercept switchEstateSection)
  // ============================================================
  function _switchTo(btnEl){
    document.querySelectorAll('.estate-subtab').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');

    document.querySelectorAll('.estate-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('estate-section-' + TAB_KEY);
    if(target) target.classList.add('active');

    _initSection();
  }

  // ============================================================
  // SECTION INIT — setup canvas saat user pertama buka tab
  // ============================================================
  function _initSection(){
    const proyekId = _getProyekId();
    if(!proyekId){
      _showEmpty();
      return;
    }

    // Bind controls (idempotent — pakai data attribute biar gak double bind)
    _bindControls();

    // Re-init kalau ganti proyek
    if(_proyekId !== proyekId){
      _proyekId = proyekId;
      _loadBlokData();
    } else if(_canvas) {
      // sudah ter-init, tinggal render ulang
      _canvas.render();
    } else {
      _loadBlokData();
    }
  }

  function _showEmpty(){
    const empty = document.getElementById('prio-canvas-empty');
    const container = document.getElementById('prio-canvas-container');
    if(empty) empty.style.display = '';
    if(container) container.style.display = 'none';
  }

  function _hideEmpty(){
    const empty = document.getElementById('prio-canvas-empty');
    const container = document.getElementById('prio-canvas-container');
    if(empty) empty.style.display = 'none';
    if(container) container.style.display = '';
  }

  function _bindControls(){
    const saveBtn = document.getElementById('prio-btn-save');
    if(saveBtn && !saveBtn.dataset.bound){
      saveBtn.dataset.bound = '1';
      saveBtn.onclick = _saveAll;
    }
    const reloadBtn = document.getElementById('prio-btn-reload');
    if(reloadBtn && !reloadBtn.dataset.bound){
      reloadBtn.dataset.bound = '1';
      reloadBtn.onclick = _reload;
    }
    const searchEl = document.getElementById('prio-search');
    if(searchEl && !searchEl.dataset.bound){
      searchEl.dataset.bound = '1';
      searchEl.oninput = function(){ _searchQuery = this.value; _renderList(); };
    }
    // Modal note
    const cancelBtn = document.getElementById('prio-note-cancel');
    if(cancelBtn && !cancelBtn.dataset.bound){
      cancelBtn.dataset.bound = '1';
      cancelBtn.onclick = _closeNoteModal;
    }
    const saveNoteBtn = document.getElementById('prio-note-save');
    if(saveNoteBtn && !saveNoteBtn.dataset.bound){
      saveNoteBtn.dataset.bound = '1';
      saveNoteBtn.onclick = _saveNote;
    }
  }

  // ============================================================
  // DATA LOAD/SAVE
  // ============================================================
  async function _loadBlokData(){
    if(!global.BM4Api || typeof global.BM4Api.get !== 'function'){
      _toast('⚠️ BM4Api tidak tersedia');
      return;
    }
    try {
      const res = await global.BM4Api.get('getEstateBlok', {
        proyekId: _proyekId,
        aktifOnly: true
      });
      if(res && res.success){
        _blokList = (res.data || []).map(b => Object.assign({}, b, { _dirty: false }));
        _dirtyIds.clear();
        _updateUnsavedBadge();
        _initCanvas();
        _renderList();
        _updateCount();
      } else {
        _toast('⚠️ Gagal load blok: ' + (res && res.error || 'unknown'));
      }
    } catch(e){
      console.error('[patch-010] load error', e);
      _toast('⚠️ Error load: ' + (e.message || e));
    }
  }

  function _initCanvas(){
    const container = document.getElementById('prio-canvas-container');
    if(!container){
      console.warn('[patch-010] container tidak ditemukan');
      return;
    }
    _hideEmpty();

    const siteplanUrl = _getSiteplanUrl(_proyekId);

    if(_canvas){
      // Re-init dengan data baru
      _canvas.setBlok(_blokList);
      _canvas.render();
      return;
    }

    if(!global.SiteplanCanvas){
      _toast('⚠️ SiteplanCanvas belum dimuat');
      return;
    }

    _canvas = new global.SiteplanCanvas(container, {
      imageUrl: siteplanUrl,
      mode: 'inspect',
      blokList: _blokList,
      colorFn: (blok) => blok && blok.isPrioritas ? '#F59E0B' : '#94A3B8',
      onTap: (blok) => {
        if(blok) _toggleBlok(blok.id);
      }
    });
    _canvas.render();
  }

  function _toggleBlok(blokId){
    const idx = _blokList.findIndex(b => String(b.id) === String(blokId));
    if(idx < 0) return;
    _blokList[idx].isPrioritas = !_blokList[idx].isPrioritas;
    if(!_blokList[idx].isPrioritas){
      _blokList[idx].prioritasNote = '';
    }
    _blokList[idx]._dirty = true;
    _dirtyIds.add(blokId);

    if(_canvas){
      _canvas.setBlok(_blokList);
      _canvas.render();
    }
    _updateUnsavedBadge();
    _updateCount();
    _renderList();
  }

  async function _saveAll(){
    if(_dirtyIds.size === 0){
      _toast('Tidak ada perubahan untuk disimpan');
      return;
    }
    const dirty = _blokList.filter(b => _dirtyIds.has(b.id));
    const payload = {
      blok: dirty.map(b => ({
        id: b.id,
        nama: b.nama,
        tipe: b.tipe,
        proyekId: b.proyekId,
        siteplanVersion: b.siteplanVersion,
        pixelX: b.pixelX,
        pixelY: b.pixelY,
        pixelW: b.pixelW,
        pixelH: b.pixelH,
        aktif: b.aktif,
        isPrioritas: !!b.isPrioritas,
        prioritasNote: b.prioritasNote || ''
      }))
    };

    const saveBtn = document.getElementById('prio-btn-save');
    if(saveBtn){ saveBtn.disabled = true; saveBtn.innerHTML = '⏳ Menyimpan...'; }

    try {
      const res = await global.BM4Api.post('bulkSaveEstateBlok', payload);
      if(res && res.success){
        const ok = res.okSave || 0;
        const fail = res.failSave || 0;
        if(fail === 0){
          _toast('✅ ' + ok + ' blok tersimpan');
          _dirtyIds.clear();
          _blokList.forEach(b => b._dirty = false);
          _updateUnsavedBadge();
          _renderList();
        } else {
          _toast('⚠️ ' + ok + ' tersimpan, ' + fail + ' gagal');
        }
      } else {
        _toast('⚠️ Save gagal: ' + (res && res.error || 'unknown'));
      }
    } catch(e){
      console.error('[patch-010] save error', e);
      _toast('⚠️ Error save: ' + (e.message || e));
    } finally {
      if(saveBtn){ saveBtn.disabled = _dirtyIds.size === 0; saveBtn.innerHTML = '💾 Save Semua'; }
    }
  }

  function _reload(){
    if(_dirtyIds.size > 0){
      if(!confirm('Ada ' + _dirtyIds.size + ' perubahan belum disimpan. Yakin reload? Perubahan akan hilang.')) return;
    }
    _loadBlokData();
  }

  // ============================================================
  // SIDEBAR LIST
  // ============================================================
  function _renderList(){
    const listEl = document.getElementById('prio-list');
    if(!listEl) return;

    let items = _blokList.filter(b => b.isPrioritas);
    if(_searchQuery){
      const q = _searchQuery.toLowerCase();
      items = items.filter(b => String(b.nama || '').toLowerCase().includes(q));
    }

    if(items.length === 0){
      listEl.innerHTML = '<div class="prio-list-empty">' +
        (_searchQuery ? 'Tidak ada hasil pencarian.' : 'Belum ada blok prioritas.<br><small>Klik blok di siteplan untuk menandai.</small>') +
        '</div>';
      return;
    }

    items.sort((a,b) => String(a.nama).localeCompare(String(b.nama), undefined, {numeric:true}));

    listEl.innerHTML = items.map(b => {
      const dirtyMark = _dirtyIds.has(b.id) ? '<span class="prio-list-dirty" title="Belum disimpan">●</span>' : '';
      const noteText = b.prioritasNote ? '<div class="prio-list-note">📝 ' + _escape(b.prioritasNote) + '</div>' : '';
      const tipeLabel = (b.tipe || 'rumah').toUpperCase();
      return '<div class="prio-list-item" data-id="' + _escape(b.id) + '">' +
        '<div class="prio-list-row">' +
        '  <span class="prio-list-name">⭐ ' + _escape(b.nama) + ' ' + dirtyMark + '</span>' +
        '  <span class="prio-list-tipe">' + _escape(tipeLabel) + '</span>' +
        '</div>' +
        noteText +
        '<div class="prio-list-actions">' +
        '  <button class="prio-list-btn" data-act="focus" title="Focus di siteplan">🎯</button>' +
        '  <button class="prio-list-btn" data-act="note" title="Edit catatan">📝</button>' +
        '  <button class="prio-list-btn danger" data-act="untag" title="Hapus prioritas">✕</button>' +
        '</div>' +
        '</div>';
    }).join('');

    // Bind action buttons
    listEl.querySelectorAll('.prio-list-btn').forEach(btn => {
      btn.onclick = function(e){
        e.stopPropagation();
        const item = this.closest('.prio-list-item');
        const id = item && item.dataset.id;
        const act = this.dataset.act;
        if(!id) return;
        if(act === 'focus') _focusBlok(id);
        else if(act === 'note') _openNoteModal(id);
        else if(act === 'untag') _toggleBlok(id);
      };
    });
  }

  function _updateCount(){
    const el = document.getElementById('prio-stat-count');
    if(!el) return;
    const count = _blokList.filter(b => b.isPrioritas).length;
    el.textContent = count + ' prioritas';
  }

  function _updateUnsavedBadge(){
    const el = document.getElementById('prio-stat-unsaved');
    const saveBtn = document.getElementById('prio-btn-save');
    if(!el) return;
    if(_dirtyIds.size > 0){
      el.style.display = '';
      el.textContent = _dirtyIds.size + ' belum disimpan';
      if(saveBtn) saveBtn.disabled = false;
    } else {
      el.style.display = 'none';
      if(saveBtn) saveBtn.disabled = true;
    }
  }

  function _focusBlok(blokId){
    if(!_canvas) return;
    const b = _blokList.find(x => String(x.id) === String(blokId));
    if(!b || b.pixelX == null || b.pixelY == null) return;
    if(typeof _canvas.highlightId !== 'undefined'){
      _canvas.highlightId = blokId;
    }
    _canvas.render();
    setTimeout(() => {
      if(_canvas){ _canvas.highlightId = null; _canvas.render(); }
    }, 2500);
  }

  // ============================================================
  // MODAL NOTE
  // ============================================================
  function _openNoteModal(blokId){
    const b = _blokList.find(x => String(x.id) === String(blokId));
    if(!b) return;
    _editingNoteBlokId = blokId;

    const nameEl = document.getElementById('prio-note-blok-name');
    const textEl = document.getElementById('prio-note-text');
    const overlay = document.getElementById('prio-note-modal');
    if(nameEl) nameEl.textContent = '⭐ ' + b.nama;
    if(textEl) textEl.value = b.prioritasNote || '';
    if(overlay) overlay.classList.add('open');
    if(textEl) setTimeout(() => textEl.focus(), 100);
  }

  function _closeNoteModal(){
    _editingNoteBlokId = null;
    const overlay = document.getElementById('prio-note-modal');
    if(overlay) overlay.classList.remove('open');
  }

  function _saveNote(){
    if(!_editingNoteBlokId) return;
    const idx = _blokList.findIndex(b => String(b.id) === String(_editingNoteBlokId));
    if(idx < 0) return;
    const textEl = document.getElementById('prio-note-text');
    const newNote = textEl ? String(textEl.value || '').trim() : '';
    if(_blokList[idx].prioritasNote !== newNote){
      _blokList[idx].prioritasNote = newNote;
      _blokList[idx]._dirty = true;
      _dirtyIds.add(_editingNoteBlokId);
      _updateUnsavedBadge();
      _renderList();
    }
    _closeNoteModal();
  }

  // ============================================================
  // HELPERS
  // ============================================================
  // ============================================================
  // PROYEK ID HELPER — multi-source fallback
  // FIX rc18.1: di kode existing `let currentProyek = null` adalah top-level
  // closure variable, BUKAN di window. `window.currentProyek` SELALU undefined.
  // Solusi: pakai sumber yang reliable cross-IIFE = localStorage app state.
  // Pattern ini disalin dari _getProyekId() di 181-estate-module.js.
  // ============================================================
  function _getProyekId(){
    // 1. Coba scope chain (currentProyek tanpa window.) — patch ini IIFE
    //    sendiri jadi belum tentu work, tapi murah dicoba.
    try {
      if(typeof currentProyek !== 'undefined' && currentProyek){
        return String(currentProyek);
      }
    } catch(_){}

    // 2. Fallback paling reliable: localStorage app state.
    //    `bm4_app_state` di-update terus oleh saveAppState() tiap user
    //    pilih proyek / pindah tab. state.proyek = string id proyek.
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
        // Bisa string atau object — handle dua-duanya
        if(typeof global.currentProyek === 'string') return global.currentProyek;
        if(global.currentProyek.id) return String(global.currentProyek.id);
      }
    } catch(_){}

    return null;
  }

  // ============================================================
  // SITEPLAN URL — convention based, sama dengan estate-module
  // FIX rc18.1: tidak lagi pakai global._estateGetSiteplanUrl
  // (estate-module tidak expose function tsb). Pakai convention
  // assets/{id}_siteplan.png seperti di _getSiteplanUrlForProyek().
  // ============================================================
  function _getSiteplanUrl(proyekId){
    if(!proyekId) return 'assets/gwc_siteplan.png';

    // 1. Cek PROYEK_LIST kalau ada (scope chain — let di top-level)
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

    // 2. Convention fallback: assets/{id}_siteplan.png
    return 'assets/' + String(proyekId).toLowerCase() + '_siteplan.png';
  }

  function _toast(msg){
    if(typeof global.showToast === 'function'){
      global.showToast(msg);
    } else {
      console.log('[patch-010]', msg);
    }
  }

  function _escape(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ============================================================
  // INIT — auto-run saat estate module siap
  // ============================================================
  function _tryInit(){
    if(_inited) return;
    if(!document.querySelector('.estate-subnav')) return; // tunggu DOM siap
    _inited = _injectMarkup();
    if(_inited){
      console.log('[patch-010] Setup Prioritas tab injected');
    }
  }

  // Beforeunload guard
  window.addEventListener('beforeunload', function(e){
    if(_dirtyIds.size > 0){
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  // Expose untuk debugging
  global.EstatePrioritas = {
    _state: () => ({ blokList: _blokList, dirtyIds: Array.from(_dirtyIds), proyekId: _proyekId }),
    _reload: _loadBlokData,
    _injectMarkup: _injectMarkup
  };

  // Auto-init
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _tryInit);
  } else {
    _tryInit();
  }
  // Re-try setelah delay (kalau estate module belum keload)
  setTimeout(_tryInit, 500);
  setTimeout(_tryInit, 1500);

  console.log('[patch-010] estate-prioritas loaded');
})(typeof window !== 'undefined' ? window : this);
