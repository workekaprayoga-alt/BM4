// ============================================================
// patch-005-sync-backup-improvement.js
// BM4 Operational Ready: sync preflight, pending-sync marker,
// backup sebelum sync, dan dashboard kesehatan sinkron.
// Tidak mengubah data Google Sheet; hanya memperkuat safety frontend.
// ============================================================
(function(window, document){
  const PATCH_ID = 'patch-005-sync-backup-improvement';
  if(window[PATCH_ID]) return;
  window[PATCH_ID] = true;

  const LS_SYNC_EVENTS = 'bm4_sync_events_v1';
  const LS_PENDING_SYNC = 'bm4_pending_sync_v1';
  const MAX_EVENTS = 40;
  let panel = null;

  function nowIso(){ return new Date().toISOString(); }
  function safeParse(v, fb){ try { return JSON.parse(v); } catch(e){ return fb; } }
  function readJson(key, fb){ try { return safeParse(localStorage.getItem(key) || '', fb); } catch(e){ return fb; } }
  function writeJson(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch(e){ return false; } }
  function fmtTime(iso){ try { return new Date(iso).toLocaleString('id-ID'); } catch(e){ return iso || '-'; } }
  function toast(msg){ if(typeof showToast === 'function') showToast(msg); else console.log('[BM4]', msg); }
  function setStatus(state, msg){ if(typeof setSyncStatus === 'function') setSyncStatus(state, msg); }
  function getGlobal(name, fallback){
    try { return Function('fallback', 'try { return (typeof '+name+' !== "undefined") ? '+name+' : fallback; } catch(e){ return fallback; }')(fallback); }
    catch(e){ return fallback; }
  }
  function getCounts(){
    const p = getGlobal('perumahan', []);
    const poi = getGlobal('poi', []);
    const tp = getGlobal('tpTargets', []);
    return {
      perumahan: Array.isArray(p) ? p.length : 0,
      poi: Array.isArray(poi) ? poi.length : 0,
      targetPasar: Array.isArray(tp) ? tp.length : 0
    };
  }
  function hashLite(value){
    const s = JSON.stringify(value || {});
    let h = 0;
    for(let i=0;i<s.length;i++){ h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return String(h);
  }
  function snapshot(reason){
    if(window.BM4Stability && typeof window.BM4Stability.saveCheckpoint === 'function'){
      try { return window.BM4Stability.saveCheckpoint(reason || 'sync', { force:true }); } catch(e){}
    }
    const data = {
      version: 'v10.5-operational-ready',
      reason: reason || 'sync',
      createdAt: nowIso(),
      data: {
        perumahan: JSON.parse(JSON.stringify(getGlobal('perumahan', []))),
        poi: JSON.parse(JSON.stringify(getGlobal('poi', []))),
        tpTargets: JSON.parse(JSON.stringify(getGlobal('tpTargets', [])))
      }
    };
    try { localStorage.setItem('bm4_last_sync_snapshot_v1', JSON.stringify(data)); } catch(e){}
    return data;
  }
  function addEvent(type, detail){
    const list = readJson(LS_SYNC_EVENTS, []);
    const item = Object.assign({ id: Date.now() + '-' + Math.random().toString(16).slice(2), time: nowIso(), type:type }, detail || {});
    list.unshift(item);
    writeJson(LS_SYNC_EVENTS, list.slice(0, MAX_EVENTS));
    renderPanel();
    return item;
  }
  function markPending(reason){
    const data = { active:true, reason:reason || 'sync_started', time:nowIso(), counts:getCounts(), hash:hashLite({perumahan:getGlobal('perumahan',[]), poi:getGlobal('poi',[])}) };
    writeJson(LS_PENDING_SYNC, data);
    return data;
  }
  function clearPending(status){
    const prev = readJson(LS_PENDING_SYNC, null);
    writeJson(LS_PENDING_SYNC, { active:false, status:status || 'cleared', time:nowIso(), previous:prev });
  }
  function preflight(){
    const counts = getCounts();
    const issues = [];
    if(!navigator.onLine) issues.push('Browser sedang offline');
    if(counts.perumahan <= 0) issues.push('Data perumahan kosong');
    if(counts.poi <= 0) issues.push('Data POI kosong');
    if(typeof GAS_URL === 'undefined' || !GAS_URL) issues.push('GAS_URL belum diset');
    if(window.BM4DataSafety && typeof window.BM4DataSafety.validateAll === 'function'){
      try {
        const r = window.BM4DataSafety.validateAll();
        if(r && r.errors > 0) issues.push('Masih ada ' + r.errors + ' error validasi data');
      } catch(e){}
    }
    return { ok: issues.length === 0, issues, counts };
  }
  function exportSyncReport(){
    const report = {
      createdAt: nowIso(),
      pending: readJson(LS_PENDING_SYNC, null),
      events: readJson(LS_SYNC_EVENTS, []),
      counts: getCounts(),
      online: navigator.onLine
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type:'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'BM4-sync-report-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }
  function ensurePanel(){
    if(panel) return panel;
    panel = document.createElement('div');
    panel.id = 'bm4-sync-panel';
    panel.className = 'bm4-sync-panel';
    panel.innerHTML = '<div class="bm4-sync-card"><div class="bm4-sync-head"><div><b>🔁 Sync & Backup</b><span>Monitoring keamanan sinkron</span></div><button data-close>×</button></div><div class="bm4-sync-body" id="bm4-sync-body"></div><div class="bm4-sync-actions"><button data-preflight>✅ Cek Sync</button><button data-backup>📦 Backup Lokal</button><button data-export>📤 Export Report</button></div></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', e => { if(e.target === panel || e.target.dataset.close !== undefined) panel.classList.remove('open'); });
    panel.querySelector('[data-preflight]').onclick = () => {
      const p = preflight();
      addEvent(p.ok ? 'preflight_ok' : 'preflight_warning', { issues:p.issues, counts:p.counts });
      toast(p.ok ? '✅ Sync siap' : '⚠ Ada catatan sync');
      renderPanel();
    };
    panel.querySelector('[data-backup]').onclick = () => {
      snapshot('manual_sync_panel_backup');
      if(window.BM4Stability && typeof window.BM4Stability.exportSnapshot === 'function') window.BM4Stability.exportSnapshot();
      addEvent('manual_backup', { counts:getCounts() });
    };
    panel.querySelector('[data-export]').onclick = exportSyncReport;
    return panel;
  }
  function renderPanel(){
    if(!panel) return;
    const body = panel.querySelector('#bm4-sync-body');
    if(!body) return;
    const pending = readJson(LS_PENDING_SYNC, null);
    const events = readJson(LS_SYNC_EVENTS, []);
    const pf = preflight();
    body.innerHTML = '<div class="bm4-sync-status '+(pf.ok?'ok':'warn')+'"><b>'+(pf.ok?'Siap sync':'Perlu dicek')+'</b><span>'+(pf.ok?'Tidak ada masalah utama terdeteksi.':pf.issues.map(x=>'• '+x).join('<br>'))+'</span></div>'+
      '<div class="bm4-sync-grid"><div><span>Perumahan</span><b>'+pf.counts.perumahan+'</b></div><div><span>POI</span><b>'+pf.counts.poi+'</b></div><div><span>Target</span><b>'+pf.counts.targetPasar+'</b></div></div>'+
      '<div class="bm4-sync-pending"><b>Pending sync:</b> '+(pending && pending.active ? ('Aktif sejak '+fmtTime(pending.time)) : 'Tidak ada')+'</div>'+
      '<div class="bm4-sync-log">'+(events.length?events.slice(0,8).map(ev=>'<div><b>'+ev.type+'</b><span>'+fmtTime(ev.time)+'</span></div>').join(''):'<em>Belum ada event sync.</em>')+'</div>';
  }
  function openPanel(){ ensurePanel(); renderPanel(); panel.classList.add('open'); }
  function attachButton(){
    const right = document.querySelector('.tb-right');
    if(!right || document.getElementById('bm4-sync-panel-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'bm4-sync-panel-btn';
    btn.className = 'tb-btn bm4-sync-btn';
    btn.type = 'button';
    btn.textContent = '🔁 Sync';
    btn.onclick = openPanel;
    right.insertBefore(btn, right.firstChild);
  }
  function wrapSync(){
    if(typeof window.syncEditorNow !== 'function' || window.syncEditorNow.__bm4SyncImproved) return;
    const old = window.syncEditorNow;
    const wrapped = async function(){
      const pf = preflight();
      if(!pf.ok){
        addEvent('sync_blocked_preflight', { issues:pf.issues, counts:pf.counts });
        openPanel();
        toast('⚠ Sync belum aman. Cek panel Sync.');
        return;
      }
      snapshot('before_sync');
      markPending('editor_sync');
      addEvent('sync_started', { counts:pf.counts });
      setStatus('loading', 'Sync berjalan... backup lokal sudah dibuat');
      try {
        const result = await old.apply(this, arguments);
        clearPending('sync_called');
        addEvent('sync_called', { counts:getCounts() });
        snapshot('after_sync_call');
        return result;
      } catch(e){
        addEvent('sync_error', { message:e.message, counts:getCounts() });
        setStatus('offline', 'Sync error: ' + e.message);
        throw e;
      }
    };
    wrapped.__bm4SyncImproved = true;
    window.syncEditorNow = wrapped;
  }
  function init(){
    ensurePanel();
    attachButton();
    wrapSync();
    setInterval(() => { attachButton(); wrapSync(); renderPanel(); }, 1800);
    window.BM4SyncSafety = { preflight, openPanel, exportSyncReport, markPending, clearPending, addEvent };
    console.log('%cBM4 Sync & Backup Improvement active', 'color:#059669;font-weight:bold');
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
