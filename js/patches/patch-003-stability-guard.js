// ============================================================
// patch-003-stability-guard.js
// BM4 Stability Guard: checkpoint lokal, error log, offline guard,
// export/pulihkan cadangan tanpa mengubah data Google Sheet.
// ============================================================
(function(window, document){
  const PATCH_ID = 'patch-003-stability-guard';
  if(window[PATCH_ID]) return;
  window[PATCH_ID] = true;

  const LS_CHECKPOINTS = 'bm4_stability_checkpoints_v1';
  const LS_ERRORS = 'bm4_stability_errors_v1';
  const MAX_CHECKPOINTS = 12;
  const MAX_ERRORS = 50;
  let lastCheckpointAt = 0;
  let panelOpen = false;

  function safeJsonParse(str, fallback){
    try { return JSON.parse(str); } catch(e){ return fallback; }
  }

  function readList(key){
    try { return safeJsonParse(localStorage.getItem(key) || '[]', []); }
    catch(e){ return []; }
  }

  function writeList(key, list, max){
    try { localStorage.setItem(key, JSON.stringify((list || []).slice(0, max || 20))); }
    catch(e){
      // localStorage penuh: buang item paling lama lalu retry sekali.
      try {
        const shorter = (list || []).slice(0, Math.max(3, Math.floor((max || 20) / 2)));
        localStorage.setItem(key, JSON.stringify(shorter));
      } catch(_) {}
    }
  }

  function toast(msg, type){
    if(typeof showToast === 'function') return showToast(msg);
    try { console[type === 'err' ? 'error' : 'log']('[BM4]', msg); } catch(e){}
  }

  function setStatus(state, detail){
    if(typeof setSyncStatus === 'function') setSyncStatus(state, detail);
  }

  function cloneSafe(value){
    try { return JSON.parse(JSON.stringify(value)); }
    catch(e){ return null; }
  }

  function getVar(name, fallback){
    try {
      // eslint-disable-next-line no-new-func
      const v = Function('fallback', 'try { return (typeof ' + name + ' !== "undefined") ? ' + name + ' : fallback; } catch(e){ return fallback; }')(fallback);
      return v;
    } catch(e){ return fallback; }
  }

  function setVar(name, value){
    try {
      // eslint-disable-next-line no-new-func
      Function('value', 'try { if (typeof ' + name + ' !== "undefined") { ' + name + ' = value; return true; } } catch(e){} return false;')(value);
    } catch(e){}
  }

  function collectSnapshot(reason){
    const snapshot = {
      version: 'v10.4-stability-pack',
      reason: reason || 'manual',
      createdAt: new Date().toISOString(),
      url: location.href,
      userAgent: navigator.userAgent,
      counts: {},
      data: {},
      localStorageKeys: {}
    };

    const perumahan = getVar('perumahan', []);
    const poi = getVar('poi', []);
    const tpTargets = getVar('tpTargets', []);
    const proyek = getVar('PROYEK_LIST', []);
    const formula = getVar('FORMULA', null);
    const vsaSections = getVar('VSA_SECTIONS', null);
    const pdlWeights = getVar('PDL_WEIGHTS', null);

    snapshot.data.perumahan = Array.isArray(perumahan) ? cloneSafe(perumahan) : [];
    snapshot.data.poi = Array.isArray(poi) ? cloneSafe(poi) : [];
    snapshot.data.tpTargets = Array.isArray(tpTargets) ? cloneSafe(tpTargets) : [];
    snapshot.data.PROYEK_LIST = Array.isArray(proyek) ? cloneSafe(proyek) : [];
    snapshot.data.FORMULA = cloneSafe(formula);
    snapshot.data.VSA_SECTIONS = cloneSafe(vsaSections);
    snapshot.data.PDL_WEIGHTS = cloneSafe(pdlWeights);

    snapshot.counts = {
      perumahan: snapshot.data.perumahan.length,
      poi: snapshot.data.poi.length,
      tpTargets: snapshot.data.tpTargets.length,
      projects: snapshot.data.PROYEK_LIST.length
    };

    const importantKeys = [
      'bm4_data','bm4_tp_targets','bm4_projects','bm4_formula','bm4_pdl_weights',
      'bm4_vsa_sections','bm4_fm_state','bm4_accounts','bm4_logs','bm4_app_state'
    ];
    importantKeys.forEach(k => {
      try {
        const raw = localStorage.getItem(k);
        if(raw !== null) snapshot.localStorageKeys[k] = raw;
      } catch(e){}
    });
    return snapshot;
  }

  function saveCheckpoint(reason, opts){
    opts = opts || {};
    const now = Date.now();
    if(!opts.force && now - lastCheckpointAt < 20000) return null;
    lastCheckpointAt = now;

    const cp = collectSnapshot(reason || 'auto');
    const list = readList(LS_CHECKPOINTS);
    list.unshift(cp);
    writeList(LS_CHECKPOINTS, list, MAX_CHECKPOINTS);
    refreshPanel();
    return cp;
  }

  function getCheckpoints(){ return readList(LS_CHECKPOINTS); }

  function downloadBlob(filename, content, type){
    const blob = new Blob([content], { type: type || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }

  function exportSnapshot(){
    const cp = saveCheckpoint('manual-export', { force: true }) || collectSnapshot('manual-export');
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    downloadBlob('BM4-backup-lokal-' + stamp + '.json', JSON.stringify(cp, null, 2));
    toast('📦 Backup lokal diunduh');
  }

  function exportAllCheckpoints(){
    const list = getCheckpoints();
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    downloadBlob('BM4-semua-checkpoint-' + stamp + '.json', JSON.stringify(list, null, 2));
    toast('📦 Semua checkpoint diunduh');
  }

  function restoreSnapshot(cp){
    if(!cp || !cp.data) return toast('Checkpoint tidak valid', 'err');
    const ok = confirm('Pulihkan data dari checkpoint lokal ini? Data di browser akan diganti, lalu halaman dimuat ulang. Google Sheet tidak langsung berubah sampai kamu klik Sync.');
    if(!ok) return;
    try {
      if(cp.data.perumahan && cp.data.poi){
        localStorage.setItem('bm4_data', JSON.stringify({ perumahan: cp.data.perumahan, poi: cp.data.poi }));
      }
      if(cp.data.tpTargets) localStorage.setItem('bm4_tp_targets', JSON.stringify(cp.data.tpTargets));
      if(cp.data.PROYEK_LIST) localStorage.setItem('bm4_projects', JSON.stringify(cp.data.PROYEK_LIST));
      if(cp.data.FORMULA) localStorage.setItem('bm4_formula', JSON.stringify(cp.data.FORMULA));
      if(cp.data.PDL_WEIGHTS) localStorage.setItem('bm4_pdl_weights', JSON.stringify(cp.data.PDL_WEIGHTS));
      if(cp.data.VSA_SECTIONS) localStorage.setItem('bm4_vsa_sections', JSON.stringify(cp.data.VSA_SECTIONS));
      toast('✅ Checkpoint dipulihkan, memuat ulang...');
      setTimeout(() => location.reload(), 700);
    } catch(e){
      logError('restoreSnapshot', e);
      toast('Gagal memulihkan checkpoint: ' + e.message, 'err');
    }
  }

  function logError(context, error, extra){
    const item = {
      at: new Date().toISOString(),
      context: context || 'unknown',
      message: error && error.message ? error.message : String(error || 'Unknown error'),
      stack: error && error.stack ? String(error.stack).slice(0, 4000) : '',
      extra: extra || null,
      href: location.href
    };
    const list = readList(LS_ERRORS);
    list.unshift(item);
    writeList(LS_ERRORS, list, MAX_ERRORS);
    refreshPanel();
    return item;
  }

  function getErrors(){ return readList(LS_ERRORS); }

  function clearErrors(){
    try { localStorage.removeItem(LS_ERRORS); } catch(e){}
    refreshPanel();
    toast('Log error lokal dibersihkan');
  }

  function createPanel(){
    if(document.getElementById('bm4-stability-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'bm4-stability-panel';
    panel.className = 'bm4-stab-panel';
    panel.innerHTML = '<div class="bm4-stab-head"><div><b>🛟 BM4 Stability Guard</b><span id="bm4-stab-sub">Cadangan lokal & error log</span></div><button id="bm4-stab-close">×</button></div><div class="bm4-stab-actions"><button data-act="checkpoint">Buat Checkpoint</button><button data-act="export">Download Backup</button><button data-act="export-all">Download Semua</button><button data-act="clear-errors">Bersihkan Error</button></div><div id="bm4-stab-body" class="bm4-stab-body"></div>';
    document.body.appendChild(panel);
    panel.querySelector('#bm4-stab-close').onclick = () => togglePanel(false);
    panel.querySelector('[data-act="checkpoint"]').onclick = () => { saveCheckpoint('manual', { force:true }); toast('✅ Checkpoint lokal dibuat'); };
    panel.querySelector('[data-act="export"]').onclick = exportSnapshot;
    panel.querySelector('[data-act="export-all"]').onclick = exportAllCheckpoints;
    panel.querySelector('[data-act="clear-errors"]').onclick = clearErrors;
    refreshPanel();
  }

  function togglePanel(force){
    createPanel();
    panelOpen = typeof force === 'boolean' ? force : !panelOpen;
    document.getElementById('bm4-stability-panel').classList.toggle('open', panelOpen);
    refreshPanel();
  }

  function attachTopbarButton(){
    if(document.getElementById('bm4-stability-btn')) return;
    const tbRight = document.querySelector('.tb-right');
    if(!tbRight) return;
    const btn = document.createElement('button');
    btn.id = 'bm4-stability-btn';
    btn.className = 'tb-btn bm4-stability-topbtn';
    btn.type = 'button';
    btn.textContent = '🛟 Stabilitas';
    btn.title = 'Checkpoint lokal, backup, dan error log';
    btn.onclick = () => togglePanel();
    tbRight.insertBefore(btn, tbRight.firstChild);
  }

  function fmtTime(iso){
    try { return new Date(iso).toLocaleString('id-ID', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
    catch(e){ return iso || '-'; }
  }

  function refreshPanel(){
    const body = document.getElementById('bm4-stab-body');
    if(!body) return;
    const cps = getCheckpoints();
    const errs = getErrors();
    const checkpointHtml = cps.length ? cps.slice(0,8).map((cp, idx) => {
      const c = cp.counts || {};
      return '<div class="bm4-stab-row"><div><b>' + fmtTime(cp.createdAt) + '</b><span>' + escapeHtmlLite(cp.reason || '-') + ' · ' + (c.perumahan||0) + ' perumahan · ' + (c.poi||0) + ' POI</span></div><button data-restore="' + idx + '">Pulihkan</button></div>';
    }).join('') : '<div class="bm4-stab-empty">Belum ada checkpoint.</div>';

    const errorHtml = errs.length ? errs.slice(0,6).map(e => {
      return '<div class="bm4-stab-error"><b>' + fmtTime(e.at) + ' · ' + escapeHtmlLite(e.context) + '</b><span>' + escapeHtmlLite(e.message) + '</span></div>';
    }).join('') : '<div class="bm4-stab-empty">Belum ada error tercatat.</div>';

    body.innerHTML = '<div class="bm4-stab-section"><div class="bm4-stab-title">Checkpoint Lokal</div>' + checkpointHtml + '</div><div class="bm4-stab-section"><div class="bm4-stab-title">Error Log Lokal</div>' + errorHtml + '</div>';
    body.querySelectorAll('[data-restore]').forEach(btn => {
      btn.onclick = () => restoreSnapshot(cps[Number(btn.dataset.restore)]);
    });
  }

  function escapeHtmlLite(s){
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function wrapFunctions(){
    if(typeof window.markDirtyAndPersist === 'function' && !window.markDirtyAndPersist.__bm4StabilityWrapped){
      const old = window.markDirtyAndPersist;
      const wrapped = function(){
        const res = old.apply(this, arguments);
        saveCheckpoint('auto-after-edit');
        return res;
      };
      wrapped.__bm4StabilityWrapped = true;
      window.markDirtyAndPersist = wrapped;
    }

    if(typeof window.syncEditorNow === 'function' && !window.syncEditorNow.__bm4StabilityWrapped){
      const oldSync = window.syncEditorNow;
      const wrappedSync = async function(){
        saveCheckpoint('before-sync', { force:true });
        setStatus('loading', 'Menyiapkan sync editor...');
        try {
          const result = await oldSync.apply(this, arguments);
          saveCheckpoint('after-sync-call', { force:true });
          return result;
        } catch(e){
          logError('syncEditorNow', e);
          setStatus('offline', 'Sync error: ' + e.message);
          toast('Sync error: ' + e.message, 'err');
          throw e;
        }
      };
      wrappedSync.__bm4StabilityWrapped = true;
      window.syncEditorNow = wrappedSync;
    }
  }

  function installOnlineGuard(){
    function update(){
      if(!navigator.onLine) setStatus('offline', 'Browser sedang offline. Data tetap aman di lokal.');
    }
    window.addEventListener('online', () => { setStatus('local', 'Online kembali. Cek data lalu sync.'); toast('🌐 Online kembali'); });
    window.addEventListener('offline', () => { setStatus('offline', 'Offline. Perubahan akan tetap disimpan lokal.'); toast('⚠ Offline. Perubahan disimpan lokal.'); });
    update();
  }

  function installBeforeUnloadGuard(){
    window.addEventListener('beforeunload', function(e){
      const state = getVar('editorState', null);
      if(state && state.dirty){
        saveCheckpoint('before-tab-close', { force:true });
        e.preventDefault();
        e.returnValue = 'Masih ada perubahan belum tersinkron. Tetap keluar?';
        return e.returnValue;
      }
    });
  }

  function installGlobalErrorLog(){
    window.addEventListener('error', e => {
      logError('window.onerror', e.error || e.message || 'error', { filename:e.filename, lineno:e.lineno, colno:e.colno });
    });
    window.addEventListener('unhandledrejection', e => {
      logError('unhandledrejection', e.reason || 'Promise rejection');
    });
  }

  function periodicCheckpoint(){
    setInterval(() => {
      const state = getVar('editorState', null);
      if(state && state.dirty) saveCheckpoint('auto-interval');
    }, 60000);
  }

  function init(){
    attachTopbarButton();
    createPanel();
    installOnlineGuard();
    installBeforeUnloadGuard();
    installGlobalErrorLog();
    periodicCheckpoint();
    wrapFunctions();
    setInterval(wrapFunctions, 2000);
    setTimeout(() => saveCheckpoint('startup', { force:true }), 2000);
    console.log('%cBM4 Stability Guard active', 'color:#059669;font-weight:bold');
  }

  window.BM4Stability = {
    saveCheckpoint,
    getCheckpoints,
    exportSnapshot,
    exportAllCheckpoints,
    restoreSnapshot,
    logError,
    getErrors,
    clearErrors,
    collectSnapshot,
    openPanel: () => togglePanel(true),
    closePanel: () => togglePanel(false)
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
