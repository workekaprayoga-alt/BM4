// ============================================================
// BM4 Patch Template
// Copy file ini menjadi patch-XXX-nama-fitur.js lalu aktifkan di patch-registry.js
// ============================================================
(function(window, document){
  const PATCH_ID = 'patch-XXX-nama-fitur';
  if(window[PATCH_ID]) return;
  window[PATCH_ID] = true;

  function init(){
    // 1. Cek dependency
    // 2. Tambah menu / tombol / event listener
    // 3. Jangan hapus data lama
    // 4. Pastikan patch aman kalau dijalankan dua kali
    console.log(PATCH_ID, 'ready');
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
