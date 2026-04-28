// Strategi target pasar map and CRUD
// ============================================================
// STRATEGI / TARGET PASAR MAP
// ============================================================
function initStratMap(){
  if(tpMapInit){tpMap.invalidateSize();renderTPList(tpFilter);renderTPMarkers();return;}
  tpMap=L.map('strat-map').setView([-6.530,107.740],11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(tpMap);
  const anchorIcon=L.divIcon({html:`<div style="width:20px;height:20px;background:#D97706;border-radius:50%;border:3px solid white;box-shadow:0 0 0 3px rgba(217,119,6,0.4);display:flex;align-items:center;justify-content:center;font-size:10px;">⭐</div>`,iconSize:[20,20],iconAnchor:[10,10],className:''});
  const proj=currentProyek?PROYEK[currentProyek]:PROYEK.gwc;
  L.marker([proj.lat,proj.lng],{icon:anchorIcon}).addTo(tpMap).bindTooltip(`<b>⭐ ${escapeHtml(proj.nama)}</b><br>Proyek Kita`,{direction:'top'});
  tpMapInit=true;
  renderTPMarkers();
  renderTPList(tpFilter);
  updateTpDashCount();
}
function saveTpData(){
  localStorage.setItem('bm4_tp_targets',JSON.stringify(tpTargets));
  if(USE_SHEETS)saveTpToSheets();
  updateTpDashCount();
}
async function saveTpToSheets(){
  try{
    await fetch(GAS_URL, {
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'text/plain'},
      body: gasPost({action:'saveTargetPasar', rows:tpTargets})
    });
  }catch(e){console.warn('Gagal sync TP:',e);}
}
async function loadTpFromSheets(){
  if(!USE_SHEETS)return false;
  try{
    const r=await fetch(gasGet('getTargetPasar')).then(res=>res.json());
    if(r.success&&r.data&&r.data.length>0){
      tpTargets=r.data.map(row=>({id:parseInt(row.id),nama:row.nama,jenis:row.jenis,lat:parseFloat(row.lat),lng:parseFloat(row.lng),karyawan:parseInt(row.karyawan)||0,pic:row.pic||'',lastcontact:row.lastcontact||'-',status:parseInt(row.status)||0,catatan:row.catatan||''}));
      localStorage.setItem('bm4_tp_targets',JSON.stringify(tpTargets));
      return true;
    }return false;
  }catch(e){return false;}
}
function updateTpDashCount(){
  document.getElementById('d-target').textContent=tpTargets.length;
  document.getElementById('d-deal').textContent=tpTargets.filter(t=>t.status===4).length;
  document.getElementById('tp-total').textContent=tpTargets.length;
}
function renderTPMarkers(){
  if(!tpMapInit)return;
  Object.values(tpMarkers).forEach(m=>tpMap.removeLayer(m));tpMarkers={};
  const filtered=tpFilter==='semua'?tpTargets:tpTargets.filter(t=>t.jenis===tpFilter);
  const proj=currentProyek?PROYEK[currentProyek]:PROYEK.gwc;
  filtered.forEach(t=>{
    const color=STATUS_COLOR[t.status]||'#94A3B8';
    const icon=L.divIcon({html:`<div style="width:16px;height:16px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.35);"></div>`,iconSize:[16,16],iconAnchor:[8,8],className:''});
    const m=L.marker([t.lat,t.lng],{icon}).addTo(tpMap);
    const dist=haversine(proj.lat,proj.lng,t.lat,t.lng).toFixed(1);
    m.bindTooltip(`<b>${escapeHtml(t.nama)}</b><br>${STATUS_STEPS[t.status].icon} ${STATUS_STEPS[t.status].label} · ${dist} km`,{direction:'top'});
    m.on('click',()=>selectTP(t.id));
    tpMarkers[t.id]=m;
  });
}
function renderTPList(filter){
  const list=document.getElementById('tp-list');
  const filtered=filter==='semua'?tpTargets:tpTargets.filter(t=>t.jenis===filter);
  const proj=currentProyek?PROYEK[currentProyek]:PROYEK.gwc;
  list.innerHTML=filtered.map(t=>{
    const color=STATUS_COLOR[t.status]||'#94A3B8';
    const dist=haversine(proj.lat,proj.lng,t.lat,t.lng).toFixed(1);
    const ji=t.jenis==='pabrik'?'🏭':t.jenis==='kawasan'?'🏗️':'🏢';
    const st=STATUS_STEPS[t.status]||{label:'—',icon:'•'};
    const potensi=calcPotensiUnit(t.karyawan);
    return`<div class="tp-item${selectedTpId===t.id?' selected':''}" onclick="selectTP(${t.id})">
      <div class="tp-item-head-v11">
        <div class="tp-item-badge-v11" style="background:${color}22;color:${color};border:1px solid ${color}44;">
          <span>${st.icon}</span><span>${escapeHtml(st.label).toUpperCase()}</span>
        </div>
        <button class="tp-item-edit-v11" onclick="event.stopPropagation();openTpModal(${t.id});" title="Edit target">✎</button>
      </div>
      <div class="tp-item-top" style="margin-top:4px;">
        <div class="tp-item-icon" style="background:${color}20;">${ji}</div>
        <div class="tp-item-name">${escapeHtml(t.nama)}</div>
      </div>
      <div class="tp-item-meta">${dist} km · ${Number(t.karyawan||0).toLocaleString('id')} karyawan · <b style="color:var(--accent);">${potensi} unit potensi</b></div>
    </div>`;
  }).join('');
  document.getElementById('tp-total').textContent=tpTargets.length;
}
function filterTP(f,el){
  document.querySelectorAll('.tp-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');tpFilter=f;
  renderTPList(f);renderTPMarkers();
}
function selectTP(id){
  selectedTpId=id;
  // Tutup popup sebelumnya sebelum pilih target baru
  if(tpMap) tpMap.closePopup();
  clearTpJumpRoute();
  const t=tpTargets.find(x=>x.id===id);if(!t)return;
  renderTPList(tpFilter);
  const proj=currentProyek?PROYEK[currentProyek]:PROYEK.gwc;
  const dist=haversine(proj.lat,proj.lng,t.lat,t.lng).toFixed(1);
  const menit=Math.round(parseFloat(dist)/40*60);
  const potensi=calcPotensiUnit(t.karyawan);
  const ji=t.jenis==='pabrik'?'🏭 Pabrik / Manufaktur':t.jenis==='kawasan'?'🏗️ Kawasan Industri':'🏢 Perusahaan';

  // Status Hero Box (v11+)
  const st=STATUS_STEPS[t.status]||{label:'—',icon:'•'};
  const stColor=STATUS_COLOR[t.status]||'#94A3B8';
  const heroEl=document.getElementById('tp-d-status-hero');
  if(heroEl){
    heroEl.style.background=stColor+'15';
    heroEl.style.border=`1px solid ${stColor}40`;
    heroEl.innerHTML=`
      <div class="icon" style="color:${stColor};">${st.icon}</div>
      <div class="lbl" style="color:${stColor};">STATUS SAAT INI</div>
      <div class="val" style="color:${stColor};">${st.label}</div>
    `;
  }

  document.getElementById('tp-d-name').textContent=t.nama;
  document.getElementById('tp-d-type').textContent=ji;
  document.getElementById('tp-d-jarak').innerHTML=`${dist} km lurus · ±${menit} mnt <a id="tp-d-jarak-road" style="display:inline-block;margin-left:6px;font-size:10px;color:white;background:var(--accent);padding:3px 9px;border-radius:10px;cursor:pointer;font-weight:600;letter-spacing:0.3px;" onclick="hitungJarakViaJalanTP(${id})">🗺️ TAMPILKAN RUTE</a>`;
  document.getElementById('tp-d-karyawan').textContent=`~${t.karyawan.toLocaleString('id')} orang`;
  document.getElementById('tp-d-potensi').textContent=`~${potensi} unit (est. ${POTENSI_PCT}%)`;
  document.getElementById('tp-d-pic').textContent=t.pic||'—';
  document.getElementById('tp-d-lastcontact').textContent=t.lastcontact&&t.lastcontact!=='-'?formatTanggalID(t.lastcontact):'Belum ada';
  document.getElementById('tp-d-catatan').textContent=t.catatan||'—';
  document.getElementById('tp-d-progres').innerHTML=STATUS_STEPS.map((s,i)=>{
    let cls=i<t.status?'done':i===t.status?'current':'pending';
    return`<div class="tp-progres-item ${cls}"><span style="width:16px;text-align:center;">${i<t.status?'✓':s.icon}</span>${s.label}</div>`;
  }).join('');
  document.getElementById('tp-d-editbtn').onclick=()=>openTpModal(id);
  document.getElementById('tp-d-deletebtn').onclick=()=>deleteTP(id);
  document.getElementById('tp-detail').classList.add('show');
  if(tpMap&&tpMarkers[id])tpMap.panTo([t.lat,t.lng]);
}

let tpJumpLine=null;
let tpJumpPulse=null;

async function hitungJarakViaJalanTP(id){
  const t=tpTargets.find(x=>x.id===id);if(!t)return;
  const proj=currentProyek?PROYEK[currentProyek]:PROYEK.gwc;
  const el=document.getElementById('tp-d-jarak-road');
  if(el){el.textContent='menghitung...';el.style.cursor='default';}

  const r=await getRouteDistance(proj.lat,proj.lng,t.lat,t.lng);
  const span=document.getElementById('tp-d-jarak-road');

  if(!span)return;
  if(r.viaRoad){
    span.innerHTML=`<b style="color:var(--accent);">${r.km.toFixed(1)} km via jalan</b> <span style="color:var(--muted);">(${r.menit} mnt)</span>`;
    span.style.textDecoration='none';
  } else {
    span.innerHTML=`<span style="color:#B45309;">⚠ Rute tidak tersedia · ${r.km.toFixed(1)} km (estimasi via jalan)</span>`;
    span.style.textDecoration='none';
  }

  // Gambar rute di peta strategi
  if(tpMap && tpMapInit){
    if(tpJumpLine){tpMap.removeLayer(tpJumpLine);tpJumpLine=null;}
    if(tpJumpPulse){tpMap.removeLayer(tpJumpPulse);tpJumpPulse=null;}

    const lineStyle=r.viaRoad
      ? {color:'#D97706',weight:4,opacity:0.85}
      : {color:'#D97706',weight:3,opacity:0.7,dashArray:'8,6'};
    tpJumpLine=L.polyline(r.coords,lineStyle).addTo(tpMap);

    // Pulsing circle
    tpJumpPulse=L.circleMarker([t.lat,t.lng],{
      radius:32,color:'#D97706',fillColor:'#FBBF24',
      fillOpacity:0.4,weight:3
    }).addTo(tpMap);
    let opacity=0.4;
    const pulseInterval=setInterval(()=>{
      opacity-=0.018;
      if(opacity<=0){
        clearInterval(pulseInterval);
        if(tpJumpPulse){tpMap.removeLayer(tpJumpPulse);tpJumpPulse=null;}
      } else if(tpJumpPulse){
        tpJumpPulse.setStyle({fillOpacity:opacity,opacity:Math.min(1,opacity*2)});
      }
    },60);

    // Fit bounds ke rute lengkap
    tpMap.fitBounds(tpJumpLine.getBounds(),{padding:[50,50],maxZoom:14,animate:true});

    // Popup di marker target
    const tpM=tpMarkers[t.id];
    if(tpM){
      const ji={pabrik:'🏭',perusahaan:'🏢',kawasan:'🏗️'};
      const jarakLabel=r.viaRoad
        ? `<b>${r.km.toFixed(1)} km via jalan</b> (${r.menit} mnt)`
        : `<b>${r.km.toFixed(1)} km</b> ${r.isEstimate ? '<span style="color:#B45309;font-size:9px;">(estimasi via jalan)</span>' : 'jarak udara'}`;
      tpM.unbindTooltip();
      tpM.bindPopup(`
        <div style="padding:4px 6px;min-width:200px;">
          <div style="font-size:13px;font-weight:700;color:#1C1C1A;margin-bottom:3px;">${ji[t.jenis]||'🏢'} ${escapeHtml(t.nama)}</div>
          <div style="font-size:11px;color:#666;margin-bottom:8px;">${fmt(t.karyawan)} karyawan</div>
          <div style="background:#FEF3C7;padding:7px 10px;border-radius:6px;font-size:12px;color:#92400E;margin-bottom:4px;">${jarakLabel}</div>
          <div style="font-size:10px;color:#666;">dari ${escapeHtml(proj.nama)}</div>
        </div>
      `,{closeButton:true,autoClose:false}).openPopup();
    }
  }
}

// Clear rute jalan saat pilih target lain atau tutup detail
function clearTpJumpRoute(){
  if(tpJumpLine && tpMap){tpMap.removeLayer(tpJumpLine);tpJumpLine=null;}
  if(tpJumpPulse && tpMap){tpMap.removeLayer(tpJumpPulse);tpJumpPulse=null;}
  // Tutup semua popup marker di peta
  if(tpMap) tpMap.closePopup();
  // Kembalikan tooltip marker yang sempat di-unbind
  if(tpMarkers){
    Object.values(tpMarkers).forEach(m=>{
      try{ if(m.getPopup()) m.closePopup(); }catch(e){}
    });
  }
}
function closeTpDetail(){document.getElementById('tp-detail').classList.remove('show');selectedTpId=null;renderTPList(tpFilter);clearTpJumpRoute();if(tpMap)tpMap.closePopup();}
function deleteTP(id){
  if(!confirm('Hapus target ini?'))return;
  tpTargets=tpTargets.filter(t=>t.id!==id);
  saveTpData();
  // [v12.1 FIX] Explicit soft delete di Sheets (pakai no-cors)
  if(USE_SHEETS){
    try{
      fetch(GAS_URL, {
        method:'POST',
        mode:'no-cors',
        headers:{'Content-Type':'text/plain'},
        body: gasPost({action:'deleteTargetPasar', id:id})
      }).catch(e=>console.warn('Gagal soft-delete TP:',e));
    }catch(e){}
  }
  closeTpDetail();renderTPList(tpFilter);renderTPMarkers();showToast('🗑️ Target dihapus');
}
function openTpModal(id){
  editingTpId=id;
  if(id===-1){
    document.getElementById('tp-modal-title').textContent='Tambah Target Pasar';
    ['tpf-nama','tpf-lat','tpf-lng','tpf-karyawan','tpf-pic','tpf-catatan'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('tpf-jenis').value='pabrik';
    document.getElementById('tpf-lastcontact').value='';
    document.getElementById('tpf-status').value='0';
  }else{
    const t=tpTargets.find(x=>x.id===id);if(!t)return;
    document.getElementById('tp-modal-title').textContent='Edit: '+t.nama;
    document.getElementById('tpf-nama').value=t.nama;
    document.getElementById('tpf-jenis').value=t.jenis;
    document.getElementById('tpf-lat').value=t.lat;
    document.getElementById('tpf-lng').value=t.lng;
    document.getElementById('tpf-karyawan').value=t.karyawan;
    document.getElementById('tpf-pic').value=t.pic||'';
    document.getElementById('tpf-lastcontact').value=t.lastcontact!=='-'?t.lastcontact:'';
    document.getElementById('tpf-status').value=t.status;
    document.getElementById('tpf-catatan').value=t.catatan||'';
  }
  document.getElementById('tp-modal').classList.add('open');
  // [v13 SMART-INPUT] Reset smart-input field & init/focus map
  const smi=document.getElementById('smi-tp-input');if(smi)smi.value='';
  const fb=document.getElementById('smi-tp-fb');if(fb){fb.className='smart-input-fb';fb.textContent='';}
  document.getElementById('tpf-lat').classList.remove('filled');
  document.getElementById('tpf-lng').classList.remove('filled');
  setTimeout(()=>{_initTpMiniMapOnce();_wireTpSmartInputOnce();
    // Kalau mode edit, arahkan pin ke lokasi existing
    if(id!==-1 && tpMiniMap){
      const t=tpTargets.find(x=>x.id===id);
      if(t && !isNaN(t.lat) && !isNaN(t.lng)){tpMiniMap.setPin(t.lat,t.lng);}
    } else if(tpMiniMap){
      tpMiniMap.clearPin();
      tpMiniMap.focus(-6.5578,107.8131,12);
    }
    if(tpMiniMap) tpMiniMap.invalidateSize();
  },100);
}

// [v13 SMART-INPUT] Init mini-map modal TP (lazy, sekali)
function _initTpMiniMapOnce(){
  const el=document.getElementById('tpmodal-minimap');
  if(!el || el._leaflet_id) return;
  tpMiniMap=createMiniMap('tpmodal-minimap',{
    center:[-6.5578,107.8131],zoom:12,
    onPick:(lat,lng)=>{
      const lEl=document.getElementById('tpf-lat'),gEl=document.getElementById('tpf-lng');
      lEl.value=lat.toFixed(7);lEl.classList.add('filled');
      gEl.value=lng.toFixed(7);gEl.classList.add('filled');
      const fb=document.getElementById('smi-tp-fb');
      if(fb){fb.className='smart-input-fb ok';fb.innerHTML=`✓ Dari klik peta: <b>${lat.toFixed(6)}, ${lng.toFixed(6)}</b>`;}
    },
    onMove:(lat,lng)=>{
      const lEl=document.getElementById('tpf-lat'),gEl=document.getElementById('tpf-lng');
      lEl.value=lat.toFixed(7);lEl.classList.add('filled');
      gEl.value=lng.toFixed(7);gEl.classList.add('filled');
    }
  });
  // Ref markers: tampilkan target pasar existing sebagai latar
  if(tpMiniMap && typeof tpTargets!=='undefined'){
    tpMiniMap.addReferences(tpTargets.map(t=>({lat:t.lat,lng:t.lng,label:t.nama,color:'#A855F7'})));
  }
}

let _smartInputWiredTp=false;
function _wireTpSmartInputOnce(){
  if(_smartInputWiredTp) return;
  _smartInputWiredTp=true;
  wireSmartInput({
    inputId:'smi-tp-input',btnId:'smi-tp-btn',fbId:'smi-tp-fb',
    helpBtnId:'smi-tp-helpbtn',helpBoxId:'smi-tp-help',
    latFieldId:'tpf-lat',lngFieldId:'tpf-lng',
    onPick:(lat,lng)=>{if(tpMiniMap)tpMiniMap.setPin(lat,lng);}
  });
}
function closeTpModal(){document.getElementById('tp-modal').classList.remove('open');}
function saveTpTarget(){
  const nama=document.getElementById('tpf-nama').value.trim();
  const lat=parseFloat(document.getElementById('tpf-lat').value);
  const lng=parseFloat(document.getElementById('tpf-lng').value);
  if(!nama||isNaN(lat)||isNaN(lng)){alert('Nama, Latitude, dan Longitude wajib diisi!');return;}
  const data={nama,jenis:document.getElementById('tpf-jenis').value,lat,lng,karyawan:parseInt(document.getElementById('tpf-karyawan').value)||0,pic:document.getElementById('tpf-pic').value.trim(),lastcontact:document.getElementById('tpf-lastcontact').value||'-',status:parseInt(document.getElementById('tpf-status').value),catatan:document.getElementById('tpf-catatan').value.trim()};
  if(editingTpId===-1){const newId=tpTargets.length>0?Math.max(...tpTargets.map(t=>t.id))+1:1;tpTargets.push({id:newId,...data});}
  else{const idx=tpTargets.findIndex(x=>x.id===editingTpId);if(idx!==-1)tpTargets[idx]={...tpTargets[idx],...data};}
  saveTpData();closeTpModal();renderTPList(tpFilter);renderTPMarkers();
  if(editingTpId!==-1)selectTP(editingTpId);
  showToast('✅ Data tersimpan!');
}

// ============================================================
// CHART
// ============================================================
function buildChart(){
  const bars=document.getElementById('chart-bars');if(!bars)return;
  const sorted=[...perumahan].sort((a,b)=>(b.realisasi/b.unit)-(a.realisasi/a.unit));
  bars.innerHTML=sorted.map(p=>{const pc=p.unit>0?Math.min(100,Math.round(p.realisasi/p.unit*100)):0;const color=TIPE_COLOR[p.tipe]||'#65A30D';const nmEsc=escapeHtml(p.nama);return`<div class="bar-col"><div class="bar-bg"><div class="bar-pct">${pc}%</div><div class="bar-fill" style="height:${pc}%;background:${color};"></div></div><div class="bar-lbl" title="${nmEsc}">${escapeHtml(p.nama.split(' ').slice(0,2).join(' '))}</div></div>`;}).join('');
}
function toggleChart(){
  const panel=document.getElementById('chart-panel');const btn=document.getElementById('chart-fab');
  const open=!panel.classList.contains('open');panel.classList.toggle('open',open);btn.classList.toggle('active',open);
  if(open)buildChart();
}
