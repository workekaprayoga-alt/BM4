/**
 * Estate Module — Desktop UI handler
 *
 * Sesi A: SKELETON
 *   - initEstateModule() dipanggil saat user klik tab Estate
 *   - switchEstateSection() untuk pindah antar sub-menu
 *   - Update info bar (proyek aktif)
 *   - Cache mobile permissions untuk visibility check
 *   - Plotter SiteplanCanvas init (placeholder, belum interaktif)
 *
 * Sesi B akan tambah:
 *   - Plot mode: tap → form mini → save ke EstateBlok
 *   - Edit mode: drag pin
 *   - Bulk save via bulkSaveEstateBlok API
 *   - List sidebar dengan search & edit/hapus
 *   - Versi siteplan (v1, v2, ...)
 *
 * Dependency: SiteplanCanvas (180-siteplan-canvas.js)
 */
(function(global){
  'use strict';

  let _estateInited = false;
  let _siteplanCanvas = null;
  let _currentSection = 'siteplan';
  let _blokList = [];

  /**
   * Dipanggil saat user klik tab "🌿 Estate Management".
   * Aman dipanggil berulang — guard via _estateInited.
   */
  function initEstateModule(){
    console.log('[estate-module] init called, currentProyek:', global.currentProyek);

    // Update info bar proyek
    _updateProyekInfo();

    // Render section yang sedang aktif
    if(_currentSection === 'siteplan'){
      _initSiteplanSection();
    }

    if(_estateInited) return;
    _estateInited = true;

    // Pre-fetch mobile permissions cache (untuk visibility tab Estate buat non-BM)
    _ensureMobilePermissionsCache();
  }

  /**
   * Switch antar sub-menu (siteplan / laporan / statistik).
   * Dipanggil dari onclick di HTML.
   */
  function switchEstateSection(section, btnEl){
    if(!section) return;
    _currentSection = section;

    // Update button state
    document.querySelectorAll('.estate-subtab').forEach(b => b.classList.remove('active'));
    if(btnEl) btnEl.classList.add('active');

    // Update section visibility
    document.querySelectorAll('.estate-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('estate-section-' + section);
    if(target) target.classList.add('active');

    // Section-specific init
    if(section === 'siteplan'){
      _initSiteplanSection();
    } else if(section === 'laporan'){
      // Sesi nanti: load & render laporan
    } else if(section === 'statistik'){
      // Sesi nanti: render charts
    }

    console.log('[estate-module] switched to section:', section);
  }

  /**
   * Init Siteplan section.
   * Sesi A: load siteplan PNG kalau ada di Sheet Proyek, render di SiteplanCanvas.
   * Sesi B: load EstateBlok, enable plot/edit modes.
   */
  function _initSiteplanSection(){
    const proyekId = global.currentProyek;
    if(!proyekId){
      console.warn('[estate-module] currentProyek belum di-set');
      return;
    }

    // Cek apakah proyek punya siteplanUrl (Sesi B akan baca dari Sheet Proyek)
    const siteplanUrl = _getSiteplanUrlForProyek(proyekId);
    const emptyEl = document.getElementById('plotter-canvas-empty');
    const containerEl = document.getElementById('plotter-canvas-container');

    if(!siteplanUrl){
      // Tampilkan empty state
      if(emptyEl) emptyEl.style.display = '';
      if(containerEl) containerEl.style.display = 'none';
      console.log('[estate-module] siteplanUrl belum tersedia untuk proyek:', proyekId);
      return;
    }

    // Init SiteplanCanvas kalau belum
    if(emptyEl) emptyEl.style.display = 'none';
    if(containerEl) containerEl.style.display = '';

    if(!_siteplanCanvas){
      try {
        _siteplanCanvas = new global.SiteplanCanvas(containerEl, {
          imageUrl: siteplanUrl,
          mode: 'inspect',
          blokList: _blokList,
          onTap: (blok, x, y) => {
            console.log('[plotter] tap', { blok, x, y });
            // Sesi B: buka form plot/edit
          }
        });
        _siteplanCanvas.render();
        console.log('[estate-module] SiteplanCanvas initialized');
      } catch(e){
        console.error('[estate-module] gagal init SiteplanCanvas:', e);
        if(emptyEl){
          emptyEl.style.display = '';
          emptyEl.innerHTML = '<div class="plotter-empty-icon">⚠️</div>'
            + '<div class="plotter-empty-title">Gagal memuat SiteplanCanvas</div>'
            + '<div class="plotter-empty-sub">' + _escape(String(e && e.message || e)) + '</div>';
        }
      }
    } else {
      // Update siteplan url kalau ganti proyek
      _siteplanCanvas.setImage(siteplanUrl);
      _siteplanCanvas.setBlok(_blokList);
    }
  }

  /**
   * Cari siteplanUrl untuk proyek aktif.
   * Sesi A: cek di global.PROYEK_LIST atau global.PROYEK kalau ada field siteplanUrl,
   *         atau coba convention /assets/siteplan/{proyekId}_siteplan.png.
   * Sesi B: read dari Sheet Proyek via API kalau ada.
   */
  function _getSiteplanUrlForProyek(proyekId){
    // Cek di state global (kalau Proyek sudah di-load dengan siteplanUrl)
    try {
      const list = global.PROYEK_LIST || [];
      const p = list.find(x => String(x.id || '').toLowerCase() === String(proyekId).toLowerCase());
      if(p && p.siteplanUrl) return p.siteplanUrl;
    } catch(_){}

    // Convention fallback
    const conv = 'assets/siteplan/' + String(proyekId).toLowerCase() + '_siteplan.png';
    // Cek file ada — sederhana: return path saja, image onerror akan handle
    return conv;
  }

  /**
   * Update info bar di sub-nav (nama proyek aktif).
   */
  function _updateProyekInfo(){
    const el = document.getElementById('estate-info-proyek');
    if(!el) return;
    try {
      const proyekId = global.currentProyek;
      const p = (global.PROYEK || {})[proyekId];
      el.textContent = p ? (p.nama || proyekId) : (proyekId || '—');
    } catch(e){
      el.textContent = global.currentProyek || '—';
    }
  }

  /**
   * Pre-fetch mobile permissions untuk cache.
   * Dipakai oleh visibility tab Estate untuk role non-BM.
   */
  function _ensureMobilePermissionsCache(){
    if(global.__mobilePermissionsCache && Array.isArray(global.__mobilePermissionsCache)) return;

    if(typeof global.gasGet !== 'function' && typeof global.gasRequest !== 'function'){
      // API helpers belum tersedia — skip silent
      return;
    }

    const apiCall = typeof global.gasGet === 'function'
      ? global.gasGet({ action: 'getMobilePermissions' })
      : (typeof global.gasRequest === 'function'
          ? global.gasRequest({ action: 'getMobilePermissions' })
          : null);

    if(!apiCall || typeof apiCall.then !== 'function') return;

    apiCall.then(res => {
      if(res && res.success && Array.isArray(res.data)){
        global.__mobilePermissionsCache = res.data;
        console.log('[estate-module] mobile permissions cached:', res.data.length, 'rows');
      }
    }).catch(e => {
      console.warn('[estate-module] gagal fetch mobile permissions:', e);
    });
  }

  /**
   * Plotter actions (Sesi B akan implement).
   * Sesi A: stub yang log doang.
   */
  function plotterSetMode(mode, btnEl){
    if(!_siteplanCanvas) return;
    _siteplanCanvas.setMode(mode);
    document.querySelectorAll('.plotter-mode').forEach(b => b.classList.remove('active'));
    if(btnEl) btnEl.classList.add('active');
    console.log('[plotter] mode:', mode);
  }

  function plotterSaveAll(){
    console.log('[plotter] saveAll called — akan diimplementasikan di Sesi B');
    if(typeof global.toast === 'function'){
      global.toast('Plotter logic akan diaktifkan di Sesi B');
    } else {
      alert('Plotter logic akan diaktifkan di Sesi B');
    }
  }

  function plotterReload(){
    console.log('[plotter] reload called — Sesi B');
  }

  function plotterNewVersion(){
    console.log('[plotter] new version — Sesi B');
  }

  function _escape(s){
    return String(s||'').replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
    );
  }

  // Expose ke global
  global.initEstateModule = initEstateModule;
  global.switchEstateSection = switchEstateSection;
  global.plotterSetMode = plotterSetMode;
  global.plotterSaveAll = plotterSaveAll;
  global.plotterReload = plotterReload;
  global.plotterNewVersion = plotterNewVersion;

  console.log('[estate-module] script loaded');
})(typeof window !== 'undefined' ? window : this);
