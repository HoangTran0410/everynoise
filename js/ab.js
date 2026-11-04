// "Nghe so sánh A/B": pick two genres, the app alternates their demo previews (each side resumes where it left off)
// while the map flies between them; afterwards a short "where do they differ" card built from the genre data.
import { $, el, toast } from "./util.js";
import { model, trackOf, radioOf, nearest, famLabel, famEmoji } from "./data.js";
import { t, addStrings, fmtN } from "./i18n.js";

addStrings({
  "So sánh A/B": "A/B comparison",
  "Chọn hai thể loại, nghe xen kẽ 5 giây mỗi bên để thấy chúng khác nhau chỗ nào.": "Pick two genres and hear them alternate, 5 seconds each, to find out where they differ.",
  "👂 So với…": "👂 Compare with…",
  "Nghe so sánh A/B": "A/B listening",
  "Chọn thể loại…": "Pick a genre…",
  "Tìm thể loại…": "Search genres…",
  "Thể loại A": "Genre A",
  "Thể loại B": "Genre B",
  "🎲 Hàng xóm": "🎲 Neighbour",
  "🎲 Đối nghịch": "🎲 Opposite",
  "Mỗi bên": "Each side",
  "{n} giây": "{n} s",
  "▶ Nghe so sánh": "▶ Start comparing",
  "■ Dừng": "■ Stop",
  "Chọn đủ hai thể loại rồi bấm nghe: hai bài thử 30 giây sẽ thay phiên nhau.": "Pick two genres and press play: their 30-second previews take turns.",
  "Đang tải…": "Loading…",
  "Khác nhau ở đâu?": "Where do they differ?",
  "Không có bài thử cho thể loại này": "No preview for this genre",
  "Không phát được bài thử, thử lại sau.": "Could not play the previews, try again later.",
  "Thể loại này không có trong chế độ hiện tại": "This genre is not available in the current mode",
  "Mộc ↔ điện tử": "Organic ↔ electric",
  "Âm đặc ↔ nhún nhảy": "Dense ↔ bouncy",
  "Quốc gia": "Country",
  "Họ nhạc": "Family",
  "Khoảng cách trên bản đồ": "Map distance",
  "{a} thiên về điện tử hơn {b} {n} điểm": "{a} is {n} points more electric than {b}",
  "Gần như cùng mức mộc/điện tử": "Almost the same organic/electric level",
  "{a} nhún nhảy hơn {b} {n} điểm": "{a} is {n} points bouncier than {b}",
  "Gần như cùng độ đặc/nhún nhảy": "Almost the same dense/bouncy level",
  "cùng {c}": "both {c}",
  "{a} ({ca}) và {b} ({cb})": "{a} ({ca}) and {b} ({cb})",
  "chưa rõ": "unknown",
  "cùng họ {f}": "same family: {f}",
  "{a} ({fa}) và {b} ({fb})": "{a} ({fa}) and {b} ({fb})",
  "{n} bước": "{n} steps",
  "{n} bước (gần như sát nhau)": "{n} steps (practically next to each other)",
  "{n} bước (khá xa)": "{n} steps (fairly far)",
  "{n} bước (ở hai đầu bản đồ)": "{n} steps (opposite ends of the map)",
  "Bước = khoảng cách trung bình tới thể loại gần nhất trên bản đồ.": "A step = the typical distance to the nearest genre on the map.",
});

let api = null, dlg = null, ui = null;
let A = -1, B = -1, seg = 5, playing = false, side = 0, raf = 0, elapsed = 0, lastT = 0;
const songs = [null, null];   // the song each side plays: a random one from the genre's radio list (the demo track until it loads)
let wasPlaying = false;
const audios = [new Audio(), new Audio()];
const wrapped = [false, false], lastPos = [0, 0], played = [0, 0];
let solod = false;

const usable = (i) => i >= 0 && !!model.G[i] && api.isOk(model.G[i]) && !!trackOf(i);
const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const nm = (i) => (i >= 0 ? model.G[i].n : t("Chọn thể loại…"));

function build() {
  const mkSlot = (k, letter) => el("button", { class: "pick-btn ab-slot", id: "ab-" + k, "aria-haspopup": "dialog" },
    el("b", { class: "ab-letter" }, letter), el("span", { class: "dot" }), el("span", { class: "ab-name" }));
  const panel = (k, letter) => el("div", { class: "ab-panel", id: "ab-p" + k },
    el("b", { class: "ab-pl" }, letter), el("div", { class: "ab-pn" }), el("div", { class: "ab-ps" }));
  dlg = el("dialog", { class: "modal ab", id: "ab" },
    el("form", { method: "dialog" }, el("button", { class: "icon-btn close", "aria-label": t("Đóng"),
      html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>' })),
    el("h2", { id: "ab-title" }),
    el("div", { class: "ab-slots" }, mkSlot("a", "A"), mkSlot("b", "B")),
    el("div", { class: "ab-quick" },
      el("button", { class: "btn ghost sm", id: "ab-near" }), el("button", { class: "btn ghost sm", id: "ab-far" })),
    el("div", { class: "ab-seg", role: "group" }, el("span", { id: "ab-seg-l" }),
      ...[3, 5, 10].map((n) => el("button", { class: "btn ghost sm", "data-seg": n })) ),
    el("div", { class: "ab-stage", id: "ab-stage", hidden: true }, panel("a", "A"), panel("b", "B")),
    el("div", { class: "ab-bar", id: "ab-barw", hidden: true }, el("i", { id: "ab-bar" })),
    el("p", { class: "muted small", id: "ab-msg", "aria-live": "polite" }),
    el("div", { class: "path-actions" }, el("button", { class: "btn primary", id: "ab-play" })),
    el("section", { class: "ab-facts", id: "ab-facts", hidden: true }));
  document.body.append(dlg);
  ui = { a: $("#ab-a"), b: $("#ab-b"), pa: $("#ab-pa"), pb: $("#ab-pb"), msg: $("#ab-msg"), play: $("#ab-play"),
    bar: $("#ab-bar"), barw: $("#ab-barw"), stage: $("#ab-stage"), facts: $("#ab-facts") };
  ui.a.onclick = () => pickGenre(0);
  ui.b.onclick = () => pickGenre(1);
  $("#ab-near").onclick = neighbour;
  $("#ab-far").onclick = opposite;
  dlg.querySelectorAll("[data-seg]").forEach((b) => (b.onclick = () => { seg = +b.dataset.seg; labels(); }));
  ui.play.onclick = () => (playing ? stop() : start());
  dlg.addEventListener("close", onClose);
  // game audio and the main player never play at once (same contract as the quiz)
  for (const a of audios) { a.preload = "auto"; a.loop = true; api.player.solo(a); }
  addEventListener("langchange", () => { if (dlg.open) labels(); });
}

function labels() {
  $("#ab-title").textContent = "👂 " + t("Nghe so sánh A/B");
  for (const [k, i] of [["a", A], ["b", B]]) {
    const b = ui[k], g = i >= 0 ? model.G[i] : null;
    b.querySelector(".dot").style.background = g ? g.c : "transparent";
    b.querySelector(".ab-name").textContent = nm(i);
    b.classList.toggle("empty", !g);
    b.setAttribute("aria-label", t(k === "a" ? "Thể loại A" : "Thể loại B") + ": " + nm(i));
  }
  $("#ab-near").textContent = t("🎲 Hàng xóm");
  $("#ab-far").textContent = t("🎲 Đối nghịch");
  $("#ab-seg-l").textContent = t("Mỗi bên");
  dlg.querySelectorAll("[data-seg]").forEach((b) => { b.textContent = t("{n} giây", { n: b.dataset.seg }); b.setAttribute("aria-pressed", String(+b.dataset.seg === seg)); });
  ui.play.textContent = playing ? t("■ Dừng") : t("▶ Nghe so sánh");
  ui.play.disabled = !(usable(A) && usable(B) && A !== B);
  if (!playing) ui.msg.textContent = t("Chọn đủ hai thể loại rồi bấm nghe: hai bài thử 30 giây sẽ thay phiên nhau.");
  panels();
}

function panels() {
  for (const [k, i, el_] of [[0, A, ui.pa], [1, B, ui.pb]]) {
    const g = i >= 0 ? model.G[i] : null, tr = g ? songs[k] || trackOf(i) : null;
    el_.querySelector(".ab-pn").textContent = g ? g.n : "";
    el_.querySelector(".ab-ps").textContent = tr ? `${tr[2]} — ${tr[3]}` : "";
    el_.style.setProperty("--c", g ? g.c : "var(--line)");
    el_.classList.toggle("on", playing && side === k);
  }
}

function pickGenre(which) {
  api.openPicker({
    title: t(which === 0 ? "Thể loại A" : "Thể loại B"),
    search: true, placeholder: t("Tìm thể loại…"), value: String(which === 0 ? A : B),
    items: () => {
      const q = fold($("#pick-q").value.trim());
      const out = [];
      for (const i of model.staticOrder) {
        const g = model.G[i];
        if (!usable(i) || (q && !fold(g.n).includes(q))) continue;
        out.push({ label: g.n, value: String(i), color: g.c });
        if (out.length >= 300) break;
      }
      return out;
    },
    onPick: (v) => { set(which, +v); },
  });
}

function set(which, i) {
  if (playing) stop(true);
  if (which === 0) A = i; else B = i;
  ui.facts.hidden = true;
  songs[which] = null;
  if (i >= 0) radioOf(i).then((list) => { if ((which === 0 ? A : B) !== i || playing) return; songs[which] = pick(list.length ? list : [trackOf(i)]) || null; panels(); }).catch(() => {});
  labels();
}

function neighbour() {
  if (!usable(A)) { toast(t("Chọn thể loại…")); return; }
  const c = nearest(A, 8, (g) => usable(g.i)).map((x) => x[0]);
  if (c.length) set(1, pick(c));
}

function opposite() {
  if (!usable(A)) { toast(t("Chọn thể loại…")); return; }
  const a = model.G[A], fam = a.f[0];
  let pool = model.G.filter((g) => usable(g.i) && g.k >= 3 && !g.ap && g.f[0] !== fam);
  if (!pool.length) pool = model.G.filter((g) => usable(g.i) && g.i !== A);
  let best = -1, bd = -1;
  for (let k = 0; k < 40; k++) {
    const c = pick(pool), d = Math.hypot(c.x - a.x, c.y - a.y);
    if (d > bd) { bd = d; best = c.i; }
  }
  if (best >= 0) set(1, best);
}

// ── playback ───────────────────────────────────────────────────────────────
const PREVIEW = "https://p.scdn.co/mp3-preview/";
function loadSides() {
  [A, B].forEach((i, k) => {
    const a = audios[k];
    a.pause();
    api.player.gameSrc(a, PREVIEW + (songs[k] || trackOf(i))[0]);
    a.currentTime = 0; lastPos[k] = 0; wrapped[k] = false; played[k] = 0;
  });
}

function activate(k, fly = true) {
  side = k;
  audios[1 - k].pause();
  audios[k].play().catch((e) => { if (playing) ui.msg.textContent = t("Không phát được bài thử, thử lại sau."); console.warn(e); });
  elapsed = 0;
  panels();
  if (fly) api.map.focus(k ? B : A);
}

function start() {
  if (!(usable(A) && usable(B) && A !== B)) return;
  if (!solod) { wasPlaying = !!api.player.playing; solod = true; }
  api.player.pause();
  loadSides();
  playing = true;
  ui.facts.hidden = true;
  ui.stage.hidden = false; ui.barw.hidden = false;
  ui.msg.textContent = t("Đang tải…");
  ui.play.textContent = t("■ Dừng");
  activate(0);
  lastT = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

function tick(now) {
  if (!playing) return;
  const dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
  const a = audios[side];
  // count only time that is really audible: a stalled download does not eat the segment
  if (!a.paused && a.readyState >= 3) {
    elapsed += dt; played[side] += dt;
    ui.msg.textContent = "";
  }
  for (const k of [0, 1]) {
    const c = audios[k].currentTime;
    if (c + 1 < lastPos[k]) wrapped[k] = true;
    lastPos[k] = c;
  }
  ui.bar.style.width = Math.min(100, (elapsed / seg) * 100) + "%";
  if (wrapped[0] && wrapped[1]) { finish(); return; }
  if (elapsed >= seg) { ui.bar.style.width = "0%"; activate(1 - side); }
  raf = requestAnimationFrame(tick);
}

function stop(silent = false) {
  const was = playing;
  playing = false;
  cancelAnimationFrame(raf);
  audios.forEach((a) => a.pause());
  ui.barw.hidden = true; ui.bar.style.width = "0%";
  ui.stage.hidden = true;
  labels();
  if (was && !silent && usable(A) && usable(B) && (played[0] > 1 || played[1] > 1)) showFacts();
}
function finish() { stop(); }

function onClose() {
  if (playing) stop(true);
  audios.forEach((a) => { a.removeAttribute("src"); a.load(); });
  if (solod) { solod = false; if (wasPlaying && !api.player.playing) api.player.toggle(); }
}

// ── facts ──────────────────────────────────────────────────────────────────
/** typical distance between a genre and its nearest map neighbours (the map's "one step") */
function spacing(i) {
  const n = nearest(i, 5, (g) => usable(g.i));
  return n.length ? n.reduce((s, x) => s + x[1], 0) / n.length : 1;
}

export function facts(a, b) {
  const ga = model.G[a], gb = model.G[b];
  const out = [];
  const diff = (va, vb, hi, lo, same) => {
    const d = Math.round((va - vb) * 100);
    if (!Number.isFinite(d) || Math.abs(d) < 5) return t(same);
    return d > 0 ? t(hi, { a: ga.n, b: gb.n, n: Math.abs(d) }) : t(lo, { a: gb.n, b: ga.n, n: Math.abs(d) });
  };
  out.push([t("Mộc ↔ điện tử"), diff(ga.e, gb.e, "{a} thiên về điện tử hơn {b} {n} điểm", "{a} thiên về điện tử hơn {b} {n} điểm", "Gần như cùng mức mộc/điện tử")]);
  out.push([t("Âm đặc ↔ nhún nhảy"), diff(ga.b, gb.b, "{a} nhún nhảy hơn {b} {n} điểm", "{a} nhún nhảy hơn {b} {n} điểm", "Gần như cùng độ đặc/nhún nhảy")]);
  const ca = ga.co || "", cb = gb.co || "";
  out.push([t("Quốc gia"), ca && ca === cb ? t("cùng {c}", { c: ca }) : t("{a} ({ca}) và {b} ({cb})", { a: ga.n, ca: ca || t("chưa rõ"), b: gb.n, cb: cb || t("chưa rõ") })]);
  const fa = ga.f[0] ? famLabel(ga.f[0]) : "", fb = gb.f[0] ? famLabel(gb.f[0]) : "";
  const fe = (f0) => (f0 ? famEmoji(f0) + " " : "");
  out.push([t("Họ nhạc"), fa && fa === fb ? t("cùng họ {f}", { f: fe(ga.f[0]) + fa })
    : t("{a} ({fa}) và {b} ({fb})", { a: ga.n, fa: fa ? fe(ga.f[0]) + fa : t("chưa rõ"), b: gb.n, fb: fb ? fe(gb.f[0]) + fb : t("chưa rõ") })]);
  const sp = Math.max(1e-6, (spacing(a) + spacing(b)) / 2);
  const steps = Math.max(0, Math.round(Math.hypot(ga.x - gb.x, ga.y - gb.y) / sp));
  const key = steps <= 3 ? "{n} bước (gần như sát nhau)" : steps >= 60 ? "{n} bước (ở hai đầu bản đồ)" : steps >= 25 ? "{n} bước (khá xa)" : "{n} bước";
  out.push([t("Khoảng cách trên bản đồ"), t(key, { n: fmtN(steps) }) + ". " + t("Bước = khoảng cách trung bình tới thể loại gần nhất trên bản đồ.")]);
  return out;
}

function showFacts() {
  ui.facts.textContent = "";
  ui.facts.append(el("h3", {}, t("Khác nhau ở đâu?")));
  const dl = el("dl", { class: "ab-dl" });
  for (const [k, v] of facts(A, B)) dl.append(el("dt", {}, k), el("dd", {}, v));
  ui.facts.append(dl);
  ui.facts.hidden = false;
}

// ── entry ──────────────────────────────────────────────────────────────────
async function open(a = -1) {
  if (!dlg) build();
  if (!dlg.open) dlg.showModal();
  await model.tracksReady;   // usable() needs the tracks
  if (a >= 0 && usable(a)) { A = a; if (B === A) B = -1; ui.facts.hidden = true; }
  else if (a >= 0) toast(t("Thể loại này không có trong chế độ hiện tại"));
  if (!usable(A)) A = -1;
  if (!usable(B)) B = -1;
  labels();
}

export function initAB(opts) {
  api = opts;   // { openPicker, isOk, map, player, state }
  if (!document.querySelector("link[data-ab-css]")) {
    document.head.append(el("link", { rel: "stylesheet", href: "css/ab.css", "data-ab-css": "" }));
  }
  $("#ex-ab").onclick = () => { $("#games").close(); open(); };
  $("#d-ab").onclick = () => { const s = api.state.selected; open(s >= 0 ? s : -1); };
  window.__ab = { open, set, get state() { return { A, B, seg, playing, side, songs }; }, audios };
}
