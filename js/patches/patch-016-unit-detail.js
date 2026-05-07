/**
 * BM4 PATCH 016 — UNIT SYSTEM Modal Detail (Desktop) — 4 TAB DIVISI
 *
 * Klik nomor unit di table → buka modal besar dengan 4 tab:
 *   - 💰 Sales       — status, harga, pembeli, KPR
 *   - 🏗️ Konstruksi  — progres, kontraktor, foto, target
 *   - 🏠 Estate      — status huni, prioritas, checklist
 *   - 📜 Legal       — sertifikat, PPJB, AJB, dokumen
 *
 * Permission per role:
 *   - BM/Owner/Admin/Manager: lihat 4 tab
 *   - Sales: hanya tab Sales
 *   - Konstruksi: hanya tab Konstruksi
 *   - Legal: hanya tab Legal
 *   - Strategi/Viewer: lihat semua tab tapi read-only
 *
 * Save: 1 tombol "💾 Simpan Semua" di footer → call bulkSaveUnitDivisi
 *
 * Dependency: patch-015-unit-system.js (table list yang inject "tab-unit")
 */

(function(global){
  'use strict';

  if(global._patch016UnitDetailLoaded) return;
  global._patch016UnitDetailLoaded = true;
  console.log('[patch-016] init');

  // ============================================================
  // CONST
  // ============================================================
  const TAB_CONFIG = [
    {
      key: 'sales',
      label: '💰 Sales',
      module: 'unit_system_sales', // tidak dipakai (cek di logic permission)
      saveAction: 'saveUnitSales',
      roleEditors: ['bm','owner','admin','manager','sales']
    },
    {
      key: 'konstruksi',
      label: '🏗️ Konstruksi',
      saveAction: 'saveUnitKonstruksi',
      roleEditors: ['bm','owner','admin','manager','konstruksi']
    },
    {
      key: 'estate',
      label: '🏠 Estate',
      saveAction: 'saveUnitEstate',
      roleEditors: ['bm','owner','admin','manager','estate']
    },
    {
      key: 'legal',
      label: '📜 Legal',
      saveAction: 'saveUnitLegal',
      roleEditors: ['bm','owner','admin','manager','legal']
    }
  ];

  // Mapping role → tab yang KELIATAN. BM/Admin/Manager: semua. Role divisi: hanya tabnya.
  const VISIBLE_TABS_BY_ROLE = {
    bm:         ['sales','konstruksi','estate','legal'],
    owner:      ['sales','konstruksi','estate','legal'],
    admin:      ['sales','konstruksi','estate','legal'],
    manager:    ['sales','konstruksi','estate','legal'],
    strategi:   ['sales','konstruksi','estate','legal'], // lihat all, read-only
    viewer:     ['sales','konstruksi','estate','legal'], // lihat all, read-only
    sales:      ['sales'],
    konstruksi: ['konstruksi'],
    estate:     ['estate'],
    legal:      ['legal']
  };

  const SALES_STATUS_OPTIONS = [
    { value:'available', label:'🟢 Available' },
    { value:'booked',    label:'🟡 Booked' },
    { value:'sold',      label:'🔵 Sold' },
    { value:'NA',        label:'⚪ Not Available' }
  ];

  const KONSTRUKSI_STATUS_OPTIONS = [
    { value:'belum',     label:'⏸ Belum Mulai' },
    { value:'persiapan', label:'🛠 Persiapan' },
    { value:'struktur',  label:'🏗 Struktur' },
    { value:'finishing', label:'🎨 Finishing' },
    { value:'selesai',   label:'✅ Selesai' },
    { value:'handover',  label:'🤝 Handover' }
  ];

  const ESTATE_HUNI_OPTIONS = [
    { value:'belum_dihuni', label:'🏚 Belum Dihuni' },
    { value:'dihuni',       label:'🏠 Dihuni' },
    { value:'kosong',       label:'🚫 Kosong' }
  ];

  const LEGAL_STATUS_OPTIONS = [
    { value:'proses',     label:'⏳ Proses' },
    { value:'lengkap',    label:'✅ Lengkap' },
    { value:'bermasalah', label:'⚠️ Bermasalah' }
  ];

  const LEGAL_TIPE_SERT_OPTIONS = [
    { value:'',     label:'— Pilih —' },
    { value:'SHM',  label:'SHM' },
    { value:'HGB',  label:'HGB' },
    { value:'HSRS', label:'HSRS' }
  ];

  const KPR_STATUS_OPTIONS = [
    { value:'',          label:'— Pilih —' },
    { value:'pengajuan', label:'⏳ Pengajuan' },
    { value:'approved',  label:'✅ Approved' },
    { value:'rejected',  label:'❌ Rejected' },
    { value:'cair',      label:'💰 Cair' }
  ];

  const METODE_BAYAR_OPTIONS = [
    { value:'',         label:'— Pilih —' },
    { value:'cash',     label:'💵 Cash' },
    { value:'kpr',      label:'🏦 KPR' },
    { value:'bertahap', label:'📆 Bertahap' }
  ];

  // ============================================================
  // STATE
  // ============================================================
  let _currentUnit = null;
  let _currentDivisi = { sales:null, konstruksi:null, estate:null, legal:null };
  let _activeTab = 'sales';
  let _isLoading = false;
  let _isSaving = false;

  // ============================================================
  // HELPERS
  // ============================================================
  function _getCurrentUser(){ return global.currentUser || {}; }

  function _getRole(){
    const u = _getCurrentUser();
    return String(u.role || '').toLowerCase();
  }

  function _getVisibleTabs(){
    const role = _getRole();
    return VISIBLE_TABS_BY_ROLE[role] || ['sales','konstruksi','estate','legal'];
  }

  function _canEditTab(tabKey){
    const role = _getRole();
    const tab = TAB_CONFIG.find(t => t.key === tabKey);
    if(!tab) return false;
    return tab.roleEditors.indexOf(role) >= 0;
  }

  function _toast(msg, type){
    type = type || 'info';
    try {
      if(typeof global.toast === 'function'){ global.toast(msg, type); return; }
      if(typeof global.showToast === 'function'){ global.showToast(msg, type); return; }
      // Pakai toast dari patch-015 kalau ada
      if(global.BM4Patch015 && document.getElementById('patch-015-toast-container')){
        // re-use container
      }
      _showCustomToast(msg, type);
    } catch(e){ console.log('[' + type.toUpperCase() + ']', msg); }
  }

  function _showCustomToast(msg, type){
    let container = document.getElementById('patch-015-toast-container') || document.getElementById('patch-016-toast-container');
    if(!container){
      container = document.createElement('div');
      container.id = 'patch-016-toast-container';
      container.style.cssText = 'position:fixed; top:20px; right:20px; z-index:99999; display:flex; flex-direction:column; gap:8px; pointer-events:none;';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const colors = {
      success: { bg:'#10B981', border:'#059669' },
      error:   { bg:'#EF4444', border:'#DC2626' },
      warning: { bg:'#F59E0B', border:'#D97706' },
      info:    { bg:'#3B82F6', border:'#2563EB' }
    };
    const c = colors[type] || colors.info;
    toast.style.cssText = `background:${c.bg};color:white;padding:12px 18px;border-radius:8px;font-size:14px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.15);border-left:4px solid ${c.border};max-width:360px;pointer-events:auto;`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s, transform 0.3s';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      setTimeout(() => toast.remove(), 300);
    }, type === 'error' ? 5000 : 3000);
  }

  function _formatRupiah(n){
    if(n === '' || n === null || n === undefined) return '';
    const num = Number(n);
    if(isNaN(num)) return '';
    return num.toLocaleString('id-ID');
  }

  function _parseRupiah(str){
    if(!str) return '';
    const cleaned = String(str).replace(/[^\d]/g, '');
    return cleaned ? Number(cleaned) : '';
  }

  function _escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }

  function _toBool(v){
    if(v === true || v === 1) return true;
    if(v === false || v === 0 || v === '' || v == null) return false;
    return ['true','yes','y','1'].indexOf(String(v).toLowerCase()) >= 0;
  }

  function _selectOptionsHtml(options, currentValue){
    return options.map(opt => {
      const sel = String(currentValue || '').toLowerCase() === String(opt.value).toLowerCase() ? 'selected' : '';
      return `<option value="${_escapeHtml(opt.value)}" ${sel}>${_escapeHtml(opt.label)}</option>`;
    }).join('');
  }

  // ============================================================
  // INJECT MODAL HTML & STYLE
  // ============================================================
  function injectModalIfNeeded(){
    if(document.getElementById('udetail-backdrop')) return;

    // Style
    if(!document.getElementById('patch-016-style')){
      const style = document.createElement('style');
      style.id = 'patch-016-style';
      style.textContent = `
        .udetail-backdrop{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9100;display:none;align-items:center;justify-content:center;padding:20px;}
        .udetail-backdrop.show{display:flex;}
        .udetail-modal{background:white;border-radius:14px;width:100%;max-width:760px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:udetailIn 0.2s ease-out;}
        @keyframes udetailIn{from{opacity:0;transform:scale(0.95) translateY(-10px);}to{opacity:1;transform:scale(1) translateY(0);}}
        .udetail-head{padding:18px 24px 14px;border-bottom:1px solid #E5E7EB;}
        .udetail-head-row{display:flex;justify-content:space-between;align-items:flex-start;}
        .udetail-title{font-size:18px;font-weight:700;color:#111827;}
        .udetail-meta{font-size:12px;color:#6B7280;margin-top:4px;}
        .udetail-close{background:none;border:none;font-size:28px;color:#6B7280;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:6px;line-height:1;padding:0;}
        .udetail-close:hover{background:#F3F4F6;color:#111827;}
        .udetail-tabs{display:flex;gap:4px;padding:0 24px;border-bottom:1px solid #E5E7EB;background:#F9FAFB;overflow-x:auto;}
        .udetail-tab{background:transparent;border:none;padding:12px 16px;font-size:14px;font-weight:600;color:#6B7280;cursor:pointer;border-bottom:3px solid transparent;white-space:nowrap;transition:all 0.15s;}
        .udetail-tab:hover{color:#374151;}
        .udetail-tab.active{color:#2563EB;border-bottom-color:#2563EB;}
        .udetail-tab.readonly::after{content:" 🔒";font-size:11px;}
        .udetail-body{padding:20px 24px;overflow-y:auto;flex:1;}
        .udetail-tab-content{display:none;}
        .udetail-tab-content.active{display:block;}
        .udetail-readonly-banner{background:#FEF3C7;border-left:3px solid #F59E0B;color:#78350F;padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:16px;}
        .udetail-form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;}
        .udetail-form-field{display:flex;flex-direction:column;}
        .udetail-form-field.full{grid-column:1 / -1;}
        .udetail-form-field label{font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;}
        .udetail-form-field input,.udetail-form-field select,.udetail-form-field textarea{padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:14px;background:white;color:#1F2937;font-family:inherit;}
        .udetail-form-field input:focus,.udetail-form-field select:focus,.udetail-form-field textarea:focus{outline:none;border-color:#2563EB;box-shadow:0 0 0 3px rgba(37,99,235,0.1);}
        .udetail-form-field input:disabled,.udetail-form-field select:disabled,.udetail-form-field textarea:disabled{background:#F3F4F6;color:#6B7280;cursor:not-allowed;}
        .udetail-form-field textarea{resize:vertical;min-height:60px;}
        .udetail-form-field .input-prefix{display:flex;align-items:center;}
        .udetail-form-field .input-prefix span{padding:9px 12px;background:#F9FAFB;border:1px solid #D1D5DB;border-right:none;border-radius:7px 0 0 7px;color:#6B7280;font-size:14px;}
        .udetail-form-field .input-prefix input{border-radius:0 7px 7px 0;flex:1;}
        .udetail-checkbox-row{display:flex;align-items:center;gap:8px;padding:8px 0;}
        .udetail-checkbox-row input[type="checkbox"]{width:18px;height:18px;cursor:pointer;}
        .udetail-checkbox-row label{font-size:14px;color:#374151;cursor:pointer;margin:0;}
        .udetail-foot{display:flex;justify-content:space-between;align-items:center;padding:14px 24px;border-top:1px solid #E5E7EB;background:#F9FAFB;border-radius:0 0 14px 14px;gap:8px;}
        .udetail-foot-info{font-size:12px;color:#6B7280;}
        .udetail-foot-actions{display:flex;gap:8px;}
        .udetail-btn{padding:9px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;}
        .udetail-btn-primary{background:#2563EB;color:white;}
        .udetail-btn-primary:hover{background:#1D4ED8;}
        .udetail-btn-primary:disabled{background:#9CA3AF;cursor:not-allowed;}
        .udetail-btn-secondary{background:white;color:#374151;border:1px solid #D1D5DB;}
        .udetail-btn-secondary:hover{background:#F3F4F6;}
        .udetail-loading{text-align:center;padding:40px 20px;color:#6B7280;font-size:14px;}
        .udetail-status-pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;margin-left:8px;}
        .udetail-empty-tab{text-align:center;padding:30px 20px;color:#9CA3AF;}
        .unit-table .unit-link{color:#2563EB;font-weight:600;cursor:pointer;text-decoration:none;}
        .unit-table .unit-link:hover{text-decoration:underline;}
        @media (max-width:600px){
          .udetail-form-row{grid-template-columns:1fr;}
        }
      `;
      document.head.appendChild(style);
    }

    // Modal HTML
    const backdrop = document.createElement('div');
    backdrop.className = 'udetail-backdrop';
    backdrop.id = 'udetail-backdrop';
    backdrop.innerHTML = `
      <div class="udetail-modal">
        <div class="udetail-head">
          <div class="udetail-head-row">
            <div>
              <div class="udetail-title" id="udetail-title">Detail Unit</div>
              <div class="udetail-meta" id="udetail-meta">—</div>
            </div>
            <button class="udetail-close" id="udetail-close">×</button>
          </div>
        </div>
        <div class="udetail-tabs" id="udetail-tabs"></div>
        <div class="udetail-body" id="udetail-body">
          <div class="udetail-loading">Memuat data divisi…</div>
        </div>
        <div class="udetail-foot">
          <div class="udetail-foot-info" id="udetail-foot-info"></div>
          <div class="udetail-foot-actions">
            <button class="udetail-btn udetail-btn-secondary" id="udetail-btn-cancel">Tutup</button>
            <button class="udetail-btn udetail-btn-primary" id="udetail-btn-save">💾 Simpan Semua</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    // Bind events
    document.getElementById('udetail-close').onclick = closeModal;
    document.getElementById('udetail-btn-cancel').onclick = closeModal;
    document.getElementById('udetail-btn-save').onclick = saveAll;
    backdrop.onclick = (e) => { if(e.target === backdrop) closeModal(); };

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape' && backdrop.classList.contains('show')) closeModal();
    });
  }

  // ============================================================
  // OPEN / CLOSE MODAL
  // ============================================================
  async function openModal(unit){
    if(!unit || !unit.id) return;
    injectModalIfNeeded();

    _currentUnit = unit;
    _currentDivisi = { sales:null, konstruksi:null, estate:null, legal:null };

    document.getElementById('udetail-title').textContent = `🏠 Unit ${unit.blokNama}-${unit.nomor}`;
    document.getElementById('udetail-meta').textContent =
      `Blok ${unit.blokNama} · Nomor ${unit.nomor} · ${(unit.tipe||'').toUpperCase()}` +
      (unit.subtipe ? ` · ${unit.subtipe}` : '') +
      (unit.luasTanah ? ` · LT ${unit.luasTanah}m²` : '') +
      (unit.luasBangunan ? ` · LB ${unit.luasBangunan}m²` : '');

    renderTabs();
    document.getElementById('udetail-foot-info').textContent = '';
    document.getElementById('udetail-body').innerHTML = '<div class="udetail-loading">⏳ Memuat data divisi…</div>';
    document.getElementById('udetail-backdrop').classList.add('show');

    // Load data divisi
    await loadDivisiData();

    // Render tab pertama yang visible untuk user
    const visibleTabs = _getVisibleTabs();
    _activeTab = visibleTabs[0] || 'sales';
    renderActiveTabContent();
  }

  function closeModal(){
    const bd = document.getElementById('udetail-backdrop');
    if(bd) bd.classList.remove('show');
    _currentUnit = null;
  }

  function renderTabs(){
    const tabsContainer = document.getElementById('udetail-tabs');
    if(!tabsContainer) return;

    const visibleTabs = _getVisibleTabs();
    tabsContainer.innerHTML = TAB_CONFIG
      .filter(t => visibleTabs.indexOf(t.key) >= 0)
      .map(t => {
        const canEdit = _canEditTab(t.key);
        const cls = ['udetail-tab'];
        if(t.key === _activeTab) cls.push('active');
        if(!canEdit) cls.push('readonly');
        return `<button class="${cls.join(' ')}" data-tab="${t.key}">${t.label}</button>`;
      }).join('');

    tabsContainer.querySelectorAll('.udetail-tab').forEach(btn => {
      btn.onclick = () => {
        _activeTab = btn.dataset.tab;
        renderTabs();
        renderActiveTabContent();
      };
    });
  }

  // ============================================================
  // LOAD DATA DIVISI
  // ============================================================
  async function loadDivisiData(){
    _isLoading = true;
    try {
      const res = await global.BM4Api.get('getUnitDivisi', {
        unitId: _currentUnit.id,
        divisi: ['sales','konstruksi','estate','legal']
      });
      if(res && res.success && res.data){
        _currentDivisi = {
          sales: res.data.sales || null,
          konstruksi: res.data.konstruksi || null,
          estate: res.data.estate || null,
          legal: res.data.legal || null
        };
      }
    } catch(e){
      console.error('[patch-016] loadDivisiData err:', e);
      _toast('Gagal memuat data divisi: ' + (e.message || e), 'error');
    } finally {
      _isLoading = false;
    }
  }

  // ============================================================
  // RENDER TAB CONTENT
  // ============================================================
  function renderActiveTabContent(){
    const body = document.getElementById('udetail-body');
    if(!body) return;

    const visibleTabs = _getVisibleTabs();
    if(visibleTabs.indexOf(_activeTab) < 0){
      body.innerHTML = `<div class="udetail-empty-tab">🚫 Anda tidak punya akses ke tab ini.</div>`;
      return;
    }

    let html = '';
    if(_activeTab === 'sales'){ html = renderSalesForm(); }
    else if(_activeTab === 'konstruksi'){ html = renderKonstruksiForm(); }
    else if(_activeTab === 'estate'){ html = renderEstateForm(); }
    else if(_activeTab === 'legal'){ html = renderLegalForm(); }

    body.innerHTML = html;

    // Bind input formatters
    body.querySelectorAll('input[data-fmt="rupiah"]').forEach(inp => {
      inp.addEventListener('input', () => {
        const cursor = inp.selectionStart;
        const oldLen = inp.value.length;
        inp.value = _formatRupiah(_parseRupiah(inp.value));
        const newLen = inp.value.length;
        try { inp.setSelectionRange(cursor + (newLen - oldLen), cursor + (newLen - oldLen)); } catch(_){}
      });
    });

    updateSaveButtonState();
  }

  function renderSalesForm(){
    const d = _currentDivisi.sales || {};
    const canEdit = _canEditTab('sales');
    const dis = canEdit ? '' : 'disabled';
    const banner = !canEdit ? `<div class="udetail-readonly-banner">🔒 Anda hanya bisa melihat data Sales (read-only).</div>` : '';

    return `
      ${banner}
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Status Sales</label>
          <select id="d-sales-status" ${dis}>${_selectOptionsHtml(SALES_STATUS_OPTIONS, d.status || 'available')}</select>
        </div>
        <div class="udetail-form-field">
          <label>Sales PIC</label>
          <input type="text" id="d-sales-pic" value="${_escapeHtml(d.salesPic || '')}" placeholder="Nama sales" ${dis}/>
        </div>
      </div>
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Harga Listing</label>
          <div class="input-prefix">
            <span>Rp</span>
            <input type="text" id="d-sales-hargaListing" data-fmt="rupiah" value="${_formatRupiah(d.hargaListing || '')}" placeholder="0" ${dis}/>
          </div>
        </div>
        <div class="udetail-form-field">
          <label>Harga Jual (Aktual)</label>
          <div class="input-prefix">
            <span>Rp</span>
            <input type="text" id="d-sales-hargaJual" data-fmt="rupiah" value="${_formatRupiah(d.hargaJual || '')}" placeholder="0" ${dis}/>
          </div>
        </div>
      </div>
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Nama Pembeli</label>
          <input type="text" id="d-sales-pembeliNama" value="${_escapeHtml(d.pembeliNama || '')}" placeholder="Nama lengkap pembeli" ${dis}/>
        </div>
        <div class="udetail-form-field">
          <label>Kontak Pembeli</label>
          <input type="text" id="d-sales-pembeliKontak" value="${_escapeHtml(d.pembeliKontak || '')}" placeholder="No HP / email" ${dis}/>
        </div>
      </div>
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Tgl Booking</label>
          <input type="date" id="d-sales-tanggalBooking" value="${_escapeHtml(d.tanggalBooking || '')}" ${dis}/>
        </div>
        <div class="udetail-form-field">
          <label>Tgl Akad</label>
          <input type="date" id="d-sales-tanggalAkad" value="${_escapeHtml(d.tanggalAkad || '')}" ${dis}/>
        </div>
      </div>
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Metode Bayar</label>
          <select id="d-sales-metodeBayar" ${dis}>${_selectOptionsHtml(METODE_BAYAR_OPTIONS, d.metodeBayar || '')}</select>
        </div>
        <div class="udetail-form-field">
          <label>Status KPR</label>
          <select id="d-sales-kprStatus" ${dis}>${_selectOptionsHtml(KPR_STATUS_OPTIONS, d.kprStatus || '')}</select>
        </div>
      </div>
      <div class="udetail-form-field full">
        <label>Bank KPR</label>
        <input type="text" id="d-sales-kprBank" value="${_escapeHtml(d.kprBank || '')}" placeholder="BCA, Mandiri, BTN, dst" ${dis}/>
      </div>
      <div class="udetail-form-field full">
        <label>Catatan Sales</label>
        <textarea id="d-sales-catatanSales" rows="2" placeholder="Catatan opsional…" ${dis}>${_escapeHtml(d.catatanSales || '')}</textarea>
      </div>
    `;
  }

  function renderKonstruksiForm(){
    const d = _currentDivisi.konstruksi || {};
    const canEdit = _canEditTab('konstruksi');
    const dis = canEdit ? '' : 'disabled';
    const banner = !canEdit ? `<div class="udetail-readonly-banner">🔒 Anda hanya bisa melihat data Konstruksi (read-only).</div>` : '';

    return `
      ${banner}
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Status Konstruksi</label>
          <select id="d-kons-status" ${dis}>${_selectOptionsHtml(KONSTRUKSI_STATUS_OPTIONS, d.status || 'belum')}</select>
        </div>
        <div class="udetail-form-field">
          <label>Progres (%)</label>
          <input type="number" id="d-kons-progresPersen" min="0" max="100" step="1" value="${d.progresPersen || 0}" ${dis}/>
        </div>
      </div>
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Tgl Mulai</label>
          <input type="date" id="d-kons-tanggalMulai" value="${_escapeHtml(d.tanggalMulai || '')}" ${dis}/>
        </div>
        <div class="udetail-form-field">
          <label>Tgl Target Selesai</label>
          <input type="date" id="d-kons-tanggalTargetSelesai" value="${_escapeHtml(d.tanggalTargetSelesai || '')}" ${dis}/>
        </div>
      </div>
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Tgl Aktual Selesai</label>
          <input type="date" id="d-kons-tanggalAktualSelesai" value="${_escapeHtml(d.tanggalAktualSelesai || '')}" ${dis}/>
        </div>
        <div class="udetail-form-field">
          <label>Kontraktor</label>
          <input type="text" id="d-kons-kontraktor" value="${_escapeHtml(d.kontraktor || '')}" placeholder="Nama kontraktor / mandor" ${dis}/>
        </div>
      </div>
      <div class="udetail-form-field full">
        <label>Catatan Konstruksi</label>
        <textarea id="d-kons-catatanKonstruksi" rows="2" placeholder="Catatan opsional…" ${dis}>${_escapeHtml(d.catatanKonstruksi || '')}</textarea>
      </div>
    `;
  }

  function renderEstateForm(){
    const d = _currentDivisi.estate || {};
    const canEdit = _canEditTab('estate');
    const dis = canEdit ? '' : 'disabled';
    const banner = !canEdit ? `<div class="udetail-readonly-banner">🔒 Anda hanya bisa melihat data Estate (read-only).</div>` : '';
    const isPrioritas = _toBool(d.isPrioritas);

    return `
      ${banner}
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Status Huni</label>
          <select id="d-estate-statusHuni" ${dis}>${_selectOptionsHtml(ESTATE_HUNI_OPTIONS, d.statusHuni || 'belum_dihuni')}</select>
        </div>
        <div class="udetail-form-field">
          <label>Nama Penghuni</label>
          <input type="text" id="d-estate-penghuniNama" value="${_escapeHtml(d.penghuniNama || '')}" placeholder="Nama penghuni" ${dis}/>
        </div>
      </div>
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Tgl Mulai Dihuni</label>
          <input type="date" id="d-estate-tanggalMulaiHuni" value="${_escapeHtml(d.tanggalMulaiHuni || '')}" ${dis}/>
        </div>
        <div class="udetail-form-field">
          <label>Tgl Pengecekan Terakhir</label>
          <input type="date" id="d-estate-lastPengecekan" value="${_escapeHtml(d.lastPengecekan || '')}" ${dis}/>
        </div>
      </div>
      <div class="udetail-checkbox-row">
        <input type="checkbox" id="d-estate-isPrioritas" ${isPrioritas?'checked':''} ${dis}/>
        <label for="d-estate-isPrioritas">⭐ Prioritas Pengecekan Rutin</label>
      </div>
      <div class="udetail-form-field full">
        <label>Catatan Estate</label>
        <textarea id="d-estate-catatanEstate" rows="2" placeholder="Catatan opsional…" ${dis}>${_escapeHtml(d.catatanEstate || '')}</textarea>
      </div>
    `;
  }

  function renderLegalForm(){
    const d = _currentDivisi.legal || {};
    const canEdit = _canEditTab('legal');
    const dis = canEdit ? '' : 'disabled';
    const banner = !canEdit ? `<div class="udetail-readonly-banner">🔒 Anda hanya bisa melihat data Legal (read-only).</div>` : '';

    return `
      ${banner}
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Status Legal</label>
          <select id="d-legal-statusLegal" ${dis}>${_selectOptionsHtml(LEGAL_STATUS_OPTIONS, d.statusLegal || 'proses')}</select>
        </div>
        <div class="udetail-form-field">
          <label>Tipe Sertifikat</label>
          <select id="d-legal-tipeSertifikat" ${dis}>${_selectOptionsHtml(LEGAL_TIPE_SERT_OPTIONS, d.tipeSertifikat || '')}</select>
        </div>
      </div>
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>No. Sertifikat</label>
          <input type="text" id="d-legal-noSertifikat" value="${_escapeHtml(d.noSertifikat || '')}" placeholder="Nomor sertifikat" ${dis}/>
        </div>
        <div class="udetail-form-field">
          <label>Tgl Terbit Sertifikat</label>
          <input type="date" id="d-legal-tanggalTerbitSertifikat" value="${_escapeHtml(d.tanggalTerbitSertifikat || '')}" ${dis}/>
        </div>
      </div>
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Tgl PPJB</label>
          <input type="date" id="d-legal-tanggalPpjb" value="${_escapeHtml(d.tanggalPpjb || '')}" ${dis}/>
        </div>
        <div class="udetail-form-field">
          <label>Notaris PPJB</label>
          <input type="text" id="d-legal-notarisPpjb" value="${_escapeHtml(d.notarisPpjb || '')}" placeholder="Nama notaris PPJB" ${dis}/>
        </div>
      </div>
      <div class="udetail-form-row">
        <div class="udetail-form-field">
          <label>Tgl AJB</label>
          <input type="date" id="d-legal-tanggalAjb" value="${_escapeHtml(d.tanggalAjb || '')}" ${dis}/>
        </div>
        <div class="udetail-form-field">
          <label>Notaris AJB</label>
          <input type="text" id="d-legal-notarisAjb" value="${_escapeHtml(d.notarisAjb || '')}" placeholder="Nama notaris AJB" ${dis}/>
        </div>
      </div>
      <div class="udetail-form-field full">
        <label>Catatan Legal</label>
        <textarea id="d-legal-catatanLegal" rows="2" placeholder="Catatan opsional…" ${dis}>${_escapeHtml(d.catatanLegal || '')}</textarea>
      </div>
    `;
  }

  // ============================================================
  // COLLECT FORM DATA
  // ============================================================
  function collectSales(){
    const $ = id => document.getElementById(id);
    return {
      unitId: _currentUnit.id,
      status: $('d-sales-status') ? $('d-sales-status').value : '',
      hargaListing: $('d-sales-hargaListing') ? _parseRupiah($('d-sales-hargaListing').value) : '',
      hargaJual: $('d-sales-hargaJual') ? _parseRupiah($('d-sales-hargaJual').value) : '',
      pembeliNama: $('d-sales-pembeliNama') ? $('d-sales-pembeliNama').value.trim() : '',
      pembeliKontak: $('d-sales-pembeliKontak') ? $('d-sales-pembeliKontak').value.trim() : '',
      tanggalBooking: $('d-sales-tanggalBooking') ? $('d-sales-tanggalBooking').value : '',
      tanggalAkad: $('d-sales-tanggalAkad') ? $('d-sales-tanggalAkad').value : '',
      metodeBayar: $('d-sales-metodeBayar') ? $('d-sales-metodeBayar').value : '',
      kprBank: $('d-sales-kprBank') ? $('d-sales-kprBank').value.trim() : '',
      kprStatus: $('d-sales-kprStatus') ? $('d-sales-kprStatus').value : '',
      salesPic: $('d-sales-pic') ? $('d-sales-pic').value.trim() : '',
      catatanSales: $('d-sales-catatanSales') ? $('d-sales-catatanSales').value.trim() : ''
    };
  }

  function collectKonstruksi(){
    const $ = id => document.getElementById(id);
    return {
      unitId: _currentUnit.id,
      status: $('d-kons-status') ? $('d-kons-status').value : '',
      progresPersen: $('d-kons-progresPersen') ? Number($('d-kons-progresPersen').value) || 0 : 0,
      tanggalMulai: $('d-kons-tanggalMulai') ? $('d-kons-tanggalMulai').value : '',
      tanggalTargetSelesai: $('d-kons-tanggalTargetSelesai') ? $('d-kons-tanggalTargetSelesai').value : '',
      tanggalAktualSelesai: $('d-kons-tanggalAktualSelesai') ? $('d-kons-tanggalAktualSelesai').value : '',
      kontraktor: $('d-kons-kontraktor') ? $('d-kons-kontraktor').value.trim() : '',
      catatanKonstruksi: $('d-kons-catatanKonstruksi') ? $('d-kons-catatanKonstruksi').value.trim() : ''
    };
  }

  function collectEstate(){
    const $ = id => document.getElementById(id);
    return {
      unitId: _currentUnit.id,
      statusHuni: $('d-estate-statusHuni') ? $('d-estate-statusHuni').value : '',
      penghuniNama: $('d-estate-penghuniNama') ? $('d-estate-penghuniNama').value.trim() : '',
      tanggalMulaiHuni: $('d-estate-tanggalMulaiHuni') ? $('d-estate-tanggalMulaiHuni').value : '',
      isPrioritas: $('d-estate-isPrioritas') ? $('d-estate-isPrioritas').checked : false,
      lastPengecekan: $('d-estate-lastPengecekan') ? $('d-estate-lastPengecekan').value : '',
      catatanEstate: $('d-estate-catatanEstate') ? $('d-estate-catatanEstate').value.trim() : ''
    };
  }

  function collectLegal(){
    const $ = id => document.getElementById(id);
    return {
      unitId: _currentUnit.id,
      statusLegal: $('d-legal-statusLegal') ? $('d-legal-statusLegal').value : '',
      tipeSertifikat: $('d-legal-tipeSertifikat') ? $('d-legal-tipeSertifikat').value : '',
      noSertifikat: $('d-legal-noSertifikat') ? $('d-legal-noSertifikat').value.trim() : '',
      tanggalTerbitSertifikat: $('d-legal-tanggalTerbitSertifikat') ? $('d-legal-tanggalTerbitSertifikat').value : '',
      tanggalPpjb: $('d-legal-tanggalPpjb') ? $('d-legal-tanggalPpjb').value : '',
      notarisPpjb: $('d-legal-notarisPpjb') ? $('d-legal-notarisPpjb').value.trim() : '',
      tanggalAjb: $('d-legal-tanggalAjb') ? $('d-legal-tanggalAjb').value : '',
      notarisAjb: $('d-legal-notarisAjb') ? $('d-legal-notarisAjb').value.trim() : '',
      catatanLegal: $('d-legal-catatanLegal') ? $('d-legal-catatanLegal').value.trim() : ''
    };
  }

  // ============================================================
  // SAVE ALL
  // ============================================================
  function updateSaveButtonState(){
    const btn = document.getElementById('udetail-btn-save');
    if(!btn) return;
    const role = _getRole();
    // Strategi/viewer = read-only semua tab
    const readOnlyRoles = ['strategi','viewer'];
    if(readOnlyRoles.indexOf(role) >= 0){
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
    }
  }

  async function saveAll(){
    if(_isSaving) return;
    if(!_currentUnit) return;

    _isSaving = true;
    const btn = document.getElementById('udetail-btn-save');
    const info = document.getElementById('udetail-foot-info');
    if(btn){ btn.disabled = true; btn.textContent = '⏳ Menyimpan…'; }
    if(info){ info.textContent = ''; }

    // Collect dari tab YANG DI-RENDER saja (yang user lihat).
    // Tab yang tidak di-render = data divisi tetap utuh, tidak terganggu.
    // Backend pakai upsert per unitId, jadi aman.
    const payload = {};
    const visibleTabs = _getVisibleTabs();

    if(visibleTabs.indexOf('sales') >= 0 && _canEditTab('sales') && document.getElementById('d-sales-status')){
      payload.sales = [collectSales()];
    }
    if(visibleTabs.indexOf('konstruksi') >= 0 && _canEditTab('konstruksi') && document.getElementById('d-kons-status')){
      payload.konstruksi = [collectKonstruksi()];
    }
    if(visibleTabs.indexOf('estate') >= 0 && _canEditTab('estate') && document.getElementById('d-estate-statusHuni')){
      payload.estate = [collectEstate()];
    }
    if(visibleTabs.indexOf('legal') >= 0 && _canEditTab('legal') && document.getElementById('d-legal-statusLegal')){
      payload.legal = [collectLegal()];
    }

    // Tab yang aktif sekarang harus selalu di-collect ulang (mungkin user baru saja edit
    // dan baru pindah tab tanpa save). Kalau form belum ter-render (user tidak buka tab itu),
    // skip — datanya tetap utuh karena backend upsert by unitId.

    // Tapi kalau user hanya buka 1 tab dan edit di situ, kita perlu pastikan data tab lain
    // tidak hilang. Solusi: render dulu tab lain yang user bisa edit tapi belum dibuka,
    // collect data-nya, lalu kirim. Kalau form tab lain belum ter-render, skip.
    // Karena patch ini "manual save semua", kita ambil pendekatan simple:
    // hanya kirim tab yang ter-render. Sisanya backend tidak ubah.

    if(Object.keys(payload).length === 0){
      _toast('Tidak ada perubahan untuk disimpan.', 'info');
      if(btn){ btn.disabled = false; btn.textContent = '💾 Simpan Semua'; }
      _isSaving = false;
      return;
    }

    try {
      const res = await global.BM4Api.post('bulkSaveUnitDivisi', payload);
      if(!res || !res.success){
        throw new Error((res && res.message) || (res && res.error) || 'Gagal simpan');
      }
      const r = res.result || {};
      const totalOk = (r.sales?.ok||0) + (r.konstruksi?.ok||0) + (r.estate?.ok||0) + (r.legal?.ok||0);
      const totalFail = (r.sales?.fail||0) + (r.konstruksi?.fail||0) + (r.estate?.fail||0) + (r.legal?.fail||0);

      if(totalFail > 0){
        _toast(`⚠️ ${totalOk} divisi tersimpan, ${totalFail} gagal`, 'warning');
        console.warn('[patch-016] save errors:', res.errors);
      } else {
        _toast(`✅ Tersimpan untuk ${totalOk} divisi`, 'success');
      }

      // Refresh list di patch-015 supaya stat ter-update
      if(global.BM4Patch015 && typeof global.BM4Patch015.reload === 'function'){
        await global.BM4Patch015.reload();
      }

      closeModal();
    } catch(e){
      console.error('[patch-016] saveAll err:', e);
      _toast('Gagal simpan: ' + (e.message || e), 'error');
      if(info){ info.textContent = '❌ ' + (e.message || e); info.style.color = '#DC2626'; }
    } finally {
      if(btn){ btn.disabled = false; btn.textContent = '💾 Simpan Semua'; }
      _isSaving = false;
    }
  }

  // ============================================================
  // HOOK KE TABLE PATCH-015 — bikin nomor unit jadi link biru
  // ============================================================
  function makeNomorClickable(){
    // Cari semua row di table unit, ubah cell "nomor" jadi link
    const tbody = document.getElementById('unit-table-body');
    if(!tbody || !global.BM4Patch015) return;

    tbody.querySelectorAll('tr').forEach(tr => {
      // skip kalau cuma 1 cell (empty state)
      const tds = tr.querySelectorAll('td');
      if(tds.length < 3) return;

      // Kolom NOMOR ada di index 2 (setelah #, BLOK)
      const nomorTd = tds[2];
      if(!nomorTd || nomorTd.querySelector('.unit-link')) return;

      const nomor = nomorTd.textContent.trim();
      const blokTd = tds[1];
      const blok = blokTd ? blokTd.textContent.trim() : '';
      // Cari unit object via state patch-015
      const state = global.BM4Patch015.state();
      // tapi state cuma return summary — kita perlu list-nya
      // Solusi: cari dari edit button di row yang sama (data-id sudah ada)
      const editBtn = tr.querySelector('.unit-action-edit');
      const id = editBtn ? editBtn.dataset.id : null;

      const link = document.createElement('a');
      link.className = 'unit-link';
      link.textContent = nomor || '—';
      link.href = '#';
      link.onclick = (e) => {
        e.preventDefault();
        if(!id){ _toast('Unit ID tidak ditemukan', 'error'); return; }
        // Ambil unit object dari window (set oleh patch-015)
        const allUnit = (global.BM4Patch015 && global.BM4Patch015._unitList) ? global.BM4Patch015._unitList : null;
        let unit;
        if(allUnit){
          unit = allUnit.find(u => String(u.id) === String(id));
        }
        if(!unit){
          // Fallback: bikin minimal unit object
          unit = { id: id, blokNama: blok, nomor: nomor };
        }
        openModal(unit);
      };
      nomorTd.innerHTML = '';
      nomorTd.appendChild(link);
    });
  }

  // ============================================================
  // EXPOSE _unitList di patch-015 supaya patch-016 bisa akses
  // ============================================================
  function ensureUnitListAccessible(){
    // patch-015 menyimpan list di closure. Kita expose via state(), tapi state cuma summary.
    // Solusi: monkey-patch reload() supaya simpan list ke window.
    if(!global.BM4Patch015) return;
    if(global._patch016_listExposeHooked) return;
    global._patch016_listExposeHooked = true;

    // Cara: ambil list dari DOM table tiap kali makeNomorClickable jalan.
    // Atau pakai event listener untuk mutation di tbody.
    const tbody = document.getElementById('unit-table-body');
    if(tbody && global.MutationObserver){
      const obs = new MutationObserver(() => makeNomorClickable());
      obs.observe(tbody, { childList: true, subtree: false });
    }
  }

  // ============================================================
  // FETCH UNIT FROM API (fallback kalau tidak ada di state patch-015)
  // ============================================================
  async function _findUnitById(id){
    try {
      const res = await global.BM4Api.get('getUnit', { proyekId: _getProyekIdFallback() });
      if(res && res.success){
        return (res.data || []).find(u => String(u.id) === String(id));
      }
    } catch(e){ console.warn('[patch-016] _findUnitById err:', e); }
    return null;
  }

  function _getProyekIdFallback(){
    try {
      const state = JSON.parse(localStorage.getItem('bm4_app_state') || '{}');
      return state.proyek || state.currentProyekId || null;
    } catch(e){ return null; }
  }

  // ============================================================
  // INIT
  // ============================================================
  function init(){
    injectModalIfNeeded();
    ensureUnitListAccessible();

    // Initial pass
    setTimeout(makeNomorClickable, 500);
    setTimeout(makeNomorClickable, 2000);
    setTimeout(makeNomorClickable, 5000);

    // Periodic check during first 60s (defensive untuk timing race)
    let count = 0;
    const interval = setInterval(() => {
      count++;
      makeNomorClickable();
      if(count >= 30) clearInterval(interval); // 30 x 2s = 60s
    }, 2000);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose untuk debugging
  global.BM4Patch016 = {
    open: openModal,
    close: closeModal,
    state: () => ({
      unit: _currentUnit,
      divisi: _currentDivisi,
      activeTab: _activeTab,
      visibleTabs: _getVisibleTabs(),
      role: _getRole()
    })
  };

})(window);
