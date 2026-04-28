// ============================================================
// patch-008-release-readiness-center.js
// Panel final untuk cek kesiapan rilis: patch, data, offline, sync,
// UAT, SOP, dan export report.
// ============================================================
(function(window, document){
  const PATCH_ID = 'patch-008-release-readiness-center';
  if(window[PATCH_ID]) return;
  window[PATCH_ID] = true;
  let panel = null;
  function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(m){ if(typeof showToast === 'function') showToast(m); else console.log('[BM4]',m); }
  function readJson(k,fb){ try{return JSON.parse(localStorage.getItem(k)||'')}catch(e){return fb} }
  function getGlobal(name, fallback){ try{return Function('fallback','try{return (typeof '+name+'!=="undefined")?'+name+':fallback}catch(e){return fallback}')(fallback)}catch(e){return fallback} }
  function counts(){ const p=getGlobal('perumahan',[]), poi=getGlobal('poi',[]), t=getGlobal('tpTargets',[]); return {perumahan:Array.isArray(p)?p.length:0, poi:Array.isArray(poi)?poi.length:0, target:Array.isArray(t)?t.length:0}; }
  function collect(){
    const patchStatus = window.BM4PatchStatus || { loaded:[], failed:[], patches: window.BM4_PATCHES || [] };
    const validation = window.BM4DataSafety && typeof window.BM4DataSafety.validateAll === 'function' ? window.BM4DataSafety.validateAll() : null;
    const sync = window.BM4SyncSafety && typeof window.BM4SyncSafety.preflight === 'function' ? window.BM4SyncSafety.preflight() : null;
    const check = readJson('bm4_test_results_v1', []);
    const cps = readJson('bm4_stability_checkpoints_v1', []);
    const errors = readJson('bm4_stability_errors_v1', []);
    const c = counts();
    const failed = patchStatus.failed || [];
    const items = [
      { id:'patches', label:'Patch aktif termuat', ok: failed.length === 0, detail: failed.length ? failed.length+' patch gagal' : (patchStatus.loaded||[]).length+' patch aktif' },
      { id:'data', label:'Data utama tersedia', ok: c.perumahan > 0 && c.poi > 0, detail: c.perumahan+' perumahan · '+c.poi+' POI' },
      { id:'validation', label:'Validasi data bersih', ok: validation ? validation.errors === 0 : true, detail: validation ? (validation.errors+' error · '+validation.warnings+' warning') : 'validator tidak tersedia' },
      { id:'sync', label:'Preflight sync aman', ok: sync ? sync.ok : true, detail: sync ? (sync.ok ? 'siap sync' : sync.issues.join(', ')) : 'sync guard tidak tersedia' },
      { id:'backup', label:'Checkpoint lokal tersedia', ok: cps.length > 0, detail: cps.length+' checkpoint' },
      { id:'errors', label:'Tidak ada error lokal serius', ok: errors.length === 0, detail: errors.length+' error lokal tersimpan' },
      { id:'uat', label:'UAT sudah mulai diisi', ok: check.length > 0, detail: check.length+' item test tersimpan' },
      { id:'online', label:'Browser online', ok: navigator.onLine, detail: navigator.onLine ? 'online' : 'offline' }
    ];
    const score = Math.round(items.filter(x=>x.ok).length / items.length * 100);
    return { createdAt:new Date().toISOString(), score, items, counts:c, patchStatus, validation, sync, uat:check, checkpoints:cps.length, errors:errors.slice(0,10) };
  }
  function download(name, content, type){ const blob=new Blob([content],{type:type||'application/json;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},800); }
  function exportReport(){ const r=collect(); download('BM4-v11-release-readiness-report-'+new Date().toISOString().slice(0,10)+'.json', JSON.stringify(r,null,2)); }
  function exportSop(){
    const txt = `SOP UJI BM4 v11 Release Candidate\n\n1. Backup folder BM4 lama sebelum upload.\n2. Upload paket v11 ke hosting.\n3. Buka index.html?desktop=1&v=rc11.\n4. Login pakai akun lama.\n5. Cek Dashboard, Analisa Lokasi, Editor Data, Tapera/Sikumbang.\n6. Klik Cek Data di Editor. Jangan sync kalau masih ada error.\n7. Buat Backup Lokal sebelum perubahan besar.\n8. Coba Mobile Lite: mobile.html?v=rc11, buat draft, export JSON.\n9. Import draft mobile lewat tombol Import Mobile di desktop.\n10. Setelah data dicek, baru klik Sync.\n11. Kalau ada error patch, matikan patch di js/patches/patch-registry.js.\n\nCatatan: Secure Mode masih OFF untuk UAT awal. Aktifkan nanti setelah aplikasi utama stabil.\n`;
    download('SOP-UJI-BM4-v11-RC.txt', txt, 'text/plain;charset=utf-8');
  }
  function render(){
    if(!panel) return;
    const r = collect();
    const body = panel.querySelector('#bm4-ready-body');
    const klass = r.score >= 85 ? 'ok' : r.score >= 65 ? 'warn' : 'bad';
    body.innerHTML = '<div class="bm4-ready-score '+klass+'"><b>'+r.score+'%</b><span>Kesiapan uji penuh</span></div>'+
      '<div class="bm4-ready-grid">'+r.items.map(it=>'<div class="'+(it.ok?'ok':'bad')+'"><b>'+(it.ok?'✅':'⚠️')+' '+esc(it.label)+'</b><span>'+esc(it.detail)+'</span></div>').join('')+'</div>'+
      '<div class="bm4-ready-note"><b>Keputusan:</b> '+(r.score>=85?'Siap UAT penuh. Tetap backup sebelum sync.':r.score>=65?'Bisa diuji, tapi perhatikan warning.':'Jangan sync data final dulu sebelum warning dibereskan.')+'</div>';
  }
  function ensurePanel(){
    if(panel) return panel;
    panel = document.createElement('div'); panel.id='bm4-ready-panel'; panel.className='bm4-ready-panel';
    panel.innerHTML = '<div class="bm4-ready-card"><div class="bm4-ready-head"><div><b>🚀 Release Readiness</b><span>BM4 v11 RC · cek final sebelum tim coba</span></div><button data-close>×</button></div><div id="bm4-ready-body" class="bm4-ready-body"></div><div class="bm4-ready-actions"><button data-refresh>Refresh</button><button data-report>Export Report</button><button data-sop>Download SOP</button></div></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', e=>{ if(e.target===panel || e.target.dataset.close!==undefined) panel.classList.remove('open'); });
    panel.querySelector('[data-refresh]').onclick = render;
    panel.querySelector('[data-report]').onclick = exportReport;
    panel.querySelector('[data-sop]').onclick = exportSop;
    return panel;
  }
  function open(){ ensurePanel(); render(); panel.classList.add('open'); }
  function attachButton(){ const right=document.querySelector('.tb-right'); if(!right || document.getElementById('bm4-ready-btn')) return; const b=document.createElement('button'); b.id='bm4-ready-btn'; b.className='tb-btn bm4-ready-btn'; b.type='button'; b.textContent='🚀 Ready'; b.onclick=open; right.insertBefore(b,right.firstChild); }
  function init(){ ensurePanel(); attachButton(); setInterval(attachButton,1500); window.BM4ReleaseReadiness={open,collect,exportReport}; console.log('%cBM4 Release Readiness active','color:#2563EB;font-weight:bold'); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
