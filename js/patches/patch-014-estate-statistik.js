/**
 * BM4 PATCH 014 — STATISTIK ESTATE (Desktop)
 *
 * Sub-1 Polish — Replace placeholder #estate-section-statistik dengan
 * dashboard analitik kombinasi laporan harian + pengecekan harian + master blok.
 *
 * Layout (4 baris):
 *   Row 1 — KPI Laporan (4 cards):
 *     - Total bulan ini, Proses, Selesai, Tertunda
 *   Row 2 — KPI Pengecekan & Prioritas (4 cards):
 *     - Total prioritas, % Dicek hari ini, Bermasalah, Streak hari
 *   Row 3 — Charts (2 col):
 *     - Tren laporan 30 hari (SVG line chart)
 *     - Distribusi kategori (horizontal bar)
 *   Row 4 — Tables (2 col):
 *     - Top supervisor / tim (by jumlah laporan)
 *     - Blok bermasalah terkini (perhatian + bermasalah)
 *
 * Filter atas: period 7d / 30d / 90d / all + tombol Refresh
 *
 * Endpoint dipakai (semua read-only):
 *   - getEstateLaporan (proyekId, range tanggal)
 *   - getEstatePengecekan (proyekId, range tanggal)
 *   - getEstateBlok (proyekId, prioritasOnly opsional)
 *   - getEstateKategori
 *   - getPengecekanStats (proyekId, tanggal hari ini)
 *
 * Idempotent — aman di-load berkali-kali.
 *
 * Dependency:
 *   - BM4Api (11-api-layer.js)
 *   - 181-estate-module.js (untuk pattern proyekId resolution)
 *   - localStorage 'bm4_app_state' (untuk current proyekId)
 */

(function(global){
  'use strict';

  if(global._patch014StatistikLoaded) return;
  global._patch014StatistikLoaded = true;

  // ============================================================
  // CONST
  // ============================================================
  const STATUS_KEYS = ['selesai', 'proses', 'tertunda'];
  const STATUS_LABELS = ['Selesai', 'Proses', 'Tertunda'];
  const STATUS_COLORS = ['#10B981', '#F59E0B', '#94A3B8'];

  const KATEGORI_FALLBACK = [
    { id:'pertamanan', label:'Pertamanan',     icon:'🌿' },
    { id:'kebersihan', label:'Kebersihan',     icon:'🧹' },
    { id:'drainase',   label:'Drainase',       icon:'💧' },
    { id:'jalan',      label:'Jalan & Fasum',  icon:'🛣️' },
    { id:'utilitas',   label:'Listrik & Air',  icon:'💡' },
    { id:'keamanan',   label:'Keamanan',       icon:'🛡️' },
    { id:'perbaikan',  label:'Perbaikan',      icon:'🔧' },
    { id:'lainnya',    label:'Lainnya',        icon:'📋' }
  ];

  // ============================================================
  // STATE
  // ============================================================
  let _proyekId = null;
  let _isLoading = false;
  let _filterPeriod = '30d'; // 7d | 30d | 90d | all

  // Data caches (refreshed setiap loadData)
  let _laporanList = [];
  let _pengecekanList = [];
  let _blokList = [];
  let _kategoriList = KATEGORI_FALLBACK.slice();
  let _pengecekanStats = null;

  // ============================================================
  // PROYEK ID (sama pattern dengan patch-010 rc18.1)
  // ============================================================
  function _getProyekId(){
    try {
      if(typeof currentProyek !== 'undefined' && currentProyek){
        return String(currentProyek);
      }
    } catch(_){}
    try {
      const raw = localStorage.getItem('bm4_app_state');
      if(raw){
        const state = JSON.parse(raw);
        if(state && state.proyek) return String(state.proyek);
      }
    } catch(_){}
    try {
      if(global.currentProyek){
        if(typeof global.currentProyek === 'string') return global.currentProyek;
        if(global.currentProyek.id) return String(global.currentProyek.id);
      }
    } catch(_){}
    return null;
  }

  // ============================================================
  // INIT
  // ============================================================
  function init(){
    const section = document.getElementById('estate-section-statistik');
    if(!section){
      console.warn('[patch-014] #estate-section-statistik tidak ditemukan');
      return;
    }
    if(section.dataset.patch014Inited === '1') return;
    section.dataset.patch014Inited = '1';

    section.innerHTML = _buildShellHtml();

    const subnav = document.querySelector('.estate-subnav');
    if(subnav){
      subnav.addEventListener('click', _onSubnavClick);
    }

    if(section.classList.contains('active')){
      setTimeout(() => {
        _proyekId = _getProyekId();
        if(_proyekId) loadData();
      }, 100);
    }

    console.log('[patch-014] statistik UI injected');
  }

  function _onSubnavClick(e){
    const btn = e.target.closest('.estate-subtab[data-section="statistik"]');
    if(!btn) return;
    setTimeout(() => {
      const newProyekId = _getProyekId();
      if(newProyekId !== _proyekId || _laporanList.length === 0){
        _proyekId = newProyekId;
        loadData();
      }
    }, 50);
  }

  // ============================================================
  // SHELL HTML
  // ============================================================
  function _buildShellHtml(){
    return `
      <div class="stat014-wrap">
        <!-- Toolbar -->
        <div class="stat014-toolbar">
          <div class="stat014-toolbar-left">
            <div class="stat014-title">📊 Dashboard Statistik Estate</div>
            <div class="stat014-subtitle" id="stat014-subtitle">Memuat...</div>
          </div>
          <div class="stat014-toolbar-right">
            <div class="stat014-pill-row" data-filter-group="period">
              <button class="stat014-pill" data-period="7d" onclick="window._patch014.setPeriod('7d')">7 hari</button>
              <button class="stat014-pill active" data-period="30d" onclick="window._patch014.setPeriod('30d')">30 hari</button>
              <button class="stat014-pill" data-period="90d" onclick="window._patch014.setPeriod('90d')">90 hari</button>
              <button class="stat014-pill" data-period="all" onclick="window._patch014.setPeriod('all')">Semua</button>
            </div>
            <button class="stat014-btn-secondary" onclick="window._patch014.loadData()">🔄 Refresh</button>
          </div>
        </div>

        <!-- Body -->
        <div class="stat014-body" id="stat014-body">
          <div class="stat014-empty">
            <div class="stat014-empty-icon">⏳</div>
            <div class="stat014-empty-title">Memuat data statistik…</div>
            <div class="stat014-empty-sub">Mengambil dari server.</div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================
  // LOAD DATA
  // ============================================================
  async function loadData(){
    if(_isLoading) return;
    _isLoading = true;

    _proyekId = _getProyekId();
    if(!_proyekId){
      _showEmpty('🏗️', 'Pilih proyek dulu', 'Kembali ke halaman pilih proyek, lalu masuk lagi.');
      _isLoading = false;
      return;
    }

    if(!global.BM4Api){
      _showEmpty('⚠️', 'API tidak tersedia', 'BM4Api belum di-load.');
      _isLoading = false;
      return;
    }

    _showEmpty('⏳', 'Memuat data statistik…', 'Mengambil laporan, pengecekan, dan master blok…');

    const today = _toIsoDate(new Date());
    const rangeStart = _getRangeStart();

    try {
      const [resLap, resCek, resBlok, resKat, resStats] = await Promise.all([
        global.BM4Api.get('getEstateLaporan', {
          proyekId: _proyekId,
          tanggalDari: rangeStart || ''
        }),
        global.BM4Api.get('getEstatePengecekan', {
          proyekId: _proyekId,
          tanggalDari: rangeStart || ''
        }).catch(() => ({ success:false, data:[] })),
        global.BM4Api.get('getEstateBlok', { proyekId: _proyekId, aktifOnly: true }),
        global.BM4Api.get('getEstateKategori').catch(() => ({ success:false })),
        global.BM4Api.get('getPengecekanStats', {
          proyekId: _proyekId,
          tanggal: today
        }).catch(() => ({ success:false }))
      ]);

      _laporanList = (resLap && resLap.success && Array.isArray(resLap.data)) ? resLap.data : [];
      _pengecekanList = (resCek && resCek.success && Array.isArray(resCek.data)) ? resCek.data : [];
      _blokList = (resBlok && resBlok.success && Array.isArray(resBlok.data)) ? resBlok.data : [];

      if(resKat && resKat.success && Array.isArray(resKat.data) && resKat.data.length){
        _kategoriList = resKat.data;
      }

      _pengecekanStats = (resStats && resStats.success) ? resStats : null;

      _render();
    } catch(e){
      console.error('[patch-014] load error:', e);
      _showEmpty('⚠️', 'Gagal memuat', String(e && e.message ? e.message : e));
    } finally {
      _isLoading = false;
    }
  }

  function _getRangeStart(){
    if(_filterPeriod === 'all') return null;
    const days = { '7d':7, '30d':30, '90d':90 }[_filterPeriod] || 30;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return _toIsoDate(d);
  }

  // ============================================================
  // RENDER
  // ============================================================
  function _render(){
    const subtitle = document.getElementById('stat014-subtitle');
    if(subtitle){
      const periodLbl = { '7d':'7 hari terakhir', '30d':'30 hari terakhir', '90d':'90 hari terakhir', 'all':'Semua waktu' }[_filterPeriod];
      subtitle.textContent = (_proyekId ? _proyekId.toUpperCase() : '—') + ' · ' + periodLbl + ' · ' + _laporanList.length + ' laporan';
    }

    const body = document.getElementById('stat014-body');
    if(!body) return;

    body.innerHTML =
      _renderRow1Kpis() +
      _renderRow2Pengecekan() +
      _renderRow3Charts() +
      _renderRow4Tables();
  }

  // ============================================================
  // ROW 1 — KPI LAPORAN
  // ============================================================
  function _renderRow1Kpis(){
    const today = _toIsoDate(new Date());
    const todayCount = _laporanList.filter(l => String(l.tanggal).slice(0,10) === today).length;
    const total = _laporanList.length;
    const selesai = _laporanList.filter(l => String(l.status).toLowerCase() === 'selesai').length;
    const proses = _laporanList.filter(l => String(l.status).toLowerCase() === 'proses').length;
    const tertunda = _laporanList.filter(l => String(l.status).toLowerCase() === 'tertunda').length;
    const completionRate = total > 0 ? Math.round((selesai / total) * 100) : 0;

    return `
      <div class="stat014-section-title">📋 Aktivitas Laporan</div>
      <div class="stat014-kpi-grid">
        <div class="stat014-kpi stat014-kpi-blue">
          <div class="stat014-kpi-icon">📋</div>
          <div class="stat014-kpi-content">
            <div class="stat014-kpi-value">${total}</div>
            <div class="stat014-kpi-label">Total Laporan</div>
            <div class="stat014-kpi-sub">${todayCount} hari ini</div>
          </div>
        </div>
        <div class="stat014-kpi stat014-kpi-green">
          <div class="stat014-kpi-icon">✅</div>
          <div class="stat014-kpi-content">
            <div class="stat014-kpi-value">${selesai}</div>
            <div class="stat014-kpi-label">Selesai</div>
            <div class="stat014-kpi-sub">${completionRate}% completion rate</div>
          </div>
        </div>
        <div class="stat014-kpi stat014-kpi-amber">
          <div class="stat014-kpi-icon">🔄</div>
          <div class="stat014-kpi-content">
            <div class="stat014-kpi-value">${proses}</div>
            <div class="stat014-kpi-label">Sedang Proses</div>
            <div class="stat014-kpi-sub">${total > 0 ? Math.round((proses / total) * 100) : 0}% dari total</div>
          </div>
        </div>
        <div class="stat014-kpi stat014-kpi-gray">
          <div class="stat014-kpi-icon">⏸</div>
          <div class="stat014-kpi-content">
            <div class="stat014-kpi-value">${tertunda}</div>
            <div class="stat014-kpi-label">Tertunda</div>
            <div class="stat014-kpi-sub">${total > 0 ? Math.round((tertunda / total) * 100) : 0}% dari total</div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================
  // ROW 2 — KPI PENGECEKAN & PRIORITAS
  // ============================================================
  function _renderRow2Pengecekan(){
    const totalPrioritas = _blokList.filter(b => _toBool(b.isPrioritas)).length;

    let dicek = 0, persenDicek = 0, bermasalah = 0, perhatian = 0;
    if(_pengecekanStats){
      dicek = _pengecekanStats.dicek || 0;
      persenDicek = _pengecekanStats.persenDicek || 0;
      bermasalah = _pengecekanStats.bermasalah || 0;
      perhatian = _pengecekanStats.perhatian || 0;
    }

    // Hitung streak: berapa hari berturut2 (mundur dari hari ini) yang ada minimal 1 cek
    const streak = _calculateStreak();

    // Total bermasalah dalam range (perhatian + bermasalah)
    const totalIssues = _pengecekanList.filter(c => {
      const s = String(c.status).toLowerCase();
      return s === 'bermasalah' || s === 'perhatian';
    }).length;

    return `
      <div class="stat014-section-title">⭐ Pengecekan Lingkungan Prioritas</div>
      <div class="stat014-kpi-grid">
        <div class="stat014-kpi stat014-kpi-purple">
          <div class="stat014-kpi-icon">⭐</div>
          <div class="stat014-kpi-content">
            <div class="stat014-kpi-value">${totalPrioritas}</div>
            <div class="stat014-kpi-label">Area Prioritas</div>
            <div class="stat014-kpi-sub">dari ${_blokList.length} total blok</div>
          </div>
        </div>
        <div class="stat014-kpi stat014-kpi-blue">
          <div class="stat014-kpi-icon">📊</div>
          <div class="stat014-kpi-content">
            <div class="stat014-kpi-value">${persenDicek}<span class="stat014-kpi-pct">%</span></div>
            <div class="stat014-kpi-label">Dicek Hari Ini</div>
            <div class="stat014-kpi-sub">${dicek} dari ${totalPrioritas} prioritas</div>
          </div>
        </div>
        <div class="stat014-kpi stat014-kpi-${bermasalah > 0 ? 'red' : 'green'}">
          <div class="stat014-kpi-icon">${bermasalah > 0 ? '⚠️' : '✓'}</div>
          <div class="stat014-kpi-content">
            <div class="stat014-kpi-value">${bermasalah}</div>
            <div class="stat014-kpi-label">Bermasalah Hari Ini</div>
            <div class="stat014-kpi-sub">${perhatian} perlu perhatian</div>
          </div>
        </div>
        <div class="stat014-kpi stat014-kpi-${streak >= 3 ? 'green' : 'amber'}">
          <div class="stat014-kpi-icon">🔥</div>
          <div class="stat014-kpi-content">
            <div class="stat014-kpi-value">${streak}</div>
            <div class="stat014-kpi-label">Hari Streak</div>
            <div class="stat014-kpi-sub">${streak >= 3 ? 'konsisten dicek' : streak === 0 ? 'belum dicek hari ini' : 'mulai habit'}</div>
          </div>
        </div>
      </div>
    `;
  }

  function _calculateStreak(){
    if(_pengecekanList.length === 0) return 0;

    // Group by tanggal
    const dates = {};
    _pengecekanList.forEach(c => {
      const d = String(c.tanggalCek).slice(0,10);
      if(d) dates[d] = true;
    });

    // Mundur dari hari ini, hitung berapa hari berturut2 ada cek
    let streak = 0;
    const cur = new Date();
    cur.setHours(0,0,0,0);
    for(let i=0; i<365; i++){
      const dStr = _toIsoDate(cur);
      if(dates[dStr]){
        streak++;
      } else {
        // Hari pertama (today) toleransi: kalau today belum dicek tapi kemarin udah,
        // streak tetap dihitung dari kemarin
        if(i === 0) {
          cur.setDate(cur.getDate() - 1);
          continue;
        }
        break;
      }
      cur.setDate(cur.getDate() - 1);
    }
    return streak;
  }

  // ============================================================
  // ROW 3 — CHARTS
  // ============================================================
  function _renderRow3Charts(){
    return `
      <div class="stat014-section-title">📈 Tren & Distribusi</div>
      <div class="stat014-chart-grid">
        <div class="stat014-chart-card">
          <div class="stat014-chart-head">
            <div class="stat014-chart-title">Tren Laporan Harian</div>
            <div class="stat014-chart-sub">${_filterPeriod === 'all' ? 'semua periode' : _filterPeriod} · stack by status</div>
          </div>
          ${_renderTrendChart()}
        </div>
        <div class="stat014-chart-card">
          <div class="stat014-chart-head">
            <div class="stat014-chart-title">Distribusi Kategori</div>
            <div class="stat014-chart-sub">total ${_laporanList.length} laporan</div>
          </div>
          ${_renderKategoriChart()}
        </div>
      </div>
    `;
  }

  function _renderTrendChart(){
    if(_laporanList.length === 0){
      return '<div class="stat014-chart-empty">Belum ada data laporan</div>';
    }

    // Group by date + status
    const byDate = {};
    _laporanList.forEach(l => {
      const d = String(l.tanggal).slice(0,10);
      if(!d) return;
      if(!byDate[d]) byDate[d] = { selesai:0, proses:0, tertunda:0 };
      const s = String(l.status).toLowerCase();
      if(byDate[d][s] !== undefined) byDate[d][s]++;
    });

    // Generate continuous date range
    const days = { '7d':7, '30d':30, '90d':90 }[_filterPeriod] || 30;
    const isAll = _filterPeriod === 'all';
    let startDate, endDate;
    endDate = new Date();
    endDate.setHours(0,0,0,0);

    if(isAll){
      // Pakai earliest date dari data
      const allDates = Object.keys(byDate).sort();
      if(allDates.length === 0){
        return '<div class="stat014-chart-empty">Belum ada data</div>';
      }
      startDate = new Date(allDates[0] + 'T00:00:00');
    } else {
      startDate = new Date();
      startDate.setHours(0,0,0,0);
      startDate.setDate(startDate.getDate() - days + 1);
    }

    const dateList = [];
    const cur = new Date(startDate);
    while(cur <= endDate){
      dateList.push(_toIsoDate(cur));
      cur.setDate(cur.getDate() + 1);
    }

    // Cap to ~30 bars max for display (kalau 90 hari, group jadi 3 hari per bar)
    let displayList = dateList;
    let groupSize = 1;
    if(dateList.length > 35){
      groupSize = Math.ceil(dateList.length / 30);
      displayList = [];
      for(let i = 0; i < dateList.length; i += groupSize){
        const group = dateList.slice(i, i + groupSize);
        displayList.push(group);
      }
    }

    // Compute max value untuk scaling
    const groupedData = displayList.map(item => {
      if(Array.isArray(item)){
        // Multi-day group: sum
        const sum = { selesai:0, proses:0, tertunda:0, _label: item[0] };
        item.forEach(d => {
          if(byDate[d]){
            sum.selesai += byDate[d].selesai;
            sum.proses += byDate[d].proses;
            sum.tertunda += byDate[d].tertunda;
          }
        });
        sum._labelEnd = item[item.length-1];
        return sum;
      } else {
        const v = byDate[item] || { selesai:0, proses:0, tertunda:0 };
        v._label = item;
        return v;
      }
    });

    const maxVal = Math.max(1, ...groupedData.map(d => d.selesai + d.proses + d.tertunda));
    const W = 560, H = 220, PAD_TOP = 12, PAD_BOTTOM = 28, PAD_LEFT = 30, PAD_RIGHT = 6;
    const chartW = W - PAD_LEFT - PAD_RIGHT;
    const chartH = H - PAD_TOP - PAD_BOTTOM;
    const barW = Math.max(2, chartW / groupedData.length - 2);

    let bars = '';
    let labels = '';
    groupedData.forEach((d, i) => {
      const x = PAD_LEFT + i * (chartW / groupedData.length) + 1;
      const total = d.selesai + d.proses + d.tertunda;
      let yCursor = PAD_TOP + chartH;

      const segments = [
        { key:'tertunda', val: d.tertunda, color: STATUS_COLORS[2] },
        { key:'proses',   val: d.proses,   color: STATUS_COLORS[1] },
        { key:'selesai',  val: d.selesai,  color: STATUS_COLORS[0] }
      ];

      segments.forEach(seg => {
        if(seg.val === 0) return;
        const segH = (seg.val / maxVal) * chartH;
        yCursor -= segH;
        bars += `<rect x="${x}" y="${yCursor}" width="${barW}" height="${segH}" fill="${seg.color}" rx="1">
          <title>${_formatDateShort(d._label)}: ${seg.val} ${seg.key}</title>
        </rect>`;
      });

      // Label x-axis: show every Nth label biar ngga crowded
      const labelEvery = Math.ceil(groupedData.length / 8);
      if(i % labelEvery === 0 || i === groupedData.length - 1){
        const lblText = _formatDateShort(d._label);
        labels += `<text x="${x + barW/2}" y="${H - 8}" font-size="9" fill="#64748B" text-anchor="middle">${lblText}</text>`;
      }
    });

    // Y-axis grid + labels
    let grid = '';
    const yTicks = 4;
    for(let i = 0; i <= yTicks; i++){
      const yVal = Math.round(maxVal * (yTicks - i) / yTicks);
      const yPos = PAD_TOP + (i / yTicks) * chartH;
      grid += `<line x1="${PAD_LEFT}" y1="${yPos}" x2="${W - PAD_RIGHT}" y2="${yPos}" stroke="#F1F5F9" stroke-width="1"/>`;
      grid += `<text x="${PAD_LEFT - 4}" y="${yPos + 3}" font-size="9" fill="#94A3B8" text-anchor="end">${yVal}</text>`;
    }

    return `
      <div class="stat014-chart-body">
        <svg viewBox="0 0 ${W} ${H}" class="stat014-svg" preserveAspectRatio="xMidYMid meet">
          ${grid}
          ${bars}
          ${labels}
        </svg>
        <div class="stat014-chart-legend">
          <span><span class="stat014-dot" style="background:${STATUS_COLORS[0]}"></span> Selesai</span>
          <span><span class="stat014-dot" style="background:${STATUS_COLORS[1]}"></span> Proses</span>
          <span><span class="stat014-dot" style="background:${STATUS_COLORS[2]}"></span> Tertunda</span>
        </div>
      </div>
    `;
  }

  function _renderKategoriChart(){
    if(_laporanList.length === 0){
      return '<div class="stat014-chart-empty">Belum ada data laporan</div>';
    }

    // Count per kategori
    const counts = {};
    let untagged = 0;
    _laporanList.forEach(l => {
      const k = String(l.kategori || '').trim();
      if(!k){ untagged++; return; }
      counts[k] = (counts[k] || 0) + 1;
    });

    const items = Object.keys(counts).map(kid => {
      const meta = _kategoriList.find(x => x.id === kid) || { id:kid, label:kid, icon:'📋' };
      return { id:kid, label: meta.label, icon: meta.icon, count: counts[kid] };
    });
    if(untagged > 0){
      items.push({ id:'_none', label:'Tanpa kategori', icon:'❔', count: untagged });
    }
    items.sort((a,b) => b.count - a.count);

    if(items.length === 0){
      return '<div class="stat014-chart-empty">Belum ada data berkategori</div>';
    }

    const maxCount = Math.max(...items.map(i => i.count));

    const rows = items.map(item => {
      const pct = (item.count / maxCount) * 100;
      const totalPct = Math.round((item.count / _laporanList.length) * 100);
      return `
        <div class="stat014-kat-row">
          <div class="stat014-kat-label">
            <span class="stat014-kat-icon">${item.icon}</span>
            <span class="stat014-kat-name">${_esc(item.label)}</span>
          </div>
          <div class="stat014-kat-barwrap">
            <div class="stat014-kat-bar" style="width:${pct}%"></div>
            <span class="stat014-kat-count">${item.count} <small>(${totalPct}%)</small></span>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="stat014-kat-list">${rows}</div>`;
  }

  // ============================================================
  // ROW 4 — TABLES
  // ============================================================
  function _renderRow4Tables(){
    return `
      <div class="stat014-section-title">🔍 Detail Aktivitas</div>
      <div class="stat014-table-grid">
        <div class="stat014-table-card">
          <div class="stat014-chart-head">
            <div class="stat014-chart-title">👥 Tim Paling Aktif</div>
            <div class="stat014-chart-sub">top 8 by jumlah laporan</div>
          </div>
          ${_renderTopTim()}
        </div>
        <div class="stat014-table-card">
          <div class="stat014-chart-head">
            <div class="stat014-chart-title">⚠️ Blok Bermasalah Terkini</div>
            <div class="stat014-chart-sub">cek terakhir non-bersih</div>
          </div>
          ${_renderBlokIssues()}
        </div>
      </div>
    `;
  }

  function _renderTopTim(){
    if(_laporanList.length === 0){
      return '<div class="stat014-table-empty">Belum ada data tim</div>';
    }

    // Tim disimpan sebagai string (mungkin comma-separated). Split jadi individual.
    const counts = {};
    _laporanList.forEach(l => {
      const tim = String(l.tim || '').trim();
      if(!tim) return;
      // Split by comma atau slash
      tim.split(/[,/]/).forEach(name => {
        const n = name.trim();
        if(!n) return;
        counts[n] = (counts[n] || 0) + 1;
      });
    });

    const items = Object.keys(counts).map(name => ({ name, count: counts[name] }));
    items.sort((a,b) => b.count - a.count);
    const top = items.slice(0, 8);

    if(top.length === 0){
      return '<div class="stat014-table-empty">Belum ada data tim (kolom "tim" kosong)</div>';
    }

    const maxCount = top[0].count;
    return `
      <div class="stat014-tim-list">
        ${top.map((t, i) => `
          <div class="stat014-tim-row">
            <div class="stat014-tim-rank">${i + 1}</div>
            <div class="stat014-tim-name">${_esc(t.name)}</div>
            <div class="stat014-tim-barwrap">
              <div class="stat014-tim-bar" style="width:${(t.count / maxCount) * 100}%"></div>
              <span class="stat014-tim-count">${t.count}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function _renderBlokIssues(){
    if(_pengecekanList.length === 0){
      return '<div class="stat014-table-empty">Belum ada data pengecekan</div>';
    }

    // Latest record per blok (in case multi-cek)
    const latestPerBlok = {};
    _pengecekanList.forEach(c => {
      const bid = String(c.blokId);
      if(!bid) return;
      const key = String(c.updatedAt || c.createdAt || '');
      if(!latestPerBlok[bid] || key > String(latestPerBlok[bid].updatedAt || latestPerBlok[bid].createdAt || '')){
        latestPerBlok[bid] = c;
      }
    });

    // Filter yang non-bersih
    const issues = Object.values(latestPerBlok).filter(c => {
      const s = String(c.status).toLowerCase();
      return s === 'bermasalah' || s === 'perhatian';
    });

    if(issues.length === 0){
      return `
        <div class="stat014-table-empty stat014-table-empty-ok">
          <div style="font-size:32px;margin-bottom:6px;">✓</div>
          <div>Semua area prioritas dalam kondisi <b>bersih</b></div>
        </div>
      `;
    }

    // Sort: bermasalah dulu, baru perhatian, latest first
    issues.sort((a,b) => {
      const sa = String(a.status).toLowerCase();
      const sb = String(b.status).toLowerCase();
      if(sa !== sb) return sa === 'bermasalah' ? -1 : 1;
      return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    });

    const top = issues.slice(0, 10);

    return `
      <div class="stat014-blok-issues">
        ${top.map(c => {
          const isBermasalah = String(c.status).toLowerCase() === 'bermasalah';
          return `
            <div class="stat014-blok-row stat014-blok-${isBermasalah ? 'critical' : 'warn'}">
              <div class="stat014-blok-icon">${isBermasalah ? '🚨' : '⚠️'}</div>
              <div class="stat014-blok-content">
                <div class="stat014-blok-head">
                  <span class="stat014-blok-name">${_esc(c.blokNama || c.blokId)}</span>
                  <span class="stat014-blok-date">${_formatDateShort(String(c.tanggalCek).slice(0,10))}</span>
                </div>
                ${c.catatan ? `<div class="stat014-blok-catatan">${_esc(c.catatan)}</div>` : '<div class="stat014-blok-catatan stat014-blok-catatan-empty">tanpa catatan</div>'}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // ============================================================
  // FILTER
  // ============================================================
  function setPeriod(p){
    if(_filterPeriod === p) return;
    _filterPeriod = p;
    _updatePillActive('period', p);
    loadData();
  }

  function _updatePillActive(group, value){
    const container = document.querySelector(`[data-filter-group="${group}"]`);
    if(!container) return;
    container.querySelectorAll('.stat014-pill').forEach(b => {
      b.classList.toggle('active', String(b.dataset[group]) === String(value));
    });
  }

  // ============================================================
  // UTIL
  // ============================================================
  function _showEmpty(icon, title, sub){
    const body = document.getElementById('stat014-body');
    if(!body) return;
    body.innerHTML = `
      <div class="stat014-empty">
        <div class="stat014-empty-icon">${icon}</div>
        <div class="stat014-empty-title">${_esc(title)}</div>
        <div class="stat014-empty-sub">${_esc(sub)}</div>
      </div>
    `;
  }

  function _toBool(v){
    if(v === true || v === 1) return true;
    if(v === false || v === 0 || v === '' || v == null) return false;
    const s = String(v).toLowerCase().trim();
    return s === 'true' || s === '1' || s === 'yes';
  }

  function _toIsoDate(d){
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  function _formatDateShort(iso){
    if(!iso) return '-';
    try {
      const d = new Date(iso + 'T00:00:00');
      const monthName = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][d.getMonth()];
      return d.getDate() + ' ' + monthName;
    } catch(_){ return iso; }
  }

  function _esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  // ============================================================
  // EXPOSE & BOOT
  // ============================================================
  global._patch014 = {
    init: init,
    loadData: loadData,
    setPeriod: setPeriod
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  console.log('[patch-014] estate statistik loaded');
})(typeof window !== 'undefined' ? window : this);
