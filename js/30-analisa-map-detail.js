// Analisa map, ranking, detail info/fasilitas
// ============================================================
// SCORING ENGINE
// ============================================================
let FORMULA={wAksesibilitas:50,wFasilitas:30,wFisik:20,wTol:40,wCBD:40,wTransport:20,wRS:30,wKampus:20,wMall:20,wPemda:10,wIndustri:10,wPublik:10,decayAks:8,decayFas:6};
function haversine(la1,ln1,la2,ln2){const R=6371,dL=(la2-la1)*Math.PI/180,dN=(ln2-ln1)*Math.PI/180,a=Math.sin(dL/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dN/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function travelMin(km){return Math.round(km/40*60);}
function fmt(n){return n.toLocaleString('id');}
function distToScore(km,decay){return Math.max(0,Math.round(100-(km*decay)));}
function nearestByKat(p){const res={};poi.forEach(x=>{const d=haversine(p.lat,p.lng,x.lat,x.lng);if(!res[x.kat]||d<res[x.kat].dist)res[x.kat]={...x,dist:d};});return res;}
function calcScoreFull(p){
  // [FIX #6] Gunakan road distance kalau sudah di-upgrade (via Tahap 2),
  // else haversine × ROUTE_HAVERSINE_FACTOR supaya skor konsisten dengan angka via jalan.
  const nbHav = nearestByKat(p);
  const nbRoad = p._roadNearest || {};
  const hasRoad = Object.keys(nbRoad).length > 0;
  const factor = hasRoad ? 1 : ROUTE_HAVERSINE_FACTOR; // road sudah pakai jarak riil; haversine butuh koreksi
  const getDist = (kat, fallback=20) => {
    if(nbRoad[kat]) return nbRoad[kat].dist;
    if(nbHav[kat]) return nbHav[kat].dist * ROUTE_HAVERSINE_FACTOR;
    return fallback;
  };
  const tolPOI=poi.filter(x=>x.kat==='tol'&&x.nama.includes('Exit'));
  const cbdPOI=poi.filter(x=>x.kat==='pemda');
  const trPOI=poi.filter(x=>x.kat==='tol'&&!x.nama.includes('Exit'));
  const distTol = nbRoad.tol ? nbRoad.tol.dist : (tolPOI.length?Math.min(...tolPOI.map(x=>haversine(p.lat,p.lng,x.lat,x.lng)))*ROUTE_HAVERSINE_FACTOR:15);
  const distCBD = nbRoad.pemda ? nbRoad.pemda.dist : (cbdPOI.length?Math.min(...cbdPOI.map(x=>haversine(p.lat,p.lng,x.lat,x.lng)))*ROUTE_HAVERSINE_FACTOR:15);
  const distTr  = trPOI.length?Math.min(...trPOI.map(x=>haversine(p.lat,p.lng,x.lat,x.lng)))*ROUTE_HAVERSINE_FACTOR:15;
  const scoreAks=Math.round((distToScore(distTol,FORMULA.decayAks)*FORMULA.wTol/100)+(distToScore(distCBD,FORMULA.decayAks)*FORMULA.wCBD/100)+(distToScore(distTr,FORMULA.decayFas)*FORMULA.wTransport/100));
  const dRS=getDist('rs'), dK=getDist('kampus'), dM=getDist('mall');
  const dP=getDist('pemda'), dI=getDist('industri'), dPu=getDist('publik');
  const scoreFas=Math.round((distToScore(dRS,FORMULA.decayFas)*FORMULA.wRS/100)+(distToScore(dK,FORMULA.decayFas)*FORMULA.wKampus/100)+(distToScore(dM,FORMULA.decayFas)*FORMULA.wMall/100)+(distToScore(dP,FORMULA.decayFas)*FORMULA.wPemda/100)+(distToScore(dI,FORMULA.decayFas)*FORMULA.wIndustri/100)+(distToScore(dPu,FORMULA.decayFas)*FORMULA.wPublik/100));
  const allDists=[dRS,dK,dM,dI,dPu].filter(d=>d<20);
  const avgDist=allDists.length?allDists.reduce((a,b)=>a+b,0)/allDists.length:15;
  const scoreFisik=Math.min(100,Math.round(distToScore(avgDist,3)*0.85+15));
  const overall=Math.round((scoreAks*FORMULA.wAksesibilitas/100)+(scoreFas*FORMULA.wFasilitas/100)+(scoreFisik*FORMULA.wFisik/100));
  return{overall,aksesibilitas:scoreAks,fasilitas:scoreFas,fisik:scoreFisik,_usedRoad:hasRoad,detail:{tol:{dist:distTol.toFixed(1),score:distToScore(distTol,FORMULA.decayAks)},cbd:{dist:distCBD.toFixed(1),score:distToScore(distCBD,FORMULA.decayAks)},transport:{dist:distTr.toFixed(1),score:distToScore(distTr,FORMULA.decayFas)},rs:{dist:dRS.toFixed(1),score:distToScore(dRS,FORMULA.decayFas)},kampus:{dist:dK.toFixed(1),score:distToScore(dK,FORMULA.decayFas)},mall:{dist:dM.toFixed(1),score:distToScore(dM,FORMULA.decayFas)}}};
}
function scoreGrade(s){if(s>=85)return{g:"Prime Location",c:"#15803D"};if(s>=75)return{g:"Sangat Strategis",c:"#2563EB"};if(s>=65)return{g:"Strategis",c:"#D97706"};if(s>=55)return{g:"Cukup Strategis",c:"#EA580C"};return{g:"Kurang Strategis",c:"#DC2626"};}
function recalcAll(){perumahan.forEach(p=>{const r=calcScoreFull(p);p.score=r.overall;p._scoreDetail=r;});}
recalcAll();

// ============================================================
// ANALISA MAP
// ============================================================
let analisaMap=null,analisaMapInit=false;
let markers={},poiMarkers={},heatmapLayer=null,heatmapVisible=false;
let currentFilter='all',selectedId=null;
let activePoi={rs:true,kampus:true,mall:true,tol:true,pemda:true,industri:true,publik:true};

function initAnalisaMap(){
  if(analisaMapInit){analisaMap.invalidateSize();return;}
  analisaMap=L.map('analisa-map').setView([-6.530,107.740],11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(analisaMap);
  analisaMapInit=true;
  perumahan.forEach(p=>{
    const isAnch=p.id===ANCHOR_ID,color=TIPE_COLOR[p.tipe]||'#666',sz=isAnch?20:15;
    const icon=L.divIcon({html:`<div style="width:${sz}px;height:${sz}px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.3);${isAnch?'border:3px solid #D97706;box-shadow:0 0 0 3px rgba(217,119,6,0.3);':''}"></div>${isAnch?'<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);font-size:12px;">⭐</div>':''}`,iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],className:'',});
    const m=L.marker([p.lat,p.lng],{icon}).addTo(analisaMap);
    m.bindTooltip(`<b>${escapeHtml(p.nama)}</b><br>${escapeHtml(p.area)} · Skor: <b>${p.score}</b>`,{direction:'top',offset:[0,-10]});
    m.on('click',()=>selectPerumahan(p.id));
    markers[p.id]={marker:m,data:p};
  });
  poi.forEach((x,i)=>{
    const color=KAT_COLOR[x.kat]||'#666';
    const icon=L.divIcon({html:`<div style="width:20px;height:20px;background:${color};border-radius:5px;border:1.5px solid rgba(255,255,255,0.8);box-shadow:0 1px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:700;">${x.label[0]}</div>`,iconSize:[20,20],iconAnchor:[10,10],className:''});
    const m=L.marker([x.lat,x.lng],{icon,zIndexOffset:-100});
    m.bindTooltip(`${x.emoji} ${escapeHtml(x.nama)}`,{direction:'top',offset:[0,-8]});
    poiMarkers[i]={marker:m,data:x};
    if(activePoi[x.kat])m.addTo(analisaMap);
  });
  buildRanking('overall');
  const sel=document.getElementById('perumahan-select');
  sel.innerHTML='<option value="">— Semua Perumahan —</option>';
  perumahan.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=(p.id===ANCHOR_ID?'⭐ ':'')+p.nama;sel.appendChild(o);});
  sel.onchange=function(){if(this.value)selectPerumahan(parseInt(this.value));};
  // [v17 B] Restore state Fokus Data dari localStorage
  try{
    const savedFocus = localStorage.getItem('bm4_focus_data');
    if(savedFocus === '1') applyFocusDataState(true);
  }catch(_){}
}

function setFilter(f,el){
  currentFilter=f;
  document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  applyFilter();
}
function applyFilter(){
  perumahan.forEach(p=>{
    const m=markers[p.id];if(!m)return;
    const show=currentFilter==='all'||p.tipe===currentFilter;
    if(show)m.marker.addTo(analisaMap);else analisaMap.removeLayer(m.marker);
  });
}
function togglePoi(kat,el){
  activePoi[kat]=!activePoi[kat];
  el.classList.toggle('active',activePoi[kat]);
  Object.values(poiMarkers).forEach(({marker,data})=>{
    if(data.kat===kat){if(activePoi[kat])marker.addTo(analisaMap);else analisaMap.removeLayer(marker);}
  });
}
// [v17 B] Mode Fokus Data — peta kecil, sidebar kanan lebar
function applyFocusDataState(enabled){
  const wrap = document.querySelector('.analisa-wrap');
  const btn  = document.getElementById('focus-data-fab');
  if(!wrap || !btn) return;
  wrap.classList.toggle('focus-data', enabled);
  btn.classList.toggle('active', enabled);
  btn.textContent = enabled ? '🗺️ Mode Peta' : '📊 Fokus Data';
  btn.title = enabled ? 'Perbesar peta — sidebar mengecil' : 'Perbesar panel data — peta mengecil';
  // Kasih waktu transisi CSS selesai, baru invalidateSize supaya Leaflet tahu ukuran baru
  setTimeout(()=>{
    if(analisaMapInit && analisaMap){ try{ analisaMap.invalidateSize(); }catch(_){} }
    // Refit highlight compare kalau aktif (biar tidak kepotong)
    if(_lastCompareCols){ try{ highlightCompareOnMainMap(_lastCompareCols); }catch(_){} }
  }, 320);
}
function toggleFocusData(){
  const wrap = document.querySelector('.analisa-wrap');
  if(!wrap) return;
  const enabled = !wrap.classList.contains('focus-data');
  applyFocusDataState(enabled);
  try{ localStorage.setItem('bm4_focus_data', enabled?'1':'0'); }catch(_){}
}

function toggleHeatmap(){
  heatmapVisible=!heatmapVisible;
  document.getElementById('heatmap-fab').classList.toggle('active',heatmapVisible);
  if(heatmapLayer){analisaMap.removeLayer(heatmapLayer);heatmapLayer=null;}
  if(!heatmapVisible)return;
  const layers=[];
  perumahan.forEach(p=>{
    const s=p.score;let r,g,b;
    if(s>=65){r=22;g=163;b=74;}else if(s>=50){r=217;g=119;b=6;}else{r=220;g=38;b=38;}
    layers.push(L.circle([p.lat,p.lng],{radius:1400,color:`rgb(${r},${g},${b})`,fillColor:`rgb(${r},${g},${b})`,fillOpacity:0.2,weight:0}));
  });
  heatmapLayer=L.layerGroup(layers).addTo(analisaMap);
}
function buildRanking(cat){
  const sorted=[...perumahan].sort((a,b)=>{
    if(cat==='overall')return b.score-a.score;
    const na=nearestByKat(a),nb=nearestByKat(b);
    return(na[cat]?na[cat].dist:999)-(nb[cat]?nb[cat].dist:999);
  });
  const list=document.getElementById('ranking-list');
  list.innerHTML=sorted.map((p,i)=>{
    const isAnch=p.id===ANCHOR_ID;
    let val,barPct;
    if(cat==='overall'){val=`${p.score}pts`;barPct=p.score;}
    else{const nb=nearestByKat(p),d=nb[cat]?nb[cat].dist.toFixed(1):'-';val=`${d}km`;barPct=nb[cat]?Math.max(0,100-(nb[cat].dist*8)):0;}
    const color=isAnch?'var(--anchor)':'var(--accent)';
    return`<div class="rank-item${selectedId===p.id?' selected':''}" onclick="selectPerumahan(${p.id})">
      <div class="rank-num">${i+1}</div>
      <div class="rank-body"><div class="rank-name">${isAnch?'⭐ ':''}${escapeHtml(p.nama)}</div>
      <div class="rank-bar-wrap"><div class="rank-bar-fill" style="width:${barPct}%;background:${color}"></div></div></div>
      <div class="rank-val" style="color:${color}">${val}</div></div>`;
  }).join('');
}
function selectPerumahan(id){
  // [TAHAP 4] Reset pembanding tambahan saat pindah ke perumahan berbeda
  if(selectedId !== id) _resetCompareExtrasOnSelect();
  selectedId=id;
  // [v12.4 STATE PERSISTENCE] Save state setiap kali pilih perumahan
  if(typeof triggerSaveAppState === 'function') triggerSaveAppState();
  buildRanking(document.getElementById('rank-cat-select').value);
  const p=perumahan.find(x=>x.id===id);if(!p)return;
  document.getElementById('detail-empty').style.display='none';
  const dc=document.getElementById('detail-content');dc.style.display='flex';
  if(analisaMapInit&&markers[id])analisaMap.panTo([p.lat,p.lng]);
  renderDetailOverview(p);
  renderDetailFasilitas(p);
  renderDetailCompare(p);
  renderDetailRadar(p);
  renderDetailNearby(p);
  // [TAHAP 2] Trigger lazy upgrade jarak via jalan (async, tidak blocking)
  // Skip kalau sudah: 'jalan' (full), 'mengukur' (sedang berjalan), 'partial' (sebagian berhasil, sudah coba)
  if(p._distMode !== 'jalan' && p._distMode !== 'mengukur' && p._distMode !== 'partial'){
    upgradeKompetitorToRoad(p);
  } else {
    _updateDistModeBadge(p);
  }
  // Reset to overview tab
  document.querySelectorAll('.tab-bar .tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(t=>t.classList.remove('active'));
  document.querySelector('.tab[data-atab="overview"]').classList.add('active');
  document.getElementById('tab-overview').classList.add('active');
  // Mobile: buka detail sebagai bottom sheet
  if(window.innerWidth<=768){
    document.getElementById('detail-sb')?.classList.add('open');
    document.getElementById('sb-backdrop')?.classList.add('open');
    document.getElementById('detail-close-mobile').style.display='flex';
    // Tutup sidebar filter kalau terbuka
    const sb=document.querySelector('#pane-analisa .sb');
    if(sb?.classList.contains('open')){sb.classList.remove('open');}
  }
}
function renderDetailOverview(p){
  const r=p._scoreDetail,gr=scoreGrade(r.overall),isAnch=p.id===ANCHOR_ID;
  const pct_p=p.unit>0?Math.min(100,Math.round(p.realisasi/p.unit*100)):0;
  document.getElementById('tab-overview').innerHTML=`
    <span class="pill" style="background:${TIPE_BG[p.tipe]||'#F0F0F0'};color:${TIPE_COLOR[p.tipe]||'#666'}">${TIPE_LABEL[p.tipe]||escapeHtml(p.tipe)}</span>
    ${isAnch?'<span class="anchor-badge">⭐ Anchor</span>':''}
    <button class="pdl-open-btn" style="float:right;" onclick="openPdlModal(${p.id})" title="Lihat detail lengkap per section">📄 Detail Lengkap</button>
    <div class="d-name">${escapeHtml(p.nama)}</div>
    <div class="d-area">📍 ${escapeHtml(p.area)} · Launching ${p.tahun}</div>
    <div style="margin:6px 0 8px;"><span id="dist-mode-badge" style="display:none;font-size:10px;font-weight:600;padding:3px 8px;border-radius:10px;align-items:center;gap:4px;"></span></div>
    <div class="score-card">
      <div><div class="score-label">Location Score</div><div class="score-big">${r.overall}</div><div style="margin-top:5px;"><div class="score-bar-wrap"><div class="score-bar-fill" style="width:${r.overall}%"></div></div></div></div>
      <div style="flex:1"><div class="score-label">Grade</div><div class="score-grade">${gr.g}</div><div style="font-size:10px;opacity:0.65;margin-top:3px;">dari 100 poin</div></div>
    </div>
    <div class="score-breakdown">
      <div style="font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Breakdown Skor 3 Faktor</div>
      <div class="sb-factor"><div class="sb-factor-header"><span class="sb-factor-name">🚗 Aksesibilitas (${FORMULA.wAksesibilitas}%)</span><span class="sb-factor-score" style="color:#2563EB">${r.aksesibilitas}</span></div>
      <div class="sb-factor-bar"><div class="sb-factor-fill" style="width:${r.aksesibilitas}%;background:#2563EB"></div></div>
      <div class="sb-sub"><span>Exit Tol: ${r.detail.tol.dist}km (${r.detail.tol.score}pts)</span><span>CBD: ${r.detail.cbd.dist}km</span><span>Transport: ${r.detail.transport.dist}km</span></div></div>
      <div class="sb-factor"><div class="sb-factor-header"><span class="sb-factor-name">🏥 Fasilitas (${FORMULA.wFasilitas}%)</span><span class="sb-factor-score" style="color:#059669">${r.fasilitas}</span></div>
      <div class="sb-factor-bar"><div class="sb-factor-fill" style="width:${r.fasilitas}%;background:#059669"></div></div>
      <div class="sb-sub"><span>RS: ${r.detail.rs.dist}km (${r.detail.rs.score}pts)</span><span>Kampus: ${r.detail.kampus.dist}km</span><span>Mall: ${r.detail.mall.dist}km</span></div></div>
      <div class="sb-factor"><div class="sb-factor-header"><span class="sb-factor-name">🏗️ Kondisi Fisik (${FORMULA.wFisik}%)</span><span class="sb-factor-score" style="color:#D97706">${r.fisik}</span></div>
      <div class="sb-factor-bar"><div class="sb-factor-fill" style="width:${r.fisik}%;background:#D97706"></div></div></div>
    </div>
    <div class="stats-grid">
      <div class="stat-box"><div class="sl">Total Unit</div><div class="sv">${fmt(p.unit)}</div></div>
      <div class="stat-box"><div class="sl">Realisasi</div><div class="sv">${fmt(p.realisasi)}</div></div>
      <div class="stat-box"><div class="sl">Tahun</div><div class="sv">${p.tahun}</div></div>
      <div class="stat-box"><div class="sl">Progress</div><div class="sv">${pct_p}%</div></div>
    </div>
    <div class="prog-wrap">
      <div class="prog-label"><span>Progress Realisasi</span><span style="font-weight:700">${pct_p}%</span></div>
      <div class="prog-bar"><div class="prog-fill" style="width:${pct_p}%;background:${TIPE_COLOR[p.tipe]||'#65A30D'}"></div></div>
    </div>
    <div class="stat-box" style="font-size:11px;line-height:1.5;"><div class="sl">Developer</div>${escapeHtml(p.developer||'')}</div>
    <div class="coords-small">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</div>
    ${_renderTaperaSection(p)}`;
  // [TAHAP 2] Update badge mode jarak setelah re-render DOM
  _updateDistModeBadge(p);
}

// ============================================================
// [P1 TAPERA] Render section data Tapera di tab Info
// ============================================================
function _renderTaperaSection(p){
  const t = p.tapera;
  if(!t){
    return `<div class="tpr-section">
      <div class="tpr-head"><div class="tpr-title">📊 Data Tapera</div></div>
      <div class="tpr-empty">Belum ada data Tapera untuk perumahan ini.<br>
        <span class="tpr-empty-cta" onclick="_openTaperaEditor(${p.id})">✏️ Isi dari Editor Data →</span>
      </div>
    </div>`;
  }
  const bulanan = Array.isArray(t.realisasiBulanan) ? t.realisasiBulanan : [];
  const sparkline = _renderTaperaSparkline(bulanan);
  const trend = _calcTaperaTrend(bulanan);
  const avgPerBulan = bulanan.length ? Math.round(bulanan.reduce((a,b)=>a+b.unit,0)/bulanan.length) : 0;
  const insights = _generateTaperaInsights(p, t, bulanan, trend, avgPerBulan);
  const badge = t._dummy
    ? '<span class="tpr-badge dummy">🧪 Dummy</span>'
    : (t.lastSynced ? `<span class="tpr-badge ok">✓ ${t.lastSynced}</span>` : '');

  return `<div class="tpr-section">
    <div class="tpr-head">
      <div class="tpr-title">📊 Data Tapera FLPP</div>
      ${badge}
    </div>

    <div class="tpr-summary">
      <div class="tpr-sum-box"><div class="tpr-sum-lbl">Total Realisasi</div>
        <div class="tpr-sum-val">${fmt(t.totalRealisasi||0)}</div>
        <div class="tpr-sum-sub">unit cair FLPP</div></div>
      <div class="tpr-sum-box"><div class="tpr-sum-lbl">Nominal FLPP</div>
        <div class="tpr-sum-val">${(t.nominalFLPP||0).toFixed(1)}<span style="font-size:10px;font-weight:500;color:var(--muted);"> M</span></div>
        <div class="tpr-sum-sub">miliar rupiah</div></div>
      <div class="tpr-sum-box"><div class="tpr-sum-lbl">Rata-rata/bulan</div>
        <div class="tpr-sum-val">${avgPerBulan}</div>
        <div class="tpr-sum-sub">unit/bulan</div></div>
      <div class="tpr-sum-box"><div class="tpr-sum-lbl">Trend</div>
        <div class="tpr-sum-val tpr-trend-${trend.dir}">${trend.icon} ${trend.pctStr}</div>
        <div class="tpr-sum-sub">${trend.label}</div></div>
    </div>

    ${sparkline}

    ${t.hargaRange||t.luasTanah||t.luasBangunan||t.tenorDominan||t.uangMukaRange||t.bankDominan ? `
    <div class="tpr-specs">
      ${t.hargaRange?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">Harga</span><span class="tpr-specs-val">${escapeHtml(t.hargaRange)}</span></div>`:''}
      ${t.luasTanah?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">LT</span><span class="tpr-specs-val">${escapeHtml(t.luasTanah)}</span></div>`:''}
      ${t.luasBangunan?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">LB</span><span class="tpr-specs-val">${escapeHtml(t.luasBangunan)}</span></div>`:''}
      ${t.tenorDominan?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">Tenor</span><span class="tpr-specs-val">${escapeHtml(t.tenorDominan)}</span></div>`:''}
      ${t.uangMukaRange?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">UM</span><span class="tpr-specs-val">${escapeHtml(t.uangMukaRange)}</span></div>`:''}
      ${t.bankDominan?`<div class="tpr-specs-row"><span class="tpr-specs-lbl">Bank</span><span class="tpr-specs-val">${escapeHtml(t.bankDominan)}</span></div>`:''}
    </div>`:''}

    ${_renderTaperaProfil(t.profilPembeli)}

    ${insights.length?`<div class="tpr-insights">
      ${insights.map(i=>`<div class="tpr-insight-item">${i}</div>`).join('')}
    </div>`:''}
  </div>`;
}

// Sparkline SVG inline — tanpa library
function _renderTaperaSparkline(bulanan){
  if(!bulanan || bulanan.length<2) return '';
  const W=340, H=60, PAD_L=4, PAD_R=4, PAD_T=6, PAD_B=4;
  const iw=W-PAD_L-PAD_R, ih=H-PAD_T-PAD_B;
  const max=Math.max(1, ...bulanan.map(b=>b.unit));
  const n=bulanan.length;
  const step = n>1 ? iw/(n-1) : iw;
  const pts = bulanan.map((b,i)=>{
    const x = PAD_L + i*step;
    const y = PAD_T + ih - (b.unit/max)*ih;
    return [x,y];
  });
  const path = pts.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const fillPath = path + ` L${pts[pts.length-1][0].toFixed(1)},${(PAD_T+ih).toFixed(1)} L${pts[0][0].toFixed(1)},${(PAD_T+ih).toFixed(1)} Z`;
  const firstLabel = bulanan[0].bulan;
  const lastLabel = bulanan[n-1].bulan;
  const peakIdx = bulanan.reduce((best,b,i)=>b.unit>bulanan[best].unit?i:best, 0);
  const peak = bulanan[peakIdx];
  return `<div class="tpr-chart-wrap">
    <div class="tpr-chart-head"><span>📈 Realisasi per bulan</span><span>Puncak: ${peak.unit} unit (${peak.bulan})</span></div>
    <svg class="tpr-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path d="${fillPath}" fill="rgba(59,130,246,0.12)" stroke="none"/>
      <path d="${path}" fill="none" stroke="#2563EB" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${pts[peakIdx][0].toFixed(1)}" cy="${pts[peakIdx][1].toFixed(1)}" r="2.5" fill="#2563EB"/>
    </svg>
    <div class="tpr-chart-axis"><span>${firstLabel}</span><span>${lastLabel}</span></div>
  </div>`;
}

// Hitung trend: bandingkan rata-rata 3 bulan terakhir vs 6 bulan sebelum itu
function _calcTaperaTrend(bulanan){
  if(!bulanan || bulanan.length<4) return {dir:'flat', icon:'→', pctStr:'—', label:'data kurang'};
  const n=bulanan.length;
  const recent = bulanan.slice(Math.max(0,n-3)).map(b=>b.unit);
  const prior = bulanan.slice(Math.max(0,n-9), n-3).map(b=>b.unit);
  const avgRecent = recent.reduce((a,b)=>a+b,0)/recent.length;
  const avgPrior = prior.length ? prior.reduce((a,b)=>a+b,0)/prior.length : avgRecent;
  if(avgPrior===0) return {dir:'flat', icon:'→', pctStr:'—', label:'baseline 0'};
  const delta = ((avgRecent-avgPrior)/avgPrior)*100;
  if(delta>=10) return {dir:'up', icon:'↗', pctStr:`+${Math.round(delta)}%`, label:'3 bln terakhir naik'};
  if(delta<=-10) return {dir:'down', icon:'↘', pctStr:`${Math.round(delta)}%`, label:'3 bln terakhir turun'};
  return {dir:'flat', icon:'→', pctStr:`${delta>=0?'+':''}${Math.round(delta)}%`, label:'relatif stabil'};
}

// Render profil pembeli mini (4 section × top-3 label)
function _renderTaperaProfil(profil){
  if(!profil || Object.keys(profil).length===0) return '';
  const sections=[
    {key:'pekerjaan', lbl:'💼 Pekerjaan', color:'#2563EB'},
    {key:'usia', lbl:'🎂 Usia', color:'#059669'},
    {key:'penghasilan', lbl:'💰 Penghasilan', color:'#D97706'},
    {key:'gender', lbl:'👥 Gender', color:'#7C3AED'}
  ];
  const boxes=sections.map(s=>{
    const data=profil[s.key];
    if(!data) return '';
    const entries=Object.entries(data).sort((a,b)=>b[1]-a[1]).slice(0,3);
    if(entries.length===0) return '';
    const max=Math.max(...entries.map(e=>e[1]));
    const items=entries.map(([k,v])=>{
      const pct=max>0?Math.round((v/max)*100):0;
      return `<div class="tpr-profil-item">
        <span class="tpr-profil-name" title="${escapeHtml(k)}">${escapeHtml(k)}</span>
        <div class="tpr-profil-bar"><div class="tpr-profil-fill" style="width:${pct}%;background:${s.color};"></div></div>
        <span class="tpr-profil-pct">${v}${v>=100?'':'%'}</span>
      </div>`;
    }).join('');
    return `<div class="tpr-profil-box"><div class="tpr-profil-lbl">${s.lbl}</div>${items}</div>`;
  }).filter(Boolean).join('');
  if(!boxes) return '';
  return `<div class="tpr-profil-grid">${boxes}</div>`;
}

// Generate insight otomatis dari data Tapera
function _generateTaperaInsights(p, t, bulanan, trend, avgPerBulan){
  const ins=[];
  // 1. Kecepatan serap
  if(avgPerBulan>0){
    if(avgPerBulan>=30) ins.push(`🔥 Kecepatan serap tinggi: <b>${avgPerBulan} unit/bulan</b> — pasar menyerap sangat cepat.`);
    else if(avgPerBulan>=10) ins.push(`✓ Kecepatan serap sehat: <b>${avgPerBulan} unit/bulan</b>.`);
    else ins.push(`⚠ Kecepatan serap rendah: <b>${avgPerBulan} unit/bulan</b> — perlu perhatian strategi.`);
  }
  // 2. Trend
  if(trend.dir==='up') ins.push(`↗ Trend 3 bulan terakhir <b>naik ${trend.pctStr}</b> — momentum positif.`);
  else if(trend.dir==='down') ins.push(`↘ Trend 3 bulan terakhir <b>turun ${trend.pctStr.replace('-','')}</b> — pasar melambat.`);
  // 3. Target market dominan (dari profil)
  const profil = t.profilPembeli||{};
  if(profil.usia && profil.penghasilan){
    const topUsia = Object.entries(profil.usia).sort((a,b)=>b[1]-a[1])[0];
    const topPeng = Object.entries(profil.penghasilan).sort((a,b)=>b[1]-a[1])[0];
    if(topUsia && topPeng){
      ins.push(`🎯 Target dominan: usia <b>${topUsia[0]} thn</b>, penghasilan <b>${topPeng[0]}</b>.`);
    }
  }
  // 4. Sisa stok (pakai p.unit vs tapera.totalRealisasi)
  if(p.unit>0 && t.totalRealisasi>0){
    const pct=Math.round((t.totalRealisasi/p.unit)*100);
    if(pct>=80) ins.push(`📦 Realisasi ${pct}% dari total unit — <b>hampir habis</b>.`);
    else if(pct>=50) ins.push(`📦 Realisasi ${pct}% — stok tersisa ${fmt(p.unit-t.totalRealisasi)} unit.`);
  }
  return ins;
}

// CTA buka editor ke tab Tapera dengan perumahan ini terpilih
function _openTaperaEditor(id){
  // Pastikan editor terbuka
  const overlay=document.getElementById('editor-overlay');
  if(overlay && !overlay.classList.contains('open')){
    try{ toggleEditor(); }catch(_){}
  }
  // Pindah ke tab tapera (switchEtab panggil initTaperaEditor via setTimeout 50ms)
  setTimeout(()=>{
    const btn=document.querySelector('.editor-tabs .etab:nth-child(3)');
    if(btn) btn.click();
    // Delay lebih lama dari switchEtab (50ms) + initTaperaEditor restore selection
    setTimeout(()=>{
      const sel=document.getElementById('tpr-select');
      if(sel){
        sel.value=String(id);
        loadTaperaForm(String(id));
      }
    }, 150);
  }, 50);
}
function renderDetailFasilitas(p){
  // [TAHAP 2] Pakai _roadNearest kalau sudah di-upgrade, fallback ke haversine
  const nbHav = nearestByKat(p);
  const nbRoad = p._roadNearest || {};
  const nb = {};
  Object.keys(KAT_LABEL).forEach(k => {
    if(nbRoad[k]) nb[k] = nbRoad[k];
    else if(nbHav[k]) nb[k] = nbHav[k];
  });
  const usingRoad = Object.keys(nbRoad).length > 0;
  document.getElementById('tab-fasilitas').innerHTML=`
    <div class="section-title">Fasilitas Terdekat per Kategori ${usingRoad ? '<span style="font-size:9px;color:#15803D;font-weight:600;">🛣 via jalan</span>' : ''}</div>
    ${Object.entries(KAT_LABEL).map(([kat,lbl])=>{const x=nb[kat];if(!x)return'';return`
    <div class="poi-row">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
        <div class="poi-icon" style="background:${KAT_COLOR[kat]}">${x.emoji||x.label[0]}</div>
        <div><div class="poi-name">${escapeHtml(x.nama)}</div><div class="poi-cat">${lbl}</div></div>
      </div>
      <div class="poi-dist" style="flex-shrink:0;text-align:right;margin-left:8px;">
        <div class="km">${x.dist.toFixed(1)} km</div>
        <div class="mn">~${x.menit || travelMin(x.dist)} mnt</div>
      </div>
    </div>`;}).join('')}`;
}
// [TAHAP 4] State multi-banding: array ID kompetitor TAMBAHAN (di luar anchor & fokus)
let compareExtraIds = [];
const CMP_PALETTE = ['#185FA5','#0F6E56','#D85A30']; // biru, teal, coral untuk pembanding tambahan

// [v17 fix] Visibility toggle untuk row Tapera di tabel banding.
// Default: 3 row paling penting ON, 10 row detail OFF. Persisted di localStorage.
const TAPERA_ROW_DEFS = [
  {key:'tpr_avg',    label:'📊 Rata² realisasi/bln', group:'Realisasi', defaultOn:true},
  {key:'tpr_trend',  label:'📈 Trend 3-bln',         group:'Realisasi', defaultOn:true},
  {key:'tpr_total',  label:'🏆 Total Realisasi',     group:'Realisasi', defaultOn:false},
  {key:'tpr_flpp',   label:'💵 Nominal FLPP',        group:'Realisasi', defaultOn:false},
  {key:'tpr_harga',  label:'💰 Harga range',         group:'Spesifikasi', defaultOn:true},
  {key:'tpr_lt',     label:'📐 Luas Tanah',          group:'Spesifikasi', defaultOn:false},
  {key:'tpr_lb',     label:'🏠 Luas Bangunan',       group:'Spesifikasi', defaultOn:false},
  {key:'tpr_tenor',  label:'📅 Tenor Dominan',       group:'Spesifikasi', defaultOn:false},
  {key:'tpr_um',     label:'💳 Uang Muka',           group:'Spesifikasi', defaultOn:false},
  {key:'tpr_bank',   label:'🏦 Bank Dominan',        group:'Spesifikasi', defaultOn:false},
  {key:'tpr_pek',    label:'💼 Pekerjaan dominan',   group:'Profil Pembeli', defaultOn:false},
  {key:'tpr_usia',   label:'🎂 Usia dominan',        group:'Profil Pembeli', defaultOn:false},
  {key:'tpr_peng',   label:'💴 Penghasilan dominan', group:'Profil Pembeli', defaultOn:false},
  {key:'tpr_gender', label:'👥 Gender dominan',      group:'Profil Pembeli', defaultOn:false}
];
let taperaRowVisibility = {};
(function loadTaperaRowVis(){
  try{
    const raw = localStorage.getItem('bm4_tapera_row_vis');
    const saved = raw ? JSON.parse(raw) : null;
    TAPERA_ROW_DEFS.forEach(d=>{
      taperaRowVisibility[d.key] = (saved && saved[d.key]!=null) ? !!saved[d.key] : d.defaultOn;
    });
  }catch(_){
    TAPERA_ROW_DEFS.forEach(d=>{ taperaRowVisibility[d.key] = d.defaultOn; });
  }
})();
function _saveTaperaRowVis(){
  try{ localStorage.setItem('bm4_tapera_row_vis', JSON.stringify(taperaRowVisibility)); }catch(_){}
}
function toggleTaperaRow(key, checked){
  taperaRowVisibility[key] = !!checked;
  _saveTaperaRowVis();
  // Re-render tab compare
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}
function setTaperaRowPreset(preset){
  // preset: 'min' (3 default), 'all', 'none'
  TAPERA_ROW_DEFS.forEach(d=>{
    if(preset==='all') taperaRowVisibility[d.key] = true;
    else if(preset==='none') taperaRowVisibility[d.key] = false;
    else taperaRowVisibility[d.key] = d.defaultOn;
  });
  _saveTaperaRowVis();
  const p = perumahan.find(x=>x.id===selectedId);
  if(p) renderDetailCompare(p);
}
function toggleTaperaRowPanel(){
  const el = document.getElementById('tpr-col-panel');
  if(!el) return;
  el.classList.toggle('open');
}
// [v17 A1] cmpMiniMap/markers/lines dihapus — fungsinya dipindah ke peta besar.
// State baru: cmpHighlightLines, cmpHighlightIds, cmpHighlightOriginalIcons (lihat atas).
