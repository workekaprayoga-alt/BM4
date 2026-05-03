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
 *         redraw efficient, dirty marker untuk unsaved blok.
 *
 * Pattern:
 *   const canvas = new SiteplanCanvas(containerEl, {
 *     imageUrl: 'https://.../siteplan.png',
 *     mode: 'plot',
 *     blokList: [{id, nama, pixelX, pixelY, ...}, ...],
 *     colorFn: (blok) => '#FF0000',           // optional, default by tipe
 *     onTap: (blok|null, x, y, evt) => {...}, // tap handler
 *     onMove: (blok, newX, newY) => {...}     // drag-end handler (mode=edit)
 *   });
 *   canvas.render();
 *   canvas.setMode('edit');
 *   canvas.setBlok(newList);
 *   canvas.highlight('blk_xxx');
 */
(function(global){
  'use strict';

  const DEFAULT_DOT_RADIUS = 8;
  const HIGHLIGHT_DOT_RADIUS = 12;
  const TIPE_COLORS = {
    rumah: '#2563EB',     // blue
    fasum: '#7C3AED',     // purple
    jalan: '#475569',     // slate
    taman: '#65A30D',     // green
    kosong: '#9B9A96'     // faint
  };

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
      this.scale = 1;
      this.canvasEl = null;
      this.ctx = null;
      this.imageEl = null;
      this.imageLoaded = false;
      this._inited = false;

      // [Sesi B] Drag state
      this._dragState = null;
      this._dragMoved = false;

      // [Sesi B] Tooltip
      this._tooltipEl = null;

      this._buildDOM();
    }

    _buildDOM(){
      this.container.classList.add('spc-host');
      this.container.innerHTML = '';

      this.imageEl = new Image();
      this.imageEl.crossOrigin = 'anonymous';
      this.imageEl.onload = () => this._onImageLoad();
      this.imageEl.onerror = () => this._onImageError();

      this.canvasEl = document.createElement('canvas');
      this.canvasEl.className = 'spc-canvas';
      this.canvasEl.style.cursor = this._cursorForMode(this.mode);
      this.container.appendChild(this.canvasEl);
      this.ctx = this.canvasEl.getContext('2d');

      // [Sesi B] Tooltip element
      this._tooltipEl = document.createElement('div');
      this._tooltipEl.className = 'spc-tooltip';
      this._tooltipEl.style.display = 'none';
      this.container.appendChild(this._tooltipEl);

      // Event handlers
      this.canvasEl.addEventListener('mousedown', (e) => this._handleMouseDown(e));
      this.canvasEl.addEventListener('mousemove', (e) => this._handleMouseMove(e));
      this.canvasEl.addEventListener('mouseup', (e) => this._handleMouseUp(e));
      this.canvasEl.addEventListener('mouseleave', () => { this._hideTooltip(); });
      this.canvasEl.addEventListener('click', (e) => this._handleClick(e));

      if(typeof ResizeObserver !== 'undefined'){
        this._resizeObserver = new ResizeObserver(() => {
          if(this.imageLoaded) this._redraw();
        });
        this._resizeObserver.observe(this.container);
      }

      this._inited = true;
    }

    _cursorForMode(mode){
      switch(mode){
        case 'plot': return 'crosshair';
        case 'edit': return 'move';
        case 'pick': return 'pointer';
        case 'inspect':
        case 'view':
        default: return 'default';
      }
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
      console.log('[SiteplanCanvas] image loaded:', this.imageNaturalWidth + 'x' + this.imageNaturalHeight);
      this._redraw();
    }

    _onImageError(){
      console.error('[SiteplanCanvas] gagal load image:', this.imageUrl);
      this.imageLoaded = false;
      this.container.innerHTML = '<div class="spc-error">⚠️ Gagal memuat siteplan.<br><small>Cek URL: ' + this._escape(this.imageUrl) + '</small></div>';
    }

    _redraw(){
      if(!this.imageLoaded || !this.ctx) return;

      const containerRect = this.container.getBoundingClientRect();
      const containerW = containerRect.width;
      const containerH = containerRect.height;

      if(containerW < 10 || containerH < 10) return;

      const scaleW = containerW / this.imageNaturalWidth;
      const scaleH = containerH / this.imageNaturalHeight;
      this.scale = Math.min(scaleW, scaleH);

      const drawW = this.imageNaturalWidth * this.scale;
      const drawH = this.imageNaturalHeight * this.scale;

      const dpr = window.devicePixelRatio || 1;
      this.canvasEl.width = drawW * dpr;
      this.canvasEl.height = drawH * dpr;
      this.canvasEl.style.width = drawW + 'px';
      this.canvasEl.style.height = drawH + 'px';

      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.ctx.clearRect(0, 0, drawW, drawH);
      this.ctx.drawImage(this.imageEl, 0, 0, drawW, drawH);

      this._drawBlokDots();
    }

    _drawBlokDots(){
      const ctx = this.ctx;
      this.blokList.forEach(blok => {
        if(blok.pixelX === '' || blok.pixelX === null || blok.pixelX === undefined) return;

        // Kalau lagi di-drag, pakai posisi drag (preview)
        let drawX, drawY;
        if(this._dragState && this._dragState.blok && String(this._dragState.blok.id) === String(blok.id)){
          drawX = this._dragState.currentX * this.scale;
          drawY = this._dragState.currentY * this.scale;
        } else {
          drawX = Number(blok.pixelX) * this.scale;
          drawY = Number(blok.pixelY) * this.scale;
        }

        const isHighlighted = this.highlightId === blok.id;
        const isDirty = !!blok._dirty;
        const radius = isHighlighted ? HIGHLIGHT_DOT_RADIUS : DEFAULT_DOT_RADIUS;
        const color = this._colorForBlok(blok);

        // Outer ring (white border)
        ctx.beginPath();
        ctx.arc(drawX, drawY, radius + 2, 0, 2 * Math.PI);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();

        // Main dot
        ctx.beginPath();
        ctx.arc(drawX, drawY, radius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();

        // Dirty indicator
        if(isDirty){
          ctx.beginPath();
          ctx.arc(drawX + radius - 1, drawY - radius + 1, 3.5, 0, 2 * Math.PI);
          ctx.fillStyle = '#F59E0B';
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Highlight ring
        if(isHighlighted){
          ctx.beginPath();
          ctx.arc(drawX, drawY, radius + 6, 0, 2 * Math.PI);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Label nama dengan background pill
        if(this.scale > 0.3 || isHighlighted){
          const txt = blok.nama || '';
          if(txt){
            ctx.font = (isHighlighted ? '600 11px' : '500 10px') + ' DM Sans, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const m = ctx.measureText(txt);
            const padX = 4, padY = 2;
            const lblY = drawY + radius + 4;
            // Pill background
            ctx.fillStyle = 'rgba(255,255,255,0.92)';
            this._roundRect(ctx, drawX - m.width/2 - padX, lblY - padY, m.width + 2*padX, 12 + 2*padY, 3);
            ctx.fill();
            // Text
            ctx.fillStyle = '#1C1C1A';
            ctx.fillText(txt, drawX, lblY);
          }
        }
      });
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

    _getEventCoords(evt){
      const rect = this.canvasEl.getBoundingClientRect();
      const cssX = evt.clientX - rect.left;
      const cssY = evt.clientY - rect.top;
      const imgX = Math.round(cssX / this.scale);
      const imgY = Math.round(cssY / this.scale);
      return { cssX, cssY, imgX, imgY };
    }

    _hitTest(cssX, cssY){
      const hitRadius = (DEFAULT_DOT_RADIUS + 4);
      // Iterate reverse supaya pin terbaru (di atas) yang ke-hit duluan
      for(let i = this.blokList.length - 1; i >= 0; i--){
        const blok = this.blokList[i];
        if(blok.pixelX === '' || blok.pixelX === null || blok.pixelX === undefined) continue;
        const bx = Number(blok.pixelX) * this.scale;
        const by = Number(blok.pixelY) * this.scale;
        const dist = Math.hypot(cssX - bx, cssY - by);
        if(dist <= hitRadius) return blok;
      }
      return null;
    }

    _handleMouseDown(evt){
      if(!this.imageLoaded) return;
      if(this.mode !== 'edit') return;

      const c = this._getEventCoords(evt);
      const hit = this._hitTest(c.cssX, c.cssY);
      if(hit){
        this._dragState = {
          blok: hit,
          startX: Number(hit.pixelX),
          startY: Number(hit.pixelY),
          currentX: Number(hit.pixelX),
          currentY: Number(hit.pixelY)
        };
        this._dragMoved = false;
        this.canvasEl.style.cursor = 'grabbing';
        this._hideTooltip();
        evt.preventDefault();
      }
    }

    _handleMouseMove(evt){
      if(!this.imageLoaded) return;
      const c = this._getEventCoords(evt);

      // Drag in progress
      if(this._dragState && this.mode === 'edit'){
        this._dragState.currentX = Math.max(0, Math.min(this.imageNaturalWidth, c.imgX));
        this._dragState.currentY = Math.max(0, Math.min(this.imageNaturalHeight, c.imgY));
        if(c.imgX !== this._dragState.startX || c.imgY !== this._dragState.startY){
          this._dragMoved = true;
        }
        this._redraw();
        return;
      }

      // Hover untuk tooltip (inspect & edit mode)
      if(this.mode === 'inspect' || this.mode === 'edit'){
        const hit = this._hitTest(c.cssX, c.cssY);
        if(hit){
          this._showTooltip(hit, c.cssX, c.cssY);
          if(this.mode === 'edit') this.canvasEl.style.cursor = 'grab';
        } else {
          this._hideTooltip();
          if(this.mode === 'edit') this.canvasEl.style.cursor = this._cursorForMode(this.mode);
        }
      }
    }

    _handleMouseUp(evt){
      if(!this.imageLoaded) return;
      if(!this._dragState) return;

      const ds = this._dragState;
      this._dragState = null;
      this.canvasEl.style.cursor = this._cursorForMode(this.mode);

      if(this._dragMoved && this.onMove){
        this.onMove(ds.blok, ds.currentX, ds.currentY);
      }
      this._redraw();
    }

    _handleClick(evt){
      if(!this.imageLoaded || !this.onTap) return;

      // Kalau drag baru saja terjadi, jangan trigger click
      if(this._dragMoved){
        this._dragMoved = false;
        return;
      }

      const c = this._getEventCoords(evt);
      const hit = this._hitTest(c.cssX, c.cssY);
      this.onTap(hit, c.imgX, c.imgY, evt);
    }

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

      // Smart position: hindari overflow ke kanan/bawah
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

    setMode(mode){
      this.mode = mode || 'inspect';
      if(this.canvasEl){
        this.canvasEl.style.cursor = this._cursorForMode(this.mode);
      }
      this._hideTooltip();
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
      if(this.imageLoaded) this._redraw();
    }

    setImage(url){
      this.imageUrl = url;
      this.imageLoaded = false;
      if(url) this.imageEl.src = url;
    }

    destroy(){
      if(this._resizeObserver){
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if(this.container) this.container.innerHTML = '';
      this.canvasEl = null;
      this.ctx = null;
      this._tooltipEl = null;
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

  console.log('[siteplan-canvas] component loaded (Sesi B)');
})(typeof window !== 'undefined' ? window : this);
