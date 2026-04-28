// ============================================================
// patch-006-test-center.js
// BM4 Test Center: checklist UAT di dalam aplikasi.
// Membantu testing sebelum dipakai tim tanpa mengubah data.
// ============================================================
(function(window, document){
  const PATCH_ID = 'patch-006-test-center';
  if(window[PATCH_ID]) return;
  window[PATCH_ID] = true;

  const LS_KEY = 'bm4_test_center_v1';
  const TESTS = [
    { id:'login', group:'Akses', label:'Login akun lama berhasil' },
    { id:'project', group:'Akses', label:'Pilih proyek berhasil' },
    { id:'dashboard', group:'Dashboard', label:'Dashboard tampil dan angka utama terbaca' },
    { id:'map', group:'Analisa', label:'Peta Analisa Lokasi tampil' },
    { id:'markers', group:'Analisa', label:'Marker perumahan dan POI tampil' },
    { id:'ranking', group:'Analisa', label:'Ranking dan filter jalan' },
    { id:'detail', group:'Analisa', label:'Detail perumahan / Vs Anchor bisa dibuka' },
    { id:'tapera', group:'Tapera', label:'Tab Tapera/Sikumbang/Performance bisa dibuka' },
    { id:'editor-open', group:'Editor', label:'Editor Data bisa dibuka' },
    { id:'editor-check', group:'Editor', label:'Tombol Cek Data tidak menemukan error fatal' },
    { id:'editor-add', group:'Editor', label:'Tambah/edit perumahan/POI tersimpan lokal' },
    { id:'sync-panel', group:'Sync', label:'Panel Sync menampilkan status siap' },
    { id:'local-backup', group:'Backup', label:'Backup lokal JSON berhasil diunduh' },
    { id:'refresh-cache', group:'Stabilitas', label:'Setelah refresh, data lokal tetap ada' },
    { id:'offline', group:'Stabilitas', label:'Offline guard memberi warning saat koneksi putus' },
    { id:'role-tabs', group:'User', label:'Tab mengikuti akses role akun' },
    { id:'export', group:'Laporan', label:'Export/PDF/CSV utama yang tersedia bisa dipakai' }
  ];
  let modal = null;

  function nowIso(){ return new Date().toISOString(); }
  function readState(){ try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch(e){ return {}; } }
  function writeState(s){ try { localStorage.setItem(LS_KEY, JSON.stringify(s || {})); } catch(e){} }
  function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(msg){ if(typeof showToast === 'function') showToast(msg); else console.log('[BM4]', msg); }

  function setResult(id, result){
    const st = readState();
    st[id] = Object.assign(st[id] || {}, { result: result, time: nowIso() });
    writeState(st);
    render();
  }
  function setNote(id, note){
    const st = readState();
    st[id] = Object.assign(st[id] || {}, { note: note, noteTime: nowIso() });
    writeState(st);
  }
  function summary(){
    const st = readState();
    const passed = TESTS.filter(t => st[t.id] && st[t.id].result === 'pass').length;
    const failed = TESTS.filter(t => st[t.id] && st[t.id].result === 'fail').length;
    const skipped = TESTS.filter(t => st[t.id] && st[t.id].result === 'skip').length;
    const todo = TESTS.length - passed - failed - skipped;
    return { total:TESTS.length, passed, failed, skipped, todo };
  }
  function groupTests(){
    const groups = {};
    TESTS.forEach(t => { (groups[t.group] = groups[t.group] || []).push(t); });
    return groups;
  }
  function exportCsv(){
    const st = readState();
    const rows = ['Group,Item,Result,Time,Note'].concat(TESTS.map(t => {
      const r = st[t.id] || {};
      return [t.group,t.label,r.result||'',r.time||'',r.note||''].map(v => '"'+String(v).replace(/"/g,'""')+'"').join(',');
    }));
    const blob = new Blob(['\ufeff'+rows.join('\n')], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'BM4-UAT-checklist-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }
  function reset(){
    if(confirm('Reset checklist UAT?')){ localStorage.removeItem(LS_KEY); render(); toast('Checklist direset'); }
  }
  function ensureModal(){
    if(modal) return modal;
    modal = document.createElement('div');
    modal.id = 'bm4-test-center';
    modal.className = 'bm4-test-center';
    modal.innerHTML = '<div class="bm4-test-card"><div class="bm4-test-head"><div><b>🧪 Test Center BM4</b><span>Checklist siap pakai sebelum tim mencoba</span></div><button data-close>×</button></div><div id="bm4-test-summary" class="bm4-test-summary"></div><div id="bm4-test-body" class="bm4-test-body"></div><div class="bm4-test-actions"><button data-export>📤 Export CSV</button><button data-reset>Reset</button></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if(e.target === modal || e.target.dataset.close !== undefined) modal.classList.remove('open'); });
    modal.querySelector('[data-export]').onclick = exportCsv;
    modal.querySelector('[data-reset]').onclick = reset;
    return modal;
  }
  function render(){
    if(!modal) return;
    const st = readState();
    const sm = summary();
    modal.querySelector('#bm4-test-summary').innerHTML = '<div><span>Total</span><b>'+sm.total+'</b></div><div class="pass"><span>Lulus</span><b>'+sm.passed+'</b></div><div class="fail"><span>Gagal</span><b>'+sm.failed+'</b></div><div><span>Belum</span><b>'+sm.todo+'</b></div>';
    const groups = groupTests();
    modal.querySelector('#bm4-test-body').innerHTML = Object.keys(groups).map(g => {
      return '<div class="bm4-test-group"><h4>'+esc(g)+'</h4>'+groups[g].map(t => {
        const r = st[t.id] || {};
        const cls = r.result || 'todo';
        return '<div class="bm4-test-row '+cls+'" data-id="'+esc(t.id)+'"><div class="bm4-test-main"><b>'+esc(t.label)+'</b><textarea placeholder="Catatan opsional...">'+esc(r.note||'')+'</textarea></div><div class="bm4-test-row-actions"><button data-result="pass">✓</button><button data-result="fail">✕</button><button data-result="skip">—</button></div></div>';
      }).join('')+'</div>';
    }).join('');
    modal.querySelectorAll('[data-result]').forEach(btn => btn.onclick = e => {
      const row = e.target.closest('[data-id]'); if(row) setResult(row.dataset.id, e.target.dataset.result);
    });
    modal.querySelectorAll('textarea').forEach(t => t.onchange = e => {
      const row = e.target.closest('[data-id]'); if(row) setNote(row.dataset.id, e.target.value);
    });
  }
  function open(){ ensureModal(); render(); modal.classList.add('open'); }
  function attachButton(){
    const right = document.querySelector('.tb-right');
    if(!right || document.getElementById('bm4-test-center-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'bm4-test-center-btn';
    btn.className = 'tb-btn bm4-test-btn';
    btn.type = 'button';
    btn.textContent = '🧪 Test';
    btn.onclick = open;
    right.insertBefore(btn, right.firstChild);
  }
  function init(){
    ensureModal();
    attachButton();
    setInterval(attachButton, 2000);
    window.BM4TestCenter = { open, exportCsv, summary, reset };
    console.log('%cBM4 Test Center active', 'color:#7C3AED;font-weight:bold');
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
