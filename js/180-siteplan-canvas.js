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
 * Sesi B: PENGAYAAN — drag-edit, plot baru via tap, popup detail, dll.
 *
 * Pattern:
 *   const canvas = new SiteplanCanvas(containerEl, {
 *     imageUrl: 'https://.../siteplan.png',
 *     mode: 'plot',
 *     blokList: [{id, nama, pixelX, pixelY, ...}, ...],
 *     colorFn: (blok) => '#FF0000',           // optional, default by tipe
 *     onTap: (blok|null, x, y) => {...},      // tap handler
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
      this.mode = options.mode || 'inspect'; // plot | edit | inspect | view | pick
      this.blokList = Array.isArray(options.blokList) ? options.blokList.slice() : [];
      this.colorFn = typeof options.colorFn === 'function' ? options.colorFn : null;
      this.onTap = typeof options.onTap === 'function' ? options.onTap : null;
      this.onMove = typeof options.onMove === 'function' ? options.onMove : null;

      this.highlightId = null;
      this.imageNaturalWidth = 0;
      this.imageNaturalHeight = 0;
      this.scale = 1;          // pixel canvas / pixel image
      this.canvasEl = null;
      this.ctx = null;
      this.imageEl = null;
      this.imageLoaded = false;
      this._inited = false;

      this._buildDOM();
    }

    _buildDOM(){
      // Wrapper sudah disediakan caller; kita inject canvas + image preloader di dalamnya
      this.container.classList.add('spc-host');
      this.container.innerHTML = ''; // bersihkan

      // Image preloader (hidden)
      this.imageEl = new Image();
      this.imageEl.crossOrigin = 'anonymous';
      this.imageEl.onload = () => this._onImageLoad();
      this.imageEl.onerror = () => this._onImageError();

      // Canvas
      this.canvasEl = document.createElement('canvas');
      this.canvasEl.className = 'spc-canvas';
      this.canvasEl.style.cursor = this._cursorForMode(this.mode);
      this.container.appendChild(this.canvasEl);
      this.ctx = this.canvasEl.getContext('2d');

      // Tap handler
      this.canvasEl.addEventListener('click', (e) => this._handleTap(e));

      // Resize observer (responsive)
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

      // Hitung scale fit-to-container preserving aspect ratio
      const scaleW = containerW / this.imageNaturalWidth;
      const scaleH = containerH / this.imageNaturalHeight;
      this.scale = Math.min(scaleW, scaleH);

      const drawW = this.imageNaturalWidth * this.scale;
      const drawH = this.imageNaturalHeight * this.scale;

      // Set canvas size
      const dpr = window.devicePixelRatio || 1;
      this.canvasEl.width = drawW * dpr;
      this.canvasEl.height = drawH * dpr;
      this.canvasEl.style.width = drawW + 'px';
      this.canvasEl.style.height = drawH + 'px';

      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Clear & draw image
      this.ctx.clearRect(0, 0, drawW, drawH);
      this.ctx.drawImage(this.imageEl, 0, 0, drawW, drawH);

      // Draw blok dots
      this._drawBlokDots();
    }

    _drawBlokDots(){
      const ctx = this.ctx;
      this.blokList.forEach(blok => {
        if(blok.pixelX === '' || blok.pixelX === null || blok.pixelX === undefined) return;
        const px = Number(blok.pixelX) * this.scale;
        const py = Number(blok.pixelY) * this.scale;

        const isHighlighted = this.highlightId === blok.id;
        const radius = isHighlighted ? HIGHLIGHT_DOT_RADIUS : DEFAULT_DOT_RADIUS;
        const color = this._colorForBlok(blok);

        // Outer ring (white border)
        ctx.beginPath();
        ctx.arc(px, py, radius + 2, 0, 2 * Math.PI);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();

        // Main dot
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();

        // Highlight ring (kalau highlighted)
        if(isHighlighted){
          ctx.beginPath();
          ctx.arc(px, py, radius + 6, 0, 2 * Math.PI);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Label nama (kalau diizinkan dan radius cukup besar)
        if(this.scale > 0.3 || isHighlighted){
          ctx.fillStyle = '#1C1C1A';
          ctx.font = (isHighlighted ? '600 11px' : '500 10px') + ' DM Sans, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(blok.nama || '', px, py + radius + 4);
        }
      });
    }

    _colorForBlok(blok){
      if(this.colorFn){
        try { return this.colorFn(blok); }
        catch(e){ console.warn('colorFn error:', e); }
      }
      return TIPE_COLORS[String(blok.tipe || 'rumah').toLowerCase()] || TIPE_COLORS.rumah;
    }

    _handleTap(evt){
      if(!this.imageLoaded || !this.onTap) return;

      const rect = this.canvasEl.getBoundingClientRect();
      const cssX = evt.clientX - rect.left;
      const cssY = evt.clientY - rect.top;

      // Convert ke koordinat image asli
      const imgX = Math.round(cssX / this.scale);
      const imgY = Math.round(cssY / this.scale);

      // Cek apakah tap di blok yang sudah ada (radius hit ~12px di canvas space)
      const hitRadius = (DEFAULT_DOT_RADIUS + 4);
      let hitBlok = null;
      for(const blok of this.blokList){
        if(blok.pixelX === '' || blok.pixelX === null || blok.pixelX === undefined) continue;
        const bx = Number(blok.pixelX) * this.scale;
        const by = Number(blok.pixelY) * this.scale;
        const dist = Math.hypot(cssX - bx, cssY - by);
        if(dist <= hitRadius){
          hitBlok = blok;
          break;
        }
      }

      this.onTap(hitBlok, imgX, imgY, evt);
    }

    setMode(mode){
      this.mode = mode || 'inspect';
      if(this.canvasEl){
        this.canvasEl.style.cursor = this._cursorForMode(this.mode);
      }
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

  console.log('[siteplan-canvas] component loaded');
})(typeof window !== 'undefined' ? window : this);
