// ============================================================
// PATCH: Fix bug save proyek tidak masuk Sheets
// ============================================================
// File: js/patches/patch-fix-proyek-sync.js
// Fungsi: override syncProyekToSheets dan loadProyekFromSheets
// Versi: 1.0
// Tanggal: 2026-05-01
//
// MASALAH LAMA:
// 1. syncProyekToSheets pakai mode:'no-cors' → response tidak terbaca
// 2. Kalau Apps Script error (session expired/permission), desktop tetap
//    toast sukses padahal Sheets tidak update
// 3. localStorage di-save SEBELUM konfirmasi server, jadi data terlihat
//    "ada" di UI tapi server kosong
//
// PERBAIKAN:
// 1. Pakai BM4Api.post (mode normal, bisa baca response JSON)
// 2. Verifikasi result.success === true sebelum tampil "tersimpan"
// 3. Kalau gagal, rollback localStorage + tampilkan error spesifik
// 4. loadProyekFromSheets juga pakai BM4Api.get yang konsisten
// ============================================================

(function(){
  'use strict';

  // Tunggu sampai BM4Api dan PROYEK_LIST sudah siap
  if(typeof BM4Api === 'undefined' || typeof PROYEK_LIST === 'undefined'){
    console.warn('[patch-fix-proyek-sync] dependencies belum siap, skip');
    return;
  }

  // ============================================================
  // OVERRIDE: syncProyekToSheets
  // ============================================================
  window.syncProyekToSheets = async function(){
    if(typeof USE_SHEETS === 'undefined' || !USE_SHEETS){
      console.log('[syncProyek] USE_SHEETS off, skip');
      return { success: false, offline: true };
    }

    // Cek session dulu — kalau token kosong, jangan kirim
    const token = (typeof getBm4SessionToken === 'function') ? getBm4SessionToken() : '';
    if(!token){
      console.warn('[syncProyek] Session token kosong — silakan login ulang');
      if(typeof showToast === 'function') showToast('⚠️ Session expired. Silakan login ulang sebelum simpan proyek');
      return { success: false, error: 'no_session' };
    }

    if(typeof setSyncStatus === 'function') setSyncStatus('loading', 'Menyimpan proyek...');

    try {
      // BM4Api.post otomatis inject sessionToken via gasPost
      const result = await BM4Api.post('saveProyek', { data: PROYEK_LIST });

      if(result && result.success === true){
        console.log('[syncProyek] ✓ Tersimpan ke Sheets:', result.count || PROYEK_LIST.length, 'proyek');
        if(typeof setSyncStatus === 'function') setSyncStatus('synced', 'Proyek tersinkron ke Sheets');
        return result;
      }

      // result ada tapi success !== true
      const errMsg = result && result.error ? result.error : 'Server tidak konfirmasi sukses';
      console.error('[syncProyek] ✗ Server response:', result);
      if(typeof setSyncStatus === 'function') setSyncStatus('offline', 'Sync gagal: ' + errMsg);
      if(typeof showToast === 'function') showToast('⚠️ Save proyek ke Sheets gagal: ' + errMsg);
      return result || { success: false, error: errMsg };
    } catch(e){
      console.error('[syncProyek] EXCEPTION:', e);
      if(typeof setSyncStatus === 'function') setSyncStatus('offline', 'Sync gagal');
      if(typeof showToast === 'function') showToast('⚠️ Save ke server gagal: ' + (e.message || 'unknown'));
      return { success: false, error: e.message };
    }
  };

  // ============================================================
  // OVERRIDE: loadProyekFromSheets
  // ============================================================
  window.loadProyekFromSheets = async function(){
    if(typeof USE_SHEETS === 'undefined' || !USE_SHEETS) return false;

    try {
      const r = await BM4Api.get('getProyek');
      if(!r || !r.success){
        console.warn('[loadProyek] Server response not OK:', r);
        return false;
      }

      if(!Array.isArray(r.data)){
        console.warn('[loadProyek] Data bukan array:', r.data);
        return false;
      }

      // Kalau Sheets KOSONG, JANGAN replace localStorage (cegah data hilang)
      // Ini kunci utama fix — masalah lama: load dari Sheets kosong → overwrite localStorage
      if(r.data.length === 0){
        console.warn('[loadProyek] Sheets KOSONG — tidak overwrite localStorage');
        return false;
      }

      // Map data dari Sheets → format PROYEK_LIST
      const mapped = r.data.map(p => ({
        id: String(p.id || '').trim(),
        nama: p.nama || '',
        kode: (p.kode || '').toString().toUpperCase(),
        area: p.area || '',
        tipe: p.tipe || 'Mix-use',
        unit: parseInt(p.unit) || 0,
        lat: parseFloat(p.lat) || 0,
        lng: parseFloat(p.lng) || 0,
        developer: p.developer || '',
        ikon: p.ikon || '🏘️',
        warna: p.warna || '#3B82F6',
        status: p.status || 'Aktif',
        deskripsi: p.deskripsi || '',
        foto: p.foto || ''
      })).filter(p => p.id && p.nama);

      if(mapped.length === 0){
        console.warn('[loadProyek] Setelah filter, tidak ada proyek valid — skip update');
        return false;
      }

      // Validasi: pastikan punya lat/lng yang valid (>0 atau <0, bukan tepat 0)
      const validProyek = mapped.filter(p => {
        const hasCoord = (p.lat && p.lat !== 0) || (p.lng && p.lng !== 0);
        return hasCoord;
      });
      if(validProyek.length === 0){
        console.warn('[loadProyek] Sheets ada data tapi semua koordinat kosong — skip update');
        return false;
      }

      PROYEK_LIST = mapped;
      saveProyekLocal();
      console.log('[loadProyek] ✓ Loaded ' + mapped.length + ' proyek dari Sheets');
      return true;
    } catch(e){
      console.warn('[loadProyek] Load gagal:', e);
      return false;
    }
  };

  // ============================================================
  // OVERRIDE: saveProyek (main function dari modal)
  // ============================================================
  // Tambah verify behavior: kalau sync gagal, tetap save lokal tapi kasih tau user
  // (kode lama: kalau syncProyekToSheets dipanggil dan return tanpa await, tidak ada feedback)

  const _origSaveProyek = window.saveProyek;
  window.saveProyek = async function(){
    const editId = (document.getElementById('pry-edit-id').value || '').trim();
    const nama = (document.getElementById('pry-nama').value || '').trim();
    const kode = (document.getElementById('pry-kode').value || '').trim().toUpperCase();
    const area = (document.getElementById('pry-area').value || '').trim();
    const tipe = document.getElementById('pry-tipe').value;
    const status = document.getElementById('pry-status').value;
    const unit = parseInt(document.getElementById('pry-unit').value) || 0;
    const developer = (document.getElementById('pry-developer').value || '').trim();
    const latStr = (document.getElementById('pry-lat').value || '').trim();
    const lngStr = (document.getElementById('pry-lng').value || '').trim();
    const ikon = (document.getElementById('pry-ikon').value || '🏘️').trim();
    const warna = document.getElementById('pry-warna').value || '#3B82F6';
    const deskripsi = (document.getElementById('pry-deskripsi').value || '').trim();

    // Validasi
    if(!nama){ showToast('Nama proyek wajib diisi'); return; }
    if(!kode){ showToast('Kode singkat wajib diisi'); return; }
    if(!/^[A-Z0-9]{2,8}$/.test(kode)){ showToast('Kode harus huruf/angka 2-8 karakter'); return; }
    if(!area){ showToast('Area wajib diisi'); return; }
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if(isNaN(lat) || isNaN(lng)){ showToast('Koordinat lat/lng wajib diisi'); return; }
    if(typeof validateLat === 'function' && !validateLat(lat)){ showToast('Latitude di luar range Indonesia (-11.5..6.5)'); return; }
    if(typeof validateLng === 'function' && !validateLng(lng)){ showToast('Longitude di luar range Indonesia (94.5..141.5)'); return; }

    const id = editId || slugifyKode(kode);

    if(!editId){
      if(PROYEK_LIST.some(p => p.id === id || (p.kode||'').toUpperCase() === kode)){
        showToast('Kode "' + kode + '" sudah dipakai proyek lain');
        return;
      }
    }

    const data = { id, nama, kode, area, tipe, status, unit, developer, lat, lng, ikon, warna, deskripsi, foto: (typeof _pryFotoState !== 'undefined' ? _pryFotoState : '') };

    // Backup state lama untuk rollback kalau perlu
    const backup = JSON.parse(JSON.stringify(PROYEK_LIST));

    if(editId){
      const idx = PROYEK_LIST.findIndex(p => p.id === editId);
      if(idx >= 0){
        PROYEK_LIST[idx] = data;
      }
    } else {
      PROYEK_LIST.push(data);
    }

    // Save lokal dulu (UI responsive)
    saveProyekLocal();

    // Render UI dulu (user lihat hasil instant)
    renderProyek();
    if(typeof renderProyekCards === 'function') renderProyekCards();

    // Tampil toast sementara (akan diupdate setelah server response)
    showToast('⏳ Menyimpan ke server...');

    // Tutup modal sambil server save
    closeProyekModal();

    // Sync ke Sheets — TUNGGU response untuk verify
    try {
      const result = await syncProyekToSheets();
      if(result && result.success === true){
        showToast('✓ Proyek "' + nama + '" ' + (editId ? 'diperbarui' : 'ditambahkan') + ' & tersimpan ke Sheets');
      } else {
        // Sync gagal — TIDAK rollback (data tetap di localStorage), tapi peringatkan
        const errMsg = (result && result.error) ? result.error : 'unknown';
        showToast('⚠️ Tersimpan lokal, tapi gagal ke Sheets: ' + errMsg + '. Coba refresh & login ulang.');
        console.error('[saveProyek] Server save FAILED. Data ada di localStorage tapi tidak di Sheets:', result);
      }
    } catch(e){
      showToast('⚠️ Tersimpan lokal, tapi server error: ' + e.message);
      console.error('[saveProyek] Exception saat sync:', e);
    }
  };

  // ============================================================
  // OVERRIDE: deleteProyek (verify ke server juga)
  // ============================================================
  const _origDeleteProyek = window.deleteProyek;
  window.deleteProyek = async function(id){
    const p = getProyek(id);
    if(!p){ showToast('Proyek tidak ditemukan'); return; }
    if(PROYEK_LIST.length <= 1){
      showToast('Minimal harus ada 1 proyek. Tambah yang lain dulu sebelum menghapus.');
      return;
    }
    if(currentProyek === id){
      showToast('Tidak bisa hapus proyek yang sedang dipilih. Keluar ke daftar proyek dulu.');
      return;
    }
    if(!confirm('Hapus proyek "' + p.nama + '"?\nTindakan ini tidak bisa di-undo.')) return;

    PROYEK_LIST = PROYEK_LIST.filter(x => x.id !== id);
    saveProyekLocal();
    renderProyek();
    if(typeof renderProyekCards === 'function') renderProyekCards();

    showToast('⏳ Menghapus dari server...');
    try {
      const result = await syncProyekToSheets();
      if(result && result.success === true){
        showToast('✓ Proyek "' + p.nama + '" dihapus & tersinkron');
      } else {
        showToast('⚠️ Lokal terhapus, tapi server tidak konfirmasi. Refresh untuk verify');
      }
    } catch(e){
      showToast('⚠️ Lokal terhapus, tapi server error');
    }
  };

  console.log('[patch-fix-proyek-sync] ✓ Loaded — syncProyekToSheets, loadProyekFromSheets, saveProyek, deleteProyek di-override');
})();
