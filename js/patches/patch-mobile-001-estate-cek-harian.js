/**
 * BM4 PATCH MOBILE 001 — ESTATE CEK HARIAN (Sub-2)
 *
 * Mobile Refactor — tambah Sub-2 Pengecekan Harian ke mobile-estate.html
 * untuk tim estate lapangan (bukan BM).
 *
 * Approach: NON-INVASIVE. Tidak modify mobile-estate.html core. Hanya:
 *   1. Wrap renderEstateDashboard → inject tab nav (Laporan / Cek Harian)
 *   2. Saat tab "Cek Harian" active → render UI Sub-2
 *   3. Modal cek harian dengan camera-first untuk foto
 *
 * Mobile-first UX:
 *   - Big tap targets (44x44 minimum)
 *   - Camera capture langsung (input type=file accept=image capture=environment)
 *   - 3 status button gede: Bersih / Perhatian / Bermasalah
 *   - Auto-save kalau status "Bersih" (tanpa modal extra)
 *   - Filter visual cepat: belum dicek (kuning) / dicek bersih (hijau) / bermasalah (merah)
 *   - Default tanggal = hari ini
 *
 * Endpoint dipakai (semua existing):
 *   - getEstateBlok (proyekId, prioritasOnly:true) — list blok prioritas
 *   - getEstatePengecekan (proyekId, tanggalCek) — list cek hari ini
 *   - saveEstatePengecekan (single create/update)
 *   - getPengecekanStats (proyekId, tanggal) — counter atas
 *
 * Akses via gasGet/gasRequest yang sudah didefinisikan di mobile-estate.html
 * sebagai top-level function (bukan IIFE), jadi otomatis global.
 *
 * Idempotent — aman di-load berkali-kali.
 */

(function(global){
  'use strict';

  if(global._patchMobile001Loaded) return;
  global._patchMobile001Loaded = true;

  // ============================================================
  // CONST
  // ============================================================
  const STATUS = {
    BERSIH:     { key:'bersih',     label:'Bersih',     icon:'✓', color:'#10B981', bg:'#D1FAE5', fg:'#065F46' },
    PERHATIAN:  { key:'perhatian',  label:'Perhatian',  icon:'⚠', color:'#F59E0B', bg:'#FEF3C7', fg:'#92400E' },
    BERMASALAH: { key:'bermasalah', label:'Bermasalah', icon:'✗', color:'#DC2626', bg:'#FEE2E2', fg:'#991B1B' }
  };

  // ============================================================
  // STATE
  // ============================================================
  let _activeTab = 'laporan';      // laporan | cek
  let _blokPrioritas = [];         // list blok dengan isPrioritas=true
  let _cekHariIni = [];            // list pengecekan untuk tanggal aktif
  let _stats = null;               // dari getPengecekanStats
  let _selectedDate = _toIsoDate(new Date());
  let _filterStatus = 'all';       // all | belum | bersih | perhatian | bermasalah
  let _isLoading = false;
  let _currentBlok = null;         // blok yg lagi di-cek di modal

  // ============================================================
  // INJECT CSS (langsung di-append ke head — biar self-contained)
  // ============================================================
  function _injectCss(){
    if(document.getElementById('patch-mobile-001-css')) return;
    const style = document.createElement('style');
    style.id = 'patch-mobile-001-css';
    style.textContent = _getCss();
    document.head.appendChild(style);
  }

  function _getCss(){
    return `
      /* === Tab Navigation === */
      .pm001-tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        background: var(--bg, #F2F1EE);
        padding: 4px;
        border-radius: 12px;
        margin-bottom: 12px;
        position: sticky;
        top: 0;
        z-index: 5;
      }
      .pm001-tab {
        padding: 11px 12px;
        border: none;
        background: transparent;
        font-size: 13px;
        font-weight: 600;
        color: var(--muted, #64748B);
        cursor: pointer;
        font-family: inherit;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.15s;
      }
      .pm001-tab.active {
        background: #fff;
        color: #1C2B4A;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      }
      .pm001-tab .pm001-tab-badge {
        background: #DC2626;
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 8px;
        min-width: 18px;
        text-align: center;
      }

      /* === Stat header for Cek tab === */
      .pm001-stat-card {
        background: linear-gradient(135deg, #1C2B4A 0%, #0F1A35 100%);
        color: #fff;
        border-radius: 14px;
        padding: 16px 18px;
        margin-bottom: 12px;
      }
      .pm001-stat-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 12px;
      }
      .pm001-stat-title {
        font-size: 12px;
        font-weight: 600;
        opacity: 0.85;
        letter-spacing: 0.4px;
        text-transform: uppercase;
      }
      .pm001-stat-date {
        font-size: 11px;
        opacity: 0.7;
      }
      .pm001-stat-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }
      .pm001-stat-cell {
        text-align: center;
        padding: 6px 4px;
      }
      .pm001-stat-value {
        font-size: 22px;
        font-weight: 800;
        line-height: 1;
        margin-bottom: 4px;
      }
      .pm001-stat-cell.dicek .pm001-stat-value { color: #6EE7B7; }
      .pm001-stat-cell.belum .pm001-stat-value { color: #FDE68A; }
      .pm001-stat-cell.masalah .pm001-stat-value { color: #FCA5A5; }
      .pm001-stat-label {
        font-size: 10px;
        opacity: 0.8;
        letter-spacing: 0.3px;
        text-transform: uppercase;
      }
      .pm001-progress-bar {
        height: 6px;
        background: rgba(255,255,255,0.15);
        border-radius: 3px;
        overflow: hidden;
        margin-top: 10px;
      }
      .pm001-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #10B981 0%, #6EE7B7 100%);
        border-radius: 3px;
        transition: width 0.5s ease-out;
      }

      /* === Date picker === */
      .pm001-date-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      }
      .pm001-date-input {
        flex: 1;
        padding: 10px 12px;
        border: 1px solid var(--border, rgba(0,0,0,0.1));
        border-radius: 10px;
        font-family: inherit;
        font-size: 13px;
        background: #fff;
      }
      .pm001-date-today-btn {
        padding: 10px 14px;
        background: #1C2B4A;
        color: #fff;
        border: none;
        border-radius: 10px;
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
      }

      /* === Filter pills === */
      .pm001-filter-row {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding-bottom: 4px;
        margin-bottom: 10px;
        -webkit-overflow-scrolling: touch;
      }
      .pm001-filter-row::-webkit-scrollbar { display: none; }
      .pm001-filter-pill {
        flex-shrink: 0;
        padding: 7px 14px;
        background: #fff;
        border: 1px solid var(--border, rgba(0,0,0,0.1));
        border-radius: 16px;
        font-size: 12px;
        font-weight: 600;
        color: var(--muted, #64748B);
        font-family: inherit;
        white-space: nowrap;
        cursor: pointer;
      }
      .pm001-filter-pill.active {
        background: #1C2B4A;
        color: #fff;
        border-color: #1C2B4A;
      }
      .pm001-filter-pill[data-filter="bermasalah"].active { background: #DC2626; border-color: #DC2626; }
      .pm001-filter-pill[data-filter="perhatian"].active { background: #F59E0B; border-color: #F59E0B; }
      .pm001-filter-pill[data-filter="bersih"].active { background: #10B981; border-color: #10B981; }

      /* === Blok list === */
      .pm001-blok-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .pm001-blok-item {
        display: flex;
        align-items: center;
        gap: 12px;
        background: #fff;
        border: 1px solid var(--border, rgba(0,0,0,0.06));
        border-left: 4px solid #94A3B8;
        border-radius: 10px;
        padding: 12px 14px;
        cursor: pointer;
        min-height: 60px;
        transition: transform 0.1s;
      }
      .pm001-blok-item:active {
        transform: scale(0.98);
      }
      .pm001-blok-item.s-bersih { border-left-color: #10B981; background: #F0FDF4; }
      .pm001-blok-item.s-perhatian { border-left-color: #F59E0B; background: #FFFBEB; }
      .pm001-blok-item.s-bermasalah { border-left-color: #DC2626; background: #FEF2F2; }
      .pm001-blok-item.s-belum { border-left-color: #94A3B8; }

      .pm001-blok-status-dot {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 700;
        flex-shrink: 0;
        background: #F1F5F9;
        color: #94A3B8;
      }
      .pm001-blok-item.s-bersih .pm001-blok-status-dot { background: #10B981; color: #fff; }
      .pm001-blok-item.s-perhatian .pm001-blok-status-dot { background: #F59E0B; color: #fff; }
      .pm001-blok-item.s-bermasalah .pm001-blok-status-dot { background: #DC2626; color: #fff; }

      .pm001-blok-content { flex: 1; min-width: 0; }
      .pm001-blok-name {
        font-size: 14px;
        font-weight: 700;
        color: var(--text, #1C1C1A);
        margin-bottom: 2px;
        line-height: 1.3;
      }
      .pm001-blok-meta {
        font-size: 11px;
        color: var(--muted, #64748B);
        line-height: 1.4;
      }
      .pm001-blok-tipe-badge {
        display: inline-block;
        padding: 1px 7px;
        background: #EFF6FF;
        color: #1E40AF;
        border-radius: 8px;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        margin-right: 4px;
      }
      .pm001-blok-arrow {
        font-size: 18px;
        color: var(--muted, #64748B);
        flex-shrink: 0;
      }

      /* === Cek Modal === */
      .pm001-cek-modal {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(15, 26, 53, 0.6);
        z-index: 9999;
        align-items: flex-end;
      }
      .pm001-cek-modal.show { display: flex; animation: pm001-fade-in 0.2s; }
      @keyframes pm001-fade-in { from { opacity: 0; } to { opacity: 1; } }

      .pm001-cek-sheet {
        background: #fff;
        width: 100%;
        max-height: 95vh;
        border-radius: 18px 18px 0 0;
        display: flex;
        flex-direction: column;
        animation: pm001-slide-up 0.25s ease-out;
      }
      @keyframes pm001-slide-up {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }

      .pm001-cek-head {
        padding: 16px 18px;
        border-bottom: 1px solid var(--border, rgba(0,0,0,0.08));
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .pm001-cek-head-info { flex: 1; min-width: 0; }
      .pm001-cek-head-name {
        font-size: 17px;
        font-weight: 700;
        color: var(--text, #1C1C1A);
        margin-bottom: 2px;
      }
      .pm001-cek-head-sub {
        font-size: 12px;
        color: var(--muted, #64748B);
      }
      .pm001-cek-close {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: #F1F5F9;
        border: none;
        font-size: 18px;
        cursor: pointer;
        flex-shrink: 0;
      }

      .pm001-cek-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px 18px 24px;
      }

      .pm001-cek-section-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--muted, #64748B);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
        margin-top: 16px;
      }
      .pm001-cek-section-label:first-child { margin-top: 0; }

      .pm001-status-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }
      .pm001-status-btn {
        padding: 14px 8px;
        border: 2px solid var(--border, rgba(0,0,0,0.1));
        background: #fff;
        border-radius: 12px;
        font-family: inherit;
        cursor: pointer;
        text-align: center;
        transition: all 0.15s;
      }
      .pm001-status-btn:active { transform: scale(0.95); }
      .pm001-status-btn-icon {
        font-size: 24px;
        margin-bottom: 4px;
        display: block;
      }
      .pm001-status-btn-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text, #1C1C1A);
      }
      .pm001-status-btn.selected {
        border-width: 2px;
        font-weight: 700;
      }
      .pm001-status-btn.selected[data-status="bersih"] {
        background: #D1FAE5;
        border-color: #10B981;
        color: #065F46;
      }
      .pm001-status-btn.selected[data-status="perhatian"] {
        background: #FEF3C7;
        border-color: #F59E0B;
        color: #92400E;
      }
      .pm001-status-btn.selected[data-status="bermasalah"] {
        background: #FEE2E2;
        border-color: #DC2626;
        color: #991B1B;
      }

      .pm001-textarea {
        width: 100%;
        padding: 11px 13px;
        border: 1px solid var(--border, rgba(0,0,0,0.1));
        border-radius: 10px;
        font-family: inherit;
        font-size: 13px;
        line-height: 1.5;
        resize: vertical;
        min-height: 70px;
        background: #FAFAF8;
      }
      .pm001-textarea:focus {
        outline: none;
        border-color: #2563EB;
        background: #fff;
      }

      .pm001-foto-area {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .pm001-foto-add-btn {
        flex: 1;
        min-height: 90px;
        background: #FAFAF8;
        border: 2px dashed var(--border, rgba(0,0,0,0.15));
        border-radius: 12px;
        font-family: inherit;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        font-size: 11px;
        color: var(--muted, #64748B);
        font-weight: 600;
      }
      .pm001-foto-add-btn:active { background: #F1F5F9; }
      .pm001-foto-add-btn-icon { font-size: 28px; }

      .pm001-foto-preview {
        position: relative;
        width: 90px;
        height: 90px;
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid var(--border, rgba(0,0,0,0.08));
      }
      .pm001-foto-preview img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .pm001-foto-remove {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 24px;
        height: 24px;
        background: rgba(220, 38, 38, 0.95);
        color: #fff;
        border: none;
        border-radius: 50%;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }

      .pm001-required-warn {
        background: #FEF3C7;
        color: #92400E;
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 11px;
        font-weight: 600;
        margin-top: 6px;
        display: none;
      }
      .pm001-required-warn.show { display: block; }

      .pm001-cek-foot {
        padding: 12px 18px 16px;
        border-top: 1px solid var(--border, rgba(0,0,0,0.08));
        display: flex;
        gap: 8px;
      }
      .pm001-btn-cancel {
        flex: 1;
        padding: 13px;
        border: 1px solid var(--border, rgba(0,0,0,0.12));
        background: #fff;
        border-radius: 12px;
        font-family: inherit;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
      }
      .pm001-btn-save {
        flex: 1.6;
        padding: 13px;
        background: #2563EB;
        color: #fff;
        border: none;
        border-radius: 12px;
        font-family: inherit;
        font-weight: 700;
        font-size: 14px;
        cursor: pointer;
      }
      .pm001-btn-save:disabled {
        background: #94A3B8;
      }

      .pm001-history-item {
        background: #F8FAFC;
        border-radius: 8px;
        padding: 8px 12px;
        margin-bottom: 6px;
        font-size: 11px;
        line-height: 1.5;
      }
      .pm001-history-item-head {
        display: flex;
        justify-content: space-between;
        margin-bottom: 3px;
      }
      .pm001-history-item-status {
        font-weight: 700;
      }
      .pm001-history-item-date {
        color: var(--muted, #64748B);
        font-size: 10px;
      }

      /* Empty state */
      .pm001-empty {
        text-align: center;
        padding: 50px 20px;
        color: var(--muted, #64748B);
      }
      .pm001-empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.6; }
      .pm001-empty-title { font-size: 14px; font-weight: 700; color: var(--text, #1C1C1A); margin-bottom: 6px; }
      .pm001-empty-sub { font-size: 12px; line-height: 1.5; }
    `;
  }

  // ============================================================
  // HOOK renderEstateDashboard
  // ============================================================
  function _hookRender(){
    if(typeof global.renderEstateDashboard !== 'function') return false;
    if(global.renderEstateDashboard._pm001Hooked) return true;

    const original = global.renderEstateDashboard;

    global.renderEstateDashboard = function(){
      // Render existing content first
      original.apply(this, arguments);

      // Inject tab nav di paling atas content area
      _injectTabNav();

      // Kalau tab Cek aktif, render UI Sub-2
      if(_activeTab === 'cek'){
        _renderCekTab();
      }
    };
    global.renderEstateDashboard._pm001Hooked = true;
    console.log('[patch-mobile-001] renderEstateDashboard hooked');
    return true;
  }

  function _injectTabNav(){
    const main = document.getElementById('content-area');
    if(!main) return;
    if(main.querySelector('.pm001-tabs')) return; // already injected

    const tabs = document.createElement('div');
    tabs.className = 'pm001-tabs';
    tabs.innerHTML = `
      <button class="pm001-tab ${_activeTab==='laporan'?'active':''}" data-pm001-tab="laporan">
        📋 Laporan
      </button>
      <button class="pm001-tab ${_activeTab==='cek'?'active':''}" data-pm001-tab="cek">
        ✅ Cek Harian
        <span class="pm001-tab-badge" id="pm001-tab-badge" style="display:none;"></span>
      </button>
    `;
    main.insertBefore(tabs, main.firstChild);

    tabs.querySelectorAll('.pm001-tab').forEach(btn => {
      btn.addEventListener('click', function(){
        const tab = this.dataset.pm001Tab;
        _switchTab(tab);
      });
    });

    // Hide existing content children kalau tab Cek aktif
    if(_activeTab === 'cek'){
      _hideExistingContent();
    } else {
      _showExistingContent();
    }
  }

  function _switchTab(tab){
    if(_activeTab === tab) return;
    _activeTab = tab;
    // Trigger re-render via hooked function
    if(typeof global.renderEstateDashboard === 'function'){
      global.renderEstateDashboard();
    }
  }

  function _hideExistingContent(){
    const main = document.getElementById('content-area');
    if(!main) return;
    Array.from(main.children).forEach(child => {
      if(!child.classList.contains('pm001-tabs') && !child.classList.contains('pm001-cek-pane')){
        child.style.display = 'none';
      }
    });
  }

  function _showExistingContent(){
    const main = document.getElementById('content-area');
    if(!main) return;
    Array.from(main.children).forEach(child => {
      if(!child.classList.contains('pm001-tabs') && !child.classList.contains('pm001-cek-pane')){
        child.style.display = '';
      }
    });
    // Remove cek pane kalau ada
    const pane = main.querySelector('.pm001-cek-pane');
    if(pane) pane.remove();
  }

  // ============================================================
  // RENDER CEK HARIAN TAB
  // ============================================================
  function _renderCekTab(){
    const main = document.getElementById('content-area');
    if(!main) return;
    _hideExistingContent();

    // Pane wrapper
    let pane = main.querySelector('.pm001-cek-pane');
    if(!pane){
      pane = document.createElement('div');
      pane.className = 'pm001-cek-pane';
      main.appendChild(pane);
    }

    const today = _toIsoDate(new Date());
    const isToday = _selectedDate === today;

    pane.innerHTML = `
      <!-- Stats Hero -->
      <div class="pm001-stat-card" id="pm001-stat-card">
        <div class="pm001-stat-head">
          <div class="pm001-stat-title">Pengecekan Harian</div>
          <div class="pm001-stat-date">${_formatDateLabel(_selectedDate)}</div>
        </div>
        <div class="pm001-stat-grid">
          <div class="pm001-stat-cell dicek">
            <div class="pm001-stat-value" id="pm001-stat-dicek">—</div>
            <div class="pm001-stat-label">Dicek</div>
          </div>
          <div class="pm001-stat-cell belum">
            <div class="pm001-stat-value" id="pm001-stat-belum">—</div>
            <div class="pm001-stat-label">Belum</div>
          </div>
          <div class="pm001-stat-cell masalah">
            <div class="pm001-stat-value" id="pm001-stat-masalah">—</div>
            <div class="pm001-stat-label">Masalah</div>
          </div>
        </div>
        <div class="pm001-progress-bar">
          <div class="pm001-progress-fill" id="pm001-progress-fill" style="width:0%;"></div>
        </div>
      </div>

      <!-- Date picker -->
      <div class="pm001-date-row">
        <input type="date" class="pm001-date-input" id="pm001-date-input" value="${_selectedDate}">
        ${!isToday ? '<button class="pm001-date-today-btn" id="pm001-date-today-btn">📅 Hari ini</button>' : ''}
      </div>

      <!-- Filter pills -->
      <div class="pm001-filter-row">
        <button class="pm001-filter-pill ${_filterStatus==='all'?'active':''}" data-filter="all">Semua</button>
        <button class="pm001-filter-pill ${_filterStatus==='belum'?'active':''}" data-filter="belum">⏱ Belum dicek</button>
        <button class="pm001-filter-pill ${_filterStatus==='bermasalah'?'active':''}" data-filter="bermasalah">✗ Bermasalah</button>
        <button class="pm001-filter-pill ${_filterStatus==='perhatian'?'active':''}" data-filter="perhatian">⚠ Perhatian</button>
        <button class="pm001-filter-pill ${_filterStatus==='bersih'?'active':''}" data-filter="bersih">✓ Bersih</button>
      </div>

      <!-- Blok list -->
      <div class="pm001-blok-list" id="pm001-blok-list">
        <div class="pm001-empty">
          <div class="pm001-empty-icon">⏳</div>
          <div class="pm001-empty-title">Memuat data…</div>
          <div class="pm001-empty-sub">Mengambil daftar area prioritas</div>
        </div>
      </div>
    `;

    // Bind events
    document.getElementById('pm001-date-input').addEventListener('change', function(){
      _selectedDate = this.value || _toIsoDate(new Date());
      _loadCekData();
    });
    const todayBtn = document.getElementById('pm001-date-today-btn');
    if(todayBtn){
      todayBtn.addEventListener('click', function(){
        _selectedDate = _toIsoDate(new Date());
        _renderCekTab();
        _loadCekData();
      });
    }
    pane.querySelectorAll('.pm001-filter-pill').forEach(btn => {
      btn.addEventListener('click', function(){
        _filterStatus = this.dataset.filter;
        pane.querySelectorAll('.pm001-filter-pill').forEach(b => {
          b.classList.toggle('active', b.dataset.filter === _filterStatus);
        });
        _renderBlokList();
      });
    });

    // Load data
    _loadCekData();
  }

  // ============================================================
  // LOAD DATA
  // ============================================================
  async function _loadCekData(){
    if(_isLoading) return;
    _isLoading = true;

    const proyekId = global.currentProyekId;
    if(!proyekId){
      _showEmpty('🏗️', 'Pilih proyek dulu', 'Kembali ke halaman pilih proyek');
      _isLoading = false;
      return;
    }

    if(typeof global.gasGet !== 'function'){
      _showEmpty('⚠️', 'API tidak tersedia', 'Coba refresh halaman');
      _isLoading = false;
      return;
    }

    try {
      const [resBlok, resCek, resStats] = await Promise.all([
        global.gasGet('getEstateBlok', { proyekId, prioritasOnly: true, aktifOnly: true }),
        global.gasGet('getEstatePengecekan', { proyekId, tanggalCek: _selectedDate }),
        global.gasGet('getPengecekanStats', { proyekId, tanggal: _selectedDate }).catch(() => ({ success:false }))
      ]);

      _blokPrioritas = (resBlok && resBlok.success && Array.isArray(resBlok.data)) ? resBlok.data : [];
      _cekHariIni = (resCek && resCek.success && Array.isArray(resCek.data)) ? resCek.data : [];
      _stats = (resStats && resStats.success) ? resStats : null;

      _renderStats();
      _renderBlokList();
      _updateTabBadge();
    } catch(e){
      console.error('[patch-mobile-001] load error:', e);
      _showEmpty('⚠️', 'Gagal memuat', String(e && e.message || e));
    } finally {
      _isLoading = false;
    }
  }

  function _renderStats(){
    const dicek = _stats ? _stats.dicek : 0;
    const total = _stats ? _stats.totalPrioritas : _blokPrioritas.length;
    const belum = Math.max(0, total - dicek);
    const masalah = _stats ? (_stats.bermasalah || 0) + (_stats.perhatian || 0) : 0;
    const pct = _stats ? (_stats.persenDicek || 0) : 0;

    const dEl = document.getElementById('pm001-stat-dicek');
    const bEl = document.getElementById('pm001-stat-belum');
    const mEl = document.getElementById('pm001-stat-masalah');
    const fEl = document.getElementById('pm001-progress-fill');

    if(dEl) dEl.textContent = dicek + '/' + total;
    if(bEl) bEl.textContent = belum;
    if(mEl) mEl.textContent = masalah;
    if(fEl) fEl.style.width = pct + '%';
  }

  function _updateTabBadge(){
    const badge = document.getElementById('pm001-tab-badge');
    if(!badge) return;
    const today = _toIsoDate(new Date());
    if(_selectedDate !== today) {
      badge.style.display = 'none';
      return;
    }
    // Badge = jumlah belum dicek hari ini
    const total = _stats ? _stats.totalPrioritas : _blokPrioritas.length;
    const dicek = _stats ? _stats.dicek : 0;
    const belum = Math.max(0, total - dicek);
    if(belum > 0){
      badge.textContent = belum;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  // ============================================================
  // RENDER BLOK LIST
  // ============================================================
  function _renderBlokList(){
    const container = document.getElementById('pm001-blok-list');
    if(!container) return;

    if(_blokPrioritas.length === 0){
      container.innerHTML = `
        <div class="pm001-empty">
          <div class="pm001-empty-icon">⭐</div>
          <div class="pm001-empty-title">Belum ada area prioritas</div>
          <div class="pm001-empty-sub">BM/admin perlu set area prioritas dulu via desktop.</div>
        </div>
      `;
      return;
    }

    // Map cek per blokId (latest record per blok)
    const cekMap = {};
    _cekHariIni.forEach(c => {
      const bid = String(c.blokId);
      if(!cekMap[bid] || String(c.updatedAt || c.createdAt) > String(cekMap[bid].updatedAt || cekMap[bid].createdAt)){
        cekMap[bid] = c;
      }
    });

    // Combine blok + cek status
    const items = _blokPrioritas.map(b => {
      const cek = cekMap[String(b.id)];
      return {
        blok: b,
        cek: cek || null,
        statusKey: cek ? String(cek.status).toLowerCase() : 'belum'
      };
    });

    // Filter
    let filtered = items;
    if(_filterStatus !== 'all'){
      filtered = items.filter(it => it.statusKey === _filterStatus);
    }

    // Sort: belum dicek dulu, lalu bermasalah, lalu perhatian, lalu bersih
    const order = { belum: 0, bermasalah: 1, perhatian: 2, bersih: 3 };
    filtered.sort((a, b) => {
      const oa = order[a.statusKey] || 99;
      const ob = order[b.statusKey] || 99;
      if(oa !== ob) return oa - ob;
      // Natural compare on nama
      return _naturalCompare(a.blok.nama, b.blok.nama);
    });

    if(filtered.length === 0){
      container.innerHTML = `
        <div class="pm001-empty">
          <div class="pm001-empty-icon">🔍</div>
          <div class="pm001-empty-title">Tidak ada hasil</div>
          <div class="pm001-empty-sub">Coba filter "Semua" untuk lihat semua blok prioritas.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(it => _renderBlokCard(it)).join('');

    // Bind click
    container.querySelectorAll('.pm001-blok-item').forEach(el => {
      el.addEventListener('click', function(){
        const blokId = this.dataset.blokId;
        _openCekModal(blokId);
      });
    });
  }

  function _renderBlokCard(item){
    const b = item.blok;
    const cek = item.cek;
    const sk = item.statusKey;

    let statusIcon = '⏱';
    let statusLabel = 'Belum dicek';
    if(sk === 'bersih') { statusIcon = '✓'; statusLabel = 'Bersih'; }
    else if(sk === 'perhatian') { statusIcon = '⚠'; statusLabel = 'Perhatian'; }
    else if(sk === 'bermasalah') { statusIcon = '✗'; statusLabel = 'Bermasalah'; }

    const tipe = String(b.tipe || 'rumah').toLowerCase();
    const tipeBadge = tipe !== 'rumah'
      ? `<span class="pm001-blok-tipe-badge">${_esc(tipe)}</span>`
      : '';

    let metaText = statusLabel;
    if(cek && cek.catatan){
      metaText += ' · ' + _truncate(cek.catatan, 50);
    } else if(b.prioritasNote){
      metaText += ' · ' + _truncate(b.prioritasNote, 50);
    }

    return `
      <div class="pm001-blok-item s-${sk}" data-blok-id="${_esc(b.id)}">
        <div class="pm001-blok-status-dot">${statusIcon}</div>
        <div class="pm001-blok-content">
          <div class="pm001-blok-name">${tipeBadge}${_esc(b.nama)}</div>
          <div class="pm001-blok-meta">${_esc(metaText)}</div>
        </div>
        <div class="pm001-blok-arrow">›</div>
      </div>
    `;
  }

  // ============================================================
  // CEK MODAL
  // ============================================================
  function _openCekModal(blokId){
    const blok = _blokPrioritas.find(b => String(b.id) === String(blokId));
    if(!blok){ _toast('⚠️ Blok tidak ditemukan'); return; }

    _currentBlok = blok;

    // Cari cek existing untuk blok ini di tanggal aktif
    const existing = _cekHariIni.find(c => String(c.blokId) === String(blokId));

    // Render modal
    const modal = _ensureModal();
    modal.querySelector('#pm001-cek-name').textContent = blok.nama;
    modal.querySelector('#pm001-cek-sub').textContent =
      (existing ? '✏️ Edit cek' : '✅ Cek baru') + ' · ' + _formatDateLabel(_selectedDate);

    // Reset state
    const statusKey = existing ? String(existing.status).toLowerCase() : '';
    modal.querySelectorAll('.pm001-status-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.status === statusKey);
    });

    modal.querySelector('#pm001-cek-catatan').value = existing ? (existing.catatan || '') : '';

    // Foto state
    const fotoData = existing && existing.foto ? existing.foto : '';
    _renderFotoPreview(fotoData);

    // History (load other days for this blok)
    _renderCekHistory(blokId);

    modal.querySelector('#pm001-required-warn').classList.remove('show');
    modal.classList.add('show');
  }

  function _ensureModal(){
    let modal = document.getElementById('pm001-cek-modal');
    if(modal) return modal;

    modal = document.createElement('div');
    modal.id = 'pm001-cek-modal';
    modal.className = 'pm001-cek-modal';
    modal.innerHTML = `
      <div class="pm001-cek-sheet">
        <div class="pm001-cek-head">
          <div class="pm001-cek-head-info">
            <div class="pm001-cek-head-name" id="pm001-cek-name">—</div>
            <div class="pm001-cek-head-sub" id="pm001-cek-sub">—</div>
          </div>
          <button class="pm001-cek-close" id="pm001-cek-close">✕</button>
        </div>
        <div class="pm001-cek-body">
          <div class="pm001-cek-section-label">Status pengecekan</div>
          <div class="pm001-status-buttons">
            <button class="pm001-status-btn" data-status="bersih">
              <span class="pm001-status-btn-icon">✓</span>
              <span class="pm001-status-btn-label">Bersih</span>
            </button>
            <button class="pm001-status-btn" data-status="perhatian">
              <span class="pm001-status-btn-icon">⚠</span>
              <span class="pm001-status-btn-label">Perhatian</span>
            </button>
            <button class="pm001-status-btn" data-status="bermasalah">
              <span class="pm001-status-btn-icon">✗</span>
              <span class="pm001-status-btn-label">Bermasalah</span>
            </button>
          </div>

          <div class="pm001-cek-section-label">Catatan <small style="font-weight:400;color:var(--muted,#64748B);text-transform:none;letter-spacing:0;">(opsional kalau bersih)</small></div>
          <textarea class="pm001-textarea" id="pm001-cek-catatan" placeholder="Deskripsikan kondisi atau masalah yang ditemui..."></textarea>

          <div class="pm001-cek-section-label">Foto <small style="font-weight:400;color:var(--muted,#64748B);text-transform:none;letter-spacing:0;">(wajib kalau ada masalah)</small></div>
          <div class="pm001-foto-area" id="pm001-foto-area"></div>
          <input type="file" id="pm001-foto-input" accept="image/*" capture="environment" style="display:none;">
          <div class="pm001-required-warn" id="pm001-required-warn">⚠️ Foto wajib disertakan kalau status bukan "Bersih"</div>

          <div class="pm001-cek-section-label" id="pm001-history-label" style="display:none;">Riwayat cek terakhir</div>
          <div id="pm001-history-list"></div>
        </div>
        <div class="pm001-cek-foot">
          <button class="pm001-btn-cancel" id="pm001-btn-cancel">Batal</button>
          <button class="pm001-btn-save" id="pm001-btn-save">💾 Simpan</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Bind
    modal.querySelector('#pm001-cek-close').addEventListener('click', _closeCekModal);
    modal.querySelector('#pm001-btn-cancel').addEventListener('click', _closeCekModal);
    modal.querySelector('#pm001-btn-save').addEventListener('click', _saveCek);

    modal.querySelectorAll('.pm001-status-btn').forEach(btn => {
      btn.addEventListener('click', function(){
        modal.querySelectorAll('.pm001-status-btn').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        // Hide warning kalau yang dipilih bersih atau ada foto
        const status = this.dataset.status;
        if(status === 'bersih'){
          modal.querySelector('#pm001-required-warn').classList.remove('show');
        }
      });
    });

    modal.querySelector('#pm001-foto-input').addEventListener('change', _handleFotoSelect);

    // Tap di overlay (di luar sheet) = close
    modal.addEventListener('click', function(e){
      if(e.target === modal) _closeCekModal();
    });

    return modal;
  }

  function _closeCekModal(){
    const modal = document.getElementById('pm001-cek-modal');
    if(modal) modal.classList.remove('show');
    _currentBlok = null;
    // Reset foto data attribute
    const area = document.getElementById('pm001-foto-area');
    if(area) area.dataset.fotoData = '';
  }

  // ============================================================
  // FOTO HANDLING (camera-first dengan auto-compress)
  // ============================================================
  function _renderFotoPreview(fotoData){
    const area = document.getElementById('pm001-foto-area');
    if(!area) return;

    if(fotoData){
      area.dataset.fotoData = fotoData;
      area.innerHTML = `
        <div class="pm001-foto-preview">
          <img src="${_esc(fotoData)}" alt="Foto cek">
          <button class="pm001-foto-remove" id="pm001-foto-remove">✕</button>
        </div>
      `;
      area.querySelector('#pm001-foto-remove').addEventListener('click', function(e){
        e.stopPropagation();
        _renderFotoPreview('');
      });
    } else {
      area.dataset.fotoData = '';
      area.innerHTML = `
        <button type="button" class="pm001-foto-add-btn" id="pm001-foto-add-btn">
          <span class="pm001-foto-add-btn-icon">📷</span>
          <span>Tambah Foto</span>
        </button>
      `;
      area.querySelector('#pm001-foto-add-btn').addEventListener('click', function(){
        document.getElementById('pm001-foto-input').click();
      });
    }
  }

  function _handleFotoSelect(e){
    const file = e.target.files && e.target.files[0];
    if(!file) return;

    if(!file.type.startsWith('image/')){
      _toast('⚠️ File harus berupa gambar');
      return;
    }

    _toast('📷 Memproses foto...');

    // Compress + convert to base64 jpeg
    _compressImage(file, 1024, 0.85).then(dataUrl => {
      _renderFotoPreview(dataUrl);
    }).catch(err => {
      console.error('[patch-mobile-001] foto compress error:', err);
      _toast('⚠️ Gagal proses foto');
    });

    // Reset input value supaya bisa pilih file yang sama lagi
    e.target.value = '';
  }

  function _compressImage(file, maxDim, quality){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function(e){
        const img = new Image();
        img.onload = function(){
          let w = img.width, h = img.height;
          if(w > maxDim || h > maxDim){
            if(w > h){
              h = Math.round(h * maxDim / w);
              w = maxDim;
            } else {
              w = Math.round(w * maxDim / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ============================================================
  // HISTORY (last 5 cek for this blok)
  // ============================================================
  async function _renderCekHistory(blokId){
    const labelEl = document.getElementById('pm001-history-label');
    const listEl = document.getElementById('pm001-history-list');
    if(!listEl) return;
    listEl.innerHTML = '';
    if(labelEl) labelEl.style.display = 'none';

    try {
      const proyekId = global.currentProyekId;
      const res = await global.gasGet('getEstatePengecekan', { proyekId, blokId });
      if(!res || !res.success) return;
      const list = (res.data || [])
        .filter(c => String(c.blokId) === String(blokId) && _toIsoDate(new Date(c.tanggalCek)) !== _selectedDate)
        .slice(0, 5);

      if(list.length === 0) return;

      if(labelEl) labelEl.style.display = '';
      listEl.innerHTML = list.map(c => {
        const sk = String(c.status).toLowerCase();
        const sm = STATUS[sk.toUpperCase()] || STATUS.BERSIH;
        return `
          <div class="pm001-history-item">
            <div class="pm001-history-item-head">
              <span class="pm001-history-item-status" style="color:${sm.color};">${sm.icon} ${_esc(sm.label)}</span>
              <span class="pm001-history-item-date">${_formatDateLabel(String(c.tanggalCek).slice(0,10))}</span>
            </div>
            ${c.catatan ? '<div>' + _esc(c.catatan) + '</div>' : ''}
          </div>
        `;
      }).join('');
    } catch(e){
      console.warn('[patch-mobile-001] history fetch failed:', e);
    }
  }

  // ============================================================
  // SAVE
  // ============================================================
  async function _saveCek(){
    if(!_currentBlok){ _toast('⚠️ Pilih blok dulu'); return; }

    const modal = document.getElementById('pm001-cek-modal');
    const selected = modal.querySelector('.pm001-status-btn.selected');
    if(!selected){
      _toast('⚠️ Pilih status dulu (Bersih/Perhatian/Bermasalah)');
      return;
    }
    const status = selected.dataset.status;
    const catatan = modal.querySelector('#pm001-cek-catatan').value.trim();
    const foto = modal.querySelector('#pm001-foto-area').dataset.fotoData || '';

    // Validation: foto wajib kalau bukan bersih
    if(status !== 'bersih' && !foto){
      modal.querySelector('#pm001-required-warn').classList.add('show');
      _toast('⚠️ Foto wajib kalau ada masalah');
      return;
    }

    const saveBtn = modal.querySelector('#pm001-btn-save');
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Menyimpan...';

    try {
      const payload = {
        tanggalCek: _selectedDate,
        proyekId: global.currentProyekId,
        blokId: _currentBlok.id,
        blokNama: _currentBlok.nama,
        status: status,
        catatan: catatan,
        foto: foto
      };

      const res = await global.gasRequest('saveEstatePengecekan', payload);

      if(res && res.success){
        _toast('✅ Tersimpan');
        _closeCekModal();
        _loadCekData();
      } else {
        _toast('⚠️ Gagal: ' + (res.message || res.error || 'unknown'));
      }
    } catch(e){
      console.error('[patch-mobile-001] save error:', e);
      _toast('⚠️ Error: ' + (e.message || e));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Simpan';
    }
  }

  // ============================================================
  // UTIL
  // ============================================================
  function _toIsoDate(d){
    if(!(d instanceof Date)) d = new Date(d);
    if(isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  function _formatDateLabel(iso){
    if(!iso) return '-';
    try {
      const d = new Date(iso + 'T00:00:00');
      const today = new Date(); today.setHours(0,0,0,0);
      const target = new Date(d); target.setHours(0,0,0,0);
      const diff = Math.round((today.getTime() - target.getTime()) / 86400000);
      if(diff === 0) return 'Hari ini';
      if(diff === 1) return 'Kemarin';
      if(diff === -1) return 'Besok';
      const dayName = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][d.getDay()];
      const monthName = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][d.getMonth()];
      return dayName + ', ' + d.getDate() + ' ' + monthName;
    } catch(_){ return iso; }
  }

  function _truncate(s, max){
    s = String(s || '');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function _naturalCompare(a, b){
    const ax = String(a || '').match(/(\d+)|(\D+)/g) || [];
    const bx = String(b || '').match(/(\d+)|(\D+)/g) || [];
    while(ax.length && bx.length){
      const an = ax.shift(), bn = bx.shift();
      const aIsNum = /^\d+$/.test(an), bIsNum = /^\d+$/.test(bn);
      if(aIsNum && bIsNum){
        const diff = parseInt(an, 10) - parseInt(bn, 10);
        if(diff !== 0) return diff;
      } else {
        const c = an.localeCompare(bn);
        if(c !== 0) return c;
      }
    }
    return ax.length - bx.length;
  }

  function _esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function _showEmpty(icon, title, sub){
    const c = document.getElementById('pm001-blok-list');
    if(!c) return;
    c.innerHTML = `
      <div class="pm001-empty">
        <div class="pm001-empty-icon">${icon}</div>
        <div class="pm001-empty-title">${_esc(title)}</div>
        <div class="pm001-empty-sub">${_esc(sub)}</div>
      </div>
    `;
  }

  function _toast(msg){
    if(typeof global.showToast === 'function'){
      global.showToast(msg);
      return;
    }
    const t = document.getElementById('toast');
    if(t){
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2500);
    } else {
      console.log('[patch-mobile-001]', msg);
    }
  }

  // ============================================================
  // BOOT
  // ============================================================
  function init(){
    _injectCss();

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const ok = _hookRender();
      if(ok || attempts >= 50){
        clearInterval(interval);
        if(!ok){
          console.warn('[patch-mobile-001] renderEstateDashboard not found after ' + attempts + ' attempts');
        }
      }
    }, 200);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  // Expose for debugging
  global._patchMobile001 = {
    init: init,
    switchTab: _switchTab,
    loadData: _loadCekData,
    state: () => ({
      activeTab: _activeTab,
      selectedDate: _selectedDate,
      filterStatus: _filterStatus,
      blokCount: _blokPrioritas.length,
      cekCount: _cekHariIni.length,
      stats: _stats
    })
  };

  console.log('[patch-mobile-001] estate cek harian patch loaded');
})(typeof window !== 'undefined' ? window : this);
