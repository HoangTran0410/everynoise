// "Đoán quốc gia": hear a 30 s preview of a genre and tap the country it comes from on the world map.
// Shapes: data/world.json (shared with js/world.js, fetched once and cached by the browser). Own SVG, own pan/zoom.
// Score per round: exact country 3, a neighbour (centroid within NEAR map units, ~900-1200 km) 1.
import { $, el, toast, shuffle, store } from "./util.js";
import { model, trackOf, famEmoji } from "./data.js";
import { t, fmtN } from "./i18n.js";
import { label } from "./world.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
const ROUNDS = 10, NEAR = 32;
// countries a child can plausibly place; rounds draw from these about half of the time
const WELL = new Set("US GB FR DE JP KR BR MX IN ES IT CA AU RU CN EG NG ZA AR TR SE JM CU CO IE NL GR ID TH PH PT PL UA IL SA MA CL PE KE FI NO".split(" "));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/** Centre of the biggest sub-path of an "M x y l dx dy … z" path (islands/antimeridian pieces don't skew it). */
function centroid(d) {
  let best = null;
  for (const sub of d.split("M").slice(1)) {
    const v = sub.replace(/[lz]/g, " ").trim().split(/\s+/).map(Number);
    let x = v[0], y = v[1], x0 = x, x1 = x, y0 = y, y1 = y;
    for (let k = 2; k + 1 < v.length; k += 2) {
      x += v[k]; y += v[k + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const a = (x1 - x0) * (y1 - y0);
    if (!best || a > best.a) best = { a, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }
  return best ? [best.x, best.y] : [0, 0];
}

export function initGeoGuess({ player, isOk, kids, listen }) {
  const dlg = $("#geo"), box = $("#geo-map");
  const audio = new Audio();
  audio.preload = "auto";
  let data = null, loading = null, svg = null, gMap = null, gMark = null;
  const nodes = new Map(), isos = new Map(), cent = new Map();   // co -> node / ISO / [x, y]
  const view = { x: 0, y: 0, w: 1000, h: 400 };
  let full = view, ratio = 2.3, raf = 0;
  // game state
  let easy = store.get("nm:geoEasy", null);
  let pool = null, used = null, round = 0, score = 0, results = [], cur = null, answered = false, retries = 0;

  const load = () => loading || (loading = fetch("data/world.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error("world.json " + r.status)))).then((d) => (data = d)));
  const name = (co) => label(co, isos.get(co));

  function build() {
    const [vx, vy, vw, vh] = data.viewBox.split(" ").map(Number);
    full = { x: vx, y: vy, w: vw, h: vh };
    svg = svgEl("svg", { viewBox: data.viewBox, role: "group", "aria-label": t("🗺️ Đoán quốc gia") });
    gMap = svgEl("g", {});
    for (const c of data.countries) {
      const p = svgEl("path", { d: c.d, "data-co": c.name, class: "gc", role: "button", tabindex: "0" });
      gMap.append(p); nodes.set(c.name, p); isos.set(c.name, c.iso); cent.set(c.name, centroid(c.d));
    }
    for (const d of data.dots) {
      const g = svgEl("g", { "data-co": d.name, class: "gc gd", role: "button", tabindex: "0" });
      g.append(svgEl("circle", { cx: d.x, cy: d.y, r: 10 }));
      gMap.append(g); nodes.set(d.name, g); isos.set(d.name, d.iso); cent.set(d.name, [d.x, d.y]);
    }
    gMark = svgEl("g", { "pointer-events": "none" });
    svg.append(gMap, gMark);
    box.append(svg);
    labels();
    wire();
  }
  function labels() { for (const [co, n] of nodes) n.setAttribute("aria-label", name(co)); }

  // ── view: the viewBox follows the box's aspect ratio (taller on phones so countries are big enough to tap) ──
  function measure() { const r = box.getBoundingClientRect(); if (r.width && r.height) ratio = r.width / r.height; }
  function setView(w, cx, cy) {
    view.w = Math.min(full.w, Math.max(full.w / 12, w)); view.h = view.w / ratio;
    view.x = cx - view.w / 2; view.y = cy - view.h / 2; clampView(); flush();
  }
  function resetView() {
    measure();
    const phone = ratio < 1.8;
    setView(phone ? full.w * 0.55 : full.w, full.x + full.w / 2, full.y + full.h / 2);
  }
  function flush() { svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`); }
  function apply() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; flush(); });
  }
  function clampView() {
    view.x = view.w >= full.w ? full.x + (full.w - view.w) / 2 : Math.min(full.x + full.w - view.w, Math.max(full.x, view.x));
    view.y = view.h >= full.h ? full.y + (full.h - view.h) / 2 : Math.min(full.y + full.h - view.h, Math.max(full.y, view.y));
  }
  function zoomAt(fx, fy, f) {
    const w = Math.min(full.w, Math.max(full.w / 12, view.w * f)), h = w / ratio;
    view.x = view.x + fx * view.w - fx * w; view.y = view.y + fy * view.h - fy * h; view.w = w; view.h = h;
    clampView(); apply();
  }
  function wire() {
    const ptrs = new Map(); let rect = null, moved = false, startX = 0, startY = 0, pd = 0;
    svg.style.touchAction = "none";
    svg.addEventListener("pointerdown", (ev) => {
      rect = svg.getBoundingClientRect(); ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (ptrs.size === 1) { moved = false; startX = ev.clientX; startY = ev.clientY; }
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pd = Math.hypot(a[0] - b[0], a[1] - b[1]); moved = true; }
    });
    svg.addEventListener("pointermove", (ev) => {
      const prev = ptrs.get(ev.pointerId); if (!prev) return;
      if (ptrs.size === 1) {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 7) return;
        if (!moved) { moved = true; try { svg.setPointerCapture(ev.pointerId); } catch {} }
        view.x -= (ev.clientX - prev[0]) / rect.width * view.w; view.y -= (ev.clientY - prev[1]) / rect.height * view.h;
        clampView(); apply();
      } else if (ptrs.size === 2) {
        ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pd && d) zoomAt(((a[0] + b[0]) / 2 - rect.left) / rect.width, ((a[1] + b[1]) / 2 - rect.top) / rect.height, pd / d);
        pd = d;
      }
      ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    });
    const up = (ev) => { ptrs.delete(ev.pointerId); pd = 0; if (!ptrs.size) setTimeout(() => (moved = false), 0); };
    svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
    svg.addEventListener("wheel", (ev) => {
      ev.preventDefault(); const r = svg.getBoundingClientRect();
      zoomAt((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, Math.exp(ev.deltaY * 0.0015));
    }, { passive: false });
    svg.addEventListener("click", (ev) => { if (moved) return; const n = ev.target.closest("[data-co]"); if (n) guess(n.dataset.co); });
    svg.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { const n = ev.target.closest("[data-co]"); if (n) { ev.preventDefault(); guess(n.dataset.co); } } });
  }
  $("#geo-in").onclick = () => svg && zoomAt(0.5, 0.5, 0.6);
  $("#geo-out").onclick = () => svg && zoomAt(0.5, 0.5, 1 / 0.6);
  $("#geo-reset").onclick = () => svg && resetView();

  // ── rounds ──
  function buildPool() {
    const m = new Map();
    for (const g of model.G) if (g.co && nodes.has(g.co) && isOk(g) && trackOf(g.i)) { if (!m.has(g.co)) m.set(g.co, []); m.get(g.co).push(g.i); }
    pool = m;
  }
  function pickCountry() {
    const all = [...pool.keys()].filter((co) => !used.has(co));
    const well = all.filter((co) => WELL.has(isos.get(co)) && pool.get(co).length >= 2);
    const mid = all.filter((co) => pool.get(co).length >= 3);
    const r = Math.random();
    const from = r < 0.5 && well.length ? well : r < 0.9 && mid.length ? mid : all;
    return pick(from.length ? from : [...pool.keys()]);
  }
  function dist(a, b) { const p = cent.get(a), q = cent.get(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); }

  function newGame() {
    round = 0; score = 0; results = []; used = new Set(); retries = 0;
    dlg.dataset.state = "play";
    nextRound();
  }
  function nextRound() {
    if (round >= ROUNDS) return finish();
    const co = pickCountry();
    const gi = pick(pool.get(co));
    used.add(co);
    cur = { co, gi, tr: trackOf(gi), picked: null, pts: 0 };
    answered = false; retries = 0;
    if (!audio.paused) audio.pause();
    $("#geo-feedback").hidden = true; $("#geo-next").hidden = true; $("#geo-skip").hidden = false;
    $("#geo-progress").style.width = "0%";
    gMark.textContent = "";
    for (const n of nodes.values()) n.classList.remove("ok", "bad");
    resetView();
    options();
    stats();
    audio.src = "https://p.scdn.co/mp3-preview/" + cur.tr[0];
    audio.onerror = () => {   // dead preview: swap the song, not the country
      if (answered || retries++ > 6) return;
      const alt = pick(pool.get(co)); cur.gi = alt; cur.tr = trackOf(alt);
      audio.src = "https://p.scdn.co/mp3-preview/" + cur.tr[0]; audio.play().catch(() => {});
    };
    audio.play().catch(() => (dlg.dataset.playing = "false"));
  }
  function options() {
    const o = $("#geo-opts"); o.textContent = "";
    o.hidden = !easy;
    if (!easy) return;
    const others = shuffle([...pool.keys()].filter((c) => c !== cur.co && dist(c, cur.co) > NEAR * 1.6));
    const fam = others.filter((c) => WELL.has(isos.get(c)));
    const opts = [cur.co, ...[...fam, ...others].filter((c, i, a) => a.indexOf(c) === i).slice(0, 3)];
    for (const co of shuffle(opts)) o.append(el("button", { class: "quiz-opt geo-opt", "data-co": co, onclick: () => guess(co) }, name(co)));
  }
  function stats() {
    $("#geo-round").textContent = t("Vòng {a}/{b}", { a: Math.min(round + (answered ? 0 : 1), ROUNDS), b: ROUNDS });
    $("#geo-score").textContent = fmtN(score);
  }

  function guess(co) {
    if (answered || !cur) return;
    answered = true;
    const d = co ? dist(co, cur.co) : Infinity;
    cur.picked = co;
    cur.pts = co === cur.co ? 3 : d < NEAR ? 1 : 0;
    score += cur.pts; results.push(cur.pts); round++;
    reveal(co);
  }
  function reveal(co) {
    audio.onerror = null;
    stats();
    $("#geo-skip").hidden = true;
    const right = nodes.get(cur.co);
    right.classList.add("ok"); gMap.append(right);
    if (co && co !== cur.co) { const w = nodes.get(co); w.classList.add("bad"); gMap.insertBefore(w, right); }
    gMark.textContent = "";
    const [cx, cy] = cent.get(cur.co);
    if (co && co !== cur.co) {
      const [px, py] = cent.get(co);
      gMark.append(svgEl("line", { x1: px, y1: py, x2: cx, y2: cy, class: "geo-line" }));
    }
    gMark.append(svgEl("circle", { cx, cy, r: 8, class: "geo-pin" }));
    if (view.w < full.w) setView(view.w, cx, cy);
    for (const b of $("#geo-opts").children) {
      b.disabled = true;
      if (b.dataset.co === cur.co) b.dataset.result = "right"; else if (b.dataset.co === co) b.dataset.result = "wrong";
    }
    const g = model.G[cur.gi], tr = cur.tr, cn = name(cur.co);
    const verdict = !co ? t("⏭️ Bỏ qua — đây là {c}", { c: cn })
      : cur.pts === 3 ? t(pick(["🎉 Chính xác! {c}", "🌟 Giỏi quá! {c}", "👏 Đúng rồi! {c}"]), { c: cn })
      : cur.pts === 1 ? t("👍 Gần rồi! Đây là {c}, bạn chọn {p}", { c: cn, p: name(co) })
      : t("😅 Chưa đúng — đây là {c}", { c: cn });
    const fb = $("#geo-feedback");
    fb.hidden = false; fb.textContent = "";
    fb.append(
      el("div", { class: "quiz-verdict" }, verdict),
      el("div", { class: "geo-pts" }, cur.pts ? `+${cur.pts}` : "+0"),
      el("div", { class: "quiz-credit" }, el("span", { class: "dot", style: `background:${g.c}` }), " ", el("b", {}, g.n), " ", g.f[0] ? famEmoji(g.f[0]) : "🎵"),
      el("div", { class: "quiz-credit" }, "🎵 ", el("b", {}, tr[3]), " — ", tr[2]),
      el("button", { class: "btn ghost sm", onclick: () => { dlg.close(); listen(cur.gi); } }, t("▶ Nghe tiếp thể loại này")));
    const nx = $("#geo-next");
    nx.textContent = round >= ROUNDS ? t("Xem kết quả 🏆") : t("Vòng tiếp theo →");
    nx.hidden = false;
    nx.focus({ preventScroll: true });
    nx.scrollIntoView?.({ block: "nearest" });
  }

  function finish() {
    audio.pause();
    dlg.dataset.state = "final";
    const max = ROUNDS * 3, pct = score / max, stars = pct >= 0.7 ? 3 : pct >= 0.4 ? 2 : score > 0 ? 1 : 0;
    const best = Math.max(store.get("nm:geoBest", 0), score);
    store.set("nm:geoBest", best);
    const f = $("#geo-final"); f.textContent = "";
    f.append(
      el("div", { class: "geo-stars", "aria-label": t("{n} sao", { n: stars }) }, "★".repeat(stars) + "☆".repeat(3 - stars)),
      el("div", { class: "geo-big" }, `${score}/${max}`),
      el("p", { class: "muted" }, t(["Hãy thử lại nhé! 🌱", "Khá lắm! 👍", "Giỏi lắm! 🌟", "Bậc thầy bản đồ! 🏆"][stars])),
      el("p", { class: "muted small" }, t("Kỷ lục: {n}", { n: best })),
      el("div", { class: "geo-dots" }, ...results.map((p) => el("i", { "data-p": p }, p ? String(p) : "·"))),
      el("div", { class: "geo-actions" },
        el("button", { class: "btn primary", onclick: newGame }, t("🔄 Chơi lại")),
        el("button", { class: "btn ghost", onclick: () => dlg.close() }, t("Đóng"))));
    f.querySelector(".btn.primary").focus();
  }

  function modeUI() {
    for (const b of dlg.querySelectorAll("[data-mode]")) b.setAttribute("aria-pressed", String((b.dataset.mode === "easy") === easy));
    $("#geo-hint").textContent = easy ? t("Chọn một nước, hoặc bấm thẳng lên bản đồ.") : t("Bấm một quốc gia trên bản đồ. Kéo hoặc véo hai ngón để phóng to.");
  }
  for (const b of dlg.querySelectorAll("[data-mode]")) b.onclick = () => {
    easy = b.dataset.mode === "easy"; store.set("nm:geoEasy", easy); modeUI();
    if (!answered && cur) options();
  };
  $("#geo-skip").onclick = () => guess(null);
  $("#geo-next").onclick = nextRound;
  $("#geo-play").onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
  audio.addEventListener("play", () => (dlg.dataset.playing = "true"));
  audio.addEventListener("pause", () => (dlg.dataset.playing = "false"));
  audio.addEventListener("ended", () => (dlg.dataset.playing = "false"));
  audio.addEventListener("timeupdate", () => { $("#geo-progress").style.width = (audio.currentTime / (audio.duration || 30)) * 100 + "%"; });
  dlg.addEventListener("close", () => audio.pause());
  addEventListener("resize", () => { if (dlg.open && svg) { const p = ratio; measure(); if (p !== ratio) { setView(view.w, view.x + view.w / 2, view.y + view.h / 2); } } });

  async function open() {
    player.pause();
    if (easy === null) easy = !!kids();
    dlg.dataset.state = "play"; dlg.dataset.playing = "false";
    dlg.showModal();
    modeUI();
    try { await Promise.all([load(), model.tracksReady]); } catch (err) { console.error(err); toast(t("Không tải được bản đồ 😢")); dlg.close(); return; }
    if (!svg) build();
    buildPool();
    if (!pool.size) { toast(t("Không đủ thể loại để chơi với bộ lọc hiện tại")); dlg.close(); return; }
    newGame();
  }
  $("#ex-geo").onclick = () => { $("#games").close(); open(); };
  addEventListener("langchange", () => {
    if (!svg) return;
    svg.setAttribute("aria-label", t("🗺️ Đoán quốc gia")); labels();
    if (!dlg.open) return;
    modeUI(); stats();
    if (dlg.dataset.state === "final") finish();
    else if (cur) { options(); if (answered) reveal(cur.picked); }
  });
  return { open, peek: () => cur && cur.co };
}
