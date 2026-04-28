// Editor perumahan/POI, smart input, sync
// ============================================================
// EDITOR DATA
// ============================================================
const KAT_EMOJI_E={rs:'🏥',kampus:'🎓',mall:'🏬',tol:'🛣️',pemda:'🏛️',industri:'💼',publik:'🌳'};
const KAT_LBL_E={rs:'RS',kampus:'U',mall:'M',tol:'T',pemda:'G',industri:'I',publik:'P'};
// ============================================================
// [v12 EDITOR] Editor Data — State, Validation, Search, Sort, Dirty, Discard
// ============================================================

// Indonesia bounding box (sedikit longgar untuk buffer perbatasan)
const EDITOR_LAT_MIN = -11.5, EDITOR_LAT_MAX = 6.5;
const EDITOR_LNG_MIN = 94.5,  EDITOR_LNG_MAX = 141.5;

// State editor — semua yang tidak ada di data model
const editorState = {
  dirty: false,                 // ada perubahan belum tersinkron ke Sheets
  syncing: false,               // sedang sync
  snapshot: null,               // {perumahan, poi} terakhir yang tersinkron — untuk discard
  search: { perumahan:'', poi:'' },
  sort:   { perumahan:{key:null,dir:1}, poi:{key:null,dir:1} },
};

function _snapshotData(){
  // deep clone minimal: data record adalah plain object/array primitif
  return {
    perumahan: perumahan.map(p=>({...p})),
    poi: poi.map(x=>({...x})),
  };
}

function setEditorDirty(v){
  editorState.dirty = !!v;
  const badge=document.getElementById('editor-dirty-badge');
  const txt=document.getElementById('editor-dirty-text');
  const btnSync=document.getElementById('btn-sync-now');
  const btnDiscard=document.getElementById('btn-discard');
  if(!badge) return; // editor belum dirender
  if(v){
    badge.classList.remove('clean');
    txt.textContent='Belum tersinkron';
    if(btnSync) btnSync.disabled=false;
    if(btnDiscard) btnDiscard.disabled=false;
  } else {
    badge.classList.add('clean');
    txt.textContent='Tersinkron';
    if(btnSync) btnSync.disabled=true;
    if(btnDiscard) btnDiscard.disabled=true;
  }
}

function markDirtyAndPersist(){
  // Simpan ke localStorage (supaya aman kalau tab ditutup), TIDAK auto-sync ke Sheets
  try{localStorage.setItem('bm4_data',JSON.stringify({perumahan,poi}));}catch(e){}
  setEditorDirty(true);
}

// Validasi lat/lng: return {ok, msg}
function validateLat(v){
  const n=parseFloat(v);
  if(isNaN(n)) return {ok:false,msg:'Lat tidak valid'};
  if(n<EDITOR_LAT_MIN||n>EDITOR_LAT_MAX) return {ok:false,msg:`Lat di luar Indonesia (${EDITOR_LAT_MIN}..${EDITOR_LAT_MAX})`};
  return {ok:true,value:n};
}
function validateLng(v){
  const n=parseFloat(v);
  if(isNaN(n)) return {ok:false,msg:'Lng tidak valid'};
  if(n<EDITOR_LNG_MIN||n>EDITOR_LNG_MAX) return {ok:false,msg:`Lng di luar Indonesia (${EDITOR_LNG_MIN}..${EDITOR_LNG_MAX})`};
  return {ok:true,value:n};
}

// Handler inline edit untuk field lat/lng (dengan validasi visual)
function editCoordP(idx,field,inp){
  const res = field==='lat'?validateLat(inp.value):validateLng(inp.value);
  if(!res.ok){
    inp.classList.add('invalid');
    inp.title=res.msg;
    showToast('⚠ '+res.msg);
    return;
  }
  inp.classList.remove('invalid');
  inp.title='';
  perumahan[idx][field]=res.value;
  markDirtyAndPersist();
}
function editCoordPoi(idx,field,inp){
  const res = field==='lat'?validateLat(inp.value):validateLng(inp.value);
  if(!res.ok){
    inp.classList.add('invalid');
    inp.title=res.msg;
    showToast('⚠ '+res.msg);
    return;
  }
  inp.classList.remove('invalid');
  inp.title='';
  poi[idx][field]=res.value;
  markDirtyAndPersist();
}

// ============================================================
// [v13 SMART-INPUT] Helper parse link Google Maps / koordinat + Mini-map controller
// REUSABLE: dipakai di Editor (perumahan & POI) dan Modal Target Pasar
// ============================================================

/**
 * Parse input user (link Maps atau koordinat mentah) → {ok, lat, lng, src, shortlink?}
 * Format yang dikenali:
 *  1. "-6.5578, 107.8131" (klik kanan Google Maps → copy koordinat)
 *  2. "...@-6.5578,107.8131..." (link panjang Google Maps)
 *  3. "...?q=-6.5578,107.8131" atau "...&q=-6.5578,107.8131"
 *  4. "...!3d-6.5578!4d107.8131..." (data parameter Google Maps)
 *  5. Shortlink maps.app.goo.gl → ok:false, shortlink:true (user harus resolve dulu)
 */
function parseMapsInput(raw){
  if(!raw) return {ok:false,msg:'Kosong'};
  const s = String(raw).trim();

  // Deteksi shortlink dulu — tidak bisa di-parse JS karena CORS
  if(/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(s)){
    return {ok:false,shortlink:true,url:s,msg:'Shortlink tidak bisa otomatis — klik tombol "Buka Link" untuk resolve'};
  }

  // Pola 1: koordinat langsung "lat, lng"
  let m = s.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
  if(m) return _validateParsed(+m[1],+m[2],'koordinat langsung');

  // Pola 2: @lat,lng (format paling umum di URL Maps)
  m = s.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if(m) return _validateParsed(+m[1],+m[2],'link Maps (@)');

  // Pola 3: !3dlat!4dlng (data param)
  m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if(m) return _validateParsed(+m[1],+m[2],'link Maps (data)');

  // Pola 4: ?q=lat,lng atau &q=lat,lng atau &ll=lat,lng
  m = s.match(/[?&](?:q|ll|query)=(-?\d+\.?\d+),\s*(-?\d+\.?\d+)/);
  if(m) return _validateParsed(+m[1],+m[2],'link Maps (?q=)');

  // Gagal
  return {ok:false,msg:'Format tidak dikenal. Paste koordinat "lat, lng" atau link panjang Maps.'};
}

function _validateParsed(lat,lng,src){
  if(isNaN(lat)||isNaN(lng)) return {ok:false,msg:'Koordinat tidak valid'};
  if(lat<EDITOR_LAT_MIN||lat>EDITOR_LAT_MAX||lng<EDITOR_LNG_MIN||lng>EDITOR_LNG_MAX){
    return {ok:false,msg:`Koordinat di luar Indonesia (lat=${lat}, lng=${lng})`};
  }
  return {ok:true,lat,lng,src};
}

/**
 * SmartInput: wire up a smart-input block to a lat/lng field pair.
 * Parameter:
 *  - inputId: id input text smart-input
 *  - btnId: id tombol "Ambil"
 *  - fbId: id div feedback
 *  - helpBtnId, helpBoxId: tombol & box bantuan
 *  - latFieldId, lngFieldId: target form field
 *  - onPick: callback(lat, lng) — untuk update mini-map
 */
function wireSmartInput(cfg){
  const {inputId,btnId,fbId,helpBtnId,helpBoxId,latFieldId,lngFieldId,onPick}=cfg;
  const inp=document.getElementById(inputId);
  const btn=document.getElementById(btnId);
  const fb=document.getElementById(fbId);
  const helpBtn=document.getElementById(helpBtnId);
  const helpBox=document.getElementById(helpBoxId);
  if(!inp||!btn||!fb) return; // komponen tidak ada di DOM

  const handleParse=()=>{
    const val=inp.value.trim();
    if(!val){fb.className='smart-input-fb warn';fb.textContent='⚠ Kosong. Paste link atau koordinat dulu.';return;}
    const r=parseMapsInput(val);
    if(r.ok){
      fb.className='smart-input-fb ok';
      fb.innerHTML=`✓ Terbaca dari <b>${r.src}</b>: <b>${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}</b>`;
      // Isi field
      const lEl=document.getElementById(latFieldId),gEl=document.getElementById(lngFieldId);
      if(lEl){lEl.value=r.lat.toFixed(7);lEl.classList.add('filled');}
      if(gEl){gEl.value=r.lng.toFixed(7);gEl.classList.add('filled');}
      // Callback (untuk mini-map)
      if(typeof onPick==='function') onPick(r.lat,r.lng);
    } else if(r.shortlink){
      fb.className='smart-input-fb warn';
      fb.innerHTML=`⚠ Shortlink terdeteksi — tidak bisa otomatis.<br>Klik <b>"Buka Link"</b> di bawah, lalu copy URL lengkap (yang ada <code>@lat,lng</code>) dari tab yang terbuka, paste kembali ke sini.`;
      // Tambahkan tombol sementara buat buka link
      _ensureShortlinkOpener(fb,r.url);
    } else {
      fb.className='smart-input-fb err';
      fb.textContent='❌ '+r.msg;
    }
  };

  btn.onclick=handleParse;
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();handleParse();}});
  // Auto-parse saat paste (jeda pendek supaya value sudah ter-update)
  inp.addEventListener('paste',()=>setTimeout(handleParse,50));

  if(helpBtn && helpBox){
    helpBtn.onclick=()=>helpBox.classList.toggle('open');
  }
}

function _ensureShortlinkOpener(fb,url){
  // Cek apakah tombol sudah ada
  if(fb.querySelector('.shortlink-open')) return;
  const btn=document.createElement('a');
  btn.className='smart-input-btn alt shortlink-open';
  btn.href=url;
  btn.target='_blank';
  btn.rel='noopener noreferrer';
  btn.textContent='↗ Buka Link';
  btn.style.cssText='display:inline-block;margin-top:6px;text-decoration:none;padding:4px 10px;font-size:10px;';
  fb.appendChild(document.createElement('br'));
  fb.appendChild(btn);
}

/**
 * MiniMap controller: simple wrapper over Leaflet untuk 1 pin draggable.
 * Satu instance per lokasi (editor atau modal TP).
 */
function createMiniMap(containerId,opts={}){
  const el=document.getElementById(containerId);
  if(!el) return null;
  // Guard kalau sudah ada map di element itu (hindari double init)
  if(el._leaflet_id) return el._miniMapInstance || null;

  const center=opts.center||[-6.5578,107.8131]; // default Subang
  const zoom=opts.zoom||13;
  // [v17 fix] zoomControl opt-out supaya mini-map editor bisa non-aktifkan tombol +/-
  // (yang kadang "lepas" ke pojok kiri atas editor overlay saat container 0x0 di init).
  // User tetap bisa zoom pakai scroll wheel / pinch.
  const useZoomCtrl = opts.zoomControl !== false;
  const map=L.map(containerId,{zoomControl:useZoomCtrl,attributionControl:false}).setView(center,zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'© OSM'
  }).addTo(map);

  let pin=null;
  let refMarkers=[]; // marker referensi (kompetitor lain) — optional

  const api={
    map,
    setPin(lat,lng,{fit=true,label='📍 Lokasi baru'}={}){
      if(pin) map.removeLayer(pin);
      pin=L.marker([lat,lng],{draggable:true,title:label}).addTo(map);
      pin.bindTooltip('Drag untuk koreksi',{permanent:false,direction:'top'});
      pin.on('drag',e=>{
        const p=e.target.getLatLng();
        if(typeof opts.onMove==='function') opts.onMove(p.lat,p.lng);
      });
      if(fit) map.setView([lat,lng],16);
    },
    clearPin(){if(pin){map.removeLayer(pin);pin=null;}},
    addReferences(items,style={}){
      // items: [{lat,lng,label,color?}]
      refMarkers.forEach(m=>map.removeLayer(m));
      refMarkers=[];
      items.forEach(it=>{
        const color=it.color||style.color||'#6B7280';
        const icon=L.divIcon({
          html:`<div style="width:10px;height:10px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);opacity:0.75;"></div>`,
          iconSize:[10,10],iconAnchor:[5,5],className:''
        });
        const m=L.marker([it.lat,it.lng],{icon,zIndexOffset:-200}).addTo(map);
        if(it.label) m.bindTooltip(it.label,{direction:'top',offset:[0,-5]});
        refMarkers.push(m);
      });
    },
    focus(lat,lng,zoom=16){map.setView([lat,lng],zoom);},
    invalidateSize(){setTimeout(()=>map.invalidateSize(),50);},
    destroy(){map.remove();},
  };
  // Klik peta → set pin + callback
  map.on('click',e=>{
    const {lat,lng}=e.latlng;
    api.setPin(lat,lng,{fit:false});
    if(typeof opts.onPick==='function') opts.onPick(lat,lng);
  });
  el._miniMapInstance=api;
  return api;
}

// Instance holders (lazy init saat editor/modal dibuka pertama kali)
let editorMiniMap=null;   // mini-map dalam editor (dipakai perumahan & POI)
let tpMiniMap=null;       // mini-map dalam modal target pasar


function toggleEditor(){
  const ov=document.getElementById('editor-overlay');const btn=document.getElementById('btn-editor');
  const willOpen=!ov.classList.contains('open');
  if(!willOpen && editorState.dirty){
    if(!confirm('Ada perubahan yang belum tersinkron ke Sheets. Tutup editor? (Data tetap tersimpan lokal, tapi belum terkirim ke Sheets)')) return;
  }
  ov.classList.toggle('open',willOpen);
  btn.classList.toggle('active',willOpen);
  btn.textContent=willOpen?'✖ Tutup Editor':'✏️ Edit Data';
  if(willOpen){
    // Ambil snapshot saat membuka (kalau belum ada) untuk basis discard
    if(!editorState.snapshot) editorState.snapshot=_snapshotData();
    renderEPerumahan();renderEPoi();
    setEditorDirty(editorState.dirty); // refresh badge state
    // [v13 SMART-INPUT] Init mini-map & wire smart-input (lazy, sekali saja)
    setTimeout(()=>{_initEditorMiniMapOnce();_wireEditorSmartInputsOnce();},60);
  }
}

// [v13 SMART-INPUT] Init mini-map editor (perumahan + POI) — lazy, sekali
function _initEditorMiniMapOnce(){
  const elP=document.getElementById('editor-minimap');
  if(elP && !elP._leaflet_id){
    editorMiniMap=createMiniMap('editor-minimap',{
      center:[-6.5578,107.8131],zoom:13,zoomControl:false,
      onPick:(lat,lng)=>{
        const lEl=document.getElementById('enp-lat'),gEl=document.getElementById('enp-lng');
        if(lEl){lEl.value=lat.toFixed(7);lEl.classList.add('filled');}
        if(gEl){gEl.value=lng.toFixed(7);gEl.classList.add('filled');}
        const fb=document.getElementById('smi-p-fb');
        if(fb){fb.className='smart-input-fb ok';fb.innerHTML=`✓ Dari klik peta: <b>${lat.toFixed(6)}, ${lng.toFixed(6)}</b>`;}
      },
      onMove:(lat,lng)=>{
        const lEl=document.getElementById('enp-lat'),gEl=document.getElementById('enp-lng');
        if(lEl){lEl.value=lat.toFixed(7);lEl.classList.add('filled');}
        if(gEl){gEl.value=lng.toFixed(7);gEl.classList.add('filled');}
      }
    });
    if(editorMiniMap){
      editorMiniMap.addReferences(perumahan.map(p=>({lat:p.lat,lng:p.lng,label:p.nama,color:(typeof TIPE_COLOR!=='undefined'?TIPE_COLOR[p.tipe]:null)||'#9CA3AF'})));
      // [v17 fix] Paksa invalidateSize multi-pass supaya Leaflet recompute posisi control.
      // Kalau tidak, tombol +/- bisa "lepas" ke pojok kiri atas editor overlay karena
      // container sempat 0×0 saat init.
      setTimeout(()=>{ try{ editorMiniMap.map.invalidateSize(true); }catch(_){} }, 20);
      setTimeout(()=>{ try{ editorMiniMap.map.invalidateSize(true); }catch(_){} }, 200);
    }
  }
  const elPoi=document.getElementById('editor-minimap-poi');
  if(elPoi && !elPoi._leaflet_id){
    const poiMap=createMiniMap('editor-minimap-poi',{
      center:[-6.5578,107.8131],zoom:13,zoomControl:false,
      onPick:(lat,lng)=>{
        const lEl=document.getElementById('epoi-lat'),gEl=document.getElementById('epoi-lng');
        if(lEl){lEl.value=lat.toFixed(7);lEl.classList.add('filled');}
        if(gEl){gEl.value=lng.toFixed(7);gEl.classList.add('filled');}
        const fb=document.getElementById('smi-poi-fb');
        if(fb){fb.className='smart-input-fb ok';fb.innerHTML=`✓ Dari klik peta: <b>${lat.toFixed(6)}, ${lng.toFixed(6)}</b>`;}
      },
      onMove:(lat,lng)=>{
        const lEl=document.getElementById('epoi-lat'),gEl=document.getElementById('epoi-lng');
        if(lEl){lEl.value=lat.toFixed(7);lEl.classList.add('filled');}
        if(gEl){gEl.value=lng.toFixed(7);gEl.classList.add('filled');}
      }
    });
    if(poiMap){
      poiMap.addReferences(poi.map(x=>({lat:x.lat,lng:x.lng,label:x.nama,color:(typeof KAT_COLOR!=='undefined'?KAT_COLOR[x.kat]:null)||'#9CA3AF'})));
      elPoi._poiMiniMap=poiMap;
      // [v17 fix] Paksa invalidateSize multi-pass (sama seperti editorMiniMap)
      setTimeout(()=>{ try{ poiMap.map.invalidateSize(true); }catch(_){} }, 20);
      setTimeout(()=>{ try{ poiMap.map.invalidateSize(true); }catch(_){} }, 200);
    }
  }
}

let _smartInputWiredEditor=false;
function _wireEditorSmartInputsOnce(){
  if(_smartInputWiredEditor) return;
  _smartInputWiredEditor=true;
  wireSmartInput({
    inputId:'smi-p-input',btnId:'smi-p-btn',fbId:'smi-p-fb',
    helpBtnId:'smi-p-helpbtn',helpBoxId:'smi-p-help',
    latFieldId:'enp-lat',lngFieldId:'enp-lng',
    onPick:(lat,lng)=>{if(editorMiniMap)editorMiniMap.setPin(lat,lng);}
  });
  wireSmartInput({
    inputId:'smi-poi-input',btnId:'smi-poi-btn',fbId:'smi-poi-fb',
    helpBtnId:'smi-poi-helpbtn',helpBoxId:'smi-poi-help',
    latFieldId:'epoi-lat',lngFieldId:'epoi-lng',
    onPick:(lat,lng)=>{
      const el=document.getElementById('editor-minimap-poi');
      if(el && el._poiMiniMap) el._poiMiniMap.setPin(lat,lng);
    }
  });
}
function switchEtab(name,el){
  document.getElementById('etab-perumahan').style.display=name==='perumahan'?'':'none';
  document.getElementById('etab-poi').style.display=name==='poi'?'':'none';
  const taperaEl=document.getElementById('etab-tapera');
  if(taperaEl) taperaEl.style.display=name==='tapera'?'':'none';
  const skbEl=document.getElementById('etab-sikumbang');
  if(skbEl) skbEl.style.display=name==='sikumbang'?'':'none';
  document.querySelectorAll('.editor-tabs .etab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  // [v13 SMART-INPUT] Leaflet butuh invalidateSize kalau container sebelumnya display:none
  setTimeout(()=>{
    if(name==='perumahan' && editorMiniMap) editorMiniMap.invalidateSize();
    if(name==='poi'){
      const e=document.getElementById('editor-minimap-poi');
      if(e && e._poiMiniMap) e._poiMiniMap.invalidateSize();
    }
    if(name==='tapera') initTaperaEditor();
    if(name==='sikumbang' && typeof initSikumbangEditor === 'function') initSikumbangEditor();
  },50);
}

// ============================================================
// [P0 TAPERA] Editor form untuk data Tapera per perumahan
// ============================================================
function initTaperaEditor(){
  const sel = document.getElementById('tpr-select');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = perumahan.map(p => {
    const has = p.tapera ? '✓' : '—';
    return `<option value="${p.id}">${has} ${escapeHtml(p.nama)}</option>`;
  }).join('');
  if(current && perumahan.some(p => String(p.id) === String(current))) sel.value = current;
  loadTaperaForm(sel.value);
  loadMarketCtxForm();
  // Update counter badge di tab editor
  const cnt = document.getElementById('ecnt-tapera');
  if(cnt){
    const n = perumahan.filter(p => p.tapera).length;
    cnt.textContent = n ? `(${n})` : '';
  }
  // [v2 TPR] Restore mode terakhir (card/wizard) dari localStorage
  try {
    const savedMode = localStorage.getItem('bm4_tpr2_mode') || 'card';
    if(savedMode === 'wizard') tpr2SwitchMode('wizard');
    else tpr2SwitchMode('card');
  } catch(_){ tpr2SwitchMode('card'); }
}


// Render form input untuk custom fields per section (dipanggil di loadTaperaForm)
function renderTaperaCustomFields(p){
  // [v3] Render custom fields per section ke kontainer #tpr-section-fields-{secid}
  // Backward compat: kontainer #tpr-custom-fields-container masih ada (display:none) untuk
  // function lama yang mungkin masih reference, tapi tidak digunakan untuk display.
  const sections = ['place','product','price','promotion','performance','gtm'];
  const custData = (p && p.customFields) || {};

  sections.forEach(secId => {
    const host = document.getElementById(`tpr-section-fields-${secId}`);
    if(!host) return;
    const fields = (FM_STATE.customFields[secId] || []).filter(f => !_isFieldHidden(f.id));
    if(!fields.length){ host.innerHTML = ''; return; }
    const rowsHtml = fields.map(f => {
      const currentVal = custData[f.id];
      const inputId = `tpr-custom-${f.id}`;
      let inputHtml = '';
      switch(f.type){
        case 'number':
        case 'number_km':
        case 'percent': {
          const v = currentVal != null ? escapeHtml(String(currentVal)) : '';
          inputHtml = `<input type="number" step="any" id="${inputId}" value="${v}" data-cf-id="${f.id}" data-cf-type="${f.type}" placeholder="Angka">`;
          break;
        }
        case 'yesno': {
          const yesChecked = currentVal === true ? 'checked' : '';
          const noChecked = currentVal === false ? 'checked' : '';
          const emptyChecked = (currentVal == null) ? 'checked' : '';
          inputHtml = `<div style="display:flex;gap:10px;padding-top:4px;">
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:400;cursor:pointer;"><input type="radio" name="${inputId}" value="" ${emptyChecked} data-cf-id="${f.id}" data-cf-type="yesno">—</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:400;cursor:pointer;"><input type="radio" name="${inputId}" value="yes" ${yesChecked} data-cf-id="${f.id}" data-cf-type="yesno">Ya</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:400;cursor:pointer;"><input type="radio" name="${inputId}" value="no" ${noChecked} data-cf-id="${f.id}" data-cf-type="yesno">Tidak</label>
          </div>`;
          break;
        }
        case 'dropdown': {
          const opts = (f.options||[]).map(o => `<option value="${escapeHtml(o)}" ${currentVal===o?'selected':''}>${escapeHtml(o)}</option>`).join('');
          inputHtml = `<select id="${inputId}" data-cf-id="${f.id}" data-cf-type="dropdown"><option value="">— Pilih —</option>${opts}</select>`;
          break;
        }
        case 'multi': {
          const arr = Array.isArray(currentVal) ? currentVal : [];
          const checks = (f.options||[]).map(o => {
            const isChecked = arr.includes(o) ? 'checked' : '';
            return `<label style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:400;cursor:pointer;margin-right:8px;"><input type="checkbox" value="${escapeHtml(o)}" ${isChecked} data-cf-id="${f.id}" data-cf-type="multi" data-cf-multi="1">${escapeHtml(o)}</label>`;
          }).join('');
          inputHtml = `<div style="padding:4px 0;">${checks}</div>`;
          break;
        }
        case 'date': {
          const v = currentVal ? escapeHtml(String(currentVal)) : '';
          inputHtml = `<input type="date" id="${inputId}" value="${v}" data-cf-id="${f.id}" data-cf-type="date">`;
          break;
        }
        case 'list':
        case 'text':
        default: {
          const v = currentVal != null ? escapeHtml(String(currentVal)) : '';
          inputHtml = `<input type="text" id="${inputId}" value="${v}" data-cf-id="${f.id}" data-cf-type="${f.type}" placeholder="${escapeHtml(f.desc||'')}">`;
        }
      }
      return `<div class="ef" style="margin-bottom:8px;">
        <label>${f.label} ${f.inScore?'<span style="font-size:9px;color:#059669;margin-left:3px;">✓ ke skor</span>':''}</label>
        ${inputHtml}
      </div>`;
    }).join('');
    host.innerHTML = `<div class="tpr2-custom-divider">
        <span class="tpr2-custom-label">+ Custom field (dari Field Manager)</span>
      </div>
      <div class="tpr2-grid-2">${rowsHtml}</div>`;
  });
}

// Baca value dari form custom fields
function _readTaperaCustomFields(){
  const result = {};
  const container = document.getElementById('tpr-custom-fields-container');
  if(!container) return result;
  // Text/number/dropdown/date inputs
  container.querySelectorAll('input[data-cf-id], select[data-cf-id]').forEach(el => {
    const id = el.dataset.cfId;
    const type = el.dataset.cfType;
    if(type === 'multi'){
      // handled below
      return;
    }
    if(type === 'yesno'){
      if(el.checked){
        const v = el.value;
        if(v === 'yes') result[id] = true;
        else if(v === 'no') result[id] = false;
        // else: kosong — skip (jangan set)
      }
      return;
    }
    if(type === 'number' || type === 'number_km' || type === 'percent'){
      const raw = el.value.trim();
      if(raw === '') return;
      const n = parseFloat(raw);
      if(!isNaN(n)) result[id] = n;
      return;
    }
    const raw = (el.value||'').trim();
    if(raw !== '') result[id] = raw;
  });
  // Multi checkboxes — group by data-cf-id
  const multiIds = new Set();
  container.querySelectorAll('input[data-cf-multi="1"]').forEach(el => multiIds.add(el.dataset.cfId));
  multiIds.forEach(id => {
    const checked = container.querySelectorAll(`input[data-cf-multi="1"][data-cf-id="${id}"]:checked`);
    const vals = Array.from(checked).map(el => el.value);
    if(vals.length) result[id] = vals;
  });
  return result;
}

function loadTaperaForm(id){
  const p = perumahan.find(x => String(x.id) === String(id));
  const formEl = document.getElementById('tpr-form');
  const statusEl = document.getElementById('tpr-status');
  if(!p){ if(formEl) formEl.style.display = 'none'; return; }
  if(formEl) formEl.style.display = 'block';
  const t = p.tapera || {};
  // [TPR-IDENTITAS] Auto-fill nama perumahan dari profil + tahun realisasi + kab/kota
  const setVal0 = (id, v) => { const el = document.getElementById(id); if(el) el.value = v == null ? '' : v; };
  setVal0('tpr-nama-perumahan', p.nama || '');
  setVal0('tpr-tahun-realisasi', t.tahunRealisasi || '');
  setVal0('tpr-kab-kota', t.kabKota || '');
  document.getElementById('tpr-total').value = t.totalRealisasi || '';
  document.getElementById('tpr-nominal').value = t.nominalFLPP || '';
  const bulananStr = (t.realisasiBulanan || []).map(b => `${b.bulan}:${b.unit}`).join(', ');
  document.getElementById('tpr-bulanan').value = bulananStr;
  document.getElementById('tpr-harga').value = t.hargaRange || '';
  document.getElementById('tpr-lt').value = t.luasTanah || '';
  document.getElementById('tpr-lb').value = t.luasBangunan || '';
  document.getElementById('tpr-tenor').value = t.tenorDominan || '';
  document.getElementById('tpr-um').value = t.uangMukaRange || '';
  document.getElementById('tpr-bank').value = t.bankDominan || '';
  const profil = t.profilPembeli || {};
  document.getElementById('tpr-pekerjaan').value = _profilToStr(profil.pekerjaan);
  document.getElementById('tpr-usia').value = _profilToStr(profil.usia);
  document.getElementById('tpr-penghasilan').value = _profilToStr(profil.penghasilan);
  document.getElementById('tpr-gender').value = _profilToStr(profil.gender);
  // [TAHAP1] Promotion
  const promo = t.promotion || {};
  const setVal = (id, v) => { const el = document.getElementById(id); if(el) el.value = v == null ? '' : v; };
  setVal('tpr-promo-aktif', promo.promoAktif);
  setVal('tpr-promo-periode', promo.periode);
  setVal('tpr-promo-bonus', promo.bonus);
  setVal('tpr-promo-iklan', promo.iklanPlatform);
  setVal('tpr-promo-bb', promo.billboard);
  // [TAHAP1] Go-to-Market
  const gtm = t.gtm || {};
  setVal('tpr-gtm-mkt', gtm.marketingInhouse);
  setVal('tpr-gtm-kanal', gtm.strukturKanal);
  setVal('tpr-gtm-agent', gtm.jumlahAgent);
  setVal('tpr-gtm-fee-mkt', gtm.feeMarketing);
  setVal('tpr-gtm-fee-agt', gtm.feeAgent);
  setVal('tpr-gtm-dev', gtm.brandDeveloper);
  // [TAHAP4B-2] Custom fields
  try { renderTaperaCustomFields(p); } catch(e){ console.warn('custom fields render err', e); }
  // Status badge
  if(statusEl){
    if(t._dummy) statusEl.textContent = '🧪 Dummy data';
    else if(t.lastSynced) statusEl.textContent = `✓ Update ${t.lastSynced}`;
    else if(p.tapera) statusEl.textContent = '✓ Ada data';
    else statusEl.textContent = 'Belum ada data';
  }
  // [v2 TPR] Re-render UI baru (card summaries + wizard live preview)
  try { tpr2RefreshAll(); } catch(e){ console.warn('tpr2 refresh err', e); }
}

function saveTaperaForm(){
  const id = document.getElementById('tpr-select').value;
  const p = perumahan.find(x => String(x.id) === String(id));
  if(!p){ showToast('⚠ Perumahan tidak ditemukan'); return; }
  // [v2 TPR] Sebelum save, sync dari mode aktif ke field hidden ID-lama
  // (kalau user terakhir edit di mode card visual, pastikan textarea bulanan
  //  & input pekerjaan/usia/penghasilan/gender ter-update dulu)
  try { tpr2FlushVisualToRaw(); } catch(_){}

  const total = parseInt(document.getElementById('tpr-total').value) || 0;
  const nominal = parseFloat(document.getElementById('tpr-nominal').value) || 0;
  const bulanan = _parseBulanan(document.getElementById('tpr-bulanan').value);
  const profil = {};
  const pek = _parseProfil(document.getElementById('tpr-pekerjaan').value); if(pek) profil.pekerjaan = pek;
  const usia = _parseProfil(document.getElementById('tpr-usia').value); if(usia) profil.usia = usia;
  const pen = _parseProfil(document.getElementById('tpr-penghasilan').value); if(pen) profil.penghasilan = pen;
  const gen = _parseProfil(document.getElementById('tpr-gender').value); if(gen) profil.gender = gen;
  p.tapera = {
    lastSynced: new Date().toISOString().slice(0,10),
    tahunRealisasi: (function(){ const v = parseInt(document.getElementById('tpr-tahun-realisasi')?.value); return isNaN(v) ? null : v; })(),
    kabKota: (document.getElementById('tpr-kab-kota')?.value || '').trim().toUpperCase(),
    totalRealisasi: total,
    nominalFLPP: nominal,
    realisasiBulanan: bulanan,
    hargaRange: document.getElementById('tpr-harga').value.trim(),
    luasTanah: document.getElementById('tpr-lt').value.trim(),
    luasBangunan: document.getElementById('tpr-lb').value.trim(),
    tenorDominan: document.getElementById('tpr-tenor').value.trim(),
    uangMukaRange: document.getElementById('tpr-um').value.trim(),
    bankDominan: document.getElementById('tpr-bank').value.trim(),
    profilPembeli: profil,
    promotion: {
      promoAktif: document.getElementById('tpr-promo-aktif')?.value.trim() || '',
      periode: document.getElementById('tpr-promo-periode')?.value.trim() || '',
      bonus: document.getElementById('tpr-promo-bonus')?.value.trim() || '',
      iklanPlatform: document.getElementById('tpr-promo-iklan')?.value.trim() || '',
      billboard: document.getElementById('tpr-promo-bb')?.value.trim() || ''
    },
    gtm: {
      marketingInhouse: (function(){ const v = parseInt(document.getElementById('tpr-gtm-mkt')?.value); return isNaN(v) ? null : v; })(),
      strukturKanal: document.getElementById('tpr-gtm-kanal')?.value.trim() || '',
      jumlahAgent: (function(){ const v = parseInt(document.getElementById('tpr-gtm-agent')?.value); return isNaN(v) ? null : v; })(),
      feeMarketing: document.getElementById('tpr-gtm-fee-mkt')?.value.trim() || '',
      feeAgent: document.getElementById('tpr-gtm-fee-agt')?.value.trim() || '',
      brandDeveloper: document.getElementById('tpr-gtm-dev')?.value.trim() || ''
    }
  };
  // Custom fields
  try {
    const cust = _readTaperaCustomFields();
    if(Object.keys(cust).length){
      p.customFields = cust;
    } else {
      delete p.customFields;
    }
  } catch(e){ console.warn('custom save err', e); }
  try { localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); } catch(_){}
  if(typeof setEditorDirty === 'function') try { setEditorDirty(true); } catch(_){}
  initTaperaEditor();
  showToast(`✓ Data Tapera "${p.nama}" disimpan`);
  if(typeof selectedId !== 'undefined' && selectedId === p.id && typeof renderDetailOverview === 'function'){
    try { renderDetailOverview(p); } catch(_){}
  }
}

function _profilToStr(obj){
  if(!obj) return '';
  return Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(', ');
}

function _parseProfil(s){
  if(!s || !s.trim()) return null;
  const out = {};
  s.split(',').forEach(pair => {
    const [k, v] = pair.split(':').map(x => x.trim());
    if(k && v !== undefined && !isNaN(parseFloat(v))) out[k] = parseFloat(v);
  });
  return Object.keys(out).length ? out : null;
}

function _parseBulanan(s){
  if(!s || !s.trim()) return [];
  const out = [];
  s.split(',').forEach(pair => {
    const [bulan, unit] = pair.split(':').map(x => x.trim());
    if(bulan && /^\d{4}-\d{2}$/.test(bulan) && unit !== undefined && !isNaN(parseInt(unit))){
      out.push({ bulan, unit: parseInt(unit) });
    }
  });
  return out.sort((a, b) => a.bulan.localeCompare(b.bulan));
}
function clearTaperaData(){
  const id=document.getElementById('tpr-select').value;
  const p=perumahan.find(x=>String(x.id)===String(id));
  if(!p || !p.tapera) return;
  if(!confirm(`Hapus data Tapera untuk "${p.nama}"?`)) return;
  delete p.tapera;
  try{ localStorage.setItem('bm4_data', JSON.stringify({perumahan, poi})); }catch(_){}
  initTaperaEditor();
  showToast('🗑 Data Tapera dihapus');
}
function loadMarketCtxForm(){
  const m=MARKET_CONTEXT||{};
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=v==null?'':v; };
  set('mctx-kab', m.kabupaten);
  set('mctx-totperum', m.totalPerumahanTerdaftar);
  set('mctx-totunit', m.totalUnit);
  set('mctx-terjual', m.totalTerjual);
  set('mctx-kavling', m.totalKavling);
  set('mctx-ready', m.totalReadyStock);
  set('mctx-subsidi', m.pctSubsidi);
  set('mctx-komersil', m.pctKomersil);
}
function saveMarketCtxForm(){
  const getN=(id)=>{ const v=parseFloat(document.getElementById(id)?.value); return isNaN(v)?0:v; };
  MARKET_CONTEXT={
    ...MARKET_CONTEXT,
    kabupaten: document.getElementById('mctx-kab').value.trim()||'—',
    totalPerumahanTerdaftar: getN('mctx-totperum'),
    totalUnit: getN('mctx-totunit'),
    totalTerjual: getN('mctx-terjual'),
    totalKavling: getN('mctx-kavling'),
    totalReadyStock: getN('mctx-ready'),
    pctSubsidi: getN('mctx-subsidi'),
    pctKomersil: getN('mctx-komersil'),
    lastSynced: new Date().toISOString().slice(0,10)
  };
  saveMarketContext();
  showToast('✓ Market Context disimpan');
}


// ── Search ────────────────────────────────────────────────
function onSearchPerumahan(v){
  editorState.search.perumahan=v.trim().toLowerCase();
  document.getElementById('clear-search-p').classList.toggle('show',!!v);
  renderEPerumahan();
}
function clearSearchPerumahan(){
  document.getElementById('search-perumahan').value='';
  onSearchPerumahan('');
}
function onSearchPoi(v){
  editorState.search.poi=v.trim().toLowerCase();
  document.getElementById('clear-search-poi').classList.toggle('show',!!v);
  renderEPoi();
}
function clearSearchPoi(){
  document.getElementById('search-poi').value='';
  onSearchPoi('');
}

// ── Sort ───────────────────────────────────────────────────
function sortPerumahan(key){
  const s=editorState.sort.perumahan;
  if(s.key===key) s.dir=-s.dir; else {s.key=key;s.dir=1;}
  renderEPerumahan();
}
function sortPoi(key){
  const s=editorState.sort.poi;
  if(s.key===key) s.dir=-s.dir; else {s.key=key;s.dir=1;}
  renderEPoi();
}
function _applySort(arr,sort){
  if(!sort.key) return arr;
  const k=sort.key, d=sort.dir;
  return [...arr].sort((a,b)=>{
    const av=a[k], bv=b[k];
    if(av==null && bv==null) return 0;
    if(av==null) return 1;
    if(bv==null) return -1;
    if(typeof av==='number' && typeof bv==='number') return (av-bv)*d;
    return String(av).localeCompare(String(bv),'id',{numeric:true})*d;
  });
}
function _updateSortIndicators(tbodyId,sort){
  const tbody=document.getElementById(tbodyId);
  if(!tbody) return;
  const table=tbody.closest('table');
  if(!table) return;
  table.querySelectorAll('th.sortable').forEach(th=>{
    th.classList.remove('sort-asc','sort-desc');
    if(th.dataset.sort===sort.key){
      th.classList.add(sort.dir>0?'sort-asc':'sort-desc');
    }
  });
}

// ── Render ─────────────────────────────────────────────────
function renderEPerumahan(){
  document.getElementById('ecnt-p').textContent='('+perumahan.length+')';
  const q=editorState.search.perumahan;
  // attach original index supaya handler onchange tetap mereferensi item yang benar
  let rows=perumahan.map((p,origIdx)=>({p,origIdx}));
  if(q){
    rows=rows.filter(({p})=>{
      return (p.nama||'').toLowerCase().includes(q)
          || (p.area||'').toLowerCase().includes(q)
          || (p.developer||'').toLowerCase().includes(q);
    });
  }
  rows=_applySort(rows.map(r=>({...r.p,_i:r.origIdx})),editorState.sort.perumahan).map(r=>({p:r,origIdx:r._i}));

  const info=document.getElementById('filter-info-p');
  if(q) info.textContent=`${rows.length} / ${perumahan.length} hasil`;
  else info.textContent=`${perumahan.length} perumahan`;

  const tb=document.getElementById('etbody-p');
  if(rows.length===0){
    tb.innerHTML=`<tr><td colspan="11" class="empty-state">${q?'Tidak ada hasil untuk "'+escapeHtml(q)+'". ':'Belum ada data. '}Tambah perumahan lewat form di bawah.</td></tr>`;
  } else {
    tb.innerHTML=rows.map(({p,origIdx})=>{
      const i=origIdx;
      const displayNum = origIdx+1; // posisi asli di data array
      const isAnchor = p.id===ANCHOR_ID;
      return `<tr><td style="color:var(--faint);font-size:10px;font-family:'DM Mono',monospace;">${displayNum}${isAnchor?'⭐':''}</td>
      <td><input type="text" value="${escapeHtml(p.nama)}" onchange="perumahan[${i}].nama=this.value;markDirtyAndPersist()" style="min-width:140px;"></td>
      <td><input type="text" value="${escapeHtml(p.area)}" onchange="perumahan[${i}].area=this.value;markDirtyAndPersist()" style="min-width:80px;"></td>
      <td><select onchange="perumahan[${i}].tipe=this.value;markDirtyAndPersist()"><option value="subsidi" ${p.tipe==='subsidi'?'selected':''}>Subsidi</option><option value="mix" ${p.tipe==='mix'?'selected':''}>Mix</option></select></td>
      <td><input type="number" value="${p.lat}" onchange="editCoordP(${i},'lat',this)" step="0.0000001" style="min-width:95px;font-family:'DM Mono',monospace;font-size:11px;"></td>
      <td><input type="number" value="${p.lng}" onchange="editCoordP(${i},'lng',this)" step="0.0000001" style="min-width:95px;font-family:'DM Mono',monospace;font-size:11px;"></td>
      <td><input type="text" value="${escapeHtml(p.developer||'')}" onchange="perumahan[${i}].developer=this.value;markDirtyAndPersist()" style="min-width:120px;"></td>
      <td><input type="number" value="${p.unit}" onchange="perumahan[${i}].unit=parseInt(this.value)||0;markDirtyAndPersist()" style="min-width:50px;"></td>
      <td><input type="number" value="${p.realisasi}" onchange="perumahan[${i}].realisasi=parseInt(this.value)||0;markDirtyAndPersist()" style="min-width:60px;"></td>
      <td><input type="number" value="${p.tahun}" onchange="perumahan[${i}].tahun=parseInt(this.value)||2024;markDirtyAndPersist()" style="min-width:58px;"></td>
      <td><button class="btn-sm-danger" onclick="delEP(${i})">Hapus</button></td></tr>`;
    }).join('');
  }
  _updateSortIndicators('etbody-p',editorState.sort.perumahan);
}

function renderEPoi(){
  document.getElementById('ecnt-poi').textContent='('+poi.length+')';
  const q=editorState.search.poi;
  let rows=poi.map((x,origIdx)=>({x,origIdx}));
  if(q){
    rows=rows.filter(({x})=>{
      return (x.nama||'').toLowerCase().includes(q)
          || (x.kat||'').toLowerCase().includes(q)
          || (KAT_LABEL[x.kat]||'').toLowerCase().includes(q);
    });
  }
  rows=_applySort(rows.map(r=>({...r.x,_i:r.origIdx})),editorState.sort.poi).map(r=>({x:r,origIdx:r._i}));

  const info=document.getElementById('filter-info-poi');
  if(q) info.textContent=`${rows.length} / ${poi.length} hasil`;
  else info.textContent=`${poi.length} POI`;

  const tb=document.getElementById('etbody-poi');
  if(rows.length===0){
    tb.innerHTML=`<tr><td colspan="6" class="empty-state">${q?'Tidak ada hasil untuk "'+escapeHtml(q)+'". ':'Belum ada POI. '}Tambah POI lewat form di bawah.</td></tr>`;
  } else {
    tb.innerHTML=rows.map(({x,origIdx})=>{
      const i=origIdx;
      const displayNum=origIdx+1;
      return `<tr><td style="color:var(--faint);font-size:10px;font-family:'DM Mono',monospace;">${displayNum}</td>
      <td><input type="text" value="${escapeHtml(x.nama)}" onchange="poi[${i}].nama=this.value;markDirtyAndPersist()" style="min-width:180px;"></td>
      <td><select onchange="poi[${i}].kat=this.value;poi[${i}].label=KAT_LBL_E[this.value];poi[${i}].emoji=KAT_EMOJI_E[this.value];markDirtyAndPersist();">${Object.entries(KAT_LABEL).map(([k,v])=>`<option value="${k}" ${x.kat===k?'selected':''}>${v}</option>`).join('')}</select></td>
      <td><input type="number" value="${x.lat}" onchange="editCoordPoi(${i},'lat',this)" step="0.0000001" style="min-width:95px;font-family:'DM Mono',monospace;font-size:11px;"></td>
      <td><input type="number" value="${x.lng}" onchange="editCoordPoi(${i},'lng',this)" step="0.0000001" style="min-width:95px;font-family:'DM Mono',monospace;font-size:11px;"></td>
      <td><button class="btn-sm-danger" onclick="delEPoi(${i})">Hapus</button></td></tr>`;
    }).join('');
  }
  _updateSortIndicators('etbody-poi',editorState.sort.poi);
}

// ── Sync eksplisit ─────────────────────────────────────────
async function syncEditorNow(){
  if(editorState.syncing) return;
  if(!editorState.dirty){showToast('✓ Sudah tersinkron');return;}
  editorState.syncing=true;
  const btn=document.getElementById('btn-sync-now');
  const statusEl=document.getElementById('editor-sync-status');
  if(btn){btn.disabled=true;btn.textContent='⏳ Syncing...';}
  if(statusEl){statusEl.className='sync-status';statusEl.textContent='Mengirim...';}

  // [v12.3 OPTIMISTIC UI] Asumsi sync sukses — update UI duluan, sync di background
  // Ini bikin user nggak perlu nunggu 5-15 detik fetch ke Apps Script
  // Simpan lokal (redundan tapi aman, kalau tab ditutup data tetap ada)
  try{localStorage.setItem('bm4_data',JSON.stringify({perumahan,poi}));}catch(e){}

  // Hitung yang dihapus (snapshot vs now)
  const snapshot = editorState.snapshot || {perumahan:[],poi:[]};
  const snapIdsP = new Set((snapshot.perumahan||[]).map(p=>String(p.id)));
  const snapNamesPoi = new Set((snapshot.poi||[]).map(p=>String(p.nama)));
  const nowIdsP = new Set(perumahan.map(p=>String(p.id)));
  const nowNamesPoi = new Set(poi.map(p=>String(p.nama)));
  const deletedP = [...snapIdsP].filter(id=>!nowIdsP.has(id));
  const deletedPoi = [...snapNamesPoi].filter(n=>!nowNamesPoi.has(n));
  const totalDel = deletedP.length + deletedPoi.length;

  // [OPTIMISTIC] Update UI segera — anggap sukses
  editorState.snapshot=_snapshotData();
  setEditorDirty(false);
  const delInfo=totalDel?` (−${totalDel} dihapus)`:'';
  if(statusEl){statusEl.className='sync-status ok';statusEl.textContent=`✓ Sync ${new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}`;}
  setSyncStatus('synced',`Tersinkron: ${perumahan.length} perumahan, ${poi.length} POI${delInfo}`);
  showToast(`✅ Tersinkron (${perumahan.length} perumahan, ${poi.length} POI${delInfo})`);
  if(btn){btn.textContent='💾 Sync ke Sheets';btn.disabled=true;}
  editorState.syncing=false;

  // [PARALLEL BACKGROUND] Kirim request ke Sheets paralel — user nggak perlu nunggu
  // Kalau gagal, kasih notifikasi (jarang terjadi)
  const requests = [
    fetch(GAS_URL, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: gasPost({action:'savePerumahan', rows:perumahan})
    }),
    fetch(GAS_URL, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: gasPost({action:'savePoi', rows:poi})
    })
  ];
  // Tambahkan delete requests (parallel juga)
  for(const id of deletedP){
    requests.push(fetch(GAS_URL, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: gasPost({action:'deletePerumahan', id:id})
    }));
  }
  for(const nama of deletedPoi){
    requests.push(fetch(GAS_URL, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: gasPost({action:'deletePoi', nama:nama})
    }));
  }

  // Track all parallel — kalau ada yang gagal, beri notifikasi
  Promise.allSettled(requests).then(results => {
    const failed = results.filter(r=>r.status==='rejected').length;
    if(failed > 0){
      console.warn('[syncEditorNow] '+failed+' background requests gagal:', results);
      setSyncStatus('offline', `${failed} request gagal, klik sync lagi`);
      showToast(`⚠️ ${failed} sync gagal — klik Sync ke Sheets lagi`);
      // Re-mark dirty supaya user bisa retry
      setEditorDirty(true);
    } else {
      // All good — log activity
      try{if(typeof logActivity==='function' && currentUser) logActivity(currentUser.username,'editor_sync',`${perumahan.length}P+${poi.length}POI, del ${deletedP.length}P+${deletedPoi.length}POI`);}catch(e){}
    }
  });
}

// ── Discard (revert ke snapshot) ───────────────────────────
function discardEditorChanges(){
  if(!editorState.dirty) return;
  if(!editorState.snapshot){showToast('⚠ Tidak ada snapshot untuk direvert');return;}
  if(!confirm('Batalkan semua perubahan dan kembalikan ke state terakhir yang tersinkron?')) return;
  perumahan.length=0;editorState.snapshot.perumahan.forEach(p=>perumahan.push({...p}));
  poi.length=0;editorState.snapshot.poi.forEach(x=>poi.push({...x}));
  try{localStorage.setItem('bm4_data',JSON.stringify({perumahan,poi}));}catch(e){}
  setEditorDirty(false);
  renderEPerumahan();renderEPoi();
  showToast('↶ Perubahan dibatalkan');
}

// ── CRUD ───────────────────────────────────────────────────
function delEP(i){
  if(!confirm('Hapus "'+perumahan[i].nama+'"?'))return;
  perumahan.splice(i,1);
  perumahan.forEach((p,idx)=>p.id=idx+1);
  renderEPerumahan();markDirtyAndPersist();showToast('🗑️ Dihapus (belum tersinkron)');
}
function delEPoi(i){
  if(!confirm('Hapus "'+poi[i].nama+'"?'))return;
  poi.splice(i,1);
  renderEPoi();markDirtyAndPersist();showToast('🗑️ Dihapus (belum tersinkron)');
}

function _markFieldInvalid(id,msg){
  const el=document.getElementById(id);
  if(!el) return;
  el.classList.add('invalid');
  el.title=msg||'Tidak valid';
  setTimeout(()=>{el.classList.remove('invalid');el.title='';},2500);
}
function _clearAddFields(ids){ids.forEach(id=>{const el=document.getElementById(id);if(el){el.value='';el.classList.remove('invalid');}});}

function addEPerumahan(){
  const nama=document.getElementById('enp-nama').value.trim();
  const area=document.getElementById('enp-area').value.trim();
  const latRaw=document.getElementById('enp-lat').value;
  const lngRaw=document.getElementById('enp-lng').value;
  let bad=false;
  if(!nama){_markFieldInvalid('enp-nama','Nama wajib');bad=true;}
  if(!area){_markFieldInvalid('enp-area','Area wajib');bad=true;}
  const vLat=validateLat(latRaw); if(!vLat.ok){_markFieldInvalid('enp-lat',vLat.msg);bad=true;}
  const vLng=validateLng(lngRaw); if(!vLng.ok){_markFieldInvalid('enp-lng',vLng.msg);bad=true;}
  if(bad){showToast('⚠️ Periksa field yang merah');return;}

  const newId=perumahan.length>0?Math.max(...perumahan.map(p=>p.id))+1:1;
  perumahan.push({
    id:newId,nama:nama.toUpperCase(),lat:vLat.value,lng:vLng.value,
    tipe:document.getElementById('enp-tipe').value,
    realisasi:parseInt(document.getElementById('enp-real').value)||0,
    unit:parseInt(document.getElementById('enp-unit').value)||80,
    tahun:parseInt(document.getElementById('enp-tahun').value)||2024,
    developer:document.getElementById('enp-dev').value.trim()||'-',area
  });
  _clearAddFields(['enp-nama','enp-area','enp-lat','enp-lng','enp-dev','enp-unit','enp-real','enp-tahun']);
  renderEPerumahan();markDirtyAndPersist();
  document.getElementById('enp-nama').focus();
  showToast('✅ Ditambahkan (belum tersinkron)');
}

function addEPoi(){
  const nama=document.getElementById('epoi-nama').value.trim();
  const latRaw=document.getElementById('epoi-lat').value;
  const lngRaw=document.getElementById('epoi-lng').value;
  let bad=false;
  if(!nama){_markFieldInvalid('epoi-nama','Nama wajib');bad=true;}
  const vLat=validateLat(latRaw); if(!vLat.ok){_markFieldInvalid('epoi-lat',vLat.msg);bad=true;}
  const vLng=validateLng(lngRaw); if(!vLng.ok){_markFieldInvalid('epoi-lng',vLng.msg);bad=true;}
  if(bad){showToast('⚠️ Periksa field yang merah');return;}

  const kat=document.getElementById('epoi-kat').value;
  poi.push({nama,lat:vLat.value,lng:vLng.value,kat,label:KAT_LBL_E[kat],emoji:KAT_EMOJI_E[kat]});
  _clearAddFields(['epoi-nama','epoi-lat','epoi-lng']);
  renderEPoi();markDirtyAndPersist();
  document.getElementById('epoi-nama').focus();
  showToast('✅ Ditambahkan (belum tersinkron)');
}

function resetEditorData(){
  if(!confirm('Reset semua data ke default? Perubahan belum tersinkron akan hilang.'))return;
  localStorage.removeItem('bm4_data');location.reload();
}

function applyEditorToPeta(){
  recalcAll();
  if(analisaMapInit){
    Object.values(markers).forEach(({marker})=>analisaMap.removeLayer(marker));
    Object.values(poiMarkers).forEach(({marker})=>analisaMap.removeLayer(marker));
    markers={};poiMarkers={};
    perumahan.forEach(p=>{const isAnch=p.id===ANCHOR_ID,color=TIPE_COLOR[p.tipe]||'#666',sz=isAnch?20:15;const icon=L.divIcon({html:`<div style="width:${sz}px;height:${sz}px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.3);${isAnch?'border:3px solid #D97706;box-shadow:0 0 0 3px rgba(217,119,6,0.3);':''}"></div>${isAnch?'<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);font-size:12px;">⭐</div>':''}`,iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],className:''});const m=L.marker([p.lat,p.lng],{icon}).addTo(analisaMap);m.bindTooltip(`<b>${p.nama}</b><br>${p.area} · Skor: <b>${p.score}</b>`,{direction:'top',offset:[0,-10]});m.on('click',()=>selectPerumahan(p.id));markers[p.id]={marker:m,data:p};});
    poi.forEach((x,i)=>{const color=KAT_COLOR[x.kat]||'#666';const icon=L.divIcon({html:`<div style="width:20px;height:20px;background:${color};border-radius:5px;border:1.5px solid rgba(255,255,255,0.8);box-shadow:0 1px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:700;">${(x.label||'P')[0]}</div>`,iconSize:[20,20],iconAnchor:[10,10],className:''});const m=L.marker([x.lat,x.lng],{icon,zIndexOffset:-100});m.bindTooltip(`${x.emoji||'📍'} ${x.nama}`,{direction:'top',offset:[0,-8]});poiMarkers[i]={marker:m,data:x};if(activePoi[x.kat])m.addTo(analisaMap);});
    const sel=document.getElementById('perumahan-select');sel.innerHTML='<option value="">— Semua Perumahan —</option>';perumahan.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=(p.id===ANCHOR_ID?'⭐ ':'')+p.nama;sel.appendChild(o);});
    buildRanking('overall');
  }
  // [v12 EDITOR] Terapkan = update peta saja. Sync tetap manual.
  if(editorState.dirty){
    showToast('✅ Peta diperbarui — jangan lupa klik "Sync ke Sheets"');
  } else {
    showToast('✅ Peta diperbarui');
  }
  toggleEditor();
}
