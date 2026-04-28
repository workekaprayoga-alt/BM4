// ============================================================
// patch-007-mobile-draft-importer.js
// Import draft dari mobile.html ke data desktop secara aman.
// Tidak langsung sync ke Google Sheet; data masuk lokal dulu dan
// wajib dicek + sync manual.
// ============================================================
(function(window, document){
  const PATCH_ID = 'patch-007-mobile-draft-importer';
  if(window[PATCH_ID]) return;
  window[PATCH_ID] = true;

  const LS_IMPORTS = 'bm4_mobile_import_events_v1';
  const LS_NOTES = 'bm4_mobile_imported_notes_v1';
  let panel = null;
  let parsedDrafts = [];
  let importReport = null;

  function toast(msg){ if(typeof showToast === 'function') showToast(msg); else console.log('[BM4]', msg); }
  function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function parseNum(v){ const n = Number(String(v||'').replace(',','.')); return Number.isFinite(n) ? n : 0; }
  function isLat(v){ const n=parseNum(v); return n>=-90 && n<=90 && n!==0; }
  function isLng(v){ const n=parseNum(v); return n>=-180 && n<=180 && n!==0; }
  function normText(v){ return String(v||'').trim(); }
  function readJson(key, fb){ try { return JSON.parse(localStorage.getItem(key)||''); } catch(e){ return fb; } }
  function writeJson(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch(e){ return false; } }
  function getGlobal(name, fallback){
    try { return Function('fallback', 'try { return (typeof '+name+' !== "undefined") ? '+name+' : fallback; } catch(e){ return fallback; }')(fallback); }
    catch(e){ return fallback; }
  }
  function setGlobal(name, value){
    try { return Function('value', 'try { '+name+' = value; return true; } catch(e){ return false; }')(value); }
    catch(e){ return false; }
  }
  function saveMainData(perumahan, poi){
    try { localStorage.setItem('bm4_data', JSON.stringify({ perumahan: perumahan || [], poi: poi || [] })); } catch(e){}
    setGlobal('perumahan', perumahan || []);
    setGlobal('poi', poi || []);
  }
  function makeKey(obj){ return [normText(obj.nama).toLowerCase(), Number(obj.lat||0).toFixed(5), Number(obj.lng||0).toFixed(5)].join('|'); }
  function nowIso(){ return new Date().toISOString(); }
  function addImportEvent(item){
    const list = readJson(LS_IMPORTS, []);
    list.unshift(Object.assign({ time: nowIso() }, item||{}));
    writeJson(LS_IMPORTS, list.slice(0,30));
  }
  function normalizeDrafts(drafts){
    const result = { perumahan: [], poi: [], notes: [], errors: [], warnings: [] };
    (drafts || []).forEach((d, idx) => {
      const type = normText(d.type || d.tipe || '').toLowerCase();
      const data = d.data || d;
      if(type === 'perumahan'){
        const nama = normText(data.nama);
        const lat = parseNum(data.lat);
        const lng = parseNum(data.lng);
        if(!nama){ result.errors.push('Draft #'+(idx+1)+' perumahan tanpa nama'); return; }
        if(!isLat(lat) || !isLng(lng)){ result.errors.push('Draft '+nama+' tidak punya lat/lng valid'); return; }
        result.perumahan.push({
          id: data.id || ('mob-p-' + (d.id || Date.now()) + '-' + idx),
          nama,
          area: normText(data.area),
          tipe: normText(data.tipe) || 'subsidi',
          lat, lng,
          developer: normText(data.developer),
          unit: parseNum(data.unit),
          realisasi: parseNum(data.realisasi),
          tahun: parseNum(data.tahun) || new Date().getFullYear(),
          catatan: normText(data.catatan),
          sumber: 'mobile-draft',
          importedAt: nowIso()
        });
      } else if(type === 'poi'){
        const nama = normText(data.nama);
        const lat = parseNum(data.lat);
        const lng = parseNum(data.lng);
        if(!nama){ result.errors.push('Draft #'+(idx+1)+' POI tanpa nama'); return; }
        if(!isLat(lat) || !isLng(lng)){ result.errors.push('Draft POI '+nama+' tidak punya lat/lng valid'); return; }
        result.poi.push({
          id: data.id || ('mob-poi-' + (d.id || Date.now()) + '-' + idx),
          nama,
          kat: normText(data.kat) || 'publik',
          lat, lng,
          catatan: normText(data.catatan),
          sumber: 'mobile-draft',
          importedAt: nowIso()
        });
      } else if(type === 'catatan'){
        result.notes.push({
          id: d.id || ('mob-note-' + Date.now() + '-' + idx),
          judul: normText(data.judul) || 'Catatan lapangan',
          proyek: normText(data.proyek),
          lat: normText(data.lat),
          lng: normText(data.lng),
          catatan: normText(data.catatan),
          createdAt: d.createdAt || nowIso(),
          importedAt: nowIso()
        });
      } else {
        result.warnings.push('Draft #'+(idx+1)+' tipe tidak dikenal: '+(type || '-'));
      }
    });
    return result;
  }
  function buildReport(drafts){
    const normalized = normalizeDrafts(drafts);
    const existingP = Array.isArray(getGlobal('perumahan', [])) ? getGlobal('perumahan', []) : [];
    const existingPoi = Array.isArray(getGlobal('poi', [])) ? getGlobal('poi', []) : [];
    const pKeys = new Set(existingP.map(makeKey));
    const poiKeys = new Set(existingPoi.map(makeKey));
    normalized.perumahan = normalized.perumahan.filter(x => {
      const key = makeKey(x);
      if(pKeys.has(key)){ normalized.warnings.push('Duplikat perumahan dilewati: '+x.nama); return false; }
      pKeys.add(key); return true;
    });
    normalized.poi = normalized.poi.filter(x => {
      const key = makeKey(x);
      if(poiKeys.has(key)){ normalized.warnings.push('Duplikat POI dilewati: '+x.nama); return false; }
      poiKeys.add(key); return true;
    });
    return normalized;
  }
  function renderPanel(){
    if(!panel) return;
    const body = panel.querySelector('#bm4-mobile-import-body');
    if(!body) return;
    if(!importReport){
      const events = readJson(LS_IMPORTS, []);
      body.innerHTML = '<div class="bm4-mi-empty">Upload file JSON dari Mobile Lite untuk preview.</div>'+
        '<div class="bm4-mi-history"><b>Riwayat import</b>'+(events.length?events.slice(0,6).map(e => '<div><span>'+esc(new Date(e.time).toLocaleString('id-ID'))+'</span><b>+'+(e.perumahan||0)+' perumahan · +'+(e.poi||0)+' POI · '+(e.notes||0)+' catatan</b></div>').join(''):'<em>Belum ada import.</em>')+'</div>';
      return;
    }
    const r = importReport;
    body.innerHTML = '<div class="bm4-mi-summary">'+
      '<div><span>Perumahan baru</span><b>'+r.perumahan.length+'</b></div>'+
      '<div><span>POI baru</span><b>'+r.poi.length+'</b></div>'+
      '<div><span>Catatan</span><b>'+r.notes.length+'</b></div>'+
      '<div><span>Error</span><b class="'+(r.errors.length?'bad':'')+'">'+r.errors.length+'</b></div></div>'+
      (r.errors.length?'<div class="bm4-mi-box bad"><b>Error</b>'+r.errors.map(x=>'<p>• '+esc(x)+'</p>').join('')+'</div>':'')+
      (r.warnings.length?'<div class="bm4-mi-box warn"><b>Catatan</b>'+r.warnings.slice(0,10).map(x=>'<p>• '+esc(x)+'</p>').join('')+'</div>':'')+
      '<div class="bm4-mi-preview"><b>Preview</b>'+
      r.perumahan.slice(0,5).map(x=>'<p>🏘️ '+esc(x.nama)+' · '+esc(x.area)+' · '+x.lat+', '+x.lng+'</p>').join('')+
      r.poi.slice(0,5).map(x=>'<p>📍 '+esc(x.nama)+' · '+esc(x.kat)+' · '+x.lat+', '+x.lng+'</p>').join('')+
      r.notes.slice(0,3).map(x=>'<p>📝 '+esc(x.judul)+' · '+esc(x.proyek)+'</p>').join('')+
      '</div>';
  }
  function openPanel(){ ensurePanel(); renderPanel(); panel.classList.add('open'); }
  function closePanel(){ if(panel) panel.classList.remove('open'); }
  function ensurePanel(){
    if(panel) return panel;
    panel = document.createElement('div');
    panel.id = 'bm4-mobile-import-panel';
    panel.className = 'bm4-mi-panel';
    panel.innerHTML = '<div class="bm4-mi-card"><div class="bm4-mi-head"><div><b>📲 Import Draft Mobile</b><span>Masukkan JSON dari mobile.html, lalu cek sebelum sync.</span></div><button data-close>×</button></div><div class="bm4-mi-actions"><label class="bm4-mi-file">Pilih JSON<input type="file" accept="application/json,.json" data-file></label><button data-import disabled>Import ke Lokal</button><button data-clear>Reset Preview</button></div><div id="bm4-mobile-import-body" class="bm4-mi-body"></div><div class="bm4-mi-foot">Import hanya mengubah data lokal browser. Setelah dicek, klik Sync manual untuk kirim ke Google Sheet.</div></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', e => { if(e.target === panel || e.target.dataset.close !== undefined) closePanel(); });
    panel.querySelector('[data-clear]').onclick = () => { parsedDrafts=[]; importReport=null; panel.querySelector('[data-import]').disabled=true; renderPanel(); };
    panel.querySelector('[data-file]').onchange = async e => {
      const file = e.target.files && e.target.files[0];
      if(!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        parsedDrafts = Array.isArray(data) ? data : (Array.isArray(data.drafts) ? data.drafts : []);
        importReport = buildReport(parsedDrafts);
        panel.querySelector('[data-import]').disabled = !(importReport.perumahan.length || importReport.poi.length || importReport.notes.length) || importReport.errors.length > 0;
        renderPanel();
      } catch(err){
        importReport = { perumahan:[], poi:[], notes:[], warnings:[], errors:['File JSON tidak bisa dibaca: '+err.message] };
        panel.querySelector('[data-import]').disabled = true;
        renderPanel();
      }
    };
    panel.querySelector('[data-import]').onclick = doImport;
    return panel;
  }
  function doImport(){
    if(!importReport) return;
    if(importReport.errors.length) return toast('Masih ada error, import dibatalkan');
    if(window.BM4Stability && typeof window.BM4Stability.saveCheckpoint === 'function'){
      try { window.BM4Stability.saveCheckpoint('before_mobile_import', { force:true }); } catch(e){}
    }
    const perumahan = Array.isArray(getGlobal('perumahan', [])) ? getGlobal('perumahan', []) : [];
    const poi = Array.isArray(getGlobal('poi', [])) ? getGlobal('poi', []) : [];
    const notes = readJson(LS_NOTES, []);
    const newP = perumahan.concat(importReport.perumahan);
    const newPoi = poi.concat(importReport.poi);
    saveMainData(newP, newPoi);
    writeJson(LS_NOTES, importReport.notes.concat(notes).slice(0,200));
    addImportEvent({ perumahan: importReport.perumahan.length, poi: importReport.poi.length, notes: importReport.notes.length });
    try { if(typeof renderEPerumahan === 'function') renderEPerumahan(); } catch(e){}
    try { if(typeof renderEPoi === 'function') renderEPoi(); } catch(e){}
    try { if(typeof refreshAll === 'function') refreshAll(); } catch(e){}
    toast('✅ Draft mobile masuk lokal. Cek data lalu Sync manual.');
    importReport = null; parsedDrafts = [];
    panel.querySelector('[data-import]').disabled = true;
    renderPanel();
  }
  function attachButton(){
    const right = document.querySelector('.tb-right');
    if(!right || document.getElementById('bm4-mobile-import-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'bm4-mobile-import-btn';
    btn.className = 'tb-btn bm4-mobile-import-btn';
    btn.type = 'button';
    btn.textContent = '📲 Import Mobile';
    btn.onclick = openPanel;
    right.insertBefore(btn, right.firstChild);
  }
  function init(){
    ensurePanel(); attachButton();
    setInterval(attachButton, 1500);
    window.BM4MobileImporter = { openPanel, buildReport, normalizeDrafts };
    console.log('%cBM4 Mobile Draft Importer active', 'color:#7C3AED;font-weight:bold');
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
