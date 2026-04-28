// Latest Tapera v3, Sikumbang v2, siteplan gallery, performance dashboard
// ═══════════════════════════════════════════════════════════════════════════════
// BAGIAN B — APPEND ke akhir <script>
// Semua function di sini punya prefix tpr2* — tidak bertabrakan dengan yang lama.
// ═══════════════════════════════════════════════════════════════════════════════

// State internal untuk UI baru
const TPR2_STATE = {
  mode: 'card',       // 'card' | 'wizard'
  wizStep: 1,         // 1..6
  bulananMode: 'picker',  // 'picker' | 'raw'
  profilMode: 'visual',   // 'visual' | 'raw'
  bulanan: [],        // [{bulan:'YYYY-MM', unit:N}] — mirror dari textarea raw
  profil: {           // mirror dari input teks raw
    pekerjaan: {},
    usia: {},
    penghasilan: {},
    gender: {}
  },
  cardOpen: { identitas:true, place:false, product:true, price:true, promotion:false, performance:true, gtm:false }
};

// ─── MODE TOGGLE (Card vs Wizard) ────────────────────────────────────────────
function tpr2SwitchMode(mode){
  TPR2_STATE.mode = mode;
  document.getElementById('tpr2-mode-btn-card')?.classList.toggle('active', mode === 'card');
  document.getElementById('tpr2-mode-btn-wizard')?.classList.toggle('active', mode === 'wizard');
  document.getElementById('tpr2-mode-card')?.classList.toggle('active', mode === 'card');
  document.getElementById('tpr2-mode-wizard')?.classList.toggle('active', mode === 'wizard');
  try { localStorage.setItem('bm4_tpr2_mode', mode); } catch(_){}
  if(mode === 'wizard'){
    tpr2WizRenderStep(TPR2_STATE.wizStep);
  } else {
    tpr2RefreshCardSummaries();
  }
}

// ─── REFRESH ALL UI (dipanggil setelah loadTaperaForm) ───────────────────────
function tpr2RefreshAll(){
  // Sync state dari ID-lama (textarea bulanan & input profil teks)
  TPR2_STATE.bulanan = _parseBulanan(document.getElementById('tpr-bulanan')?.value || '');
  TPR2_STATE.profil.pekerjaan = _parseProfil(document.getElementById('tpr-pekerjaan')?.value || '') || {};
  TPR2_STATE.profil.usia = _parseProfil(document.getElementById('tpr-usia')?.value || '') || {};
  TPR2_STATE.profil.penghasilan = _parseProfil(document.getElementById('tpr-penghasilan')?.value || '') || {};
  TPR2_STATE.profil.gender = _parseProfil(document.getElementById('tpr-gender')?.value || '') || {};
  // Render
  tpr2RenderBulananPicker();
  tpr2RenderBulananChart();
  ['pekerjaan','usia','penghasilan','gender'].forEach(k => tpr2RenderProfilBars(k));
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
  if(TPR2_STATE.mode === 'wizard') tpr2WizRenderStep(TPR2_STATE.wizStep);
}

// ─── CARD COLLAPSIBLE (Mode 1) ───────────────────────────────────────────────
function tpr2ToggleCard(cardId){
  const card = document.querySelector(`.tpr2-card[data-tpr-card="${cardId}"]`);
  if(!card) return;
  card.classList.toggle('collapsed');
  TPR2_STATE.cardOpen[cardId] = !card.classList.contains('collapsed');
}

// Update teks summary di header card berdasarkan field yang sudah terisi
function tpr2RefreshCardSummaries(){
  // [v3] Summary per section FM (place/product/price/promotion/performance/gtm)
  const setSum = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
  const _v = (id) => (document.getElementById(id)?.value||'').trim();

  // Helper: hitung custom field terisi di section
  const countCustomFilled = (secId) => {
    const fields = (FM_STATE?.customFields?.[secId] || []).filter(f => !_isFieldHidden?.(f.id));
    return fields.filter(f => {
      const el = document.getElementById(`tpr-custom-${f.id}`);
      if(!el) return false;
      if(f.type === 'multi'){
        const checks = document.querySelectorAll(`input[data-cf-id="${f.id}"][data-cf-multi="1"]:checked`);
        return checks.length > 0;
      }
      if(f.type === 'yesno'){
        const checks = document.querySelectorAll(`input[data-cf-id="${f.id}"]:checked`);
        for(const c of checks) if(c.value) return true;
        return false;
      }
      return (el.value||'').trim().length > 0;
    }).length;
  };

  // 📍 Place
  const placeCustomCnt = countCustomFilled('place');
  setSum('tpr2-sum-place',
    placeCustomCnt > 0 ? `${placeCustomCnt} field terisi` : '— belum diisi');

  // 🆔 Identitas Tapera (nama auto-fill dari profil + tahun + kab/kota)
  const tahunR = _v('tpr-tahun-realisasi');
  const kabK = _v('tpr-kab-kota');
  const namaR = _v('tpr-nama-perumahan');
  const idParts = [];
  if(tahunR) idParts.push(`Tahun ${tahunR}`);
  if(kabK) idParts.push(kabK);
  setSum('tpr2-sum-identitas',
    idParts.length ? idParts.join(' · ') : (namaR ? `📌 ${namaR}` : '— belum diisi'));

  // 🏠 Product (LT, LB + custom)
  const productBawaan = ['tpr-lt','tpr-lb'].filter(id => _v(id)).length;
  const productCustomCnt = countCustomFilled('product');
  const productTotal = productBawaan + productCustomCnt;
  const lt = _v('tpr-lt'); const lb = _v('tpr-lb');
  setSum('tpr2-sum-product',
    productTotal > 0 ? `${productTotal} field${lt ? ' · LT ' + lt : ''}${lb ? ' · LB ' + lb : ''}` : '— belum diisi');

  // 💰 Price (harga, tenor, um, bank, FLPP + custom)
  const priceBawaan = ['tpr-harga','tpr-tenor','tpr-um','tpr-bank','tpr-nominal'].filter(id => _v(id)).length;
  const priceCustomCnt = countCustomFilled('price');
  const harga = _v('tpr-harga'); const bank = _v('tpr-bank');
  const priceTotal = priceBawaan + priceCustomCnt;
  setSum('tpr2-sum-price',
    priceTotal > 0 ? `${priceTotal} field${harga ? ' · ' + harga : ''}${bank ? ' · ' + bank : ''}` : '— belum diisi');

  // 📢 Promotion (5 bawaan + custom)
  const promoBawaan = ['tpr-promo-aktif','tpr-promo-periode','tpr-promo-bonus','tpr-promo-iklan','tpr-promo-bb'].filter(id => _v(id)).length;
  const promoCustomCnt = countCustomFilled('promotion');
  const promoAktif = _v('tpr-promo-aktif');
  const promoTotal = promoBawaan + promoCustomCnt;
  setSum('tpr2-sum-promotion',
    promoTotal > 0 ? `${promoTotal} field${promoAktif ? ' · "' + promoAktif + '" aktif' : ''}` : '— belum diisi');

  // 📈 Performance (total + bulanan + profil pembeli + custom)
  const total = _v('tpr-total');
  const bul = TPR2_STATE.bulanan;
  const pDims = ['pekerjaan','usia','penghasilan','gender'];
  const pFilled = pDims.filter(k => Object.keys(TPR2_STATE.profil[k] || {}).length > 0).length;
  const perfCustomCnt = countCustomFilled('performance');
  const parts = [];
  if(total) parts.push(`${fmt(parseInt(total))} unit`);
  if(bul.length){
    const peak = bul.reduce((a, b) => b.unit > a.unit ? b : a, bul[0]);
    parts.push(`${bul.length} bln · puncak ${peak.bulan}`);
  }
  if(pFilled) parts.push(`profil ${pFilled}/4 dimensi`);
  if(perfCustomCnt) parts.push(`+${perfCustomCnt} custom`);
  setSum('tpr2-sum-performance', parts.length ? parts.join(' · ') : '— belum diisi');

  // 👔 GTM
  const gtmBawaan = ['tpr-gtm-mkt','tpr-gtm-kanal','tpr-gtm-agent','tpr-gtm-fee-mkt','tpr-gtm-fee-agt','tpr-gtm-dev'].filter(id => _v(id)).length;
  const gtmCustomCnt = countCustomFilled('gtm');
  const gtmTotal = gtmBawaan + gtmCustomCnt;
  const mkt = _v('tpr-gtm-mkt'); const agent = _v('tpr-gtm-agent');
  let gtmExtra = '';
  if(mkt || agent) gtmExtra = ` · ${mkt || 0} in-house + ${agent || 0} agent`;
  setSum('tpr2-sum-gtm', gtmTotal > 0 ? `${gtmTotal} field${gtmExtra}` : '— belum diisi');
}

// Update progress bar (X dari 6 section terisi minimal 1 field)
function tpr2UpdateProgress(){
  const _v = (id) => (document.getElementById(id)?.value||'').trim();
  const hasCustom = (secId) => {
    const fields = (FM_STATE?.customFields?.[secId] || []).filter(f => !_isFieldHidden?.(f.id));
    return fields.some(f => {
      const el = document.getElementById(`tpr-custom-${f.id}`);
      if(!el) return false;
      if(f.type === 'multi'){
        return document.querySelectorAll(`input[data-cf-id="${f.id}"][data-cf-multi="1"]:checked`).length > 0;
      }
      if(f.type === 'yesno'){
        const checks = document.querySelectorAll(`input[data-cf-id="${f.id}"]:checked`);
        for(const c of checks) if(c.value) return true;
        return false;
      }
      return (el.value||'').trim().length > 0;
    });
  };

  let filled = 0;
  // Place: cuma custom (tidak ada bawaan input di tab Tapera)
  if(hasCustom('place')) filled++;
  // Product: LT/LB atau custom
  if(['tpr-lt','tpr-lb'].some(id => _v(id)) || hasCustom('product')) filled++;
  // Price: 5 bawaan atau custom
  if(['tpr-harga','tpr-tenor','tpr-um','tpr-bank','tpr-nominal'].some(id => _v(id)) || hasCustom('price')) filled++;
  // Promotion
  if(['tpr-promo-aktif','tpr-promo-periode','tpr-promo-bonus','tpr-promo-iklan','tpr-promo-bb'].some(id => _v(id)) || hasCustom('promotion')) filled++;
  // Performance: total/bulanan/profil/custom
  if(_v('tpr-total') || TPR2_STATE.bulanan.length > 0 ||
     ['pekerjaan','usia','penghasilan','gender'].some(k => Object.keys(TPR2_STATE.profil[k]||{}).length) ||
     hasCustom('performance')) filled++;
  // GTM
  if(['tpr-gtm-mkt','tpr-gtm-kanal','tpr-gtm-agent','tpr-gtm-fee-mkt','tpr-gtm-fee-agt','tpr-gtm-dev'].some(id => _v(id)) || hasCustom('gtm')) filled++;

  const total = 6;
  const pct = Math.round(filled / total * 100);
  const fillEl = document.getElementById('tpr2-progress-fill');
  const txtEl = document.getElementById('tpr2-progress-text');
  if(fillEl) fillEl.style.width = pct + '%';
  if(txtEl) txtEl.textContent = `${filled} dari ${total} section`;
}

// Handler global: setiap input berubah → re-render summary + progress
function tpr2OnFieldInput(){
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
  // Kalau wizard mode aktif, refresh preview-nya
  if(TPR2_STATE.mode === 'wizard') tpr2WizRenderPreview();
}

// ─── BULANAN: picker mode (chip + add row) vs raw textarea ───────────────────
function tpr2BulananSwitchMode(mode){
  TPR2_STATE.bulananMode = mode;
  document.getElementById('tpr2-bul-mode-picker')?.classList.toggle('active', mode === 'picker');
  document.getElementById('tpr2-bul-mode-raw')?.classList.toggle('active', mode === 'raw');
  document.getElementById('tpr2-bul-picker')?.classList.toggle('active', mode === 'picker');
  document.getElementById('tpr2-bul-raw')?.classList.toggle('active', mode === 'raw');
  if(mode === 'picker') tpr2RenderBulananPicker();
}

function tpr2BulananAdd(){
  const monthEl = document.getElementById('tpr2-bul-input-month');
  const unitEl = document.getElementById('tpr2-bul-input-unit');
  const month = monthEl?.value;
  const unit = parseInt(unitEl?.value);
  if(!month || !/^\d{4}-\d{2}$/.test(month)){ showToast('⚠ Pilih bulan dulu'); return; }
  if(isNaN(unit) || unit < 0){ showToast('⚠ Isi unit (angka >= 0)'); return; }
  const idx = TPR2_STATE.bulanan.findIndex(b => b.bulan === month);
  if(idx >= 0) TPR2_STATE.bulanan[idx].unit = unit;
  else TPR2_STATE.bulanan.push({ bulan: month, unit: unit });
  TPR2_STATE.bulanan.sort((a,b) => a.bulan.localeCompare(b.bulan));
  tpr2SyncBulananToTextarea();
  tpr2RenderBulananPicker();
  tpr2RenderBulananChart();
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
  if(monthEl) monthEl.value = '';
  if(unitEl) unitEl.value = '';
}

function tpr2BulananRemove(bulan){
  TPR2_STATE.bulanan = TPR2_STATE.bulanan.filter(b => b.bulan !== bulan);
  tpr2SyncBulananToTextarea();
  tpr2RenderBulananPicker();
  tpr2RenderBulananChart();
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
}

function tpr2BulananEditUnit(bulan, newVal){
  const v = parseInt(newVal);
  if(isNaN(v) || v < 0) return;
  const item = TPR2_STATE.bulanan.find(b => b.bulan === bulan);
  if(item){
    item.unit = v;
    tpr2SyncBulananToTextarea();
    tpr2RenderBulananChart();
    tpr2RefreshCardSummaries();
  }
}

function tpr2SyncBulananToTextarea(){
  const ta = document.getElementById('tpr-bulanan');
  if(ta) ta.value = TPR2_STATE.bulanan.map(b => `${b.bulan}:${b.unit}`).join(', ');
}

function tpr2OnRawBulananInput(){
  // User edit textarea raw langsung — sync ke state
  TPR2_STATE.bulanan = _parseBulanan(document.getElementById('tpr-bulanan')?.value || '');
  tpr2RenderBulananChart();
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
}

function tpr2RenderBulananPicker(){
  const host = document.getElementById('tpr2-bul-chips');
  if(!host) return;
  if(TPR2_STATE.bulanan.length === 0){
    host.innerHTML = '<div class="tpr2-bul-empty">Belum ada bulan. Tambahkan dengan picker di atas.</div>';
    return;
  }
  const peak = TPR2_STATE.bulanan.reduce((a, b) => b.unit > a.unit ? b : a, TPR2_STATE.bulanan[0]);
  // Tampilkan chronological terbaru duluan supaya lebih intuitif
  const sorted = [...TPR2_STATE.bulanan].sort((a,b) => b.bulan.localeCompare(a.bulan));
  host.innerHTML = sorted.map(b => {
    const isPeak = b.bulan === peak.bulan;
    return `<div class="tpr2-bul-chip${isPeak ? ' peak' : ''}">
      <span class="tpr2-bul-chip-label">${isPeak ? '★ ' : ''}${escapeHtml(b.bulan)}</span>
      <input type="number" value="${b.unit}" min="0" class="tpr2-bul-chip-input" oninput="tpr2BulananEditUnit('${b.bulan}', this.value)">
      <span class="tpr2-bul-chip-unit">unit</span>
      <button type="button" class="tpr2-bul-chip-remove" onclick="tpr2BulananRemove('${b.bulan}')" title="Hapus">✕</button>
    </div>`;
  }).join('');
}

// Render mini bar chart inline di card bulanan
function tpr2RenderBulananChart(){
  const wrap = document.getElementById('tpr2-bulanan-chart-wrap');
  const bars = document.getElementById('tpr2-bulanan-bars');
  const axis = document.getElementById('tpr2-bulanan-axis');
  if(!wrap || !bars) return;
  if(TPR2_STATE.bulanan.length === 0){
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  const sorted = [...TPR2_STATE.bulanan].sort((a,b) => a.bulan.localeCompare(b.bulan));
  const max = Math.max(1, ...sorted.map(b => b.unit));
  const peak = sorted.reduce((a,b) => b.unit > a.unit ? b : a, sorted[0]);
  bars.innerHTML = sorted.map(b => {
    const h = Math.max(2, Math.round((b.unit / max) * 100));
    const isPeak = b.bulan === peak.bulan;
    return `<div class="tpr2-chart-bar${isPeak ? ' peak' : ''}" style="height:${h}%;" title="${b.bulan}: ${b.unit} unit"></div>`;
  }).join('');
  if(axis){
    axis.innerHTML = `<span>${sorted[0].bulan}</span>` +
      `<span class="peak-label">▲ puncak ${peak.bulan} (${peak.unit})</span>` +
      `<span>${sorted[sorted.length-1].bulan}</span>`;
  }
}

// ─── PROFIL PEMBELI: visual bars vs raw text ─────────────────────────────────
function tpr2ProfilSwitchMode(mode){
  TPR2_STATE.profilMode = mode;
  document.getElementById('tpr2-prof-mode-visual')?.classList.toggle('active', mode === 'visual');
  document.getElementById('tpr2-prof-mode-raw')?.classList.toggle('active', mode === 'raw');
  document.getElementById('tpr2-prof-visual')?.classList.toggle('active', mode === 'visual');
  document.getElementById('tpr2-prof-raw')?.classList.toggle('active', mode === 'raw');
  if(mode === 'visual') ['pekerjaan','usia','penghasilan','gender'].forEach(k => tpr2RenderProfilBars(k));
}

// Render bar visual untuk satu kategori profil (pekerjaan/usia/penghasilan/gender)
function tpr2RenderProfilBars(kat){
  const host = document.getElementById(`tpr2-prof-bars-${kat}`);
  const totalEl = document.getElementById(`tpr2-prof-total-${kat}`);
  if(!host) return;
  const data = TPR2_STATE.profil[kat] || {};
  const entries = Object.entries(data);
  const total = entries.reduce((a, [k,v]) => a + v, 0);

  // Color palette per kategori (single ramp per block)
  const RAMP = {
    pekerjaan: ['#7F77DD','#AFA9EC','#CECBF6','#EEEDFE','#EEEDFE'],
    usia:      ['#1D9E75','#5DCAA5','#9FE1CB','#9FE1CB','#E1F5EE'],
    penghasilan:['#BA7517','#EF9F27','#FAC775','#FAEEDA','#FAEEDA'],
    gender:    ['#185FA5','#D4537E','#888780','#888780','#888780']
  }[kat] || ['#888780'];

  // Special render: gender pakai stacked bar horizontal
  if(kat === 'gender' && entries.length){
    let stackHtml = '<div class="tpr2-gender-stack">';
    entries.forEach(([k, v], i) => {
      const w = total > 0 ? (v / total) * 100 : 0;
      const c = RAMP[i % RAMP.length];
      stackHtml += `<div class="tpr2-gender-stack-seg" style="width:${w}%;background:${c};">${escapeHtml(k)} ${Math.round(v)}%</div>`;
    });
    stackHtml += '</div>';
    stackHtml += entries.map(([k, v], i) => {
      return `<div class="tpr2-prof-row">
        <span class="tpr2-prof-name">${escapeHtml(k)}</span>
        <input type="range" min="0" max="100" value="${v}" oninput="tpr2ProfilEdit('${kat}','${escapeHtml(k)}',this.value)">
        <input type="number" min="0" max="100" value="${v}" class="tpr2-prof-num" oninput="tpr2ProfilEdit('${kat}','${escapeHtml(k)}',this.value)">
        <button type="button" class="tpr2-prof-remove" onclick="tpr2ProfilRemove('${kat}','${escapeHtml(k)}')">✕</button>
      </div>`;
    }).join('');
    host.innerHTML = stackHtml;
  } else if(entries.length === 0){
    host.innerHTML = '<div class="tpr2-prof-empty">Belum ada data — isi kategori di bawah.</div>';
  } else {
    host.innerHTML = entries.map(([k, v], i) => {
      const pct = total > 0 ? (v / total) * 100 : 0;
      const c = RAMP[Math.min(i, RAMP.length-1)];
      return `<div class="tpr2-prof-row">
        <span class="tpr2-prof-name" title="${escapeHtml(k)}">${escapeHtml(k)}</span>
        <div class="tpr2-prof-track">
          <div class="tpr2-prof-fill" style="width:${pct}%;background:${c};"></div>
        </div>
        <input type="number" min="0" max="100" value="${v}" class="tpr2-prof-num" oninput="tpr2ProfilEdit('${kat}','${escapeHtml(k)}',this.value)">
        <button type="button" class="tpr2-prof-remove" onclick="tpr2ProfilRemove('${kat}','${escapeHtml(k)}')" title="Hapus">✕</button>
      </div>`;
    }).join('');
  }
  if(totalEl){
    const totalRound = Math.round(total);
    const ok = totalRound === 100;
    totalEl.textContent = `total ${totalRound}%`;
    totalEl.className = 'tpr2-prof-total ' + (ok ? 'ok' : (total > 0 ? 'warn' : ''));
  }
}

function tpr2ProfilAddCat(kat){
  const keyEl = document.getElementById(`tpr2-prof-newkey-${kat}`);
  const valEl = document.getElementById(`tpr2-prof-newval-${kat}`);
  const k = (keyEl?.value || '').trim();
  const v = parseFloat(valEl?.value);
  if(!k){ showToast('⚠ Isi label/kategori'); return; }
  if(isNaN(v) || v < 0 || v > 100){ showToast('⚠ Isi persen (0-100)'); return; }
  if(!TPR2_STATE.profil[kat]) TPR2_STATE.profil[kat] = {};
  TPR2_STATE.profil[kat][k] = v;
  tpr2SyncProfilToInput(kat);
  tpr2RenderProfilBars(kat);
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
  if(keyEl) keyEl.value = '';
  if(valEl) valEl.value = '';
}

function tpr2ProfilEdit(kat, key, newVal){
  const v = parseFloat(newVal);
  if(isNaN(v) || v < 0 || v > 100) return;
  if(!TPR2_STATE.profil[kat]) TPR2_STATE.profil[kat] = {};
  TPR2_STATE.profil[kat][key] = v;
  tpr2SyncProfilToInput(kat);
  tpr2RenderProfilBars(kat);
  tpr2RefreshCardSummaries();
}

function tpr2ProfilRemove(kat, key){
  if(TPR2_STATE.profil[kat]) delete TPR2_STATE.profil[kat][key];
  tpr2SyncProfilToInput(kat);
  tpr2RenderProfilBars(kat);
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
}

function tpr2SyncProfilToInput(kat){
  const inp = document.getElementById(`tpr-${kat}`);
  if(inp) inp.value = _profilToStr(TPR2_STATE.profil[kat] || {});
}

function tpr2OnRawProfilInput(kat, val){
  // User edit input teks raw langsung — sync ke state
  TPR2_STATE.profil[kat] = _parseProfil(val) || {};
  tpr2RenderProfilBars(kat);
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
}

// Sebelum save: pastikan field hidden ID-lama ter-update dari mode visual
function tpr2FlushVisualToRaw(){
  // Bulanan
  tpr2SyncBulananToTextarea();
  // Profil
  ['pekerjaan','usia','penghasilan','gender'].forEach(k => tpr2SyncProfilToInput(k));
}


// ═══════════════════════════════════════════════════════════════════════════════
// WIZARD MODE
// Setiap step = render input pane (kiri) + preview pane (kanan).
// Input field di wizard SHARE dengan input di mode card lewat ID lama.
// ═══════════════════════════════════════════════════════════════════════════════

const TPR2_WIZ_STEPS = [
  { num:1, key:'place',       label:'Place',       icon:'📍', color:'#854F0B', bg:'#FAEEDA' },
  { num:2, key:'product',     label:'Product',     icon:'🏠', color:'#0F6E56', bg:'#E1F5EE' },
  { num:3, key:'price',       label:'Price',       icon:'💰', color:'#993556', bg:'#FBEAF0' },
  { num:4, key:'promotion',   label:'Promotion',   icon:'📢', color:'#993556', bg:'#FBEAF0' },
  { num:5, key:'performance', label:'Performance', icon:'📈', color:'#185FA5', bg:'#E6F1FB' },
  { num:6, key:'gtm',         label:'GTM',         icon:'👔', color:'#3C3489', bg:'#EEEDFE' }
];

function tpr2WizGoStep(n){
  if(n < 1 || n > TPR2_WIZ_STEPS.length) return;
  TPR2_STATE.wizStep = n;
  tpr2WizRenderStep(n);
}
function tpr2WizPrev(){ if(TPR2_STATE.wizStep > 1) tpr2WizGoStep(TPR2_STATE.wizStep - 1); }
function tpr2WizNext(){
  if(TPR2_STATE.wizStep < TPR2_WIZ_STEPS.length) tpr2WizGoStep(TPR2_STATE.wizStep + 1);
  else { saveTaperaForm(); }
}

function tpr2WizRenderStep(n){
  const step = TPR2_WIZ_STEPS[n - 1];
  if(!step) return;
  // Update stepper visual
  document.querySelectorAll('.tpr2-wiz-step').forEach(el => {
    const sn = parseInt(el.dataset.wizStep);
    el.classList.toggle('active', sn === n);
    el.classList.toggle('done', sn < n);
  });
  // Update progress
  const pct = Math.round(n / TPR2_WIZ_STEPS.length * 100);
  const fill = document.getElementById('tpr2-wiz-progress-fill');
  if(fill) fill.style.width = pct + '%';
  document.getElementById('tpr2-wiz-progress-pct').textContent = pct + '%';
  document.getElementById('tpr2-wiz-stepinfo').innerHTML = `Step <strong>${n} dari ${TPR2_WIZ_STEPS.length}</strong> · ${step.label}`;
  // Update next btn label
  const nextBtn = document.getElementById('tpr2-wiz-next');
  if(nextBtn) nextBtn.innerHTML = (n === TPR2_WIZ_STEPS.length) ? '💾 Simpan & Selesai' : `Berikutnya: ${TPR2_WIZ_STEPS[n]?.label || ''} →`;
  // Render input + preview
  tpr2WizRenderInputPane(step);
  tpr2WizRenderPreview();
}

// Render input pane untuk step tertentu
// Field input di sini di-bind ke ID lama lewat oninput handler yang panggil
// document.getElementById(idLama).value = this.value, supaya save tetap konsisten.
function tpr2WizRenderInputPane(step){
  const host = document.getElementById('tpr2-wiz-input');
  if(!host) return;
  const head = `<div class="tpr2-wiz-input-head">
    <div class="tpr2-card-icon" style="background:${step.bg};color:${step.color};">${step.icon}</div>
    <h4>${step.label}</h4>
  </div>`;
  let body = '';
  switch(step.key){
    case 'place':
      body = `<p class="tpr2-wiz-hint">Field lokasi & lingkungan dari Field Manager → Place. Kalau belum ada custom field di FM, tambah di Hub Formula.</p>
        <div class="tpr2-wiz-fmnote">📍 Field Place dari Field Manager akan muncul di sini setelah ditambahkan.</div>`;
      break;
    case 'product':
      body = `<p class="tpr2-wiz-hint">Spesifikasi unit dominan di perumahan ini.</p>
        <div class="tpr2-grid-2">
          <div class="ef"><label>📐 Luas Tanah</label><input type="text" value="${_v('tpr-lt')}" placeholder="60-90 m²" oninput="_wizSync('tpr-lt',this.value)"></div>
          <div class="ef"><label>📐 Luas Bangunan</label><input type="text" value="${_v('tpr-lb')}" placeholder="26-31 m²" oninput="_wizSync('tpr-lb',this.value)"></div>
        </div>
        <p class="tpr2-wiz-hint" style="margin-top:8px;">💡 Field lain (custom Product) muncul di <strong>Mode Card</strong>.</p>`;
      break;
    case 'price':
      body = `<p class="tpr2-wiz-hint">Harga, KPR, bank dominan, nominal FLPP.</p>
        <div class="tpr2-grid-2">
          <div class="ef"><label>💰 Harga Range</label><input type="text" value="${_v('tpr-harga')}" placeholder="150-175 Jt" oninput="_wizSync('tpr-harga',this.value)"></div>
          <div class="ef"><label>🏦 Bank Dominan</label><input type="text" value="${_v('tpr-bank')}" placeholder="BTN" oninput="_wizSync('tpr-bank',this.value)"></div>
          <div class="ef"><label>📅 Tenor Dominan</label><input type="text" value="${_v('tpr-tenor')}" placeholder="15-20 Tahun" oninput="_wizSync('tpr-tenor',this.value)"></div>
          <div class="ef"><label>💳 Uang Muka Range</label><input type="text" value="${_v('tpr-um')}" placeholder="2-3%" oninput="_wizSync('tpr-um',this.value)"></div>
          <div class="ef" style="grid-column:span 2;"><label>💵 Nominal FLPP (Miliar Rp)</label><input type="number" value="${_v('tpr-nominal')}" step="0.1" min="0" oninput="_wizSync('tpr-nominal',this.value)"></div>
        </div>`;
      break;
    case 'promotion':
      body = `<p class="tpr2-wiz-hint">Aktivitas promo & marketing yang sedang berjalan. Kosongkan kalau tidak tahu.</p>
        <div class="tpr2-grid-2">
          <div class="ef"><label>🎁 Promo Aktif</label><input type="text" value="${_v('tpr-promo-aktif')}" oninput="_wizSync('tpr-promo-aktif',this.value)"></div>
          <div class="ef"><label>📅 Periode Promo</label><input type="text" value="${_v('tpr-promo-periode')}" oninput="_wizSync('tpr-promo-periode',this.value)"></div>
          <div class="ef"><label>🎉 Bonus Pembelian</label><input type="text" value="${_v('tpr-promo-bonus')}" oninput="_wizSync('tpr-promo-bonus',this.value)"></div>
          <div class="ef"><label>📱 Iklan di Platform</label><input type="text" value="${_v('tpr-promo-iklan')}" oninput="_wizSync('tpr-promo-iklan',this.value)"></div>
          <div class="ef" style="grid-column:span 2;"><label>📢 Billboard/Spanduk</label><input type="text" value="${_v('tpr-promo-bb')}" oninput="_wizSync('tpr-promo-bb',this.value)"></div>
        </div>`;
      break;
    case 'performance':
      body = `<p class="tpr2-wiz-hint">Total realisasi, bulanan, dan profil pembeli. Editor visual lengkap di <strong>Mode Card</strong>.</p>
        <div class="ef"><label>Total Realisasi (unit)</label>
          <input type="number" value="${_v('tpr-total')}" min="0" oninput="_wizSync('tpr-total',this.value)"></div>
        <div style="margin-top:10px;">
          <label style="font-size:11px;color:var(--muted);">Realisasi bulanan</label>
          <div class="tpr2-bul-add-row" style="margin-top:4px;">
            <input type="month" id="tpr2-wiz-bul-month">
            <input type="number" id="tpr2-wiz-bul-unit" placeholder="unit" min="0">
            <button type="button" class="btn-sm-primary" onclick="tpr2WizBulAdd()">+ Tambah</button>
          </div>
          <div class="tpr2-bul-chips" id="tpr2-wiz-bul-chips"></div>
          <details class="tpr2-wiz-rawtoggle"><summary>📋 Atau paste raw text</summary>
            <textarea rows="2" class="tpr2-bul-raw-textarea" placeholder="2024-01:7, 2024-02:8" oninput="_wizSync('tpr-bulanan',this.value);tpr2OnRawBulananInput()">${_v('tpr-bulanan')}</textarea>
          </details>
        </div>
        <div class="tpr2-grid-2" style="margin-top:10px;">
          <div class="ef"><label>💼 Pekerjaan</label><input type="text" value="${_v('tpr-pekerjaan')}" placeholder="swasta:89, wira:8" oninput="_wizSync('tpr-pekerjaan',this.value);tpr2OnRawProfilInput('pekerjaan',this.value)"></div>
          <div class="ef"><label>🎂 Usia</label><input type="text" value="${_v('tpr-usia')}" placeholder="19-25:42, 26-30:28" oninput="_wizSync('tpr-usia',this.value);tpr2OnRawProfilInput('usia',this.value)"></div>
          <div class="ef"><label>💴 Penghasilan</label><input type="text" value="${_v('tpr-penghasilan')}" placeholder="3-4Jt:30, 4-5Jt:40" oninput="_wizSync('tpr-penghasilan',this.value);tpr2OnRawProfilInput('penghasilan',this.value)"></div>
          <div class="ef"><label>🚻 Gender</label><input type="text" value="${_v('tpr-gender')}" placeholder="L:58, P:42" oninput="_wizSync('tpr-gender',this.value);tpr2OnRawProfilInput('gender',this.value)"></div>
        </div>`;
      break;
    case 'gtm':
      body = `<p class="tpr2-wiz-hint">Struktur tim jualan & cara mereka go-to-market.</p>
        <div class="tpr2-grid-2">
          <div class="ef"><label>👥 Marketing In-house</label><input type="number" value="${_v('tpr-gtm-mkt')}" min="0" oninput="_wizSync('tpr-gtm-mkt',this.value)"></div>
          <div class="ef"><label>🏢 Struktur Kanal</label><input type="text" value="${_v('tpr-gtm-kanal')}" oninput="_wizSync('tpr-gtm-kanal',this.value)"></div>
          <div class="ef"><label>🤝 Jumlah Agent</label><input type="number" value="${_v('tpr-gtm-agent')}" min="0" oninput="_wizSync('tpr-gtm-agent',this.value)"></div>
          <div class="ef"><label>🏪 Brand Developer</label><input type="text" value="${_v('tpr-gtm-dev')}" oninput="_wizSync('tpr-gtm-dev',this.value)"></div>
          <div class="ef"><label>💵 Fee Marketing</label><input type="text" value="${_v('tpr-gtm-fee-mkt')}" oninput="_wizSync('tpr-gtm-fee-mkt',this.value)"></div>
          <div class="ef"><label>💵 Fee Agent</label><input type="text" value="${_v('tpr-gtm-fee-agt')}" oninput="_wizSync('tpr-gtm-fee-agt',this.value)"></div>
        </div>`;
      break;
  }
  host.innerHTML = head + body;
  // Special init: bulanan picker chips
  // Special init: performance step punya picker bulanan chips
  if(step.key === 'performance') tpr2WizRenderBulChips();
}

// Helper: ambil value dari ID lama (kosong-safe + escape)
function _v(id){
  const el = document.getElementById(id);
  const v = el ? (el.value || '') : '';
  return String(v).replace(/"/g, '&quot;');
}

// Helper: sync wizard input → ID lama + trigger refresh
function _wizSync(id, val){
  const el = document.getElementById(id);
  if(el){ el.value = val; }
  tpr2OnFieldInput();
}

// Wizard bulanan add/render — pakai TPR2_STATE.bulanan langsung
function tpr2WizBulAdd(){
  const monthEl = document.getElementById('tpr2-wiz-bul-month');
  const unitEl = document.getElementById('tpr2-wiz-bul-unit');
  const month = monthEl?.value;
  const unit = parseInt(unitEl?.value);
  if(!month || !/^\d{4}-\d{2}$/.test(month)){ showToast('⚠ Pilih bulan dulu'); return; }
  if(isNaN(unit) || unit < 0){ showToast('⚠ Isi unit'); return; }
  const idx = TPR2_STATE.bulanan.findIndex(b => b.bulan === month);
  if(idx >= 0) TPR2_STATE.bulanan[idx].unit = unit;
  else TPR2_STATE.bulanan.push({ bulan: month, unit: unit });
  TPR2_STATE.bulanan.sort((a,b) => a.bulan.localeCompare(b.bulan));
  tpr2SyncBulananToTextarea();
  tpr2WizRenderBulChips();
  tpr2RenderBulananPicker();   // sync ke mode card juga
  tpr2RenderBulananChart();
  tpr2RefreshCardSummaries();
  tpr2UpdateProgress();
  tpr2WizRenderPreview();
  if(monthEl) monthEl.value = '';
  if(unitEl) unitEl.value = '';
}

function tpr2WizRenderBulChips(){
  const host = document.getElementById('tpr2-wiz-bul-chips');
  if(!host) return;
  if(TPR2_STATE.bulanan.length === 0){
    host.innerHTML = '<div class="tpr2-bul-empty">Belum ada bulan.</div>';
    return;
  }
  const sorted = [...TPR2_STATE.bulanan].sort((a,b) => b.bulan.localeCompare(a.bulan));
  host.innerHTML = sorted.map(b => {
    return `<div class="tpr2-bul-chip">
      <span class="tpr2-bul-chip-label">${escapeHtml(b.bulan)}</span>
      <span class="tpr2-bul-chip-input" style="display:inline-flex;align-items:center;width:auto;padding:0 6px;font-weight:500;">${b.unit}</span>
      <span class="tpr2-bul-chip-unit">unit</span>
      <button type="button" class="tpr2-bul-chip-remove" onclick="tpr2BulananRemove('${b.bulan}');tpr2WizRenderBulChips();tpr2WizRenderPreview();">✕</button>
    </div>`;
  }).join('');
}

// Render preview pane berdasarkan step aktif
function tpr2WizRenderPreview(){
  const host = document.getElementById('tpr2-wiz-preview');
  if(!host) return;
  const n = TPR2_STATE.wizStep;
  const step = TPR2_WIZ_STEPS[n - 1];
  if(!step){ host.innerHTML = ''; return; }
  let html = `<div class="tpr2-wiz-preview-head"><span class="tpr2-wiz-preview-dot"></span>Live preview</div>`;
  switch(step.key){
    case 'place': {
      // Place: tampilkan info FM custom fields yg terisi (kalau ada)
      const customFields = (FM_STATE?.customFields?.place || []).filter(f => !_isFieldHidden?.(f.id));
      if(customFields.length === 0){
        html += `<div class="tpr2-wiz-empty">Belum ada custom field Place. Tambah lewat Hub Formula → Field Manager → Place.</div>`;
      } else {
        const filled = customFields.filter(f => {
          const el = document.getElementById(`tpr-custom-${f.id}`);
          return el && (el.value||'').trim();
        }).length;
        html += `<div class="tpr2-wiz-stat-grid">
          <div class="tpr2-wiz-stat"><div class="lbl">Custom field aktif</div><div class="val">${customFields.length}<small> field</small></div></div>
          <div class="tpr2-wiz-stat"><div class="lbl">Sudah terisi</div><div class="val">${filled}<small> dari ${customFields.length}</small></div></div>
        </div>`;
      }
      break;
    }
    case 'product': {
      const lt = document.getElementById('tpr-lt')?.value?.trim();
      const lb = document.getElementById('tpr-lb')?.value?.trim();
      html += `<div class="tpr2-wiz-spec-list">
        <div class="tpr2-wiz-spec-row${lt ? ' filled' : ''}"><span class="lbl">Luas Tanah</span><span class="val">${lt ? escapeHtml(lt) : '—'}</span></div>
        <div class="tpr2-wiz-spec-row${lb ? ' filled' : ''}"><span class="lbl">Luas Bangunan</span><span class="val">${lb ? escapeHtml(lb) : '—'}</span></div>
      </div>`;
      const customFields = (FM_STATE?.customFields?.product || []).filter(f => !_isFieldHidden?.(f.id));
      if(customFields.length){
        html += `<div class="tpr2-wiz-insight">+ ${customFields.length} custom field Product (lihat Mode Card untuk edit).</div>`;
      }
      break;
    }
    case 'price': {
      const fields = [
        ['Harga', 'tpr-harga'], ['Bank', 'tpr-bank'],
        ['Tenor', 'tpr-tenor'], ['UM', 'tpr-um'], ['Nominal FLPP', 'tpr-nominal']
      ];
      html += `<div class="tpr2-wiz-spec-list">` +
        fields.map(([lbl, id]) => {
          const v = document.getElementById(id)?.value?.trim() || '';
          return `<div class="tpr2-wiz-spec-row${v ? ' filled' : ''}"><span class="lbl">${lbl}</span><span class="val">${v ? escapeHtml(v) : '—'}</span></div>`;
        }).join('') + `</div>`;
      const filled = fields.filter(([_, id]) => (document.getElementById(id)?.value||'').trim()).length;
      if(filled === fields.length){
        html += `<div class="tpr2-wiz-insight">✓ Semua ${filled} field Price terisi.</div>`;
      } else {
        html += `<div class="tpr2-wiz-insight">${filled} dari ${fields.length} field terisi.</div>`;
      }
      break;
    }
    case 'promotion': {
      const promo = document.getElementById('tpr-promo-aktif')?.value?.trim();
      const periode = document.getElementById('tpr-promo-periode')?.value?.trim();
      const bonus = document.getElementById('tpr-promo-bonus')?.value?.trim();
      const iklan = document.getElementById('tpr-promo-iklan')?.value?.trim();
      const bb = document.getElementById('tpr-promo-bb')?.value?.trim();
      if(!promo && !periode && !bonus && !iklan && !bb){
        html += `<div class="tpr2-wiz-empty">Belum ada data promo. Isi minimal 1 field.</div>`;
      } else {
        html += `<div class="tpr2-wiz-spec-list">
          <div class="tpr2-wiz-spec-row${promo ? ' filled' : ''}"><span class="lbl">Promo</span><span class="val">${promo ? escapeHtml(promo) : '—'}</span></div>
          <div class="tpr2-wiz-spec-row${periode ? ' filled' : ''}"><span class="lbl">Periode</span><span class="val">${periode ? escapeHtml(periode) : '—'}</span></div>
          <div class="tpr2-wiz-spec-row${bonus ? ' filled' : ''}"><span class="lbl">Bonus</span><span class="val">${bonus ? escapeHtml(bonus) : '—'}</span></div>
          <div class="tpr2-wiz-spec-row${iklan ? ' filled' : ''}"><span class="lbl">Iklan</span><span class="val">${iklan ? escapeHtml(iklan) : '—'}</span></div>
          <div class="tpr2-wiz-spec-row${bb ? ' filled' : ''}"><span class="lbl">Billboard</span><span class="val">${bb ? escapeHtml(bb) : '—'}</span></div>
        </div>`;
      }
      break;
    }
    case 'performance': {
      const total = parseInt(document.getElementById('tpr-total')?.value) || 0;
      const bul = TPR2_STATE.bulanan;
      const pDims = ['pekerjaan','usia','penghasilan','gender'];
      const pFilled = pDims.filter(k => Object.keys(TPR2_STATE.profil[k] || {}).length > 0).length;

      // Stat
      html += `<div class="tpr2-wiz-stat-grid">
        <div class="tpr2-wiz-stat"><div class="lbl">Total realisasi</div><div class="val">${total ? fmt(total) : '—'}<small>${total ? ' unit' : ''}</small></div></div>
        <div class="tpr2-wiz-stat"><div class="lbl">Bulan terisi</div><div class="val">${bul.length}<small>${bul.length ? ' bulan' : ''}</small></div></div>
      </div>`;

      // Chart bulanan kalau ada
      if(bul.length > 0){
        const max = Math.max(1, ...bul.map(b => b.unit));
        const peak = bul.reduce((a,b) => b.unit > a.unit ? b : a, bul[0]);
        const sum = bul.reduce((a,b) => a + b.unit, 0);
        const avg = (sum / bul.length).toFixed(1);
        html += `<div class="tpr2-wiz-chart">
          ${bul.map(b => {
            const h = Math.max(2, Math.round((b.unit / max) * 100));
            const isPeak = b.bulan === peak.bulan;
            return `<div class="tpr2-wiz-chart-bar${isPeak ? ' peak' : ''}" style="height:${h}%;" title="${b.bulan}: ${b.unit}"></div>`;
          }).join('')}
        </div>
        <div class="tpr2-wiz-chart-axis"><span>${bul[0].bulan}</span><span>★ ${peak.bulan}</span><span>${bul[bul.length-1].bulan}</span></div>
        <div class="tpr2-wiz-stat-grid">
          <div class="tpr2-wiz-stat"><div class="lbl">Rata² / bulan</div><div class="val">${avg}<small> unit</small></div></div>
          <div class="tpr2-wiz-stat"><div class="lbl">Puncak</div><div class="val">${peak.unit}<small> · ${peak.bulan}</small></div></div>
        </div>`;
      }

      // Persona
      if(pFilled > 0){
        const pek = TPR2_STATE.profil.pekerjaan;
        const usia = TPR2_STATE.profil.usia;
        const peng = TPR2_STATE.profil.penghasilan;
        if(pek && Object.keys(pek).length && usia && Object.keys(usia).length){
          const topPek = Object.entries(pek).sort((a,b) => b[1] - a[1])[0];
          const topUsia = Object.entries(usia).sort((a,b) => b[1] - a[1])[0];
          const topPeng = peng && Object.keys(peng).length ? Object.entries(peng).sort((a,b) => b[1] - a[1])[0] : null;
          let persona = `${escapeHtml(topPek[0])} usia ${escapeHtml(topUsia[0])}`;
          if(topPeng) persona += `, penghasilan ${escapeHtml(topPeng[0])}`;
          html += `<div class="tpr2-wiz-insight">🎯 Persona target: <strong>${persona}</strong>.</div>`;
        } else {
          html += `<div class="tpr2-wiz-insight">${pFilled} dari 4 dimensi profil terisi.</div>`;
        }
      }
      break;
    }
    case 'gtm': {
      const mkt = document.getElementById('tpr-gtm-mkt')?.value;
      const agent = document.getElementById('tpr-gtm-agent')?.value;
      const kanal = document.getElementById('tpr-gtm-kanal')?.value?.trim();
      const dev = document.getElementById('tpr-gtm-dev')?.value?.trim();
      const totalTeam = (parseInt(mkt) || 0) + (parseInt(agent) || 0);
      html += `<div class="tpr2-wiz-stat-grid">
        <div class="tpr2-wiz-stat"><div class="lbl">In-house</div><div class="val">${mkt || '—'}<small>${mkt ? ' org' : ''}</small></div></div>
        <div class="tpr2-wiz-stat"><div class="lbl">Agent</div><div class="val">${agent || '—'}<small>${agent ? ' agent' : ''}</small></div></div>
        <div class="tpr2-wiz-stat"><div class="lbl">Total tim</div><div class="val">${totalTeam || '—'}<small>${totalTeam ? ' org' : ''}</small></div></div>
      </div>`;
      if(kanal || dev){
        html += `<div class="tpr2-wiz-spec-list" style="margin-top:8px;">
          ${kanal ? `<div class="tpr2-wiz-spec-row filled"><span class="lbl">Kanal</span><span class="val">${escapeHtml(kanal)}</span></div>` : ''}
          ${dev ? `<div class="tpr2-wiz-spec-row filled"><span class="lbl">Developer</span><span class="val">${escapeHtml(dev)}</span></div>` : ''}
        </div>`;
      }
      if(totalTeam >= 10){
        html += `<div class="tpr2-wiz-insight">💪 Tim cukup besar (${totalTeam} orang) — kapasitas jualan kuat.</div>`;
      } else if(totalTeam > 0 && totalTeam < 5){
        html += `<div class="tpr2-wiz-insight">⚠ Tim kecil (${totalTeam} orang) — bisa jadi bottleneck velocity.</div>`;
      }
      break;
    }
  }
  host.innerHTML = html;
}



// ============================================================
// [SIKUMBANG v2] Editor form untuk data Sikumbang per perumahan
// Mirror dashboard sikumbang.tapera.go.id — split Komersil + Subsidi × 5 status
// ============================================================

// State internal Sikumbang
const SKB_STATE = {
  mode: 'card',  // 'card' | 'flat'
  cardOpen: { identitas:true, stok:true, galeri:false, crosscheck:false, insight:false }
};

// ─── INIT & FORM LOAD/SAVE ──────────────────────────────────────

function initSikumbangEditor(){
  const sel = document.getElementById('skb-select');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = perumahan.map(p => {
    const has = p.sikumbang ? '✓' : '—';
    return `<option value="${p.id}">${has} ${escapeHtml(p.nama)}</option>`;
  }).join('');
  if(current && perumahan.some(p => String(p.id) === String(current))) sel.value = current;
  loadSikumbangForm(sel.value);
  // Counter badge
  const cnt = document.getElementById('ecnt-sikumbang');
  if(cnt){
    const n = perumahan.filter(p => p.sikumbang).length;
    cnt.textContent = n ? `(${n})` : '';
  }
  // Restore mode dari localStorage
  try {
    const savedMode = localStorage.getItem('bm4_skb_mode') || 'card';
    skbSwitchMode(savedMode === 'flat' ? 'flat' : 'card');
  } catch(_){ skbSwitchMode('card'); }
}

// Helper: migrasi data lama (struktur v1) ke struktur v2
function _skbMigrate(s){
  if(!s) return null;
  // Sudah struktur v2 (ada komersil/subsidi nested) — pastikan galeri ada
  if(s.komersil && s.subsidi){
    if(!Array.isArray(s.galeri)) s.galeri = [];
    return s;
  }
  // Struktur v1 lama: unitTerjual/readyStock/kavling — assume semua subsidi
  const v2 = {
    idLokasi: s.idLokasi || '',
    status: s.status || '',
    tahunMulai: s.tahunMulai || null,
    komersil: { kavling:0, pembangunan:0, ready:0, dipesan:0, terjual:0 },
    subsidi:  { kavling:0, pembangunan:0, ready:0, proses:0, terjual:0 },
    galeri: Array.isArray(s.galeri) ? s.galeri : [],
    lastSynced: s.lastSynced || '',
    syncedBy: s.syncedBy || ''
  };
  // Map v1 → v2 subsidi (anggap semua data lama itu subsidi)
  if(typeof s.unitTerjual === 'number') v2.subsidi.terjual = s.unitTerjual;
  if(typeof s.readyStock === 'number') v2.subsidi.ready = s.readyStock;
  if(typeof s.kavling === 'number') v2.subsidi.kavling = s.kavling;
  return v2;
}

function loadSikumbangForm(id){
  const p = perumahan.find(x => String(x.id) === String(id));
  const formEl = document.getElementById('skb-form');
  const statusEl = document.getElementById('skb-status');
  if(!p){ if(formEl) formEl.style.display = 'none'; return; }
  if(formEl) formEl.style.display = 'block';

  const s = _skbMigrate(p.sikumbang) || {};
  const k = s.komersil || {};
  const su = s.subsidi || {};

  const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = v == null ? '' : v; };
  set('skb-id-lokasi', s.idLokasi);
  set('skb-status-proj', s.status || '');
  set('skb-tahun', s.tahunMulai);

  // Komersil
  set('skb-k-kavling', k.kavling || '');
  set('skb-k-pembangunan', k.pembangunan || '');
  set('skb-k-ready', k.ready || '');
  set('skb-k-dipesan', k.dipesan || '');
  set('skb-k-terjual', k.terjual || '');
  // Subsidi
  set('skb-s-kavling', su.kavling || '');
  set('skb-s-pembangunan', su.pembangunan || '');
  set('skb-s-ready', su.ready || '');
  set('skb-s-proses', su.proses || '');
  set('skb-s-terjual', su.terjual || '');

  // Status badge
  if(statusEl){
    if(s.lastSynced) statusEl.textContent = `✓ Update ${s.lastSynced}`;
    else if(p.sikumbang) statusEl.textContent = '✓ Ada data';
    else statusEl.textContent = 'Belum ada data';
  }
  // Sync info
  const line1 = document.getElementById('skb-sync-line1');
  const line2 = document.getElementById('skb-sync-line2');
  if(line1 && line2){
    if(s.lastSynced){
      line1.textContent = `Last sync: ${s.lastSynced}`;
      line2.textContent = s.syncedBy ? `oleh ${s.syncedBy}` : 'oleh tim BM4';
    } else {
      line1.textContent = 'Belum pernah disinkron';
      line2.textContent = 'isi data lalu klik Simpan untuk merekam waktu sync';
    }
  }

  // Refresh visual
  skbRefreshAll();
}

function saveSikumbangForm(){
  const id = document.getElementById('skb-select').value;
  const p = perumahan.find(x => String(x.id) === String(id));
  if(!p){ showToast('⚠ Perumahan tidak ditemukan'); return; }
  const getN = (id) => { const v = parseInt(document.getElementById(id)?.value); return isNaN(v) ? 0 : v; };
  const getS = (id) => (document.getElementById(id)?.value || '').trim();

  const idLokasi = getS('skb-id-lokasi');
  const status = getS('skb-status-proj');
  const tahun = (function(){ const v = parseInt(getS('skb-tahun')); return isNaN(v) ? null : v; })();

  const komersil = {
    kavling: getN('skb-k-kavling'),
    pembangunan: getN('skb-k-pembangunan'),
    ready: getN('skb-k-ready'),
    dipesan: getN('skb-k-dipesan'),
    terjual: getN('skb-k-terjual')
  };
  const subsidi = {
    kavling: getN('skb-s-kavling'),
    pembangunan: getN('skb-s-pembangunan'),
    ready: getN('skb-s-ready'),
    proses: getN('skb-s-proses'),
    terjual: getN('skb-s-terjual')
  };

  const totK = Object.values(komersil).reduce((a,b) => a+b, 0);
  const totS = Object.values(subsidi).reduce((a,b) => a+b, 0);

  if(totK === 0 && totS === 0 && !idLokasi && !status && tahun === null){
    // Cek dulu — kalau galeri ada, masih boleh save
    const existingGaleri = p.sikumbang?.galeri || [];
    if(existingGaleri.length === 0){
      showToast('⚠ Isi minimal 1 field sebelum simpan');
      return;
    }
  }

  // Get current user
  let userName = '';
  try {
    if(typeof CURRENT_USER !== 'undefined' && CURRENT_USER) userName = CURRENT_USER.nama || CURRENT_USER.username || '';
    else if(window.CURRENT_USER) userName = window.CURRENT_USER.nama || window.CURRENT_USER.username || '';
  } catch(_){}

  // Preserve galeri yang sudah ada (jangan ke-overwrite saat save form)
  const existingGaleri = (p.sikumbang?.galeri && Array.isArray(p.sikumbang.galeri)) ? p.sikumbang.galeri : [];

  p.sikumbang = {
    idLokasi: idLokasi,
    status: status,
    tahunMulai: tahun,
    komersil: komersil,
    subsidi: subsidi,
    galeri: existingGaleri,
    lastSynced: new Date().toISOString().slice(0,10),
    syncedBy: userName || 'tim BM4'
  };
  try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(_){}
  if(typeof setEditorDirty === 'function') try { setEditorDirty(true); } catch(_){}
  initSikumbangEditor();
  showToast(`✓ Data Sikumbang "${p.nama}" disimpan`);
  if(typeof selectedId !== 'undefined' && selectedId === p.id && typeof renderDetailOverview === 'function'){
    try { renderDetailOverview(p); } catch(_){}
  }
}

function clearSikumbangData(){
  const id = document.getElementById('skb-select').value;
  const p = perumahan.find(x => String(x.id) === String(id));
  if(!p){ return; }
  if(!p.sikumbang){ showToast('⚠ Belum ada data Sikumbang untuk dihapus'); return; }
  if(!confirm(`Hapus data Sikumbang untuk "${p.nama}"?`)) return;
  delete p.sikumbang;
  try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(_){}
  if(typeof setEditorDirty === 'function') try { setEditorDirty(true); } catch(_){}
  initSikumbangEditor();
  showToast(`🗑 Data Sikumbang "${p.nama}" dihapus`);
}

// ─── MODE TOGGLE & CARD COLLAPSIBLE ─────────────────────────────

function skbSwitchMode(mode){
  SKB_STATE.mode = mode;
  document.getElementById('skb-mode-btn-card')?.classList.toggle('active', mode === 'card');
  document.getElementById('skb-mode-btn-flat')?.classList.toggle('active', mode === 'flat');
  const cards = document.querySelectorAll('#etab-sikumbang .tpr2-card[data-skb-card]');
  cards.forEach(c => {
    if(mode === 'flat'){
      c.classList.remove('collapsed');
      c.classList.add('skb-flat-mode');
    } else {
      c.classList.remove('skb-flat-mode');
      const key = c.getAttribute('data-skb-card');
      if(SKB_STATE.cardOpen[key] === false) c.classList.add('collapsed');
      else c.classList.remove('collapsed');
    }
  });
  try { localStorage.setItem('bm4_skb_mode', mode); } catch(_){}
}

function skbToggleCard(cardId){
  if(SKB_STATE.mode === 'flat') return;
  const card = document.querySelector(`#etab-sikumbang .tpr2-card[data-skb-card="${cardId}"]`);
  if(!card) return;
  card.classList.toggle('collapsed');
  SKB_STATE.cardOpen[cardId] = !card.classList.contains('collapsed');
}

// ─── REFRESH UI ─────────────────────────────────────────────────

function skbRefreshAll(){
  skbRenderStockBar();
  skbRefreshSummaries();
  skbRenderInsight();
  skbCrossCheckTapera();
  skbUpdateSiteplanLink();
  skbRenderGaleri();
}

function skbOnFieldInput(){
  skbRenderStockBar();
  skbRefreshSummaries();
  skbRenderInsight();
  skbCrossCheckTapera();
  skbUpdateSiteplanLink();
}

// Helper: ambil semua angka komersil dan subsidi
function _skbReadStock(){
  const getN = (id) => { const v = parseInt(document.getElementById(id)?.value); return isNaN(v) ? 0 : v; };
  return {
    k: {
      kavling: getN('skb-k-kavling'),
      pembangunan: getN('skb-k-pembangunan'),
      ready: getN('skb-k-ready'),
      dipesan: getN('skb-k-dipesan'),
      terjual: getN('skb-k-terjual')
    },
    s: {
      kavling: getN('skb-s-kavling'),
      pembangunan: getN('skb-s-pembangunan'),
      ready: getN('skb-s-ready'),
      proses: getN('skb-s-proses'),
      terjual: getN('skb-s-terjual')
    }
  };
}

function _skbSum(o){ return Object.values(o).reduce((a,b) => a+b, 0); }

function skbRefreshSummaries(){
  const setSum = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };

  const stk = _skbReadStock();
  const totK = _skbSum(stk.k);
  const totS = _skbSum(stk.s);
  const total = totK + totS;

  // Update jenis program auto-detect
  const jenisEl = document.getElementById('skb-jenis');
  if(jenisEl){
    if(totK > 0 && totS > 0) jenisEl.value = '★ Campuran';
    else if(totK > 0) jenisEl.value = 'Komersil only';
    else if(totS > 0) jenisEl.value = 'Subsidi only';
    else jenisEl.value = '';
  }

  // Update total per segmen
  const totKEl = document.getElementById('skb-tot-komersil');
  const totSEl = document.getElementById('skb-tot-subsidi');
  if(totKEl) totKEl.textContent = totK;
  if(totSEl) totSEl.textContent = totS;

  // Identitas summary
  const idLokasi = (document.getElementById('skb-id-lokasi')?.value || '').trim();
  const status = document.getElementById('skb-status-proj')?.value;
  const STATUS_LABEL = { aktif:'🟢 Aktif', soldout:'🔴 Sold out', launching:'🟡 Segera launching' };
  const parts = [];
  if(idLokasi) parts.push(idLokasi);
  if(status) parts.push(STATUS_LABEL[status] || status);
  setSum('skb-sum-identitas', parts.length ? parts.join(' · ') : '— belum diisi');

  // Stok summary
  if(total === 0){
    setSum('skb-sum-stok', '— belum diisi');
  } else {
    const terjualTotal = stk.k.terjual + stk.s.terjual;
    const sellPct = Math.round(terjualTotal / total * 100);
    const segLbl = totK > 0 && totS > 0 ? `${totK} K + ${totS} S` :
                   totK > 0 ? `${totK} komersil` : `${totS} subsidi`;
    setSum('skb-sum-stok', `${total} unit · ${segLbl} · ${sellPct}% terjual`);
  }
}

// ─── VISUAL STACK BAR (overall) ─────────────────────────────────

function skbRenderStockBar(){
  const wrap = document.getElementById('skb-overall-wrap');
  const bar = document.getElementById('skb-overall-bar');
  const totalEl = document.getElementById('skb-overall-total');
  const legendEl = document.getElementById('skb-overall-legend');
  if(!wrap || !bar) return;

  const stk = _skbReadStock();
  const total = _skbSum(stk.k) + _skbSum(stk.s);

  if(total === 0){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if(totalEl) totalEl.textContent = total;

  // Combined view: 5 categories cross-segment
  const categories = [
    { lbl: 'Terjual',     color: '#A32D2D', val: stk.k.terjual + stk.s.terjual },
    { lbl: 'Proses bank', color: '#378ADD', val: stk.s.proses },
    { lbl: 'Dipesan',     color: '#534AB7', val: stk.k.dipesan },
    { lbl: 'Ready',       color: '#1D9E75', val: stk.k.ready + stk.s.ready },
    { lbl: 'Pembangunan', color: '#EF9F27', val: stk.k.pembangunan + stk.s.pembangunan },
    { lbl: 'Kavling',     color: '#FAC775', val: stk.k.kavling + stk.s.kavling }
  ];

  const segments = categories.filter(c => c.val > 0);
  bar.innerHTML = segments.map(c => {
    const pct = (c.val / total * 100);
    const showLabel = pct >= 8;
    return `<div class="skb-overall-seg" style="width:${pct}%;background:${c.color};">${showLabel ? `${c.lbl} ${c.val}` : ''}</div>`;
  }).join('');

  if(legendEl){
    legendEl.innerHTML = segments.map(c => {
      const pct = Math.round(c.val / total * 100);
      return `<span><span class="skb-legend-dot" style="background:${c.color};"></span>${c.lbl} ${pct}%</span>`;
    }).join('');
  }
}

// ─── SITEPLAN LINK + EMBED IFRAME ───────────────────────────────

function skbUpdateSiteplanLink(){
  const idLokasi = (document.getElementById('skb-id-lokasi')?.value || '').trim();
  const wrap = document.getElementById('skb-siteplan-link-wrap');
  const linkEl = document.getElementById('skb-siteplan-link');
  const urlEl = document.getElementById('skb-siteplan-url');
  if(!wrap) return;
  if(!idLokasi){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  // Format URL Sikumbang
  const url = `https://sikumbang.tapera.go.id/lokasi-perumahan/${encodeURIComponent(idLokasi)}/siteplan`;
  if(linkEl) linkEl.href = url;
  if(urlEl) urlEl.textContent = url.replace('https://','');
}

// ─── DRIVE IMAGE URL HELPER (reusable) ─────────────────────────

// Convert berbagai format URL Google Drive → direct thumbnail URL yang bisa di-<img>
// Input contoh:
//   https://drive.google.com/file/d/1abc...XYZ/view?usp=sharing
//   https://drive.google.com/open?id=1abc...XYZ
//   https://drive.google.com/uc?id=1abc...XYZ
//   https://drive.google.com/thumbnail?id=1abc...XYZ
// Output: https://drive.google.com/thumbnail?id={ID}&sz=w2000
// Atau null kalau bukan URL Drive.
function _driveExtractId(url){
  if(!url || typeof url !== 'string') return null;
  url = url.trim();
  // Pattern 1: /file/d/ID/view atau /file/d/ID/...
  let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
  if(m) return m[1];
  // Pattern 2: ?id=ID atau &id=ID
  m = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if(m) return m[1];
  // Pattern 3: /open?id=ID (sudah di-handle pattern 2)
  return null;
}
function _driveToImageUrl(url, size = 'w2000'){
  if(!url) return null;
  // Kalau bukan Drive URL, return apa adanya (mungkin URL gambar dari sumber lain)
  const id = _driveExtractId(url);
  if(!id){
    // Validasi minimal: harus URL gambar valid
    if(/^https?:\/\//.test(url)) return url;
    return null;
  }
  return `https://drive.google.com/thumbnail?id=${id}&sz=${size}`;
}
function _driveToOpenUrl(url){
  // URL untuk "Buka di Drive" — preview Drive penuh
  const id = _driveExtractId(url);
  if(!id) return url;
  return `https://drive.google.com/file/d/${id}/view`;
}

// ─── GALERI SITEPLAN ───────────────────────────────────────────

// Render daftar gambar galeri saat ini
function skbRenderGaleri(){
  const host = document.getElementById('skb-galeri-list');
  const sumEl = document.getElementById('skb-sum-galeri');
  if(!host) return;
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));
  const galeri = (p?.sikumbang?.galeri) || [];
  if(galeri.length === 0){
    host.innerHTML = '<div class="skb-galeri-empty">Belum ada gambar. Tambah lewat form di bawah ↓</div>';
    if(sumEl) sumEl.textContent = '— belum ada gambar';
    return;
  }
  host.innerHTML = galeri.map((g, idx) => {
    const imgUrl = _driveToImageUrl(g.url, 'w800');
    const fullUrl = _driveToImageUrl(g.url, 'w2000');
    const openUrl = _driveToOpenUrl(g.url);
    return `<div class="skb-galeri-item" data-galeri-idx="${idx}">
      <div class="skb-galeri-img-wrap">
        ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(g.label||'gambar')}" loading="lazy" onclick="skbGaleriZoom(${idx})" onerror="this.parentElement.classList.add('error');this.style.display='none';">` : ''}
        <div class="skb-galeri-error">⚠️ Gambar tidak bisa di-load. Cek sharing Drive (harus "Anyone with link").</div>
      </div>
      <div class="skb-galeri-meta">
        <div class="skb-galeri-label">${escapeHtml(g.label || 'Gambar')}</div>
        <div class="skb-galeri-actions">
          <button type="button" class="skb-galeri-btn" onclick="skbGaleriZoom(${idx})" title="Zoom full">🔍</button>
          <a href="${escapeHtml(openUrl)}" target="_blank" rel="noopener noreferrer" class="skb-galeri-btn" title="Buka di Drive">↗</a>
          <button type="button" class="skb-galeri-btn danger" onclick="skbGaleriRemove(${idx})" title="Hapus">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
  if(sumEl){
    const labels = galeri.map(g => g.label).filter(Boolean).slice(0,3).join(', ');
    sumEl.textContent = galeri.length + ' gambar' + (labels ? ' · ' + labels : '');
  }
}

function skbGaleriAdd(){
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));
  if(!p){ showToast('⚠ Perumahan tidak ditemukan'); return; }
  const labelSel = document.getElementById('skb-galeri-label')?.value || 'Lainnya';
  const labelCustom = (document.getElementById('skb-galeri-label-custom')?.value || '').trim();
  const url = (document.getElementById('skb-galeri-url')?.value || '').trim();
  const statusEl = document.getElementById('skb-galeri-add-status');

  if(!url){
    if(statusEl){ statusEl.textContent = '⚠ URL kosong. Paste link Google Drive dulu.'; statusEl.className = 'skb-galeri-add-status err'; }
    return;
  }
  // Validasi URL
  const driveId = _driveExtractId(url);
  if(!driveId && !/^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)/i.test(url)){
    if(statusEl){ statusEl.textContent = '⚠ Bukan URL Google Drive valid. Format: https://drive.google.com/file/d/.../view'; statusEl.className = 'skb-galeri-add-status err'; }
    return;
  }
  const label = labelSel === 'Lainnya' && labelCustom ? labelCustom : labelSel;

  // Tambah ke galeri
  if(!p.sikumbang) p.sikumbang = { idLokasi:'', status:'', tahunMulai:null, komersil:{kavling:0,pembangunan:0,ready:0,dipesan:0,terjual:0}, subsidi:{kavling:0,pembangunan:0,ready:0,proses:0,terjual:0}, galeri:[] };
  if(!Array.isArray(p.sikumbang.galeri)) p.sikumbang.galeri = [];
  p.sikumbang.galeri.push({
    url: url,
    label: label,
    addedAt: new Date().toISOString().slice(0,10)
  });
  // Save
  try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(_){}
  if(typeof setEditorDirty === 'function') try { setEditorDirty(true); } catch(_){}
  // Reset form
  document.getElementById('skb-galeri-url').value = '';
  document.getElementById('skb-galeri-label').value = 'Siteplan';
  document.getElementById('skb-galeri-label-custom').value = '';
  document.getElementById('skb-galeri-label-custom').style.display = 'none';
  if(statusEl){ statusEl.textContent = `✓ "${label}" ditambahkan ke galeri`; statusEl.className = 'skb-galeri-add-status ok'; setTimeout(() => { statusEl.textContent=''; statusEl.className='skb-galeri-add-status'; }, 4000); }
  skbRenderGaleri();
}

function skbGaleriRemove(idx){
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));
  if(!p?.sikumbang?.galeri) return;
  const item = p.sikumbang.galeri[idx];
  if(!item) return;
  if(!confirm(`Hapus gambar "${item.label || 'tanpa label'}" dari galeri?`)) return;
  p.sikumbang.galeri.splice(idx, 1);
  try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(_){}
  if(typeof setEditorDirty === 'function') try { setEditorDirty(true); } catch(_){}
  showToast('🗑 Gambar dihapus');
  skbRenderGaleri();
}

function skbGaleriZoom(idx){
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));
  const galeri = p?.sikumbang?.galeri || [];
  const item = galeri[idx];
  if(!item) return;
  const imgUrl = _driveToImageUrl(item.url, 'w2000');
  if(!imgUrl) return;
  // Simple modal zoom
  let modal = document.getElementById('skb-galeri-zoom-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'skb-galeri-zoom-modal';
    modal.className = 'skb-galeri-zoom-modal';
    modal.onclick = (e) => { if(e.target === modal) skbGaleriZoomClose(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="skb-galeri-zoom-inner">
      <div class="skb-galeri-zoom-head">
        <div class="skb-galeri-zoom-title">${escapeHtml(item.label || 'Gambar')}</div>
        <div class="skb-galeri-zoom-actions">
          <a href="${escapeHtml(_driveToOpenUrl(item.url))}" target="_blank" rel="noopener noreferrer" class="skb-galeri-btn">↗ Buka di Drive</a>
          <button type="button" class="skb-galeri-btn" onclick="skbGaleriZoomClose()">✕ Tutup</button>
        </div>
      </div>
      <div class="skb-galeri-zoom-body">
        <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(item.label||'')}">
      </div>
    </div>`;
  modal.style.display = 'flex';
}
function skbGaleriZoomClose(){
  const modal = document.getElementById('skb-galeri-zoom-modal');
  if(modal) modal.style.display = 'none';
}
function skbToggleGaleriHelp(){
  const help = document.getElementById('skb-galeri-help');
  if(help) help.style.display = help.style.display === 'none' ? 'block' : 'none';
}

// Listener: kalau label dropdown = "Lainnya", show input custom
(function(){
  document.addEventListener('change', (e) => {
    if(e.target?.id === 'skb-galeri-label'){
      const custom = document.getElementById('skb-galeri-label-custom');
      if(custom) custom.style.display = e.target.value === 'Lainnya' ? '' : 'none';
    }
  });
})();

// ─── INSIGHT STRATEGIS (auto-compute) ───────────────────────────

function skbRenderInsight(){
  const host = document.getElementById('skb-insight-content');
  const sumEl = document.getElementById('skb-sum-insight');
  if(!host) return;

  const stk = _skbReadStock();
  const totK = _skbSum(stk.k);
  const totS = _skbSum(stk.s);
  const total = totK + totS;

  if(total === 0){
    host.innerHTML = '<div class="skb-cross-empty">Isi data stok di atas untuk melihat sell-through rate, sisa inventory, ratio subsidi/komersil, dan estimasi habis stok.</div>';
    if(sumEl) sumEl.textContent = '— hitungan otomatis dari data stok';
    return;
  }

  const terjual = stk.k.terjual + stk.s.terjual;
  const ready = stk.k.ready + stk.s.ready;
  const kavling = stk.k.kavling + stk.s.kavling;
  const pembangunan = stk.k.pembangunan + stk.s.pembangunan;
  const inProcess = stk.k.dipesan + stk.s.proses;  // unit yang lagi dalam proses transaksi
  const sisaTersedia = ready + kavling + pembangunan;  // unit yang masih bisa dijual
  const sellPct = Math.round(terjual / total * 100);

  // Rasio subsidi vs komersil
  let ratioStr = '';
  if(totK > 0 && totS > 0){
    const pctK = Math.round(totK / total * 100);
    const pctS = 100 - pctK;
    ratioStr = `<strong>${pctS}% subsidi · ${pctK}% komersil</strong>`;
  } else if(totK > 0){
    ratioStr = '<strong>100% komersil</strong> (tidak ada subsidi)';
  } else {
    ratioStr = '<strong>100% subsidi</strong> (tidak ada komersil)';
  }

  // Velocity dari Tapera (kalau ada)
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));
  let velocity = null;
  let estHabisStr = '<span style="color:var(--faint);">tidak bisa dihitung</span>';
  let estHabisColor = '#888780';
  let velocityStr = '<span style="color:var(--faint);">tidak diketahui (data Tapera kosong)</span>';
  try {
    if(p?.tapera?.realisasiBulanan?.length){
      const sortedB = [...p.tapera.realisasiBulanan].sort((a,b) => a.bulan.localeCompare(b.bulan));
      const last6 = sortedB.slice(-6);
      const sumLast6 = last6.reduce((a,b) => a + (b.unit||0), 0);
      velocity = last6.length > 0 ? (sumLast6 / last6.length) : 0;
      velocityStr = `<strong>${velocity.toFixed(1)} unit/bln</strong> (rata-rata 6 bln Tapera)`;
      if(velocity > 0 && sisaTersedia > 0){
        const months = Math.round(sisaTersedia / velocity);
        estHabisStr = `~<strong>${months} bulan lagi</strong>`;
        if(months <= 6) estHabisColor = '#A32D2D';
        else if(months <= 12) estHabisColor = '#BA7517';
        else estHabisColor = '#0F6E56';
      } else if(velocity === 0 && sisaTersedia > 0){
        estHabisStr = '<span style="color:#A32D2D;">stuck (velocity 0)</span>';
        estHabisColor = '#A32D2D';
      }
    }
  } catch(_){}

  // Rekomendasi strategis
  let rekomendasi = '';
  if(sellPct >= 80){
    rekomendasi = `Sell-through ${sellPct}% dengan stok tersedia ${sisaTersedia} unit. <strong>Kompetitor di fase tail-end</strong> — opportunity buat agresif marketing sebelum mereka launching cluster baru.`;
  } else if(sellPct >= 50){
    rekomendasi = `Sell-through ${sellPct}% — kompetitor di mid-cycle. Stok tersedia ${sisaTersedia} unit ${velocity ? `+ velocity ${velocity.toFixed(1)}/bln` : ''}, mereka <strong>masih akan agresif</strong>.`;
  } else if(sellPct >= 20){
    rekomendasi = `Sell-through baru ${sellPct}% — early stage. <strong>Window buat ambil market share</strong> sebelum mereka mature.`;
  } else {
    rekomendasi = `Sell-through ${sellPct}% — sangat awal atau slow-moving. <strong>Cek penyebab</strong>: harga ketinggian? Lokasi sulit? Promo kurang?`;
  }

  host.innerHTML = `
    <div class="skb-insight-grid">
      <div class="skb-insight-stat">
        <div class="lbl">Sell-through rate</div>
        <div class="val" style="color:${sellPct >= 50 ? '#1D9E75' : '#BA7517'};">${sellPct}% <span class="meta">(${terjual}/${total})</span></div>
      </div>
      <div class="skb-insight-stat">
        <div class="lbl">Stok tersedia</div>
        <div class="val">${sisaTersedia} <span class="meta">unit (R+K+P)</span></div>
      </div>
      <div class="skb-insight-stat">
        <div class="lbl">Dalam proses</div>
        <div class="val">${inProcess} <span class="meta">unit (dipesan+proses)</span></div>
      </div>
      <div class="skb-insight-stat">
        <div class="lbl">Komposisi pasar</div>
        <div class="val small">${ratioStr}</div>
      </div>
      <div class="skb-insight-stat" style="grid-column:span 2;">
        <div class="lbl">Estimasi habis stok</div>
        <div class="val small" style="color:${estHabisColor};">${estHabisStr}</div>
        <div class="meta">${velocityStr}</div>
      </div>
    </div>
    <div class="skb-insight-rec">
      <div class="skb-insight-rec-lbl">💡 Rekomendasi strategis:</div>
      <div class="skb-insight-rec-body">${rekomendasi}</div>
    </div>
  `;
  if(sumEl) sumEl.textContent = `sell-through ${sellPct}% · ${sisaTersedia} unit tersedia`;
}

// ─── CROSS-CHECK SIKUMBANG vs TAPERA FLPP ──────────────────────

function skbCrossCheckTapera(){
  const host = document.getElementById('skb-crosscheck-content');
  const sumEl = document.getElementById('skb-sum-cross');
  if(!host) return;
  const id = document.getElementById('skb-select')?.value;
  const p = perumahan.find(x => String(x.id) === String(id));

  const stk = _skbReadStock();
  // Total terjual subsidi (yang bisa dibandingkan dengan Tapera FLPP)
  const subsidiTerjual = stk.s.terjual;
  const totK = _skbSum(stk.k);
  const totS = _skbSum(stk.s);
  const totalAll = totK + totS;

  if(!p?.tapera?.totalRealisasi && totalAll === 0){
    host.innerHTML = '<div class="skb-cross-empty">Isi data Sikumbang + Tapera FLPP untuk perumahan ini supaya cross-check otomatis muncul.</div>';
    if(sumEl) sumEl.textContent = '— isi data Sikumbang dulu';
    return;
  }
  if(!p?.tapera?.totalRealisasi){
    host.innerHTML = '<div class="skb-cross-empty">Data Sikumbang sudah ada, tapi <strong>Tapera FLPP belum diisi</strong>. Buka tab Tapera, isi total realisasi.</div>';
    if(sumEl) sumEl.textContent = '— Tapera FLPP belum diisi';
    return;
  }
  if(totalAll === 0){
    host.innerHTML = '<div class="skb-cross-empty">Tapera sudah ada (' + p.tapera.totalRealisasi + ' unit), tapi <strong>Sikumbang belum diisi</strong>. Lengkapi di atas.</div>';
    if(sumEl) sumEl.textContent = '— Sikumbang belum diisi';
    return;
  }

  const taperaTotal = p.tapera.totalRealisasi;
  // Logic cross-check baru: compare subsidi.terjual ke Tapera FLPP (apple-to-apple)
  const diff = subsidiTerjual - taperaTotal;
  const absDiff = Math.abs(diff);
  let analysis = '';
  let ringColor = '#1D9E75';
  let summary = '';

  if(taperaTotal === 0 && subsidiTerjual > 0){
    analysis = `<span style="color:#854F0B;">⚠ Tapera 0 unit cair</span>, padahal Sikumbang <strong>subsidi terjual ${subsidiTerjual}</strong>. Mungkin Tapera FLPP belum di-sync — atau pembeli pakai non-FLPP (cek skema KPR).`;
    ringColor = '#854F0B';
    summary = '⚠ Tapera 0 vs Sikumbang positif';
  } else if(diff === 0){
    analysis = `<span style="color:#0F6E56;">✓ Match persis</span> — Sikumbang subsidi terjual & Tapera FLPP sama-sama ${subsidiTerjual} unit. <strong>Konsisten</strong>.`;
    ringColor = '#0F6E56';
    summary = '✓ subsidi match Tapera';
  } else if(diff < 0){
    // Tapera > Sikumbang subsidi → anomali (Tapera nggak mungkin lebih besar dari Sikumbang)
    analysis = `<span style="color:#A32D2D;">⚠ Anomali</span> — Tapera FLPP <strong>${taperaTotal}</strong> > Sikumbang subsidi terjual <strong>${subsidiTerjual}</strong>. Selisih ${absDiff} unit. Kemungkinan: Sikumbang belum di-update, atau salah input. Cek kembali.`;
    ringColor = '#A32D2D';
    summary = `⚠ selisih -${absDiff} unit`;
  } else {
    // Sikumbang subsidi > Tapera (selisih positif = subsidi non-FLPP atau belum cair)
    const pctNonFLPP = Math.round(diff / subsidiTerjual * 100);
    analysis = `Tapera FLPP <strong>${taperaTotal}</strong> dari ${subsidiTerjual} subsidi terjual. Selisih <strong>+${diff} unit (${pctNonFLPP}%)</strong> = subsidi tapi <strong>belum cair / non-FLPP</strong> (mis. KPR konvensional disubsidi developer).`;
    ringColor = '#0F6E56';
    summary = `${pctNonFLPP}% subsidi non-FLPP`;
  }

  // Komersil insight terpisah
  const komersilTerjual = stk.k.terjual;
  let komersilNote = '';
  if(komersilTerjual > 0){
    komersilNote = `<div class="skb-cross-row" style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
      <span class="skb-cross-icon" style="background:#FAEEDA;color:#854F0B;">⬜</span>
      <span class="skb-cross-lbl">Komersil terjual (di luar Tapera)</span>
      <span class="skb-cross-val">${komersilTerjual} unit</span>
    </div>`;
  }

  host.innerHTML = `
    <div class="skb-cross-grid">
      <div class="skb-cross-row">
        <span class="skb-cross-icon" style="background:#FAEEDA;color:#854F0B;">🟡</span>
        <span class="skb-cross-lbl">Sikumbang subsidi terjual</span>
        <span class="skb-cross-val">${subsidiTerjual} unit</span>
      </div>
      <div class="skb-cross-row">
        <span class="skb-cross-icon" style="background:#E6F1FB;color:#185FA5;">💰</span>
        <span class="skb-cross-lbl">Tapera FLPP cair</span>
        <span class="skb-cross-val">${taperaTotal} unit</span>
      </div>
      <div class="skb-cross-row" style="border-top:1px dashed var(--border);padding-top:8px;">
        <span class="skb-cross-icon" style="background:${diff > 0 ? '#FAEEDA' : (diff < 0 ? '#FCEBEB' : '#E1F5EE')};color:${ringColor};">${diff > 0 ? '+' : (diff < 0 ? '−' : '=')}</span>
        <span class="skb-cross-lbl">Selisih (subsidi non-FLPP)</span>
        <span class="skb-cross-val" style="color:${ringColor};">${diff > 0 ? '+' : ''}${diff} unit</span>
      </div>
      ${komersilNote}
    </div>
    <div class="skb-cross-analysis" style="border-left-color:${ringColor};">${analysis}</div>
  `;
  if(sumEl) sumEl.textContent = summary;
}

// ─── PASTE FROM CLIPBOARD ──────────────────────────────────────

async function skbPasteFromClipboard(){
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch(e){
    showToast('⚠ Tidak bisa baca clipboard. Paste manual ke field, ya.');
    return;
  }
  if(!text || !text.trim()){
    showToast('⚠ Clipboard kosong');
    return;
  }

  const lower = text.toLowerCase();

  // Parse ID Lokasi (format SNG... atau seperti dari URL)
  const idMatch = text.match(/\b([A-Z]{3}\d{10,15}[A-Z]\d{3})\b/) ||
                  text.match(/lokasi-perumahan\/([A-Z0-9]+)/);
  const idLokasi = idMatch ? idMatch[1] : null;

  // Parse 10 angka dari format Sikumbang dashboard
  // Sikumbang format: angka diikuti label "Kavling/Pembangunan/Ready Stock/Dipesan/Proses Bank/Terjual"
  // Pattern dashboard: KOMERSIL block then SUBSIDI block, masing-masing 5 status
  const findInBlock = (blockText, label) => {
    const re = new RegExp(`(\\d[\\d.,]*)\\s*(?:unit\\s*)?${label}|${label}[\\s:]+(\\d[\\d.,]*)`, 'i');
    const m = blockText.match(re);
    if(!m) return null;
    const raw = (m[1] || m[2] || '').replace(/[.,]/g, '');
    const n = parseInt(raw);
    return isNaN(n) ? null : n;
  };

  // Coba split text jadi blok komersil & subsidi
  let komersilText = '';
  let subsidiText = '';
  const lowSplit = lower;
  const kIdx = lowSplit.indexOf('komersil');
  const sIdx = lowSplit.indexOf('subsidi');
  if(kIdx >= 0 && sIdx >= 0){
    if(kIdx < sIdx){
      komersilText = text.substring(kIdx, sIdx);
      subsidiText = text.substring(sIdx);
    } else {
      subsidiText = text.substring(sIdx, kIdx);
      komersilText = text.substring(kIdx);
    }
  } else if(sIdx >= 0){
    // Cuma ada subsidi
    subsidiText = text;
  } else if(kIdx >= 0){
    komersilText = text;
  } else {
    // Tidak ada keyword segmen — anggap semua subsidi
    subsidiText = text;
  }

  // Parse 5 status per segmen
  const k = {
    kavling: findInBlock(komersilText, 'kavling'),
    pembangunan: findInBlock(komersilText, 'pembangunan'),
    ready: findInBlock(komersilText, 'ready\\s*stock'),
    dipesan: findInBlock(komersilText, 'dipesan'),
    terjual: findInBlock(komersilText, 'terjual')
  };
  const s = {
    kavling: findInBlock(subsidiText, 'kavling'),
    pembangunan: findInBlock(subsidiText, 'pembangunan'),
    ready: findInBlock(subsidiText, 'ready\\s*stock'),
    proses: findInBlock(subsidiText, 'proses\\s*bank'),
    terjual: findInBlock(subsidiText, 'terjual')
  };

  // Tahun mulai
  const tahunMatch = text.match(/\b(20[1-3]\d)\b/);
  const tahun = tahunMatch ? parseInt(tahunMatch[1]) : null;

  // Status proyek
  let status = '';
  if(/sold\s*out|habis|terjual\s*habis/i.test(text)) status = 'soldout';
  else if(/launching|coming|segera/i.test(text)) status = 'launching';
  else if(/aktif|active|berjalan/i.test(text)) status = 'aktif';

  // Apply
  const setIf = (id, v) => { if(v !== null && v !== '' && v !== undefined){ const el = document.getElementById(id); if(el) el.value = v; }};
  if(idLokasi) setIf('skb-id-lokasi', idLokasi);
  if(tahun) setIf('skb-tahun', tahun);
  if(status){ const e = document.getElementById('skb-status-proj'); if(e) e.value = status; }
  setIf('skb-k-kavling', k.kavling);
  setIf('skb-k-pembangunan', k.pembangunan);
  setIf('skb-k-ready', k.ready);
  setIf('skb-k-dipesan', k.dipesan);
  setIf('skb-k-terjual', k.terjual);
  setIf('skb-s-kavling', s.kavling);
  setIf('skb-s-pembangunan', s.pembangunan);
  setIf('skb-s-ready', s.ready);
  setIf('skb-s-proses', s.proses);
  setIf('skb-s-terjual', s.terjual);

  // Count detected
  const allFound = [
    idLokasi, tahun, status,
    k.kavling, k.pembangunan, k.ready, k.dipesan, k.terjual,
    s.kavling, s.pembangunan, s.ready, s.proses, s.terjual
  ].filter(v => v !== null && v !== undefined && v !== '').length;

  if(allFound === 0){
    showToast('⚠ Tidak ada data ke-detect. Isi manual.');
  } else {
    showToast(`✓ ${allFound} field auto-terisi dari clipboard`);
    skbOnFieldInput();
  }
}


// ============================================================
// STARTUP
// ============================================================
(function init(){
  // [v14 PROYEK] Load proyek dulu (dipakai di banyak tempat lewat getProyek/PROYEK proxy)
  loadProyek();

  // Load accounts dulu
  loadAccounts();

  // [v9 SECURITY] Migrasi password plaintext → hash (async, non-blocking).
  // Berjalan sekali saat startup. Akun yang sudah ter-hash akan di-skip.
  setTimeout(() => { migratePasswordsIfNeeded().catch(e => console.warn('Migrasi gagal:', e)); }, 500);

  // Coba load dari Sheets (async, tidak blocking)
  if(USE_SHEETS){
    // Secure Mode: akun tidak boleh di-load bebas dari frontend. Login/akun dikelola Apps Script.
    if(!window.BM4_SECURE_MODE){
      loadAccountsFromSheets().then(loaded => {
        // [v9 SECURITY] Setelah load dari Sheets, migrasi lagi (kalau Sheets masih kirim plaintext)
        if(loaded) migratePasswordsIfNeeded().catch(()=>{});
        // Kalau user sudah login, re-apply access supaya tab muncul sesuai data terbaru
        const savedUser = sessionStorage.getItem(CURRENT_USER_KEY);
        if(savedUser){
          currentUser = findAccount(savedUser);
          if(currentUser) applyUserAccess();
        }
      });
    }
    // [v15 PROYEK] Load proyek dari Sheets — kalau ada, override local
    loadProyekFromSheets().then(loaded => {
      if(loaded){
        // Refresh grid & screen pilih proyek kalau sudah di-render
        if(typeof renderProyek === 'function') renderProyek();
        if(typeof renderProyekCards === 'function') renderProyekCards();
      }
    });
  }

  // Cek session login
  if(sessionStorage.getItem(SESSION_KEY)==='ok'){
    const savedUser = sessionStorage.getItem(CURRENT_USER_KEY);
    if(savedUser){
      currentUser = findAccount(savedUser);
    }
    if(!currentUser){
      // Default ke BM jika tidak ada current user (backward compat dari sesi lama)
      currentUser = accounts.find(a => a.role === 'bm') || accounts[0];
      if(currentUser) sessionStorage.setItem(CURRENT_USER_KEY, currentUser.username);
    }
    if(currentUser) applyUserAccess();
    // [v12.4 STATE PERSISTENCE] Coba auto-pilih proyek terakhir agar tidak balik ke screen pemilih
    let restoredProyek = false;
    try {
      const saved = loadAppState();
      if(saved && saved.proyek && typeof PROYEK !== 'undefined' && PROYEK[saved.proyek]){
        // Auto-select proyek dan masuk ke s-app
        selectProyek(saved.proyek);
        restoredProyek = true;
      }
    } catch(e){ console.warn('auto restore proyek failed:', e); }
    if(!restoredProyek){
      showScreen('s-proyek');
    }
  } else {
    setTimeout(()=>{
      const u = document.getElementById('login-username');
      if(u) u.focus();
    },100);
  }
  if(USE_SHEETS) loadFromSheets();
  updateMobileMenuBtn();
  updateMobileStratBtn();

  // [v12 EDITOR] Enter-to-submit di form tambah perumahan & POI
  const bindEnter=(ids,handler)=>{
    ids.forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();handler();}});
    });
  };
  bindEnter(['enp-nama','enp-area','enp-lat','enp-lng','enp-dev','enp-unit','enp-real','enp-tahun'], addEPerumahan);
  bindEnter(['epoi-nama','epoi-lat','epoi-lng'], addEPoi);

  // [v12 EDITOR] Warning kalau close/reload tab dengan perubahan editor belum tersinkron
  window.addEventListener('beforeunload', (e)=>{
    if(editorState.dirty){
      e.preventDefault();
      e.returnValue='Ada perubahan editor yang belum tersinkron ke Sheets.';
      return e.returnValue;
    }
  });
})();
// ═══════════════════════════════════════════════════════════════════════════════
// [TPR PASTE] Tempel dari Tapera — parse text dari tapera.go.id/realisasi
// ───────────────────────────────────────────────────────────────────────────────
// Workflow: BM buka tapera.go.id/realisasi/, filter perumahan, select-all + copy.
// Tombol "Tempel dari Tapera" di card Identitas → parse → preview modal → Apply.
// Field yang bisa di-parse:
//   - Total UNIT (angka besar di stat cards)
//   - Nominal FLPP (43,0B atau 43.0 Miliar)
//   - Pekerjaan: SWASTA/WIRASWASTA/PNS/Other %
//   - Gender: L/P %
//   - Kelompok Penghasilan (range vs count)
//   - Kelompok Harga Rumah (range vs count)
//   - FLPP - Tahun Realisasi: Bulan + angka per bulan
//   - Tahun Realisasi (header filter)
//   - Kab/Kota (header filter)
// ═══════════════════════════════════════════════════════════════════════════════

let _tprPasteParsed = null; // hasil parse, dipakai modal preview

async function tprPasteFromClipboard(){
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch(e){
    showToast('⚠ Tidak bisa baca clipboard. Cek izin browser.');
    return;
  }
  if(!text || !text.trim()){
    showToast('⚠ Clipboard kosong');
    return;
  }
  const parsed = _tprParsePasteText(text);
  if(!parsed || Object.keys(parsed).length === 0){
    showToast('⚠ Tidak ada data Tapera yang dikenali. Pastikan teks dari tapera.go.id/realisasi');
    return;
  }
  _tprPasteParsed = parsed;
  _tprShowPastePreview(parsed);
}

// Parse berbagai format angka Indonesia:
//   "359"     → 359
//   "1.058"   → 1058 (titik = ribuan)
//   "43,0"    → 43.0 (koma = desimal)
//   "1,234.56"→ 1234.56 (US format, jarang)
function _tprParseNumber(s){
  if(!s) return null;
  s = String(s).trim();
  // Hapus spasi
  s = s.replace(/\s+/g, '');
  // Heuristik: kalau ada baik . dan ,
  // - kalau , muncul terakhir → koma desimal (ID format) → hapus titik, ganti koma jadi titik
  // - kalau . muncul terakhir → titik desimal (US format) → hapus koma
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if(lastDot >= 0 && lastComma >= 0){
    if(lastComma > lastDot){
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if(lastComma >= 0){
    // hanya koma — kalau setelah koma ada 3 angka, anggap ribuan; selainnya desimal
    const afterComma = s.length - lastComma - 1;
    if(afterComma === 3 && !/,\d{3}\D|\d,\d{3}$/.test(s.slice(0, lastComma+4))){
      // Ambigu, default ke desimal Indonesia
      s = s.replace(',', '.');
    } else {
      s = s.replace(',', '.');
    }
  } else if(lastDot >= 0){
    // hanya titik — kalau setelah titik ada 3 angka, anggap ribuan ID
    const afterDot = s.length - lastDot - 1;
    if(afterDot === 3){
      s = s.replace(/\./g, '');
    }
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function _tprParsePasteText(text){
  const out = {};
  const lower = text.toLowerCase();

  // ── Tahun Realisasi (header filter) ──
  // Pattern: "Tahun Realisasi" diikuti angka, atau angka 4-digit "2026"
  const tahunM = text.match(/tahun\s*realisasi[:\s]*(\d{4})/i);
  if(tahunM){
    out.tahunRealisasi = parseInt(tahunM[1]);
  } else {
    // fallback: cari angka 2020-2035 sebagai pivot
    const anyTahun = text.match(/\b(202[0-9]|203[0-5])\b/);
    if(anyTahun) out.tahunRealisasi = parseInt(anyTahun[1]);
  }

  // ── Kab/Kota (header filter) ──
  // Pattern: "Kabupaten/Kota" diikuti "KAB XXX" atau "KOTA XXX"
  const kabM = text.match(/(?:kabupaten\/kota|kab(?:upaten)?\/kota)[:\s\n×]*((?:KAB|KOTA)\s+[A-Z][A-Z\s]+?)(?:\n|×|$|\s{3,}|tahun|bank|asosiasi|provinsi|nama|tipe|pekerjaan)/i);
  if(kabM){
    out.kabKota = kabM[1].trim().replace(/\s+/g,' ');
  } else {
    // fallback langsung
    const anyKab = text.match(/\b((?:KAB|KOTA)\s+[A-Z][A-Z\s]{2,30}?)(?:\n|\s{2,}|$)/);
    if(anyKab) out.kabKota = anyKab[1].trim().replace(/\s+/g,' ');
  }

  // ── Total UNIT ──
  // Pattern: angka diikuti "UNIT" (case-insensitive) — biasanya stat card paling pertama
  const unitM = text.match(/([\d.,]+)\s*\n?\s*unit\b/i);
  if(unitM){
    const n = _tprParseNumber(unitM[1]);
    if(n !== null) out.totalRealisasi = Math.round(n);
  }

  // ── Nominal FLPP ──
  // Pattern: angka diikuti "B" atau "Miliar" diikuti "Nominal FLPP" / "FLPP"
  const nomM = text.match(/([\d.,]+)\s*B\s*\n?\s*nominal\s*flpp/i) ||
               text.match(/nominal\s*flpp[:\s\n]*([\d.,]+)\s*B/i) ||
               text.match(/([\d.,]+)\s*miliar.*?flpp/i);
  if(nomM){
    const n = _tprParseNumber(nomM[1]);
    if(n !== null) out.nominalFLPP = n;
  }

  // ── Profil Pekerjaan ──
  // Pattern: "SWAS..." atau "SWASTA" diikuti % → "92,20%" / "92.20%"
  const pekerjaanKeys = [
    {key:'swasta', re:/swas[a-z.]*\s*([\d.,]+)\s*%/i},
    {key:'wiraswasta', re:/wiras[a-z.]*\s*([\d.,]+)\s*%/i},
    {key:'pns', re:/\bpns\b\s*([\d.,]+)\s*%/i},
    {key:'tni_polri', re:/tni[\/\s-]*polri\s*([\d.,]+)\s*%/i},
    {key:'bumn', re:/\bbumn\b\s*([\d.,]+)\s*%/i},
    {key:'other', re:/\b(?:other|lain[a-z\s-]*)\s*([\d.,]+)\s*%/i}
  ];
  const pekerjaan = {};
  pekerjaanKeys.forEach(({key, re}) => {
    const m = text.match(re);
    if(m){
      const n = _tprParseNumber(m[1]);
      if(n !== null) pekerjaan[key] = Math.round(n);
    }
  });
  if(Object.keys(pekerjaan).length > 0) out.pekerjaan = pekerjaan;

  // ── Profil Gender ──
  // Pattern: "L 63,2%" / "P 36,8%" — perlu hati-hati supaya tidak match L dari word lain
  const gender = {};
  // Cari di sekitar kata "Jenis Kelamin"
  let genderBlock = text;
  const jkIdx = lower.indexOf('jenis kelamin');
  if(jkIdx >= 0){
    genderBlock = text.substring(jkIdx, jkIdx + 300);
  }
  const lM = genderBlock.match(/\bL\s+([\d.,]+)\s*%/);
  const pM = genderBlock.match(/\bP\s+([\d.,]+)\s*%/);
  if(lM){
    const n = _tprParseNumber(lM[1]);
    if(n !== null) gender['L'] = Math.round(n);
  }
  if(pM){
    const n = _tprParseNumber(pM[1]);
    if(n !== null) gender['P'] = Math.round(n);
  }
  if(Object.keys(gender).length > 0) out.gender = gender;

  // ── Kelompok Penghasilan ──
  // Pattern: "3 Jt < Penghasilan ≤ 4 Jt    146"
  // atau: "4 Jt ≤ 5 Jt    96"
  const penghasilan = {};
  // Cari di sekitar "Kelompok Penghasilan"
  const kpIdx = lower.indexOf('kelompok penghasilan');
  let kpBlock = text;
  if(kpIdx >= 0){
    // Ambil 600 char setelahnya, sampai keyword berikutnya
    kpBlock = text.substring(kpIdx, kpIdx + 800);
    // Stop di section berikutnya
    const stopIdx = kpBlock.search(/profesi\s*segmentasi|kelompok\s*harga|jenis\s*rumah|kelompok\s*uang/i);
    if(stopIdx > 0) kpBlock = kpBlock.substring(0, stopIdx);
  }
  // Pattern row: angka jt + sign + angka jt + count
  const phRowRe = /(\d+)\s*Jt\s*([<≤>≥]?)\s*Penghasilan\s*([<≤>≥]?)\s*(\d+)\s*Jt\s+(\d+)/gi;
  let phM;
  while((phM = phRowRe.exec(kpBlock)) !== null){
    const lo = phM[1], hi = phM[4];
    const count = parseInt(phM[5]);
    const k = `${lo}-${hi}Jt`;
    penghasilan[k] = count;
  }
  // Pattern lebih sederhana untuk row tanpa kata "Penghasilan"
  if(Object.keys(penghasilan).length === 0){
    const phSimpleRe = /(\d+)\s*Jt\s*[<≤>≥]?\s*[a-z\s]*[<≤>≥]\s*(\d+)\s*Jt\s+(\d+)/gi;
    let m;
    while((m = phSimpleRe.exec(kpBlock)) !== null){
      penghasilan[`${m[1]}-${m[2]}Jt`] = parseInt(m[3]);
    }
  }
  // "Other (3)  17"
  const otherM = kpBlock.match(/other\s*\(\d+\)\s+(\d+)/i);
  if(otherM) penghasilan['other'] = parseInt(otherM[1]);
  if(Object.keys(penghasilan).length > 0) out.penghasilan = penghasilan;

  // ── Kelompok Harga Rumah ──
  // Pattern: "150 Jt < Harga Rumah ≤ 175 Jt    359"
  const khIdx = lower.indexOf('kelompok harga');
  let khBlock = text;
  if(khIdx >= 0){
    khBlock = text.substring(khIdx, khIdx + 600);
    const stopIdx = khBlock.search(/kelompok\s*uang|kelompok\s*tenor|jenis\s*rumah|profesi/i);
    if(stopIdx > 0) khBlock = khBlock.substring(0, stopIdx);
  }
  const harga = [];
  const hRowRe = /(\d+)\s*Jt\s*[<≤>≥]?\s*Harga\s*Rumah\s*[<≤>≥]?\s*(\d+)\s*Jt\s+(\d+)/gi;
  let hM;
  while((hM = hRowRe.exec(khBlock)) !== null){
    harga.push({ range: `${hM[1]}-${hM[2]}Jt`, count: parseInt(hM[3]) });
  }
  if(harga.length > 0){
    // Sederhanakan jadi range dominan: range yang count terbanyak
    harga.sort((a,b) => b.count - a.count);
    out.hargaRange = harga[0].range;
    out._hargaBreakdown = harga;
  }

  // ── Realisasi Bulanan dari "FLPP - Tahun Realisasi" chart ──
  // Pattern: "January 2026  47", "March 2026  134", dll
  // Atau format: bulan + angka secara umum
  const monthsId = {
    januari:'01', january:'01', jan:'01',
    februari:'02', february:'02', feb:'02',
    maret:'03', march:'03', mar:'03',
    april:'04', apr:'04',
    mei:'05', may:'05',
    juni:'06', june:'06', jun:'06',
    juli:'07', july:'07', jul:'07',
    agustus:'08', august:'08', aug:'08',
    september:'09', sep:'09', sept:'09',
    oktober:'10', october:'10', oct:'10',
    november:'11', nov:'11',
    desember:'12', december:'12', dec:'12'
  };
  const bulanan = [];
  // Pattern: bulan + tahun + angka (di sekitar atau dipisah whitespace/newline)
  const monthRe = new RegExp(`\\b(${Object.keys(monthsId).join('|')})\\s+(20\\d{2})[\\s\\n]+(\\d+)\\b`, 'gi');
  let mbM;
  while((mbM = monthRe.exec(text)) !== null){
    const monthName = mbM[1].toLowerCase();
    const monthNum = monthsId[monthName];
    const year = mbM[2];
    const unit = parseInt(mbM[3]);
    if(monthNum && unit > 0 && unit < 10000){
      bulanan.push({ ym: `${year}-${monthNum}`, unit });
    }
  }
  // Format alt: "47 January 2026" (angka di depan)
  if(bulanan.length === 0){
    const monthRe2 = new RegExp(`(\\d+)[\\s\\n]+\\b(${Object.keys(monthsId).join('|')})\\s+(20\\d{2})`, 'gi');
    let m2;
    while((m2 = monthRe2.exec(text)) !== null){
      const monthName = m2[2].toLowerCase();
      const monthNum = monthsId[monthName];
      const year = m2[3];
      const unit = parseInt(m2[1]);
      if(monthNum && unit > 0 && unit < 10000){
        bulanan.push({ ym: `${year}-${monthNum}`, unit });
      }
    }
  }
  if(bulanan.length > 0){
    // Dedupe + sort by ym
    const seen = new Map();
    bulanan.forEach(b => seen.set(b.ym, b.unit));
    const sortedKeys = [...seen.keys()].sort();
    out.bulanan = sortedKeys.map(k => ({ ym: k, unit: seen.get(k) }));
    // Periode = bulan terakhir
    out.periode = sortedKeys[sortedKeys.length - 1];
  }

  return out;
}

// ─── PREVIEW MODAL ───────────────────────────────────────────────

function _tprShowPastePreview(p){
  // Generate preview rows
  const rows = [];
  const get = id => document.getElementById(id)?.value?.trim() || '';

  if(p.tahunRealisasi !== undefined) rows.push({
    key:'tahunRealisasi', label:'📅 Tahun Realisasi',
    current: get('tpr-tahun-realisasi'), parsed: String(p.tahunRealisasi),
    targetId:'tpr-tahun-realisasi'
  });
  if(p.kabKota) rows.push({
    key:'kabKota', label:'📍 Kabupaten/Kota',
    current: get('tpr-kab-kota'), parsed: p.kabKota,
    targetId:'tpr-kab-kota'
  });
  if(p.totalRealisasi !== undefined) rows.push({
    key:'totalRealisasi', label:'📊 Total Realisasi (unit)',
    current: get('tpr-total'), parsed: String(p.totalRealisasi),
    targetId:'tpr-total'
  });
  if(p.nominalFLPP !== undefined) rows.push({
    key:'nominalFLPP', label:'💵 Nominal FLPP (Miliar Rp)',
    current: get('tpr-nominal'), parsed: String(p.nominalFLPP),
    targetId:'tpr-nominal'
  });
  if(p.periode) rows.push({
    key:'periode', label:'📅 Periode data sampai',
    current: get('tpr-periode'), parsed: p.periode,
    targetId:'tpr-periode'
  });
  if(p.bulanan && p.bulanan.length > 0){
    const bStr = p.bulanan.map(b => `${b.ym}:${b.unit}`).join(', ');
    rows.push({
      key:'bulanan', label:`📈 Realisasi bulanan (${p.bulanan.length} bulan)`,
      current: get('tpr-bulanan'),
      parsed: bStr,
      targetId:'tpr-bulanan'
    });
  }
  if(p.pekerjaan){
    const pStr = Object.entries(p.pekerjaan).map(([k,v]) => `${k}:${v}`).join(', ');
    rows.push({
      key:'pekerjaan', label:'👔 Profil pekerjaan',
      current: get('tpr-pekerjaan'),
      parsed: pStr,
      targetId:'tpr-pekerjaan'
    });
  }
  if(p.gender){
    const gStr = Object.entries(p.gender).map(([k,v]) => `${k}:${v}`).join(', ');
    rows.push({
      key:'gender', label:'⚥ Profil gender',
      current: get('tpr-gender'),
      parsed: gStr,
      targetId:'tpr-gender'
    });
  }
  if(p.penghasilan){
    const pStr = Object.entries(p.penghasilan).map(([k,v]) => `${k}:${v}`).join(', ');
    rows.push({
      key:'penghasilan', label:'💰 Profil penghasilan',
      current: get('tpr-penghasilan'),
      parsed: pStr,
      targetId:'tpr-penghasilan'
    });
  }
  if(p.hargaRange){
    rows.push({
      key:'hargaRange', label:'🏠 Kelompok harga rumah (dominan)',
      current: get('tpr-harga'),
      parsed: p.hargaRange,
      targetId:'tpr-harga'
    });
  }

  if(rows.length === 0){
    showToast('⚠ Tidak ada field yang bisa di-apply');
    return;
  }

  // Build modal
  let modal = document.getElementById('tpr-paste-preview-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'tpr-paste-preview-modal';
    modal.className = 'tpr-paste-modal';
    modal.innerHTML = `
      <div class="tpr-paste-modal-backdrop" onclick="tprPasteModalClose()"></div>
      <div class="tpr-paste-modal-content">
        <div class="tpr-paste-modal-head">
          <div>
            <div class="tpr-paste-modal-title">📋 Preview hasil parse Tapera</div>
            <div class="tpr-paste-modal-sub">Centang field yang mau di-apply. Field tidak dicentang akan di-skip.</div>
          </div>
          <button class="tpr-paste-modal-close" onclick="tprPasteModalClose()">×</button>
        </div>
        <div class="tpr-paste-modal-body" id="tpr-paste-modal-rows"></div>
        <div class="tpr-paste-modal-foot">
          <button class="btn-sm" onclick="tprPasteToggleAll(true)">☑ Centang semua</button>
          <button class="btn-sm" onclick="tprPasteToggleAll(false)">☐ Uncheck semua</button>
          <div style="flex:1;"></div>
          <button class="btn-sm" onclick="tprPasteModalClose()">Batal</button>
          <button class="btn-sm-primary" onclick="tprPasteApply()">✓ Apply terpilih</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // Render rows
  const body = document.getElementById('tpr-paste-modal-rows');
  body.innerHTML = rows.map((r, i) => {
    const same = (r.current === r.parsed);
    const isEmpty = !r.current;
    const badge = same ? '<span class="tpr-paste-badge tpr-paste-badge-same">= sama</span>'
                       : (isEmpty ? '<span class="tpr-paste-badge tpr-paste-badge-new">+ baru</span>'
                                  : '<span class="tpr-paste-badge tpr-paste-badge-change">↻ ganti</span>');
    return `
      <div class="tpr-paste-row ${same ? 'is-same' : ''}">
        <label class="tpr-paste-row-check">
          <input type="checkbox" data-row="${i}" ${same ? '' : 'checked'}>
          <span></span>
        </label>
        <div class="tpr-paste-row-body">
          <div class="tpr-paste-row-label">${r.label} ${badge}</div>
          <div class="tpr-paste-row-values">
            <div class="tpr-paste-val-current">
              <div class="tpr-paste-val-tag">Sekarang</div>
              <div class="tpr-paste-val-text">${r.current ? escapeHtml(r.current) : '<i class="tpr-paste-empty">(kosong)</i>'}</div>
            </div>
            <div class="tpr-paste-val-arrow">→</div>
            <div class="tpr-paste-val-parsed">
              <div class="tpr-paste-val-tag">Hasil parse</div>
              <div class="tpr-paste-val-text">${escapeHtml(r.parsed)}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Store rows for apply
  modal._rows = rows;
  modal.style.display = 'flex';
}

function tprPasteModalClose(){
  const modal = document.getElementById('tpr-paste-preview-modal');
  if(modal) modal.style.display = 'none';
}

function tprPasteToggleAll(check){
  document.querySelectorAll('#tpr-paste-modal-rows input[type=checkbox]').forEach(cb => {
    cb.checked = check;
  });
}

function tprPasteApply(){
  const modal = document.getElementById('tpr-paste-preview-modal');
  if(!modal || !modal._rows) return;
  const rows = modal._rows;
  let appliedCount = 0;
  rows.forEach((r, i) => {
    const cb = document.querySelector(`#tpr-paste-modal-rows input[data-row="${i}"]`);
    if(!cb || !cb.checked) return;
    const el = document.getElementById(r.targetId);
    if(!el) return;
    el.value = r.parsed;
    appliedCount++;
  });
  // Trigger update
  if(typeof tpr2OnFieldInput === 'function') tpr2OnFieldInput();
  if(typeof tpr2RefreshAll === 'function') tpr2RefreshAll();
  tprPasteModalClose();
  showToast(`✓ Apply ${appliedCount} field dari Tapera`);
}

function tprShowPasteHelp(){
  const html = `
    <b>Cara pakai "Tempel dari Tapera":</b><br><br>
    <b>1.</b> Klik tombol <b>"🔗 Buka Realisasi FLPP resmi di Tapera"</b> di card ini.<br>
    <b>2.</b> Di halaman Tapera, filter dengan:<br>
    &nbsp;&nbsp;&nbsp;• <b>Tahun Realisasi</b> (misal 2026)<br>
    &nbsp;&nbsp;&nbsp;• <b>Kabupaten/Kota</b> (misal KAB SUBANG)<br>
    &nbsp;&nbsp;&nbsp;• <b>Nama Perumahan</b> (sesuai nama di sini)<br>
    <b>3.</b> Tunggu data muncul (angka stat cards + chart).<br>
    <b>4.</b> Tekan <b>Ctrl+A</b> untuk select all halaman.<br>
    <b>5.</b> Tekan <b>Ctrl+C</b> untuk copy.<br>
    <b>6.</b> Balik ke aplikasi → klik <b>"📋 Tempel dari Tapera"</b>.<br>
    <b>7.</b> Preview muncul → centang field yang mau diisi → klik <b>"Apply"</b>.<br><br>
    <i>Tips: kalau parse tidak lengkap, BM bisa edit field manual setelah Apply.</i>
  `;
  // Reuse showInfoModal kalau ada, fallback ke alert
  if(typeof showInfoModal === 'function'){
    showInfoModal('❓ Cara pakai Tempel dari Tapera', html);
  } else {
    const tmp = html.replace(/<br>/g,'\n').replace(/<\/?[^>]+>/g,'').replace(/&nbsp;/g,' ');
    alert(tmp);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// [PERF DASH L1] Performance Dashboard — Layer 1 Snapshot Logic
// ───────────────────────────────────────────────────────────────────────────────
// Auto-compute insight dari data Tapera + Sikumbang yang sudah ada.
// Tidak modify data, hanya analyze & render.
//
// Kunci interpretasi:
// - "Velocity" = rata-rata realisasi 3 bulan terakhir (unit/bulan)
// - "Trend"    = velocity 3 bulan terakhir vs 3 bulan sebelumnya
// - "Market share" = realisasi kita / total realisasi area
// - "Posisi"   = ranking dari skor strategis (Hub Formula) atau composite
// - "Sisa stok" = (Sikumbang ready+kavling+pembangunan) / velocity → estimasi bulan
// ═══════════════════════════════════════════════════════════════════════════════

const PERF_STATE = {
  area: '',
  filterMode: 'all', // all | anchor | non-anchor
  data: null,        // hasil compute terakhir
};

function openPerfDashboard(){
  const overlay = document.getElementById('perf-overlay');
  if(!overlay) return;
  overlay.classList.add('open');
  // Initial render
  renderPerfDashboard();
}

function closePerfDashboard(){
  const overlay = document.getElementById('perf-overlay');
  if(overlay) overlay.classList.remove('open');
}

// ─── COMPUTE: Analyze data semua perumahan dalam area ───────────

function _perfComputeData(){
  if(typeof perumahan === 'undefined' || !Array.isArray(perumahan)){
    return { perumahan: [], us: null, area: '—', total: 0 };
  }

  const filterMode = PERF_STATE.filterMode;
  let list = perumahan.filter(p => {
    if(filterMode === 'anchor') return p.role === 'anchor';
    if(filterMode === 'non-anchor') return p.role !== 'anchor';
    return true;
  });

  // Identify "us" (perumahan kita = role 'focus' atau yang diset sebagai milik kita)
  const us = perumahan.find(p => p.role === 'focus') || null;

  // Determine area dominan
  const areaMap = {};
  list.forEach(p => {
    const a = (p.tapera?.kabKota || p.area || '—').toUpperCase();
    areaMap[a] = (areaMap[a] || 0) + 1;
  });
  const dominantArea = Object.entries(areaMap).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';

  // Compute per-perumahan metrics
  const enriched = list.map(p => {
    const t = p.tapera || {};
    const s = p.sikumbang || {};
    const bulanan = t.realisasiBulanan || [];

    // Velocity: avg 3 bulan terakhir
    const last3 = bulanan.slice(-3);
    const prev3 = bulanan.slice(-6, -3);
    const velocity = last3.length > 0
      ? Math.round(last3.reduce((a,b) => a + (b.unit || 0), 0) / last3.length)
      : 0;
    const velocityPrev = prev3.length > 0
      ? Math.round(prev3.reduce((a,b) => a + (b.unit || 0), 0) / prev3.length)
      : 0;
    const trendPct = velocityPrev > 0 ? Math.round((velocity - velocityPrev) / velocityPrev * 100) : 0;

    // Total realisasi
    const total = t.totalRealisasi || 0;

    // Sikumbang stok
    const sk = s.komersil || {};
    const ss = s.subsidi || {};
    const stokTotal = (sk.kavling || 0) + (sk.pembangunan || 0) + (sk.ready || 0)
                    + (ss.kavling || 0) + (ss.pembangunan || 0) + (ss.ready || 0);
    const terjualTotal = (sk.terjual || 0) + (ss.terjual || 0);

    // Sisa stok dalam bulan
    const stokBulan = velocity > 0 && stokTotal > 0 ? Math.round(stokTotal / velocity * 10) / 10 : null;

    // Skor strategis (dari Hub Formula kalau ada)
    const skor = (typeof p.skor !== 'undefined') ? p.skor :
                 (typeof p.scoring?.total !== 'undefined' ? p.scoring.total : null);

    return {
      id: p.id,
      nama: p.nama || `Perumahan ${p.id}`,
      role: p.role || 'extra',
      isUs: us && p.id === us.id,
      area: (t.kabKota || p.area || '—').toUpperCase(),
      total,
      velocity,
      velocityPrev,
      trendPct,
      stokTotal,
      terjualTotal,
      stokBulan,
      skor: skor !== null ? Math.round(skor * 10) / 10 : null,
      promo: t.promotion?.promoAktif || '',
      pekerjaan: t.profilPembeli?.pekerjaan || {},
      gender: t.profilPembeli?.gender || {},
    };
  });

  // Total area
  const totalArea = enriched.reduce((a,b) => a + (b.total || 0), 0);
  // Velocity rata-rata per perumahan (yang punya data)
  const withVelocity = enriched.filter(p => p.velocity > 0);
  const avgVelocity = withVelocity.length > 0
    ? Math.round(withVelocity.reduce((a,b) => a + b.velocity, 0) / withVelocity.length)
    : 0;

  // Market share kita
  const usData = enriched.find(p => p.isUs);
  const marketShare = totalArea > 0 && usData ? Math.round(usData.total / totalArea * 100) : 0;

  // Ranking (sort by skor desc, fallback velocity)
  const ranked = [...enriched].sort((a, b) => {
    const sa = a.skor !== null ? a.skor : -1;
    const sb = b.skor !== null ? b.skor : -1;
    if(sa !== sb) return sb - sa;
    return (b.velocity || 0) - (a.velocity || 0);
  });
  ranked.forEach((p, i) => p.rank = i + 1);
  const usRank = ranked.find(p => p.isUs)?.rank || null;

  // Trend total area: this 3 months vs last 3
  let totalLast3 = 0, totalPrev3 = 0;
  enriched.forEach(p => {
    totalLast3 += (p.velocity || 0) * 3;
    totalPrev3 += (p.velocityPrev || 0) * 3;
  });
  const trendTotal = totalPrev3 > 0 ? Math.round((totalLast3 - totalPrev3) / totalPrev3 * 100) : 0;

  // Trend market share kita (compare 3 bulan terakhir vs 3 bulan sebelumnya)
  let usLast = (usData?.velocity || 0) * 3;
  let usPrev = (usData?.velocityPrev || 0) * 3;
  let totalLastForShare = enriched.reduce((a,b) => a + (b.velocity || 0) * 3, 0);
  let totalPrevForShare = enriched.reduce((a,b) => a + (b.velocityPrev || 0) * 3, 0);
  const shareNow = totalLastForShare > 0 ? (usLast / totalLastForShare * 100) : 0;
  const sharePrev = totalPrevForShare > 0 ? (usPrev / totalPrevForShare * 100) : 0;
  const shareTrendDelta = Math.round(shareNow - sharePrev);

  return {
    area: dominantArea,
    perumahan: enriched,
    ranked,
    us: usData,
    usRank,
    totalArea,
    avgVelocity,
    marketShare,
    trendTotal,
    shareTrendDelta,
    asOf: new Date().toISOString().slice(0, 10),
  };
}

// ─── RENDER: Main entry point ────────────────────────────────────

function renderPerfDashboard(){
  PERF_STATE.filterMode = document.getElementById('perf-filter-mode')?.value || 'all';
  const data = _perfComputeData();
  PERF_STATE.data = data;

  // Header info
  const subtitleEl = document.getElementById('perf-area-info');
  if(subtitleEl){
    subtitleEl.textContent = data.area && data.area !== '—'
      ? `Area: ${data.area} · ${data.perumahan.length} perumahan · update ${data.asOf}`
      : `${data.perumahan.length} perumahan · update ${data.asOf}`;
  }

  _perfRenderMetrics(data);
  _perfRenderHeatmap(data);
  _perfRenderAlerts(data);

  // Footer
  const lastUpdEl = document.getElementById('perf-last-update');
  if(lastUpdEl){
    lastUpdEl.textContent = `Snapshot: ${data.asOf} · ${data.perumahan.length} perumahan dianalisa`;
  }
}

// ─── RENDER: 4 Big Metrics ─────────────────────────────────────

function _perfRenderMetrics(data){
  const fmt = (n) => {
    if(n === null || n === undefined || isNaN(n)) return '—';
    return new Intl.NumberFormat('id-ID').format(Math.round(n));
  };

  const setEl = (id, val) => { const el = document.getElementById(id); if(el) el.innerHTML = val; };
  const setTrendEl = (id, deltaPct, label) => {
    const el = document.getElementById(id);
    if(!el) return;
    if(deltaPct === null || deltaPct === undefined || isNaN(deltaPct)){
      el.className = 'perf-metric-trend';
      el.textContent = label || '—';
      return;
    }
    const arrow = deltaPct > 2 ? '↗' : (deltaPct < -2 ? '↘' : '→');
    const cls = deltaPct > 2 ? 'perf-trend-up' : (deltaPct < -2 ? 'perf-trend-down' : 'perf-trend-flat');
    el.className = 'perf-metric-trend ' + cls;
    const sign = deltaPct > 0 ? '+' : '';
    el.textContent = `${arrow} ${sign}${deltaPct}% vs 3bln lalu`;
  };

  // Total Realisasi YTD
  setEl('perf-m-total', fmt(data.totalArea));
  setTrendEl('perf-m-total-trend', data.trendTotal, '— belum cukup data');

  // Velocity rata-rata
  setEl('perf-m-velocity', fmt(data.avgVelocity));
  setEl('perf-m-velocity-sub', 'unit/bln per perumahan');

  // Market share kita
  if(data.us){
    setEl('perf-m-share', `${data.marketShare}%`);
    setTrendEl('perf-m-share-trend', data.shareTrendDelta, '— belum cukup data');
  } else {
    setEl('perf-m-share', '—');
    setEl('perf-m-share-trend', 'Set 1 perumahan sebagai "focus"');
  }

  // Posisi kita
  if(data.us && data.usRank){
    setEl('perf-m-rank', `#${data.usRank}`);
    const skorDisplay = data.us.skor !== null ? `dari ${data.perumahan.length} (skor ${data.us.skor})` : `dari ${data.perumahan.length}`;
    setEl('perf-m-rank-sub', skorDisplay);
  } else {
    setEl('perf-m-rank', '—');
    setEl('perf-m-rank-sub', 'tidak ada perumahan focus');
  }
}

// ─── RENDER: Heatmap ───────────────────────────────────────────

function _perfRenderHeatmap(data){
  const wrap = document.getElementById('perf-heatmap-wrap');
  if(!wrap) return;

  // Sort perumahan by velocity desc untuk visual sequence
  const sorted = [...data.perumahan].sort((a, b) => (b.velocity || 0) - (a.velocity || 0));

  // Find max velocity untuk normalize warna
  const maxV = Math.max(...sorted.map(p => p.velocity || 0), 1);

  // Color scale: 0 = abu-abu, low = teal, mid = amber, high = red
  const _getColor = (v) => {
    if(!v) return '#F1EFE8';
    const ratio = v / maxV;
    if(ratio < 0.2) return '#9FE1CB';
    if(ratio < 0.4) return '#C0DD97';
    if(ratio < 0.6) return '#FAC775';
    if(ratio < 0.8) return '#EF9F27';
    return '#E24B4A';
  };

  const cells = sorted.map(p => {
    const color = _getColor(p.velocity);
    const isEmpty = !p.velocity;
    const tooltip = `${escapeHtml(p.nama)}\n${p.velocity} unit/bln · total ${p.total}`;
    return `<div class="perf-heatmap-cell ${p.isUs ? 'is-us' : ''} ${isEmpty ? 'is-empty' : ''}"
              style="background:${color};"
              onclick="_perfHeatmapClick(${p.id})">
              <span class="perf-heatmap-tooltip">${escapeHtml(p.nama)} · ${p.velocity}/bln</span>
            </div>`;
  }).join('');

  wrap.innerHTML = cells || '<div style="color:var(--muted);font-size:11px;padding:12px;">Belum ada data perumahan untuk dianalisa.</div>';
}

function _perfHeatmapClick(id){
  // Future: drill-down ke detail perumahan
  // Untuk Layer 1, cukup tunjukkan toast info
  const p = perumahan.find(x => x.id === id);
  if(!p) return;
  if(typeof showToast === 'function'){
    showToast(`📌 ${p.nama} · velocity ${PERF_STATE.data?.perumahan.find(x => x.id === id)?.velocity || 0}/bln`);
  }
}

// ─── RENDER: Alerts (auto-detect 3 paling penting) ──────────────

function _perfRenderAlerts(data){
  const wrap = document.getElementById('perf-alerts-wrap');
  if(!wrap) return;

  const alerts = [];

  // ── Alert 1: Kompetitor stok hampir habis (sold-through tinggi) ──
  data.perumahan.forEach(p => {
    if(p.isUs) return;
    if(p.stokBulan !== null && p.stokBulan < 3 && p.velocity > 10){
      const sellThrough = p.terjualTotal && p.stokTotal
        ? Math.round(p.terjualTotal / (p.terjualTotal + p.stokTotal) * 100)
        : null;
      alerts.push({
        priority: 1,
        type: 'red',
        icon: '🔴',
        title: `${p.nama} ${sellThrough ? 'sold-through ' + sellThrough + '%, ' : ''}stok habis ~${p.stokBulan} bln`,
        detail: `Velocity ${p.velocity}/bln · sisa stok ${p.stokTotal} unit. Kompetitor akan "hilang" dari pasar dalam ${Math.ceil(p.stokBulan)} bulan.`,
      });
    }
  });

  // ── Alert 2: Velocity kita turun ──
  if(data.us && data.us.trendPct < -10 && data.us.velocityPrev > 0){
    alerts.push({
      priority: 2,
      type: 'amber',
      icon: '🟡',
      title: `Velocity kita turun ${Math.abs(data.us.trendPct)}% dibanding 3 bulan lalu`,
      detail: `Sekarang ${data.us.velocity}/bln (sebelumnya ${data.us.velocityPrev}/bln). ${data.us.promo ? `Promo aktif: "${data.us.promo}" — perlu evaluasi efektivitas.` : 'Belum ada promo aktif yang tercatat.'}`,
    });
  }

  // ── Alert 3: Kompetitor velocity tinggi & naik ──
  const fastRising = data.perumahan
    .filter(p => !p.isUs && p.velocity > (data.avgVelocity * 1.5) && p.trendPct > 10)
    .sort((a, b) => b.velocity - a.velocity);
  if(fastRising.length > 0){
    const top = fastRising[0];
    alerts.push({
      priority: 2,
      type: 'amber',
      icon: '⚠️',
      title: `${top.nama} velocity ${top.velocity}/bln (naik +${top.trendPct}%)`,
      detail: `Kompetitor agresif. ${top.promo ? `Promo aktif: "${top.promo}".` : ''} Pertimbangkan analisa lebih dalam untuk respon strategis.`,
    });
  }

  // ── Alert 4: Profil pembeli area dominan (insight strategis) ──
  // Aggregate profil pekerjaan & gender dari semua perumahan yang ada datanya
  const aggPekerjaan = {};
  const aggGender = {};
  let nWith = 0;
  data.perumahan.forEach(p => {
    if(Object.keys(p.pekerjaan || {}).length > 0){
      Object.entries(p.pekerjaan).forEach(([k, v]) => { aggPekerjaan[k] = (aggPekerjaan[k] || 0) + v; });
      nWith++;
    }
    if(Object.keys(p.gender || {}).length > 0){
      Object.entries(p.gender).forEach(([k, v]) => { aggGender[k] = (aggGender[k] || 0) + v; });
    }
  });
  if(nWith > 0){
    const topJob = Object.entries(aggPekerjaan).sort((a,b) => b[1]-a[1])[0];
    const topGen = Object.entries(aggGender).sort((a,b) => b[1]-a[1])[0];
    if(topJob && topGen){
      const jobPct = Math.round(topJob[1] / nWith);
      const genPct = Math.round(topGen[1] / nWith);
      alerts.push({
        priority: 3,
        type: 'blue',
        icon: '💡',
        title: `Profil pembeli area: ${jobPct}% ${topJob[0]}, ${genPct}% ${topGen[0]}`,
        detail: `Berdasarkan ${nWith} perumahan dengan data Tapera. Pertimbangkan apakah targeting marketing kita match dengan profil ini.`,
      });
    }
  }

  // ── Alert 5: Market share kita turun signifikan ──
  if(data.us && data.shareTrendDelta < -3){
    alerts.push({
      priority: 1,
      type: 'red',
      icon: '📉',
      title: `Market share kita turun ${Math.abs(data.shareTrendDelta)}% poin`,
      detail: `Sekarang ${data.marketShare}% (sebelumnya ~${data.marketShare - data.shareTrendDelta}%). Kompetitor menggerus pangsa pasar.`,
    });
  }

  // ── Alert positif: kalau kita unggul ──
  if(data.us && data.usRank === 1){
    alerts.push({
      priority: 4,
      type: 'green',
      icon: '🏆',
      title: `Kita di posisi #1 di area ini`,
      detail: `Skor strategis tertinggi. Pertahankan momentum dan pantau kompetitor #2 yang naik.`,
    });
  }

  // Sort by priority + ambil top 3
  alerts.sort((a, b) => a.priority - b.priority);
  const top3 = alerts.slice(0, 3);

  if(top3.length === 0){
    wrap.innerHTML = `
      <div class="perf-alert is-empty">
        <div class="perf-alert-icon">ℹ️</div>
        <div class="perf-alert-body">
          <div class="perf-alert-title" style="color:var(--muted);">Belum ada insight signifikan</div>
          <div class="perf-alert-detail" style="color:var(--muted);">Tambah data Tapera + Sikumbang untuk lebih banyak perumahan supaya alert auto-detect bisa jalan.</div>
        </div>
      </div>
    `;
    return;
  }

  wrap.innerHTML = top3.map(a => `
    <div class="perf-alert is-${a.type}">
      <div class="perf-alert-icon">${a.icon}</div>
      <div class="perf-alert-body">
        <div class="perf-alert-title">${escapeHtml(a.title)}</div>
        <div class="perf-alert-detail">${escapeHtml(a.detail)}</div>
      </div>
    </div>
  `).join('');
}
