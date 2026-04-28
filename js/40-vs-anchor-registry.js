// Vs Anchor registry and compare row setup
// ═══════════════════════════════════════════════════════════════════════════════
// [v18 SECTIONS] Master Row Registry + Sections untuk Tabel Vs Anchor
// ───────────────────────────────────────────────────────────────────────────────
// Setiap row di tabel Vs Anchor didefinisikan sekali di sini (key + label).
// Section di-map ke list row-key, bisa di-edit user lewat Hub Formula → Kategori.
// ═══════════════════════════════════════════════════════════════════════════════

// Master daftar semua row yang TERSEDIA di tabel. Key-nya dipakai sebagai ID.
// label = apa yang tampil di kolom "Faktor".
const VSA_ROW_DEFS = [
  // Skor
  {key:'skor_overall',  label:'🏆 Skor'},
  {key:'skor_aks',      label:'🚗 Aksesibilitas'},
  {key:'skor_fas',      label:'🏥 Fasilitas'},
  {key:'skor_fisik',    label:'🏗️ Fisik'},
  // Jarak POI (7 kategori)
  {key:'poi_rs',        label:'🏥 RS/Klinik'},
  {key:'poi_kampus',    label:'🎓 Kampus'},
  {key:'poi_mall',      label:'🏬 Mall/Belanja'},
  {key:'poi_tol',       label:'🛣️ Transportasi'},
  {key:'poi_pemda',     label:'🏛️ Pemerintah'},
  {key:'poi_industri',  label:'💼 Industri'},
  {key:'poi_publik',    label:'🌳 Ruang Publik'},
  // Data proyek
  {key:'proj_unit',     label:'Total Unit'},
  {key:'proj_realisasi',label:'Realisasi'},
  {key:'proj_progress', label:'Progress %'},
  // Jarak ke anchor
  {key:'dist_anchor',   label:'Jarak ke ⭐'},
  // Tapera - realisasi
  {key:'tpr_avg',       label:'📊 Tapera: rata²/bln'},
  {key:'tpr_trend',     label:'📈 Trend 3-bln'},
  {key:'tpr_total',     label:'🏆 Total Realisasi'},
  {key:'tpr_flpp',      label:'💵 Nominal FLPP'},
  // Tapera - spesifikasi
  {key:'tpr_harga',     label:'💰 Harga range'},
  {key:'tpr_lt',        label:'📐 Luas Tanah'},
  {key:'tpr_lb',        label:'🏠 Luas Bangunan'},
  {key:'tpr_tenor',     label:'📅 Tenor Dominan'},
  {key:'tpr_um',        label:'💳 Uang Muka'},
  {key:'tpr_bank',      label:'🏦 Bank Dominan'},
  // Tapera - profil pembeli
  {key:'tpr_pek',       label:'💼 Pekerjaan dominan'},
  {key:'tpr_usia',      label:'🎂 Usia dominan'},
  {key:'tpr_peng',      label:'💴 Penghasilan dominan'},
  {key:'tpr_gender',    label:'👥 Gender dominan'},
  // [TAHAP1] Promotion — gimmick jualan
  {key:'tpr_promo_aktif', label:'🎁 Promo Aktif'},
  {key:'tpr_promo_periode',label:'📅 Periode Promo'},
  {key:'tpr_promo_bonus', label:'🎉 Bonus Pembelian'},
  {key:'tpr_promo_iklan', label:'📱 Iklan di'},
  {key:'tpr_promo_bb',    label:'📢 Billboard/Spanduk'},
  // [TAHAP1] Go-to-Market — cara mereka jualan
  {key:'tpr_gtm_mkt',     label:'👥 Marketing In-house'},
  {key:'tpr_gtm_kanal',   label:'🏢 Struktur Kanal'},
  {key:'tpr_gtm_agent',   label:'🤝 Jumlah Agent'},
  {key:'tpr_gtm_fee_mkt', label:'💵 Fee Marketing'},
  {key:'tpr_gtm_fee_agt', label:'💵 Fee Agent'},
  {key:'tpr_gtm_dev',     label:'🏪 Brand Developer'}
];
const VSA_ROW_KEYS = VSA_ROW_DEFS.map(d=>d.key);
const VSA_ROW_LABEL = Object.fromEntries(VSA_ROW_DEFS.map(d=>[d.key, d.label]));

// [TAHAP2] Row keys yang punya data kompleks (list/multi-item) — tampil ringkas di tabel, detail di modal
const VSA_COMPLEX_ROWS = new Set([
  'tpr_promo_aktif',   // Multi promo: Free AJB, DP 1%, Cashback...
  'tpr_promo_bonus',   // Multi bonus: Kanopi, AC, Kitchen set...
  'tpr_promo_iklan'    // Platform list: R123, OLX, FB Ads...
]);
// Helper: parse comma/koma-separated string jadi array of items
function _parseComplexItems(str){
  if(!str || typeof str!=='string') return [];
  return str.split(/[,;]/).map(s=>s.trim()).filter(Boolean);
}

// Default sections (4P + Performance + Market Insight + Promotion + Go-to-Market)
const VSA_SECTIONS_DEFAULT = [
  {id:'ringkasan',  emoji:'📊', name:'Ringkasan',
    rows:['skor_overall','skor_aks','skor_fas','skor_fisik']},
  {id:'place',      emoji:'📍', name:'Place',
    rows:['poi_rs','poi_kampus','poi_mall','poi_tol','poi_pemda','poi_industri','poi_publik','dist_anchor']},
  {id:'product',    emoji:'🏠', name:'Product',
    rows:['tpr_lt','tpr_lb']},
  {id:'price',      emoji:'💰', name:'Price',
    rows:['tpr_harga','tpr_tenor','tpr_um','tpr_bank']},
  {id:'promotion',  emoji:'📢', name:'Promotion',
    rows:['tpr_promo_aktif','tpr_promo_periode','tpr_promo_bonus','tpr_promo_iklan','tpr_promo_bb']},
  {id:'performance',emoji:'📈', name:'Performance',
    rows:['proj_unit','proj_realisasi','proj_progress','tpr_avg','tpr_trend','tpr_total','tpr_flpp']},
  {id:'gtm',        emoji:'👔', name:'Go-to-Market',
    rows:['tpr_gtm_mkt','tpr_gtm_kanal','tpr_gtm_agent','tpr_gtm_fee_mkt','tpr_gtm_fee_agt','tpr_gtm_dev']},
  {id:'market',     emoji:'👥', name:'Market Insight',
    rows:['tpr_pek','tpr_usia','tpr_peng','tpr_gender']}
];

// State: section list (diedit user) + section yang aktif + visibility per row
let VSA_SECTIONS = [];
let vsaActiveSectionId = 'ringkasan';
let vsaRowVisibility = {}; // {row_key: true/false} — untuk toggle quick hide per section

// Load from localStorage
(function _loadVsaSections(){
  try{
    const raw = localStorage.getItem('bm4_vsa_sections');
    const saved = raw ? JSON.parse(raw) : null;
    if(Array.isArray(saved) && saved.length){
      // Validasi: pastikan setiap section punya id, name, emoji, rows[]
      VSA_SECTIONS = saved.filter(s => s && s.id && s.name && Array.isArray(s.rows))
                          .map(s => ({
                            id:String(s.id), emoji:String(s.emoji||'📁'),
                            name:String(s.name),
                            rows:s.rows.filter(k => VSA_ROW_KEYS.includes(k))
                          }));
      if(!VSA_SECTIONS.length) VSA_SECTIONS = JSON.parse(JSON.stringify(VSA_SECTIONS_DEFAULT));
      // [TAHAP1 MIGRATION] Auto-tambah section baru kalau user punya config lama
      const existingIds = VSA_SECTIONS.map(s=>s.id);
      VSA_SECTIONS_DEFAULT.forEach(defSec => {
        if(!existingIds.includes(defSec.id)){
          // Insert promotion setelah price, gtm setelah performance — kalau anchor ada
          if(defSec.id==='promotion'){
            const priceIdx = VSA_SECTIONS.findIndex(s=>s.id==='price');
            if(priceIdx>=0) VSA_SECTIONS.splice(priceIdx+1, 0, JSON.parse(JSON.stringify(defSec)));
            else VSA_SECTIONS.push(JSON.parse(JSON.stringify(defSec)));
          } else if(defSec.id==='gtm'){
            const perfIdx = VSA_SECTIONS.findIndex(s=>s.id==='performance');
            if(perfIdx>=0) VSA_SECTIONS.splice(perfIdx+1, 0, JSON.parse(JSON.stringify(defSec)));
            else VSA_SECTIONS.push(JSON.parse(JSON.stringify(defSec)));
          } else {
            VSA_SECTIONS.push(JSON.parse(JSON.stringify(defSec)));
          }
        }
      });
    } else {
      VSA_SECTIONS = JSON.parse(JSON.stringify(VSA_SECTIONS_DEFAULT));
    }
  }catch(_){
    VSA_SECTIONS = JSON.parse(JSON.stringify(VSA_SECTIONS_DEFAULT));
  }
  // Load row visibility
  try{
    const raw = localStorage.getItem('bm4_vsa_row_vis');
    const saved = raw ? JSON.parse(raw) : {};
    VSA_ROW_KEYS.forEach(k => { vsaRowVisibility[k] = saved[k] !== false; });
  }catch(_){
    VSA_ROW_KEYS.forEach(k => { vsaRowVisibility[k] = true; });
  }
  // Load active section
  try{
    const s = localStorage.getItem('bm4_vsa_active_section');
    if(s && VSA_SECTIONS.some(x=>x.id===s)) vsaActiveSectionId = s;
    else vsaActiveSectionId = VSA_SECTIONS[0]?.id || 'ringkasan';
  }catch(_){ vsaActiveSectionId = VSA_SECTIONS[0]?.id || 'ringkasan'; }
})();

function _saveVsaSections(){
  try{ localStorage.setItem('bm4_vsa_sections', JSON.stringify(VSA_SECTIONS)); }catch(_){}
}
function _saveVsaRowVis(){
  try{ localStorage.setItem('bm4_vsa_row_vis', JSON.stringify(vsaRowVisibility)); }catch(_){}
}
function _saveVsaActiveSection(){
  try{ localStorage.setItem('bm4_vsa_active_section', vsaActiveSectionId); }catch(_){}
}

// Helper: dapetin rows yang termasuk section aktif
function _getActiveSectionRows(){
  const sec = VSA_SECTIONS.find(s=>s.id===vsaActiveSectionId) || VSA_SECTIONS[0];
  return sec ? sec.rows : [];
}

// Event: user klik sub-tab section
function switchVsaSection(sectionId){
  vsaActiveSectionId = sectionId;
  _saveVsaActiveSection();
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}

// Event: toggle visibility 1 row di section aktif
function toggleVsaRow(rowKey, checked){
  vsaRowVisibility[rowKey] = !!checked;
  _saveVsaRowVis();
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}

function toggleVsaRowPanel(){
  const el = document.getElementById('vsa-row-panel');
  if(el) el.classList.toggle('open');
}

// [TAHAP2] Modal detail untuk row dengan data kompleks (list)
function openVsaDetail(rowKey){
  const cols = window._vsaDetailCols || [];
  if(!cols.length) return;
  // Mapping rowKey ke path di tapera object
  const DETAIL_MAP = {
    'tpr_promo_aktif':  {path:'promotion.promoAktif',   label:'🎁 Promo Aktif'},
    'tpr_promo_bonus':  {path:'promotion.bonus',        label:'🎉 Bonus Pembelian'},
    'tpr_promo_iklan':  {path:'promotion.iklanPlatform',label:'📱 Iklan di Platform'}
  };
  const meta = DETAIL_MAP[rowKey];
  if(!meta){ showToast('⚠ Row tidak punya detail view'); return; }
  // Set title
  document.getElementById('vsa-detail-title').textContent = meta.label;
  // Build body: 1 card per perumahan
  const body = document.getElementById('vsa-detail-body');
  const [p1,p2] = meta.path.split('.');
  const cardsHtml = cols.map(c=>{
    const perum = perumahan.find(x=>x.id===c.id);
    const raw = perum?.tapera?.[p1]?.[p2] || '';
    const items = _parseComplexItems(raw);
    const isAnchor = c.role==='anchor';
    const roleLbl = isAnchor ? '⭐ ANCHOR' : (c.role==='focus'?'🎯 FOKUS':'PEMBANDING');
    const itemsHtml = items.length
      ? `<ul class="vsa-detail-items">${items.map(it=>`<li><span>${escapeHtml(it)}</span></li>`).join('')}</ul>`
      : `<div class="vsa-detail-empty">Belum ada data</div>`;
    return `<div class="vsa-detail-card ${isAnchor?'anchor':''}">
      <div class="vsa-detail-card-head">${roleLbl}</div>
      <div class="vsa-detail-card-name">${escapeHtml(c.nama)}</div>
      ${itemsHtml}
    </div>`;
  }).join('');
  body.innerHTML = cardsHtml;
  // Show
  document.getElementById('vsa-detail-overlay').classList.add('open');
}
function closeVsaDetail(){
  document.getElementById('vsa-detail-overlay').classList.remove('open');
}
// ESC close handler untuk detail modal
document.addEventListener('keydown', function(e){
  if(e.key==='Escape'){
    const ov = document.getElementById('vsa-detail-overlay');
    if(ov && ov.classList.contains('open')) closeVsaDetail();
  }
});
