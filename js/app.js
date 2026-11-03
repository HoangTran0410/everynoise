/* Noisemap — an interactive, filterable map of every Every Noise genre.
 * No framework, no build step: a single canvas renderer + DOM panels. */
(() => {
  "use strict";

  // ───────────────────────── helpers ─────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
    return n;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const hash32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const titleCase = (s) => s.replace(/(^|\s)\S/g, (m) => m.toUpperCase());

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 1800);
  }

  // ───────────────────────── state ─────────────────────────
  let G = [];              // genres
  let byName = new Map();
  let kidsOf = new Map();  // name -> [idx]
  let staticOrder = [];    // label priority
  let FAMILIES = [];
  const state = {
    q: "",
    fams: new Set(),
    country: "",
    scene: false,
    fav: false,
    e: [0, 100],
    b: [0, 100],
    sort: "relevance",
    selected: -1,
    hover: -1,
  };
  let favs = new Set(store.get("nm:favs", []));
  let match = null;        // Uint8Array, 1 = passes filters
  let scores = null;       // Float32Array, text relevance
  let resultList = [];
  let resultLimit = 200;
  let filterActive = false;
  let neighbors = [];

  // ───────────────────────── data ─────────────────────────
  async function load() {
    const res = await fetch("data/genres.json");
    const data = await res.json();
    FAMILIES = data.meta.families;
    let ymin = Infinity, ymax = -Infinity;
    for (const g of data.genres) { ymin = Math.min(ymin, g.y); ymax = Math.max(ymax, g.y); }
    G = data.genres.map((g, i) => ({
      i, n: g.n, x: g.x, y: g.y, c: g.c, f: g.f, co: g.co, s: g.s, p: g.p, k: g.k,
      e: (g.y - ymin) / (ymax - ymin),   // 0 organic → 1 mechanical/electric
      b: g.x / 1500,                     // 0 dense/atmospheric → 1 spiky/bouncy
      nn: norm(g.n),
      h: hash32(g.n),
      wx: 0, wy: 0,
    }));
    byName = new Map(G.map((g) => [g.n, g.i]));
    for (const g of G) for (const p of g.p) {
      const pi = byName.get(p);
      if (pi == null) continue;
      if (!kidsOf.has(p)) kidsOf.set(p, []);
      kidsOf.get(p).push(g.i);
    }
    staticOrder = G.map((g) => g.i).sort((a, b) => (G[b].k - G[a].k) || (G[a].h - G[b].h));
    match = new Uint8Array(G.length).fill(1);
    scores = new Float32Array(G.length);
  }

  // ───────────────────────── layout / orientation ─────────────────────────
  const LONG = 2600, SHORT = 1000;
  let landscape = true;
  let worldW = LONG, worldH = SHORT;

  function layoutWorld() {
    const st = $("#stage");
    const nowLandscape = st.clientWidth >= st.clientHeight * 0.9;
    landscape = nowLandscape;
    // the short axis stretches to the stage's aspect ratio so the map fills the screen
    const ratio = landscape ? st.clientHeight / Math.max(1, st.clientWidth) : st.clientWidth / Math.max(1, st.clientHeight);
    const short = clamp(LONG * ratio, SHORT * 0.8, LONG * 0.8);
    if (landscape) {
      worldW = LONG; worldH = short;
      for (const g of G) { g.wx = g.e * LONG; g.wy = g.b * short; }
      setAxes("🌿 Mộc", "Điện tử ⚡", "🌫 Dày · atmospheric", "🎈 Nảy · bouncy");
    } else {
      worldW = short; worldH = LONG;
      for (const g of G) { g.wx = g.b * short; g.wy = (1 - g.e) * LONG; }
      setAxes("🌫 Dày", "Nảy 🎈", "⚡ Điện tử · electric", "🌿 Mộc · organic");
    }
    buildMinimap();
  }
  function setAxes(a0, a1, b0, b1) {
    $("#ax-a0").textContent = a0; $("#ax-a1").textContent = a1;
    $("#ax-b0").textContent = b0; $("#ax-b1").textContent = b1;
  }

  // ───────────────────────── canvas + view ─────────────────────────
  const canvas = $("#map");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;
  const view = { cx: LONG / 2, cy: SHORT / 2, z: 1 };
  let zFit = 1;
  let colors = {};
  let dirty = true;

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = { bg: v("--map-bg"), grid: v("--map-grid"), dim: v("--map-dim"), text: v("--text"), accent: v("--accent"), faint: v("--text-faint") };
    buildMinimap();
    redraw();
  }

  function resize(keepView = true) {
    const st = $("#stage");
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = st.clientWidth; H = st.clientHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    const wasLandscape = landscape;
    layoutWorld();
    const oldFit = zFit;
    zFit = Math.min(W / (worldW * 1.06), H / (worldH * 1.12));
    if (!keepView || wasLandscape !== landscape) fit(false, false);
    else view.z = view.z * (zFit / oldFit || 1);
    redraw();
  }

  function fit(animate = true, toMatches = true) {
    let target = { cx: worldW / 2, cy: worldH / 2, z: zFit };
    if (toMatches && filterActive && resultList.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of resultList) { const g = G[i]; x0 = Math.min(x0, g.wx); x1 = Math.max(x1, g.wx); y0 = Math.min(y0, g.wy); y1 = Math.max(y1, g.wy); }
      const bw = Math.max(x1 - x0, worldW * 0.04), bh = Math.max(y1 - y0, worldH * 0.04);
      const z = clamp(Math.min(W / (bw * 1.35 + 180 / zFit), H / (bh * 1.35 + 60 / zFit)), zFit, zFit * 12);
      target = { cx: (x0 + x1) / 2 + 60 / z, cy: (y0 + y1) / 2, z };
    }
    animate ? flyTo(target) : Object.assign(view, target);
    redraw();
  }

  const toScreen = (wx, wy) => [(wx - view.cx) * view.z + W / 2, (wy - view.cy) * view.z + H / 2];
  const toWorld = (sx, sy) => [(sx - W / 2) / view.z + view.cx, (sy - H / 2) / view.z + view.cy];

  function zoomAt(factor, sx = W / 2, sy = H / 2) {
    const [wx, wy] = toWorld(sx, sy);
    view.z = clamp(view.z * factor, zFit * 0.6, zFit * 60);
    const [nx, ny] = toWorld(sx, sy);
    view.cx += wx - nx; view.cy += wy - ny;
    clampView();
    redraw();
  }
  function clampView() {
    view.cx = clamp(view.cx, -worldW * 0.1, worldW * 1.1);
    view.cy = clamp(view.cy, -worldH * 0.1, worldH * 1.1);
  }

  let anim = null;
  function flyTo(target, ms = 550) {
    const from = { ...view };
    const t0 = performance.now();
    cancelAnimationFrame(anim);
    const step = (t) => {
      const p = clamp((t - t0) / ms, 0, 1);
      const k = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      // interpolate zoom in log space for a natural feel
      view.z = Math.exp(Math.log(from.z) + (Math.log(target.z) - Math.log(from.z)) * k);
      view.cx = from.cx + (target.cx - from.cx) * k;
      view.cy = from.cy + (target.cy - from.cy) * k;
      draw();
      if (p < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function focusGenre(i) {
    const g = G[i];
    const z = Math.max(view.z, zFit * 7);
    // on phones the detail sheet covers the lower part of the map: keep the genre above it
    const sheet = matchMedia("(max-width: 860px)").matches ? $("#detail").offsetHeight : 0;
    flyTo({ cx: g.wx, cy: g.wy + sheet / 2 / z, z });
  }

  function redraw() {
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(() => { dirty = false; draw(); });
  }

  // label layout results (for hit testing)
  let labelBoxes = [];

  function labelSize(g) {
    const base = 10.5 + Math.min(7, Math.log2(1 + g.k) * 1.7);
    const zf = clamp(view.z / zFit, 1, 4);
    return base * Math.pow(zf, 0.28);
  }

  function draw() {
    if (!G.length) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);

    // subtle grid
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
    const step = worldW / 10;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) { const [sx] = toScreen(i * step, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    const stepY = worldH / Math.round(worldH / step);
    for (let y = 0; y <= worldH + 1; y += stepY) { const [, sy] = toScreen(0, y); ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.stroke();

    const pad = 60;
    const zr = clamp(view.z / zFit, 1, 12);
    const dotR = 1.6 * Math.pow(zr, 0.35);

    // dimmed (non-matching) points
    if (filterActive) {
      ctx.fillStyle = colors.dim;
      ctx.beginPath();
      for (const g of G) {
        if (match[g.i]) continue;
        const sx = (g.wx - view.cx) * view.z + W / 2, sy = (g.wy - view.cy) * view.z + H / 2;
        if (sx < -pad || sy < -pad || sx > W + pad || sy > H + pad) continue;
        ctx.moveTo(sx + dotR * 0.8, sy); ctx.arc(sx, sy, dotR * 0.8, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // matching points
    for (const g of G) {
      if (!match[g.i]) continue;
      const sx = (g.wx - view.cx) * view.z + W / 2, sy = (g.wy - view.cy) * view.z + H / 2;
      if (sx < -pad || sy < -pad || sx > W + pad || sy > H + pad) continue;
      ctx.fillStyle = g.c;
      ctx.beginPath(); ctx.arc(sx, sy, filterActive ? dotR * 1.5 : dotR, 0, Math.PI * 2); ctx.fill();
    }

    // neighbor links
    const sel = state.selected;
    if (sel >= 0) {
      const [ax, ay] = toScreen(G[sel].wx, G[sel].wy);
      ctx.strokeStyle = G[sel].c; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const j of neighbors) { const [bx, by] = toScreen(G[j].wx, G[j].wy); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }

    // labels (greedy, collision-checked, priority ordered)
    labelBoxes = [];
    const CELL = 48;
    const cols = Math.ceil(W / CELL) + 1;
    const grid = new Map();
    const maxLabels = Math.round((W * H) / 2600);
    const collides = (x0, y0, x1, y1) => {
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          const list = grid.get(cy * cols + cx);
          if (!list) continue;
          for (const r of list) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return true;
        }
      return false;
    };
    const occupy = (r) => {
      for (let cx = Math.floor(r[0] / CELL); cx <= Math.floor(r[2] / CELL); cx++)
        for (let cy = Math.floor(r[1] / CELL); cy <= Math.floor(r[3] / CELL); cy++) {
          const key = cy * cols + cx;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(r);
        }
    };

    const forced = [];
    if (state.hover >= 0) forced.push(state.hover);
    if (sel >= 0 && sel !== state.hover) forced.push(sel);
    const seen = new Set();
    const order = filterActive && state.q ? resultList.concat(staticOrder) : staticOrder;

    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    let placed = 0;
    const place = (i, force, ignoreFilter = false) => {
      if (seen.has(i)) return;
      seen.add(i);
      const g = G[i];
      if (!force && !ignoreFilter && !match[i]) return;
      const [sx, sy] = toScreen(g.wx, g.wy);
      if (sx < -200 || sy < -20 || sx > W + 200 || sy > H + 20) return;
      const emph = i === sel || i === state.hover;
      const fs = labelSize(g) * (emph ? 1.25 : 1);
      const w = g.n.length * fs * 0.56 + 4;
      const x0 = sx + dotR + 3, y0 = sy - fs * 0.62, x1 = x0 + w, y1 = sy + fs * 0.62;
      if (!force && (x1 < 0 || x0 > W || collides(x0, y0, x1, y1))) return;
      const r = [x0, y0, x1, y1, i];
      occupy(r); labelBoxes.push(r); placed++;
      if (emph) { emphLabels.push([g, x0, sy, fs]); return; }
      ctx.font = `${g.k > 20 ? 600 : 500} ${fs.toFixed(1)}px Inter, system-ui, sans-serif`;
      ctx.lineWidth = 3.5; ctx.strokeStyle = colors.bg;
      ctx.strokeText(g.n, x0, sy);
      ctx.fillStyle = g.c;
      ctx.fillText(g.n, x0, sy);
    };
    const emphLabels = [];
    for (const i of forced) place(i, true);
    for (const i of neighbors) place(i, false, true);
    for (const i of order) { if (placed >= maxLabels) break; place(i, false); }

    // selection ring
    const ring = (i, color, r) => {
      const [sx, sy] = toScreen(G[i].wx, G[i].wy);
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
    };
    if (state.hover >= 0 && state.hover !== sel) ring(state.hover, colors.text, 6);
    if (sel >= 0) {
      const [sx, sy] = toScreen(G[sel].wx, G[sel].wy);
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, 34);
      gr.addColorStop(0, G[sel].c + "66"); gr.addColorStop(1, G[sel].c + "00");
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI * 2); ctx.fill();
      ring(sel, colors.text, 8);
    }
    // hovered / selected labels on top, on a pill so they're always readable
    for (const [g, x0, sy, fs] of emphLabels) {
      ctx.font = `700 ${fs.toFixed(1)}px Inter, system-ui, sans-serif`;
      const w = ctx.measureText(g.n).width;
      ctx.fillStyle = colors.bg; ctx.globalAlpha = 0.88;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0 - 5, sy - fs * 0.75, w + 10, fs * 1.5, 6) : ctx.rect(x0 - 5, sy - fs * 0.75, w + 10, fs * 1.5); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = g.c; ctx.fillText(g.n, x0, sy);
    }

    drawMinimapView();
  }

  // ───────────────────────── minimap ─────────────────────────
  const mini = $("#minimap");
  const mctx = mini.getContext("2d");
  let miniBase = null;
  let miniScale = 1;
  function buildMinimap() {
    if (!G.length) return;
    const maxW = 200, maxH = 120;
    miniScale = Math.min(maxW / worldW, maxH / worldH);
    const mw = Math.round(worldW * miniScale), mh = Math.round(worldH * miniScale);
    mini.width = mw * 2; mini.height = mh * 2;
    mini.style.width = mw + "px"; mini.style.height = mh + "px";
    miniBase = document.createElement("canvas");
    miniBase.width = mini.width; miniBase.height = mini.height;
    const b = miniBase.getContext("2d");
    b.scale(2, 2);
    for (const g of G) {
      b.globalAlpha = match && !match[g.i] ? 0.12 : 0.9;
      b.fillStyle = g.c;
      b.fillRect(g.wx * miniScale - 0.6, g.wy * miniScale - 0.6, 1.2, 1.2);
    }
  }
  function drawMinimapView() {
    if (!miniBase) return;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mini.width, mini.height);
    mctx.drawImage(miniBase, 0, 0);
    mctx.setTransform(2, 0, 0, 2, 0, 0);
    const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(W, H);
    mctx.strokeStyle = colors.accent; mctx.lineWidth = 1.5;
    mctx.strokeRect(x0 * miniScale, y0 * miniScale, (x1 - x0) * miniScale, (y1 - y0) * miniScale);
  }
  mini.addEventListener("click", (ev) => {
    const r = mini.getBoundingClientRect();
    flyTo({ cx: (ev.clientX - r.left) / miniScale, cy: (ev.clientY - r.top) / miniScale, z: view.z }, 350);
  });

  // ───────────────────────── interaction ─────────────────────────
  function hitTest(sx, sy) {
    for (let k = labelBoxes.length - 1; k >= 0; k--) {
      const r = labelBoxes[k];
      if (sx >= r[0] - 8 && sx <= r[2] && sy >= r[1] && sy <= r[3]) return r[4];
    }
    let best = -1, bd = 12 * 12;
    for (const g of G) {
      if (filterActive && !match[g.i]) continue;
      const [x, y] = toScreen(g.wx, g.wy);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) { bd = d; best = g.i; }
    }
    return best;
  }

  const pointers = new Map();
  let drag = null, pinch = null, moved = 0;
  canvas.addEventListener("pointerdown", (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
    moved = 0;
    cancelAnimationFrame(anim);
    if (pointers.size === 1) drag = { x: ev.offsetX, y: ev.offsetY, cx: view.cx, cy: view.cy };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z };
      drag = null;
    }
  });
  canvas.addEventListener("pointermove", (ev) => {
    const p = pointers.get(ev.pointerId);
    if (p) { p.x = ev.offsetX; p.y = ev.offsetY; }
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const target = clamp(pinch.z * (d / pinch.d), zFit * 0.6, zFit * 60);
      zoomAt(target / view.z, (a.x + b.x) / 2, (a.y + b.y) / 2);
      moved = 99;
      return;
    }
    if (drag) {
      const dx = ev.offsetX - drag.x, dy = ev.offsetY - drag.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (moved > 3) {
        canvas.classList.add("dragging");
        view.cx = drag.cx - dx / view.z; view.cy = drag.cy - dy / view.z;
        clampView(); hideTooltip(); redraw();
      }
      return;
    }
    if (ev.pointerType === "mouse") {
      const h = hitTest(ev.offsetX, ev.offsetY);
      if (h !== state.hover) { state.hover = h; redraw(); }
      canvas.classList.toggle("pointing", h >= 0);
      h >= 0 ? showTooltip(h, ev.offsetX, ev.offsetY) : hideTooltip();
    }
  });
  const endPointer = (ev) => {
    pointers.delete(ev.pointerId);
    canvas.classList.remove("dragging");
    if (pointers.size < 2) pinch = null;
    if (drag && moved <= 3 && ev.type === "pointerup") {
      const h = hitTest(ev.offsetX, ev.offsetY);
      if (h >= 0) select(h, { fly: false });
    }
    if (pointers.size === 0) drag = null;
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", () => { if (state.hover >= 0) { state.hover = -1; redraw(); } hideTooltip(); });
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    cancelAnimationFrame(anim);
    const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0018));
    zoomAt(factor, ev.offsetX, ev.offsetY);
  }, { passive: false });
  canvas.addEventListener("dblclick", (ev) => {
    const [wx, wy] = toWorld(ev.offsetX, ev.offsetY);
    flyTo({ cx: wx, cy: wy, z: clamp(view.z * 2.2, zFit, zFit * 60) }, 350);
  });

  const tip = $("#tooltip");
  function showTooltip(i, x, y) {
    const g = G[i];
    const bits = [...g.f.slice(0, 2), g.co].filter(Boolean).join(" · ");
    tip.innerHTML = `<b style="color:${g.c}">${escapeHtml(g.n)}</b>${bits ? `<span>${escapeHtml(bits)}</span>` : ""}`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = clamp(x + 14, 6, W - tw - 6) + "px";
    tip.style.top = clamp(y + 14, 6, H - th - 6) + "px";
  }
  function hideTooltip() { tip.hidden = true; }

  $("#zoom-in").onclick = () => zoomAt(1.6);
  $("#zoom-out").onclick = () => zoomAt(1 / 1.6);
  $("#zoom-fit").onclick = () => fit();

  // ───────────────────────── search ─────────────────────────
  /** Relevance of genre g for normalized query q (0 = no match). */
  function scoreOf(g, q, tokens) {
    const n = g.nn;
    if (n === q) return 1000;
    let s = 0;
    if (n.startsWith(q)) s = 600;
    else if (n.includes(" " + q)) s = 450;
    else if (n.includes(q)) s = 300;
    else {
      // every token must appear somewhere (name, country or family)
      const hay = n + " " + (g.co ? norm(g.co) : "") + " " + norm(g.f.join(" "));
      let ok = true, ts = 0;
      for (const t of tokens) {
        const idx = hay.indexOf(t);
        if (idx < 0) { ok = false; break; }
        ts += idx < n.length ? (idx === 0 || hay[idx - 1] === " " ? 60 : 30) : 15;
      }
      if (ok) s = 100 + ts;
      else if (q.length >= 4) {
        // fuzzy subsequence fallback ("shogaze" → "shoegaze")
        let qi = 0, gaps = 0, last = -1;
        for (let i = 0; i < n.length && qi < q.length; i++) {
          if (n[i] === q[qi]) { if (last >= 0) gaps += i - last - 1; last = i; qi++; }
        }
        if (qi === q.length && gaps <= q.length) s = 40 - gaps;
      }
    }
    if (s > 0) s += Math.min(40, g.k * 2) - n.length * 0.3;
    return s;
  }

  function applyFilters() {
    const q = norm(state.q.trim());
    const tokens = q.split(/\s+/).filter(Boolean);
    const [e0, e1] = state.e, [b0, b1] = state.b;
    filterActive = !!(q || state.fams.size || state.country || state.scene || state.fav || e0 > 0 || e1 < 100 || b0 > 0 || b1 < 100);
    resultList = [];
    for (const g of G) {
      let ok = true;
      if (state.fams.size && !g.f.some((f) => state.fams.has(f))) ok = false;
      else if (state.country && g.co !== state.country) ok = false;
      else if (state.scene && !g.s) ok = false;
      else if (state.fav && !favs.has(g.n)) ok = false;
      else if (g.e * 100 < e0 || g.e * 100 > e1 || g.b * 100 < b0 || g.b * 100 > b1) ok = false;
      let sc = 0;
      if (ok && q) { sc = scoreOf(g, q, tokens); if (sc <= 0) ok = false; }
      match[g.i] = ok ? 1 : 0;
      scores[g.i] = sc;
      if (ok) resultList.push(g.i);
    }
    sortResults();
    resultLimit = 200;
    renderResults();
    buildMinimap();
    syncClearButtons();
    redraw();
  }

  function sortResults() {
    const by = {
      relevance: (a, b) => (scores[b] - scores[a]) || (G[b].k - G[a].k) || G[a].n.localeCompare(G[b].n),
      az: (a, b) => G[a].n.localeCompare(G[b].n),
      kids: (a, b) => G[b].k - G[a].k || G[a].n.localeCompare(G[b].n),
      electric: (a, b) => G[b].e - G[a].e,
      organic: (a, b) => G[a].e - G[b].e,
      bouncy: (a, b) => G[b].b - G[a].b,
    }[state.sort];
    resultList.sort(by);
  }

  function renderResults() {
    const ul = $("#results");
    ul.textContent = "";
    $("#count").textContent = resultList.length.toLocaleString("vi-VN");
    if (!resultList.length) {
      ul.append(el("li", { class: "empty" }, "Không có thể loại nào khớp. Thử nới bộ lọc nhé."));
      $("#more").hidden = true;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const i of resultList.slice(0, resultLimit)) {
      const g = G[i];
      const meta = g.k ? `${g.k} nhánh` : (g.co || g.f[0] || "");
      frag.append(el("li", { class: i === state.selected ? "active" : "", "data-i": i, title: g.n },
        el("span", { class: "dot", style: `background:${g.c}` }),
        el("span", { class: "name" }, g.n),
        el("span", { class: "meta" }, meta)));
    }
    ul.append(frag);
    $("#more").hidden = resultList.length <= resultLimit;
    $("#more").textContent = `Xem thêm (${(resultList.length - resultLimit).toLocaleString("vi-VN")})`;
  }
  $("#results").addEventListener("click", (ev) => {
    const li = ev.target.closest("li[data-i]");
    if (li) { select(+li.dataset.i); closePanelMobile(); }
  });
  $("#results").addEventListener("mouseover", (ev) => {
    const li = ev.target.closest("li[data-i]");
    const h = li ? +li.dataset.i : -1;
    if (h !== state.hover) { state.hover = h; redraw(); }
  });
  $("#results").addEventListener("mouseleave", () => { state.hover = -1; redraw(); });
  $("#more").onclick = () => { resultLimit += 300; renderResults(); };
  $("#sort").onchange = (ev) => { state.sort = ev.target.value; sortResults(); renderResults(); redraw(); };

  // autocomplete
  const qInput = $("#q"), sug = $("#suggest");
  let sugIdx = -1, sugItems = [];
  function highlight(name, q) {
    const nn = norm(name), i = q ? nn.indexOf(q) : -1;
    if (i < 0) return escapeHtml(name);
    return escapeHtml(name.slice(0, i)) + "<mark>" + escapeHtml(name.slice(i, i + q.length)) + "</mark>" + escapeHtml(name.slice(i + q.length));
  }
  function renderSuggest() {
    const q = norm(state.q.trim());
    if (!q || document.activeElement !== qInput) { sug.hidden = true; return; }
    const tokens = q.split(/\s+/).filter(Boolean);
    sugItems = G.map((g) => [g.i, scoreOf(g, q, tokens)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0]);
    sug.textContent = "";
    sugIdx = -1;
    if (!sugItems.length) { sug.hidden = true; return; }
    for (const i of sugItems) {
      const g = G[i];
      const li = el("li", { role: "option", "data-i": i });
      li.innerHTML = `<span class="dot" style="width:10px;height:10px;border-radius:50%;background:${g.c};flex:none"></span><span>${highlight(g.n, q)}</span><span class="sub">${escapeHtml(g.co || g.f[0] || "")}</span>`;
      sug.append(li);
    }
    sug.hidden = false;
  }
  function moveSuggest(d) {
    if (sug.hidden || !sugItems.length) return;
    const n = sugItems.length;
    sugIdx = sugIdx + d;
    if (sugIdx >= n) sugIdx = -1;
    if (sugIdx < -1) sugIdx = n - 1;
    [...sug.children].forEach((li, k) => li.setAttribute("aria-selected", k === sugIdx));
    if (sugIdx >= 0) sug.children[sugIdx].scrollIntoView({ block: "nearest" });
  }
  let qTimer;
  qInput.addEventListener("input", () => {
    state.q = qInput.value;
    renderSuggest();
    clearTimeout(qTimer);
    qTimer = setTimeout(applyFilters, 120);
  });
  qInput.addEventListener("focus", renderSuggest);
  qInput.addEventListener("blur", () => setTimeout(() => (sug.hidden = true), 150));
  qInput.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); moveSuggest(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); moveSuggest(-1); }
    else if (ev.key === "Enter") {
      const pick = sugIdx >= 0 ? sugItems[sugIdx] : sugItems[0];
      clearTimeout(qTimer); applyFilters();
      if (pick != null) { select(pick); sug.hidden = true; qInput.blur(); }
    } else if (ev.key === "Escape") { sug.hidden = true; qInput.blur(); }
  });
  sug.addEventListener("mousedown", (ev) => {
    const li = ev.target.closest("li[data-i]");
    if (!li) return;
    ev.preventDefault();
    clearTimeout(qTimer); applyFilters();
    select(+li.dataset.i); sug.hidden = true; qInput.blur();
  });

  // ───────────────────────── filters UI ─────────────────────────
  function famColor(f) {
    let best = null;
    for (const g of G) if (g.f.includes(f) && (!best || g.k > best.k)) best = g;
    return best ? best.c : "#888";
  }
  const famBtns = new Map();
  function buildFilters() {
    const box = $("#families");
    const counts = new Map();
    for (const g of G) for (const f of g.f) counts.set(f, (counts.get(f) || 0) + 1);
    for (const f of FAMILIES) {
      const c = famColor(f);
      const b = el("button", { class: "chip", "aria-pressed": "false", style: `--chip-c:${c}`, title: f },
        el("span", { class: "dot", style: `background:${c}` }), f, el("span", { class: "n" }, String(counts.get(f) || 0)));
      b.onclick = () => { state.fams.has(f) ? state.fams.delete(f) : state.fams.add(f); b.setAttribute("aria-pressed", state.fams.has(f)); applyFilters(); fit(); };
      famBtns.set(f, b);
      box.append(b);
    }

    const cc = new Map();
    for (const g of G) if (g.co) cc.set(g.co, (cc.get(g.co) || 0) + 1);
    const sel = $("#country");
    [...cc.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([c, n]) => sel.append(el("option", { value: c }, `${c} (${n})`)));
    sel.onchange = () => { state.country = sel.value; applyFilters(); fit(); };

    $("#only-scene").onchange = (ev) => { state.scene = ev.target.checked; applyFilters(); };
    $("#only-fav").onchange = (ev) => { state.fav = ev.target.checked; applyFilters(); };
    $("#fam-clear").onclick = () => { state.fams.clear(); famBtns.forEach((b) => b.setAttribute("aria-pressed", "false")); applyFilters(); };
    $("#country-clear").onclick = () => { state.country = ""; sel.value = ""; applyFilters(); };

    document.querySelectorAll(".range").forEach((r) => {
      const axis = r.dataset.axis;
      const [lo, hi] = r.querySelectorAll("input");
      const fill = r.querySelector(".dual-fill");
      const sync = () => {
        let a = +lo.value, b = +hi.value;
        if (a > b) [a, b] = [b, a];
        state[axis] = [a, b];
        fill.style.left = a + "%"; fill.style.width = (b - a) + "%";
      };
      let t;
      const onIn = () => { sync(); clearTimeout(t); t = setTimeout(applyFilters, 60); };
      lo.oninput = onIn; hi.oninput = onIn;
      r._reset = () => { lo.value = 0; hi.value = 100; sync(); };
      sync();
    });
    $("#axes-clear").onclick = () => { document.querySelectorAll(".range").forEach((r) => r._reset()); applyFilters(); };
    $("#reset-all").onclick = resetAll;
    updateFavCount();
  }
  function syncClearButtons() {
    $("#fam-clear").hidden = !state.fams.size;
    $("#country-clear").hidden = !state.country;
    $("#axes-clear").hidden = state.e[0] === 0 && state.e[1] === 100 && state.b[0] === 0 && state.b[1] === 100;
    $("#reset-all").disabled = !filterActive;
  }
  function resetAll() {
    state.q = ""; qInput.value = "";
    state.fams.clear(); famBtns.forEach((b) => b.setAttribute("aria-pressed", "false"));
    state.country = ""; $("#country").value = "";
    state.scene = false; $("#only-scene").checked = false;
    state.fav = false; $("#only-fav").checked = false;
    document.querySelectorAll(".range").forEach((r) => r._reset());
    applyFilters();
  }
  function updateFavCount() { $("#fav-count").textContent = favs.size; }

  // ───────────────────────── detail ─────────────────────────
  function nearest(i, k = 10) {
    const g = G[i];
    // distance in the original Every Noise pixel space (that's what "near" means there)
    const arr = [];
    for (const h of G) {
      if (h.i === i) continue;
      arr.push([h.i, Math.hypot(h.x - g.x, (h.y - g.y))]);
    }
    arr.sort((a, b) => a[1] - b[1]);
    return arr.slice(0, k);
  }

  function chip(i) {
    const g = G[i];
    const b = el("button", { class: "chip", title: g.n }, el("span", { class: "dot", style: `background:${g.c}` }), g.n);
    b.onclick = () => select(i);
    return b;
  }

  function select(i, { fly = true } = {}) {
    state.selected = i;
    if (i < 0) {
      $("#detail").hidden = true;
      neighbors = [];
      setHash("");
      resize(true);
      return;
    }
    const g = G[i];
    const near = nearest(i, 10);
    neighbors = near.slice(0, 6).map((x) => x[0]);
    const d = $("#detail");
    const wasHidden = d.hidden;
    d.hidden = false;
    $("#d-swatch").style.background = g.c;
    $("#d-name").textContent = g.n;
    $("#d-name").style.color = g.c;

    const tags = $("#d-tags"); tags.textContent = "";
    for (const f of g.f) tags.append(el("span", { class: "tag", title: "Lọc theo nhóm này", onclick: () => toggleFamily(f, true) }, f));
    if (g.co) tags.append(el("span", { class: "tag", title: "Lọc theo quốc gia này", onclick: () => setCountry(g.co) }, "📍 " + g.co));
    if (g.s) tags.append(el("span", { class: "tag", title: "Local scene" }, "🏙 " + titleCase(g.s)));

    $("#d-e").style.left = (g.e * 100).toFixed(1) + "%";
    $("#d-b").style.left = (g.b * 100).toFixed(1) + "%";

    const q = encodeURIComponent;
    $("#d-spotify").href = `https://open.spotify.com/search/${q("The Sound of " + g.n)}/playlists`;
    $("#d-youtube").href = `https://www.youtube.com/results?search_query=${q(g.n + " music")}`;
    $("#d-everynoise").href = `https://everynoise.com/engenremap-${g.n.replace(/[^a-z0-9]/gi, "").toLowerCase()}.html`;
    $("#d-wiki").href = `https://en.wikipedia.org/w/index.php?search=${q(g.n + " music genre")}`;
    $("#d-fav").setAttribute("aria-pressed", favs.has(g.n));

    const parents = g.p.map((p) => byName.get(p)).filter((x) => x != null);
    $("#d-parents-sec").hidden = !parents.length;
    const pb = $("#d-parents"); pb.textContent = ""; parents.forEach((p) => pb.append(chip(p)));

    const kids = (kidsOf.get(g.n) || []).slice().sort((a, b) => G[b].k - G[a].k || G[a].n.localeCompare(G[b].n));
    $("#d-kids-sec").hidden = !kids.length;
    $("#d-kids-count").textContent = kids.length ? `(${kids.length})` : "";
    const kb = $("#d-kids"); kb.textContent = "";
    kids.slice(0, 40).forEach((k) => kb.append(chip(k)));
    if (kids.length > 40) {
      kb.append(el("button", { class: "chip", onclick: () => { qInput.value = state.q = g.n; applyFilters(); } }, `+${kids.length - 40} nữa…`));
    }

    const nl = $("#d-near"); nl.textContent = "";
    for (const [j, dist] of near) {
      const h = G[j];
      nl.append(el("li", { onclick: () => select(j), onmouseenter: () => { state.hover = j; redraw(); }, onmouseleave: () => { state.hover = -1; redraw(); } },
        el("span", { class: "dot", style: `background:${h.c}` }), el("span", { class: "name" }, h.n), el("span", { class: "dist" }, Math.round(dist) + "")));
    }
    $(".detail-scroll").scrollTop = 0;

    document.querySelectorAll("#results li.active").forEach((li) => li.classList.remove("active"));
    const li = $(`#results li[data-i="${i}"]`); if (li) li.classList.add("active");

    setHash(g.n);
    if (wasHidden) resize(true);
    if (fly) focusGenre(i);
    redraw();
  }
  function toggleFamily(f, on) {
    on ? state.fams.add(f) : state.fams.delete(f);
    famBtns.get(f)?.setAttribute("aria-pressed", state.fams.has(f));
    applyFilters(); fit();
    toast(`Đang lọc: ${f}`);
  }
  function setCountry(c) { state.country = c; $("#country").value = c; applyFilters(); fit(); toast(`Đang lọc: ${c}`); }

  $("#d-close").onclick = () => select(-1);
  $("#d-fav").onclick = () => {
    const g = G[state.selected]; if (!g) return;
    favs.has(g.n) ? favs.delete(g.n) : favs.add(g.n);
    store.set("nm:favs", [...favs]);
    $("#d-fav").setAttribute("aria-pressed", favs.has(g.n));
    updateFavCount();
    toast(favs.has(g.n) ? "Đã thêm vào yêu thích ★" : "Đã bỏ khỏi yêu thích");
    if (state.fav) applyFilters();
  };
  $("#d-share").onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Đã sao chép liên kết"); }
    catch { toast(location.href); }
  };

  // ───────────────────────── URL hash ─────────────────────────
  let hashLock = false;
  function setHash(name) {
    hashLock = true;
    history.replaceState(null, "", name ? "#g=" + encodeURIComponent(name) : location.pathname + location.search);
    setTimeout(() => (hashLock = false));
  }
  function readHash() {
    const m = location.hash.match(/g=([^&]+)/);
    if (!m) return;
    const i = byName.get(decodeURIComponent(m[1]));
    if (i != null) select(i);
  }
  window.addEventListener("hashchange", () => { if (!hashLock) readHash(); });

  // ───────────────────────── misc UI ─────────────────────────
  function random() {
    const pool = filterActive ? resultList : G.map((g) => g.i);
    if (!pool.length) return;
    select(pool[Math.floor(Math.random() * pool.length)]);
  }
  $("#btn-random").onclick = random;
  $("#brand").onclick = (ev) => { ev.preventDefault(); resetAll(); select(-1); fit(); };
  $("#btn-about").onclick = () => $("#about").showModal();

  const root = document.documentElement;
  const savedTheme = store.get("nm:theme", null);
  if (savedTheme) root.dataset.theme = savedTheme;
  $("#btn-theme").onclick = () => {
    const dark = getComputedStyle(root).colorScheme.includes("dark");
    root.dataset.theme = dark ? "light" : "dark";
    store.set("nm:theme", root.dataset.theme);
    readColors();
  };
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", readColors);

  const panel = $("#panel"), scrim = $("#scrim");
  $("#btn-filters").onclick = () => { panel.classList.toggle("open"); scrim.hidden = !panel.classList.contains("open"); };
  scrim.onclick = closePanelMobile;
  function closePanelMobile() { panel.classList.remove("open"); scrim.hidden = true; }

  document.addEventListener("keydown", (ev) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== "checkbox" && document.activeElement.type !== "range";
    if (ev.key === "/" && !typing) { ev.preventDefault(); qInput.focus(); qInput.select(); return; }
    if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "Escape") { if (state.selected >= 0) select(-1); closePanelMobile(); }
    else if (ev.key === "r" || ev.key === "R") random();
    else if (ev.key === "f" || ev.key === "F") fit();
    else if (ev.key === "+" || ev.key === "=") zoomAt(1.5);
    else if (ev.key === "-" || ev.key === "_") zoomAt(1 / 1.5);
  });

  const mqSmall = matchMedia("(max-width: 860px)");
  const syncPlaceholder = () => { qInput.placeholder = mqSmall.matches ? "Tìm thể loại…" : "Tìm thể loại… (vd: shoegaze, vietnamese, black metal)"; };
  mqSmall.addEventListener?.("change", syncPlaceholder); syncPlaceholder();

  let rT;
  new ResizeObserver(() => { clearTimeout(rT); rT = setTimeout(() => resize(true), 50); }).observe($("#stage"));

  // ───────────────────────── boot ─────────────────────────
  load().then(() => {
    $("#loading").remove();
    buildFilters();
    readColors();
    resize(false);
    applyFilters();
    readHash();
    dirty = false;
    draw();
  }).catch((err) => {
    console.error(err);
    $("#loading").textContent = "Không tải được dữ liệu. Hãy chạy qua một web server (vd: python3 -m http.server).";
  });
})();
