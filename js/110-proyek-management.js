// Project management, project photo/map
// ============================================================
// [v14 PROYEK] KELOLA PROYEK — CRUD (BM only)
// ============================================================
function escProyek(s){ return String(s==null?'':s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function slugifyKode(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,12) || ('p'+Date.now().toString(36).slice(-5));
}

function renderProyek(){
  const grid = document.getElementById('pry-grid');
  if(!grid) return;
  if(!PROYEK_LIST || PROYEK_LIST.length === 0){
    grid.innerHTML = '<div class="pry-empty">Belum ada proyek. Klik <b>➕ Tambah Proyek</b> untuk mulai.</div>';
    return;
  }
  grid.innerHTML = '';
  PROYEK_LIST.forEach(p => {
    const card = document.createElement('div');
    card.className = 'pry-card';
    const statusClass = (p.status||'Aktif').toLowerCase();
    const fotoHtml = p.foto
      ? `<img src="${escProyek(p.foto)}" alt="${escProyek(p.nama)}" onerror="this.style.display='none';this.parentElement.innerHTML='<div class=\\'pry-card-photo-placeholder\\'>${escProyek(p.ikon||'🏘️')}</div>';">`
      : `<div class="pry-card-photo-placeholder">${escProyek(p.ikon||'🏘️')}</div>`;
    const unitTxt = (p.unit>0) ? fmt(p.unit)+' Unit' : '— Unit';
    const devTxt = p.developer ? `<span class="pry-card-chip">${escProyek(p.developer)}</span>` : '';
    const descTxt = p.deskripsi ? `<div class="pry-card-desc">"${escProyek(p.deskripsi)}"</div>` : '';
    card.innerHTML = `
      <div class="pry-card-photo" style="background:linear-gradient(135deg, ${escProyek(p.warna||'#F1F5F9')}22 0%, ${escProyek(p.warna||'#E2E8F0')}11 100%);">
        ${fotoHtml}
        <div class="pry-card-status ${statusClass}">${escProyek(p.status||'Aktif')}</div>
      </div>
      <div class="pry-card-body">
        <div class="pry-card-name">${escProyek(p.ikon||'🏘️')} ${escProyek(p.nama)}</div>
        <div class="pry-card-area">📍 ${escProyek(p.area||'—')}</div>
        <div class="pry-card-meta">
          <span class="pry-card-chip tipe">${escProyek(p.tipe||'—')}</span>
          <span class="pry-card-chip">${unitTxt}</span>
          ${devTxt}
        </div>
        ${descTxt}
      </div>
      <div class="pry-card-actions">
        <button class="pry-card-btn" onclick="editProyek('${escProyek(p.id)}')">✏️ Edit</button>
        <button class="pry-card-btn danger" onclick="deleteProyek('${escProyek(p.id)}')">🗑️ Hapus</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function openProyekModal(){
  // Reset form — mode tambah
  document.getElementById('pry-modal-title').textContent = 'Tambah Proyek Baru';
  document.getElementById('pry-edit-id').value = '';
  document.getElementById('pry-nama').value = '';
  document.getElementById('pry-kode').value = '';
  document.getElementById('pry-area').value = '';
  document.getElementById('pry-tipe').value = 'Mix-use';
  document.getElementById('pry-status').value = 'Aktif';
  document.getElementById('pry-unit').value = '';
  document.getElementById('pry-developer').value = '';
  document.getElementById('pry-lat').value = '';
  document.getElementById('pry-lng').value = '';
  document.getElementById('pry-ikon').value = '🏘️';
  document.getElementById('pry-warna').value = '#3B82F6';
  document.getElementById('pry-deskripsi').value = '';
  document.getElementById('pry-modal').classList.add('open');
  // [v15 PROYEK] reset foto + init mini-map & smart-input
  _prepPryModalExtras('', '', '');
  setTimeout(()=>{ const el=document.getElementById('pry-nama'); if(el) el.focus(); }, 50);
}

function closeProyekModal(){
  document.getElementById('pry-modal').classList.remove('open');
}

function editProyek(id){
  const p = getProyek(id);
  if(!p){ showToast('Proyek tidak ditemukan'); return; }
  document.getElementById('pry-modal-title').textContent = 'Edit Proyek: ' + p.nama;
  document.getElementById('pry-edit-id').value = p.id;
  document.getElementById('pry-nama').value = p.nama || '';
  document.getElementById('pry-kode').value = (p.kode || p.id || '').toUpperCase();
  document.getElementById('pry-area').value = p.area || '';
  document.getElementById('pry-tipe').value = p.tipe || 'Mix-use';
  document.getElementById('pry-status').value = p.status || 'Aktif';
  document.getElementById('pry-unit').value = p.unit || 0;
  document.getElementById('pry-developer').value = p.developer || '';
  document.getElementById('pry-lat').value = p.lat;
  document.getElementById('pry-lng').value = p.lng;
  document.getElementById('pry-ikon').value = p.ikon || '🏘️';
  document.getElementById('pry-warna').value = p.warna || '#3B82F6';
  document.getElementById('pry-deskripsi').value = p.deskripsi || '';
  document.getElementById('pry-modal').classList.add('open');
  // [v15 PROYEK] isi foto state + mini-map pin dari data existing
  _prepPryModalExtras(p.foto || '', p.lat, p.lng);
}

function saveProyek(){
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
  // Pakai validator yg sudah ada dari v12
  if(typeof validateLat === 'function' && !validateLat(lat)){ showToast('Latitude di luar range Indonesia (-11.5..6.5)'); return; }
  if(typeof validateLng === 'function' && !validateLng(lng)){ showToast('Longitude di luar range Indonesia (94.5..141.5)'); return; }

  const id = editId || slugifyKode(kode);

  // Cek duplikat kode/id (hanya untuk tambah baru atau kalau kode diubah)
  if(!editId){
    if(PROYEK_LIST.some(p => p.id === id || (p.kode||'').toUpperCase() === kode)){
      showToast('Kode "' + kode + '" sudah dipakai proyek lain');
      return;
    }
  }

  const data = { id, nama, kode, area, tipe, status, unit, developer, lat, lng, ikon, warna, deskripsi, foto: _pryFotoState || '' };

  if(editId){
    const idx = PROYEK_LIST.findIndex(p => p.id === editId);
    if(idx >= 0){
      PROYEK_LIST[idx] = data;
      showToast('✓ Proyek "' + nama + '" diperbarui');
    }
  } else {
    PROYEK_LIST.push(data);
    showToast('✓ Proyek "' + nama + '" ditambahkan');
  }

  saveProyekLocal();
  if(typeof syncProyekToSheets === 'function') syncProyekToSheets(); // [v15 PROYEK] sync
  renderProyek();
  // Refresh screen pilih proyek juga biar sinkron kalau user keluar
  if(typeof renderProyekCards === 'function') renderProyekCards();
  closeProyekModal();
}

function deleteProyek(id){
  const p = getProyek(id);
  if(!p){ showToast('Proyek tidak ditemukan'); return; }
  // Safety: jangan izinkan hapus kalau cuma tersisa 1 proyek
  if(PROYEK_LIST.length <= 1){
    showToast('Minimal harus ada 1 proyek. Tambah yang lain dulu sebelum menghapus.');
    return;
  }
  // Safety: jangan hapus proyek yang sedang aktif dipilih
  if(currentProyek === id){
    showToast('Tidak bisa hapus proyek yang sedang dipilih. Keluar ke daftar proyek dulu.');
    return;
  }
  if(!confirm('Hapus proyek "' + p.nama + '"?\nTindakan ini tidak bisa di-undo.')) return;

  PROYEK_LIST = PROYEK_LIST.filter(x => x.id !== id);
  saveProyekLocal();
  if(typeof syncProyekToSheets === 'function') syncProyekToSheets(); // [v15 PROYEK] sync
  renderProyek();
  if(typeof renderProyekCards === 'function') renderProyekCards();
  showToast('✓ Proyek "' + p.nama + '" dihapus');
}

// Render ulang card di screen pilih proyek (s-proyek) — dinamis dari PROYEK_LIST
function renderProyekCards(){
  const wrap = document.getElementById('proyek-cards');
  if(!wrap) return;
  wrap.innerHTML = '';
  PROYEK_LIST.forEach(p => {
    const card = document.createElement('div');
    card.className = 'proyek-card';
    card.onclick = () => selectProyek(p.id);
    const unitTxt = (p.unit > 0) ? fmt(p.unit) + ' Unit' : '— Unit';
    card.innerHTML = `
      <div class="proyek-card-icon">${escProyek(p.ikon||'🏘️')}</div>
      <div class="proyek-card-name">${escProyek(p.nama)}</div>
      <div class="proyek-card-area">${escProyek(p.area||'—')} · ${escProyek(p.tipe||'—')}</div>
      <div class="proyek-card-badge">${unitTxt}</div>
    `;
    wrap.appendChild(card);
  });
  // [v14.1] Kartu "Tambah Proyek" di screen ini dihapus — tambah proyek kini hanya via menu 🏗️ Proyek
}
// ============================================================

// ============================================================
// [v15 PROYEK Batch B] FOTO + SMART-INPUT + MINI-MAP + SYNC SHEETS
// ============================================================

// State foto modal proyek (data URL dari upload compressed, atau URL eksternal, atau '' = kosong)
let _pryFotoState = '';

// Render preview foto di modal berdasarkan state
function _renderPryFotoPreview(){
  const prev = document.getElementById('pry-foto-preview');
  const delBtn = document.getElementById('pry-foto-remove-btn');
  if(!prev) return;
  if(_pryFotoState){
    prev.classList.add('has-img');
    prev.innerHTML = `<img src="${_pryFotoState}" alt="Preview" onerror="this.parentElement.innerHTML='<div class=\\'pry-photo-preview-empty\\' style=color:#DC2626;>⚠ Gambar tidak bisa dimuat (URL salah atau diblokir)</div>';">`;
    if(delBtn) delBtn.style.display = '';
  } else {
    prev.classList.remove('has-img');
    prev.innerHTML = '<div class="pry-photo-preview-empty">Belum ada foto — klik <b>Upload</b> atau <b>URL</b> di atas</div>';
    if(delBtn) delBtn.style.display = 'none';
  }
}

// Toggle row input URL
function togglePryFotoUrl(){
  const row = document.getElementById('pry-foto-url-row');
  if(!row) return;
  row.classList.toggle('open');
  if(row.classList.contains('open')){
    const inp = document.getElementById('pry-foto-url-input');
    if(inp){ inp.value = ''; setTimeout(()=>inp.focus(), 30); }
  }
}

// Apply URL eksternal jadi foto. Auto-convert Drive sharing URL → direct image URL.
function applyPryFotoUrl(){
  const inp = document.getElementById('pry-foto-url-input');
  const status = document.getElementById('pry-foto-status');
  if(!inp) return;
  let url = (inp.value || '').trim();
  if(!url){
    if(status){ status.className = 'pry-photo-status err'; status.textContent = '⚠ URL kosong'; }
    return;
  }
  if(!/^https?:\/\//i.test(url)){
    if(status){ status.className = 'pry-photo-status err'; status.textContent = '⚠ URL harus diawali http:// atau https://'; }
    return;
  }
  // Auto-convert Drive URL kalau detect
  if(typeof _driveExtractId === 'function'){
    const driveId = _driveExtractId(url);
    if(driveId){
      const converted = _driveToImageUrl(url, 'w1200');
      if(converted){
        url = converted;
        if(status){ status.className = 'pry-photo-status ok'; status.textContent = '✓ Link Drive di-convert otomatis ke direct image URL'; }
      }
    }
  }
  _pryFotoState = url;
  _renderPryFotoPreview();
  document.getElementById('pry-foto-url-row').classList.remove('open');
  if(status && !status.textContent.includes('Drive')){ status.className = 'pry-photo-status ok'; status.textContent = '✓ URL foto diterapkan'; }
}

// Hapus foto dari state
function removePryFoto(){
  _pryFotoState = '';
  _renderPryFotoPreview();
  const status = document.getElementById('pry-foto-status');
  if(status){ status.className = 'pry-photo-status'; status.textContent = '📁 Upload file (auto-compress 600px) ATAU 🔗 paste link Google Drive (resolusi penuh, direkomendasi)'; }
}

// Handler file upload → auto-compress
function handlePryFotoFile(event){
  const file = event.target.files && event.target.files[0];
  event.target.value = ''; // biar bisa pilih file sama lagi
  if(!file) return;
  const status = document.getElementById('pry-foto-status');
  if(!file.type || !file.type.startsWith('image/')){
    if(status){ status.className = 'pry-photo-status err'; status.textContent = '⚠ File harus berupa gambar'; }
    return;
  }
  if(file.size > 5 * 1024 * 1024){
    if(status){ status.className = 'pry-photo-status err'; status.textContent = '⚠ File terlalu besar (maksimal 5 MB)'; }
    return;
  }
  if(status){ status.className = 'pry-photo-status'; status.textContent = '⏳ Compress...'; }
  _compressPryFoto(file).then(dataUrl => {
    _pryFotoState = dataUrl;
    _renderPryFotoPreview();
    // Tampilkan ukuran hasil
    const kb = Math.round((dataUrl.length * 0.75) / 1024); // approx base64→bytes
    if(status){ status.className = 'pry-photo-status ok'; status.textContent = `✓ Foto di-compress (~${kb} KB)`; }
  }).catch(err => {
    if(status){ status.className = 'pry-photo-status err'; status.textContent = '⚠ Gagal memproses gambar'; }
    console.warn('Compress foto proyek gagal:', err);
  });
}

// Compress image: max side 600px, quality 0.72 → JPEG data URL
function _compressPryFoto(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 600;
          let w = img.naturalWidth, h = img.naturalHeight;
          if(w > h && w > MAX){ h = Math.round(h * MAX / w); w = MAX; }
          else if(h > MAX){ w = Math.round(w * MAX / h); h = MAX; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF'; // bg putih kalau PNG transparan
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        } catch(err){ reject(err); }
      };
      img.onerror = () => reject(new Error('Gambar tidak bisa dimuat'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Gagal baca file'));
    reader.readAsDataURL(file);
  });
}

// [v11.6 AVATAR COMPRESS] Khusus foto avatar user — crop square + resize 256px + JPEG 0.78
// Target output: ~15-25 KB (aman untuk Google Sheets 50k char limit)
// Crop ke square (1:1) supaya avatar nggak gepeng/terdistorsi
function _compressAvatar(file){
  return new Promise((resolve, reject) => {
    if(!file || !file.type || !file.type.startsWith('image/')){
      return reject(new Error('File bukan gambar'));
    }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        try {
          const SIZE = 256; // target 256x256 pixel — cukup sharp untuk avatar
          const srcW = img.naturalWidth, srcH = img.naturalHeight;
          // Crop tengah jadi square
          const minDim = Math.min(srcW, srcH);
          const sx = (srcW - minDim) / 2;
          const sy = (srcH - minDim) / 2;
          const canvas = document.createElement('canvas');
          canvas.width = SIZE; canvas.height = SIZE;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, SIZE, SIZE);
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, SIZE, SIZE);
          // Coba quality 0.78, kalau masih kegedean coba 0.6, lalu 0.45
          let dataUrl = canvas.toDataURL('image/jpeg', 0.78);
          if(dataUrl.length > 45000) dataUrl = canvas.toDataURL('image/jpeg', 0.6);
          if(dataUrl.length > 45000) dataUrl = canvas.toDataURL('image/jpeg', 0.45);
          if(dataUrl.length > 45000){
            // Last resort: resize 128px
            const c2 = document.createElement('canvas');
            c2.width = 128; c2.height = 128;
            const ctx2 = c2.getContext('2d');
            ctx2.fillStyle = '#FFFFFF';
            ctx2.fillRect(0, 0, 128, 128);
            ctx2.drawImage(img, sx, sy, minDim, minDim, 0, 0, 128, 128);
            dataUrl = c2.toDataURL('image/jpeg', 0.7);
          }
          resolve(dataUrl);
        } catch(err){ reject(err); }
      };
      img.onerror = () => reject(new Error('Gambar tidak bisa dimuat'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Gagal baca file'));
    reader.readAsDataURL(file);
  });
}

// Mini-map controller (lazy init, sekali)
let pryMiniMap = null;
function _initPryMiniMapOnce(){
  const el = document.getElementById('pry-minimap');
  if(!el || el._leaflet_id) return;
  if(typeof L === 'undefined' || typeof createMiniMap !== 'function') return;
  pryMiniMap = createMiniMap('pry-minimap', {
    center: [-6.5578, 107.8131], zoom: 12,
    onPick: (lat, lng) => {
      const lEl = document.getElementById('pry-lat'), gEl = document.getElementById('pry-lng');
      if(lEl){ lEl.value = lat.toFixed(7); lEl.classList.add('filled'); }
      if(gEl){ gEl.value = lng.toFixed(7); gEl.classList.add('filled'); }
      const fb = document.getElementById('smi-pry-fb');
      if(fb){ fb.className = 'smart-input-fb ok'; fb.innerHTML = `✓ Dari klik peta: <b>${lat.toFixed(6)}, ${lng.toFixed(6)}</b>`; }
    },
    onMove: (lat, lng) => {
      const lEl = document.getElementById('pry-lat'), gEl = document.getElementById('pry-lng');
      if(lEl){ lEl.value = lat.toFixed(7); lEl.classList.add('filled'); }
      if(gEl){ gEl.value = lng.toFixed(7); gEl.classList.add('filled'); }
    }
  });
  // Ref markers: proyek existing sebagai latar (abu-abu)
  if(pryMiniMap && Array.isArray(PROYEK_LIST)){
    pryMiniMap.addReferences(
      PROYEK_LIST.filter(p => !isNaN(p.lat) && !isNaN(p.lng))
                 .map(p => ({lat: p.lat, lng: p.lng, label: p.nama, color: '#9CA3AF'}))
    );
  }
}

// Wire smart-input (sekali)
let _smartInputWiredPry = false;
function _wirePrySmartInputOnce(){
  if(_smartInputWiredPry) return;
  if(typeof wireSmartInput !== 'function') return;
  _smartInputWiredPry = true;
  wireSmartInput({
    inputId: 'smi-pry-input', btnId: 'smi-pry-btn', fbId: 'smi-pry-fb',
    helpBtnId: 'smi-pry-helpbtn', helpBoxId: 'smi-pry-help',
    latFieldId: 'pry-lat', lngFieldId: 'pry-lng',
    onPick: (lat, lng) => { if(pryMiniMap) pryMiniMap.setPin(lat, lng); }
  });
}

// Dipanggil dari openProyekModal/editProyek — reset/isi state foto & mini-map
function _prepPryModalExtras(foto, lat, lng){
  _pryFotoState = foto || '';
  _renderPryFotoPreview();
  const urlRow = document.getElementById('pry-foto-url-row');
  if(urlRow) urlRow.classList.remove('open');
  const status = document.getElementById('pry-foto-status');
  if(status){ status.className = 'pry-photo-status'; status.textContent = '📁 Upload file (auto-compress 600px) ATAU 🔗 paste link Google Drive (resolusi penuh, direkomendasi)'; }
  // Smart-input feedback reset
  const smInp = document.getElementById('smi-pry-input');
  const smFb = document.getElementById('smi-pry-fb');
  if(smInp) smInp.value = '';
  if(smFb){ smFb.className = 'smart-input-fb'; smFb.innerHTML = ''; }
  // Mini-map — delay biar modal sudah visible (Leaflet butuh ukuran container)
  setTimeout(() => {
    _initPryMiniMapOnce();
    _wirePrySmartInputOnce();
    if(pryMiniMap){
      // Refresh referensi (proyek lain) tiap buka modal
      pryMiniMap.addReferences(
        PROYEK_LIST.filter(p => !isNaN(p.lat) && !isNaN(p.lng) && p.id !== (document.getElementById('pry-edit-id').value||''))
                   .map(p => ({lat: p.lat, lng: p.lng, label: p.nama, color: '#9CA3AF'}))
      );
      if(!isNaN(lat) && !isNaN(lng) && lat !== '' && lng !== ''){
        pryMiniMap.setPin(parseFloat(lat), parseFloat(lng));
      } else {
        pryMiniMap.clearPin();
        pryMiniMap.focus(-6.5578, 107.8131, 12);
      }
      pryMiniMap.invalidateSize();
    }
  }, 150);
}

// Sync ke Google Sheets — ikut pattern syncAccountsToSheets (v10)
async function syncProyekToSheets(){
  if(typeof USE_SHEETS === 'undefined' || !USE_SHEETS) return;
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {'Content-Type':'text/plain'},
      body: gasPost({action: 'saveProyek', data: PROYEK_LIST})
    });
  } catch(e){ console.warn('Sync proyek failed', e); }
}

async function loadProyekFromSheets(){
  if(typeof USE_SHEETS === 'undefined' || !USE_SHEETS) return false;
  try {
    const r = await fetch(gasGet('getProyek')).then(res => res.json());
    if(r && r.success && Array.isArray(r.data) && r.data.length > 0){
      PROYEK_LIST = r.data.map(p => ({
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
      if(PROYEK_LIST.length > 0){
        saveProyekLocal();
        return true;
      }
    }
  } catch(e){ console.warn('Load proyek from sheets failed', e); }
  return false;
}

// ============================================================
// TIM BM4 RENDERING
// ============================================================
function renderTim(){
  const grid = document.getElementById('tim-grid');
  if(!grid) return;
  grid.innerHTML = '';
  accounts.forEach((a, idx) => {
    const card = document.createElement('div');
    card.className = 'tim-card';
    // [v10 CONTROL] Visual indicator kalau akun di-suspend
    if(a.suspended) card.style.opacity = '0.55';
    const initial = (a.nama || a.username || '?').charAt(0).toUpperCase();
    // [v9 SECURITY] Pakai renderFotoHtml untuk validasi URL foto
    const avatarHtml = a.foto ? renderFotoHtml(a.foto, escapeHtml(a.nama||''), initial) : initial;
    const aksesHtml = (a.akses || []).map(k => `<span class="tim-access-chip">${escapeHtml(k)}</span>`).join('');
    const bioPreview = a.bio ? `<div style="font-size:11px;color:var(--muted);font-style:italic;padding:6px 9px;background:#FAFAF8;border-radius:6px;border-left:2px solid var(--accent);margin-bottom:8px;">"${escapeHtml(a.bio)}"</div>` : '';
    const suspendedBadge = a.suspended
      ? `<span style="background:#FEE2E2;color:#B91C1C;font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:6px;letter-spacing:0.4px;">⛔ NONAKTIF</span>`
      : '';
    const usernameEsc = escapeHtml(a.username).replace(/'/g,"\\'");
    const isSelf = a.username === currentUser?.username;
    card.innerHTML = `
      <div class="tim-card-head">
        <div class="tim-avatar-wrap">
          <div class="tim-avatar">${avatarHtml}</div>
          <button class="tim-avatar-edit-btn" onclick="bmEditPhoto('${usernameEsc}')" title="Ganti foto">📷</button>
        </div>
        <div style="flex:1;min-width:0;">
          <div class="tim-info-name">${escapeHtml(a.nama || a.username)}${suspendedBadge}</div>
          <div class="tim-info-jabatan">${escapeHtml(a.jabatan || '-')}</div>
          <span class="tim-role-badge ${roleBadgeClass(a.role)}">${roleLabel(a.role)}</span>
        </div>
      </div>
      ${bioPreview}
      <div class="tim-details">
        <div class="tim-detail-row"><span class="tim-detail-lbl">Username:</span><span class="tim-detail-val">${escapeHtml(a.username)}</span></div>
        <div class="tim-detail-row">
          <span class="tim-detail-lbl">Password:</span>
          <span class="tim-detail-val">
            <span style="color:var(--faint);font-size:10px;font-style:italic;">🔒 Terenkripsi</span>
            <button class="tim-pw-toggle" onclick="bmResetPassword('${usernameEsc}')">🔑 Reset</button>
          </span>
        </div>
        <div style="margin-top:6px;"><div class="tim-detail-lbl" style="font-size:10px;">Akses:</div><div class="tim-access-list">${aksesHtml||'<span style="font-size:10px;color:var(--faint);">—</span>'}</div></div>
      </div>

      <!-- [v10 CONTROL] Panel kontrol BM -->
      <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #E2E8F0;display:flex;flex-wrap:wrap;gap:6px;">
        <button onclick="bmShowAuditPerUser('${usernameEsc}')" style="flex:1;min-width:80px;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:6px;padding:6px 10px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;">📊 Audit</button>
        ${isSelf ? '' : `<button onclick="bmForceLogout('${usernameEsc}')" style="flex:1;min-width:80px;background:#FFF7ED;color:#C2410C;border:1px solid #FED7AA;border-radius:6px;padding:6px 10px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;" title="Paksa user keluar dari sesinya">🚪 Force Logout</button>`}
        ${isSelf ? '' : `<button onclick="bmToggleSuspend('${usernameEsc}')" style="flex:1;min-width:80px;background:${a.suspended ? '#ECFDF5' : '#FEF2F2'};color:${a.suspended ? '#15803D' : '#B91C1C'};border:1px solid ${a.suspended ? '#A7F3D0' : '#FECACA'};border-radius:6px;padding:6px 10px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;">${a.suspended ? '✓ Aktifkan' : '⛔ Nonaktifkan'}</button>`}
      </div>

      <div class="tim-actions">
        <button class="tim-btn-edit" onclick="openAccModal('edit','${usernameEsc}')">✏️ Edit</button>
        ${a.role==='bm' && accounts.filter(x=>x.role==='bm').length<=1 ? '' : `<button class="tim-btn-del" onclick="deleteAccount('${usernameEsc}')">🗑</button>`}
      </div>
    `;
    grid.appendChild(card);
  });
  renderMonitorStats();
  populateLogFilterUsers();
  renderLogList();
}

// BM edit photo langsung (upload foto ke user lain)
function bmEditPhoto(username){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (event) => {
    const file = event.target.files[0];
    if(!file) return;
    // [v9 SECURITY] Validasi MIME type
    if(!file.type || !file.type.startsWith('image/')){
      showToast('⚠ File harus berupa gambar'); return;
    }
    if(file.size > 10 * 1024 * 1024){ showToast('⚠ Ukuran foto maksimal 10MB'); return; }
    showToast('⚙️ Memproses foto...');
    _compressAvatar(file).then(dataUrl => {
      if(!dataUrl.startsWith('data:image/')){ showToast('⚠ File tidak valid'); return; }
      const sizeKB = Math.round((dataUrl.length * 0.75) / 1024);
      const idx = accounts.findIndex(a => a.username === username);
      if(idx >= 0){
        accounts[idx].foto = dataUrl;
        if(currentUser?.username === username){
          currentUser.foto = dataUrl;
          document.getElementById('tb-profile-avatar').innerHTML = `<img src="${dataUrl}" alt="">`;
        }
        saveAccountsLocal();
        syncAccountsToSheets();
        logActivity(currentUser.username, 'ganti foto', `BM mengubah foto akun: ${username} (${sizeKB}KB)`);
        renderTim();
        showToast(`✓ Foto ${username} diperbarui (${sizeKB}KB)`);
      }
    }).catch(err => {
      console.error('Compress avatar error:', err);
      showToast('⚠️ Gagal memproses foto: ' + err.message);
    });
  };
  input.click();
}

// [v10 CONTROL] Reset password dengan menampilkan password baru sekali (copy-able).
// User wajib login dengan password ini lalu ganti ke password pilihannya sendiri.
async function bmResetPassword(username){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const acc = findAccount(username);
  if(!acc){ showToast('⚠ Akun tidak ditemukan'); return; }

  // Generate password acak yang mudah dibaca (8 karakter, mix huruf+angka, tanpa simbol membingungkan)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let newPw = '';
  for(let i = 0; i < 10; i++){
    newPw += chars[Math.floor(Math.random() * chars.length)];
  }

  if(!confirm(`Reset password untuk "${username}"?\n\nPassword baru akan di-generate otomatis dan ditampilkan SEKALI. Catat atau kirim ke user yang bersangkutan.`)) return;

  const hashed = await hashPassword(newPw);
  const idx = accounts.findIndex(a => a.username === username);
  if(idx < 0) return;

  accounts[idx].password = hashed;
  // Force logout user tersebut karena password berubah
  accounts[idx].sessionValidFrom = Date.now();
  if(currentUser.username === username) currentUser.password = hashed;
  saveAccountsLocal();
  syncAccountsToSheets();
  logActivity(currentUser.username, 'reset password', `Reset password akun: ${username}`);

  // Tampilkan modal dengan password baru (sekali saja)
  showResetPasswordModal(username, newPw);
  renderTim();
}

// [v10 CONTROL] Modal untuk menampilkan password baru setelah reset (sekali saja)
function showResetPasswordModal(username, newPw){
  // Buat modal ad-hoc — tidak perlu predefined HTML
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:white;border-radius:14px;padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
      <div style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:6px;">🔑 Password Baru</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:18px;line-height:1.5;">Password baru untuk <b>${escapeHtml(username)}</b>. <b style="color:#DC2626;">Catat atau salin sekarang</b> — tidak akan ditampilkan lagi.</div>
      <div style="background:#F1F5F9;border:2px dashed #CBD5E1;border-radius:10px;padding:16px;text-align:center;margin-bottom:16px;">
        <div id="reset-pw-value" style="font-family:'DM Mono',monospace;font-size:22px;font-weight:700;letter-spacing:2px;color:#0F172A;user-select:all;">${escapeHtml(newPw)}</div>
      </div>
      <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:11px;color:#92400E;line-height:1.5;">
        ℹ️ User harus login dengan password ini lalu segera mengganti ke password pilihannya sendiri di menu Settings.
      </div>
      <div style="display:flex;gap:8px;">
        <button id="reset-pw-copy" style="flex:1;background:var(--accent);color:white;border:none;border-radius:8px;padding:11px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;">📋 Salin ke Clipboard</button>
        <button id="reset-pw-close" style="background:#E2E8F0;color:var(--text);border:none;border-radius:8px;padding:11px 20px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;">Tutup</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('reset-pw-copy').onclick = () => {
    navigator.clipboard?.writeText(newPw).then(() => {
      showToast('✓ Password disalin');
    }).catch(() => {
      // Fallback: select text
      const el = document.getElementById('reset-pw-value');
      const range = document.createRange();
      range.selectNode(el);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      showToast('⚠ Salin manual dari kotak');
    });
  };
  document.getElementById('reset-pw-close').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
}

// [v10 CONTROL] Toggle suspend akun
function bmToggleSuspend(username){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const idx = accounts.findIndex(a => a.username === username);
  if(idx < 0) return;
  const acc = accounts[idx];

  // Proteksi: tidak bisa suspend diri sendiri
  if(acc.username === currentUser.username){
    showToast('⚠ Tidak bisa suspend akun sendiri'); return;
  }
  // Proteksi: tidak bisa suspend BM terakhir
  if(acc.role === 'bm' && !acc.suspended){
    const activeBM = accounts.filter(a => a.role === 'bm' && !a.suspended).length;
    if(activeBM <= 1){ showToast('⚠ Minimal harus ada 1 BM aktif'); return; }
  }

  const willSuspend = !acc.suspended;
  const confirmMsg = willSuspend
    ? `Nonaktifkan akun "${username}"?\n\nUser ini tidak akan bisa login sampai diaktifkan kembali. Sesi aktifnya juga akan dihentikan.`
    : `Aktifkan kembali akun "${username}"?`;
  if(!confirm(confirmMsg)) return;

  acc.suspended = willSuspend;
  if(willSuspend){
    // Force logout user yang lagi aktif
    acc.sessionValidFrom = Date.now();
  }
  saveAccountsLocal();
  syncAccountsToSheets();
  logActivity(currentUser.username, willSuspend ? 'suspend akun' : 'aktifkan akun', `${willSuspend ? 'Menonaktifkan' : 'Mengaktifkan'} akun: ${username}`);
  showToast(willSuspend ? `⛔ Akun ${username} dinonaktifkan` : `✓ Akun ${username} diaktifkan`);
  renderTim();
}

// [v10 CONTROL] Force logout user (tanpa suspend)
function bmForceLogout(username){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const idx = accounts.findIndex(a => a.username === username);
  if(idx < 0) return;
  if(accounts[idx].username === currentUser.username){
    showToast('⚠ Tidak bisa force logout diri sendiri. Gunakan tombol Keluar.'); return;
  }
  if(!confirm(`Paksa logout "${username}"?\n\nUser akan otomatis keluar pada aktivitas berikutnya (biasanya dalam beberapa detik).`)) return;

  accounts[idx].sessionValidFrom = Date.now();
  saveAccountsLocal();
  syncAccountsToSheets();
  logActivity(currentUser.username, 'force logout', `Paksa logout akun: ${username}`);
  showToast(`🚪 ${username} akan logout otomatis`);
  renderTim();
}

// [v10 CONTROL] Tampilkan modal audit per-akun (semua aktivitas user tsb)
function bmShowAuditPerUser(username){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const userLogs = accountLogs.filter(l => l.username === username);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';

  const logsHtml = userLogs.length === 0
    ? '<div style="padding:40px 20px;text-align:center;color:var(--muted);font-size:12px;font-style:italic;">Belum ada aktivitas tercatat untuk user ini.</div>'
    : userLogs.slice(0, 100).map(l => {
        const t = new Date(l.timestamp);
        const timeStr = t.toLocaleDateString('id',{day:'2-digit',month:'short',year:'2-digit'}) + ' ' + t.toLocaleTimeString('id',{hour:'2-digit',minute:'2-digit'});
        const action = (l.action || '').toLowerCase();
        let color = '#64748B';
        if(action === 'login') color = '#059669';
        else if(action === 'logout') color = '#64748B';
        else if(action.includes('ditolak') || action.includes('suspend') || action.includes('hapus')) color = '#DC2626';
        else if(action.includes('edit') || action.includes('ganti') || action.includes('reset') || action.includes('force')) color = '#D97706';
        return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 12px;border-bottom:1px solid #F1F5F9;gap:10px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">${escapeHtml(l.action)}</div>
            <div style="font-size:11px;color:var(--muted);line-height:1.4;">${escapeHtml(l.detail || '-')}</div>
          </div>
          <div style="font-size:10px;color:var(--faint);white-space:nowrap;font-family:'DM Mono',monospace;">${timeStr}</div>
        </div>`;
      }).join('');

  overlay.innerHTML = `
    <div style="background:white;border-radius:14px;max-width:520px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
      <div style="padding:20px 24px;border-bottom:1px solid #F1F5F9;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--text);">📊 Audit Aktivitas</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">User: <b>${escapeHtml(username)}</b> · ${userLogs.length} aktivitas</div>
        </div>
        <button id="audit-close" style="background:transparent;border:none;font-size:20px;cursor:pointer;color:var(--muted);padding:4px 8px;">✕</button>
      </div>
      <div style="flex:1;overflow-y:auto;">
        ${logsHtml}
      </div>
      <div style="padding:12px 20px;border-top:1px solid #F1F5F9;font-size:10px;color:var(--faint);text-align:center;">
        Menampilkan maks 100 aktivitas terbaru
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('audit-close').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
}

function renderLogList(){
  const list = document.getElementById('tim-log-list');
  if(!list) return;
  const filterUser = document.getElementById('monitor-filter-user')?.value || '';
  const filterAction = document.getElementById('monitor-filter-action')?.value || '';
  const filterRange = document.getElementById('monitor-filter-range')?.value || 'all';

  let filtered = [...accountLogs];
  if(filterUser) filtered = filtered.filter(l => l.username === filterUser);
  if(filterAction) filtered = filtered.filter(l => (l.action||'').toLowerCase() === filterAction.toLowerCase());
  if(filterRange !== 'all'){
    const now = new Date();
    let cutoff;
    if(filterRange === 'today'){
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if(filterRange === '7d'){
      cutoff = new Date(now.getTime() - 7*24*60*60*1000);
    } else if(filterRange === '30d'){
      cutoff = new Date(now.getTime() - 30*24*60*60*1000);
    }
    filtered = filtered.filter(l => new Date(l.timestamp) >= cutoff);
  }

  if(filtered.length === 0){
    list.innerHTML = '<div class="monitor-empty-state">Tidak ada aktivitas sesuai filter.</div>';
    return;
  }
  list.innerHTML = filtered.slice(0, 100).map(l => {
    const t = new Date(l.timestamp);
    const timeStr = t.toLocaleDateString('id',{day:'2-digit',month:'short',year:'2-digit'})+' '+t.toLocaleTimeString('id',{hour:'2-digit',minute:'2-digit'});
    const action = (l.action||'').toLowerCase();
    let badgeClass = 'badge-edit';
    if(action === 'login') badgeClass = 'badge-login';
    else if(action === 'logout') badgeClass = 'badge-logout';
    else if(action === 'tambah akun') badgeClass = 'badge-tambah';
    else if(action === 'hapus akun') badgeClass = 'badge-hapus';
    else if(action === 'ganti password') badgeClass = 'badge-password';
    else if(action === 'ganti foto') badgeClass = 'badge-foto';
    else if(action === 'ganti bio') badgeClass = 'badge-bio';
    return `<div class="tim-log-item"><div class="tim-log-text"><span class="monitor-action-badge ${badgeClass}">${escapeHtml(l.action)}</span><b>${escapeHtml(l.username)}</b>${l.detail?' — '+escapeHtml(l.detail):''}</div><div class="tim-log-time">${timeStr}</div></div>`;
  }).join('');
}

function renderMonitorStats(){
  const container = document.getElementById('monitor-stats');
  if(!container) return;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekAgo = new Date(today.getTime() - 7*24*60*60*1000);

  const totalLogs = accountLogs.length;
  const todayLogs = accountLogs.filter(l => new Date(l.timestamp) >= todayStart).length;
  const loginsToday = accountLogs.filter(l => new Date(l.timestamp) >= todayStart && (l.action||'').toLowerCase() === 'login').length;
  const activeUsers = new Set(accountLogs.filter(l => new Date(l.timestamp) >= weekAgo).map(l => l.username)).size;

  container.innerHTML = `
    <div class="monitor-stat"><div class="monitor-stat-val">${totalLogs}</div><div class="monitor-stat-lbl">Total Aktivitas</div></div>
    <div class="monitor-stat"><div class="monitor-stat-val">${todayLogs}</div><div class="monitor-stat-lbl">Aktivitas Hari Ini</div></div>
    <div class="monitor-stat"><div class="monitor-stat-val">${loginsToday}</div><div class="monitor-stat-lbl">Login Hari Ini</div></div>
    <div class="monitor-stat"><div class="monitor-stat-val">${activeUsers}</div><div class="monitor-stat-lbl">User Aktif 7 Hari</div></div>
  `;
}

function populateLogFilterUsers(){
  const sel = document.getElementById('monitor-filter-user');
  if(!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">👤 Semua User</option>' +
    accounts.map(a => `<option value="${escapeHtml(a.username)}">${escapeHtml(a.nama || a.username)}</option>`).join('');
  sel.value = prev;
}

function exportLogCSV(){
  if(accountLogs.length === 0){ showToast('⚠ Belum ada log untuk diekspor'); return; }
  const header = 'Timestamp,Username,Action,Detail\n';
  const rows = accountLogs.map(l => {
    const detail = (l.detail||'').replace(/"/g,'""');
    return `"${l.timestamp}","${l.username}","${l.action}","${detail}"`;
  }).join('\n');
  const csv = header + rows;
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bm4_aktivitas_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Log berhasil diexport');
}

// ============================================================
// GALERI TIM RENDERING (v11 — Premium Elegan)
// ============================================================

// Bank kutipan properti / sales / motivasi kerja
const GALERI_QUOTES = [
  "Properti terbaik bukan yang termahal, tapi yang paling dicari.",
  "Setiap closing adalah cerita baru yang layak dirayakan.",
  "Lokasi bisa dihitung, tapi kepercayaan harus dibangun.",
  "Pasar tidak pernah tidur — yang tidur hanyalah kesempatan yang terlewat.",
  "Target bukan beban, target adalah undangan untuk bertumbuh.",
  "Hari ini satu langkah kecil, bulan depan satu penjualan besar.",
  "Rumah bukan hanya bangunan, tapi masa depan yang sedang dicicil.",
  "Kompetitor mengajari kita apa yang harus dilakukan lebih baik.",
  "Data berbicara, tapi intuisi yang menutup deal.",
  "Peta tanpa arah hanyalah gambar — strategi yang membuatnya bernilai.",
  "Senyum pertama menentukan kunjungan kedua.",
  "Yang membedakan kita bukan produk, tapi cara kita hadir.",
  "Negosiasi terbaik adalah ketika kedua pihak pulang tersenyum.",
  "Pelanggan membeli kenyamanan, bukan material bangunan.",
  "Konsistensi mengalahkan intensitas — setiap hari, setiap kali.",
  "Satu tim yang solid lebih kuat dari sepuluh bintang individu.",
  "Kerja keras itu wajib, kerja cerdas itu pilihan, kerja tuntas itu karakter.",
  "Mimpi besar dimulai dari langkah kecil yang dilakukan hari ini.",
  "Branch manager bukan jabatan, tapi tanggung jawab membawa tim naik.",
  "Peluang sering datang dalam bentuk pekerjaan yang tidak nyaman.",
  "Kegagalan hari ini adalah brief untuk kemenangan besok.",
  "Kolega hebat tidak dilahirkan — mereka dibentuk oleh kepercayaan.",
  "Jangan jual rumah, jual kehidupan di dalamnya.",
  "Setiap prospek layak diperlakukan seperti closing.",
  "Integritas lebih mahal dari komisi tertinggi sekalipun.",
  "Kalau mudah, semua orang akan melakukannya. Kalau sulit, kamulah yang dicari.",
  "Peta lokasi memberitahu di mana, tim yang hebat memberitahu mengapa.",
  "Hasil besar adalah akumulasi dari tindakan kecil yang tepat.",
  "Menang hari ini dimulai dari persiapan tadi malam.",
  "Kalau bukan sekarang, kapan lagi? Kalau bukan kita, siapa lagi?"
];

// Ambil kutipan random (opsional: kecualikan satu index)
function randomQuote(exclude){
  let idx;
  do { idx = Math.floor(Math.random() * GALERI_QUOTES.length); }
  while(idx === exclude && GALERI_QUOTES.length > 1);
  return { idx: idx, text: GALERI_QUOTES[idx] };
}

// Kutipan harian - seed pakai tanggal supaya satu hari sama untuk semua user
function dailyQuote(){
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth()+1) * 100 + d.getDate();
  const idx = seed % GALERI_QUOTES.length;
  return GALERI_QUOTES[idx];
}

// State untuk modal - simpan data user yang sedang dibuka
let gmodalCurrentUser = null;
let gmodalCurrentQuoteIdx = -1;

function renderGaleri(){
  const grid = document.getElementById('galeri-grid');
  if(!grid) return;
  grid.innerHTML = '';

  // Set kata hari ini
  const dailyEl = document.getElementById('galeri-daily-text');
  if(dailyEl) dailyEl.textContent = '"' + dailyQuote() + '"';

  accounts.forEach((a, idx) => {
    const card = document.createElement('div');
    card.className = 'galeri-card';
    const initial = (a.nama || a.username || '?').charAt(0).toUpperCase();
    const role = a.role || 'sales';
    const photoInner = a.foto
      ? renderFotoHtml(a.foto, escapeHtml(a.nama || ''))
      : `<div class="galeri-card-initial">${initial}</div>`;
    const bioHtml = a.bio
      ? `<div class="galeri-card-bio">"${escapeHtml(a.bio)}"</div>`
      : `<div class="galeri-card-bio empty">— Belum ada kata motivasi —</div>`;

    card.innerHTML = `
      <div class="galeri-card-photo ${role}">
        ${photoInner}
        <div class="galeri-card-badge ${role}">${roleLabel(role)}</div>
        <div class="galeri-card-hint">✦ Klik untuk kata hari ini</div>
      </div>
      <div class="galeri-card-body">
        <div class="galeri-card-name">${escapeHtml(a.nama || a.username)}</div>
        <div class="galeri-card-jabatan">${escapeHtml(a.jabatan || '-')}</div>
        <div class="galeri-card-divider"></div>
        ${bioHtml}
      </div>
    `;
    card.onclick = () => openGmodal(a.username);
    grid.appendChild(card);

    // Animasi masuk bertahap
    setTimeout(() => card.classList.add('show'), 60 * idx);
  });
}

// Buka modal dengan kutipan random
function openGmodal(username){
  const a = findAccount(username);
  if(!a) return;
  gmodalCurrentUser = a;

  const role = a.role || 'sales';
  const initial = (a.nama || a.username || '?').charAt(0).toUpperCase();
  const photoEl = document.getElementById('gmodal-photo');
  photoEl.className = 'gmodal-photo ' + role;
  // [v9 SECURITY] Pakai safeFotoSrc untuk validasi data URL/URL
  const safeFoto = safeFotoSrc(a.foto);
  const photoInner = safeFoto
    ? `<img src="${safeFoto}" alt="">`
    : `<div class="gmodal-photo-initial">${initial}</div>`;
  photoEl.innerHTML = photoInner + '<button class="gmodal-close" onclick="closeGmodal()">✕</button>';

  document.getElementById('gmodal-name').textContent = a.nama || a.username;
  document.getElementById('gmodal-jabatan').textContent = a.jabatan || '-';

  const q = randomQuote(-1);
  gmodalCurrentQuoteIdx = q.idx;
  document.getElementById('gmodal-quote').textContent = q.text;

  const bioEl = document.getElementById('gmodal-bio');
  if(a.bio){
    bioEl.className = 'gmodal-bio';
    bioEl.textContent = '— ' + a.bio;
  } else {
    bioEl.className = 'gmodal-bio empty';
    bioEl.textContent = '';
  }

  document.getElementById('gmodal-backdrop').classList.add('show');
}

// Ganti kutipan tanpa menutup modal
function refreshGmodalQuote(){
  const q = randomQuote(gmodalCurrentQuoteIdx);
  gmodalCurrentQuoteIdx = q.idx;
  const el = document.getElementById('gmodal-quote');
  // Efek fade cepat
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = q.text;
    el.style.opacity = '1';
  }, 150);
}

function closeGmodal(e){
  if(e && e.target && !e.target.classList.contains('gmodal-backdrop')) return;
  document.getElementById('gmodal-backdrop').classList.remove('show');
  gmodalCurrentUser = null;
}

// Tutup modal dengan tombol ESC
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape'){
    const m = document.getElementById('gmodal-backdrop');
    if(m && m.classList.contains('show')) closeGmodal();
  }
});

// ============================================================
// BIO HELPERS
// ============================================================
function updateBioCounter(inputId, counterId){
  const input = document.getElementById(inputId);
  const counter = document.getElementById(counterId);
  if(!input || !counter) return;
  const len = input.value.length;
  counter.textContent = `${len} / 150`;
  counter.style.color = len > 140 ? '#DC2626' : 'var(--faint)';
}

function saveBioChange(){
  if(!currentUser) return;
  const newBio = document.getElementById('set-bio').value.trim();
  if(newBio.length > 150){ showToast('⚠ Bio maksimal 150 karakter'); return; }
  const idx = accounts.findIndex(a => a.username === currentUser.username);
  if(idx >= 0){
    accounts[idx].bio = newBio;
    currentUser.bio = newBio;
    saveAccountsLocal();
    syncAccountsToSheets();
    logActivity(currentUser.username, 'ganti bio', 'User mengubah bio/motivasi');
    showToast('✓ Bio berhasil disimpan');
  }
}


// ─── SAFE FOTO HELPER (XSS prevention) ───────────────────
function safeFotoSrc(url){
  if(!url) return '';
  const s = String(url).trim();
  if(s.startsWith('data:image/')) return s;
  if(/^https?:\/\//i.test(s)) return s;
  return '';
}
function renderFotoHtml(url, alt, fallback){
  const src = safeFotoSrc(url);
  return src ? `<img src="${src}" alt="${alt||''}">` : (fallback || '');
}
// ──────────────────────────────────────────────────────────

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
