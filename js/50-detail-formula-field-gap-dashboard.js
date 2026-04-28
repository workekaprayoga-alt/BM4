// PDL, formula, field manager, gap, dashboard ranking, compare
// ============================================================
// [TAHAP3-IT1+IT2] Modal Detail Lengkap per Perumahan
// ============================================================
// Formula dengan bobot editable per komponen — disimpan di localStorage
const PDL_FORMULA_DEFAULTS = {
  product: {
    weights: {lt:25, lb:25, unit:25, launching:25},
    components: {
      lt: {label:'Luas Tanah terisi', check:(p,t)=>t.luasTanah && t.luasTanah.trim()},
      lb: {label:'Luas Bangunan terisi', check:(p,t)=>t.luasBangunan && t.luasBangunan.trim()},
      unit: {label:'Total unit > 0', check:(p,t)=>p.unit > 0},
      launching: {label:'Launching ≤ 3 tahun', check:(p,t)=>{
        const cur = new Date().getFullYear();
        return p.tahun && (cur - p.tahun) <= 3;
      }}
    }
  },
  price: {
    weights: {base:50, harga:20, tenor:10, dp:10, bank:10},
    components: {
      base: {label:'Base score', check:()=>true}, // selalu dapat
      harga: {label:'Harga Range terisi', check:(p,t)=>t.hargaRange && t.hargaRange.trim()},
      tenor: {label:'Tenor Dominan terisi', check:(p,t)=>t.tenorDominan && t.tenorDominan.trim()},
      dp: {label:'Uang Muka terisi', check:(p,t)=>t.uangMukaRange && t.uangMukaRange.trim()},
      bank: {label:'Bank Dominan terisi', check:(p,t)=>t.bankDominan && t.bankDominan.trim()}
    }
  },
  promotion: {
    weights: {promo:30, periode:10, bonus:20, iklan:30, billboard:10},
    components: {
      promo: {label:'Promo Aktif terisi', check:(p,t)=>{ const pr=t.promotion||{}; return pr.promoAktif && pr.promoAktif.trim(); }},
      periode: {label:'Periode Promo terisi', check:(p,t)=>{ const pr=t.promotion||{}; return pr.periode && pr.periode.trim(); }},
      bonus: {label:'Bonus Pembelian terisi', check:(p,t)=>{ const pr=t.promotion||{}; return pr.bonus && pr.bonus.trim(); }},
      iklan: {label:'Iklan Platform (per kanal, max 3)', calc:(p,t,w)=>{
        const pr = t.promotion||{};
        if(!pr.iklanPlatform || !pr.iklanPlatform.trim()) return 0;
        const nCh = _parseComplexItems(pr.iklanPlatform).length;
        return Math.min(w, Math.round(nCh * (w/3)));
      }},
      billboard: {label:'Billboard aktif (Ya/Yes)', check:(p,t)=>{ const pr=t.promotion||{}; return pr.billboard && /ya|yes/i.test(pr.billboard); }}
    }
  },
  performance: {
    weights: {progress:60, trend:25, historis:15},
    components: {
      progress: {label:'Progress % (0-100 proporsional)', calc:(p,t,w)=>{
        const pct = p.unit > 0 ? (p.realisasi || 0) / p.unit : 0;
        return Math.round(pct * w);
      }},
      trend: {label:'Trend naik(100%)/flat(60%)/turun(20%)', calc:(p,t,w)=>{
        const bulanan = t.realisasiBulanan || [];
        if(bulanan.length < 4) return 0;
        const trend = _calcTaperaTrend(bulanan);
        if(trend.dir === 'up') return w;
        if(trend.dir === 'flat') return Math.round(w*0.6);
        if(trend.dir === 'down') return Math.round(w*0.2);
        return 0;
      }},
      historis: {label:'Data bulanan ≥ 3', check:(p,t)=>{
        const b = t.realisasiBulanan || [];
        return b.length >= 3;
      }}
    }
  },
  gtm: {
    weights: {mkt:30, kanal:20, agent:25, feeMkt:10, feeAgent:10, brand:5},
    components: {
      mkt: {label:'Marketing in-house (5+ org = max)', calc:(p,t,w)=>{
        const gtm = t.gtm || {};
        if(gtm.marketingInhouse == null) return 0;
        return Math.min(w, Math.round(gtm.marketingInhouse * (w/5)));
      }},
      kanal: {label:'Struktur Kanal (agent=100%, lain=50%)', calc:(p,t,w)=>{
        const gtm = t.gtm || {};
        if(!gtm.strukturKanal) return 0;
        if(/agent/i.test(gtm.strukturKanal)) return w;
        return Math.round(w*0.5);
      }},
      agent: {label:'Jumlah agent (10+ = max)', calc:(p,t,w)=>{
        const gtm = t.gtm || {};
        if(gtm.jumlahAgent == null || gtm.jumlahAgent <= 0) return 0;
        return Math.min(w, Math.round(gtm.jumlahAgent * (w/10)));
      }},
      feeMkt: {label:'Fee Marketing terisi', check:(p,t)=>{ const g=t.gtm||{}; return g.feeMarketing && g.feeMarketing.trim(); }},
      feeAgent: {label:'Fee Agent terisi', check:(p,t)=>{ const g=t.gtm||{}; return g.feeAgent && g.feeAgent.trim(); }},
      brand: {label:'Brand Developer terisi', check:(p,t)=>{ const g=t.gtm||{}; return g.brandDeveloper && g.brandDeveloper.trim(); }}
    }
  }
};

// Active weights (editable, loaded from localStorage)
let PDL_WEIGHTS = {};
(function _loadPdlWeights(){
  try{
    const raw = localStorage.getItem('bm4_pdl_weights');
    const saved = raw ? JSON.parse(raw) : null;
    if(saved && typeof saved === 'object'){
      // Merge dengan defaults untuk safety (kalau ada section/key baru)
      Object.keys(PDL_FORMULA_DEFAULTS).forEach(sec => {
        PDL_WEIGHTS[sec] = {...PDL_FORMULA_DEFAULTS[sec].weights, ...(saved[sec]||{})};
      });
    } else {
      Object.keys(PDL_FORMULA_DEFAULTS).forEach(sec => {
        PDL_WEIGHTS[sec] = {...PDL_FORMULA_DEFAULTS[sec].weights};
      });
    }
  }catch(_){
    Object.keys(PDL_FORMULA_DEFAULTS).forEach(sec => {
      PDL_WEIGHTS[sec] = {...PDL_FORMULA_DEFAULTS[sec].weights};
    });
  }
})();
function _savePdlWeights(){
  try{ localStorage.setItem('bm4_pdl_weights', JSON.stringify(PDL_WEIGHTS)); }catch(_){}
}

// Generic calculator — baca weights aktif + spec dari PDL_FORMULA_DEFAULTS
function _calcSectionScore(sectionId, p){
  const spec = PDL_FORMULA_DEFAULTS[sectionId];
  if(!spec) return 0;
  const weights = PDL_WEIGHTS[sectionId] || spec.weights;
  const t = p.tapera || {};
  let score = 0;
  Object.keys(spec.components).forEach(key => {
    const comp = spec.components[key];
    const w = weights[key] || 0;
    if(w <= 0) return;
    if(typeof comp.calc === 'function'){
      score += comp.calc(p, t, w);
    } else if(typeof comp.check === 'function'){
      if(comp.check(p, t)) score += w;
    }
  });
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Place tetap pakai formula existing (aksesibilitas + fasilitas)
function _calcPlaceScore(p){
  const sd = p._scoreDetail || calcScoreFull(p);
  return Math.round(sd.aksesibilitas * 0.5 + sd.fasilitas * 0.5);
}

// Wrapper: hitung semua skor section + overall average
function _calcAllSectionScores(p){
  const place = _calcPlaceScore(p);
  const product = _calcSectionScore('product', p);
  const price = _calcSectionScore('price', p);
  const promotion = _calcSectionScore('promotion', p);
  const performance = _calcSectionScore('performance', p);
  const gtm = _calcSectionScore('gtm', p);
  const avg = Math.round((place + product + price + promotion + performance + gtm) / 6);
  return {place, product, price, promotion, performance, gtm, avg};
}

// ============================================================
// [TAHAP3-IT2] Formula Editor UI — di Hub Formula tab "Formula Detail"
// ============================================================
const PDL_FE_SECTION_META = {
  product:     {emoji:'🏠', name:'Product'},
  price:       {emoji:'💰', name:'Price'},
  promotion:   {emoji:'📢', name:'Promotion'},
  performance: {emoji:'📈', name:'Performance'},
  gtm:         {emoji:'👔', name:'Go-to-Market'}
};

function renderPdlFormulaEditor(){
  const host = document.getElementById('pdl-formula-editor');
  if(!host) return;
  host.innerHTML = Object.keys(PDL_FE_SECTION_META).map(sec => {
    const meta = PDL_FE_SECTION_META[sec];
    const spec = PDL_FORMULA_DEFAULTS[sec];
    const weights = PDL_WEIGHTS[sec] || spec.weights;
    const total = Object.values(weights).reduce((a,b)=>a+(Number(b)||0), 0);
    const isOk = total === 100;
    const rowsHtml = Object.keys(spec.components).map(key => {
      const comp = spec.components[key];
      const w = weights[key] || 0;
      const pct = Math.min(100, Math.max(0, w));
      return `<div class="pdl-fe-row">
        <div class="pdl-fe-row-lbl">${escapeHtml(comp.label)}</div>
        <div class="pdl-fe-row-bar"><div class="pdl-fe-row-bar-fill" style="width:${pct}%"></div></div>
        <input type="number" class="pdl-fe-row-input" min="0" max="100" step="1"
          value="${w}"
          data-pdl-sec="${sec}" data-pdl-key="${key}"
          oninput="onPdlWeightInput('${sec}','${key}', this.value)">
      </div>`;
    }).join('');
    return `<div class="pdl-fe-sec" id="pdl-fe-sec-${sec}">
      <div class="pdl-fe-head">
        <div class="pdl-fe-title">${meta.emoji} ${meta.name}</div>
        <div class="pdl-fe-total ${isOk?'ok':'warn'}" id="pdl-fe-total-${sec}">Total: ${total}/100</div>
      </div>
      <div class="pdl-fe-body">
        ${rowsHtml}
      </div>
      <div class="pdl-fe-hint">Bobot menentukan berapa poin maksimal komponen ini menyumbang ke skor akhir (0-100). Total bobot idealnya = 100.</div>
    </div>`;
  }).join('');
}

function onPdlWeightInput(sec, key, rawVal){
  let val = parseInt(rawVal);
  if(isNaN(val)) val = 0;
  if(val < 0) val = 0;
  if(val > 100) val = 100;
  if(!PDL_WEIGHTS[sec]) PDL_WEIGHTS[sec] = {...PDL_FORMULA_DEFAULTS[sec].weights};
  PDL_WEIGHTS[sec][key] = val;
  // Update total badge
  const total = Object.values(PDL_WEIGHTS[sec]).reduce((a,b)=>a+(Number(b)||0), 0);
  const totalEl = document.getElementById(`pdl-fe-total-${sec}`);
  if(totalEl){
    totalEl.textContent = `Total: ${total}/100`;
    totalEl.classList.toggle('ok', total === 100);
    totalEl.classList.toggle('warn', total !== 100);
  }
  // Update bar fill untuk row yang diubah
  const input = document.querySelector(`input[data-pdl-sec="${sec}"][data-pdl-key="${key}"]`);
  if(input){
    const bar = input.parentElement.querySelector('.pdl-fe-row-bar-fill');
    if(bar) bar.style.width = Math.min(100,val) + '%';
  }
}

function savePdlFormulas(){
  // Warn kalau ada total != 100
  const warnings = [];
  Object.keys(PDL_WEIGHTS).forEach(sec => {
    const total = Object.values(PDL_WEIGHTS[sec]).reduce((a,b)=>a+(Number(b)||0), 0);
    if(total !== 100) warnings.push(`${PDL_FE_SECTION_META[sec].name}: ${total}/100`);
  });
  if(warnings.length){
    if(!confirm(`⚠ Ada section dengan total bobot ≠ 100:\n\n${warnings.join('\n')}\n\nSkor masih bisa dihitung (akan di-clamp ke 0-100), tapi hasilnya bisa tidak konsisten. Simpan tetap?`)) return;
  }
  _savePdlWeights();
  showToast('✓ Formula detail disimpan');
  // Kalau modal PDL lagi terbuka, refresh
  const ov = document.getElementById('pdl-overlay');
  if(ov && ov.classList.contains('open') && _pdlCurrentId != null){
    _renderPdlBody(_pdlCurrentId);
  }
}

function resetPdlFormulasDefault(){
  if(!confirm('Reset semua formula ke default? Perubahanmu akan hilang.')) return;
  Object.keys(PDL_FORMULA_DEFAULTS).forEach(sec => {
    PDL_WEIGHTS[sec] = {...PDL_FORMULA_DEFAULTS[sec].weights};
  });
  _savePdlWeights();
  renderPdlFormulaEditor();
  showToast('↺ Formula direset ke default');
  const ov = document.getElementById('pdl-overlay');
  if(ov && ov.classList.contains('open') && _pdlCurrentId != null){
    _renderPdlBody(_pdlCurrentId);
  }
}

// ============================================================
// [TAHAP4B-1] FIELD MANAGER — Data Model & Render
// ============================================================

// [TAHAP4B-2] State Field Manager — disimpan di localStorage
// customFields: field yang BM tambahkan (custom atau dari template)
// hiddenFields: ID field yang disembunyikan (baik bawaan maupun custom)
// enabledTemplates: ID template yang sudah di-enable (supaya di library ditandai)
// fieldOverrides: edit label untuk field bawaan/custom
let FM_STATE = {
  customFields: {place:[], product:[], price:[], promotion:[], performance:[], gtm:[]},
  hiddenFields: [],
  enabledTemplates: [],
  fieldOverrides: {}
};

(function _loadFmState(){
  try{
    const raw = localStorage.getItem('bm4_fm_state');
    if(!raw) return;
    const saved = JSON.parse(raw);
    if(saved && typeof saved === 'object'){
      if(saved.customFields) FM_STATE.customFields = {...FM_STATE.customFields, ...saved.customFields};
      if(Array.isArray(saved.hiddenFields)) FM_STATE.hiddenFields = saved.hiddenFields;
      if(Array.isArray(saved.enabledTemplates)) FM_STATE.enabledTemplates = saved.enabledTemplates;
      if(saved.fieldOverrides && typeof saved.fieldOverrides === 'object') FM_STATE.fieldOverrides = saved.fieldOverrides;
    }
  }catch(_){}
})();

function _saveFmState(){
  try{ localStorage.setItem('bm4_fm_state', JSON.stringify(FM_STATE)); }catch(_){}
}

// Helper: dapatkan semua field aktif (bawaan + custom, minus hidden) untuk section
function _getFmActiveFields(sec){
  const bawaan = FM_BAWAAN_FIELDS[sec] || [];
  const custom = FM_STATE.customFields[sec] || [];
  const all = [...bawaan.map(f=>({...f, source:'bawaan'})), ...custom.map(f=>({...f, source:'custom'}))];
  // Apply overrides (label edits)
  return all.map(f => {
    const ov = FM_STATE.fieldOverrides[f.id];
    return ov ? {...f, ...ov, id:f.id, source:f.source} : f;
  });
}

// Helper: cek apakah field di-hide
function _isFieldHidden(id){ return FM_STATE.hiddenFields.includes(id); }

// Section meta
const FM_SECTION_META = {
  place:       {emoji:'📍', name:'Place'},
  product:     {emoji:'🏠', name:'Product'},
  price:       {emoji:'💰', name:'Price'},
  promotion:   {emoji:'📢', name:'Promotion'},
  performance: {emoji:'📈', name:'Performance'},
  gtm:         {emoji:'👔', name:'Go-to-Market'}
};

// BAWAAN — Field yang sudah ada di app, dikelompokkan per section
// Semua field ini tersedia di form Tapera & Modal Detail Lengkap
// [FIX B] POI (RS, Kampus, Mall, dll) TIDAK dicantumkan di Place karena dikelola
//         di halaman POI Management sendiri — menghindari fungsi dobel.
const FM_BAWAAN_FIELDS = {
  place: [
    // Place section cuma punya jarak-ke-anchor sebagai field non-POI
    // POI lainnya dikelola di POI Management terpisah
    {id:'dist_anchor',  label:'⭐ Jarak ke Anchor',  type:'number_km', desc:'Jarak ke perumahan anchor (via jalan) — dihitung otomatis', inScore:false}
  ],
  product: [
    {id:'tpr_lt',       label:'📐 Luas Tanah',       type:'text',      desc:'Range atau rata-rata luas tanah (m²)', inScore:true},
    {id:'tpr_lb',       label:'📐 Luas Bangunan',    type:'text',      desc:'Range atau rata-rata luas bangunan (m²)', inScore:true}
  ],
  price: [
    {id:'tpr_harga',    label:'💰 Harga Range',      type:'text',      desc:'Range harga jual (contoh: 150-175 Jt)', inScore:true},
    {id:'tpr_tenor',    label:'📅 Tenor KPR',        type:'text',      desc:'Tenor dominan (contoh: 15 / 20 thn)', inScore:true},
    {id:'tpr_um',       label:'💳 Uang Muka',        type:'text',      desc:'Range DP (contoh: 1-5%)', inScore:true},
    {id:'tpr_bank',     label:'🏦 Bank Dominan',     type:'text',      desc:'Bank KPR yang dominan (contoh: BTN, BRI)', inScore:true}
  ],
  promotion: [
    {id:'tpr_promo_aktif',   label:'🎁 Promo Aktif',     type:'list',    desc:'Daftar promo aktif (comma-separated)', inScore:true},
    {id:'tpr_promo_periode', label:'📅 Periode Promo',   type:'text',    desc:'Periode berlakunya promo', inScore:true},
    {id:'tpr_promo_bonus',   label:'🎉 Bonus Pembelian', type:'list',    desc:'Bonus saat beli (kanopi, AC, dll)', inScore:true},
    {id:'tpr_promo_iklan',   label:'📱 Iklan di Platform', type:'list',  desc:'Kanal iklan (Rumah123, OLX, dll)', inScore:true},
    {id:'tpr_promo_bb',      label:'📢 Billboard/Spanduk', type:'text',  desc:'Billboard aktif atau tidak', inScore:true}
  ],
  performance: [
    {id:'proj_unit',       label:'Total Unit',           type:'number', desc:'Total unit proyek', inScore:false},
    {id:'proj_realisasi',  label:'Realisasi',            type:'number', desc:'Unit yang sudah terjual', inScore:true},
    {id:'proj_progress',   label:'Progress %',           type:'percent',desc:'Persentase serap unit', inScore:true},
    {id:'tpr_avg',         label:'📊 Rata²/bulan',       type:'number', desc:'Rata-rata realisasi per bulan', inScore:false},
    {id:'tpr_trend',       label:'📈 Trend 3-bulan',     type:'text',   desc:'Trend naik/turun 3 bulan terakhir', inScore:true},
    {id:'tpr_total',       label:'Total Realisasi',      type:'number', desc:'Total realisasi Tapera kumulatif', inScore:false},
    {id:'tpr_flpp',        label:'Nominal FLPP',         type:'text',   desc:'Nominal FLPP (M)', inScore:false}
  ],
  gtm: [
    {id:'tpr_gtm_mkt',     label:'👥 Marketing In-house',type:'number',  desc:'Jumlah marketing in-house', inScore:true},
    {id:'tpr_gtm_kanal',   label:'🏢 Struktur Kanal',    type:'text',    desc:'In-house / Agent / Kombinasi', inScore:true},
    {id:'tpr_gtm_agent',   label:'🤝 Jumlah Agent',      type:'number',  desc:'Jumlah agent/mitra jualan', inScore:true},
    {id:'tpr_gtm_fee_mkt', label:'💵 Fee Marketing',     type:'text',    desc:'Fee/komisi marketing (% atau Rp/unit)', inScore:true},
    {id:'tpr_gtm_fee_agt', label:'💵 Fee Agent',         type:'text',    desc:'Fee/komisi agent', inScore:true},
    {id:'tpr_gtm_dev',     label:'🏪 Brand Developer',   type:'text',    desc:'Nama developer/perusahaan', inScore:true}
  ]
};

// LIBRARY TEMPLATE — Field siap pakai, belum aktif
// Dari daftar 88 field awal yang belum diimplementasi
const FM_TEMPLATE_FIELDS = {
  place: [
    {id:'tpl_posisi_jalan',  label:'🛣️ Posisi terhadap jalan', type:'dropdown', options:['Pinggir jalan utama','Masuk gang','Sekunder','Dalam perumahan'], desc:'Dropdown posisi lokasi'},
    {id:'tpl_lebar_jalan',   label:'📏 Lebar jalan masuk',      type:'dropdown', options:['1 mobil','2 mobil','2 mobil + shoulder'], desc:'Dropdown kapasitas jalan'},
    {id:'tpl_kondisi_jalan', label:'🛤️ Kondisi jalan',         type:'dropdown', options:['Aspal mulus','Aspal rusak','Beton','Tanah'], desc:'Dropdown kondisi jalan'},
    {id:'tpl_area_banjir',   label:'🌊 Area banjir?',           type:'yesno',    desc:'Ya/Tidak'},
    {id:'tpl_view',          label:'🏞️ View sekitar',          type:'text',     desc:'Gunung/sawah/pabrik/pemukiman'},
    {id:'tpl_gmaps_rating',  label:'⭐ Rating Google Maps',     type:'number',   desc:'Rating 0-5 dari review Google'}
  ],
  product: [
    {id:'tpl_tipe_rumah',    label:'🏠 Tipe rumah tersedia',    type:'list',     desc:'List tipe (30/60, 36/72, dll)'},
    {id:'tpl_jml_kt',        label:'🛏️ Jumlah KT',             type:'number',   desc:'Jumlah kamar tidur'},
    {id:'tpl_jml_km',        label:'🚿 Jumlah KM',              type:'number',   desc:'Jumlah kamar mandi'},
    {id:'tpl_material',      label:'🧱 Material dinding',       type:'dropdown', options:['Bata merah','Hebel','Batako'], desc:'Dropdown material'},
    {id:'tpl_atap',          label:'🏚️ Material atap',         type:'dropdown', options:['Genteng tanah','Beton','Metal','Lainnya'], desc:'Dropdown atap'},
    {id:'tpl_lantai',        label:'⬜ Material lantai',        type:'dropdown', options:['Keramik','Granit','Polish','Plester'], desc:'Dropdown lantai'},
    {id:'tpl_fasilitas',     label:'🏊 Fasilitas perumahan',   type:'multi',    options:['Gerbang','Satpam 24j','CCTV','Kolam renang','Masjid','Taman','Jogging track','Playground','Sport center','Club house'], desc:'Multi-checkbox fasilitas'},
    {id:'tpl_legalitas',     label:'📄 Legalitas',              type:'dropdown', options:['SHM','HGB','HGB+Strata','AJB'], desc:'Dropdown sertifikat'},
    {id:'tpl_imb',           label:'📜 Status IMB/PBG',         type:'dropdown', options:['Sudah','Proses','Belum'], desc:'Dropdown status IMB'}
  ],
  price: [
    {id:'tpl_harga_per_tipe',label:'💵 Harga per tipe',         type:'list',     desc:'Harga tiap tipe (contoh: 30/60:150Jt, 36/72:175Jt)'},
    {id:'tpl_dp_standar',    label:'💳 DP Standar',             type:'text',     desc:'DP default (contoh: 5% atau 10Jt)'},
    {id:'tpl_dp_promo',      label:'💳 DP Promo',               type:'text',     desc:'DP saat ada promo'},
    {id:'tpl_cicilan',       label:'📅 Cicilan per bulan',      type:'text',     desc:'Range cicilan bulanan'},
    {id:'tpl_skema_kpr',     label:'🏦 Skema KPR',              type:'multi',    options:['FLPP','BP2BT','KPR Subsidi','KPR Konvensional'], desc:'Skema KPR yang tersedia'},
    {id:'tpl_biaya_tambahan',label:'💸 Biaya tambahan',         type:'text',     desc:'Biaya AJB, BPHTB, notaris'}
  ],
  promotion: [
    {id:'tpl_tgl_mulai_promo',label:'📅 Tanggal mulai promo',   type:'date',     desc:'Tanggal mulai berlakunya'},
    {id:'tpl_tgl_akhir_promo',label:'📅 Tanggal akhir promo',   type:'date',     desc:'Tanggal berakhirnya'},
    {id:'tpl_event',          label:'🎪 Event/gathering',        type:'text',    desc:'Open house, pameran, dll'},
    {id:'tpl_hadiah_undian',  label:'🎁 Hadiah undian',          type:'text',    desc:'Grand prize undian (contoh: mobil tiap 100 unit)'},
    {id:'tpl_frek_sosmed',    label:'📱 Frekuensi sosmed',       type:'dropdown', options:['Harian','Mingguan','Jarang','Tidak aktif'], desc:'Seberapa aktif posting sosmed'},
    {id:'tpl_follower_ig',    label:'👥 Follower IG',            type:'number',  desc:'Jumlah follower Instagram'}
  ],
  performance: [
    {id:'tpl_proyeksi_soldout',label:'📊 Proyeksi sold-out',    type:'text',     desc:'Estimasi waktu habis unit'},
    {id:'tpl_gap_launching',   label:'⏱️ Gap launching-first sale', type:'number',  desc:'Bulan dari launching ke first sale'},
    {id:'tpl_booking_aktif',   label:'📋 Booking/NUP aktif',    type:'number',   desc:'Jumlah booking yang belum akad'},
    {id:'tpl_backout_rate',    label:'❌ Pembatalan rate',       type:'text',    desc:'% atau jumlah pembatalan'}
  ],
  gtm: [
    {id:'tpl_jml_agent',       label:'🤝 Jumlah agent/mitra',   type:'number',   desc:'Total agent dari semua tingkat'},
    {id:'tpl_reward_sys',      label:'🎯 Sistem reward',         type:'text',    desc:'Deskripsi reward (contoh: Komisi 1.5% + bonus 500rb/unit)'},
    {id:'tpl_showroom',        label:'🏢 Jumlah showroom',       type:'number',  desc:'Jumlah kantor pemasaran'},
    {id:'tpl_jam_buka',        label:'🕘 Jam buka showroom',    type:'text',     desc:'Contoh: 09:00-17:00'},
    {id:'tpl_thn_berdiri',     label:'📆 Tahun berdiri developer', type:'number',desc:'Tahun perusahaan berdiri'},
    {id:'tpl_reputation',      label:'👤 Reputation signal',    type:'dropdown', options:['Baik','Netral','Ada isu'], desc:'Dropdown reputasi developer'}
  ]
};

// Type labels untuk display
const FM_TYPE_LABELS = {
  text:'Teks', number:'Angka', number_km:'Angka (km)', percent:'Persen %',
  dropdown:'Dropdown', multi:'Multi-check', yesno:'Ya/Tidak', list:'List (,)', date:'Tanggal'
};

// State Field Manager (active section tab)
let _fmCurrentSection = 'place';

// Render tab navigation section
function _renderFmSectionNav(){
  const nav = document.getElementById('fm-section-nav');
  if(!nav) return;
  nav.innerHTML = Object.keys(FM_SECTION_META).map(sec => {
    const meta = FM_SECTION_META[sec];
    const n = (FM_BAWAAN_FIELDS[sec]||[]).length;
    const isActive = sec === _fmCurrentSection;
    return `<button class="fm-sec-btn ${isActive?'active':''}" onclick="fmSwitchSection('${sec}')">${meta.emoji} ${meta.name}<span class="fm-sec-count">(${n})</span></button>`;
  }).join('');
}

function fmSwitchSection(sec){
  _fmCurrentSection = sec;
  _renderFmSectionNav();
  _renderFmActivePanel();
  _renderFmTemplatePanel();
}

// Render panel field aktif (bawaan + custom, termasuk yang di-hide ditandai)
function _renderFmActivePanel(){
  const host = document.getElementById('fm-active-panel');
  if(!host) return;
  const sec = _fmCurrentSection;
  const meta = FM_SECTION_META[sec];
  const fields = _getFmActiveFields(sec);
  // [FIX B] Info box khusus Place: POI tidak muncul di sini
  const placeInfoBox = sec === 'place' ? `<div style="padding:10px 13px;background:#EFF6FF;border-bottom:1px solid var(--border);font-size:10px;color:#1D4ED8;line-height:1.5;">
    💡 <b>POI (RS, Kampus, Mall, Transportasi, Pemerintahan, Industri, Ruang Publik)</b> tidak muncul di sini karena dikelola di halaman <b>POI Management</b> tersendiri. Field Manager hanya untuk mengatur field data tambahan.
  </div>` : '';
  const visibleCount = fields.filter(f=>!_isFieldHidden(f.id)).length;
  const rowsHtml = fields.length ? fields.map(f => {
    const typeLabel = FM_TYPE_LABELS[f.type] || f.type;
    const inScore = f.inScore;
    const isHidden = _isFieldHidden(f.id);
    const isCustom = f.source === 'custom';
    const badge = isCustom
      ? `<span class="fm-badge fm-badge-custom">custom</span>`
      : `<span class="fm-badge fm-badge-bawaan">bawaan</span>`;
    const hiddenBadge = isHidden ? `<span class="fm-badge fm-badge-hidden">disembunyikan</span>` : '';
    return `<div class="fm-row ${isHidden?'hidden-field':''}" data-field-id="${f.id}">
      <div class="fm-row-drag" title="Drag untuk urutkan (segera)">⋮⋮</div>
      <div>
        <div class="fm-row-label">${f.label}${badge}${hiddenBadge}</div>
        <div class="fm-row-desc">${escapeHtml(f.desc||'')}</div>
      </div>
      <div class="fm-type-pill">${typeLabel}</div>
      <div class="fm-score-status ${inScore?'in':'out'}">${inScore?'✓ ke skor':'— display'}</div>
      <div class="fm-actions">
        <button class="fm-btn-icon" title="Edit label" onclick="fmOpenEditModal('${f.id}','${sec}')">✎</button>
        <button class="fm-btn-icon ${isHidden?'active-eye':''}" title="${isHidden?'Tampilkan lagi':'Sembunyikan'}" onclick="fmToggleHide('${f.id}','${sec}')">${isHidden?'👁‍🗨':'👁'}</button>
        <button class="fm-btn-icon del" title="${isCustom?'Hapus field':'Field bawaan tidak bisa dihapus — gunakan Sembunyikan'}" onclick="fmDeleteField('${f.id}','${sec}','${f.source}')">🗑</button>
      </div>
    </div>`;
  }).join('') : `<div class="fm-empty">Belum ada field aktif di section ini.</div>`;
  host.innerHTML = `<div class="fm-panel">
    <div class="fm-panel-head">
      <div>
        <div class="fm-panel-title">${meta.emoji} ${meta.name} — Field Aktif</div>
        <div class="fm-panel-sub">${fields.length} field total (${visibleCount} tampil) — muncul di form input, Vs Anchor, dan Detail Lengkap</div>
      </div>
      <button class="fm-add-btn" onclick="fmOpenCustomWizard('${sec}')" title="Tambah field custom">+ Tambah Custom</button>
    </div>
    ${placeInfoBox}
    ${rowsHtml}
  </div>`;
}

// Render panel template library
function _renderFmTemplatePanel(){
  const host = document.getElementById('fm-template-panel');
  if(!host) return;
  const sec = _fmCurrentSection;
  const meta = FM_SECTION_META[sec];
  const templates = FM_TEMPLATE_FIELDS[sec] || [];
  const rowsHtml = templates.length ? templates.map(t => {
    const typeLabel = FM_TYPE_LABELS[t.type] || t.type;
    const extraDesc = t.options ? ` · ${t.options.slice(0,3).join(' / ')}${t.options.length>3?'...':''}` : '';
    const isEnabled = FM_STATE.enabledTemplates.includes(t.id);
    const btn = isEnabled
      ? `<button class="fm-tpl-enable-btn disabled" disabled title="Sudah aktif">✓ Aktif</button>`
      : `<button class="fm-tpl-enable-btn" onclick="fmEnableTemplate('${t.id}','${sec}')" title="Aktifkan field ini">+ Enable</button>`;
    return `<div class="fm-tpl-row ${isEnabled?'hidden-field':''}" data-tpl-id="${t.id}">
      <div>
        <div class="fm-row-label">${t.label}</div>
        <div class="fm-row-desc">${escapeHtml(t.desc||'')}${extraDesc}</div>
      </div>
      <div class="fm-type-pill">${typeLabel}</div>
      ${btn}
    </div>`;
  }).join('') : `<div class="fm-empty">Tidak ada template untuk section ini.</div>`;
  host.innerHTML = `<div class="fm-panel">
    <div class="fm-panel-head">
      <div>
        <div class="fm-panel-title">🧰 Library Template — ${meta.name}</div>
        <div class="fm-panel-sub">Field siap pakai. Klik "+ Enable" untuk aktifkan.</div>
      </div>
    </div>
    ${rowsHtml}
  </div>`;
}

// ============================================================
// [TAHAP4B-2] Field Manager — Action Handlers (Modal wizard)
// ============================================================

let _fmwContext = null; // context data untuk wizard

function openFmWizard(title, bodyHtml, footerHtml){
  document.getElementById('fmw-title').textContent = title;
  document.getElementById('fmw-body').innerHTML = bodyHtml;
  document.getElementById('fmw-footer').innerHTML = footerHtml;
  document.getElementById('fmw-overlay').classList.add('open');
}
function closeFmWizard(){
  document.getElementById('fmw-overlay').classList.remove('open');
  _fmwContext = null;
}
// ESC handler
document.addEventListener('keydown', function(e){
  if(e.key==='Escape'){
    const ov = document.getElementById('fmw-overlay');
    if(ov && ov.classList.contains('open')) closeFmWizard();
  }
});

// === ENABLE TEMPLATE — aktifkan template jadi custom field ===
function fmEnableTemplate(tplId, sec){
  const tpl = (FM_TEMPLATE_FIELDS[sec]||[]).find(t=>t.id===tplId);
  if(!tpl) return;
  _fmwContext = {mode:'enable_tpl', sec, tpl};
  const optsDesc = tpl.options ? `<div style="margin-top:6px;font-size:10px;color:var(--muted);"><b>Opsi:</b> ${tpl.options.join(', ')}</div>` : '';
  const body = `
    <div class="fmw-info-box">
      Template akan di-enable sebagai field aktif di section <b>${FM_SECTION_META[sec].name}</b>.
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Label field <span class="fmw-label-hint">(bisa diedit)</span></label>
      <input type="text" class="fmw-input" id="fmw-label" value="${escapeHtml(tpl.label)}" />
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Deskripsi</label>
      <textarea class="fmw-textarea" id="fmw-desc">${escapeHtml(tpl.desc||'')}</textarea>
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Tipe input</label>
      <div style="padding:7px 10px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--muted);font-family:'DM Mono',monospace;">${FM_TYPE_LABELS[tpl.type]||tpl.type}</div>
      ${optsDesc}
    </div>
    <div class="fmw-field">
      <div class="fmw-checkbox-row">
        <input type="checkbox" id="fmw-inscore" />
        <label for="fmw-inscore">Masukkan ke perhitungan skor section</label>
      </div>
    </div>
    <div class="fmw-field">
      <div class="fmw-checkbox-row">
        <input type="checkbox" id="fmw-tovsa" checked />
        <label for="fmw-tovsa">Tampilkan di tabel Vs Anchor (direkomendasikan)</label>
      </div>
    </div>
  `;
  const footer = `
    <button class="fmw-btn-cancel" onclick="closeFmWizard()">Batal</button>
    <button class="fmw-btn-primary" onclick="fmConfirmEnableTemplate()">✓ Enable Field</button>
  `;
  openFmWizard(`➕ Enable Template: ${tpl.label}`, body, footer);
}

function fmConfirmEnableTemplate(){
  if(!_fmwContext || _fmwContext.mode !== 'enable_tpl') return;
  const {sec, tpl} = _fmwContext;
  const label = document.getElementById('fmw-label').value.trim() || tpl.label;
  const desc = document.getElementById('fmw-desc').value.trim() || tpl.desc || '';
  const inScore = document.getElementById('fmw-inscore').checked;
  const toVsa = document.getElementById('fmw-tovsa').checked;
  // Build field baru
  const newField = {
    id: tpl.id,  // pakai id template (stabil)
    label, desc,
    type: tpl.type,
    options: tpl.options || null,
    inScore
  };
  if(!FM_STATE.customFields[sec]) FM_STATE.customFields[sec] = [];
  // Cek duplikasi
  if(FM_STATE.customFields[sec].some(f=>f.id===newField.id)){
    alert('Field dengan ID ini sudah ada. Tidak bisa enable dua kali.');
    return;
  }
  FM_STATE.customFields[sec].push(newField);
  if(!FM_STATE.enabledTemplates.includes(tpl.id)) FM_STATE.enabledTemplates.push(tpl.id);
  _saveFmState();
  // Sync ke Kategori Vs Anchor kalau diminta
  if(toVsa) _fmSyncToVsaCategory(newField.id, label, sec);
  closeFmWizard();
  showToast(`✓ Field "${label}" aktif` + (toVsa?' & tampil di Vs Anchor':''));
  renderFieldManager();
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') try{renderDetailCompare(p);}catch(_){}
  }
}

// === TAMBAH CUSTOM FIELD WIZARD ===
function fmOpenCustomWizard(sec){
  _fmwContext = {mode:'add_custom', sec};
  const typeOpts = Object.keys(FM_TYPE_LABELS).map(t =>
    `<option value="${t}">${FM_TYPE_LABELS[t]}</option>`
  ).join('');
  const body = `
    <div class="fmw-info-box">
      Tambah field baru di section <b>${FM_SECTION_META[sec].name}</b>. Field ini akan muncul di form input, Detail Lengkap, dan (opsional) tabel Vs Anchor.
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Label field <span class="fmw-label-hint">(contoh: "Material lantai")</span></label>
      <input type="text" class="fmw-input" id="fmw-label" placeholder="Nama field yang BM lihat" />
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Deskripsi <span class="fmw-label-hint">(opsional, bantu BM ingat cara isi)</span></label>
      <textarea class="fmw-textarea" id="fmw-desc" placeholder="Contoh: Material utama lantai rumah — keramik / granit / polish"></textarea>
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Tipe input</label>
      <select class="fmw-select" id="fmw-type" onchange="_fmOnTypeChange(this.value)">${typeOpts}</select>
    </div>
    <div class="fmw-field" id="fmw-options-wrap" style="display:none;">
      <label class="fmw-label">Pilihan <span class="fmw-label-hint">(pisahkan dengan koma)</span></label>
      <input type="text" class="fmw-input" id="fmw-options" placeholder="Contoh: Keramik, Granit, Polish, Plester" />
    </div>
    <div class="fmw-field">
      <div class="fmw-checkbox-row">
        <input type="checkbox" id="fmw-inscore" />
        <label for="fmw-inscore">Masukkan ke perhitungan skor section</label>
      </div>
    </div>
    <div class="fmw-field">
      <div class="fmw-checkbox-row">
        <input type="checkbox" id="fmw-tovsa" checked />
        <label for="fmw-tovsa">Tampilkan di tabel Vs Anchor</label>
      </div>
    </div>
  `;
  const footer = `
    <button class="fmw-btn-cancel" onclick="closeFmWizard()">Batal</button>
    <button class="fmw-btn-primary" onclick="fmConfirmAddCustom()">+ Tambah Field</button>
  `;
  openFmWizard(`➕ Tambah Field Custom — ${FM_SECTION_META[sec].name}`, body, footer);
}

function _fmOnTypeChange(type){
  const wrap = document.getElementById('fmw-options-wrap');
  if(!wrap) return;
  wrap.style.display = (type === 'dropdown' || type === 'multi') ? 'block' : 'none';
}

function fmConfirmAddCustom(){
  if(!_fmwContext || _fmwContext.mode !== 'add_custom') return;
  const sec = _fmwContext.sec;
  const label = document.getElementById('fmw-label').value.trim();
  const desc = document.getElementById('fmw-desc').value.trim();
  const type = document.getElementById('fmw-type').value;
  const optsRaw = document.getElementById('fmw-options')?.value.trim() || '';
  const inScore = document.getElementById('fmw-inscore').checked;
  const toVsa = document.getElementById('fmw-tovsa').checked;
  if(!label){ alert('Label field wajib diisi.'); return; }
  let options = null;
  if(type === 'dropdown' || type === 'multi'){
    options = optsRaw.split(',').map(s=>s.trim()).filter(Boolean);
    if(options.length < 2){ alert('Dropdown/Multi butuh minimal 2 pilihan.'); return; }
  }
  // Generate unique ID
  const slugBase = label.toLowerCase()
    .replace(/[^\w\s]/g,'').trim()
    .replace(/\s+/g,'_').slice(0, 30);
  let id = `custom_${sec}_${slugBase}`;
  let counter = 1;
  const allIds = [...(FM_BAWAAN_FIELDS[sec]||[]), ...(FM_STATE.customFields[sec]||[])].map(f=>f.id);
  while(allIds.includes(id)){ id = `custom_${sec}_${slugBase}_${counter++}`; }
  const newField = { id, label, desc, type, options, inScore };
  if(!FM_STATE.customFields[sec]) FM_STATE.customFields[sec] = [];
  FM_STATE.customFields[sec].push(newField);
  _saveFmState();
  if(toVsa) _fmSyncToVsaCategory(id, label, sec);
  closeFmWizard();
  showToast(`✓ Field "${label}" ditambahkan` + (toVsa?' & tampil di Vs Anchor':''));
  renderFieldManager();
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') try{renderDetailCompare(p);}catch(_){}
  }
}

// === EDIT FIELD LABEL ===
function fmOpenEditModal(fieldId, sec){
  const fields = _getFmActiveFields(sec);
  const f = fields.find(x=>x.id===fieldId);
  if(!f) return;
  _fmwContext = {mode:'edit', fieldId, sec, field:f};
  const optionsHtml = (f.options && (f.type==='dropdown'||f.type==='multi')) ? `
    <div class="fmw-field">
      <label class="fmw-label">Pilihan</label>
      <input type="text" class="fmw-input" id="fmw-options" value="${escapeHtml(f.options.join(', '))}" />
    </div>
  ` : '';
  const sourceNote = f.source === 'bawaan'
    ? '<div class="fmw-info-box">ℹ️ Field ini adalah <b>bawaan</b> — kamu hanya bisa edit label & deskripsi. Tipe input dan logic skor tidak bisa diubah.</div>'
    : '';
  const body = `
    ${sourceNote}
    <div class="fmw-field">
      <label class="fmw-label">Label field</label>
      <input type="text" class="fmw-input" id="fmw-label" value="${escapeHtml(f.label)}" />
    </div>
    <div class="fmw-field">
      <label class="fmw-label">Deskripsi</label>
      <textarea class="fmw-textarea" id="fmw-desc">${escapeHtml(f.desc||'')}</textarea>
    </div>
    ${f.source === 'custom' ? optionsHtml : ''}
    ${f.source === 'custom' ? `
      <div class="fmw-field">
        <div class="fmw-checkbox-row">
          <input type="checkbox" id="fmw-inscore" ${f.inScore?'checked':''} />
          <label for="fmw-inscore">Masukkan ke perhitungan skor section</label>
        </div>
      </div>
    ` : ''}
  `;
  const footer = `
    <button class="fmw-btn-cancel" onclick="closeFmWizard()">Batal</button>
    <button class="fmw-btn-primary" onclick="fmConfirmEdit()">💾 Simpan</button>
  `;
  openFmWizard(`✎ Edit Field: ${f.label}`, body, footer);
}

function fmConfirmEdit(){
  if(!_fmwContext || _fmwContext.mode !== 'edit') return;
  const {fieldId, sec, field} = _fmwContext;
  const label = document.getElementById('fmw-label').value.trim();
  const desc = document.getElementById('fmw-desc').value.trim();
  if(!label){ alert('Label tidak boleh kosong.'); return; }
  if(field.source === 'custom'){
    const optsRaw = document.getElementById('fmw-options')?.value.trim() || '';
    const inScore = document.getElementById('fmw-inscore')?.checked || false;
    const cf = FM_STATE.customFields[sec].find(x=>x.id===fieldId);
    if(cf){
      cf.label = label;
      cf.desc = desc;
      cf.inScore = inScore;
      if(field.type === 'dropdown' || field.type === 'multi'){
        cf.options = optsRaw.split(',').map(s=>s.trim()).filter(Boolean);
      }
    }
  } else {
    FM_STATE.fieldOverrides[fieldId] = {label, desc};
  }
  _saveFmState();
  // Update Kategori Vs Anchor label kalau ada
  _fmUpdateVsaCategoryLabel(fieldId, label);
  closeFmWizard();
  showToast(`✓ Field "${label}" diupdate`);
  renderFieldManager();
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') try{renderDetailCompare(p);}catch(_){}
  }
}

// === HIDE / SHOW FIELD ===
function fmToggleHide(fieldId, sec){
  const idx = FM_STATE.hiddenFields.indexOf(fieldId);
  if(idx >= 0){
    FM_STATE.hiddenFields.splice(idx, 1);
    showToast('👁 Field ditampilkan kembali');
  } else {
    FM_STATE.hiddenFields.push(fieldId);
    showToast('🫥 Field disembunyikan');
  }
  _saveFmState();
  renderFieldManager();
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') try{renderDetailCompare(p);}catch(_){}
  }
}

// === HAPUS FIELD ===
function fmDeleteField(fieldId, sec, source){
  if(source === 'bawaan'){
    alert('Field bawaan tidak bisa dihapus. Gunakan tombol 👁 untuk menyembunyikan.');
    return;
  }
  const cf = (FM_STATE.customFields[sec]||[]).find(x=>x.id===fieldId);
  if(!cf) return;
  _fmwContext = {mode:'delete', fieldId, sec};
  const body = `
    <div class="fmw-warn-box">
      ⚠️ <b>Hapus field "${escapeHtml(cf.label)}"?</b><br>
      Semua data yang sudah diisi BM di field ini akan ikut terhapus di semua perumahan. Aksi ini tidak bisa di-undo.
    </div>
  `;
  const footer = `
    <button class="fmw-btn-cancel" onclick="closeFmWizard()">Batal</button>
    <button class="fmw-btn-danger" onclick="fmConfirmDelete()">🗑 Ya, Hapus</button>
  `;
  openFmWizard(`🗑 Hapus Field`, body, footer);
}

function fmConfirmDelete(){
  if(!_fmwContext || _fmwContext.mode !== 'delete') return;
  const {fieldId, sec} = _fmwContext;
  // Hapus dari customFields
  FM_STATE.customFields[sec] = (FM_STATE.customFields[sec]||[]).filter(f=>f.id!==fieldId);
  // Hapus dari hiddenFields kalau ada
  FM_STATE.hiddenFields = FM_STATE.hiddenFields.filter(id=>id!==fieldId);
  // Hapus dari enabledTemplates kalau ada
  FM_STATE.enabledTemplates = FM_STATE.enabledTemplates.filter(id=>id!==fieldId);
  // Hapus override label kalau ada
  delete FM_STATE.fieldOverrides[fieldId];
  // Hapus data dari semua perumahan
  perumahan.forEach(p => {
    if(p.customFields && p.customFields[fieldId] !== undefined){
      delete p.customFields[fieldId];
    }
  });
  // Hapus dari VSA_SECTIONS
  VSA_SECTIONS.forEach(s => {
    if(Array.isArray(s.rows)) s.rows = s.rows.filter(k=>k!==fieldId);
  });
  _saveFmState();
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  try{ localStorage.setItem('bm4_vsa_sections', JSON.stringify(VSA_SECTIONS)); }catch(_){}
  closeFmWizard();
  showToast('🗑 Field dihapus');
  renderFieldManager();
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') try{renderDetailCompare(p);}catch(_){}
  }
}

// ============================================================
// [TAHAP4B-2] Sinkronisasi Field Manager → Kategori Vs Anchor
// ============================================================
// Tambah field baru ke section yang sesuai di VSA_SECTIONS
function _fmSyncToVsaCategory(fieldId, label, sec){
  // Section ID di Field Manager sama dengan di VSA_SECTIONS
  const vsaSec = VSA_SECTIONS.find(s=>s.id===sec);
  if(!vsaSec){
    // Section tidak ada di VSA — skip (seharusnya tidak terjadi)
    return;
  }
  // Cek kalau sudah ada
  if(!vsaSec.rows.includes(fieldId)){
    vsaSec.rows.push(fieldId);
  }
  // Juga tambah ke VSA_ROW_DEFS supaya bisa di-render
  const existsInDef = VSA_ROW_DEFS.some(d=>d.key===fieldId);
  if(!existsInDef){
    VSA_ROW_DEFS.push({key: fieldId, label: label});
    VSA_ROW_KEYS.push(fieldId);
    VSA_ROW_LABEL[fieldId] = label;
  }
  try{ localStorage.setItem('bm4_vsa_sections', JSON.stringify(VSA_SECTIONS)); }catch(_){}
}

// Update label di VSA_ROW_DEFS kalau user edit label di Field Manager
function _fmUpdateVsaCategoryLabel(fieldId, newLabel){
  const def = VSA_ROW_DEFS.find(d=>d.key===fieldId);
  if(def) def.label = newLabel;
  VSA_ROW_LABEL[fieldId] = newLabel;
}

// Boot-time: auto-register custom fields yang sudah ada ke VSA_ROW_DEFS
(function _fmBootRegisterCustomFields(){
  Object.keys(FM_STATE.customFields||{}).forEach(sec => {
    (FM_STATE.customFields[sec]||[]).forEach(f => {
      const existsInDef = VSA_ROW_DEFS.some(d=>d.key===f.id);
      if(!existsInDef){
        VSA_ROW_DEFS.push({key: f.id, label: f.label});
        if(!VSA_ROW_KEYS.includes(f.id)) VSA_ROW_KEYS.push(f.id);
        VSA_ROW_LABEL[f.id] = f.label;
      }
    });
  });
})();

// Render utama (dipanggil dari switchHubTab)
function renderFieldManager(){
  _renderFmSectionNav();
  _renderFmActivePanel();
  _renderFmTemplatePanel();
}

// ============================================================
// [GAP ANALYSIS] — Laporan kelengkapan data per perumahan
// ============================================================

// Filter state
let _gapFilter = {section:'all', sortBy:'completeness_asc'};

// Helper: dapatkan daftar field aktif yang terhitung untuk gap analysis
// Return: [{id, label, section, type, getter:function(p)}]
function _gapGetActiveFields(){
  const result = [];
  const sections = ['place','product','price','promotion','performance','gtm'];
  // Bawaan fields dengan path ke data-nya
  const BAWAAN_PATHS = {
    // Place — hanya dist_anchor (POI dihandle terpisah, hidden dari FM)
    'dist_anchor':   {section:'place', getter: p => p.lat != null && p.lng != null}, // anggap auto terisi kalau ada koordinat
    // Product
    'tpr_lt':        {section:'product',  getter: p => p.tapera?.luasTanah?.trim()},
    'tpr_lb':        {section:'product',  getter: p => p.tapera?.luasBangunan?.trim()},
    // Price
    'tpr_harga':     {section:'price',    getter: p => p.tapera?.hargaRange?.trim()},
    'tpr_tenor':     {section:'price',    getter: p => p.tapera?.tenorDominan?.trim()},
    'tpr_um':        {section:'price',    getter: p => p.tapera?.uangMukaRange?.trim()},
    'tpr_bank':      {section:'price',    getter: p => p.tapera?.bankDominan?.trim()},
    // Promotion
    'tpr_promo_aktif':   {section:'promotion', getter: p => p.tapera?.promotion?.promoAktif?.trim()},
    'tpr_promo_periode': {section:'promotion', getter: p => p.tapera?.promotion?.periode?.trim()},
    'tpr_promo_bonus':   {section:'promotion', getter: p => p.tapera?.promotion?.bonus?.trim()},
    'tpr_promo_iklan':   {section:'promotion', getter: p => p.tapera?.promotion?.iklanPlatform?.trim()},
    'tpr_promo_bb':      {section:'promotion', getter: p => p.tapera?.promotion?.billboard?.trim()},
    // Performance
    'proj_unit':         {section:'performance', getter: p => p.unit > 0},
    'proj_realisasi':    {section:'performance', getter: p => p.realisasi > 0},
    'proj_progress':     {section:'performance', getter: p => p.unit > 0 && p.realisasi != null},
    'tpr_avg':           {section:'performance', getter: p => (p.tapera?.realisasiBulanan||[]).length >= 2},
    'tpr_trend':         {section:'performance', getter: p => (p.tapera?.realisasiBulanan||[]).length >= 4},
    'tpr_total':         {section:'performance', getter: p => p.tapera?.totalRealisasi > 0},
    'tpr_flpp':          {section:'performance', getter: p => p.tapera?.nominalFLPP},
    // GTM
    'tpr_gtm_mkt':       {section:'gtm', getter: p => p.tapera?.gtm?.marketingInhouse != null},
    'tpr_gtm_kanal':     {section:'gtm', getter: p => p.tapera?.gtm?.strukturKanal?.trim()},
    'tpr_gtm_agent':     {section:'gtm', getter: p => p.tapera?.gtm?.jumlahAgent != null},
    'tpr_gtm_fee_mkt':   {section:'gtm', getter: p => p.tapera?.gtm?.feeMarketing?.trim()},
    'tpr_gtm_fee_agt':   {section:'gtm', getter: p => p.tapera?.gtm?.feeAgent?.trim()},
    'tpr_gtm_dev':       {section:'gtm', getter: p => p.tapera?.gtm?.brandDeveloper?.trim()}
  };
  // Tambahin bawaan yang aktif (not hidden)
  sections.forEach(secId => {
    (FM_BAWAAN_FIELDS[secId] || []).forEach(f => {
      if(_isFieldHidden(f.id)) return;
      const meta = BAWAAN_PATHS[f.id];
      if(!meta) return; // field yang belum di-map, skip
      result.push({
        id: f.id,
        label: f.label,
        section: meta.section,
        type: f.type,
        getter: meta.getter
      });
    });
  });
  // Tambahin custom fields
  sections.forEach(secId => {
    (FM_STATE.customFields[secId] || []).forEach(f => {
      if(_isFieldHidden(f.id)) return;
      result.push({
        id: f.id,
        label: f.label,
        section: secId,
        type: f.type,
        getter: p => {
          const v = p.customFields?.[f.id];
          if(v == null || v === '') return false;
          if(Array.isArray(v)) return v.length > 0;
          return true;
        }
      });
    });
  });
  return result;
}

// Helper: hitung kelengkapan per perumahan
function _gapCalcCompleteness(p, activeFields){
  const bySection = {place:{total:0,filled:0,missing:[]}, product:{total:0,filled:0,missing:[]},
    price:{total:0,filled:0,missing:[]}, promotion:{total:0,filled:0,missing:[]},
    performance:{total:0,filled:0,missing:[]}, gtm:{total:0,filled:0,missing:[]}};
  activeFields.forEach(f => {
    if(!bySection[f.section]) return;
    bySection[f.section].total++;
    let filled = false;
    try{ filled = !!f.getter(p); }catch(_){}
    if(filled) bySection[f.section].filled++;
    else bySection[f.section].missing.push({id:f.id, label:f.label});
  });
  const total = Object.values(bySection).reduce((a,b)=>a+b.total, 0);
  const filled = Object.values(bySection).reduce((a,b)=>a+b.filled, 0);
  const pct = total > 0 ? Math.round(filled/total*100) : 0;
  return {bySection, total, filled, missing:total-filled, pct};
}

// Main renderer
function renderGapAnalysis(){
  const activeFields = _gapGetActiveFields();
  if(!activeFields.length){
    document.getElementById('gap-stats-summary').innerHTML = '';
    document.getElementById('gap-analysis-body').innerHTML = `<div class="gap-empty">Tidak ada field aktif yang bisa dianalisa.</div>`;
    return;
  }
  // Hitung untuk semua perumahan
  const perumData = perumahan.map(p => ({
    p,
    gap: _gapCalcCompleteness(p, activeFields)
  }));
  // Sort
  const sorted = [...perumData];
  if(_gapFilter.sortBy === 'completeness_asc'){
    sorted.sort((a,b) => a.gap.pct - b.gap.pct);
  } else if(_gapFilter.sortBy === 'completeness_desc'){
    sorted.sort((a,b) => b.gap.pct - a.gap.pct);
  } else if(_gapFilter.sortBy === 'nama'){
    sorted.sort((a,b) => (a.p.nama||'').localeCompare(b.p.nama||''));
  }
  // Summary stats
  const totalPerum = perumData.length;
  const fullPerum = perumData.filter(x => x.gap.pct === 100).length;
  const partialPerum = perumData.filter(x => x.gap.pct > 0 && x.gap.pct < 100).length;
  const emptyPerum = perumData.filter(x => x.gap.pct === 0).length;
  const avgPct = totalPerum ? Math.round(perumData.reduce((a,b)=>a+b.gap.pct, 0) / totalPerum) : 0;
  const avgClass = avgPct >= 75 ? 'good' : (avgPct >= 50 ? 'mid' : 'bad');
  document.getElementById('gap-stats-summary').innerHTML = `<div class="gap-summary">
    <div class="gap-stat-card">
      <div class="gap-stat-val">${totalPerum}</div>
      <div class="gap-stat-lbl">Total Perum</div>
    </div>
    <div class="gap-stat-card">
      <div class="gap-stat-val ${avgClass}">${avgPct}%</div>
      <div class="gap-stat-lbl">Rata² Lengkap</div>
    </div>
    <div class="gap-stat-card">
      <div class="gap-stat-val good">${fullPerum}</div>
      <div class="gap-stat-lbl">100% Lengkap</div>
    </div>
    <div class="gap-stat-card">
      <div class="gap-stat-val bad">${emptyPerum}</div>
      <div class="gap-stat-lbl">Tanpa Data</div>
    </div>
  </div>`;
  // Filter section & sort
  const filterHtml = `<div class="gap-filters">
    <span class="gap-filter-lbl">Filter Section:</span>
    <select class="gap-filter-select" onchange="gapSetFilter('section', this.value)">
      <option value="all" ${_gapFilter.section==='all'?'selected':''}>Semua Section</option>
      <option value="place" ${_gapFilter.section==='place'?'selected':''}>📍 Place</option>
      <option value="product" ${_gapFilter.section==='product'?'selected':''}>🏠 Product</option>
      <option value="price" ${_gapFilter.section==='price'?'selected':''}>💰 Price</option>
      <option value="promotion" ${_gapFilter.section==='promotion'?'selected':''}>📢 Promotion</option>
      <option value="performance" ${_gapFilter.section==='performance'?'selected':''}>📈 Performance</option>
      <option value="gtm" ${_gapFilter.section==='gtm'?'selected':''}>👔 GTM</option>
    </select>
    <span class="gap-filter-lbl" style="margin-left:8px;">Urutkan:</span>
    <select class="gap-filter-select" onchange="gapSetFilter('sortBy', this.value)">
      <option value="completeness_asc" ${_gapFilter.sortBy==='completeness_asc'?'selected':''}>Paling tidak lengkap dulu</option>
      <option value="completeness_desc" ${_gapFilter.sortBy==='completeness_desc'?'selected':''}>Paling lengkap dulu</option>
      <option value="nama" ${_gapFilter.sortBy==='nama'?'selected':''}>Nama (A-Z)</option>
    </select>
  </div>`;
  // Render list
  const SEC_EMOJI = {place:'📍',product:'🏠',price:'💰',promotion:'📢',performance:'📈',gtm:'👔'};
  const rowsHtml = sorted.map(({p, gap}) => {
    // Kalau filter section aktif, hitung per section saja
    let displayPct, displayFilled, displayTotal, sectionFocus;
    if(_gapFilter.section !== 'all'){
      const s = gap.bySection[_gapFilter.section];
      displayPct = s.total > 0 ? Math.round(s.filled/s.total*100) : 0;
      displayFilled = s.filled;
      displayTotal = s.total;
      sectionFocus = _gapFilter.section;
    } else {
      displayPct = gap.pct;
      displayFilled = gap.filled;
      displayTotal = gap.total;
    }
    const barClass = displayPct >= 75 ? 'good' : (displayPct >= 40 ? 'mid' : 'bad');
    // Section dots (hanya kalau filter = all)
    const secDots = _gapFilter.section === 'all'
      ? `<div class="gap-row-sections">${Object.keys(gap.bySection).map(s => {
          const ss = gap.bySection[s];
          if(ss.total === 0) return '';
          const p2 = Math.round(ss.filled/ss.total*100);
          const cls = p2 === 100 ? 'full' : (p2 > 0 ? 'partial' : 'empty');
          return `<span class="gap-sec-dot ${cls}" title="${SEC_EMOJI[s]} ${p2}% (${ss.filled}/${ss.total})">${SEC_EMOJI[s]} ${p2}%</span>`;
        }).join('')}</div>`
      : '';
    const isAnchor = p.id === ANCHOR_ID;
    return `<div class="gap-row" onclick="gapOpenEditor(${p.id})">
      <div>
        <div class="gap-row-nama">${isAnchor?'<span class="anchor">⭐</span>':''}${escapeHtml(p.nama)}</div>
        <div class="gap-row-area">${escapeHtml(p.area||'—')} · ${escapeHtml(p.developer||'—')}</div>
        ${secDots}
      </div>
      <div class="gap-bar-wrap">
        <div class="gap-bar-fill ${barClass}" style="width:${displayPct}%"></div>
        <div class="gap-bar-text">${displayPct}%</div>
      </div>
      <div class="gap-missing-count"><b>${displayFilled}</b>/${displayTotal} field terisi</div>
      <button class="gap-action-btn" onclick="event.stopPropagation(); gapOpenEditor(${p.id})" title="Buka editor data">✎ Edit</button>
    </div>`;
  }).join('');
  document.getElementById('gap-analysis-body').innerHTML = filterHtml + `<div class="gap-list">${rowsHtml || '<div class="gap-empty">Tidak ada perumahan.</div>'}</div>`;
}

function gapSetFilter(key, val){
  _gapFilter[key] = val;
  renderGapAnalysis();
}

function gapOpenEditor(perumId){
  // Tutup Hub Formula modal, lalu buka Tapera editor untuk perumahan ini
  const ov = document.getElementById('admin-overlay');
  if(ov) ov.classList.remove('open');
  // Pastikan Tapera editor terbuka
  try{
    if(typeof switchEditorTab === 'function'){
      switchEditorTab('tapera');
    }
    const sel = document.getElementById('tpr-select');
    if(sel){
      sel.value = String(perumId);
      if(typeof loadTaperaForm === 'function') loadTaperaForm(String(perumId));
    }
    // Jika editor tidak terbuka otomatis, trigger toggleEditor() yang benar
    const editorOverlay = document.getElementById('editor-overlay');
    if(editorOverlay && !editorOverlay.classList.contains('open') && typeof toggleEditor === 'function'){
      toggleEditor();
      // Setelah editor terbuka, pilih perumahan yang di-klik di Gap Analysis
      setTimeout(() => {
        const sel2 = document.getElementById('tpr-select');
        if(sel2){
          sel2.value = String(perumId);
          if(typeof loadTaperaForm === 'function') loadTaperaForm(String(perumId));
        }
      }, 150);
    }
    showToast(`✎ Buka editor untuk "${(perumahan.find(x=>x.id===perumId)||{}).nama||'perumahan'}"`);
  }catch(e){
    console.warn('gap open editor err', e);
    showToast('Buka menu Edit Data manual untuk perumahan ini');
  }
}

// ============================================================
// [DASHBOARD RANKING] — Ranking perumahan dengan mini radar chart
// ============================================================

let _drnkState = {sortBy:'avg', limit:10};

function drnkSetSortBy(v){ _drnkState.sortBy = v; renderDashboardRanking(); }
function drnkSetLimit(v){ _drnkState.limit = parseInt(v)||0; renderDashboardRanking(); }

// Build SVG radar chart kecil (6 axis: Place, Product, Price, Promotion, Performance, GTM)
function _drnkBuildRadar(scores, size=92){
  const cx = size/2;
  const cy = size/2;
  const r = size/2 - 10; // padding untuk label kecil
  const axes = [
    {id:'place',       label:'P', angle:-90},
    {id:'product',     label:'Pr',angle:-30},
    {id:'price',       label:'$', angle: 30},
    {id:'promotion',   label:'M', angle: 90},
    {id:'performance', label:'%', angle:150},
    {id:'gtm',         label:'G', angle:210}
  ];
  // Grid polygon (2 ring: 50% & 100%)
  const ring = (frac) => axes.map(a => {
    const rad = a.angle * Math.PI/180;
    const x = cx + r*frac*Math.cos(rad);
    const y = cy + r*frac*Math.sin(rad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Data polygon
  const dataPts = axes.map(a => {
    const frac = Math.max(0, Math.min(100, scores[a.id]||0)) / 100;
    const rad = a.angle * Math.PI/180;
    const x = cx + r*frac*Math.cos(rad);
    const y = cy + r*frac*Math.sin(rad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Axis lines
  const axesLines = axes.map(a => {
    const rad = a.angle * Math.PI/180;
    const x = cx + r*Math.cos(rad);
    const y = cy + r*Math.sin(rad);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#E5E7EB" stroke-width="0.5"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;">
    <polygon points="${ring(1)}" fill="none" stroke="#E5E7EB" stroke-width="1"/>
    <polygon points="${ring(0.5)}" fill="none" stroke="#E5E7EB" stroke-width="0.5" stroke-dasharray="2,2"/>
    ${axesLines}
    <polygon points="${dataPts}" fill="rgba(37,99,235,0.25)" stroke="#2563EB" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

function renderDashboardRanking(){
  const host = document.getElementById('drnk-cards');
  if(!host) return;
  if(!Array.isArray(perumahan) || !perumahan.length){
    host.innerHTML = `<div class="drnk-empty">Belum ada perumahan. Tambah perumahan dulu di menu Edit Data.</div>`;
    return;
  }
  // Compute semua scores
  const data = perumahan.map(p => {
    let scores;
    try{ scores = _calcAllSectionScores(p); }
    catch(_){ scores = {place:0,product:0,price:0,promotion:0,performance:0,gtm:0,avg:0}; }
    return {p, scores};
  });
  // Sort
  const sortKey = _drnkState.sortBy;
  data.sort((a, b) => (b.scores[sortKey]||0) - (a.scores[sortKey]||0));
  // Limit
  const limit = _drnkState.limit;
  const shown = limit > 0 ? data.slice(0, limit) : data;
  // Section label untuk header card
  const SEC_LBL = {avg:'Rata² 6 Dimensi', place:'📍 Place', product:'🏠 Product', price:'💰 Price',
    promotion:'📢 Promotion', performance:'📈 Performance', gtm:'👔 GTM'};
  const sectagText = SEC_LBL[sortKey] || sortKey;
  // Render cards
  const cardsHtml = shown.map((item, idx) => {
    const {p, scores} = item;
    const displayedScore = scores[sortKey] || 0;
    const rankNum = idx + 1;
    const rankClass = rankNum === 1 ? 'top1' : (rankNum <= 3 ? 'top3' : '');
    const scoreClass = displayedScore >= 75 ? 'good' : (displayedScore >= 50 ? 'mid' : 'bad');
    const isAnchor = p.id === ANCHOR_ID;
    const radarSvg = _drnkBuildRadar(scores, 92);
    return `<div class="drnk-card ${isAnchor?'anchor':''}" onclick="drnkOpenDetail(${p.id})" title="Klik untuk detail lengkap">
      <div class="drnk-card-left">
        <div class="drnk-card-rank">
          <span class="drnk-rank-num ${rankClass}">#${rankNum}</span>
          ${isAnchor?'<span class="drnk-anchor-badge">⭐ ANCHOR</span>':''}
        </div>
        <div class="drnk-card-nama">${escapeHtml(p.nama)}</div>
        <div class="drnk-card-area">${escapeHtml(p.area||'—')}</div>
        <div class="drnk-card-score">
          <span class="drnk-card-score-num ${scoreClass}">${displayedScore}</span>
          <span class="drnk-card-score-max">/100</span>
        </div>
        <div class="drnk-card-sectag">${sectagText}</div>
      </div>
      <div class="drnk-card-radar" title="Skor 6 dimensi: P=Place, Pr=Product, $=Price, M=Promotion, %=Performance, G=GTM">${radarSvg}</div>
    </div>`;
  }).join('');
  host.innerHTML = cardsHtml || `<div class="drnk-empty">Tidak ada data perumahan.</div>`;
}

// Buka modal Detail Lengkap saat card diklik
function drnkOpenDetail(perumId){
  // Switch ke tab Analisa dulu supaya konteks perumahan aktif, baru buka PDL modal
  try{
    if(typeof openPdlModal === 'function'){
      openPdlModal(perumId);
    }
  }catch(e){
    console.warn('drnk open err', e);
    showToast('Klik ikon Analisa Lokasi lalu pilih perumahan untuk detail lengkap');
  }
}

// ============================================================
// [PDF EXPORT] — via window.print() + CSS @media print
// ============================================================

function printPdlModal(){
  // Pastikan modal sedang terbuka
  const ov = document.getElementById('pdl-overlay');
  if(!ov || !ov.classList.contains('open')){
    showToast('Buka Detail Lengkap dulu sebelum cetak');
    return;
  }
  document.body.classList.add('printing-pdl');
  // Tunggu sejenak supaya CSS applied sebelum print dialog muncul
  setTimeout(() => {
    try{
      window.print();
    }catch(e){
      console.warn('print err', e);
      showToast('⚠️ Gagal membuka dialog print');
    }
    // Cleanup setelah print dialog ditutup
    setTimeout(() => {
      document.body.classList.remove('printing-pdl');
    }, 100);
  }, 100);
}

function printDashboardRanking(){
  // Pastikan dashboard aktif
  const dashPane = document.querySelector('[data-div="dashboard"].active, .divisi-pane.active');
  if(!document.getElementById('drnk-cards')){
    showToast('Buka tab Dashboard dulu sebelum cetak');
    return;
  }
  document.body.classList.add('printing-ranking');
  setTimeout(() => {
    try{
      window.print();
    }catch(e){
      console.warn('print err', e);
      showToast('⚠️ Gagal membuka dialog print');
    }
    setTimeout(() => {
      document.body.classList.remove('printing-ranking');
    }, 100);
  }, 100);
}

// Safety: clean up class kalau user menutup print dialog
window.addEventListener('afterprint', function(){
  document.body.classList.remove('printing-pdl');
  document.body.classList.remove('printing-ranking');
});

// Pilih class CSS berdasarkan skor
function _pdlScoreClass(score){
  if(score >= 75) return 's-high';
  if(score >= 50) return 's-mid';
  return 's-low';
}

// Generate verdict per section (auto-generated narasi)
function _genSectionVerdict(sectionId, p, score){
  const t = p.tapera || {};
  const sd = p._scoreDetail || calcScoreFull(p);
  switch(sectionId){
    case 'place': {
      const reasons = [];
      if(sd.aksesibilitas >= 75) reasons.push(`<b class="v-good">aksesibilitas kuat (${sd.aksesibilitas})</b>`);
      else if(sd.aksesibilitas < 50) reasons.push(`<b class="v-warn">aksesibilitas lemah (${sd.aksesibilitas})</b>`);
      if(sd.fasilitas >= 75) reasons.push(`<b class="v-good">fasilitas sekitar lengkap (${sd.fasilitas})</b>`);
      else if(sd.fasilitas < 50) reasons.push(`<b class="v-warn">fasilitas sekitar minim (${sd.fasilitas})</b>`);
      // Jarak POI terdekat
      const d = sd.detail || {};
      const near = [];
      if(d.rs?.dist < 3) near.push(`RS ${d.rs.dist}km`);
      if(d.kampus?.dist < 3) near.push(`Kampus ${d.kampus.dist}km`);
      if(d.mall?.dist < 3) near.push(`Mall ${d.mall.dist}km`);
      if(near.length) reasons.push(`dekat dengan ${near.join(', ')}`);
      if(!reasons.length) reasons.push('data lokasi standar');
      return `Skor ${score}/100 karena ${reasons.join(' dan ')}.`;
    }
    case 'product': {
      const reasons = [];
      if(t.luasTanah) reasons.push(`LT ${escapeHtml(t.luasTanah)}`);
      if(t.luasBangunan) reasons.push(`LB ${escapeHtml(t.luasBangunan)}`);
      if(p.unit > 0) reasons.push(`${p.unit} unit`);
      const curYear = new Date().getFullYear();
      if(p.tahun && (curYear - p.tahun) <= 3) reasons.push(`<b class="v-good">proyek baru (${p.tahun})</b>`);
      else if(p.tahun && (curYear - p.tahun) > 6) reasons.push(`<b class="v-warn">proyek lama (${p.tahun})</b>`);
      if(score < 50) return `Skor ${score}/100 — <b class="v-warn">data produk belum lengkap</b>. Perlu input spek lebih detail.`;
      return `Skor ${score}/100 karena ${reasons.length ? reasons.join(', ') : 'kelengkapan data standar'}.`;
    }
    case 'price': {
      const reasons = [];
      if(t.hargaRange) reasons.push(`harga ${escapeHtml(t.hargaRange)}`);
      if(t.tenorDominan) reasons.push(`tenor ${escapeHtml(t.tenorDominan)}`);
      if(t.uangMukaRange) reasons.push(`DP ${escapeHtml(t.uangMukaRange)}`);
      if(t.bankDominan) reasons.push(`via ${escapeHtml(t.bankDominan)}`);
      if(!reasons.length) return `Skor ${score}/100 — <b class="v-warn">data harga belum diisi</b>.`;
      return `Skor ${score}/100 dengan ${reasons.join(', ')}.`;
    }
    case 'promotion': {
      const promo = t.promotion || {};
      const reasons = [];
      if(promo.promoAktif) reasons.push(`<b class="v-good">promo aktif: ${escapeHtml(promo.promoAktif)}</b>`);
      else reasons.push(`<b class="v-warn">tidak ada promo aktif</b>`);
      if(promo.iklanPlatform){
        const n = _parseComplexItems(promo.iklanPlatform).length;
        reasons.push(`${n} kanal iklan`);
      }
      if(promo.billboard && /ya/i.test(promo.billboard)) reasons.push(`billboard aktif`);
      return `Skor ${score}/100 — ${reasons.join(', ')}.`;
    }
    case 'performance': {
      const pct = p.unit > 0 ? Math.round((p.realisasi || 0) / p.unit * 100) : 0;
      const bulanan = t.realisasiBulanan || [];
      const reasons = [`progress ${pct}%`];
      if(bulanan.length >= 4){
        const trend = _calcTaperaTrend(bulanan);
        if(trend.dir === 'up') reasons.push(`<b class="v-good">trend naik (${trend.pctStr})</b>`);
        else if(trend.dir === 'down') reasons.push(`<b class="v-warn">trend turun (${trend.pctStr})</b>`);
        else reasons.push(`trend flat`);
      } else if(bulanan.length){
        reasons.push(`data ${bulanan.length} bulan`);
      } else {
        reasons.push(`<b class="v-warn">belum ada data bulanan</b>`);
      }
      return `Skor ${score}/100 — ${reasons.join(', ')}.`;
    }
    case 'gtm': {
      const gtm = t.gtm || {};
      const reasons = [];
      if(gtm.marketingInhouse != null) reasons.push(`${gtm.marketingInhouse} marketing in-house`);
      if(gtm.strukturKanal) reasons.push(`kanal ${escapeHtml(gtm.strukturKanal)}`);
      if(gtm.jumlahAgent != null && gtm.jumlahAgent > 0) reasons.push(`<b class="v-good">${gtm.jumlahAgent} agent</b>`);
      else if(gtm.jumlahAgent === 0) reasons.push(`<b class="v-warn">tanpa agent</b>`);
      if(!reasons.length) return `Skor ${score}/100 — <b class="v-warn">data GTM belum lengkap</b>.`;
      return `Skor ${score}/100 dengan ${reasons.join(', ')}.`;
    }
    default: return `Skor ${score}/100.`;
  }
}

// Generate verdict akhir berdasarkan semua skor section
function _genFinalVerdict(scores, p){
  const entries = [
    ['Place', scores.place], ['Product', scores.product], ['Price', scores.price],
    ['Promotion', scores.promotion], ['Performance', scores.performance], ['GTM', scores.gtm]
  ];
  const strong = entries.filter(([n,s])=>s >= 75).map(([n])=>n);
  const weak = entries.filter(([n,s])=>s < 50).map(([n])=>n);
  let narasi = '';
  if(strong.length && weak.length){
    narasi = `Perumahan ini <b class="v-good">kuat di ${strong.join(', ')}</b> (skor ≥75) namun <b class="v-warn">lemah di ${weak.join(', ')}</b> (skor <50). Skor rata-rata: <b>${scores.avg}/100</b>.`;
  } else if(strong.length){
    narasi = `Perumahan ini <b class="v-good">kuat di ${strong.join(', ')}</b>. Skor rata-rata: <b>${scores.avg}/100</b>.`;
  } else if(weak.length){
    narasi = `Perumahan ini <b class="v-warn">perlu perbaikan di ${weak.join(', ')}</b>. Skor rata-rata: <b>${scores.avg}/100</b>.`;
  } else {
    narasi = `Perumahan ini punya profil yang <b>seimbang</b> di semua aspek. Skor rata-rata: <b>${scores.avg}/100</b>.`;
  }
  // Unggul/Risiko list
  const unggul = [];
  const risiko = [];
  if(scores.place >= 75) unggul.push(`Lokasi strategis (${scores.place})`);
  else if(scores.place < 50) risiko.push(`Lokasi kurang kompetitif (${scores.place})`);
  if(scores.product >= 75) unggul.push(`Spek produk lengkap (${scores.product})`);
  else if(scores.product < 50) risiko.push(`Data produk minim (${scores.product})`);
  if(scores.price >= 75) unggul.push(`Harga kompetitif (${scores.price})`);
  else if(scores.price < 50) risiko.push(`Data harga belum lengkap (${scores.price})`);
  if(scores.promotion >= 75) unggul.push(`Promo kuat (${scores.promotion})`);
  else if(scores.promotion < 50) risiko.push(`Promo lemah/kosong (${scores.promotion})`);
  if(scores.performance >= 75) unggul.push(`Penjualan sehat (${scores.performance})`);
  else if(scores.performance < 50) risiko.push(`Penjualan lambat (${scores.performance})`);
  if(scores.gtm >= 75) unggul.push(`Tim jualan kuat (${scores.gtm})`);
  else if(scores.gtm < 50) risiko.push(`Tim jualan kecil (${scores.gtm})`);
  // Rekomendasi
  const rekomendasi = [];
  if(scores.promotion < 50) rekomendasi.push('Siapkan paket promo untuk tingkatkan daya tarik');
  if(scores.gtm < 50) rekomendasi.push('Tambah kapasitas tim marketing dan/atau jaringan agent');
  if(scores.performance < 50 && p.unit > 0 && (p.realisasi||0)/p.unit < 0.3) rekomendasi.push('Audit strategi penjualan — velocity masih rendah');
  if(scores.price < 50) rekomendasi.push('Lengkapi data harga, DP, dan skema KPR');
  if(!rekomendasi.length && scores.avg >= 75) rekomendasi.push('Pertahankan momentum; monitor kompetitor secara berkala');
  return {
    narasi,
    unggul: unggul.slice(0,4),
    risiko: risiko.slice(0,4),
    rekomendasi: rekomendasi.slice(0,3).join('. ') + (rekomendasi.length ? '.' : '')
  };
}

// ============================================================
// [TAHAP3-IT3] Verdict Override — Manual Edit Per Section
// ============================================================
// Helper: get override text (null if not set / section uses auto)
function _getVerdictOverride(p, sectionId){
  const notes = p?.tapera?.verdictSectionNotes || {};
  const val = notes[sectionId];
  return (typeof val === 'string' && val.trim()) ? val : null;
}

// Helper: get final verdict override
function _getFinalVerdictOverride(p){
  const val = p?.tapera?.verdictFinalNote;
  return (typeof val === 'string' && val.trim()) ? val : null;
}

// Render section verdict block — support manual override
function _renderSectionVerdict(sectionId, p, score, autoText){
  const override = _getVerdictOverride(p, sectionId);
  const isManual = !!override;
  const displayText = isManual ? escapeHtml(override).replace(/\n/g,'<br>') : autoText;
  const tag = isManual
    ? `<span class="pdl-sec-verdict-manual-tag">manual</span>`
    : `<span class="pdl-sec-verdict-auto-tag">auto</span>`;
  const revertBtn = isManual
    ? `<button class="pdl-sec-verdict-btn revert" onclick="revertVerdictOverride('${sectionId}', ${p.id})" title="Kembalikan ke auto-generated">↺ Auto</button>`
    : '';
  return `<div class="pdl-sec-verdict ${isManual?'manual':''}" id="pdl-sv-${sectionId}">
    <div class="pdl-sec-verdict-lbl">
      <span>📝 Verdict ${_sectionLabel(sectionId)}</span>
      <span class="pdl-sec-verdict-actions">
        ${tag}
        <button class="pdl-sec-verdict-btn" onclick="editVerdictOverride('${sectionId}', ${p.id})" title="Edit manual">✎</button>
        ${revertBtn}
      </span>
    </div>
    <div class="pdl-sec-verdict-content" id="pdl-sv-content-${sectionId}">${displayText}</div>
  </div>`;
}

function _sectionLabel(id){
  const map = {place:'Place', product:'Product', price:'Price', promotion:'Promotion', performance:'Performance', gtm:'GTM'};
  return map[id] || id;
}

// Enter edit mode untuk section verdict
function editVerdictOverride(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  const block = document.getElementById(`pdl-sv-${sectionId}`);
  if(!block) return;
  const current = _getVerdictOverride(p, sectionId) || '';
  // Kalau kosong, kasih starter: auto text (plain) supaya BM bisa modify dari situ
  let starter = current;
  if(!starter){
    // Ambil auto text dari DOM (sudah di-render) — strip HTML jadi plain
    const contentEl = document.getElementById(`pdl-sv-content-${sectionId}`);
    if(contentEl){
      const tmp = document.createElement('div');
      tmp.innerHTML = contentEl.innerHTML;
      starter = tmp.textContent || tmp.innerText || '';
    }
  }
  block.innerHTML = `
    <div class="pdl-sec-verdict-lbl">
      <span>✎ Edit Verdict ${_sectionLabel(sectionId)}</span>
      <span class="pdl-sec-verdict-manual-tag">editing</span>
    </div>
    <textarea class="pdl-sec-verdict-editarea" id="pdl-sv-ta-${sectionId}" placeholder="Tulis verdict manual...">${escapeHtml(starter)}</textarea>
    <div class="pdl-sec-verdict-edit-row">
      <button class="pdl-sec-verdict-edit-cancel" onclick="cancelVerdictOverride('${sectionId}', ${perumId})">Batal</button>
      <button class="pdl-sec-verdict-edit-save" onclick="saveVerdictOverride('${sectionId}', ${perumId})">💾 Simpan</button>
    </div>
  `;
  const ta = document.getElementById(`pdl-sv-ta-${sectionId}`);
  if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function saveVerdictOverride(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  if(!p.tapera.verdictSectionNotes) p.tapera.verdictSectionNotes = {};
  const ta = document.getElementById(`pdl-sv-ta-${sectionId}`);
  if(!ta) return;
  const val = ta.value.trim();
  if(val){
    p.tapera.verdictSectionNotes[sectionId] = val;
  } else {
    // Kalau dikosongkan, hapus (balik ke auto)
    delete p.tapera.verdictSectionNotes[sectionId];
  }
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast(val ? '✓ Verdict manual disimpan' : '↺ Kembali ke auto');
  _renderPdlBody(perumId);
}

function cancelVerdictOverride(sectionId, perumId){
  _renderPdlBody(perumId);
}

function revertVerdictOverride(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!confirm(`Kembalikan Verdict ${_sectionLabel(sectionId)} ke auto-generated? Teks manual akan terhapus.`)) return;
  if(p.tapera?.verdictSectionNotes){
    delete p.tapera.verdictSectionNotes[sectionId];
  }
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast('↺ Verdict dikembalikan ke auto');
  _renderPdlBody(perumId);
}

// === Final verdict override handlers ===
function editFinalVerdictOverride(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  const block = document.getElementById('pdl-final-block');
  if(!block) return;
  const current = _getFinalVerdictOverride(p) || '';
  let starter = current;
  if(!starter){
    const narEl = document.getElementById('pdl-final-narasi');
    if(narEl){
      const tmp = document.createElement('div');
      tmp.innerHTML = narEl.innerHTML;
      starter = tmp.textContent || tmp.innerText || '';
    }
  }
  block.innerHTML = `
    <div class="pdl-final-head">🎯 VERDICT AKHIR — Edit Manual <span class="pdl-final-manual-tag">editing</span></div>
    <textarea class="pdl-final-editarea" id="pdl-final-ta" placeholder="Tulis verdict akhir manual...">${escapeHtml(starter)}</textarea>
    <div class="pdl-sec-verdict-edit-row">
      <button class="pdl-sec-verdict-edit-cancel" onclick="cancelFinalVerdictOverride(${perumId})">Batal</button>
      <button class="pdl-sec-verdict-edit-save" onclick="saveFinalVerdictOverride(${perumId})">💾 Simpan</button>
    </div>
  `;
  const ta = document.getElementById('pdl-final-ta');
  if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function saveFinalVerdictOverride(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  const ta = document.getElementById('pdl-final-ta');
  if(!ta) return;
  const val = ta.value.trim();
  if(val) p.tapera.verdictFinalNote = val;
  else delete p.tapera.verdictFinalNote;
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast(val ? '✓ Verdict akhir disimpan' : '↺ Kembali ke auto');
  _renderPdlBody(perumId);
}

function cancelFinalVerdictOverride(perumId){ _renderPdlBody(perumId); }

function revertFinalVerdictOverride(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!confirm('Kembalikan Verdict Akhir ke auto-generated? Teks manual akan terhapus.')) return;
  if(p.tapera) delete p.tapera.verdictFinalNote;
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast('↺ Verdict akhir dikembalikan ke auto');
  _renderPdlBody(perumId);
}

// ============================================================
// [TAHAP4A] Per-section verdicts di Vs Anchor tab
// Re-use engine dari PDL (Detail Lengkap) biar sinkron
// ============================================================

// Build semua 6 section verdict + final verdict untuk target perumahan di Vs Anchor
// [FIX A] Filter berdasarkan section aktif:
// - ringkasan = tampilkan SEMUA 6 verdict + verdict akhir
// - place/product/price/promotion/performance/gtm = hanya verdict section itu saja
// - market (Market Insight) = tampilkan Verdict Akhir saja (tidak ada verdict khusus market)
function buildVsaSectionVerdicts(target){
  if(!target || !target.p) return '';
  const p = target.p;
  const scores = _calcAllSectionScores(p);
  const allSectionMeta = [
    {id:'place',       emoji:'📍', name:'Place'},
    {id:'product',     emoji:'🏠', name:'Product'},
    {id:'price',       emoji:'💰', name:'Price'},
    {id:'promotion',   emoji:'📢', name:'Promotion'},
    {id:'performance', emoji:'📈', name:'Performance'},
    {id:'gtm',         emoji:'👔', name:'Go-to-Market'}
  ];
  // Tentukan section mana yang di-render berdasarkan section aktif
  const activeSection = (typeof vsaActiveSectionId === 'string' && vsaActiveSectionId) ? vsaActiveSectionId : 'ringkasan';
  const verdictSectionIds = ['place','product','price','promotion','performance','gtm'];
  let sectionMeta;
  let showFinalVerdict;
  let headerLabel;
  if(activeSection === 'ringkasan'){
    sectionMeta = allSectionMeta;           // semua
    showFinalVerdict = true;
    headerLabel = 'Verdict Per Section';
  } else if(verdictSectionIds.includes(activeSection)){
    sectionMeta = allSectionMeta.filter(m=>m.id===activeSection);
    showFinalVerdict = false;
    headerLabel = `Verdict ${allSectionMeta.find(m=>m.id===activeSection)?.name||''}`;
  } else {
    // section lain (market, custom, dll) — tidak punya verdict khusus, skip
    return '';
  }

  const itemsHtml = sectionMeta.map(meta => {
    const score = scores[meta.id];
    const autoText = _genSectionVerdict(meta.id, p, score);
    const override = _getVerdictOverride(p, meta.id);
    const isManual = !!override;
    const displayText = isManual ? escapeHtml(override).replace(/\n/g,'<br>') : autoText;
    const tag = isManual
      ? `<span class="vsa-sv-tag manual">manual</span>`
      : `<span class="vsa-sv-tag auto">auto</span>`;
    const revertBtn = isManual
      ? `<button class="vsa-sv-btn revert" onclick="vsaEditVerdictRevert('${meta.id}', ${p.id})" title="Kembali ke auto">↺ Auto</button>`
      : '';
    return `<div class="vsa-sv-item ${isManual?'manual':''}" id="vsa-sv-${meta.id}-${p.id}">
      <div class="vsa-sv-item-head">
        <div class="vsa-sv-item-title">${meta.emoji} ${meta.name}</div>
        <div class="vsa-sv-actions">
          <span class="vsa-sv-score ${_pdlScoreClass(score)}">${score}/100</span>
          ${tag}
          <button class="vsa-sv-btn" onclick="vsaEditVerdictStart('${meta.id}', ${p.id})" title="Edit manual">✎</button>
          ${revertBtn}
        </div>
      </div>
      <div class="vsa-sv-text" id="vsa-sv-text-${meta.id}-${p.id}">${displayText}</div>
    </div>`;
  }).join('');

  // Final verdict (hanya di Ringkasan)
  let finalBlockHtml = '';
  if(showFinalVerdict){
    const finalV = _genFinalVerdict(scores, p);
    const finalOverride = _getFinalVerdictOverride(p);
    const isFinalManual = !!finalOverride;
    const finalNarasiHtml = isFinalManual
      ? escapeHtml(finalOverride).replace(/\n/g,'<br>')
      : finalV.narasi;
    const finalTag = isFinalManual
      ? `<span class="vsa-sv-tag manual">manual</span>`
      : `<span class="vsa-sv-tag auto">auto-generated</span>`;
    const finalRevertBtn = isFinalManual
      ? `<button class="vsa-sv-btn revert" onclick="vsaEditFinalVerdictRevert(${p.id})" title="Kembali ke auto">↺ Auto</button>`
      : '';
    const unggulHtml = finalV.unggul.length ? `<ul>${finalV.unggul.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>` : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
    const risikoHtml = finalV.risiko.length ? `<ul>${finalV.risiko.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>` : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
    finalBlockHtml = `<div class="vsa-final ${isFinalManual?'manual':''}" id="vsa-final-block-${p.id}">
      <div class="vsa-final-head">
        <span>🎯 VERDICT AKHIR — Skor rata² ${scores.avg}/100</span>
        <span class="vsa-sv-actions">
          ${finalTag}
          <button class="vsa-sv-btn" onclick="vsaEditFinalVerdictStart(${p.id})" title="Edit manual">✎ Edit</button>
          ${finalRevertBtn}
        </span>
      </div>
      <div class="vsa-final-narasi" id="vsa-final-narasi-${p.id}">${finalNarasiHtml}</div>
      <div class="vsa-final-grid">
        <div class="vsa-final-card v-good"><div class="vsa-final-card-lbl">✓ Unggul</div>${unggulHtml}</div>
        <div class="vsa-final-card v-warn"><div class="vsa-final-card-lbl">⚠ Risiko</div>${risikoHtml}</div>
      </div>
      ${finalV.rekomendasi ? `<div class="vsa-final-rekom"><div class="vsa-final-rekom-lbl">💡 Rekomendasi Action</div>${escapeHtml(finalV.rekomendasi)}</div>` : ''}
    </div>`;
  }

  return `<div class="vsa-sec-verdict-container">
    <div class="vsa-sec-verdict-header">
      <span>📝 ${headerLabel}</span>
      <span class="nama-target">⭐ ${escapeHtml(p.nama)}</span>
    </div>
    <div class="vsa-sec-verdict-stack">${itemsHtml}</div>
    ${finalBlockHtml}
  </div>`;
}

// Handlers edit khusus Vs Anchor (re-render Vs Anchor, bukan PDL body)
function _vsaReRender(){
  // Re-render tab-compare berdasarkan perumahan fokus/anchor yang aktif
  if(typeof selectedId !== 'undefined' && selectedId != null){
    const p = perumahan.find(x=>x.id===selectedId);
    if(p && typeof renderDetailCompare === 'function') renderDetailCompare(p);
  }
}

function vsaEditVerdictStart(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  const block = document.getElementById(`vsa-sv-${sectionId}-${perumId}`);
  if(!block) return;
  const current = _getVerdictOverride(p, sectionId) || '';
  let starter = current;
  if(!starter){
    const txtEl = document.getElementById(`vsa-sv-text-${sectionId}-${perumId}`);
    if(txtEl){
      const tmp = document.createElement('div');
      tmp.innerHTML = txtEl.innerHTML;
      starter = tmp.textContent || tmp.innerText || '';
    }
  }
  const labelMap = {place:'Place',product:'Product',price:'Price',promotion:'Promotion',performance:'Performance',gtm:'GTM'};
  block.innerHTML = `
    <div class="vsa-sv-item-head">
      <div class="vsa-sv-item-title">✎ Edit Verdict ${labelMap[sectionId]||sectionId}</div>
      <span class="vsa-sv-tag manual">editing</span>
    </div>
    <textarea class="vsa-sv-editarea" id="vsa-sv-ta-${sectionId}-${perumId}" placeholder="Tulis verdict manual...">${escapeHtml(starter)}</textarea>
    <div class="vsa-sv-edit-row">
      <button class="vsa-sv-edit-cancel" onclick="vsaEditVerdictCancel('${sectionId}', ${perumId})">Batal</button>
      <button class="vsa-sv-edit-save" onclick="vsaEditVerdictSave('${sectionId}', ${perumId})">💾 Simpan</button>
    </div>
  `;
  const ta = document.getElementById(`vsa-sv-ta-${sectionId}-${perumId}`);
  if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function vsaEditVerdictSave(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  if(!p.tapera.verdictSectionNotes) p.tapera.verdictSectionNotes = {};
  const ta = document.getElementById(`vsa-sv-ta-${sectionId}-${perumId}`);
  if(!ta) return;
  const val = ta.value.trim();
  if(val) p.tapera.verdictSectionNotes[sectionId] = val;
  else delete p.tapera.verdictSectionNotes[sectionId];
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast(val ? '✓ Verdict disimpan' : '↺ Kembali ke auto');
  _vsaReRender();
}

function vsaEditVerdictCancel(sectionId, perumId){ _vsaReRender(); }

function vsaEditVerdictRevert(sectionId, perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  const labelMap = {place:'Place',product:'Product',price:'Price',promotion:'Promotion',performance:'Performance',gtm:'GTM'};
  if(!confirm(`Kembalikan Verdict ${labelMap[sectionId]||sectionId} ke auto-generated? Teks manual akan terhapus.`)) return;
  if(p.tapera?.verdictSectionNotes){ delete p.tapera.verdictSectionNotes[sectionId]; }
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast('↺ Verdict dikembalikan ke auto');
  _vsaReRender();
}

// Final verdict handlers
function vsaEditFinalVerdictStart(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  const block = document.getElementById(`vsa-final-block-${perumId}`);
  if(!block) return;
  const current = _getFinalVerdictOverride(p) || '';
  let starter = current;
  if(!starter){
    const narEl = document.getElementById(`vsa-final-narasi-${perumId}`);
    if(narEl){
      const tmp = document.createElement('div');
      tmp.innerHTML = narEl.innerHTML;
      starter = tmp.textContent || tmp.innerText || '';
    }
  }
  block.innerHTML = `
    <div class="vsa-final-head">
      <span>🎯 VERDICT AKHIR — Edit Manual</span>
      <span class="vsa-sv-tag manual">editing</span>
    </div>
    <textarea class="vsa-sv-editarea" id="vsa-final-ta-${perumId}" placeholder="Tulis verdict akhir manual...">${escapeHtml(starter)}</textarea>
    <div class="vsa-sv-edit-row">
      <button class="vsa-sv-edit-cancel" onclick="vsaEditFinalVerdictCancel(${perumId})">Batal</button>
      <button class="vsa-sv-edit-save" onclick="vsaEditFinalVerdictSave(${perumId})">💾 Simpan</button>
    </div>
  `;
  const ta = document.getElementById(`vsa-final-ta-${perumId}`);
  if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
function vsaEditFinalVerdictSave(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  const ta = document.getElementById(`vsa-final-ta-${perumId}`);
  if(!ta) return;
  const val = ta.value.trim();
  if(val) p.tapera.verdictFinalNote = val;
  else delete p.tapera.verdictFinalNote;
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast(val ? '✓ Verdict akhir disimpan' : '↺ Kembali ke auto');
  _vsaReRender();
}
function vsaEditFinalVerdictCancel(perumId){ _vsaReRender(); }
function vsaEditFinalVerdictRevert(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!confirm('Kembalikan Verdict Akhir ke auto-generated? Teks manual akan terhapus.')) return;
  if(p.tapera) delete p.tapera.verdictFinalNote;
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast('↺ Verdict akhir dikembalikan ke auto');
  _vsaReRender();
}

// Modal control
let _pdlCurrentId = null;
function openPdlModal(perumId){
  _pdlCurrentId = perumId;
  window.__currentPdlPerumId = perumId;
  _renderPdlSelector();
  _renderPdlBody(perumId);
  document.getElementById('pdl-overlay').classList.add('open');
  // [v12.4 STATE PERSISTENCE] Save state agar setelah refresh modal masih terbuka
  if(typeof triggerSaveAppState === 'function') triggerSaveAppState();
}
function closePdlModal(){
  document.getElementById('pdl-overlay').classList.remove('open');
  _pdlCurrentId = null;
  window.__currentPdlPerumId = null;
  // [v12.4 STATE PERSISTENCE] Update state setelah modal ditutup
  if(typeof triggerSaveAppState === 'function') triggerSaveAppState();
}
function switchPdlPerum(perumId){
  const id = parseInt(perumId);
  if(isNaN(id)) return;
  _pdlCurrentId = id;
  _renderPdlBody(id);
}
function _renderPdlSelector(){
  const sel = document.getElementById('pdl-selector');
  if(!sel) return;
  const sorted = [...perumahan].sort((a,b)=>{
    if(a.id===ANCHOR_ID) return -1;
    if(b.id===ANCHOR_ID) return 1;
    return (a.nama||'').localeCompare(b.nama||'');
  });
  sel.innerHTML = sorted.map(p=>{
    const isAnch = p.id === ANCHOR_ID;
    return `<option value="${p.id}" ${p.id===_pdlCurrentId?'selected':''}>${isAnch?'⭐ ':''}${escapeHtml(p.nama)} · ${escapeHtml(p.area||'')}</option>`;
  }).join('');
}
function _renderPdlBody(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p){ document.getElementById('pdl-body').innerHTML = '<div style="padding:40px;text-align:center;color:var(--faint);">Perumahan tidak ditemukan.</div>'; return; }
  // Update header
  document.getElementById('pdl-head-title').textContent = p.nama + (p.id===ANCHOR_ID?' ⭐':'');
  document.getElementById('pdl-head-sub').textContent = `${p.area||'—'} · Launching ${p.tahun||'—'} · ${p.developer||'—'}`;
  const scores = _calcAllSectionScores(p);
  const finalV = _genFinalVerdict(scores, p);
  const t = p.tapera || {};
  const sd = p._scoreDetail || calcScoreFull(p);
  const curYear = new Date().getFullYear();
  // Helper untuk data row
  const dataRow = (lbl, val, empty=false) => `<div class="pdl-data-row"><div class="pdl-data-lbl">${lbl}</div><div class="pdl-data-val ${empty?'empty':''}">${val}</div></div>`;
  const optVal = (v, fallback='—') => (v!=null && v!=='' && v!==false) ? escapeHtml(String(v)) : `<span style="color:var(--faint);font-style:italic;">${fallback}</span>`;
  // [TAHAP4B-2] Render custom/template fields yang sudah aktif untuk section tertentu
  const customRows = (secId) => {
    const cust = (FM_STATE.customFields[secId] || []).filter(f => !_isFieldHidden(f.id));
    if(!cust.length) return '';
    const rows = cust.map(f => {
      const val = p.customFields?.[f.id];
      let displayVal;
      if(val == null || val === '' || (Array.isArray(val) && !val.length)){
        displayVal = `<span style="color:var(--faint);font-style:italic;">—</span>`;
      } else if(Array.isArray(val)){
        displayVal = escapeHtml(val.join(', '));
      } else if(f.type === 'yesno'){
        displayVal = val ? 'Ya' : 'Tidak';
      } else {
        displayVal = escapeHtml(String(val));
      }
      return dataRow(escapeHtml(f.label), displayVal);
    }).join('');
    return rows;
  };
  // ─── SECTION BUILDERS ───
  const secPlace = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">📍 Place (Lokasi)</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.place)}">${scores.place}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Koordinat', `${p.lat?.toFixed(5)}, ${p.lng?.toFixed(5)}`)}
        ${dataRow('Area', optVal(p.area))}
        ${dataRow('Skor Aksesibilitas', sd.aksesibilitas+'/100')}
        ${dataRow('Skor Fasilitas', sd.fasilitas+'/100')}
        ${dataRow('Skor Fisik', sd.fisik+'/100')}
        ${dataRow('Jarak RS terdekat', sd.detail?.rs?.dist!=null ? sd.detail.rs.dist+' km' : '—')}
        ${dataRow('Jarak Kampus', sd.detail?.kampus?.dist!=null ? sd.detail.kampus.dist+' km' : '—')}
        ${dataRow('Jarak Mall', sd.detail?.mall?.dist!=null ? sd.detail.mall.dist+' km' : '—')}
        ${customRows('place')}
      </div>
      ${_renderSectionVerdict('place', p, scores.place, _genSectionVerdict('place', p, scores.place))}
    </div>
  </div>`;
  const secProduct = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">🏠 Product</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.product)}">${scores.product}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Total Unit', p.unit ? fmt(p.unit) : '—')}
        ${dataRow('Tahun Launching', p.tahun || '—')}
        ${dataRow('Umur Proyek', p.tahun ? (curYear-p.tahun)+' tahun' : '—')}
        ${dataRow('Tipe Perumahan', TIPE_LABEL[p.tipe] || optVal(p.tipe))}
        ${dataRow('Luas Tanah', optVal(t.luasTanah))}
        ${dataRow('Luas Bangunan', optVal(t.luasBangunan))}
        ${customRows('product')}
      </div>
      ${_renderSectionVerdict('product', p, scores.product, _genSectionVerdict('product', p, scores.product))}
    </div>
  </div>`;
  const secPrice = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">💰 Price</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.price)}">${scores.price}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Harga Range', optVal(t.hargaRange))}
        ${dataRow('Tenor Dominan', optVal(t.tenorDominan))}
        ${dataRow('Uang Muka', optVal(t.uangMukaRange))}
        ${dataRow('Bank Dominan', optVal(t.bankDominan))}
        ${dataRow('Nominal FLPP', t.nominalFLPP ? t.nominalFLPP+' M' : '—')}
        ${customRows('price')}
      </div>
      ${_renderSectionVerdict('price', p, scores.price, _genSectionVerdict('price', p, scores.price))}
    </div>
  </div>`;
  const promo = t.promotion || {};
  const secPromo = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">📢 Promotion</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.promotion)}">${scores.promotion}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Promo Aktif', optVal(promo.promoAktif))}
        ${dataRow('Periode Promo', optVal(promo.periode))}
        ${dataRow('Bonus Pembelian', optVal(promo.bonus))}
        ${dataRow('Iklan di Platform', optVal(promo.iklanPlatform))}
        ${dataRow('Billboard/Spanduk', optVal(promo.billboard))}
        ${customRows('promotion')}
      </div>
      ${_renderSectionVerdict('promotion', p, scores.promotion, _genSectionVerdict('promotion', p, scores.promotion))}
    </div>
  </div>`;
  const bulanan = t.realisasiBulanan || [];
  const trend = bulanan.length >= 4 ? _calcTaperaTrend(bulanan) : null;
  const pct = p.unit > 0 ? Math.round((p.realisasi||0)/p.unit*100) : 0;
  const secPerf = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">📈 Performance</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.performance)}">${scores.performance}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Total Unit', p.unit ? fmt(p.unit) : '—')}
        ${dataRow('Realisasi', p.realisasi ? fmt(p.realisasi) : '—')}
        ${dataRow('Progress', pct+'%')}
        ${dataRow('Total Realisasi Tapera', t.totalRealisasi ? fmt(t.totalRealisasi)+' unit' : '—')}
        ${dataRow('Data Bulanan', bulanan.length ? bulanan.length+' bulan' : '—')}
        ${dataRow('Trend 3-bln', trend ? `${trend.arrow} ${trend.pctStr}` : '—')}
        ${customRows('performance')}
      </div>
      ${_renderSectionVerdict('performance', p, scores.performance, _genSectionVerdict('performance', p, scores.performance))}
    </div>
  </div>`;
  const gtm = t.gtm || {};
  const secGtm = `<div class="pdl-sec">
    <div class="pdl-sec-head">
      <div class="pdl-sec-title">👔 Go-to-Market</div>
      <div class="pdl-sec-score ${_pdlScoreClass(scores.gtm)}">${scores.gtm}/100</div>
    </div>
    <div class="pdl-sec-body">
      <div class="pdl-data-grid">
        ${dataRow('Marketing In-house', gtm.marketingInhouse!=null ? gtm.marketingInhouse+' org' : '—')}
        ${dataRow('Struktur Kanal', optVal(gtm.strukturKanal))}
        ${dataRow('Jumlah Agent', gtm.jumlahAgent!=null ? gtm.jumlahAgent+' agent' : '—')}
        ${dataRow('Fee Marketing', optVal(gtm.feeMarketing))}
        ${dataRow('Fee Agent', optVal(gtm.feeAgent))}
        ${dataRow('Brand Developer', optVal(gtm.brandDeveloper))}
        ${customRows('gtm')}
      </div>
      ${_renderSectionVerdict('gtm', p, scores.gtm, _genSectionVerdict('gtm', p, scores.gtm))}
    </div>
  </div>`;
  // Final verdict
  const unggulHtml = finalV.unggul.length ? `<ul>${finalV.unggul.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>` : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
  const risikoHtml = finalV.risiko.length ? `<ul>${finalV.risiko.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>` : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
  const finalOverride = _getFinalVerdictOverride(p);
  const isFinalManual = !!finalOverride;
  const finalNarasiHtml = isFinalManual
    ? escapeHtml(finalOverride).replace(/\n/g,'<br>')
    : finalV.narasi;
  const finalTag = isFinalManual
    ? `<span class="pdl-final-manual-tag">manual</span>`
    : `<span style="font-size:10px;font-weight:600;color:var(--accent);background:white;padding:2px 8px;border-radius:10px;">auto-generated</span>`;
  const finalRevertBtn = isFinalManual
    ? `<button class="pdl-final-edit-btn revert" onclick="revertFinalVerdictOverride(${p.id})" title="Kembalikan ke auto">↺ Auto</button>`
    : '';
  const finalBlock = `<div class="pdl-final ${isFinalManual?'manual':''}" id="pdl-final-block">
    <div class="pdl-final-head">
      <span>🎯 VERDICT AKHIR</span>
      <span class="pdl-final-actions">
        ${finalTag}
        <button class="pdl-final-edit-btn" onclick="editFinalVerdictOverride(${p.id})" title="Edit verdict akhir">✎ Edit</button>
        ${finalRevertBtn}
      </span>
    </div>
    <div class="pdl-final-narasi" id="pdl-final-narasi">${finalNarasiHtml}</div>
    <div class="pdl-final-grid">
      <div class="pdl-final-card v-good"><div class="pdl-final-card-lbl">✓ Unggul</div>${unggulHtml}</div>
      <div class="pdl-final-card v-warn"><div class="pdl-final-card-lbl">⚠ Risiko</div>${risikoHtml}</div>
    </div>
    ${finalV.rekomendasi ? `<div class="pdl-rekom"><div class="pdl-rekom-lbl">💡 Rekomendasi Action</div>${escapeHtml(finalV.rekomendasi)}</div>` : ''}
  </div>`;
  // ─── ASSEMBLE ───
  const overallBanner = `<div class="pdl-overall">
    <div class="pdl-overall-score">${scores.avg}<small>/100</small></div>
    <div class="pdl-overall-info">
      <div class="pdl-overall-nama">${escapeHtml(p.nama)} ${p.id===ANCHOR_ID?'⭐':''}</div>
      <div class="pdl-overall-dev">${escapeHtml(p.developer||'—')}</div>
      <div class="pdl-overall-meta">Skor rata-rata dari 6 dimensi · ${p.area||'—'} · ${p.tahun||'—'}</div>
    </div>
  </div>`;
  document.getElementById('pdl-body').innerHTML = overallBanner + secPlace + secProduct + secPrice + secPromo + secPerf + secGtm + finalBlock;
  // Scroll to top on switch
  document.getElementById('pdl-body').scrollTop = 0;
}
// ESC to close PDL modal
document.addEventListener('keydown', function(e){
  if(e.key==='Escape'){
    const ov = document.getElementById('pdl-overlay');
    if(ov && ov.classList.contains('open')) closePdlModal();
  }
});

// [TAHAP2] Verdict generator — auto analisa unggul/risiko + narasi
function generateVerdict(cols, sds, distToAnchor){
  const anchorIdx = cols.findIndex(c=>c.role==='anchor');
  const focusIdx = cols.findIndex(c=>c.role==='focus');
  // Target verdict: perumahan FOKUS (kalau tidak ada focus, pakai anchor)
  const targetIdx = focusIdx>=0 ? focusIdx : anchorIdx;
  const target = cols[targetIdx];
  if(!target) return null;
  const targetSd = sds[targetIdx];
  const others = cols.filter((c,i)=>i!==targetIdx);
  const othersSd = sds.filter((s,i)=>i!==targetIdx);
  const unggul = [];
  const risiko = [];
  // --- Analisa Skor ---
  if(othersSd.length){
    const avgOverall = Math.round(othersSd.reduce((a,b)=>a+b.overall,0)/othersSd.length);
    const avgAks = Math.round(othersSd.reduce((a,b)=>a+b.aksesibilitas,0)/othersSd.length);
    const avgFas = Math.round(othersSd.reduce((a,b)=>a+b.fasilitas,0)/othersSd.length);
    if(targetSd.overall - avgOverall >= 8) unggul.push(`Skor overall ${targetSd.overall} (vs rata² ${avgOverall})`);
    else if(avgOverall - targetSd.overall >= 8) risiko.push(`Skor overall ${targetSd.overall} di bawah rata² grup (${avgOverall})`);
    if(targetSd.aksesibilitas >= 80) unggul.push(`Aksesibilitas tinggi (${targetSd.aksesibilitas})`);
    if(targetSd.fasilitas >= 80) unggul.push(`Fasilitas lengkap (${targetSd.fasilitas})`);
    if(targetSd.aksesibilitas <= 55) risiko.push(`Aksesibilitas rendah (${targetSd.aksesibilitas})`);
  }
  // --- Analisa Velocity Tapera ---
  const tVal = target.p.tapera;
  if(tVal?.realisasiBulanan?.length >= 4){
    const trend = _calcTaperaTrend(tVal.realisasiBulanan);
    if(trend.dir==='up') unggul.push(`Trend penjualan naik (${trend.pctStr})`);
    else if(trend.dir==='down') risiko.push(`Trend penjualan turun (${trend.pctStr})`);
  }
  const tProgress = target.p.unit>0 ? (target.p.realisasi||0)/target.p.unit : 0;
  if(tProgress >= 0.8) unggul.push(`Serap unit tinggi (${Math.round(tProgress*100)}%)`);
  else if(tProgress < 0.2 && target.p.realisasi>0) risiko.push(`Serap unit masih rendah (${Math.round(tProgress*100)}%)`);
  // --- Analisa Go-to-Market ---
  const gtm = tVal?.gtm;
  if(gtm){
    if(gtm.marketingInhouse!=null && gtm.marketingInhouse<=2 && (gtm.jumlahAgent==null || gtm.jumlahAgent===0)){
      risiko.push(`Tim marketing kecil (${gtm.marketingInhouse} org, tanpa agent)`);
    }
    if(gtm.strukturKanal && /agent/i.test(gtm.strukturKanal) && gtm.jumlahAgent>=10){
      unggul.push(`Jaringan agent kuat (${gtm.jumlahAgent} agent)`);
    }
  }
  // --- Analisa Promotion ---
  const promo = tVal?.promotion;
  if(promo){
    const hasPromo = promo.promoAktif && promo.promoAktif.trim();
    const othersHasPromo = others.filter(c=>c.p.tapera?.promotion?.promoAktif?.trim()).length;
    if(!hasPromo && othersHasPromo>=1) risiko.push(`Tidak ada promo aktif (${othersHasPromo} kompetitor gencar promo)`);
    else if(hasPromo && othersHasPromo===0) unggul.push('Satu-satunya yang promo aktif');
  }
  // Build narasi
  const goodTxt = unggul.length ? unggul.slice(0,2).map(t=>`<b class="v-good">${escapeHtml(t)}</b>`).join(' dan ') : '';
  const warnTxt = risiko.length ? risiko.slice(0,2).map(t=>`<b class="v-warn">${escapeHtml(t)}</b>`).join(' dan ') : '';
  let narasi = '';
  if(goodTxt && warnTxt){
    narasi = `Perumahan ini <b class="v-good">unggul</b> di ${goodTxt}. Namun ${warnTxt}.`;
  } else if(goodTxt){
    narasi = `Perumahan ini <b class="v-good">unggul</b> di ${goodTxt}.`;
  } else if(warnTxt){
    narasi = `Perumahan ini <b class="v-warn">perlu perhatian</b>: ${warnTxt}.`;
  } else {
    narasi = 'Data belum cukup untuk menarik kesimpulan. Lengkapi data Tapera, promotion, dan GTM untuk verdict yang akurat.';
  }
  // Rekomendasi action (simple rule-based)
  const rekomendasi = [];
  if(risiko.some(r=>/tim marketing kecil/i.test(r))) rekomendasi.push('Pertimbangkan rekrut agent marketing tambahan');
  if(risiko.some(r=>/tidak ada promo/i.test(r))) rekomendasi.push('Siapkan paket promo untuk bersaing');
  if(risiko.some(r=>/trend penjualan turun/i.test(r))) rekomendasi.push('Audit kampanye dan saluran jualan');
  if(unggul.some(u=>/jaringan agent kuat/i.test(u))) rekomendasi.push('Leverage jaringan agent untuk dorong velocity');
  const rekomendasiTxt = rekomendasi.length ? rekomendasi.join('. ') + '.' : '';
  return {
    targetId: target.p.id,
    targetNama: target.p.nama,
    narasi,
    unggul: unggul.slice(0,4),
    risiko: risiko.slice(0,4),
    rekomendasi: rekomendasiTxt
  };
}

// [TAHAP2] Build HTML block verdict (dipanggil dari renderDetailCompare)
function buildVerdictHtml(verdict){
  if(!verdict) return '';
  const p = perumahan.find(x=>x.id===verdict.targetId);
  const bmNote = p?.tapera?.verdictBmNote || '';
  const bmNoteHtml = bmNote.trim()
    ? `<div class="vsa-verdict-bm-text">${escapeHtml(bmNote)}</div>`
    : `<div class="vsa-verdict-bm-text empty">Belum ada catatan. Klik "✎ Edit" untuk menambah observasi lapangan.</div>`;
  const unggulHtml = verdict.unggul.length
    ? `<ul>${verdict.unggul.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>`
    : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
  const risikoHtml = verdict.risiko.length
    ? `<ul>${verdict.risiko.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul>`
    : `<div style="font-size:10px;color:var(--faint);font-style:italic;">—</div>`;
  const rekomHtml = verdict.rekomendasi
    ? `<div style="padding:9px 11px;background:#FAFAF8;border:1px solid var(--border);border-radius:7px;margin-bottom:8px;">
         <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--muted);margin-bottom:4px;">💡 Rekomendasi Action <span class="vsa-verdict-auto-tag">auto</span></div>
         <div style="font-size:11px;line-height:1.55;color:var(--text);">${escapeHtml(verdict.rekomendasi)}</div>
       </div>`
    : '';
  return `<div class="vsa-verdict" id="vsa-verdict-block">
    <div class="vsa-verdict-head">
      <div class="vsa-verdict-title">📝 Verdict — ${escapeHtml(verdict.targetNama)}</div>
      <span class="vsa-verdict-auto-tag">auto-generated</span>
    </div>
    <div class="vsa-verdict-narasi">${verdict.narasi}</div>
    <div class="vsa-verdict-grid">
      <div class="vsa-verdict-card v-good">
        <div class="vsa-verdict-card-lbl">✓ Unggul</div>
        ${unggulHtml}
      </div>
      <div class="vsa-verdict-card v-warn">
        <div class="vsa-verdict-card-lbl">⚠ Risiko</div>
        ${risikoHtml}
      </div>
    </div>
    ${rekomHtml}
    <div class="vsa-verdict-bm" id="vsa-verdict-bm-wrap">
      <div class="vsa-verdict-bm-head">
        <span>📌 Catatan BM (manual)</span>
        <button class="vsa-verdict-bm-edit" onclick="toggleVerdictBmEdit(${verdict.targetId})">✎ Edit</button>
      </div>
      ${bmNoteHtml}
    </div>
  </div>`;
}

// [TAHAP2] Toggle edit mode untuk catatan BM
function toggleVerdictBmEdit(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  const wrap = document.getElementById('vsa-verdict-bm-wrap');
  if(!wrap) return;
  const current = p.tapera.verdictBmNote || '';
  wrap.innerHTML = `
    <div class="vsa-verdict-bm-head">
      <span>📌 Catatan BM (manual) — Edit</span>
    </div>
    <textarea class="vsa-verdict-bm-editarea" id="vsa-verdict-bm-ta" placeholder="Ketik observasi lapangan...">${escapeHtml(current)}</textarea>
    <div style="display:flex;gap:6px;justify-content:flex-end;">
      <button style="background:#FAFAF8;color:var(--muted);border:1px solid var(--border);padding:4px 10px;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;" onclick="cancelVerdictBmEdit(${perumId})">Batal</button>
      <button style="background:var(--accent);color:white;border:none;padding:4px 10px;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;" onclick="saveVerdictBmEdit(${perumId})">💾 Simpan</button>
    </div>
  `;
  document.getElementById('vsa-verdict-bm-ta').focus();
}
function saveVerdictBmEdit(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(!p) return;
  if(!p.tapera) p.tapera = {};
  const ta = document.getElementById('vsa-verdict-bm-ta');
  if(!ta) return;
  p.tapera.verdictBmNote = ta.value.trim();
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  if(typeof setEditorDirty==='function') try{setEditorDirty(true);}catch(_){}
  showToast('✓ Catatan BM disimpan');
  // Re-render verdict
  renderDetailCompare(p);
}
function cancelVerdictBmEdit(perumId){
  const p = perumahan.find(x=>x.id===perumId);
  if(p) renderDetailCompare(p);
}

function renderDetailCompare(p){
  const anchor=perumahan.find(x=>x.id===ANCHOR_ID);
  const isAnch=p.id===ANCHOR_ID;
  // [TAHAP 4] Jika user klik anchor sendiri, tetap bisa banding — tapi "fokus" dianggap anchor
  // dan kolom lain harus dari compareExtraIds. Kalau extras kosong, tampilkan prompt.
  if(isAnch && compareExtraIds.length===0){
    document.getElementById('tab-compare').innerHTML = `
      <div style="text-align:center;padding:32px 16px;color:var(--faint);font-size:12px;line-height:1.8">
        Ini adalah proyek Anchor.<br>
        Tambahkan pembanding untuk mulai banding multi.
        <div style="margin-top:14px;"><button class="cmp-add-btn" onclick="openCmpPicker()">+ Tambah pembanding</button></div>
      </div>`;
    return;
  }

  // [TAHAP 4] Bersihkan compareExtraIds dari ID yang sudah tidak valid, anchor, atau fokus
  compareExtraIds = compareExtraIds.filter(id => id!==ANCHOR_ID && id!==p.id && perumahan.some(x=>x.id===id));

  // Susun daftar proyek dalam urutan kolom: [anchor, fokus, ...extras]
  // Kalau fokus === anchor, tidak duplicate
  const cols = [];
  cols.push({p:anchor, role:'anchor', color:'var(--anchor)', label:'⭐ Anchor'});
  if(!isAnch) cols.push({p, role:'focus', color:(TIPE_COLOR[p.tipe]||'#666'), label:'🎯 Dipilih'});
  compareExtraIds.forEach((id,i)=>{
    const extra = perumahan.find(x=>x.id===id);
    if(extra) cols.push({p:extra, role:'extra', color:CMP_PALETTE[i%CMP_PALETTE.length], label:`Pembanding ${i+1}`});
  });

  // Helper nearest POI yang aware road upgrade
  const _nb = (x) => {
    const hav = nearestByKat(x), road = x._roadNearest || {};
    const out = {};
    Object.keys(KAT_LABEL).forEach(k => { out[k] = road[k] || hav[k]; });
    return out;
  };
  const nbs = cols.map(c=>_nb(c.p));
  const sds = cols.map(c=>c.p._scoreDetail || calcScoreFull(c.p));

  // Jarak tiap kolom ke anchor (untuk insight)
  const distToAnchor = cols.map(c=>{
    if(c.role==='anchor') return 0;
    const rk = c.p._roadPerum && c.p._roadPerum[ANCHOR_ID];
    return rk ? rk.km : haversine(c.p.lat,c.p.lng,anchor.lat,anchor.lng) * ROUTE_HAVERSINE_FACTOR;
  });
  const anyRoad = cols.some((c,i)=>c.role!=='anchor' && c.p._roadPerum && c.p._roadPerum[ANCHOR_ID] && c.p._roadPerum[ANCHOR_ID].viaRoad);

  // Kategori untuk row jarak ke POI
  const cats = Object.keys(KAT_LABEL);

  // Helper: highlight best/worst untuk nilai numerik (lebih tinggi = lebih baik untuk skor; lebih rendah = lebih baik untuk jarak)
  const highlightClass = (values, idx, lowerIsBetter) => {
    if(values.length<2) return 'cmp-val-mid';
    const valid = values.filter(v=>v!=null && !isNaN(v));
    if(valid.length<2) return 'cmp-val-mid';
    const best = lowerIsBetter ? Math.min(...valid) : Math.max(...valid);
    const worst= lowerIsBetter ? Math.max(...valid) : Math.min(...valid);
    if(values[idx]===best && best!==worst) return 'cmp-val-best';
    if(values[idx]===worst && best!==worst) return 'cmp-val-worst';
    return 'cmp-val-mid';
  };

  // Row builder — { key, label, values, lowerIsBetter, formatter }
  // [v18 SECTIONS] Setiap row sekarang punya `key` wajib — untuk mapping ke section.
  const rows = [
    {key:'skor_overall',label:VSA_ROW_LABEL.skor_overall, values: sds.map(s=>s.overall),        lowerIsBetter:false, fmt:(v)=>v},
    {key:'skor_aks',    label:VSA_ROW_LABEL.skor_aks,     values: sds.map(s=>s.aksesibilitas),  lowerIsBetter:false, fmt:(v)=>v},
    {key:'skor_fas',    label:VSA_ROW_LABEL.skor_fas,     values: sds.map(s=>s.fasilitas),      lowerIsBetter:false, fmt:(v)=>v},
    {key:'skor_fisik',  label:VSA_ROW_LABEL.skor_fisik,   values: sds.map(s=>s.fisik),          lowerIsBetter:false, fmt:(v)=>v},
  ];
  // Jarak ke POI per kategori — map kategori -> key
  const catToKey = {rs:'poi_rs', kampus:'poi_kampus', mall:'poi_mall', tol:'poi_tol', pemda:'poi_pemda', industri:'poi_industri', publik:'poi_publik'};
  cats.forEach(k=>{
    const vals = nbs.map(nb => nb[k] ? nb[k].dist : null);
    const rkey = catToKey[k];
    const label = rkey ? VSA_ROW_LABEL[rkey] : `${(poi.find(x=>x.kat===k)||{}).emoji||'📍'} ${KAT_LABEL[k]}`;
    rows.push({key:rkey, label, values:vals, lowerIsBetter:true, fmt:(v)=>v==null?'—':v.toFixed(1)+' km'});
  });
  // Data proyek
  rows.push({key:'proj_unit',     label:VSA_ROW_LABEL.proj_unit,      values: cols.map(c=>c.p.unit||0),      lowerIsBetter:false, fmt:(v)=>fmt(v)});
  rows.push({key:'proj_realisasi',label:VSA_ROW_LABEL.proj_realisasi, values: cols.map(c=>c.p.realisasi||0), lowerIsBetter:false, fmt:(v)=>fmt(v)});
  rows.push({key:'proj_progress', label:VSA_ROW_LABEL.proj_progress,  values: cols.map(c=>c.p.unit>0?Math.round((c.p.realisasi||0)/c.p.unit*100):0), lowerIsBetter:false, fmt:(v)=>v+'%'});

  // [v17 C] Row data Tapera — hanya tampil kalau minimal 1 kolom punya data Tapera
  const anyTapera = cols.some(c => c.p.tapera && c.p.tapera.realisasiBulanan && c.p.tapera.realisasiBulanan.length);
  if(anyTapera){
    // Helper untuk ambil top-1 label dari objek profil (misal {swasta:80, wiraswasta:15, other:5} → "swasta 80%")
    const topLabel = (obj) => {
      if(!obj || typeof obj !== 'object') return null;
      const entries = Object.entries(obj);
      if(!entries.length) return null;
      entries.sort((a,b)=>b[1]-a[1]);
      return entries[0]; // [key, val]
    };

    // Rata-rata unit/bulan (dari realisasiBulanan)
    const avgPerBulanVals = cols.map(c=>{
      const b = c.p.tapera?.realisasiBulanan;
      if(!b || !b.length) return null;
      const sum = b.reduce((a,x)=>a+(x.unit||0),0);
      return Math.round(sum/b.length * 10)/10;
    });
    rows.push({key:'tpr_avg', label:'📊 Tapera: rata²/bln', values: avgPerBulanVals, lowerIsBetter:false, fmt:(v)=>v==null?'—':v+' unit'});

    // Trend 3-bln terakhir
    const trendVals = cols.map(c=>{
      const b = c.p.tapera?.realisasiBulanan;
      if(!b || b.length<4) return null;
      const t = _calcTaperaTrend(b);
      const n = parseFloat(String(t.pctStr).replace('%','').replace('+',''));
      return isNaN(n) ? null : {num:n, icon:t.icon, str:t.pctStr, dir:t.dir};
    });
    rows.push({
      key:'tpr_trend', label:'📈 Trend 3-bln',
      values: trendVals.map(v=>v==null?null:v.num),
      lowerIsBetter:false,
      fmt:(v,i)=>{
        const t = trendVals[i];
        if(!t) return '—';
        const color = t.dir==='up'?'#15803D':(t.dir==='down'?'#B91C1C':'var(--muted)');
        return `<span style="color:${color};font-weight:700;">${t.icon} ${t.str}</span>`;
      }
    });

    // Total Realisasi Tapera
    rows.push({
      key:'tpr_total', label:'🏆 Total Realisasi', lowerIsBetter:false,
      values: cols.map(c=>c.p.tapera?.totalRealisasi ?? null),
      fmt:(v)=>v==null?'—':fmt(v)+' unit'
    });
    // Nominal FLPP
    rows.push({
      key:'tpr_flpp', label:'💵 Nominal FLPP', lowerIsBetter:false,
      values: cols.map(c=>c.p.tapera?.nominalFLPP ?? null),
      fmt:(v)=>v==null?'—':v+' M'
    });
    // Harga range
    rows.push({
      key:'tpr_harga', label:'💰 Harga range', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.hargaRange||null),
      fmt:(v)=>v||'—'
    });
    // Luas Tanah
    rows.push({
      key:'tpr_lt', label:'📐 Luas Tanah', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.luasTanah||null),
      fmt:(v)=>v||'—'
    });
    // Luas Bangunan
    rows.push({
      key:'tpr_lb', label:'🏠 Luas Bangunan', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.luasBangunan||null),
      fmt:(v)=>v||'—'
    });
    // Tenor Dominan
    rows.push({
      key:'tpr_tenor', label:'📅 Tenor Dominan', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.tenorDominan||null),
      fmt:(v)=>v||'—'
    });
    // Uang Muka Range
    rows.push({
      key:'tpr_um', label:'💳 Uang Muka', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.uangMukaRange||null),
      fmt:(v)=>v||'—'
    });
    // Bank Dominan
    rows.push({
      key:'tpr_bank', label:'🏦 Bank Dominan', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.bankDominan||null),
      fmt:(v)=>v||'—'
    });
    // Profil: Pekerjaan dominan
    rows.push({
      key:'tpr_pek', label:'💼 Pekerjaan dominan', noHighlight:true,
      values: cols.map(c=>topLabel(c.p.tapera?.profilPembeli?.pekerjaan)),
      fmt:(v)=>v?`${escapeHtml(v[0])} (${v[1]}%)`:'—'
    });
    // Profil: Usia dominan
    rows.push({
      key:'tpr_usia', label:'🎂 Usia dominan', noHighlight:true,
      values: cols.map(c=>topLabel(c.p.tapera?.profilPembeli?.usia)),
      fmt:(v)=>v?`${escapeHtml(v[0])}`:'—'
    });
    // Profil: Penghasilan dominan
    rows.push({
      key:'tpr_peng', label:'💴 Penghasilan dominan', noHighlight:true,
      values: cols.map(c=>topLabel(c.p.tapera?.profilPembeli?.penghasilan)),
      fmt:(v)=>v?`${escapeHtml(v[0])}`:'—'
    });
    // Profil: Gender dominan
    rows.push({
      key:'tpr_gender', label:'👥 Gender dominan', noHighlight:true,
      values: cols.map(c=>topLabel(c.p.tapera?.profilPembeli?.gender)),
      fmt:(v)=>v?`${escapeHtml(v[0])} (${v[1]}%)`:'—'
    });
    // [TAHAP1] Promotion rows
    rows.push({
      key:'tpr_promo_aktif', label:'🎁 Promo Aktif', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.promotion?.promoAktif||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_promo_periode', label:'📅 Periode Promo', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.promotion?.periode||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_promo_bonus', label:'🎉 Bonus Pembelian', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.promotion?.bonus||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_promo_iklan', label:'📱 Iklan di', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.promotion?.iklanPlatform||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_promo_bb', label:'📢 Billboard/Spanduk', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.promotion?.billboard||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    // [TAHAP1] Go-to-Market rows
    rows.push({
      key:'tpr_gtm_mkt', label:'👥 Marketing In-house', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.marketingInhouse||null),
      fmt:(v)=>v==null?'—':v+' org'
    });
    rows.push({
      key:'tpr_gtm_kanal', label:'🏢 Struktur Kanal', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.strukturKanal||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_gtm_agent', label:'🤝 Jumlah Agent', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.jumlahAgent||null),
      fmt:(v)=>v==null?'—':(v===0?'0':v+' agent')
    });
    rows.push({
      key:'tpr_gtm_fee_mkt', label:'💵 Fee Marketing', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.feeMarketing||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_gtm_fee_agt', label:'💵 Fee Agent', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.feeAgent||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
    rows.push({
      key:'tpr_gtm_dev', label:'🏪 Brand Developer', noHighlight:true,
      values: cols.map(c=>c.p.tapera?.gtm?.brandDeveloper||null),
      fmt:(v)=>v?escapeHtml(v):'—'
    });
  }

  // [TAHAP4B-2] Custom fields rows — per section, baca dari p.customFields[fieldId]
  try{
    Object.keys(FM_STATE.customFields||{}).forEach(secId => {
      (FM_STATE.customFields[secId]||[]).forEach(f => {
        if(_isFieldHidden(f.id)) return;
        rows.push({
          key: f.id,
          label: escapeHtml(f.label),
          noHighlight: true,
          values: cols.map(c => {
            const v = c.p.customFields?.[f.id];
            return v == null || v === '' ? null : v;
          }),
          fmt: (v) => {
            if(v == null) return '—';
            if(Array.isArray(v)) return v.length ? escapeHtml(v.join(', ')) : '—';
            if(f.type === 'yesno') return v===true?'Ya':(v===false?'Tidak':'—');
            return escapeHtml(String(v));
          }
        });
      });
    });
  }catch(e){ console.warn('custom rows err', e); }

  rows.push({label:'Launching', values: cols.map(c=>c.p.tahun||0), lowerIsBetter:false, fmt:(v)=>v||'—'});
  // Jarak ke anchor (skip di baris anchor sendiri — "—")
  rows.push({key:'dist_anchor', label:VSA_ROW_LABEL.dist_anchor, values: distToAnchor.map((d,i)=>cols[i].role==='anchor'?null:d), lowerIsBetter:true, fmt:(v)=>v==null?'—':v.toFixed(1)+' km'});

  // Build HTML
  const chipsHtml = cols.map((c,i)=>{
    const isRemovable = c.role==='extra';
    const isFocus = c.role==='focus';
    const isAnchorChip = c.role==='anchor';
    const nameShort = escapeHtml(c.p.nama);
    const bg = isAnchorChip ? 'var(--anchor-light)' : (isFocus ? 'rgba(59,130,246,0.12)' : c.color+'22');
    const txt = isAnchorChip ? 'var(--anchor)' : (isFocus ? '#1D4ED8' : c.color);
    const border = isAnchorChip ? 'var(--anchor)' : (isFocus ? '#1D4ED8' : c.color);
    return `<span class="cmp-chip" style="background:${bg};color:${txt};border:1px solid ${border};">
      <span class="cmp-chip-name" title="${nameShort}">${isAnchorChip?'⭐ ':(isFocus?'🎯 ':'')}${nameShort}</span>
      ${isRemovable?`<button class="cmp-chip-remove" onclick="removeCmpExtra(${c.p.id})" aria-label="Hapus">×</button>`:''}
    </span>`;
  }).join('');
  const remaining = 3 - compareExtraIds.length;
  const addBtn = remaining>0
    ? `<button class="cmp-add-btn" onclick="openCmpPicker()">+ tambah (${remaining} lagi)</button>`
    : `<button class="cmp-add-btn" disabled title="Max 3 pembanding">+ tambah (penuh)</button>`;

  const tableHead = `<tr><th class="cmp-lbl">Faktor</th>${cols.map(c=>`<th class="${c.role==='anchor'?'cmp-h-anchor':''}" title="${escapeHtml(c.p.nama)}" style="${c.role==='extra'?'color:'+c.color:''}">${c.role==='anchor'?'⭐':(c.role==='focus'?'🎯':(c.p.nama.substring(0,8)))}</th>`).join('')}</tr>`;

  // [v18 SECTIONS] Filter rows berdasarkan section aktif + quick-visibility toggle
  // 1) Ambil keys yang di-assign ke section aktif
  const activeSectionKeys = _getActiveSectionRows();
  // 2) Map row by key untuk lookup cepat
  const rowsByKey = {};
  rows.forEach(r => { if(r.key) rowsByKey[r.key] = r; });
  // 3) Build visibleRows mengikuti URUTAN di section config (bukan urutan rows asli)
  const visibleRows = activeSectionKeys
    .map(k => rowsByKey[k])
    .filter(r => r && vsaRowVisibility[r.key] !== false)
    // Row Tapera hanya tampil kalau ada data Tapera di salah satu kolom
    .filter(r => {
      if(r.key && r.key.startsWith('tpr_')) return anyTapera;
      return true;
    });

  // [TAHAP2] Simpan mapping colIdx -> perumahan id untuk modal detail
  const vsaColsForDetail = cols.map(c=>({id:c.p.id, nama:c.p.nama, role:c.role}));
  window._vsaDetailCols = vsaColsForDetail;

  const tableBody = visibleRows.length ? visibleRows.map(r=>{
    // [TAHAP2] Kalau row masuk VSA_COMPLEX_ROWS, tambah badge 📋 yang bisa diklik
    const isComplex = r.key && VSA_COMPLEX_ROWS.has(r.key);
    const labelHtml = isComplex
      ? `${r.label}<span class="vsa-complex-badge" onclick="openVsaDetail('${r.key}')" title="Lihat detail lengkap">📋 detail</span>`
      : r.label;
    return `<tr><td class="cmp-lbl">${labelHtml}</td>${
      r.values.map((v,i)=>{
        const cls = r.noHighlight ? 'cmp-val-mid' : highlightClass(r.values, i, r.lowerIsBetter);
        return `<td class="${cls}">${r.fmt(v,i)}</td>`;
      }).join('')
    }</tr>`;
  }).join('') : '';

  // Insight multi — rata-rata selisih skor, rata-rata realisasi, overlap/jauh
  const focusSd = sds[cols.findIndex(c=>c.role==='focus')] || sds[0];
  const others = cols.filter(c=>c.role!=='anchor');
  const avgScore = others.length ? Math.round(others.map(c=>(c.p._scoreDetail||calcScoreFull(c.p)).overall).reduce((a,b)=>a+b,0)/others.length) : 0;
  const anchorScore = sds[0].overall;
  const deltaAvg = anchorScore - avgScore;
  const insights = [];
  if(others.length>=2){
    if(deltaAvg>=10) insights.push({type:'good',text:`Anchor unggul rata-rata ${deltaAvg} poin vs ${others.length} kompetitor — posisi kuat.`});
    else if(deltaAvg<=-10) insights.push({type:'warn',text:`Anchor kalah rata-rata ${Math.abs(deltaAvg)} poin dari grup kompetitor — perlu strategi.`});
    else insights.push({type:'neutral',text:`Selisih rata-rata hanya ${Math.abs(deltaAvg)} poin — persaingan ketat.`});
  }
  const closeComp = others.filter((c,i)=>{const idx=cols.findIndex(x=>x.p.id===c.p.id); return distToAnchor[idx]<3;}).length;
  if(closeComp>=2) insights.push({type:'warn',text:`${closeComp} kompetitor dalam radius 3 km dari anchor — target market overlap tinggi.`});
  const matureComp = others.filter(c=>c.p.unit>0 && (c.p.realisasi/c.p.unit)>=0.8).length;
  if(matureComp>0) insights.push({type:'warn',text:`${matureComp} kompetitor realisasi ≥80% — pasar sekitar sudah terserap mayoritas.`});
  const youngComp = others.filter(c=>c.p.unit>0 && (c.p.realisasi/c.p.unit)<0.3).length;
  if(youngComp>0) insights.push({type:'good',text:`${youngComp} kompetitor realisasi <30% — ruang serap pasar masih tersedia.`});

  // [v17 C] Insight Tapera — bandingkan trend antar kolom
  if(anyTapera){
    const colsWithTapera = cols.filter(c=>c.p.tapera?.realisasiBulanan?.length>=4);
    if(colsWithTapera.length>=2){
      const trends = colsWithTapera.map(c=>({nama:c.p.nama, role:c.role, t:_calcTaperaTrend(c.p.tapera.realisasiBulanan)}));
      const anchorTrend = trends.find(x=>x.role==='anchor');
      const othersTrend = trends.filter(x=>x.role!=='anchor');
      const rising = othersTrend.filter(x=>x.t.dir==='up').length;
      const falling = othersTrend.filter(x=>x.t.dir==='down').length;
      if(anchorTrend && anchorTrend.t.dir==='up' && falling>=1){
        insights.push({type:'good',text:`Anchor trend naik (${anchorTrend.t.pctStr}) sementara ${falling} kompetitor turun — momentum menguntungkan.`});
      } else if(anchorTrend && anchorTrend.t.dir==='down' && rising>=1){
        insights.push({type:'warn',text:`Anchor trend turun (${anchorTrend.t.pctStr}) sementara ${rising} kompetitor naik — perlu audit strategi.`});
      } else if(rising>=2){
        insights.push({type:'warn',text:`${rising} kompetitor trend naik — tekanan persaingan meningkat.`});
      }
    }
    // Kompetitor tanpa data Tapera
    const missing = others.filter(c=>!(c.p.tapera?.realisasiBulanan?.length));
    if(missing.length && missing.length<=3){
      insights.push({type:'neutral',text:`${missing.length} kompetitor belum punya data Tapera — banding lebih lengkap butuh input manual.`});
    }
  }
  if(others.length===1 && others[0].role==='focus'){
    // Mode 1-vs-1 lama — insight detail tentang fokus
    const c = others[0];
    if(c.p.tipe===anchor.tipe) insights.push({type:'warn',text:'Tipe proyek sama — kompetitor langsung.'});
    else insights.push({type:'good',text:'Tipe proyek berbeda — segmen berbeda.'});
  }
  const insightsHtml = insights.length
    ? insights.map(i=>`<div style="font-size:11px;line-height:1.5;padding:4px 0;color:${i.type==='good'?'#15803D':(i.type==='warn'?'#B45309':'var(--muted)')};">${i.type==='good'?'✓':(i.type==='warn'?'⚠':'·')} ${i.text}</div>`).join('')
    : '<div style="font-size:11px;color:var(--muted);font-style:italic;">Tambah pembanding untuk melihat insight grup.</div>';

  // Badge jarak mode
  const nCmp = others.length;
  const headerCount = nCmp===0 ? 'Belum ada pembanding' : `${nCmp} pembanding${anyRoad?' · 🛣 via jalan':' · 📏 perkiraan'}`;

  // [v18 SECTIONS] Build sub-tab section bar
  // Pastikan vsaActiveSectionId masih valid (kalau user baru saja delete section aktif, fallback ke yang pertama)
  if(!VSA_SECTIONS.some(s=>s.id===vsaActiveSectionId)){
    vsaActiveSectionId = VSA_SECTIONS[0]?.id || 'ringkasan';
    _saveVsaActiveSection();
  }
  const sectionTabsHtml = VSA_SECTIONS.map(s=>{
    // Hitung berapa row di section ini yang ACTUALLY punya data (untuk badge count)
    const availableRows = s.rows.filter(k=>{
      const r = rowsByKey[k];
      if(!r) return false;
      if(k.startsWith('tpr_')) return anyTapera;
      return true;
    });
    const count = availableRows.filter(k => vsaRowVisibility[k] !== false).length;
    const isActive = s.id === vsaActiveSectionId;
    return `<button class="vsa-stab ${isActive?'active':''}" onclick="switchVsaSection('${s.id}')" title="${escapeHtml(s.name)}">${s.emoji} ${escapeHtml(s.name)} <span class="vsa-count">${count}</span></button>`;
  }).join('');

  // [v18 SECTIONS] Build quick toggle panel — scoped ke section aktif saja
  const activeSection = VSA_SECTIONS.find(s=>s.id===vsaActiveSectionId) || VSA_SECTIONS[0];
  const sectionRowKeysForPanel = (activeSection?.rows || []).filter(k=>{
    const r = rowsByKey[k];
    if(!r) return false;
    if(k.startsWith('tpr_')) return anyTapera;
    return true;
  });
  const quickTogglePanelHtml = (function(){
    if(!sectionRowKeysForPanel.length) return '';
    const activeCount = sectionRowKeysForPanel.filter(k=>vsaRowVisibility[k]!==false).length;
    const total = sectionRowKeysForPanel.length;
    const items = sectionRowKeysForPanel.map(k=>{
      const checked = vsaRowVisibility[k]!==false ? 'checked' : '';
      return `<label class="tpr-col-opt"><input type="checkbox" ${checked} onchange="toggleVsaRow('${k}', this.checked)"> <span>${VSA_ROW_LABEL[k]||k}</span></label>`;
    }).join('');
    return `
    <div class="vsa-row-wrap">
      <button class="vsa-row-toggle" onclick="toggleVsaRowPanel()" title="Atur baris di section ini">
        ⚙️ Baris <span class="vsa-row-count">${activeCount}/${total}</span>
      </button>
      <div class="vsa-row-panel" id="vsa-row-panel">
        <div class="tpr-col-head">
          <span>Baris di "${escapeHtml(activeSection.name)}"</span>
        </div>
        <div>${items}</div>
      </div>
    </div>`;
  })();

  // Empty state kalau section tidak punya row yang bisa ditampilkan
  const emptyStateHtml = visibleRows.length ? '' : `
    <div class="vsa-empty-section">
      <div style="font-size:18px;margin-bottom:4px;">${activeSection?.emoji||'📁'}</div>
      <b>Tidak ada baris di section "${escapeHtml(activeSection?.name||'?')}"</b><br>
      ${sectionRowKeysForPanel.length
        ? 'Semua baris di section ini di-hide. Klik <b>⚙️ Baris</b> untuk tampilkan lagi.'
        : 'Section ini kosong. Tambahkan baris lewat <b>⚙️ Hub Formula → Kategori Vs Anchor</b>.'}
    </div>`;

  // [TAHAP4A] Per-section verdicts — sinkron dengan Detail Lengkap
  const anchorIdx = cols.findIndex(c=>c.role==='anchor');
  const focusIdx = cols.findIndex(c=>c.role==='focus');
  const targetIdx = focusIdx>=0 ? focusIdx : anchorIdx;
  const target = targetIdx>=0 ? cols[targetIdx] : null;
  const verdictHtml = target ? buildVsaSectionVerdicts(target) : '';

  document.getElementById('tab-compare').innerHTML = `
    <div class="cmp-multi-controls">
      ${chipsHtml}
      ${addBtn}
    </div>
    <div class="vsa-sections">
      ${sectionTabsHtml}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
      <div style="font-size:10px;color:var(--faint);letter-spacing:0.3px;">${headerCount}</div>
      <div style="display:flex;gap:6px;align-items:center;">
        ${quickTogglePanelHtml}
        ${nCmp>0?'<button class="cmp-fit-btn" onclick="refitCompareOnMap()" title="Zoom peta besar ke semua pembanding">🎯 Fit peta</button>':''}
      </div>
    </div>
    ${visibleRows.length ? `
    <div class="cmp-multi-table-wrap">
      <table class="cmp-multi-table"><thead>${tableHead}</thead><tbody>${tableBody}</tbody></table>
    </div>` : emptyStateHtml}
    <div class="section-title">💡 Insight Strategis</div>
    <div style="background:var(--bg);border-radius:6px;padding:8px 12px;">${insightsHtml}</div>
    ${verdictHtml}
  `;

  // [v17 A1] Highlight di peta besar (bukan mini-map lagi) — simpan cols untuk refit manual.
  _lastCompareCols = cols;
  setTimeout(()=>highlightCompareOnMainMap(cols), 0);
}

// Tombol "Fit peta" di tab compare — pakai cols terakhir yang di-render
let _lastCompareCols = null;
function refitCompareOnMap(){
  if(!_lastCompareCols || !analisaMap) return;
  try{
    const bounds = L.latLngBounds(_lastCompareCols.map(c=>[c.p.lat,c.p.lng]));
    analisaMap.fitBounds(bounds, {padding:[50,50], maxZoom:14, animate:true});
  }catch(_){}
}

// [v17 A1] Highlight pembanding di peta besar (menggantikan mini-map lama).
// State: simpan polyline compare + id marker yang di-boost supaya bisa di-restore saat clear.
let cmpHighlightLines = [];
let cmpHighlightIds = []; // ids yang marker-nya di-boost (untuk restore icon/z-index)
let cmpHighlightOriginalIcons = {}; // id -> original L.divIcon (untuk restore)

function _makeCompareMarkerIcon(p, role, color){
  const isAnch = role==='anchor';
  const isFocus = role==='focus';
  const sz = isAnch ? 28 : (isFocus ? 24 : 22);
  const ring = isAnch ? '3px solid #D97706' : '3px solid '+color;
  const glow = isAnch ? '0 0 0 4px rgba(217,119,6,0.28)'
             : (isFocus ? '0 0 0 4px rgba(59,130,246,0.22)' : '0 0 0 3px '+color+'33');
  const badge = isAnch ? '⭐' : (isFocus ? '🎯' : '');
  const inner = `<div style="width:${sz}px;height:${sz}px;background:${color};border:${ring};border-radius:50%;box-shadow:${glow},0 2px 6px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;color:white;font-size:${isAnch?13:11}px;font-weight:700;">${badge}</div>`;
  return L.divIcon({html:inner, iconSize:[sz,sz], iconAnchor:[sz/2,sz/2], className:''});
}

// Highlight marker kompetitor yang masuk banding di peta besar.
// Dipanggil dari renderDetailCompare; clearCompareHighlight dipanggil saat reset/pindah tab.
function highlightCompareOnMainMap(cols){
  if(!analisaMapInit || !analisaMap) return;
  // Bersihkan state lama dulu (tanpa reset role-color-nya — kita rebuild sekarang)
  clearCompareHighlight();
  if(!cols || cols.length===0) return;
  const anchor = cols.find(c=>c.role==='anchor')?.p;
  if(!anchor) return;

  cols.forEach(c=>{
    const entry = markers[c.p.id];
    if(!entry || !entry.marker) return;
    // Simpan icon original supaya bisa di-restore (pakai opsi internal Leaflet)
    try{ cmpHighlightOriginalIcons[c.p.id] = entry.marker.options.icon; }catch(_){}
    const newIcon = _makeCompareMarkerIcon(c.p, c.role, c.color);
    entry.marker.setIcon(newIcon);
    entry.marker.setZIndexOffset(1000); // angkat ke atas
    // Update tooltip singkat biar lihat role
    try{
      const sd = c.p._scoreDetail || calcScoreFull(c.p);
      const prefix = c.role==='anchor' ? '⭐ Anchor · ' : (c.role==='focus' ? '🎯 Dipilih · ' : 'Pembanding · ');
      entry.marker.setTooltipContent(`<b>${prefix}${escapeHtml(c.p.nama)}</b><br>${escapeHtml(c.p.area||'')} · Skor: <b>${sd.overall}</b>`);
    }catch(_){}
    cmpHighlightIds.push(c.p.id);

    // Polyline dashed anchor → pembanding
    if(c.role!=='anchor'){
      const line = L.polyline([[anchor.lat,anchor.lng],[c.p.lat,c.p.lng]], {
        color: c.color, weight: 3, opacity: 0.65, dashArray: '8,6'
      }).addTo(analisaMap);
      // Tooltip jarak on-hover
      try{ line.bindTooltip(_distToAnchorStr(c.p, anchor), {sticky:true, direction:'top'}); }catch(_){}
      cmpHighlightLines.push(line);
    }
  });

  // Auto-fit bounds ke semua kolom (pilihan user: fit otomatis)
  if(cols.length >= 2){
    try{
      const bounds = L.latLngBounds(cols.map(c=>[c.p.lat,c.p.lng]));
      analisaMap.fitBounds(bounds, {padding:[50,50], maxZoom:14, animate:true});
    }catch(_){}
  }
}

function clearCompareHighlight(){
  // Hapus garis
  cmpHighlightLines.forEach(line=>{ try{ analisaMap && analisaMap.removeLayer(line); }catch(_){} });
  cmpHighlightLines = [];
  // Restore marker icon & tooltip + z-index
  cmpHighlightIds.forEach(id=>{
    const entry = markers[id];
    if(!entry || !entry.marker) return;
    const orig = cmpHighlightOriginalIcons[id];
    if(orig){ try{ entry.marker.setIcon(orig); }catch(_){} }
    try{ entry.marker.setZIndexOffset(0); }catch(_){}
    // Restore tooltip default
    try{
      const p = entry.data;
      entry.marker.setTooltipContent(`<b>${escapeHtml(p.nama)}</b><br>${escapeHtml(p.area||'')} · Skor: <b>${p.score}</b>`);
    }catch(_){}
  });
  cmpHighlightIds = [];
  cmpHighlightOriginalIcons = {};
}
function _distToAnchorStr(p, anchor){
  const rk = p._roadPerum && p._roadPerum[ANCHOR_ID];
  if(rk && rk.viaRoad) return `🛣 ${rk.km.toFixed(1)} km`;
  const d = haversine(p.lat,p.lng,anchor.lat,anchor.lng)*ROUTE_HAVERSINE_FACTOR;
  return `📏 ~${d.toFixed(1)} km`;
}

// [TAHAP 4] Picker overlay logic
function openCmpPicker(){
  if(compareExtraIds.length>=3){ showToast('Maksimal 3 pembanding tambahan'); return; }
  document.getElementById('cmp-picker-search').value='';
  renderCmpPickerList();
  document.getElementById('cmp-picker-overlay').classList.add('open');
}
function closeCmpPicker(){
  document.getElementById('cmp-picker-overlay').classList.remove('open');
}
function renderCmpPickerList(){
  const q = (document.getElementById('cmp-picker-search').value||'').toLowerCase().trim();
  const excludeIds = new Set([ANCHOR_ID, selectedId, ...compareExtraIds]);
  const list = perumahan
    .filter(p => !excludeIds.has(p.id))
    .filter(p => !q || p.nama.toLowerCase().includes(q) || (p.area||'').toLowerCase().includes(q));
  const el = document.getElementById('cmp-picker-list');
  if(list.length===0){ el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--faint);font-size:11px;">Tidak ada hasil.</div>'; return; }
  el.innerHTML = list.slice(0,50).map(p=>{
    const sd = p._scoreDetail || calcScoreFull(p);
    return `<div class="cmp-picker-item" onclick="addCmpExtra(${p.id})">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.nama)}</div>
        <div class="cmp-picker-item-sub">${escapeHtml(p.area||'-')} · ${p.tipe||''}</div>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--accent);font-family:'DM Mono',monospace;">${sd.overall}</div>
    </div>`;
  }).join('');
}
function addCmpExtra(id){
  if(compareExtraIds.includes(id)) return;
  if(compareExtraIds.length>=3){ showToast('Maksimal 3 pembanding'); return; }
  if(id===ANCHOR_ID || id===selectedId) return;
  compareExtraIds.push(id);
  closeCmpPicker();
  // Re-render tab
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}
function removeCmpExtra(id){
  compareExtraIds = compareExtraIds.filter(x=>x!==id);
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}
// Reset extras saat pindah perumahan — clear highlight di peta besar
function _resetCompareExtrasOnSelect(){
  compareExtraIds = [];
  _lastCompareCols = null;
  if(typeof clearCompareHighlight === 'function') clearCompareHighlight();
}

async function hitungJarakViaJalanCompare(pid){
  const p=perumahan.find(x=>x.id===pid);if(!p)return;
  const anchor=perumahan.find(x=>x.id===ANCHOR_ID);if(!anchor)return;
  const el=document.getElementById('cmp-jarak-road');
  if(el){el.textContent='menghitung...';el.style.cursor='default';}
  const r=await getRouteDistance(p.lat,p.lng,anchor.lat,anchor.lng);
  if(!el)return;
  if(r.viaRoad){
    el.innerHTML=`<b>${r.km.toFixed(1)} km via jalan · ${r.menit} mnt berkendara</b>`;
    el.style.textDecoration='none';el.style.cursor='default';
  } else {
    el.innerHTML=`⚠ Server rute tidak tersedia · ${r.km.toFixed(1)} km (estimasi)`;el.style.textDecoration='none';
  }
}
function renderDetailRadar(p){
  const isAnch=p.id===ANCHOR_ID;
  const anchor=perumahan.find(x=>x.id===ANCHOR_ID);
  // [TAHAP 2] Pakai _roadNearest kalau ada, fallback ke haversine
  const _nb = (x) => {
    const hav = nearestByKat(x), road = x._roadNearest || {};
    const out = {};
    Object.keys(KAT_LABEL).forEach(k => { out[k] = road[k] || hav[k]; });
    return out;
  };
  const nb_a = isAnch ? null : _nb(anchor);
  document.getElementById('tab-radar').innerHTML=`
    <div style="font-size:11px;color:var(--muted);text-align:center;margin-bottom:10px;">Profil kekuatan lokasi per kategori fasilitas</div>
    <canvas id="radar-canvas" width="260" height="245" style="width:100%;max-width:260px;display:block;margin:0 auto 8px;"></canvas>
    ${!isAnch?`<div style="display:flex;gap:14px;justify-content:center;font-size:10px;color:var(--muted)">
      <span style="display:flex;align-items:center;gap:3px;"><span style="width:10px;height:3px;background:#2563EB;display:inline-block;border-radius:2px;"></span>Dipilih</span>
      <span style="display:flex;align-items:center;gap:3px;"><span style="width:10px;height:3px;background:#D97706;display:inline-block;border-radius:2px;"></span>Anchor</span>
    </div>`:''}`;
  setTimeout(()=>drawRadar(_nb(p),nb_a),50);
}
function renderDetailNearby(p){
  // [TAHAP 2] Pakai _roadPerum (jarak antar perumahan via jalan) jika tersedia
  const roadPerum = p._roadPerum || {};
  const near=[...perumahan].filter(x=>x.id!==p.id).map(x=>{
    if(roadPerum[x.id]){
      return {...x, dist: roadPerum[x.id].km, menit: roadPerum[x.id].menit, viaRoad: roadPerum[x.id].viaRoad};
    }
    return {...x, dist: haversine(p.lat,p.lng,x.lat,x.lng) * ROUTE_HAVERSINE_FACTOR, menit: null, viaRoad: false};
  }).sort((a,b)=>a.dist-b.dist).slice(0,6);
  const anyRoad = near.some(x => x.viaRoad);
  document.getElementById('tab-nearby').innerHTML=`
    <div class="section-title">6 Perumahan Terdekat ${anyRoad ? '<span style="font-size:9px;color:#15803D;font-weight:600;">🛣 via jalan</span>' : ''}</div>
    ${near.map(x=>`<div class="nearby-row">
      <div style="display:flex;align-items:center;gap:7px;flex:1;min-width:0">
        <span class="nearby-dot" style="background:${TIPE_COLOR[x.tipe]||'#65A30D'}"></span>
        <div><div class="nearby-name">${x.id===ANCHOR_ID?'⭐ ':''}${escapeHtml(x.nama)}</div>
        <div class="nearby-sub">${escapeHtml(x.area)} · ${TIPE_LABEL[x.tipe]||escapeHtml(x.tipe)} · Skor: ${x.score}</div></div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="nearby-dist">${x.dist.toFixed(1)} km${x.viaRoad?'':' <span style="font-size:8px;color:#94a3b8">~</span>'}</div>
        <div class="nearby-min">~${x.menit || travelMin(x.dist)} mnt</div>
      </div>
    </div>`).join('')}`;
}
function drawRadar(nb,nb_a){
  const canvas=document.getElementById('radar-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const cats=Object.keys(KAT_LABEL);
  const W=260,H=245,cx=130,cy=128,R=85,n=cats.length;
  ctx.clearRect(0,0,W,H);
  const angles=cats.map((_,i)=>(-Math.PI/2)+(2*Math.PI*i/n));
  for(let rv=0.25;rv<=1;rv+=0.25){ctx.beginPath();angles.forEach((a,i)=>{const x=cx+R*rv*Math.cos(a),y=cy+R*rv*Math.sin(a);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.closePath();ctx.strokeStyle=`rgba(0,0,0,${rv===1?0.12:0.05})`;ctx.lineWidth=rv===1?1.5:1;ctx.stroke();}
  angles.forEach(a=>{ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+R*Math.cos(a),cy+R*Math.sin(a));ctx.strokeStyle='rgba(0,0,0,0.06)';ctx.lineWidth=1;ctx.stroke();});
  ctx.font='bold 8px DM Sans,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#5F5E5A';
  angles.forEach((a,i)=>{const lx=cx+(R+14)*Math.cos(a),ly=cy+(R+14)*Math.sin(a);ctx.fillText(cats[i].toUpperCase().slice(0,4),lx,ly);});
  function sc(nbD,k){if(!nbD||!nbD[k])return 0;return Math.max(0,Math.min(1,(100-(nbD[k].dist*FORMULA.decayFas))/100));}
  function shape(nbD,color,alpha){ctx.beginPath();angles.forEach((a,i)=>{const s=sc(nbD,cats[i]),x=cx+R*s*Math.cos(a),y=cy+R*s*Math.sin(a);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.closePath();ctx.fillStyle=color.replace('rgb','rgba').replace(')',`,${alpha})`);ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();angles.forEach((a,i)=>{const s=sc(nbD,cats[i]),x=cx+R*s*Math.cos(a),y=cy+R*s*Math.sin(a);ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=1.5;ctx.stroke();});}
  if(nb_a)shape(nb_a,'rgb(217,119,6)',0.12);
  shape(nb,'rgb(37,99,235)',0.18);
}
function switchTab(t,el){
  document.querySelectorAll('.tab-bar .tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(x=>x.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-'+t).classList.add('active');
  // [v12.4 STATE PERSISTENCE]
  if(typeof triggerSaveAppState === 'function') triggerSaveAppState();
  if(t==='radar'&&selectedId){
    const p=perumahan.find(x=>x.id===selectedId);
    const anchor=perumahan.find(x=>x.id===ANCHOR_ID);
    setTimeout(()=>drawRadar(nearestByKat(p),p.id===ANCHOR_ID?null:nearestByKat(anchor)),50);
  }
  // [v17 A1] Highlight di peta besar hanya saat tab compare aktif
  if(t==='compare'){
    if(_lastCompareCols) setTimeout(()=>highlightCompareOnMainMap(_lastCompareCols), 30);
  } else {
    if(typeof clearCompareHighlight === 'function') clearCompareHighlight();
  }
}
