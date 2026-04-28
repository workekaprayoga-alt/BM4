// ============================================================
// BM4 API LAYER v9.6
// Satu pintu komunikasi ke Google Apps Script / backend berikutnya.
// Catatan keamanan: GAS_URL dan API_TOKEN masih terlihat di frontend.
// Ini belum production-secure; tujuan file ini adalah memusatkan akses API
// supaya nanti lebih mudah dipindah ke backend/database aman.
// ============================================================
(function(window){
  const Api = {
    async get(action, params){
      if(typeof USE_SHEETS !== 'undefined' && !USE_SHEETS) {
        return { success:false, offline:true, data:[] };
      }
      const url = gasGet(action, params || {});
      const res = await fetch(url, { cache:'no-store' });
      if(!res.ok) throw new Error('API GET gagal: ' + res.status + ' ' + action);
      return res.json();
    },

    // Dipakai untuk request POST yang perlu response JSON.
    async post(action, payload){
      if(typeof USE_SHEETS !== 'undefined' && !USE_SHEETS) {
        return { success:false, offline:true };
      }
      const res = await fetch(GAS_URL, {
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body: gasPost(Object.assign({ action }, payload || {})),
        cache:'no-store'
      });
      if(!res.ok) throw new Error('API POST gagal: ' + res.status + ' ' + action);
      try { return await res.json(); }
      catch(_){ return { success:true, raw:true }; }
    },

    // Kompatibel dengan pola lama Apps Script yang memakai no-cors.
    // Browser tidak bisa membaca hasilnya, jadi jangan dipakai untuk data penting
    // yang butuh konfirmasi sukses/gagal.
    async postNoCors(action, payload){
      if(typeof USE_SHEETS !== 'undefined' && !USE_SHEETS) {
        return { success:false, offline:true, opaque:false };
      }
      await fetch(GAS_URL, {
        method:'POST',
        mode:'no-cors',
        headers:{'Content-Type':'text/plain'},
        body: gasPost(Object.assign({ action }, payload || {})),
        cache:'no-store'
      });
      return { success:true, opaque:true };
    },

    async allSettled(requests){
      return Promise.allSettled(requests);
    }
  };

  window.BM4Api = Api;
})(window);
