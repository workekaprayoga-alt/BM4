// ============================================================
// patch-009-rc-polish-guard.js
// Finishing ringan untuk RC: badge versi, beforeunload guard,
// global error capture, dan indikator patch status.
// ============================================================
(function(window, document){
  const PATCH_ID = 'patch-009-rc-polish-guard';
  if(window[PATCH_ID]) return;
  window[PATCH_ID] = true;
  const LS_ERRORS = 'bm4_stability_errors_v1';
  function readJson(k,fb){try{return JSON.parse(localStorage.getItem(k)||'')}catch(e){return fb}}
  function writeJson(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}
  function logError(context, message, stack){
    const list = readJson(LS_ERRORS, []);
    list.unshift({ at:new Date().toISOString(), context, message:String(message||''), stack:String(stack||'').slice(0,3000), href:location.href });
    writeJson(LS_ERRORS, list.slice(0,50));
  }
  function attachBadge(){
    if(document.getElementById('bm4-rc-badge')) return;
    const brand = document.querySelector('.tb-brand') || document.querySelector('.tb-left');
    if(!brand) return;
    const badge = document.createElement('span'); badge.id='bm4-rc-badge'; badge.className='bm4-rc-badge'; badge.textContent='v11 RC';
    brand.parentNode.insertBefore(badge, brand.nextSibling);
  }
  function pendingSyncActive(){
    const p = readJson('bm4_pending_sync_v1', null);
    return !!(p && p.active);
  }
  function attachBeforeUnload(){
    if(window.__bm4RcBeforeUnload) return; window.__bm4RcBeforeUnload = true;
    window.addEventListener('beforeunload', function(e){
      if(pendingSyncActive()){
        e.preventDefault();
        e.returnValue = 'Masih ada pending sync. Pastikan sudah backup/sync sebelum keluar.';
        return e.returnValue;
      }
    });
  }
  function attachErrorCapture(){
    if(window.__bm4RcErrorCapture) return; window.__bm4RcErrorCapture = true;
    window.addEventListener('error', e => logError('window.error', e.message, e.error && e.error.stack));
    window.addEventListener('unhandledrejection', e => logError('unhandledrejection', e.reason && (e.reason.message || e.reason), e.reason && e.reason.stack));
  }
  function summarize(){
    const st = window.BM4PatchStatus || {}; const loaded=(st.loaded||[]).length; const failed=(st.failed||[]).length;
    const el = document.getElementById('bm4-rc-badge');
    if(el){ el.title = loaded+' patch aktif, '+failed+' gagal'; el.classList.toggle('has-failed', failed>0); }
  }
  function init(){ attachBadge(); attachBeforeUnload(); attachErrorCapture(); setInterval(()=>{attachBadge(); summarize();},1500); console.log('%cBM4 v11 RC Polish Guard active','color:#1C2B4A;font-weight:bold'); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
