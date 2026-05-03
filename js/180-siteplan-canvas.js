/**
 * SiteplanCanvas — Reusable component untuk render siteplan + blok markers
 *
 * Dipakai di:
 *   - Desktop Plotter (mode: plot, edit, inspect)
 *   - Mobile estate (mode: view, pick) — Sub-tahap 1C nanti
 *   - Mobile konstruksi (mode: view) — Tahap 2 nanti, color by status konstruksi
 *   - Mobile sales (mode: view) — Tahap 3 nanti, color by status sales
 *
 * Sesi A: SKELETON — render image + dots, mode switching, event hooks.
 * Sesi B: PENGAYAAN — drag-edit (mode=edit), tooltip hover (mode=inspect),
 *         dirty marker, modal-friendly callbacks.
 * Sesi B-rev2 (PATCH ZOOM):
 *   - Scroll wheel = zoom in/out, focus di cursor
 *   - Drag dengan space-hold / middle-button / mode=inspect = pan
 *   - Minimap di pojok kanan bawah saat zoom > 1
 *   - Koordinat tetap akurat di level zoom apapun
 *
 * Pattern:
 *   const canvas = new SiteplanCanvas(containerEl, {
 *     imageUrl: 'https://.../siteplan.png',
 *     mode: 'plot',
 *     blokList: [{id, nama, pixelX, pixelY, ...}, ...],
 *     colorFn: (blok) => '#FF0000',
 *     onTap: (blok|null, x, y, evt) => {...},
 *     onMove: (blok, newX, newY) => {...}
 *   });
 *   canvas.render();
 *   canvas.setMode('edit');
 *   canvas.setBlok(newList);
 *   canvas.zoomIn(); canvas.zoomOut(); canvas.zoomReset();
 */
(function(global){
  'use strict';

  const DEFAULT_DOT_RADIUS = 8;
  const HIGHLIGHT_DOT_RADIUS = 12;
  const TIPE_COLORS = {
    rumah: '#2563EB',
    fasum: '#7C3AED',
    jalan: '#475569',
    taman: '#65A30D',
    kosong: '#9B9A96'
  };

  // Zoom config
  const ZOOM_MIN = 1;        // 1× = fit-to-container
  const ZOOM_MAX = 8;        // 8× = max zoom (cukup presisi untuk plot)
  const ZOOM_STEP = 1.15;    // smooth scroll factor
  const MINIMAP_W = 140;
  const MINIMAP_H = 140;
  const MINIMAP_MARGIN = 12;

  class SiteplanCanvas {
    constructor(container, options){
      if(!container) throw new Error('SiteplanCanvas: container required');
      options = options || {};

      this.container = container;
      this.imageUrl = options.imageUrl || '';
      this.mode = options.mode || 'inspect';
      this.blokList = Array.isArray(options.blokList) ? options.blokList.slice() : [];
      this.colorFn = typeof options.colorFn === 'function' ? options.colorFn : null;
      this.onTap = typeof options.onTap === 'function' ? options.onTap : null;
      this.onMove = typeof options.onMove === 'function' ? options.onMove : null;

      this.highlightId = null;
      this.imageNaturalWidth = 0;
      this.imageNaturalHeight = 0;
      // baseScale = scale fit-to-container (1× zoom)
      this.baseScale = 1;
      // userZoom = multiplier user (1 = fit, 2 = 200%, etc)
      this.userZoom = 1;
      // panX, panY = offset translate (in CSS px) saat user pan
      this.panX = 0;
      this.panY = 0;

      this.canvasEl = null;
      this.ctx = null;
      this.imageEl = null;
      this.imageLoaded = false;
      this._inited = false;

      // Drag state untuk pin (mode=edit)
      this._pinDragState = null;
      this._pinDragMoved = false;

      // Pan drag state
      this._panDragState = null;
      this._spacePressed = false;

      // Tooltip
      this._tooltipEl = null;

      // Zoom indicator + minimap
      this._zoomBadgeEl = null;
      this._minimapEl = null;
      this._minimapCanvas = null;
      this._minimapCtx = null;

      // Bound key handlers (untuk cleanup)
      this._boundKeyDown = (e) => this._handleKeyDown(e);
      this._boundKeyUp = (e) => this._handleKeyUp(e);

      this._buildDOM();
    }

    _buildDOM(){
      this.container.classList.add('spc-host');
      this.container.innerHTML = '';

      // Image preloader
      this.imageEl = new Image();
      this.imageEl.crossOrigin = 'anonymous';
      this.imageEl.onload = () => this._onImageLoad();
      this.imageEl.onerror = () => this._onImageError();

      // Main canvas
      this.canvasEl = document.createElement('canvas');
      this.canvasEl.className = 'spc-canvas';
      this.canvasEl.style.cursor = this._cursorForMode(this.mode);
      this.container.appendChild(this.canvasEl);
      this.ctx = this.canvasEl.getContext('2d');

      // Tooltip
      this._tooltipEl = document.createElement('div');
      this._tooltipEl.className = 'spc-tooltip';
      this._tooltipEl.style.display = 'none';
      this.container.appendChild(this._tooltipEl);

      // Zoom badge (bottom-left)
      this._zoomBadgeEl = document.createElement('div');
      this._zoomBadgeEl.className = 'spc-zoom-badge';
      this._zoomBadgeEl.textContent = '100%';
      this._zoomBadgeEl.style.display = 'none';
      this.container.appendChild(this._zoomBadgeEl);

      // Minimap (bottom-right)
      this._minimapEl = document.createElement('div');
      this._minimapEl.className = 'spc-minimap';
      this._minimapEl.style.display = 'none';
      this._minimapCanvas = document.createElement('canvas');
      this._minimapCanvas.width = MINIMAP_W;
      this._minimapCanvas.height = MINIMAP_H;
      this._minimapEl.appendChild(this._minimapCanvas);
      this._minimapCtx = this._minimapCanvas.getContext('2d');
      this.container.appendChild(this._minimapEl);
      this._minimapCanvas.addEventListener('click', (e) => this._handleMinimapClick(e));

      // Event handlers
      this.canvasEl.addEventListener('mousedown', (e) => this._handleMouseDown(e));
      this.canvasEl.addEventListener('mousemove', (e) => this._handleMouseMove(e));
      this.canvasEl.addEventListener('mouseup', (e) => this._handleMouseUp(e));
      this.canvasEl.addEventListener('mouseleave', () => { this._hideTooltip(); });
      this.canvasEl.addEventListener('click', (e) => this._handleClick(e));
      this.canvasEl.addEventListener('wheel', (e) => this._handleWheel(e), { passive: false });
      this.canvasEl.addEventListener('contextmenu', (e) => {
        // Right-click sebagai alternatif pan (tidak munculkan menu)
        if(this.mode === 'plot' || this.mode === 'edit') e.preventDefault();
      });

      // Keyboard untuk space-hold pan
      window.addEventListener('keydown', this._boundKeyDown);
      window.addEventListener('keyup', this._boundKeyUp);

      if(typeof ResizeObserver !== 'undefined'){
        this._resizeObserver = new ResizeObserver(() => {
          if(this.imageLoaded){
            this._clampPan();
            this._redraw();
          }
        });
        this._resizeObserver.observe(this.container);
      }

      this._inited = true;
    }

    _cursorForMode(mode){
      if(this._spacePressed) return this._panDragState ? 'grabbing' : 'grab';
      if(this._panDragState) return 'grabbing';
      switch(mode){
        case 'plot': return 'crosshair';
        case 'edit': return 'move';
        case 'pick': return 'pointer';
        case 'inspect': return 'grab'; // bisa drag-pan
        case 'view':
        default: return 'default';
      }
    }

    _updateCursor(){
      if(this.canvasEl) this.canvasEl.style.cursor = this._cursorForMode(this.mode);
    }

    render(){
      if(!this.imageUrl){
        console.warn('[SiteplanCanvas] imageUrl kosong, tidak render');
        return;
      }
      this.imageEl.src = this.imageUrl;
    }

    _onImageLoad(){
      this.imageNaturalWidth = this.imageEl.naturalWidth;
      this.imageNaturalHeight = this.imageEl.naturalHeight;
      this.imageLoaded = true;
      // Reset zoom/pan saat image baru di-load
      this.userZoom = 1;
      this.panX = 0;
      this.panY = 0;
      console.log('[SiteplanCanvas] image loaded:', this.imageNaturalWidth + 'x' + this.imageNaturalHeight);
      this._redraw();
    }

    _onImageError(){
      console.error('[SiteplanCanvas] gagal load image:', this.imageUrl);
      this.imageLoaded = false;
      this.container.innerHTML = '<div class="spc-error">⚠️ Gagal memuat siteplan.<br><small>Cek URL: ' + this._escape(this.imageUrl) + '</small></div>';
    }

    // ============================================================
    // RENDER
    // ============================================================
    _getEffectiveScale(){
      // scale efektif = baseScale × userZoom (image px → canvas px)
      return this.baseScale * this.userZoom;
    }

    _clampPan(){
      // Pan bisa positive (geser image ke kanan) atau negative (image ke kiri)
      // Limit supaya image tetap visible di container
      if(!this.imageLoaded) return;
      const containerRect = this.container.getBoundingClientRect();
      const containerW = containerRect.width;
      const containerH = containerRect.height;
      const drawW = this.imageNaturalWidth * this._getEffectiveScale();
      const drawH = this.imageNaturalHeight * this._getEffectiveScale();

      if(drawW <= containerW){
        // Image lebih kecil dari container → center
        this.panX = (containerW - drawW) / 2;
      } else {
        // Image lebih besar → clamp supaya tepi tidak masuk
        const minPanX = containerW - drawW;
        const maxPanX = 0;
        this.panX = Math.max(minPanX, Math.min(maxPanX, this.panX));
      }
      if(drawH <= containerH){
        this.panY = (containerH - drawH) / 2;
      } else {
        const minPanY = containerH - drawH;
        const maxPanY = 0;
        this.panY = Math.max(minPanY, Math.min(maxPanY, this.panY));
      }
    }

    _redraw(){
      if(!this.imageLoaded || !this.ctx) return;

      const containerRect = this.container.getBoundingClientRect();
      const containerW = containerRect.width;
      const containerH = containerRect.height;

      if(containerW < 10 || containerH < 10) return;

      // Hitung baseScale fit-to-container
      const scaleW = containerW / this.imageNaturalWidth;
      const scaleH = containerH / this.imageNaturalHeight;
      this.baseScale = Math.min(scaleW, scaleH);

      // Clamp pan setelah base scale berubah (responsive)
      this._clampPan();

      // Set canvas size = full container (supaya event handler bisa di mana saja)
      const dpr = window.devicePixelRatio || 1;
      this.canvasEl.width = containerW * dpr;
      this.canvasEl.height = containerH * dpr;
      this.canvasEl.style.width = containerW + 'px';
      this.canvasEl.style.height = containerH + 'px';

      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Clear
      this.ctx.fillStyle = '#FAFAFA';
      this.ctx.fillRect(0, 0, containerW, containerH);

      // Draw image dengan transform pan + zoom
      const eff = this._getEffectiveScale();
      const drawW = this.imageNaturalWidth * eff;
      const drawH = this.imageNaturalHeight * eff;
      this.ctx.drawImage(this.imageEl, this.panX, this.panY, drawW, drawH);

      // Draw blok dots
      this._drawBlokDots();

      // Update zoom badge & minimap
      this._updateZoomBadge();
      this._updateMinimap();
    }

    _drawBlokDots(){
      const ctx = this.ctx;
      const eff = this._getEffectiveScale();

      // Adaptive radius berdasarkan zoom level — pin kecil saat zoom rendah
      // supaya tidak menutupi siteplan, pin lebih besar saat zoom in.
      // Penting untuk dataset besar (1000+ blok seperti GWC).
      const z = this.userZoom || 1;
      let baseRadius;
      if(z < 1.5)      baseRadius = 3.5;   // overview: titik kecil saja
      else if(z < 3)   baseRadius = 5;     // medium zoom
      else if(z < 5)   baseRadius = 7;     // close zoom
      else             baseRadius = 9;     // very close zoom

      // Label visibility: hindari visual noise saat zoom rendah dengan banyak blok
      const showAllLabels = z >= 2.5;
      const showSomeLabels = z >= 1.5;

      this.blokList.forEach(blok => {
        if(blok.pixelX === '' || blok.pixelX === null || blok.pixelX === undefined) return;

        let imgX, imgY;
        if(this._pinDragState && this._pinDragState.blok && String(this._pinDragState.blok.id) === String(blok.id)){
          imgX = this._pinDragState.currentX;
          imgY = this._pinDragState.currentY;
        } else {
          imgX = Number(blok.pixelX);
          imgY = Number(blok.pixelY);
        }

        // Convert image pixel → canvas pixel
        const drawX = imgX * eff + this.panX;
        const drawY = imgY * eff + this.panY;

        // Skip kalau di luar viewport (optimization)
        if(drawX < -50 || drawY < -50) return;
        const containerRect = this.container.getBoundingClientRect();
        if(drawX > containerRect.width + 50 || drawY > containerRect.height + 50) return;

        const isHighlighted = this.highlightId === blok.id;
        const isDirty = !!blok._dirty;
        const radius = isHighlighted ? Math.max(baseRadius + 3, 10) : baseRadius;
        const color = this._colorForBlok(blok);

        // Style HOLLOW RING + tiny center dot
        // → Siteplan tetap terlihat di tengah ring
        // → Dot kecil di tengah = indikator presisi posisi
        const fillAlpha = z < 1.5 ? 0.55 : (z < 3 ? 0.75 : 0.92);
        const ringAlpha = z < 1.5 ? 0.85 : 0.95;

        // Outer ring (hollow circle, tidak menutupi siteplan)
        ctx.beginPath();
        ctx.arc(drawX, drawY, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = this._withAlpha(color, ringAlpha);
        ctx.lineWidth = isHighlighted ? 2.5 : 1.8;
        ctx.stroke();

        // Center dot kecil (presisi marker)
        const coreRadius = Math.max(radius * 0.35, 1.5);
        ctx.beginPath();
        ctx.arc(drawX, drawY, coreRadius, 0, 2 * Math.PI);
        ctx.fillStyle = this._withAlpha(color, fillAlpha);
        ctx.fill();

        // Dirty indicator
        if(isDirty){
          ctx.beginPath();
          ctx.arc(drawX + radius * 0.7, drawY - radius * 0.7, Math.max(radius * 0.4, 2), 0, 2 * Math.PI);
          ctx.fillStyle = '#F59E0B';
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Highlight: extra outer glow
        if(isHighlighted){
          ctx.beginPath();
          ctx.arc(drawX, drawY, radius + 5, 0, 2 * Math.PI);
          ctx.strokeStyle = this._withAlpha(color, 0.5);
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Label nama — adaptive visibility
        const shouldShowLabel = isHighlighted || showAllLabels || (showSomeLabels && this.userZoom >= 1.8);
        if(shouldShowLabel){
          const txt = blok.nama || '';
          if(txt){
            ctx.font = (isHighlighted ? '600 11px' : '500 10px') + ' DM Sans, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const m = ctx.measureText(txt);
            const padX = 3, padY = 1.5;
            const lblY = drawY + radius + 3;
            // Background pill semi-transparan supaya siteplan tetap terlihat
            ctx.fillStyle = isHighlighted ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.78)';
            this._roundRect(ctx, drawX - m.width/2 - padX, lblY - padY, m.width + 2*padX, 12 + 2*padY, 3);
            ctx.fill();
            ctx.fillStyle = '#1C1C1A';
            ctx.fillText(txt, drawX, lblY);
          }
        }
      });
    }

    _withAlpha(color, alpha){
      // Hex/rgb → rgba dengan alpha tertentu
      if(!color) return 'rgba(0,0,0,' + alpha + ')';
      if(color.indexOf('rgba') === 0) return color;
      if(color.indexOf('rgb') === 0){
        return color.replace('rgb(', 'rgba(').replace(')', ',' + alpha + ')');
      }
      let hex = color.replace('#', '');
      if(hex.length === 3){
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      const r = parseInt(hex.substring(0,2), 16);
      const g = parseInt(hex.substring(2,4), 16);
      const b = parseInt(hex.substring(4,6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    _roundRect(ctx, x, y, w, h, r){
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    _colorForBlok(blok){
      if(this.colorFn){
        try { return this.colorFn(blok); }
        catch(e){ console.warn('colorFn error:', e); }
      }
      return TIPE_COLORS[String(blok.tipe || 'rumah').toLowerCase()] || TIPE_COLORS.rumah;
    }

    // ============================================================
    // ZOOM & PAN
    // ============================================================
    _updateZoomBadge(){
      if(!this._zoomBadgeEl) return;
      const pct = Math.round(this.userZoom * 100);
      this._zoomBadgeEl.textContent = pct + '%';
      this._zoomBadgeEl.style.display = (this.userZoom > 1.001 || this.userZoom < 0.999) ? '' : 'none';
    }

    _updateMinimap(){
      if(!this._minimapEl || !this._minimapCtx || !this.imageLoaded) return;

      // Tampilkan minimap hanya saat zoom > 1 (image lebih besar dari container)
      if(this.userZoom <= 1.001){
        this._minimapEl.style.display = 'none';
        return;
      }
      this._minimapEl.style.display = '';

      const mctx = this._minimapCtx;
      const mw = MINIMAP_W;
      const mh = MINIMAP_H;

      // Hitung scale minimap (fit image natural ke MINIMAP_W × MINIMAP_H)
      const ms = Math.min(mw / this.imageNaturalWidth, mh / this.imageNaturalHeight);
      const drawW = this.imageNaturalWidth * ms;
      const drawH = this.imageNaturalHeight * ms;
      const offX = (mw - drawW) / 2;
      const offY = (mh - drawH) / 2;

      // Clear minimap
      mctx.fillStyle = '#F1F5F9';
      mctx.fillRect(0, 0, mw, mh);

      // Draw image (scaled-down)
      mctx.drawImage(this.imageEl, offX, offY, drawW, drawH);

      // Draw viewport rectangle (area yang lagi visible)
      // Image space: viewport mulai dari (image px) -panX/eff, -panY/eff
      const eff = this._getEffectiveScale();
      const containerRect = this.container.getBoundingClientRect();
      const vpImgX = -this.panX / eff;
      const vpImgY = -this.panY / eff;
      const vpImgW = containerRect.width / eff;
      const vpImgH = containerRect.height / eff;

      const rx = offX + vpImgX * ms;
      const ry = offY + vpImgY * ms;
      const rw = vpImgW * ms;
      const rh = vpImgH * ms;

      mctx.strokeStyle = '#2563EB';
      mctx.lineWidth = 2;
      mctx.strokeRect(rx, ry, rw, rh);
      mctx.fillStyle = 'rgba(37, 99, 235, 0.12)';
      mctx.fillRect(rx, ry, rw, rh);
    }

    _handleMinimapClick(evt){
      // Klik di minimap → pan supaya pusat viewport ke titik tersebut
      if(!this.imageLoaded) return;
      const rect = this._minimapCanvas.getBoundingClientRect();
      const mx = evt.clientX - rect.left;
      const my = evt.clientY - rect.top;

      const ms = Math.min(MINIMAP_W / this.imageNaturalWidth, MINIMAP_H / this.imageNaturalHeight);
      const drawW = this.imageNaturalWidth * ms;
      const drawH = this.imageNaturalHeight * ms;
      const offX = (MINIMAP_W - drawW) / 2;
      const offY = (MINIMAP_H - drawH) / 2;

      const imgX = (mx - offX) / ms;
      const imgY = (my - offY) / ms;

      // Set pan supaya (imgX, imgY) jadi pusat container
      const eff = this._getEffectiveScale();
      const containerRect = this.container.getBoundingClientRect();
      this.panX = containerRect.width / 2 - imgX * eff;
      this.panY = containerRect.height / 2 - imgY * eff;
      this._clampPan();
      this._redraw();
    }

    _handleWheel(evt){
      if(!this.imageLoaded) return;
      evt.preventDefault();

      // Hitung target zoom (scroll up = zoom in, scroll down = zoom out)
      const delta = evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.userZoom * delta));
      if(newZoom === this.userZoom) return;

      // Zoom-to-cursor: pertahankan posisi cursor di image space
      const rect = this.canvasEl.getBoundingClientRect();
      const cssX = evt.clientX - rect.left;
      const cssY = evt.clientY - rect.top;

      // Posisi image px di cursor sebelum zoom
      const oldEff = this._getEffectiveScale();
      const imgX = (cssX - this.panX) / oldEff;
      const imgY = (cssY - this.panY) / oldEff;

      // Apply new zoom
      this.userZoom = newZoom;
      const newEff = this._getEffectiveScale();

      // Adjust pan supaya (imgX, imgY) tetap di posisi cursor
      this.panX = cssX - imgX * newEff;
      this.panY = cssY - imgY * newEff;

      this._clampPan();
      this._redraw();
    }

    zoomIn(){
      if(!this.imageLoaded) return;
      const newZoom = Math.min(ZOOM_MAX, this.userZoom * ZOOM_STEP);
      this._zoomCenter(newZoom);
    }

    zoomOut(){
      if(!this.imageLoaded) return;
      const newZoom = Math.max(ZOOM_MIN, this.userZoom / ZOOM_STEP);
      this._zoomCenter(newZoom);
    }

    zoomReset(){
      if(!this.imageLoaded) return;
      this.userZoom = 1;
      this.panX = 0;
      this.panY = 0;
      this._clampPan();
      this._redraw();
    }

    _zoomCenter(newZoom){
      // Zoom dengan center anchor (untuk tombol button)
      const rect = this.canvasEl.getBoundingClientRect();
      const cssX = rect.width / 2;
      const cssY = rect.height / 2;
      const oldEff = this._getEffectiveScale();
      const imgX = (cssX - this.panX) / oldEff;
      const imgY = (cssY - this.panY) / oldEff;
      this.userZoom = newZoom;
      const newEff = this._getEffectiveScale();
      this.panX = cssX - imgX * newEff;
      this.panY = cssY - imgY * newEff;
      this._clampPan();
      this._redraw();
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================
    _getEventCoords(evt){
      const rect = this.canvasEl.getBoundingClientRect();
      const cssX = evt.clientX - rect.left;
      const cssY = evt.clientY - rect.top;
      const eff = this._getEffectiveScale();
      // CSS px → image px (dengan pan & zoom)
      const imgX = Math.round((cssX - this.panX) / eff);
      const imgY = Math.round((cssY - this.panY) / eff);
      return { cssX, cssY, imgX, imgY };
    }

    _hitTest(cssX, cssY){
      const eff = this._getEffectiveScale();
      // Hit radius scale dengan zoom (selalu DEFAULT_DOT_RADIUS+4 di canvas px)
      const hitRadius = (DEFAULT_DOT_RADIUS + 4);
      for(let i = this.blokList.length - 1; i >= 0; i--){
        const blok = this.blokList[i];
        if(blok.pixelX === '' || blok.pixelX === null || blok.pixelX === undefined) continue;
        const bx = Number(blok.pixelX) * eff + this.panX;
        const by = Number(blok.pixelY) * eff + this.panY;
        const dist = Math.hypot(cssX - bx, cssY - by);
        if(dist <= hitRadius) return blok;
      }
      return null;
    }

    _shouldStartPan(evt){
      // Pan trigger:
      // 1. Hold space + click (semua mode) — paling pro
      // 2. Middle mouse button
      // 3. Mode inspect: drag biasa (tidak konflik action lain)
      if(this._spacePressed) return true;
      if(evt.button === 1) return true; // middle button
      if(evt.button === 2) return true; // right button (alternatif pan)
      if(this.mode === 'inspect' && evt.button === 0) return true;
      return false;
    }

    _handleMouseDown(evt){
      if(!this.imageLoaded) return;

      const c = this._getEventCoords(evt);

      // Cek pan dulu (priority lebih tinggi dari pin drag)
      if(this._shouldStartPan(evt)){
        // Tapi kalau di mode inspect dan klik tepat di pin, prioritaskan klik (tidak pan)
        // — biarkan _handleClick yang handle highlight pin
        if(this.mode === 'inspect' && evt.button === 0){
          const hit = this._hitTest(c.cssX, c.cssY);
          if(hit){
            // Tidak start pan; biarkan click event yang handle
            return;
          }
        }
        this._panDragState = {
          startCssX: c.cssX,
          startCssY: c.cssY,
          startPanX: this.panX,
          startPanY: this.panY,
          moved: false
        };
        this._updateCursor();
        this._hideTooltip();
        evt.preventDefault();
        return;
      }

      // Mode edit: drag pin
      if(this.mode === 'edit' && evt.button === 0){
        const hit = this._hitTest(c.cssX, c.cssY);
        if(hit){
          this._pinDragState = {
            blok: hit,
            startX: Number(hit.pixelX),
            startY: Number(hit.pixelY),
            currentX: Number(hit.pixelX),
            currentY: Number(hit.pixelY)
          };
          this._pinDragMoved = false;
          this.canvasEl.style.cursor = 'grabbing';
          this._hideTooltip();
          evt.preventDefault();
        }
      }
    }

    _handleMouseMove(evt){
      if(!this.imageLoaded) return;
      const c = this._getEventCoords(evt);

      // Pan in progress
      if(this._panDragState){
        const dx = c.cssX - this._panDragState.startCssX;
        const dy = c.cssY - this._panDragState.startCssY;
        if(Math.abs(dx) > 2 || Math.abs(dy) > 2) this._panDragState.moved = true;
        this.panX = this._panDragState.startPanX + dx;
        this.panY = this._panDragState.startPanY + dy;
        this._clampPan();
        this._redraw();
        return;
      }

      // Pin drag in progress (mode=edit)
      if(this._pinDragState && this.mode === 'edit'){
        this._pinDragState.currentX = Math.max(0, Math.min(this.imageNaturalWidth, c.imgX));
        this._pinDragState.currentY = Math.max(0, Math.min(this.imageNaturalHeight, c.imgY));
        if(c.imgX !== this._pinDragState.startX || c.imgY !== this._pinDragState.startY){
          this._pinDragMoved = true;
        }
        this._redraw();
        return;
      }

      // Hover tooltip (inspect & edit mode, kalau tidak sedang pan/drag)
      if((this.mode === 'inspect' || this.mode === 'edit') && !this._spacePressed){
        const hit = this._hitTest(c.cssX, c.cssY);
        if(hit){
          this._showTooltip(hit, c.cssX, c.cssY);
          if(this.mode === 'edit') this.canvasEl.style.cursor = 'grab';
        } else {
          this._hideTooltip();
          this._updateCursor();
        }
      }
    }

    _handleMouseUp(evt){
      if(!this.imageLoaded) return;

      // End pan
      if(this._panDragState){
        const wasMoved = this._panDragState.moved;
        this._panDragState = null;
        this._updateCursor();
        // Kalau tidak moved (just click), biarkan click event handler yang handle
        if(wasMoved){
          // Suppress click yang akan datang setelah ini
          this._suppressNextClick = true;
        }
        return;
      }

      // End pin drag
      if(this._pinDragState){
        const ds = this._pinDragState;
        this._pinDragState = null;
        this._updateCursor();

        if(this._pinDragMoved && this.onMove){
          this.onMove(ds.blok, ds.currentX, ds.currentY);
        }
        this._redraw();
      }
    }

    _handleClick(evt){
      if(!this.imageLoaded || !this.onTap) return;

      // Suppress click setelah pan drag
      if(this._suppressNextClick){
        this._suppressNextClick = false;
        return;
      }

      // Pin drag yang baru saja terjadi (sudah ditangani di mouseup)
      if(this._pinDragMoved){
        this._pinDragMoved = false;
        return;
      }

      // Right/middle click tidak trigger onTap (untuk pan saja)
      if(evt.button !== 0) return;

      const c = this._getEventCoords(evt);
      const hit = this._hitTest(c.cssX, c.cssY);

      // Validasi: kalau plot mode & koordinat di luar image, abaikan
      if(this.mode === 'plot' && !hit){
        if(c.imgX < 0 || c.imgX > this.imageNaturalWidth ||
           c.imgY < 0 || c.imgY > this.imageNaturalHeight) return;
      }

      this.onTap(hit, c.imgX, c.imgY, evt);
    }

    _handleKeyDown(evt){
      if(evt.code === 'Space' && !this._spacePressed){
        // Hanya aktifkan kalau focus tidak di input/textarea
        const target = evt.target;
        if(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        this._spacePressed = true;
        this._updateCursor();
        evt.preventDefault();
      } else if((evt.code === 'Equal' || evt.code === 'NumpadAdd') && evt.ctrlKey){
        // Ctrl + + = zoom in
        evt.preventDefault();
        this.zoomIn();
      } else if((evt.code === 'Minus' || evt.code === 'NumpadSubtract') && evt.ctrlKey){
        evt.preventDefault();
        this.zoomOut();
      } else if(evt.code === 'Digit0' && evt.ctrlKey){
        evt.preventDefault();
        this.zoomReset();
      }
    }

    _handleKeyUp(evt){
      if(evt.code === 'Space'){
        this._spacePressed = false;
        this._updateCursor();
      }
    }

    // ============================================================
    // TOOLTIP
    // ============================================================
    _showTooltip(blok, cssX, cssY){
      if(!this._tooltipEl) return;
      const tipeRaw = String(blok.tipe || 'rumah').toLowerCase();
      const tipeLabel = tipeRaw.charAt(0).toUpperCase() + tipeRaw.slice(1);
      const dirty = blok._dirty ? ' <span class="spc-tooltip-badge">● unsaved</span>' : '';
      let html =
        '<div class="spc-tooltip-name">' + this._escape(blok.nama || '—') + dirty + '</div>' +
        '<div class="spc-tooltip-meta">' + this._escape(tipeLabel) +
          ' · (' + Number(blok.pixelX) + ', ' + Number(blok.pixelY) + ')</div>';
      if(blok.catatan){
        html += '<div class="spc-tooltip-note">' + this._escape(blok.catatan) + '</div>';
      }
      this._tooltipEl.innerHTML = html;
      this._tooltipEl.style.display = 'block';

      const containerRect = this.container.getBoundingClientRect();
      const tipRect = this._tooltipEl.getBoundingClientRect();
      let tx = cssX + 14;
      let ty = cssY + 14;
      if(tx + tipRect.width > containerRect.width){
        tx = cssX - tipRect.width - 10;
      }
      if(ty + tipRect.height > containerRect.height){
        ty = cssY - tipRect.height - 10;
      }
      this._tooltipEl.style.left = Math.max(4, tx) + 'px';
      this._tooltipEl.style.top = Math.max(4, ty) + 'px';
    }

    _hideTooltip(){
      if(this._tooltipEl) this._tooltipEl.style.display = 'none';
    }

    // ============================================================
    // PUBLIC API
    // ============================================================
    setMode(mode){
      this.mode = mode || 'inspect';
      this._hideTooltip();
      this._updateCursor();
    }

    setBlok(list){
      this.blokList = Array.isArray(list) ? list.slice() : [];
      if(this.imageLoaded) this._redraw();
    }

    addBlok(blok){
      this.blokList.push(blok);
      if(this.imageLoaded) this._redraw();
    }

    updateBlok(id, patch){
      const idx = this.blokList.findIndex(b => String(b.id) === String(id));
      if(idx >= 0){
        this.blokList[idx] = Object.assign({}, this.blokList[idx], patch);
        if(this.imageLoaded) this._redraw();
      }
    }

    removeBlok(id){
      this.blokList = this.blokList.filter(b => String(b.id) !== String(id));
      if(this.imageLoaded) this._redraw();
    }

    highlight(id){
      this.highlightId = id || null;
      if(this.imageLoaded) this._redraw();
    }

    fitToView(){
      this.zoomReset();
    }

    setImage(url){
      this.imageUrl = url;
      this.imageLoaded = false;
      this.userZoom = 1;
      this.panX = 0;
      this.panY = 0;
      if(url) this.imageEl.src = url;
    }

    destroy(){
      if(this._resizeObserver){
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      window.removeEventListener('keydown', this._boundKeyDown);
      window.removeEventListener('keyup', this._boundKeyUp);
      if(this.container) this.container.innerHTML = '';
      this.canvasEl = null;
      this.ctx = null;
      this._tooltipEl = null;
      this._zoomBadgeEl = null;
      this._minimapEl = null;
      this._minimapCanvas = null;
      this._minimapCtx = null;
      this._inited = false;
    }

    _escape(s){
      return String(s||'').replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
      );
    }
  }

  // Expose ke global
  global.SiteplanCanvas = SiteplanCanvas;
  global.SITEPLAN_TIPE_COLORS = TIPE_COLORS;

  console.log('[siteplan-canvas] component loaded (Sesi B-rev2: zoom + pan + minimap)');
})(typeof window !== 'undefined' ? window : this);
