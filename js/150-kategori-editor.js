// Kategori Vs Anchor editor
// ═══════════════════════════════════════════════════════════════════════════════
// [v18 SECTIONS] Editor Kategori Vs Anchor — render & handlers
// ───────────────────────────────────────────────────────────────────────────────
// Editor ini hidup di Hub Formula → tab "⚖️ Kategori Vs Anchor".
// User bisa: tambah/hapus section, rename, ubah emoji, reorder (drag), edit row assignment.
// Semua perubahan buffered di VSA_SECTIONS_DRAFT dulu — baru commit ke VSA_SECTIONS saat Simpan.
// ═══════════════════════════════════════════════════════════════════════════════

let VSA_SECTIONS_DRAFT = null; // buffer: deep-clone dari VSA_SECTIONS saat editor dibuka
let _katRowEditTargetId = null; // section yang sedang di-edit row-nya
let _katDragSrcIdx = null;      // index sumber drag
const KAT_EMOJI_OPTIONS = ['📊','📍','🏠','💰','📢','📈','👥','🎯','🏆','⚖️','🗺️','🧭','🔍','💡','📋','📅','🏗️','🎨','🛒','🚗','🏥','🎓','🏬','🛣️','🏛️','💼','🌳','🏭','📁','⭐','🔥','💎'];

function renderKategoriEditor(){
  // Deep clone saat pertama buka (atau setelah simpan/reset)
  if(!VSA_SECTIONS_DRAFT) VSA_SECTIONS_DRAFT = JSON.parse(JSON.stringify(VSA_SECTIONS));

  const list = document.getElementById('kat-list');
  if(!list) return;

  list.innerHTML = VSA_SECTIONS_DRAFT.map((s, idx)=>{
    const availableRows = s.rows.filter(k => VSA_ROW_KEYS.includes(k));
    const rowCount = availableRows.length;
    const canDelete = VSA_SECTIONS_DRAFT.length > 1; // min 1 section
    return `
      <div class="kat-item" draggable="true" data-kat-idx="${idx}"
           ondragstart="katDragStart(event, ${idx})"
           ondragover="katDragOver(event, ${idx})"
           ondragleave="katDragLeave(event)"
           ondrop="katDrop(event, ${idx})"
           ondragend="katDragEnd(event)">
        <span class="kat-handle" title="Drag untuk urutkan">⇅</span>
        <span class="kat-emoji" onclick="openKatEmojiPicker(event, ${idx})" title="Ganti emoji">${s.emoji}</span>
        <input type="text" class="kat-name" value="${escapeHtml(s.name)}"
               oninput="updateKatName(${idx}, this.value)"
               placeholder="Nama section...">
        <span class="kat-rows-count">${rowCount} baris</span>
        <button class="kat-edit-btn ${rowCount>0?'has-active':''}" onclick="openKatRowEdit('${s.id}')">Edit baris</button>
        <button class="kat-del-btn" onclick="deleteKatSection(${idx})" ${canDelete?'':'disabled'} title="${canDelete?'Hapus section':'Minimal 1 section harus ada'}">🗑</button>
      </div>`;
  }).join('');

  // Update warning baris yang belum di-assign
  _updateUnassignedWarning();
}

function _updateUnassignedWarning(){
  const assigned = new Set();
  VSA_SECTIONS_DRAFT.forEach(s => s.rows.forEach(k => assigned.add(k)));
  const unassigned = VSA_ROW_KEYS.filter(k => !assigned.has(k));
  const warn = document.getElementById('kat-unassigned-warn');
  const cnt = document.getElementById('kat-unassigned-count');
  if(!warn || !cnt) return;
  if(unassigned.length){
    warn.style.display = '';
    cnt.textContent = unassigned.length;
    warn.title = 'Baris: ' + unassigned.map(k=>VSA_ROW_LABEL[k]||k).join(', ');
  } else {
    warn.style.display = 'none';
  }
}

function updateKatName(idx, val){
  if(!VSA_SECTIONS_DRAFT[idx]) return;
  VSA_SECTIONS_DRAFT[idx].name = val;
  // Tidak perlu re-render (input sudah sync)
}

function openKatEmojiPicker(ev, idx){
  ev.stopPropagation();
  // Hapus picker lama kalau ada
  const old = document.getElementById('kat-emoji-picker-active');
  if(old) old.remove();

  const picker = document.createElement('div');
  picker.className = 'kat-emoji-picker open';
  picker.id = 'kat-emoji-picker-active';
  picker.innerHTML = KAT_EMOJI_OPTIONS.map(e=>`<span onclick="selectKatEmoji(${idx}, '${e}')">${e}</span>`).join('');

  // Positioning — pakai getBoundingClientRect dari target (emoji span)
  const rect = ev.target.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.top = (rect.bottom + 4) + 'px';
  picker.style.left = rect.left + 'px';
  document.body.appendChild(picker);

  // Close saat klik di luar
  setTimeout(()=>{
    const closeHandler = (e)=>{
      if(!picker.contains(e.target)){
        picker.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 10);
}

function selectKatEmoji(idx, emoji){
  if(!VSA_SECTIONS_DRAFT[idx]) return;
  VSA_SECTIONS_DRAFT[idx].emoji = emoji;
  const picker = document.getElementById('kat-emoji-picker-active');
  if(picker) picker.remove();
  renderKategoriEditor();
}

function addKategoriSection(){
  // Generate id unik
  let idBase = 'section', n = 1;
  while(VSA_SECTIONS_DRAFT.some(s=>s.id===idBase+n)) n++;
  VSA_SECTIONS_DRAFT.push({
    id: idBase+n,
    emoji: '📁',
    name: 'Section Baru',
    rows: []
  });
  renderKategoriEditor();
}

function deleteKatSection(idx){
  if(VSA_SECTIONS_DRAFT.length <= 1){
    showToast('⚠ Minimal 1 section harus ada');
    return;
  }
  const sec = VSA_SECTIONS_DRAFT[idx];
  if(!sec) return;
  if(!confirm(`Hapus section "${sec.emoji} ${sec.name}"?\nBaris di dalamnya akan jadi un-assigned — bisa kamu pindahkan ke section lain lewat "Edit baris".`)) return;
  VSA_SECTIONS_DRAFT.splice(idx, 1);
  renderKategoriEditor();
}

// Drag & drop handlers
function katDragStart(ev, idx){
  _katDragSrcIdx = idx;
  ev.dataTransfer.effectAllowed = 'move';
  try{ ev.dataTransfer.setData('text/plain', String(idx)); }catch(_){}
  const el = ev.currentTarget;
  if(el) el.classList.add('dragging');
}
function katDragOver(ev, idx){
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  if(_katDragSrcIdx === null || _katDragSrcIdx === idx) return;
  const el = ev.currentTarget;
  if(el) el.classList.add('drag-over');
}
function katDragLeave(ev){
  const el = ev.currentTarget;
  if(el) el.classList.remove('drag-over');
}
function katDrop(ev, idx){
  ev.preventDefault();
  document.querySelectorAll('.kat-item').forEach(el=>el.classList.remove('drag-over','dragging'));
  if(_katDragSrcIdx === null || _katDragSrcIdx === idx) return;
  const moved = VSA_SECTIONS_DRAFT.splice(_katDragSrcIdx, 1)[0];
  VSA_SECTIONS_DRAFT.splice(idx, 0, moved);
  _katDragSrcIdx = null;
  renderKategoriEditor();
}
function katDragEnd(ev){
  document.querySelectorAll('.kat-item').forEach(el=>el.classList.remove('drag-over','dragging'));
  _katDragSrcIdx = null;
}

// Sub-modal: edit row assignment untuk 1 section
function openKatRowEdit(sectionId){
  const sec = VSA_SECTIONS_DRAFT.find(s=>s.id===sectionId);
  if(!sec) return;
  _katRowEditTargetId = sectionId;

  document.getElementById('kat-rowedit-title').innerHTML = `${sec.emoji} ${escapeHtml(sec.name)}`;
  document.getElementById('kat-rowedit-sub').textContent = 'Centang baris yang ingin muncul di section ini. Badge menunjukkan section lain yang sudah punya baris tersebut.';

  // Grouping untuk readability — pakai kelompok natural dari urutan VSA_ROW_DEFS
  const GROUPS = [
    {name:'Skor', prefix:['skor_']},
    {name:'Jarak POI', prefix:['poi_','dist_']},
    {name:'Data Proyek', prefix:['proj_']},
    {name:'Tapera — Realisasi', keys:['tpr_avg','tpr_trend','tpr_total','tpr_flpp']},
    {name:'Tapera — Spesifikasi', keys:['tpr_harga','tpr_lt','tpr_lb','tpr_tenor','tpr_um','tpr_bank']},
    {name:'Tapera — Profil Pembeli', keys:['tpr_pek','tpr_usia','tpr_peng','tpr_gender']}
  ];

  // Helper: di section lain mana aja key ini sudah ter-assign?
  const whereElse = (key) => {
    return VSA_SECTIONS_DRAFT
      .filter(s => s.id !== sectionId && s.rows.includes(key))
      .map(s => `${s.emoji} ${s.name}`);
  };

  const groupsHtml = GROUPS.map(g=>{
    const keys = g.keys
      ? g.keys
      : VSA_ROW_KEYS.filter(k => g.prefix.some(pref => k.startsWith(pref)));
    if(!keys.length) return '';
    const items = keys.map(k=>{
      const checked = sec.rows.includes(k) ? 'checked' : '';
      const elsewhere = whereElse(k);
      const badge = elsewhere.length
        ? `<span class="assign-badge" title="Juga ada di section lain">${elsewhere[0]}${elsewhere.length>1?' +'+(elsewhere.length-1):''}</span>`
        : '';
      return `<label class="kat-rowedit-opt">
        <input type="checkbox" ${checked} data-rowkey="${k}">
        <span class="rowlbl">${VSA_ROW_LABEL[k]||k}</span>
        ${badge}
      </label>`;
    }).join('');
    return `<div class="kat-rowedit-group">
      <div class="kat-rowedit-group-lbl">${g.name}</div>
      ${items}
    </div>`;
  }).join('');

  document.getElementById('kat-rowedit-body').innerHTML = groupsHtml;
  document.getElementById('kat-rowedit-overlay').classList.add('open');
}

function applyKatRowEdit(){
  const sec = VSA_SECTIONS_DRAFT.find(s=>s.id===_katRowEditTargetId);
  if(!sec){ closeKatRowEdit(); return; }

  // Kumpulkan key yang checked, preserve urutan di VSA_ROW_KEYS (konsisten)
  const checkboxes = document.querySelectorAll('#kat-rowedit-body input[type="checkbox"]');
  const selected = new Set();
  checkboxes.forEach(cb => { if(cb.checked) selected.add(cb.dataset.rowkey); });

  // Pertahankan urutan lama untuk key yang masih tercentang,
  // lalu tambahkan key baru (yg belum ada di rows lama) di akhir sesuai urutan VSA_ROW_KEYS
  const oldOrdered = sec.rows.filter(k => selected.has(k));
  const oldSet = new Set(oldOrdered);
  const newKeys = VSA_ROW_KEYS.filter(k => selected.has(k) && !oldSet.has(k));
  sec.rows = [...oldOrdered, ...newKeys];

  closeKatRowEdit();
  renderKategoriEditor();
}

function closeKatRowEdit(){
  document.getElementById('kat-rowedit-overlay').classList.remove('open');
  _katRowEditTargetId = null;
}

function resetKategoriDefault(){
  if(!confirm('Reset semua section ke default (4P + Performance + Market Insight)?\nNama dan urutan section custom akan hilang.')) return;
  VSA_SECTIONS_DRAFT = JSON.parse(JSON.stringify(VSA_SECTIONS_DEFAULT));
  renderKategoriEditor();
}

function saveKategoriChanges(){
  // Validasi nama section tidak boleh kosong
  const empty = VSA_SECTIONS_DRAFT.find(s => !String(s.name||'').trim());
  if(empty){
    alert('Nama section tidak boleh kosong. Silakan isi dulu.');
    return;
  }

  // Commit draft → state aktual
  VSA_SECTIONS = JSON.parse(JSON.stringify(VSA_SECTIONS_DRAFT));
  _saveVsaSections();

  // Kalau section aktif sudah tidak ada, fallback ke yg pertama
  if(!VSA_SECTIONS.some(s=>s.id===vsaActiveSectionId)){
    vsaActiveSectionId = VSA_SECTIONS[0]?.id || 'ringkasan';
    _saveVsaActiveSection();
  }

  // Reset draft supaya next open pakai state baru
  VSA_SECTIONS_DRAFT = null;

  // Re-render tabel Vs Anchor kalau sedang ke-buka
  const p = perumahan.find(x=>x.id===selectedId);
  if(p && document.getElementById('tab-compare').innerHTML.trim()) renderDetailCompare(p);

  showToast('✅ Kategori Vs Anchor disimpan');
  document.getElementById('admin-overlay').classList.remove('open');
}

// Reset draft saat modal Hub Formula ditutup tanpa simpan (supaya next open fresh)
(function _hookHubClose(){
  const overlay = document.getElementById('admin-overlay');
  if(!overlay) return;
  // Tambahkan observer kalau class 'open' hilang — reset draft
  const observer = new MutationObserver(()=>{
    if(!overlay.classList.contains('open')){
      VSA_SECTIONS_DRAFT = null;
    }
  });
  observer.observe(overlay, {attributes:true, attributeFilter:['class']});
})();
