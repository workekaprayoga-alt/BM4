// ============================================================
// BM4 Patch Loader
// Memuat patch terpisah secara berurutan supaya update kecil aman
// dan mudah rollback.
// ============================================================
(function(window, document){
  const loaded = new Set();
  const failed = [];
  const version = window.BM4_PATCH_VERSION || ('patch-' + Date.now());

  function log(){
    try { console.log.apply(console, ['%cBM4 PatchLoader', 'color:#2563EB;font-weight:bold;', ...arguments]); } catch(e){}
  }

  function addCss(href){
    return new Promise(resolve => {
      if(!href) return resolve();
      if(document.querySelector('link[data-bm4-patch-css="' + href + '"]')) return resolve();
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href + (href.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(version);
      link.dataset.bm4PatchCss = href;
      link.onload = () => resolve();
      link.onerror = () => { failed.push({ type:'css', href }); resolve(); };
      document.head.appendChild(link);
    });
  }

  function addScript(src){
    return new Promise((resolve, reject) => {
      if(!src) return resolve();
      if(document.querySelector('script[data-bm4-patch-src="' + src + '"]')) return resolve();
      const s = document.createElement('script');
      s.src = src + (src.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(version);
      s.dataset.bm4PatchSrc = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Gagal load patch: ' + src));
      document.body.appendChild(s);
    });
  }

  function isDependencyReady(patch){
    const deps = patch.dependsOn || [];
    return deps.every(id => loaded.has(id));
  }

  async function loadPatch(patch){
    if(!patch || patch.enabled === false) return;
    if(loaded.has(patch.id)) return;
    if(!isDependencyReady(patch)){
      throw new Error('Dependency belum siap untuk ' + patch.id + ': ' + (patch.dependsOn || []).join(', '));
    }
    await addCss(patch.css);
    await addScript(patch.file);
    loaded.add(patch.id);
    log('Loaded:', patch.id, patch.version || '');
  }

  async function loadAll(){
    const patches = Array.isArray(window.BM4_PATCHES) ? window.BM4_PATCHES : [];
    for(const patch of patches){
      if(patch.enabled === false){ log('Skipped:', patch.id); continue; }
      try { await loadPatch(patch); }
      catch(e){
        failed.push({ type:'js', id: patch.id, message: e.message });
        console.error('[BM4 PatchLoader]', e);
        if(window.setSyncStatus) window.setSyncStatus('offline', 'Patch gagal: ' + patch.id);
      }
    }
    window.BM4PatchStatus = {
      loaded: Array.from(loaded),
      failed,
      version,
      patches
    };
    if(failed.length) log('Finished with failed patches:', failed);
    else log('All enabled patches loaded');
  }

  window.BM4PatchLoader = { loadAll, loaded, failed };

  // Loader dipanggil otomatis saat core selesai dibaca.
  if(document.readyState === 'loading'){
    // Tetap boleh load sebelum DOMContentLoaded karena patch umumnya punya guard/setTimeout sendiri.
    loadAll();
  } else {
    loadAll();
  }
})(window, document);
