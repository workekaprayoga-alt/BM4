// Formula legacy and hub
// ============================================================
// FORMULA EDITOR
// ============================================================
function syncNum(rId,nId){document.getElementById(nId).value=document.getElementById(rId).value;}
function syncRng(nId,rId){document.getElementById(rId).value=document.getElementById(nId).value;}
function updateWTotal(){const total=parseInt(document.getElementById('w-aksesibilitas').value||0)+parseInt(document.getElementById('w-fasilitas').value||0)+parseInt(document.getElementById('w-fisik').value||0);const el=document.getElementById('weight-total-display');el.textContent=`Total: ${total}% ${total===100?'✓':'⚠ harus = 100%'}`;el.className='weight-total '+(total===100?'ok':'bad');}
['w-aksesibilitas','w-fasilitas','w-fisik'].forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('input',updateWTotal);});
function loadAdminValues(){
  document.getElementById('w-aksesibilitas').value=FORMULA.wAksesibilitas;
  document.getElementById('w-fasilitas').value=FORMULA.wFasilitas;
  document.getElementById('w-fisik').value=FORMULA.wFisik;
  document.getElementById('sw-tol').value=FORMULA.wTol;document.getElementById('sn-tol').value=FORMULA.wTol;
  document.getElementById('sw-cbd').value=FORMULA.wCBD;document.getElementById('sn-cbd').value=FORMULA.wCBD;
  document.getElementById('sw-transport').value=FORMULA.wTransport;document.getElementById('sn-transport').value=FORMULA.wTransport;
  document.getElementById('sw-rs').value=FORMULA.wRS;document.getElementById('sn-rs').value=FORMULA.wRS;
  document.getElementById('sw-kampus').value=FORMULA.wKampus;document.getElementById('sn-kampus').value=FORMULA.wKampus;
  document.getElementById('sw-mall').value=FORMULA.wMall;document.getElementById('sn-mall').value=FORMULA.wMall;
  document.getElementById('sw-pemda').value=FORMULA.wPemda;document.getElementById('sn-pemda').value=FORMULA.wPemda;
  document.getElementById('sw-industri').value=FORMULA.wIndustri;document.getElementById('sn-industri').value=FORMULA.wIndustri;
  document.getElementById('sw-publik').value=FORMULA.wPublik;document.getElementById('sn-publik').value=FORMULA.wPublik;
  document.getElementById('sw-decay-aks').value=FORMULA.decayAks;document.getElementById('sn-decay-aks').value=FORMULA.decayAks;
  document.getElementById('sw-decay-fas').value=FORMULA.decayFas;document.getElementById('sn-decay-fas').value=FORMULA.decayFas;
  updateWTotal();
}
document.getElementById('formula-trigger').addEventListener('click',()=>{loadAdminValues();switchHubTab('scoring');document.getElementById('admin-overlay').classList.add('open');});
document.getElementById('admin-overlay').addEventListener('click',e=>{if(e.target===document.getElementById('admin-overlay'))document.getElementById('admin-overlay').classList.remove('open');});
function applyFormula(){
  const wA=parseInt(document.getElementById('w-aksesibilitas').value),wF=parseInt(document.getElementById('w-fasilitas').value),wFi=parseInt(document.getElementById('w-fisik').value);
  if(wA+wF+wFi!==100){alert('Total bobot faktor utama harus = 100%\nSekarang: '+(wA+wF+wFi)+'%');return;}
  FORMULA.wAksesibilitas=wA;FORMULA.wFasilitas=wF;FORMULA.wFisik=wFi;
  FORMULA.wTol=parseInt(document.getElementById('sn-tol').value);FORMULA.wCBD=parseInt(document.getElementById('sn-cbd').value);FORMULA.wTransport=parseInt(document.getElementById('sn-transport').value);
  FORMULA.wRS=parseInt(document.getElementById('sn-rs').value);FORMULA.wKampus=parseInt(document.getElementById('sn-kampus').value);FORMULA.wMall=parseInt(document.getElementById('sn-mall').value);
  FORMULA.wPemda=parseInt(document.getElementById('sn-pemda').value);FORMULA.wIndustri=parseInt(document.getElementById('sn-industri').value);FORMULA.wPublik=parseInt(document.getElementById('sn-publik').value);
  FORMULA.decayAks=parseFloat(document.getElementById('sn-decay-aks').value);FORMULA.decayFas=parseFloat(document.getElementById('sn-decay-fas').value);
  try{localStorage.setItem('bm4_formula',JSON.stringify(FORMULA));}catch(e){}
  recalcAll();
  if(analisaMapInit){Object.entries(markers).forEach(([id,{marker,data}])=>{marker.setTooltipContent(`<b>${data.nama}</b><br>${data.area} · Skor: <b>${data.score}</b>`);});buildRanking(document.getElementById('rank-cat-select').value);}
  if(selectedId)selectPerumahan(selectedId);
  document.getElementById('admin-overlay').classList.remove('open');
  showToast('✅ Formula diperbarui & skor dihitung ulang!');
  const t=document.getElementById('formula-trigger');t.textContent='✓';t.style.background='#ECFDF5';setTimeout(()=>{t.textContent='⚙️';t.style.background='white';},1500);
}
function resetFormula(){if(!confirm('Reset formula ke default?'))return;FORMULA={wAksesibilitas:50,wFasilitas:30,wFisik:20,wTol:40,wCBD:40,wTransport:20,wRS:30,wKampus:20,wMall:20,wPemda:10,wIndustri:10,wPublik:10,decayAks:8,decayFas:6};loadAdminValues();}

// ============================================================
// [TAHAP 3] HUB FORMULA — Tab switcher + Potensi + Cache
// ============================================================
function switchHubTab(tab){
  document.querySelectorAll('.hub-tab').forEach(b=>b.classList.toggle('active', b.dataset.hubTab===tab));
  document.querySelectorAll('.hub-pane').forEach(p=>p.classList.toggle('active', p.dataset.hubPane===tab));
  if(tab==='potensi') loadHubPotensiValues();
  if(tab==='cache') refreshCacheStats();
  if(tab==='kategori') renderKategoriEditor();
  if(tab==='pdl_formula') renderPdlFormulaEditor();
  if(tab==='field_mgr') renderFieldManager();
  if(tab==='gap_analysis') renderGapAnalysis();
}

// Potensi Unit ─────────────────────────────────────
function loadHubPotensiValues(){
  const input=document.getElementById('hub-formula-pct');
  const saveBtn=document.getElementById('hub-potensi-save');
  const locked=document.getElementById('hub-potensi-locked');
  if(!input) return;
  input.value=POTENSI_PCT;
  document.getElementById('hub-formula-pct-disp').textContent=POTENSI_PCT;
  document.getElementById('hub-formula-pct-disp2').textContent=POTENSI_PCT;
  document.getElementById('hub-formula-sample').textContent=(typeof fmt==='function'?fmt(calcPotensiUnit(5000)):calcPotensiUnit(5000));
  // Role guard — hanya BM yang bisa edit
  const isBM = (typeof currentUser!=='undefined' && currentUser && currentUser.role==='bm');
  input.disabled = !isBM;
  if(saveBtn) saveBtn.style.display = isBM ? '' : 'none';
  if(locked) locked.style.display = isBM ? 'none' : 'block';
}
function previewHubFormulaPotensi(){
  const v=parseFloat(document.getElementById('hub-formula-pct').value)||0;
  document.getElementById('hub-formula-pct-disp').textContent=v;
  document.getElementById('hub-formula-pct-disp2').textContent=v;
  document.getElementById('hub-formula-sample').textContent=(typeof fmt==='function'?fmt(Math.round((5000*v)/100)):Math.round((5000*v)/100));
}
function saveHubFormulaPotensi(){
  const v=parseFloat(document.getElementById('hub-formula-pct').value);
  if(isNaN(v)||v<1||v>100){alert('Persentase harus antara 1–100');return;}
  savePotensiFormula(v);
  // Sync ke Settings (kalau field-nya sudah ter-render)
  const legacyInput=document.getElementById('set-formula-pct');
  if(legacyInput){
    legacyInput.value=v;
    const d1=document.getElementById('set-formula-pct-disp'); if(d1) d1.textContent=v;
    const d2=document.getElementById('set-formula-pct-disp2'); if(d2) d2.textContent=v;
    const s=document.getElementById('set-formula-sample'); if(s) s.textContent=(typeof fmt==='function'?fmt(calcPotensiUnit(5000)):calcPotensiUnit(5000));
  }
  // Re-render detail target pasar kalau sedang terbuka
  if(typeof renderTpList==='function') try{renderTpList();}catch(_){}
  showToast('✅ Formula Potensi disimpan');
}

// Route Cache ─────────────────────────────────────
function refreshCacheStats(){
  const countEl=document.getElementById('hub-cache-count');
  const sizeEl=document.getElementById('hub-cache-size');
  const oldestEl=document.getElementById('hub-cache-oldest');
  if(!countEl) return;
  let count=0, sizeBytes=0, oldestTs=null;
  try{
    const raw=localStorage.getItem(ROUTE_CACHE_KEY);
    if(raw){
      sizeBytes=raw.length; // rough — 1 char ≈ 1 byte di UTF-16 LS impl, tapi cukup untuk UI
      const parsed=JSON.parse(raw);
      const entries=Object.values(parsed||{});
      count=entries.length;
      entries.forEach(e=>{ if(e && e._t && (!oldestTs || e._t<oldestTs)) oldestTs=e._t; });
    }
  }catch(_){}
  countEl.textContent=count.toLocaleString('id-ID');
  sizeEl.textContent = sizeBytes<1024 ? sizeBytes+' B' : (sizeBytes/1024).toFixed(1)+' KB';
  if(oldestTs){
    const days=Math.floor((Date.now()-oldestTs)/86400000);
    oldestEl.textContent = days<=0 ? 'entri tertua: hari ini' : `entri tertua: ${days} hari lalu`;
  } else {
    oldestEl.textContent = 'belum ada entri';
  }
}
function clearRouteCacheUI(){
  const countEl=document.getElementById('hub-cache-count');
  const n=countEl ? parseInt(countEl.textContent.replace(/\D/g,''))||0 : 0;
  const msg = n>0 ? `Hapus ${n} entri cache route? Jarak via jalan akan dihitung ulang saat dibutuhkan.` : 'Cache sudah kosong. Tetap lanjutkan reset?';
  if(!confirm(msg)) return;
  if(typeof clearRouteCache==='function') clearRouteCache();
  // Reset _roadNearest/_roadPerum di semua perumahan + mode-nya
  if(typeof perumahan!=='undefined' && Array.isArray(perumahan)){
    perumahan.forEach(p=>{ delete p._roadNearest; delete p._roadPerum; p._distMode='estimasi'; });
  }
  refreshCacheStats();
  showToast('🗑 Cache route dihapus');
  // Re-render detail kalau ada yang terpilih
  if(typeof selectedId!=='undefined' && selectedId && typeof selectPerumahan==='function') try{selectPerumahan(selectedId);}catch(_){}
}

// Load saved formula
try{const sf=localStorage.getItem('bm4_formula');if(sf)FORMULA={...FORMULA,...JSON.parse(sf)};recalcAll();}catch(e){}
// Load saved data
try{const sd=localStorage.getItem('bm4_data');if(sd){const d=JSON.parse(sd);if(d.perumahan&&d.perumahan.length>0){perumahan.length=0;d.perumahan.forEach(p=>perumahan.push(p));}if(d.poi&&d.poi.length>0){poi.length=0;d.poi.forEach(x=>poi.push(x));}recalcAll();}}catch(e){}
