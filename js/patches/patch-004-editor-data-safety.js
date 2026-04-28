// ============================================================
// patch-004-editor-data-safety.js
// Validasi data editor sebelum sync: cegah nama kosong, koordinat salah,
// duplikat, dan angka negatif masuk ke data final.
// ============================================================
(function(window, document){
  const PATCH_ID = 'patch-004-editor-data-safety';
  if(window[PATCH_ID]) return;
  window[PATCH_ID] = true;

  const LAT_MIN = -11.5, LAT_MAX = 6.5, LNG_MIN = 94.5, LNG_MAX = 141.5;
  let lastReport = null;

  function getVar(name, fallback){
    try {
      // eslint-disable-next-line no-new-func
      return Function('fallback', 'try { return (typeof ' + name + ' !== "undefined") ? ' + name + ' : fallback; } catch(e){ return fallback; }')(fallback);
    } catch(e){ return fallback; }
  }

  function toast(msg, type){
    if(typeof showToast === 'function') return showToast(msg);
    console[type === 'err' ? 'error' : 'log']('[BM4]', msg);
  }

  function esc(s){ return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function norm(s){ return String(s || '').trim().toLowerCase().replace(/\s+/g,' '); }
  function isNum(n){ return typeof n === 'number' && isFinite(n); }
  function toNum(v){ const n = Number(v); return isFinite(n) ? n : NaN; }

  function addIssue(list, severity, module, index, field, message, value){
    list.push({ severity, module, index, field, message, value });
  }

  function validatePerumahan(rows, issues){
    const ids = new Map();
    const names = new Map();
    (rows || []).forEach((p, i) => {
      const idx = i + 1;
      const id = norm(p.id);
      const nama = norm(p.nama);
      if(!id) addIssue(issues, 'error', 'Perumahan', idx, 'id', 'ID kosong', p.id);
      else if(ids.has(id)) addIssue(issues, 'error', 'Perumahan', idx, 'id', 'ID duplikat dengan baris ' + ids.get(id), p.id);
      else ids.set(id, idx);

      if(!nama) addIssue(issues, 'error', 'Perumahan', idx, 'nama', 'Nama perumahan kosong', p.nama);
      else if(names.has(nama)) addIssue(issues, 'warning', 'Perumahan', idx, 'nama', 'Nama mirip/duplikat dengan baris ' + names.get(nama), p.nama);
      else names.set(nama, idx);

      const lat = toNum(p.lat), lng = toNum(p.lng);
      if(!isNum(lat) || lat < LAT_MIN || lat > LAT_MAX) addIssue(issues, 'error', 'Perumahan', idx, 'lat', 'Latitude tidak valid / di luar Indonesia', p.lat);
      if(!isNum(lng) || lng < LNG_MIN || lng > LNG_MAX) addIssue(issues, 'error', 'Perumahan', idx, 'lng', 'Longitude tidak valid / di luar Indonesia', p.lng);

      ['unit','realisasi','tahun','harga'].forEach(field => {
        if(p[field] === '' || p[field] == null) return;
        const n = toNum(p[field]);
        if(!isNaN(n) && n < 0) addIssue(issues, 'warning', 'Perumahan', idx, field, 'Angka tidak boleh negatif', p[field]);
      });
      if(p.tipe && !['subsidi','mix','komersil','nonsubsidi'].includes(String(p.tipe).toLowerCase())){
        addIssue(issues, 'warning', 'Perumahan', idx, 'tipe', 'Tipe tidak umum. Cek kembali.', p.tipe);
      }
    });
  }

  function validatePoi(rows, issues){
    const names = new Map();
    const allowedKat = ['rs','kampus','mall','tol','pemda','industri','publik'];
    (rows || []).forEach((p, i) => {
      const idx = i + 1;
      const nama = norm(p.nama);
      if(!nama) addIssue(issues, 'error', 'POI', idx, 'nama', 'Nama POI kosong', p.nama);
      else if(names.has(nama)) addIssue(issues, 'warning', 'POI', idx, 'nama', 'Nama POI duplikat dengan baris ' + names.get(nama), p.nama);
      else names.set(nama, idx);

      if(!p.kat || !allowedKat.includes(String(p.kat))) addIssue(issues, 'error', 'POI', idx, 'kategori', 'Kategori POI tidak valid', p.kat);
      const lat = toNum(p.lat), lng = toNum(p.lng);
      if(!isNum(lat) || lat < LAT_MIN || lat > LAT_MAX) addIssue(issues, 'error', 'POI', idx, 'lat', 'Latitude tidak valid / di luar Indonesia', p.lat);
      if(!isNum(lng) || lng < LNG_MIN || lng > LNG_MAX) addIssue(issues, 'error', 'POI', idx, 'lng', 'Longitude tidak valid / di luar Indonesia', p.lng);
    });
  }

  function validateAll(){
    const perumahan = getVar('perumahan', []);
    const poi = getVar('poi', []);
    const issues = [];
    validatePerumahan(perumahan, issues);
    validatePoi(poi, issues);
    const errors = issues.filter(x => x.severity === 'error').length;
    const warnings = issues.filter(x => x.severity === 'warning').length;
    lastReport = { at: new Date().toISOString(), errors, warnings, issues, counts:{ perumahan:(perumahan||[]).length, poi:(poi||[]).length } };
    return lastReport;
  }

  function reportHtml(report){
    const issues = report.issues || [];
    const summaryClass = report.errors ? 'bad' : (report.warnings ? 'warn' : 'ok');
    const rows = issues.length ? issues.slice(0,120).map(x => {
      return '<tr class="' + esc(x.severity) + '"><td>' + esc(x.severity) + '</td><td>' + esc(x.module) + '</td><td>' + esc(x.index) + '</td><td>' + esc(x.field) + '</td><td>' + esc(x.message) + '</td><td>' + esc(x.value) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="bm4-safe-empty">Tidak ada masalah besar. Data siap disimpan.</td></tr>';
    return '<div class="bm4-safe-summary ' + summaryClass + '"><b>' + (report.errors ? 'Ada data yang harus diperbaiki' : 'Data aman untuk sync') + '</b><span>' + report.errors + ' error · ' + report.warnings + ' warning · ' + report.counts.perumahan + ' perumahan · ' + report.counts.poi + ' POI</span></div><div class="bm4-safe-table-wrap"><table class="bm4-safe-table"><thead><tr><th>Level</th><th>Modul</th><th>Baris</th><th>Field</th><th>Masalah</th><th>Nilai</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function ensureModal(){
    let overlay = document.getElementById('bm4-data-safety-modal');
    if(overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'bm4-data-safety-modal';
    overlay.className = 'bm4-safe-overlay';
    overlay.innerHTML = '<div class="bm4-safe-modal"><div class="bm4-safe-head"><div><b>✅ Cek Keamanan Data</b><span>Validasi lokal sebelum sync ke Google Sheet</span></div><button data-close>×</button></div><div id="bm4-safe-body" class="bm4-safe-body"></div><div class="bm4-safe-foot"><button data-export>Download Report</button><button data-backup>Backup Lokal</button><button data-close>Tutup</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach(b => b.onclick = () => overlay.classList.remove('open'));
    overlay.querySelector('[data-export]').onclick = exportReport;
    overlay.querySelector('[data-backup]').onclick = () => {
      if(window.BM4Stability) window.BM4Stability.exportSnapshot();
    };
    overlay.addEventListener('click', e => { if(e.target === overlay) overlay.classList.remove('open'); });
    return overlay;
  }

  function showReport(report){
    report = report || validateAll();
    const overlay = ensureModal();
    overlay.querySelector('#bm4-safe-body').innerHTML = reportHtml(report);
    overlay.classList.add('open');
  }

  function exportReport(){
    const report = lastReport || validateAll();
    const csv = ['Level,Modul,Baris,Field,Masalah,Nilai'].concat((report.issues||[]).map(x => [x.severity,x.module,x.index,x.field,x.message,String(x.value||'').replace(/"/g,'""')].map(v => '"' + String(v).replace(/"/g,'""') + '"').join(','))).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'BM4-validasi-data-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }

  function attachEditorButtons(){
    const actions = document.querySelector('.editor-head-actions');
    if(!actions || document.getElementById('bm4-check-data-btn')) return;
    const checkBtn = document.createElement('button');
    checkBtn.id = 'bm4-check-data-btn';
    checkBtn.className = 'btn-sm-secondary bm4-safe-btn';
    checkBtn.type = 'button';
    checkBtn.textContent = '✅ Cek Data';
    checkBtn.onclick = () => showReport(validateAll());

    const backupBtn = document.createElement('button');
    backupBtn.id = 'bm4-local-backup-btn';
    backupBtn.className = 'btn-sm-secondary bm4-safe-btn';
    backupBtn.type = 'button';
    backupBtn.textContent = '📦 Backup Lokal';
    backupBtn.onclick = () => window.BM4Stability ? window.BM4Stability.exportSnapshot() : toast('Stability Guard belum aktif');

    actions.insertBefore(backupBtn, actions.firstChild);
    actions.insertBefore(checkBtn, backupBtn);
  }

  function wrapSyncValidation(){
    if(typeof window.syncEditorNow !== 'function' || window.syncEditorNow.__bm4SafetyWrapped) return;
    const old = window.syncEditorNow;
    const wrapped = async function(){
      const report = validateAll();
      if(report.errors > 0){
        showReport(report);
        toast('⚠ Sync dibatalkan. Perbaiki ' + report.errors + ' error data dulu.', 'err');
        return;
      }
      if(report.warnings > 0){
        const ok = confirm('Ada ' + report.warnings + ' warning data. Lanjut sync?');
        if(!ok){ showReport(report); return; }
      }
      return old.apply(this, arguments);
    };
    wrapped.__bm4SafetyWrapped = true;
    window.syncEditorNow = wrapped;
  }

  function init(){
    ensureModal();
    attachEditorButtons();
    wrapSyncValidation();
    setInterval(() => { attachEditorButtons(); wrapSyncValidation(); }, 1500);
    window.BM4DataSafety = { validateAll, showReport, exportReport };
    console.log('%cBM4 Editor Data Safety active', 'color:#D97706;font-weight:bold');
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
