// Canvas map renderer.
//
// Performance notes (it has to stay smooth on phones):
//  * Two canvases: the base layer (dots + labels) only redraws when the view or the
//    filters change; the overlay (selection, hover, "now playing" pulse) is cheap
//    and can animate on its own.
//  * Labels use precomputed zoom levels: for each level the label set is chosen
//    greedily in world space, so panning never re-runs collision detection and
//    labels don't flicker. Each level contains every label of the level below,
//    so zooming in only ever adds labels.
//  * Text is drawn without halos, batched by font size.
import { clamp, Emitter } from "./util.js";
import { model } from "./data.js";

const LONG = 2600;
const LEVEL_STEP = 1.55;
const MAX_ZOOM = 80;
const FONT = "Nunito, system-ui, -apple-system, 'Segoe UI', sans-serif";

export class MapView extends Emitter {
  constructor(stage) {
    super();
    this.stage = stage;
    this.base = stage.querySelector("#map");
    this.over = stage.querySelector("#overlay");
    this.bctx = this.base.getContext("2d", { alpha: false });
    this.octx = this.over.getContext("2d");
    this.mini = document.querySelector("#minimap");
    this.mctx = this.mini.getContext("2d");

    this.W = 0; this.H = 0; this.DPR = 1;
    this.view = { cx: LONG / 2, cy: 500, z: 1 };
    this.zFit = 1;
    this.worldW = LONG; this.worldH = 1000;
    this.landscape = true;

    this.match = null;
    this.filterActive = false;
    this.order = model.staticOrder;
    this.levels = [];
    this.labelScale = 1;

    this.sel = -1; this.hover = -1; this.playing = -1; this.isPlaying = false;
    this.neighbors = [];
    this.trail = null;
    this.visited = new Set();
    this.hitRects = [];
    this.colors = {};
    this.padBottom = 0;
    this.rightInset = 0;

    this._sprites = new Map();
    this._raf = 0; this._needBase = false; this._anim = 0; this._pulse = 0;
    this.fx = null; this._waves = []; this._seenKicks = 0;   // fx: BeatAnalyser, set by main.js
    this._bindInput();
  }

  // ───────────── setup ─────────────
  init() {
    this.match = new Uint8Array(model.G.length).fill(1);
    this.measureLabels();
    this.readColors();
    this.resize(false);
  }

  measureLabels() {
    const ctx = this.bctx;
    ctx.font = `700 100px ${FONT}`;
    for (const g of model.G) g.tw = ctx.measureText(g.n).width / 100;
    this.levels = [];
    this.clearSprites();
    this.render();
    this.warmLevels();
  }

  /** Compute label levels ahead of time so crossing a zoom threshold never stutters. */
  warmLevels() {
    const idle = window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 60));
    const gen = ++this._warmGen || (this._warmGen = 1);
    const step = (dl) => {
      if (gen !== this._warmGen) return;
      let k = this.levels.findIndex((l) => !l);
      if (k < 0) k = this.levels.length;
      if (k > 12) return warmSprites(dl);
      this.level(k);
      if (dl.timeRemaining() > 4) step(dl); else idle(step);
    };
    // then pre-render the label sprites of the overview levels
    let queue = null;
    const warmSprites = (dl) => {
      if (gen !== this._warmGen) return;
      if (!queue) queue = [...this.level(0).list, ...this.level(1).list, ...this.level(2).list];
      while (queue.length && dl.timeRemaining() > 3) {
        const i = queue.shift();
        if (!this._sprites.has(i)) this._makeSprite(model.G[i], this.fs(model.G[i]));
      }
      if (queue.length) idle(warmSprites);
    };
    idle(step);
  }

  readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    this.colors = {
      bg: v("--map-bg"), grid: v("--map-grid"), dim: v("--map-dim"),
      text: v("--text"), accent: v("--accent"), pill: v("--bg-elev"), halo: v("--map-halo"),
    };
    this.clearSprites();
    this._buildMinimap();
    this.render();
  }

  setLabelScale(s) { this.labelScale = s; this.levels = []; this.clearSprites(); this.render(); this.warmLevels(); }

  setMatch(match, filterActive, order) {
    this.match = match;
    this.filterActive = filterActive;
    this.order = order;
    this.levels = [];
    this._buildMinimap();
    this.render();
    this.warmLevels();
  }

  /** Polyline over a list of genre indices (genre path), or null to clear. */
  setTrail(list) { this.trail = list; this.renderOverlay(); }
  setSelected(i, neighbors = []) { this.sel = i; this.neighbors = neighbors; this.renderOverlay(); }
  setHover(i) { if (i !== this.hover) { this.hover = i; this.renderOverlay(); } }
  setPlaying(i, playing) {
    this.playing = i; this.isPlaying = playing;
    if (playing) this._startPulse(); else this.renderOverlay();
  }

  resize(keepView = true) {
    const st = this.stage;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr !== this.DPR) this.clearSprites();
    // nothing changed (e.g. the phone bottom sheet opens over the map): skip reallocating both
    // canvases and recomputing every label level, which made opening the sheet stutter
    const key = [st.clientWidth, st.clientHeight, dpr, this.rightInset, this.padBottom].join();
    if (keepView && key === this._sizeKey) return;
    this._sizeKey = key;
    this.DPR = dpr;
    this.W = st.clientWidth; this.H = st.clientHeight;
    for (const c of [this.base, this.over]) {
      c.width = Math.round(this.W * this.DPR); c.height = Math.round(this.H * this.DPR);
    }
    const wasLandscape = this.landscape;
    const oldW = this.worldW, oldH = this.worldH;
    this._layoutWorld();
    const oldFit = this.zFit;
    // fit the whole map above the floating player, leaving room for labels on the right
    this.zFit = Math.min((this.W - this.rightInset - 70) / this.worldW, (this.H - this.padBottom - 40) / this.worldH);
    const atOverview = Math.abs(this.view.z / (oldFit || 1) - 1) < 0.03;
    if (!keepView || wasLandscape !== this.landscape || atOverview) this.fit(false);
    else {
      // keep the same relative spot centred when the world stretches
      this.view.cx *= this.worldW / oldW; this.view.cy *= this.worldH / oldH;
      this.view.z *= this.zFit / oldFit || 1;
    }
    this.levels = [];
    this.render();
    this.warmLevels();
  }

  _layoutWorld() {
    const { W, H } = this;
    // orientation follows the window, not the stage, so opening a panel never flips the map
    this.landscape = window.innerWidth >= window.innerHeight * 0.9;
    const ratio = this.landscape ? H / Math.max(1, W) : W / Math.max(1, H);
    const short = clamp(LONG * ratio, 800, LONG * 0.8);
    const G = model.G;
    if (this.landscape) {
      this.worldW = LONG; this.worldH = short;
      for (const g of G) { g.wx = g.e * LONG; g.wy = g.b * short; }
    } else {
      this.worldW = short; this.worldH = LONG;
      for (const g of G) { g.wx = g.b * short; g.wy = (1 - g.e) * LONG; }
    }
    this.emit("orientation", this.landscape);
    this._buildMinimap();
  }

  // ───────────── view ─────────────
  toScreen(wx, wy) {
    const { cx, cy, z } = this.view;
    return [(wx - cx) * z + this.W / 2, (wy - cy) * z + this.H / 2];
  }
  toWorld(sx, sy) {
    const { cx, cy, z } = this.view;
    return [(sx - this.W / 2) / z + cx, (sy - this.H / 2) / z + cy];
  }

  zoomAt(factor, sx = this.W / 2, sy = this.H / 2) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.view.z = clamp(this.view.z * factor, this.zFit * 0.8, this.zFit * MAX_ZOOM);
    const [nx, ny] = this.toWorld(sx, sy);
    this.view.cx += wx - nx; this.view.cy += wy - ny;
    this._clampView();
    this.render();
  }

  _clampView() {
    const v = this.view;
    v.cx = clamp(v.cx, -this.worldW * 0.05, this.worldW * 1.05);
    v.cy = clamp(v.cy, -this.worldH * 0.05, this.worldH * 1.05);
  }

  fit(animate = true, indices = null) {
    const zf = this.zFit;
    let target = { cx: this.worldW / 2 + (60 + this.rightInset) / 2 / zf, cy: this.worldH / 2 + (this.padBottom - 10) / 2 / zf, z: zf };
    if (indices && indices.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of indices) {
        const g = model.G[i];
        x0 = Math.min(x0, g.wx); x1 = Math.max(x1, g.wx); y0 = Math.min(y0, g.wy); y1 = Math.max(y1, g.wy);
      }
      const bw = Math.max(x1 - x0, this.worldW * 0.03), bh = Math.max(y1 - y0, this.worldH * 0.03);
      const usableH = this.H - this.padBottom;
      const z = clamp(Math.min((this.W - 200 - this.rightInset) / bw, (usableH - 80) / bh), this.zFit, this.zFit * 14);
      target = { cx: (x0 + x1) / 2 + (70 + this.rightInset / 2) / z, cy: (y0 + y1) / 2 + this.padBottom / 2 / z, z };
    }
    animate ? this.flyTo(target) : (Object.assign(this.view, target), this.render());
  }

  focus(i, { minZoom = 6 } = {}) {
    const g = model.G[i];
    const z = Math.max(this.view.z, this.zFit * minZoom);
    this.flyTo({ cx: g.wx + (60 + this.rightInset / 2) / z, cy: g.wy + this.padBottom / 2 / z, z });
  }

  flyTo(target, ms = 650) {
    const from = { ...this.view };
    const t0 = performance.now();
    cancelAnimationFrame(this._anim);
    // zoom out a little on long trips, like map apps do
    const dist = Math.hypot(target.cx - from.cx, target.cy - from.cy) * Math.min(from.z, target.z);
    const bump = dist > this.W * 1.2 ? 0.75 : 1;
    const step = (t) => {
      const p = clamp((t - t0) / ms, 0, 1);
      const k = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const lz = Math.log(from.z) + (Math.log(target.z) - Math.log(from.z)) * k;
      const dip = bump < 1 ? Math.log(bump) * Math.sin(Math.PI * p) : 0;
      this.view.z = Math.exp(lz + dip);
      this.view.cx = from.cx + (target.cx - from.cx) * k;
      this.view.cy = from.cy + (target.cy - from.cy) * k;
      this._drawAll();
      if (p < 1) this._anim = requestAnimationFrame(step);
    };
    this._anim = requestAnimationFrame(step);
  }

  /** Smooth zoom toward the cursor: wheel notches / +/- buttons ease in over ~150ms
   *  instead of jumping 20% in one frame. Several notches add up; dragging cancels it. */
  zoomSmooth(factor, sx = this.W / 2, sy = this.H / 2, tau = 55) {
    cancelAnimationFrame(this._anim); this._momentum = null;
    this._zLeft = (this._zLeft || 0) + Math.log(factor);
    this._zx = sx; this._zy = sy; this._zTau = tau;
    if (this._zanim) return;
    let last = performance.now();
    const step = (t) => {
      const dt = clamp(t - last, 1, 64); last = t;
      let d = this._zLeft * (1 - Math.exp(-dt / this._zTau));
      if (Math.abs(this._zLeft - d) < 0.002) d = this._zLeft;
      this._zLeft -= d;
      const z0 = this.view.z;
      const [wx, wy] = this.toWorld(this._zx, this._zy);
      this.view.z = clamp(z0 * Math.exp(d), this.zFit * 0.8, this.zFit * MAX_ZOOM);
      if (this.view.z === z0) this._zLeft = 0;   // hit the zoom limit
      const [nx, ny] = this.toWorld(this._zx, this._zy);
      this.view.cx += wx - nx; this.view.cy += wy - ny;
      this._clampView();
      this._drawAll(t);
      this._zanim = this._zLeft ? requestAnimationFrame(step) : 0;
    };
    this._zanim = requestAnimationFrame(step);
  }

  stopMotion() {
    cancelAnimationFrame(this._anim); this._momentum = null;
    cancelAnimationFrame(this._zanim); this._zanim = 0; this._zLeft = 0;
  }

  // ───────────── rendering ─────────────
  render() {
    this._needBase = true;
    if (this._raf) return;
    this._raf = requestAnimationFrame((t) => {
      this._raf = 0;
      if (this._needBase) this._drawAll(t);
    });
  }
  renderOverlay() {
    if (this._oraf) return;
    this._oraf = requestAnimationFrame(() => { this._oraf = 0; this._drawOverlay(performance.now()); });
  }
  _drawAll(t) {
    this._needBase = false;
    this._drawBase();
    if (t == null || this._overlayT !== t) this._drawOverlay(t ?? performance.now());
    this._drawMinimapView();
  }

  fs(g) {
    return Math.round((11 + Math.min(7.5, Math.log2(1 + g.k) * 1.6)) * this.labelScale * 2) / 2;
  }

  levelIndex() {
    const r = this.view.z / this.zFit;
    return clamp(Math.floor(Math.log(Math.max(r, 1)) / Math.log(LEVEL_STEP) + 1e-6), 0, 12);
  }

  /** Labels visible at zoom level k (memoised until data/filters/layout change). */
  level(k) {
    if (this.levels[k]) return this.levels[k];
    const G = model.G;
    const prev = k > 0 ? this.level(k - 1).list : [];
    const z = this.zFit * Math.pow(LEVEL_STEP, k);
    const cell = 120 / z;
    const grid = new Map();
    const inSet = new Uint8Array(G.length);
    const list = [];
    const key = (cx, cy) => (cx + 4096) * 16384 + (cy + 4096);
    const padX = 3 / z, padY = 1 / z;
    const place = (i, force) => {
      const g = G[i];
      const fs = this.fs(g);
      const x0 = g.wx + 3 / z - padX, x1 = g.wx + (6 + g.tw * fs) / z + padX;
      const y0 = g.wy - (fs * 0.6) / z - padY, y1 = g.wy + (fs * 0.6) / z + padY;
      const cx0 = Math.floor(x0 / cell), cx1 = Math.floor(x1 / cell);
      const cy0 = Math.floor(y0 / cell), cy1 = Math.floor(y1 / cell);
      if (!force) {
        for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
          const arr = grid.get(key(cx, cy));
          if (arr) for (let j = 0; j < arr.length; j += 4) {
            if (x0 < arr[j + 2] && x1 > arr[j] && y0 < arr[j + 3] && y1 > arr[j + 1]) return;
          }
        }
      }
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const kk = key(cx, cy);
        let arr = grid.get(kk);
        if (!arr) grid.set(kk, (arr = []));
        arr.push(x0, y0, x1, y1);
      }
      inSet[i] = 1;
      list.push(i);
    };
    for (const i of prev) place(i, true);
    for (const i of this.order) {
      if (inSet[i] || (this.filterActive && !this.match[i])) continue;
      place(i, false);
    }
    const sorted = list.slice().sort((a, b) => this.fs(G[a]) - this.fs(G[b]));
    return (this.levels[k] = { list, sorted });
  }

  _drawBase() {
    const { bctx: ctx, W, H, DPR, colors } = this;
    const G = model.G;
    if (!G.length) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);

    const { cx, cy, z } = this.view;
    const ox = W / 2 - cx * z, oy = H / 2 - cy * z;

    // faint grid every tenth of the long axis
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    const step = LONG / 10;
    for (let x = 0; x <= this.worldW + 1; x += step) { const sx = Math.round(x * z + ox) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let y = 0; y <= this.worldH + 1; y += step) { const sy = Math.round(y * z + oy) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.stroke();

    const zr = z / this.zFit;
    const r = clamp(1.25 * Math.pow(zr, 0.42), 1.25, 5.5);
    const m = 40;
    const minX = -m, maxX = W + m, minY = -m, maxY = H + m;

    if (this.filterActive) {
      ctx.fillStyle = colors.dim;
      const rd = Math.max(1, r * 0.75);
      for (const g of G) {
        if (this.match[g.i]) continue;
        const sx = g.wx * z + ox, sy = g.wy * z + oy;
        if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue;
        ctx.fillRect(sx - rd, sy - rd, rd * 2, rd * 2);
      }
    }
    const rm = this.filterActive ? r * 1.35 : r;
    const round = rm > 2.4;
    for (const g of G) {
      if (this.filterActive && !this.match[g.i]) continue;
      const sx = g.wx * z + ox, sy = g.wy * z + oy;
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue;
      ctx.fillStyle = g.c;
      if (round) { ctx.beginPath(); ctx.arc(sx, sy, rm, 0, 6.2832); ctx.fill(); }
      else ctx.fillRect(sx - rm, sy - rm, rm * 2, rm * 2);
    }

    // labels: drawn from a cache of pre-rendered sprites (much cheaper than text
    // shaping every frame). New sprites are created on a per-frame budget so
    // crossing a zoom level never blocks a frame; the rest appear next frame.
    const L = this.level(this.levelIndex());
    const hit = [];
    const off = rm + 3;
    let budget = 24, pending = false;
    for (const i of L.sorted) {
      const g = G[i];
      const sx = g.wx * z + ox, sy = g.wy * z + oy;
      const fs = this.fs(g);
      const w = g.tw * fs;
      if (sx + w + off < 0 || sx > W || sy < -fs || sy > H + fs) continue;
      let spr = this._sprites.get(i);
      if (spr) { this._sprites.delete(i); this._sprites.set(i, spr); }
      else {
        if (budget-- <= 0) { pending = true; continue; }
        spr = this._makeSprite(g, fs);
      }
      const x = Math.round((sx + off - spr.pad) * DPR) / DPR, y = Math.round((sy - spr.h / 2) * DPR) / DPR;
      ctx.drawImage(spr.c, x, y, spr.w, spr.h);
      hit.push(sx + off - 6, sy - fs * 0.65, sx + off + w, sy + fs * 0.65, i);
    }
    if (pending) this.render();
    while (this._sprites.size > 1000) this._sprites.delete(this._sprites.keys().next().value);
    this.hitRects = hit;
    this._dotR = rm;
  }

  _makeSprite(g, fs) {
    const pad = 3, DPR = this.DPR;
    const w = Math.ceil(g.tw * fs + pad * 2 + 2), h = Math.ceil(fs * 1.45);
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
    const x = c.getContext("2d");
    x.scale(DPR, DPR);
    x.font = `${fs >= 14 ? 800 : 700} ${fs}px ${FONT}`;
    x.textBaseline = "middle";
    x.lineJoin = "round"; x.lineWidth = 3; x.strokeStyle = this.colors.halo;
    x.strokeText(g.n, pad, h / 2);
    x.fillStyle = g.c;
    x.fillText(g.n, pad, h / 2);
    const spr = { c, w, h, pad };
    this._sprites.set(g.i, spr);
    return spr;
  }
  clearSprites() { this._sprites = new Map(); }

  _drawOverlay(t) {
    this._overlayT = t;
    const { octx: ctx, W, H, DPR, colors } = this;
    const G = model.G;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!G.length) return;

    const sel = this.sel;
    const tr = this.trail;
    if (tr && tr.length > 1) {
      ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.globalAlpha = 0.85;
      let [px, py] = this.toScreen(G[tr[0]].wx, G[tr[0]].wy);
      for (let k = 1; k < tr.length; k++) {
        const [qx, qy] = this.toScreen(G[tr[k]].wx, G[tr[k]].wy);
        ctx.strokeStyle = G[tr[k]].c;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy); ctx.stroke();
        px = qx; py = qy;
      }
      ctx.globalAlpha = 1;
      for (const j of tr) this._dot(j, 4, G[j].c);
    }
    if (sel >= 0 && this.neighbors.length) {
      const [ax, ay] = this.toScreen(G[sel].wx, G[sel].wy);
      ctx.strokeStyle = G[sel].c; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.25;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      for (const j of this.neighbors) { const [bx, by] = this.toScreen(G[j].wx, G[j].wy); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      for (const j of this.neighbors) this._dot(j, 3.5, G[j].c);
    }

    if (this.playing >= 0) {
      const g = G[this.playing];
      const [sx, sy] = this.toScreen(g.wx, g.wy);
      const fx = this.fx;
      if (this.isPlaying && fx) {
        // a ring shoots out on every kick, the dot swells with the beat
        if (fx.kicks !== this._seenKicks) { this._seenKicks = fx.kicks; this._waves.push(t); }
        while (this._waves.length && t - this._waves[0] > 900) this._waves.shift();
        ctx.strokeStyle = g.c;
        for (const t0 of this._waves) {
          const p = (t - t0) / 900, e = 1 - Math.pow(1 - p, 3);
          ctx.globalAlpha = (1 - p) * 0.8;
          ctx.lineWidth = 3.5 * (1 - p) + 0.5;
          ctx.beginPath(); ctx.arc(sx, sy, 9 + e * 56, 0, 6.2832); ctx.stroke();
        }
        const r = 12 + fx.beat * 16 + fx.bass * 8;
        ctx.fillStyle = g.c;
        ctx.globalAlpha = 0.12 + fx.beat * 0.18;
        ctx.beginPath(); ctx.arc(sx, sy, r * 1.6, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 0.2 + fx.beat * 0.3;
        ctx.beginPath(); ctx.arc(sx, sy, r * 0.9, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
        this._dot(this.playing, 4 + fx.beat * 4, g.c);
      }
    }

    if (this.hover >= 0 && this.hover !== sel) {
      this._ring(this.hover, colors.text, 7);
      this._pill(this.hover, false);
    }
    if (sel >= 0) {
      const [sx, sy] = this.toScreen(G[sel].wx, G[sel].wy);
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, 30);
      gr.addColorStop(0, G[sel].c + "77"); gr.addColorStop(1, G[sel].c + "00");
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, 30, 0, 6.2832); ctx.fill();
      this._dot(sel, 5, G[sel].c);
      this._ring(sel, colors.text, 9);
      this._pill(sel, true);
    }
  }

  _dot(i, r, c) {
    const [sx, sy] = this.toScreen(model.G[i].wx, model.G[i].wy);
    const ctx = this.octx;
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
  }
  _ring(i, color, r) {
    const [sx, sy] = this.toScreen(model.G[i].wx, model.G[i].wy);
    const ctx = this.octx;
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.stroke();
  }
  _pill(i, strong) {
    const g = model.G[i];
    const ctx = this.octx;
    const [sx, sy] = this.toScreen(g.wx, g.wy);
    const fs = Math.max(this.fs(g) * 1.2, 15 * this.labelScale);
    ctx.font = `800 ${fs}px ${FONT}`;
    const w = ctx.measureText(g.n).width;
    const x = sx + 14, h = fs * 1.6;
    ctx.fillStyle = this.colors.pill;
    ctx.globalAlpha = 0.94;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x - 8, sy - h / 2, w + 16, h, h / 2) : ctx.rect(x - 8, sy - h / 2, w + 16, h);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (strong) { ctx.strokeStyle = g.c; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.fillStyle = g.c; ctx.textBaseline = "middle";
    ctx.fillText(g.n, x, sy + 0.5);
  }

  _startPulse() {
    if (this._pulseOn) return;
    this._pulseOn = true;
    const loop = (t) => {
      if (!this.isPlaying || this.playing < 0) { this._pulseOn = false; this.renderOverlay(); return; }
      // every frame so the pulse follows the beat, unless a redraw already drew it this frame
      // (all rAF callbacks of one frame get the same timestamp)
      if (this._overlayT !== t) this._drawOverlay(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ───────────── minimap ─────────────
  _buildMinimap() {
    if (!model.G.length || !this.mini) return;
    const maxW = 180, maxH = 110;
    const s = Math.min(maxW / this.worldW, maxH / this.worldH);
    this._ms = s;
    const mw = Math.round(this.worldW * s), mh = Math.round(this.worldH * s);
    this.mini.width = mw * 2; this.mini.height = mh * 2;
    this.mini.style.width = mw + "px"; this.mini.style.height = mh + "px";
    const c = document.createElement("canvas");
    c.width = this.mini.width; c.height = this.mini.height;
    const b = c.getContext("2d");
    b.scale(2, 2);
    for (const g of model.G) {
      b.globalAlpha = this.filterActive && !this.match[g.i] ? 0.1 : 0.9;
      b.fillStyle = g.c;
      b.fillRect(g.wx * s - 0.6, g.wy * s - 0.6, 1.3, 1.3);
    }
    this._miniBase = c;
  }
  _drawMinimapView() {
    if (!this._miniBase) return;
    const ctx = this.mctx, s = this._ms;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.mini.width, this.mini.height);
    ctx.drawImage(this._miniBase, 0, 0);
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const [x0, y0] = this.toWorld(0, 0), [x1, y1] = this.toWorld(this.W, this.H);
    ctx.strokeStyle = this.colors.accent; ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s);
  }

  // ───────────── input ─────────────
  hitTest(sx, sy, touch) {
    const r = this.hitRects;
    for (let k = r.length - 5; k >= 0; k -= 5) {
      if (sx >= r[k] && sx <= r[k + 2] && sy >= r[k + 1] && sy <= r[k + 3]) return r[k + 4];
    }
    const rad = touch ? 22 : 12;
    let best = -1, bd = rad * rad;
    const { cx, cy, z } = this.view;
    const ox = this.W / 2 - cx * z, oy = this.H / 2 - cy * z;
    for (const g of model.G) {
      if (this.filterActive && !this.match[g.i]) continue;
      const dx = g.wx * z + ox - sx, dy = g.wy * z + oy - sy;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = g.i; }
    }
    return best;
  }

  _bindInput() {
    const c = this.over;
    const pts = new Map();
    let drag = null, pinch = null, moved = 0, samples = [];
    // cache the canvas rect: reading it on every move forces a layout while the player updates the DOM
    let rect = null;
    const pos = (ev) => { const r = rect || (rect = c.getBoundingClientRect()); return [ev.clientX - r.left, ev.clientY - r.top]; };
    addEventListener("resize", () => (rect = null));
    addEventListener("scroll", () => (rect = null), true);

    c.addEventListener("pointerdown", (ev) => {
      rect = null;
      c.setPointerCapture(ev.pointerId);
      const [x, y] = pos(ev);
      pts.set(ev.pointerId, { x, y });
      this.stopMotion();
      moved = 0;
      if (pts.size === 1) { drag = { x, y, cx: this.view.cx, cy: this.view.cy }; samples = [[performance.now(), x, y]]; }
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        // absolute pinch: the world point under the fingers' midpoint stays under it, zoom = finger distance ratio
        const [wx, wy] = this.toWorld(mx, my);
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: this.view.z, wx, wy };
        drag = null; moved = 99;
      }
    });
    c.addEventListener("pointermove", (ev) => {
      const [x, y] = pos(ev);
      const p = pts.get(ev.pointerId);
      if (p) { p.x = x; p.y = y; }
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        // 1:1 with the fingers, computed from the pinch start (not step by step), so nothing drifts or lags:
        // zoom = distance ratio, and the start point under the midpoint is kept under the current midpoint
        const z = clamp(pinch.z * (d / pinch.d), this.zFit * 0.8, this.zFit * MAX_ZOOM);
        this.view.z = z;
        this.view.cx = pinch.wx - (mx - this.W / 2) / z; this.view.cy = pinch.wy - (my - this.H / 2) / z;
        this._clampView(); this.render();
        return;
      }
      if (drag) {
        const dx = x - drag.x, dy = y - drag.y;
        moved = Math.max(moved, Math.hypot(dx, dy));
        // follow the finger from the first pixel (no dead zone that then jumps);
        // `moved` still decides on pointerup whether it was a tap
        if (!c.classList.contains("dragging") && moved > (ev.pointerType === "touch" ? 8 : 3)) {
          c.classList.add("dragging");
          this.setHover(-1); this.emit("hover", -1);
        }
        this.view.cx = drag.cx - dx / this.view.z; this.view.cy = drag.cy - dy / this.view.z;
        this._clampView();
        samples.push([performance.now(), x, y]);
        if (samples.length > 6) samples.shift();
        this.render();
        return;
      }
      if (ev.pointerType === "mouse") {
        const h = this.hitTest(x, y, false);
        if (h !== this.hover) { this.setHover(h); this.emit("hover", h, x, y); }
        else if (h >= 0) this.emit("hover", h, x, y);
        c.classList.toggle("pointing", h >= 0);
      }
    });
    const end = (ev) => {
      const [x, y] = pos(ev);
      pts.delete(ev.pointerId);
      c.classList.remove("dragging");
      if (pts.size < 2) pinch = null;
      if (drag && ev.type === "pointerup") {
        const tap = moved <= (ev.pointerType === "touch" ? 8 : 3);
        if (tap) {
          const h = this.hitTest(x, y, ev.pointerType !== "mouse");
          this.emit(h >= 0 ? "pick" : "background", h);
        } else {
          // momentum
          const now = performance.now();
          const s0 = samples.find((s) => now - s[0] < 120) || samples[0];
          const dt = now - s0[0];
          if (dt > 0 && dt < 200) {
            let vx = (x - s0[1]) / dt, vy = (y - s0[2]) / dt;
            const fling = () => {
              if (!this._momentum) return;
              vx *= 0.93; vy *= 0.93;
              this.view.cx -= (vx * 16) / this.view.z; this.view.cy -= (vy * 16) / this.view.z;
              this._clampView();
              this._drawAll();
              if (Math.hypot(vx, vy) > 0.03) requestAnimationFrame(fling); else this._momentum = null;
            };
            this._momentum = true;
            requestAnimationFrame(fling);
          }
        }
      }
      if (pts.size === 0) drag = null;
      else if (pts.size === 1) {
        const [p] = [...pts.values()];
        drag = { x: p.x, y: p.y, cx: this.view.cx, cy: this.view.cy }; moved = 99;
      }
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", (ev) => {
      if (ev.pointerType === "mouse" && this.hover >= 0) { this.setHover(-1); this.emit("hover", -1); }
    });

    // wheel / trackpad: coalesce into one zoom per frame
    let wheel = 0, wx = 0, wy = 0, wraf = 0;
    c.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      cancelAnimationFrame(this._anim); this._momentum = null;   // keep an eased zoom running: notches add up
      const [x, y] = pos(ev);
      if (!ev.ctrlKey && Math.abs(ev.deltaX) > Math.abs(ev.deltaY) * 0.6 && ev.deltaMode === 0) {
        // two-finger horizontal swipe on a trackpad → pan
        this.view.cx += ev.deltaX / this.view.z; this.view.cy += ev.deltaY / this.view.z;
        this._clampView(); this.render();
        return;
      }
      const unit = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 400 : 1;
      if (!ev.ctrlKey) {
        // mouse wheel / two-finger scroll: eased (pinch stays 1:1 so it feels attached to the fingers)
        this.zoomSmooth(Math.exp(-clamp(ev.deltaY * unit * 0.0022, -0.6, 0.6)), x, y);
        return;
      }
      wheel += ev.deltaY * unit * 0.012;
      wx = x; wy = y;
      if (!wraf) wraf = requestAnimationFrame(() => {
        wraf = 0;
        this.zoomAt(Math.exp(-clamp(wheel, -1, 1)), wx, wy);
        wheel = 0;
      });
    }, { passive: false });
    c.addEventListener("dblclick", (ev) => {
      const [x, y] = pos(ev);
      const [wxx, wyy] = this.toWorld(x, y);
      this.flyTo({ cx: wxx, cy: wyy, z: clamp(this.view.z * 2.2, this.zFit, this.zFit * MAX_ZOOM) }, 350);
    });

    this.mini.addEventListener("click", (ev) => {
      const r = this.mini.getBoundingClientRect();
      this.flyTo({ cx: (ev.clientX - r.left) / this._ms, cy: (ev.clientY - r.top) / this._ms, z: this.view.z }, 400);
    });
  }
}
