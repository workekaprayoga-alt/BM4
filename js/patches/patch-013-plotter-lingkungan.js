/**
 * BM4 PATCH 013 — PLOTTER LINGKUNGAN ENHANCER
 *
 * Tujuan: Memudahkan plotting elemen lingkungan (gate, taman, pos satpam, dll)
 * via modal Plotter existing, dengan auto-prioritas + quick presets.
 *
 * Approach: NON-INVASIVE. Tidak modify 181-estate-module.js core. Hanya:
 *   1. Inject UI tambahan ke modal #plotter-modal (preset chips + checkbox prioritas)
 *   2. Hook ke proses save via observer/wrapper agar isPrioritas masuk ke payload
 *   3. Auto-suggest tipe berdasarkan nama (kalau user mulai ngetik "Pos" → fasum)
 *
 * Workflow user:
 *   1. Buka tab Siteplan → mode "📍 Plot Baru"
 *   2. Klik area kosong di siteplan (gate, taman, pos satpam, dll — bukan unit rumah)
 *   3. Modal muncul dengan tambahan:
 *      - Quick preset chips: 🚪 Gate | 🛡️ Pos Satpam | 🌿 Taman | 🛣️ Jalan | 🏛️ Ibadah | 🅿️ Parkir
 *      - Checkbox "⭐ Tandai sebagai area prioritas (akan dicek harian)"
 *      - Auto-pilih tipe + auto-check prioritas saat klik preset
 *   4. Save → isPrioritas ikut ke-save (via hook ke _blokList)
 *   5. Buka tab Setup Prioritas → langsung muncul di list prioritas tanpa toggle manual
 *
 * Idempotent — aman di-load berkali-kali.
 *
 * Dependency:
 *   - 181-estate-module.js (modal #plotter-modal, _blokList, plotterModalSave)
 */

(function(global){
  'use strict';

  if(global._patch013PlotterLingkunganLoaded) return;
  global._patch013PlotterLingkunganLoaded = true;

  // ============================================================
  // PRESET LINGKUNGAN
  // Setiap preset auto-fill nama + tipe + isPrioritas=true
  // ============================================================
  const PRESETS = [
    { id: 'gate',     icon: '🚪', label: 'Gate',         nama: 'Gate',          tipe: 'fasum',  prioritas: true },
    { id: 'pos',      icon: '🛡️', label: 'Pos Satpam',   nama: 'Pos Satpam',    tipe: 'fasum',  prioritas: true },
    { id: 'taman',    icon: '🌿', label: 'Taman',        nama: 'Taman',         tipe: 'taman',  prioritas: true },
    { id: 'bunderan', icon: '🔄', label: 'Bunderan',     nama: 'Bunderan',      tipe: 'jalan',  prioritas: true },
    { id: 'jalan',    icon: '🛣️', label: 'Jalan Utama',  nama: 'Jalan Utama',   tipe: 'jalan',  prioritas: true },
    { id: 'ibadah',   icon: '🏛️', label: 'Ibadah',       nama: 'Sarana Ibadah', tipe: 'fasum',  prioritas: true },
    { id: 'parkir',   icon: '🅿️', label: 'Parkir',       nama: 'Parkir',        tipe: 'fasum',  prioritas: true },
    { id: 'fasum',    icon: '🏢', label: 'Fasum Lain',   nama: 'Fasum',         tipe: 'fasum',  prioritas: true }
  ];

  // Auto-detect tipe dari kata kunci di nama (kalau user ngetik manual)
  const NAMA_KEYWORDS = [
    { keywords: ['gate', 'gerbang', 'pintu masuk'],         tipe: 'fasum',  prioritas: true },
    { keywords: ['pos satpam', 'pos jaga', 'security'],     tipe: 'fasum',  prioritas: true },
    { keywords: ['taman', 'park', 'green'],                 tipe: 'taman',  prioritas: true },
    { keywords: ['bunderan', 'roundabout'],                 tipe: 'jalan',  prioritas: true },
    { keywords: ['jalan utama', 'jalan raya', 'main road'], tipe: 'jalan',  prioritas: true },
    { keywords: ['masjid', 'mushola', 'gereja', 'ibadah'],  tipe: 'fasum',  prioritas: true },
    { keywords: ['parkir', 'parking'],                      tipe: 'fasum',  prioritas: true },
    { keywords: ['kolam', 'pool', 'sport'],                 tipe: 'fasum',  prioritas: true }
  ];

  // ============================================================
  // INJECT UI ENHANCEMENT KE MODAL
  // ============================================================
  function _enhanceModal(){
    const modal = document.getElementById('plotter-modal');
    if(!modal) return false;
    if(modal.dataset.patch013Enhanced === '1') return true;

    const body = modal.querySelector('.plotter-modal-body');
    if(!body) return false;

    // 1. Inject preset chips (di paling atas modal body)
    const presetWrap = document.createElement('div');
    presetWrap.className = 'p13-preset-wrap';
    presetWrap.innerHTML =
      '<div class="p13-preset-label">⚡ Quick Preset Lingkungan <span class="p13-preset-hint">(klik untuk auto-isi)</span></div>' +
      '<div class="p13-preset-chips">' +
        PRESETS.map(p =>
          '<button type="button" class="p13-preset-chip" data-preset="' + p.id + '">' +
            '<span class="p13-preset-chip-icon">' + p.icon + '</span>' +
            '<span class="p13-preset-chip-label">' + p.label + '</span>' +
          '</button>'
        ).join('') +
      '</div>';
    body.insertBefore(presetWrap, body.firstChild);

    // Bind click ke preset chips
    presetWrap.querySelectorAll('.p13-preset-chip').forEach(btn => {
      btn.addEventListener('click', function(){
        const presetId = this.dataset.preset;
        const preset = PRESETS.find(p => p.id === presetId);
        if(!preset) return;
        _applyPreset(preset);
        // Visual feedback: pulse animation
        this.classList.add('p13-preset-active');
        setTimeout(() => this.classList.remove('p13-preset-active'), 600);
      });
    });

    // 2. Inject checkbox "Set sebagai prioritas" (setelah field tipe)
    const tipeField = body.querySelector('.plotter-modal-field:has(#plotter-modal-tipe)') ||
                      Array.from(body.querySelectorAll('.plotter-modal-field')).find(f => f.querySelector('#plotter-modal-tipe'));
    if(tipeField){
      const prioField = document.createElement('div');
      prioField.className = 'plotter-modal-field p13-prio-field';
      prioField.innerHTML =
        '<label class="p13-prio-label">' +
          '<input type="checkbox" id="p13-prio-check">' +
          '<span class="p13-prio-text">' +
            '<strong>⭐ Tandai sebagai area prioritas</strong>' +
            '<small>Akan otomatis muncul di "Setup Prioritas" dan "Pengecekan Harian"</small>' +
          '</span>' +
        '</label>';
      tipeField.parentNode.insertBefore(prioField, tipeField.nextSibling);
    }

    // 3. Bind auto-detect saat user ketik nama
    const namaInput = document.getElementById('plotter-modal-nama');
    if(namaInput){
      namaInput.addEventListener('input', _onNamaInput);
    }

    // 4. Bind auto-check prioritas saat tipe berubah ke non-rumah
    const tipeSelect = document.getElementById('plotter-modal-tipe');
    if(tipeSelect){
      tipeSelect.addEventListener('change', _onTipeChange);
    }

    modal.dataset.patch013Enhanced = '1';
    console.log('[patch-013] modal plotter enhanced');
    return true;
  }

  // ============================================================
  // INTERAKSI
  // ============================================================
  function _applyPreset(preset){
    const namaInput = document.getElementById('plotter-modal-nama');
    const tipeSelect = document.getElementById('plotter-modal-tipe');
    const prioCheck = document.getElementById('p13-prio-check');

    // Cuma auto-fill nama kalau masih kosong (jangan timpa input user)
    if(namaInput && !namaInput.value.trim()){
      namaInput.value = preset.nama;
      namaInput.focus();
      // Select all biar user gampang ganti suffix (mis. "Gate" → "Gate Utara")
      try { namaInput.select(); } catch(_){}
    }
    if(tipeSelect) tipeSelect.value = preset.tipe;
    if(prioCheck) prioCheck.checked = !!preset.prioritas;
  }

  function _onNamaInput(e){
    const nama = String(e.target.value || '').toLowerCase().trim();
    if(!nama || nama.length < 3) return;

    const tipeSelect = document.getElementById('plotter-modal-tipe');
    const prioCheck = document.getElementById('p13-prio-check');
    if(!tipeSelect) return;

    // Hanya auto-suggest kalau tipe masih default 'rumah' (jangan timpa pilihan user)
    if(tipeSelect.value !== 'rumah') return;

    // Cek match dengan keywords
    for(const k of NAMA_KEYWORDS){
      if(k.keywords.some(kw => nama.indexOf(kw) >= 0)){
        tipeSelect.value = k.tipe;
        if(prioCheck && k.prioritas) prioCheck.checked = true;
        // Visual flash to indicate auto-detect
        tipeSelect.classList.add('p13-auto-detected');
        setTimeout(() => tipeSelect.classList.remove('p13-auto-detected'), 800);
        break;
      }
    }
  }

  function _onTipeChange(e){
    const tipe = e.target.value;
    const prioCheck = document.getElementById('p13-prio-check');
    if(!prioCheck) return;
    // Auto-check prioritas saat tipe lingkungan, auto-uncheck saat balik ke rumah
    if(tipe === 'rumah'){
      prioCheck.checked = false;
    } else if(tipe === 'fasum' || tipe === 'taman' || tipe === 'jalan'){
      prioCheck.checked = true;
    }
    // Tipe 'kosong' tidak auto-toggle (user decide)
  }

  // ============================================================
  // HOOK SAVE — agar isPrioritas masuk ke _blokList saat save
  //
  // Strategi: monkey-patch global.plotterModalSave
  // - Sebelum panggil original: simpan state checkbox prioritas
  // - Setelah original selesai: cari blok terbaru yang baru ditambah/edit,
  //   inject isPrioritas + prioritasNote, tandai _dirty = true
  // ============================================================
  function _hookSave(){
    if(typeof global.plotterModalSave !== 'function'){
      console.warn('[patch-013] plotterModalSave belum tersedia, retry...');
      return false;
    }
    if(global.plotterModalSave._patch013Hooked) return true;

    const original = global.plotterModalSave;

    global.plotterModalSave = function(continuePlot){
      // Capture state SEBELUM panggil original (karena modal akan di-close & state hilang)
      const prioCheck = document.getElementById('p13-prio-check');
      const isPrioritas = !!(prioCheck && prioCheck.checked);
      const namaInput = document.getElementById('plotter-modal-nama');
      const namaSnapshot = (namaInput && namaInput.value || '').trim();

      // Cek apakah ini edit atau plot baru
      // _editingBlokId = closure private di estate-module, tidak bisa diakses langsung.
      // Workaround: cek visibility tombol delete (hanya muncul saat edit).
      const deleteBtn = document.getElementById('plotter-modal-delete');
      const isEditing = deleteBtn && deleteBtn.style.display !== 'none';

      // Capture id blok yang sedang di-edit dari context (best-effort)
      // Karena _editingBlokId private, kita identify by nama unik di list.

      // Panggil original — ini akan modify _blokList dan close modal
      const result = original.apply(this, arguments);

      // Setelah original selesai, find blok yang baru di-touch
      // Scenario:
      //  - PLOT BARU: cari blok dengan _new=true, _dirty=true, nama matching
      //  - EDIT:      cari blok dengan _dirty=true, nama matching
      try {
        // Akses _blokList via expose helper. Karena ngga di-expose,
        // kita pakai approach: query DOM canvas untuk blok terbaru.
        // Atau lebih reliable: pakai window._estateBlokListAccess.
        // Plan B: fire custom event yang akan di-listen oleh estate-module
        // untuk inject isPrioritas. Tapi yang paling simple & robust:
        //
        // Approach final: kita PATCH _blokList via window patch helper
        // yang dipanggil dari sini.
        _patchLatestBlok(namaSnapshot, isPrioritas, isEditing);
      } catch(e){
        console.warn('[patch-013] gagal patch isPrioritas:', e);
      }

      return result;
    };
    global.plotterModalSave._patch013Hooked = true;
    console.log('[patch-013] plotterModalSave hooked');
    return true;
  }

  /**
   * Patch field isPrioritas pada blok yang baru di-save.
   * Karena _blokList private di estate-module, kita pakai dual approach:
   *  1. Cari helper window._patch013SetPrioritas (kalau ada)
   *  2. Fallback: emit DOM event 'patch013:set-prioritas' yang akan di-handle
   *     oleh shim yang kita inject ke estate-module space.
   *
   * Karena option 2 butuh modify estate-module, kita pakai approach lain
   * yang TIDAK butuh modify core: re-fetch state dari server saat save.
   *
   * BUT — kita ngga mau re-fetch karena lambat dan blok belum tentu
   * tersinkron ke server (masih draft).
   *
   * Approach terbaik: hook tombol "Save Semua" untuk inject isPrioritas
   * ke payload bulkSaveEstateBlok TEPAT sebelum dikirim ke server.
   *
   * Implementasi: kita simpan map { namaSnapshot: isPrioritas } di state
   * patch-013, lalu intercept BM4Api.post saat action='bulkSaveEstateBlok'
   * untuk inject isPrioritas ke payload.
   */
  function _patchLatestBlok(nama, isPrioritas, isEditing){
    if(!nama) return;
    // Simpan ke pending map — akan di-apply saat bulk save
    _pendingPrioritas[nama.toLowerCase()] = {
      isPrioritas: isPrioritas,
      timestamp: Date.now()
    };
    console.log('[patch-013] pending isPrioritas for "' + nama + '":', isPrioritas);
  }

  const _pendingPrioritas = {};

  // ============================================================
  // HOOK BM4Api.post agar bulkSaveEstateBlok inject isPrioritas
  // ============================================================
  function _hookBulkSave(){
    if(!global.BM4Api || typeof global.BM4Api.post !== 'function'){
      console.warn('[patch-013] BM4Api belum ada, retry...');
      return false;
    }
    if(global.BM4Api.post._patch013Hooked) return true;

    const originalPost = global.BM4Api.post.bind(global.BM4Api);

    global.BM4Api.post = function(action, payload){
      // Inject isPrioritas hanya untuk bulkSaveEstateBlok
      if(action === 'bulkSaveEstateBlok' && payload && Array.isArray(payload.blok)){
        let injected = 0;
        payload.blok.forEach(b => {
          const namaKey = String(b.nama || '').toLowerCase();
          const pending = _pendingPrioritas[namaKey];
          if(pending){
            // Hanya inject kalau payload belum punya field isPrioritas explicit
            // (atau punya tapi masih default false dan pending says true)
            if(b.isPrioritas !== true && pending.isPrioritas){
              b.isPrioritas = true;
              if(!b.prioritasNote){
                b.prioritasNote = 'Auto-set saat plot lingkungan';
              }
              injected++;
            }
          }
        });
        if(injected > 0){
          console.log('[patch-013] injected isPrioritas to ' + injected + ' blok in bulkSaveEstateBlok');
        }
      }

      // Clear pending setelah save berhasil (apapun action-nya)
      const result = originalPost(action, payload);

      // Setelah promise resolve, clear pending lama (>10 menit)
      Promise.resolve(result).finally(() => {
        const cutoff = Date.now() - 10 * 60 * 1000;
        Object.keys(_pendingPrioritas).forEach(k => {
          if(_pendingPrioritas[k].timestamp < cutoff){
            delete _pendingPrioritas[k];
          }
        });
      });

      return result;
    };
    global.BM4Api.post._patch013Hooked = true;
    console.log('[patch-013] BM4Api.post hooked');
    return true;
  }

  // ============================================================
  // BOOT — retry sampai dependencies siap
  // ============================================================
  function init(){
    let modalReady = false;
    let saveHooked = false;
    let bulkHooked = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 40; // 40 x 250ms = 10 detik

    const interval = setInterval(() => {
      attempts++;
      if(!modalReady) modalReady = _enhanceModal();
      if(!saveHooked) saveHooked = _hookSave();
      if(!bulkHooked) bulkHooked = _hookBulkSave();

      if((modalReady && saveHooked && bulkHooked) || attempts >= MAX_ATTEMPTS){
        clearInterval(interval);
        if(!modalReady || !saveHooked || !bulkHooked){
          console.warn('[patch-013] partial init after ' + attempts + ' attempts:', {
            modalReady, saveHooked, bulkHooked
          });
        } else {
          console.log('[patch-013] fully initialized');
        }
      }
    }, 250);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  // Expose untuk debugging
  global._patch013 = {
    presets: PRESETS,
    pending: _pendingPrioritas,
    enhanceModal: _enhanceModal,
    hookSave: _hookSave,
    hookBulkSave: _hookBulkSave
  };

  console.log('[patch-013] plotter lingkungan enhancer loaded');
})(typeof window !== 'undefined' ? window : this);
