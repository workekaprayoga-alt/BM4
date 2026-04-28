// Team, gallery, settings
// ============================================================
// MODAL TAMBAH/EDIT AKUN
// ============================================================
function openAccModal(mode, username){
  editingAccUsername = null;
  document.getElementById('acc-modal-title').textContent = mode === 'edit' ? 'Edit Akun' : 'Tambah Akun Baru';
  // Reset form
  document.getElementById('acc-username').value = '';
  document.getElementById('acc-password').value = '';
  document.getElementById('acc-nama').value = '';
  document.getElementById('acc-jabatan').value = '';
  document.getElementById('acc-bio').value = '';
  document.getElementById('acc-role').value = 'sales';
  updateBioCounter('acc-bio','acc-bio-counter');
  document.querySelectorAll('#acc-access-grid input').forEach(cb => {
    cb.checked = cb.value === 'dashboard';
  });

  if(mode === 'edit' && username){
    const a = findAccount(username);
    if(a){
      editingAccUsername = a.username;
      document.getElementById('acc-username').value = a.username;
      // [v9 SECURITY] Password field kosong saat edit — pengisian opsional.
      // Kosongkan = password tidak berubah; Isi = ganti ke password baru.
      document.getElementById('acc-password').value = '';
      document.getElementById('acc-password').placeholder = 'Kosongkan jika tidak ingin ganti password';
      document.getElementById('acc-nama').value = a.nama || '';
      document.getElementById('acc-jabatan').value = a.jabatan || '';
      document.getElementById('acc-bio').value = a.bio || '';
      document.getElementById('acc-role').value = a.role || 'sales';
      updateBioCounter('acc-bio','acc-bio-counter');
      document.querySelectorAll('#acc-access-grid input').forEach(cb => {
        cb.checked = (a.akses || []).includes(cb.value) || cb.value === 'dashboard';
      });
    }
  } else {
    document.getElementById('acc-password').placeholder = 'Minimal 8 karakter';
    onRoleChange(); // set checkbox default sesuai role
  }
  document.getElementById('acc-modal').classList.add('open');
}

function closeAccModal(){
  document.getElementById('acc-modal').classList.remove('open');
  editingAccUsername = null;
}

function onRoleChange(){
  const role = document.getElementById('acc-role').value;
  const preset = {
    bm:['dashboard','analisa','strategi','sales','konstruksi','legal','finance'],
    sales:['dashboard','sales'],
    strategi:['dashboard','strategi'],
    konstruksi:['dashboard','konstruksi'],
    legal:['dashboard','legal'],
    finance:['dashboard','finance']
  }[role] || ['dashboard'];
  document.querySelectorAll('#acc-access-grid input').forEach(cb => {
    cb.checked = preset.includes(cb.value);
  });
}

async function saveAccount(){
  const username = document.getElementById('acc-username').value.trim().toLowerCase();
  const password = document.getElementById('acc-password').value;
  const nama = document.getElementById('acc-nama').value.trim();
  const jabatan = document.getElementById('acc-jabatan').value.trim();
  const bio = document.getElementById('acc-bio').value.trim();
  const role = document.getElementById('acc-role').value;
  const akses = Array.from(document.querySelectorAll('#acc-access-grid input:checked')).map(cb => cb.value);

  if(!username){ showToast('⚠ Username wajib diisi'); return; }
  // [v9 SECURITY] Saat edit, password kosong = tidak ganti. Saat tambah, wajib min 8.
  if(!editingAccUsername){
    if(!password || password.length < 8){ showToast('⚠ Password minimal 8 karakter'); return; }
  } else {
    if(password && password.length < 8){ showToast('⚠ Password baru minimal 8 karakter (atau kosongkan untuk tidak ganti)'); return; }
  }
  if(!nama){ showToast('⚠ Nama wajib diisi'); return; }
  if(bio.length > 150){ showToast('⚠ Bio maksimal 150 karakter'); return; }

  // Cek duplikat username (kecuali saat edit username yang sama)
  if(editingAccUsername !== username){
    if(accounts.some(a => a.username.toLowerCase() === username)){
      showToast('⚠ Username sudah dipakai'); return;
    }
  }

  // [v9 SECURITY] Tentukan password final:
  // - Tambah akun: hash password baru
  // - Edit akun, field password kosong: pakai password lama apa adanya
  // - Edit akun, field password diisi: hash password baru
  let finalPassword;
  if(editingAccUsername){
    const old = accounts.find(a => a.username === editingAccUsername);
    if(!password){
      finalPassword = old ? old.password : '';
    } else {
      finalPassword = await hashPassword(password);
    }
  } else {
    finalPassword = await hashPassword(password);
  }

  if(editingAccUsername){
    const idx = accounts.findIndex(a => a.username === editingAccUsername);
    if(idx >= 0){
      const old = accounts[idx];
      accounts[idx] = {...old, username, password: finalPassword, nama, jabatan, bio, role, akses};
      logActivity(currentUser?.username || 'system', 'edit akun', `Mengubah akun: ${username}`);
      showToast('✓ Akun diperbarui');
    }
  } else {
    accounts.push({username, password: finalPassword, nama, jabatan, bio, role, akses, foto:''});
    logActivity(currentUser?.username || 'system', 'tambah akun', `Akun baru: ${username}`);
    showToast('✓ Akun ditambahkan');
  }

  saveAccountsLocal();
  syncAccountsToSheets();
  closeAccModal();
  renderTim();
}

function deleteAccount(username){
  if(!confirm('Hapus akun "'+username+'"?')) return;
  const idx = accounts.findIndex(a => a.username === username);
  if(idx < 0) return;
  if(accounts[idx].username === currentUser?.username){
    showToast('⚠ Tidak bisa menghapus akun sendiri'); return;
  }
  accounts.splice(idx, 1);
  logActivity(currentUser?.username || 'system', 'hapus akun', `Akun dihapus: ${username}`);
  saveAccountsLocal();
  // [v12.1 FIX] Sync ke Sheets + explicit soft delete (pakai no-cors)
  syncAccountsToSheets();
  if(USE_SHEETS){
    try{
      fetch(GAS_URL, {
        method:'POST',
        mode:'no-cors',
        headers:{'Content-Type':'text/plain'},
        body: gasPost({action:'deleteAccount', username:username})
      }).catch(e=>console.warn('Gagal soft-delete account:',e));
    }catch(e){}
  }
  renderTim();
  showToast('🗑 Akun dihapus');
}

// ============================================================
// PENGATURAN AKUN (untuk user sendiri)
// ============================================================
function openSettings(){
  if(!currentUser) return;
  const avEl = document.getElementById('settings-avatar');
  if(currentUser.foto){
    avEl.innerHTML = renderFotoHtml(currentUser.foto, '');
  } else {
    avEl.textContent = (currentUser.nama || currentUser.username || '?').charAt(0).toUpperCase();
  }
  document.getElementById('settings-name').textContent = currentUser.nama || currentUser.username;
  document.getElementById('settings-meta').textContent = (currentUser.jabatan||'') + ' · @' + currentUser.username;
  document.getElementById('set-bio').value = currentUser.bio || '';
  updateBioCounter('set-bio','set-bio-counter');
  document.getElementById('set-pw-old').value = '';
  document.getElementById('set-pw-new').value = '';
  document.getElementById('set-pw-new2').value = '';

  // [v11+] Formula Potensi Unit — hanya BM yang lihat
  const formulaSection=document.getElementById('settings-formula-section');
  if(formulaSection){
    if(currentUser.role==='bm'){
      formulaSection.style.display='block';
      document.getElementById('set-formula-pct').value=POTENSI_PCT;
      document.getElementById('set-formula-pct-disp').textContent=POTENSI_PCT;
      document.getElementById('set-formula-pct-disp2').textContent=POTENSI_PCT;
      document.getElementById('set-formula-sample').textContent=fmt(calcPotensiUnit(5000));
    } else {
      formulaSection.style.display='none';
    }
  }

  // [v9 SECURITY] Master Password section — hanya BM
  const masterpwSection = document.getElementById('settings-masterpw-section');
  if(masterpwSection){
    if(currentUser.role === 'bm'){
      masterpwSection.style.display = 'block';
      document.getElementById('set-masterpw-new').value = '';
      document.getElementById('set-masterpw-new2').value = '';
      refreshMasterPwStatus();
    } else {
      masterpwSection.style.display = 'none';
    }
  }

  // [v11 BACKUP] Backup & Restore section — hanya BM
  const backupSection = document.getElementById('settings-backup-section');
  if(backupSection){
    if(currentUser.role === 'bm'){
      backupSection.style.display = 'block';
      refreshBackupStatus();
    } else {
      backupSection.style.display = 'none';
    }
  }

  showScreen('s-settings');
}

// [v9 SECURITY] Master password UI helpers
function refreshMasterPwStatus(){
  const statusEl = document.getElementById('set-masterpw-status');
  if(!statusEl) return;
  const mpw = getMasterPassword();
  if(mpw){
    statusEl.style.background = '#ECFDF5';
    statusEl.style.borderColor = '#86EFAC';
    statusEl.style.color = '#15803D';
    statusEl.innerHTML = '✓ Status: <b>Sudah diset</b> — master login aktif';
  } else {
    statusEl.style.background = '#FEF2F2';
    statusEl.style.borderColor = '#FECACA';
    statusEl.style.color = '#B91C1C';
    statusEl.innerHTML = '⚠️ Status: <b>Belum diset</b> — fitur master login nonaktif';
  }
}
function saveMasterPassword(){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const n1 = document.getElementById('set-masterpw-new').value;
  const n2 = document.getElementById('set-masterpw-new2').value;
  if(!n1 || n1.length < 8){ showToast('⚠ Master password minimal 8 karakter'); return; }
  if(n1 !== n2){ showToast('⚠ Konfirmasi tidak cocok'); return; }
  if(setMasterPassword(n1)){
    logActivity(currentUser.username, 'ganti master pw', 'Master password diubah');
    document.getElementById('set-masterpw-new').value = '';
    document.getElementById('set-masterpw-new2').value = '';
    refreshMasterPwStatus();
    showToast('✓ Master password disimpan');
  } else {
    showToast('⚠ Gagal menyimpan master password');
  }
}
function clearMasterPassword(){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  if(!confirm('Hapus master password?\nFitur login tanpa username akan dinonaktifkan.')) return;
  try {
    localStorage.removeItem('bm4_master_pw');
    logActivity(currentUser.username, 'hapus master pw', 'Master password dihapus');
    refreshMasterPwStatus();
    showToast('🗑 Master password dihapus');
  } catch(e){ showToast('⚠ Gagal menghapus'); }
}

// ============================================================
// [v11 BACKUP] BACKUP & RESTORE SYSTEM
// ============================================================
const BACKUP_LAST_KEY = 'bm4_backup_last';
const BACKUP_VERSION = '1.0'; // untuk kompatibilitas jangka panjang

// Update panel backup: tampilkan tanggal backup terakhir + ringkasan data
function refreshBackupStatus(){
  const lastEl = document.getElementById('backup-last-date');
  const warnEl = document.getElementById('backup-warning');
  if(!lastEl) return;

  const last = localStorage.getItem(BACKUP_LAST_KEY);
  if(last){
    const d = new Date(last);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    const dateStr = formatTanggalID(last, 'short');
    const timeStr = d.toLocaleTimeString('id', {hour:'2-digit',minute:'2-digit'});
    let relative = '';
    if(diffDays === 0) relative = ' (hari ini)';
    else if(diffDays === 1) relative = ' (kemarin)';
    else if(diffDays < 30) relative = ` (${diffDays} hari lalu)`;
    else relative = ` (${Math.floor(diffDays/30)} bulan lalu)`;
    lastEl.textContent = `${dateStr}, ${timeStr}${relative}`;

    // Warning kalau >7 hari
    if(warnEl) warnEl.style.display = diffDays > 7 ? 'block' : 'none';
  } else {
    lastEl.textContent = 'Belum pernah';
    if(warnEl){
      warnEl.textContent = '⚠️ Belum ada backup. Disarankan backup sekarang sebagai langkah pencegahan.';
      warnEl.style.display = 'block';
    }
  }

  // Update ringkasan jumlah data
  const setCnt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  setCnt('backup-cnt-accounts', accounts.length);
  setCnt('backup-cnt-logs', accountLogs.length);
  setCnt('backup-cnt-perumahan', perumahan.length);
  setCnt('backup-cnt-poi', poi.length);
  setCnt('backup-cnt-tp', tpTargets.length);
}

// Build payload backup — kumpulkan semua data aplikasi
function buildBackupPayload(){
  return {
    _meta: {
      version: BACKUP_VERSION,
      appVersion: 'v11',
      exportedAt: new Date().toISOString(),
      exportedBy: currentUser?.username || 'unknown',
      note: 'BM4 Property Intelligence — backup lengkap. Jangan edit manual.'
    },
    accounts: accounts,
    accountLogs: accountLogs,
    perumahan: perumahan,
    poi: poi,
    tpTargets: tpTargets,
    formula: FORMULA,
    potensiPct: POTENSI_PCT,
    masterPwHash: localStorage.getItem('bm4_master_pw') || null,
  };
}

// Export: generate file JSON dan trigger download
function exportBackup(){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  try {
    const payload = buildBackupPayload();
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Naming file: bm4_backup_YYYY-MM-DD_HHMM.json
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    const filename = `bm4_backup_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;

    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    // Catat waktu backup terakhir
    localStorage.setItem(BACKUP_LAST_KEY, new Date().toISOString());
    logActivity(currentUser.username, 'export backup', `File: ${filename}`);
    refreshBackupStatus();
    showToast(`✓ Backup berhasil: ${filename}`);
  } catch(e){
    console.error('Export backup gagal:', e);
    showToast('⚠ Gagal membuat backup: ' + (e.message || 'unknown'));
  }
}

// Validasi struktur file backup sebelum restore
function validateBackupPayload(payload){
  if(!payload || typeof payload !== 'object') return 'File tidak valid (bukan JSON object)';
  if(!payload._meta || !payload._meta.version) return 'File bukan backup BM4 (missing _meta.version)';
  // Cek kompatibilitas versi
  const ver = payload._meta.version;
  if(ver !== BACKUP_VERSION && !ver.startsWith('1.')){
    return `Versi backup (${ver}) tidak kompatibel dengan aplikasi saat ini (${BACKUP_VERSION})`;
  }
  // Cek field wajib
  const required = ['accounts', 'perumahan', 'poi', 'tpTargets'];
  for(const key of required){
    if(!Array.isArray(payload[key])){
      return `Field "${key}" hilang atau bukan array`;
    }
  }
  return null; // valid
}

// Handler saat user pilih file untuk import
function handleBackupImport(event){
  if(currentUser?.role !== 'bm'){ showToast('⚠ Hanya BM'); return; }
  const file = event.target.files[0];
  if(!file) return;

  // Reset input biar bisa pilih file sama lagi
  event.target.value = '';

  // Batasi ukuran file (10 MB)
  if(file.size > 10 * 1024 * 1024){
    showToast('⚠ File terlalu besar (maksimal 10 MB)');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    let payload;
    try {
      payload = JSON.parse(e.target.result);
    } catch(err){
      showToast('⚠ File tidak valid (bukan JSON)');
      return;
    }

    const validationError = validateBackupPayload(payload);
    if(validationError){
      showToast('⚠ ' + validationError);
      return;
    }

    // Tampilkan preview & konfirmasi sebelum restore
    showRestorePreviewModal(payload, file.name);
  };
  reader.onerror = () => showToast('⚠ Gagal membaca file');
  reader.readAsText(file);
}

// Modal preview sebelum restore (dengan konfirmasi eksplisit)
function showRestorePreviewModal(payload, filename){
  const meta = payload._meta || {};
  const exportedAt = meta.exportedAt ? formatTanggalID(meta.exportedAt, 'short') + ' ' + new Date(meta.exportedAt).toLocaleTimeString('id',{hour:'2-digit',minute:'2-digit'}) : '—';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:white;border-radius:14px;max-width:500px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.4);overflow:hidden;">
      <div style="padding:20px 24px;background:#FEF2F2;border-bottom:1px solid #FECACA;">
        <div style="font-size:17px;font-weight:700;color:#B91C1C;margin-bottom:4px;">⚠️ Konfirmasi Restore Data</div>
        <div style="font-size:12px;color:#991B1B;line-height:1.5;">Semua data saat ini akan <b>diganti</b> dengan isi file backup. Aksi ini tidak bisa dibatalkan.</div>
      </div>
      <div style="padding:20px 24px;">
        <div style="font-size:11px;color:var(--muted);line-height:1.6;margin-bottom:14px;">
          <div style="font-weight:700;color:var(--text);margin-bottom:4px;">📁 ${escapeHtml(filename)}</div>
          <div>Versi: <b>${escapeHtml(meta.version || '—')}</b> · App: <b>${escapeHtml(meta.appVersion || '—')}</b></div>
          <div>Dibuat: <b>${exportedAt}</b> oleh <b>${escapeHtml(meta.exportedBy || '—')}</b></div>
        </div>
        <div style="background:#F1F5F9;border-radius:8px;padding:10px 12px;font-size:11px;line-height:1.6;margin-bottom:14px;">
          <div style="font-weight:700;margin-bottom:4px;color:var(--muted);font-size:10px;letter-spacing:0.5px;text-transform:uppercase;">Isi backup:</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;">
            <div>👥 ${(payload.accounts||[]).length} akun</div>
            <div>📝 ${(payload.accountLogs||[]).length} log</div>
            <div>🏘️ ${(payload.perumahan||[]).length} perumahan</div>
            <div>📍 ${(payload.poi||[]).length} POI</div>
            <div>🏭 ${(payload.tpTargets||[]).length} target pasar</div>
            <div>⚙️ Formula & settings</div>
          </div>
        </div>
        <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:11px;color:#92400E;line-height:1.5;">
          <b>Yang akan terjadi:</b>
          <ul style="margin:4px 0 0 18px;padding:0;">
            <li>Data di perangkat ini akan diganti dengan data dari file backup</li>
            <li>Jika sinkron ke Sheets aktif, data baru akan di-push ke Sheets</li>
            <li>Anda mungkin perlu login ulang jika akun Anda berubah</li>
          </ul>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="restore-cancel" style="flex:1;background:#E2E8F0;color:var(--text);border:none;border-radius:8px;padding:11px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;">Batal</button>
          <button id="restore-confirm" style="flex:1;background:#DC2626;color:white;border:none;border-radius:8px;padding:11px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;">Ya, Restore Sekarang</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('restore-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
  document.getElementById('restore-confirm').onclick = () => {
    overlay.remove();
    performRestore(payload);
  };
}

// Eksekusi restore — overwrite semua data dengan isi payload
async function performRestore(payload){
  try {
    showToast('⏳ Restoring data...');

    // Replace data in-memory
    accounts = payload.accounts || [];
    accountLogs = payload.accountLogs || [];
    perumahan.length = 0; (payload.perumahan || []).forEach(p => perumahan.push(p));
    poi.length = 0; (payload.poi || []).forEach(p => poi.push(p));
    tpTargets = payload.tpTargets || [];

    // Formula & settings
    if(payload.formula && typeof payload.formula === 'object'){
      Object.assign(FORMULA, payload.formula);
    }
    if(typeof payload.potensiPct === 'number' && payload.potensiPct > 0 && payload.potensiPct <= 100){
      POTENSI_PCT = payload.potensiPct;
      localStorage.setItem(POTENSI_KEY, String(POTENSI_PCT));
    }
    if(payload.masterPwHash){
      localStorage.setItem('bm4_master_pw', payload.masterPwHash);
    }

    // Persist ke localStorage
    saveAccountsLocal();
    saveLogsLocal();
    localStorage.setItem('bm4_tp_targets', JSON.stringify(tpTargets));
    try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(e){}

    // Recalculate scoring
    recalcAll();

    // Sync ke Sheets (best effort, tidak blocking kalau gagal)
    if(USE_SHEETS){
      try {
        await Promise.all([
          fetch(GAS_URL, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body:gasPost({action:'savePerumahan', rows:perumahan})}),
          fetch(GAS_URL, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body:gasPost({action:'savePoi', rows:poi})}),
          fetch(GAS_URL, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body:gasPost({action:'saveTargetPasar', rows:tpTargets})}),
          syncAccountsToSheets(),
        ]);
      } catch(e){
        console.warn('Sync to Sheets gagal saat restore:', e);
      }
    }

    logActivity(currentUser?.username || 'system', 'restore backup', `Restore dari file backup (${accounts.length} akun, ${perumahan.length} perumahan)`);
    showToast('✓ Restore berhasil! Halaman akan di-reload...');

    // Reload halaman setelah 2 detik supaya semua tampilan fresh
    setTimeout(() => { location.reload(); }, 2000);
  } catch(e){
    console.error('Restore gagal:', e);
    showToast('⚠ Restore gagal: ' + (e.message || 'unknown'));
  }
}

// Placeholder lama agar tidak ganda — openSettings asli di atas sudah di-override

function previewFormulaPotensi(){
  const v=parseFloat(document.getElementById('set-formula-pct').value)||0;
  document.getElementById('set-formula-pct-disp').textContent=v;
  document.getElementById('set-formula-pct-disp2').textContent=v;
  document.getElementById('set-formula-sample').textContent=fmt(Math.round(5000*v/100));
}

function saveFormulaPotensi(){
  const v=parseFloat(document.getElementById('set-formula-pct').value);
  if(isNaN(v)||v<=0||v>100){showToast('⚠ Persentase harus 1–100');return;}
  savePotensiFormula(v);
  logActivity(currentUser?.username||'system','edit',`Ubah formula potensi unit: ${v}%`);
  showToast(`✓ Formula disimpan: ${v}%`);
  // Refresh detail target jika terbuka
  if(selectedTpId!==null){
    const t=tpTargets.find(x=>x.id===selectedTpId);
    if(t){
      const el=document.getElementById('tp-d-potensi');
      if(el)el.textContent=`~${calcPotensiUnit(t.karyawan)} unit (est. ${POTENSI_PCT}%)`;
    }
  }
}

function closeSettings(){
  showScreen('s-app');
}

function uploadAvatar(event){
  const file = event.target.files[0];
  if(!file) return;
  // [v9 SECURITY] Validasi MIME type — hanya image/* yang diperbolehkan
  if(!file.type || !file.type.startsWith('image/')){
    showToast('⚠ File harus berupa gambar (JPG/PNG/WebP)');
    return;
  }
  if(file.size > 10 * 1024 * 1024){ // batas 10MB — nanti auto-compress
    showToast('⚠ Ukuran foto maksimal 10MB');
    return;
  }
  showToast('⚙️ Memproses foto...');
  _compressAvatar(file).then(dataUrl => {
    // [v9 SECURITY] Double-check: pastikan hasil base64 benar-benar image
    if(!dataUrl.startsWith('data:image/')){
      showToast('⚠ File tidak valid');
      return;
    }
    const sizeKB = Math.round((dataUrl.length * 0.75) / 1024);
    // Simpan ke current user
    const idx = accounts.findIndex(a => a.username === currentUser.username);
    if(idx >= 0){
      accounts[idx].foto = dataUrl;
      currentUser.foto = dataUrl;
      saveAccountsLocal();
      syncAccountsToSheets();
      logActivity(currentUser.username, 'ganti foto', `User mengubah foto profil (${sizeKB}KB)`);
      document.getElementById('settings-avatar').innerHTML = `<img src="${dataUrl}" alt="">`;
      document.getElementById('tb-profile-avatar').innerHTML = `<img src="${dataUrl}" alt="">`;
      showToast(`✓ Foto profil diperbarui (${sizeKB}KB)`);
    }
  }).catch(err => {
    console.error('Compress avatar error:', err);
    showToast('⚠️ Gagal memproses foto: ' + err.message);
  });
}

async function savePasswordChange(){
  const oldPw = document.getElementById('set-pw-old').value;
  const newPw = document.getElementById('set-pw-new').value;
  const newPw2 = document.getElementById('set-pw-new2').value;

  // [v9 SECURITY] Pakai verifyPassword — kompatibel dengan hash + plaintext legacy
  const oldOk = await verifyPassword(oldPw, currentUser.password);
  if(!oldOk){ showToast('⚠ Password lama salah'); return; }
  if(!newPw || newPw.length < 8){ showToast('⚠ Password baru minimal 8 karakter'); return; }
  if(newPw !== newPw2){ showToast('⚠ Konfirmasi password tidak cocok'); return; }

  const idx = accounts.findIndex(a => a.username === currentUser.username);
  if(idx >= 0){
    const hashed = await hashPassword(newPw);
    accounts[idx].password = hashed;
    currentUser.password = hashed;
    saveAccountsLocal();
    syncAccountsToSheets();
    logActivity(currentUser.username, 'ganti password', 'User mengubah password sendiri');
    showToast('✓ Password berhasil diubah');
    document.getElementById('set-pw-old').value = '';
    document.getElementById('set-pw-new').value = '';
    document.getElementById('set-pw-new2').value = '';
  }
}
