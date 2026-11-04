// "Nghe đoán mỗi ngày": a Heardle-style daily game. One genre per calendar day (same for everybody), heard in
// snippets of 1, 2, 4, 7, 11 and 16 seconds; guess its name in 6 tries, share the result like Wordle.
import { $, el, store, toast, hash32 } from "./util.js";
import { model, trackOf, nearest, famLabel, famEmoji } from "./data.js";
import { t, addStrings } from "./i18n.js";

addStrings({
  "🎧 Nghe đoán mỗi ngày": "🎧 Daily listen",
  "Nghe đoán mỗi ngày": "Daily listen",
  "Mỗi ngày một bài. Nghe 1 giây, đoán thể loại; sai thì được nghe dài hơn. Tối đa 6 lần.": "One song a day. Hear 1 second, guess the genre; each miss unlocks a longer snippet. Up to 6 tries.",
  "Nghe lại": "Replay",
  "Thể loại nào đây? Chọn 1 trong {n}:": "Which genre is it? Pick 1 of {n}:",
  "Bỏ qua (+{n}s)": "Skip (+{n}s)",
  "Bỏ qua": "Skipped",
  "Lần {n}": "Try {n}",
  "🔥 Rất gần": "🔥 Very close",
  "🌡️ Gần": "🌡️ Close",
  "❄️ Xa": "❄️ Far",
  "họ {f}": "family {f}",
  "Chọn một thể loại trong danh sách": "Pick a genre from the list",
  "Bạn đã đoán thể loại này rồi": "You already guessed this genre",
  "🎉 Đúng rồi! Bạn đoán trúng ở lần {n}/6": "🎉 Correct! You got it on try {n}/6",
  "😅 Hết lượt. Thể loại hôm nay là": "😅 Out of tries. Today's genre is",
  "Nghe cả bài": "Hear the whole song",
  "📋 Chia sẻ": "📋 Share",
  "📊 Thống kê": "📊 Stats",
  "Đã sao chép kết quả": "Result copied",
  "Bài mới sau {t}": "New song in {t}",
  "Đã chơi": "Played",
  "% thắng": "Win %",
  "Chuỗi": "Streak",
  "Chuỗi dài nhất": "Max streak",
  "Phân bố lượt đoán": "Guess distribution",
  "Không tải được bài hôm nay": "Could not load today's song",
  "Hôm nay chưa có bài": "No song for today",
});

const LENS = [1, 2, 4, 7, 11, 16];
const EPOCH = Date.UTC(2026, 0, 1);
const KEY = "nm:heardle", SKEY = "nm:heardleStats";
const URL_SHARE = "https://everynoise.pages.dev/";
const pad = (n) => String(n).padStart(2, "0");

const today = () => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }; };
const dayKey = (o) => `${o.y}-${pad(o.m + 1)}-${pad(o.d)}`;
const dayNo = (o) => Math.round((Date.UTC(o.y, o.m, o.d) - EPOCH) / 864e5);

/** The genre of a day: pool = genres with a demo song and more artists than the median (guessable). Pure function of the date. */
export function dailyGenre(day, isOk = () => true) {
  const base = model.G.filter((g) => trackOf(g.i) && !g.ap);
  const ks = base.map((g) => g.k).sort((a, b) => a - b);
  const med = ks[ks.length >> 1] || 0;
  const pool = base.filter((g) => g.k > med && isOk(g));
  if (!pool.length) return null;
  return pool[hash32("everynoise-heardle-" + dayKey(day)) % pool.length];
}

const N_OPTS = 8;
/** The day's answer options: the answer, its 3 nearest big genres (hard to tell apart) and 4 from other families, in a fixed order. */
export function dailyOptions(day, ans, isOk = () => true) {
  const big = (g) => g.k >= 1 && trackOf(g.i) && !g.ap && isOk(g);
  const seed = hash32("everynoise-heardle-opts-" + dayKey(day));
  let r = seed || 1;
  const rnd = () => { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296; };
  const out = [ans, ...nearest(ans.i, 3, big).map(([i]) => model.G[i])];
  const far = model.G.filter((g) => big(g) && !out.includes(g) && g.f[0] !== ans.f[0]);
  while (out.length < N_OPTS && far.length) out.push(far.splice(Math.floor(rnd() * far.length), 1)[0]);
  for (let k = out.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [out[k], out[j]] = [out[j], out[k]]; }
  return out;
}

export class Heardle {
  constructor({ player, isOk, onShow }) {
    this.player = player; this.isOk = isOk; this.onShow = onShow;
    this.audio = new Audio();
    this.audio.preload = "auto";
    player.solo(this.audio);
    this.limit = LENS[0];
    this._build();
    this.audio.addEventListener("pause", () => (this.dlg.dataset.playing = "false"));
    this.audio.addEventListener("play", () => (this.dlg.dataset.playing = "true"));
    this.audio.addEventListener("ended", () => (this.dlg.dataset.playing = "false"));
    this.dlg.addEventListener("close", () => { this.audio.pause(); clearInterval(this._cd); });
    addEventListener("langchange", () => { this._card(); this._labels(); this._render(); });
    this._labels();
  }

  _labels() { this.play.setAttribute("aria-label", t("Nghe lại")); this.dlg.querySelector(".close").setAttribute("aria-label", t("Đóng")); }

  _card() {
    let c = $("#ex-heardle");
    if (!c) {
      c = el("button", { class: "game-card", id: "ex-heardle" });
      $("#games .game-grid").prepend(c);
      c.onclick = () => { $("#games").close(); this.open(); };
    }
    c.textContent = "";
    c.append(el("span", { class: "g-emoji" }, "🎧"), el("span", {}, el("b", {}, t("Nghe đoán mỗi ngày")),
      el("small", {}, t("Mỗi ngày một bài. Nghe 1 giây, đoán thể loại; sai thì được nghe dài hơn. Tối đa 6 lần."))));
  }

  _build() {
    if (!$("#heardle-css")) document.head.append(el("link", { rel: "stylesheet", href: "css/heardle.css", id: "heardle-css" }));
    this._card();
    this.dlg = el("dialog", { class: "modal hd", id: "heardle", "data-playing": "false" });
    this.dlg.innerHTML = `<form method="dialog"><button class="icon-btn close" aria-label="Đóng"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button></form>`;
    this.title = el("h2", {});
    this.play = el("button", { class: "quiz-play hd-play", "aria-label": "Nghe lại" },
      ...[["i-play", "M8 5v14l11-7z"], ["i-pause", "M8 5v14M16 5v14"]].map(([c, d]) => {
        const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", c);
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); s.append(p); return s;
      }));
    this.fill = el("i", { class: "hd-fill" }); this.cur = el("i", { class: "hd-cur" });
    this.bar = el("div", { class: "hd-bar" }, this.fill, this.cur,
      ...LENS.slice(0, -1).map((s) => el("u", { style: `left:${(s / 16) * 100}%` })));
    this.tries = el("ol", { class: "hd-tries" });
    this.ask = el("p", { class: "hd-ask" });
    this.opts = el("div", { class: "hd-opts" });
    this.skip = el("button", { class: "btn ghost sm" });
    this.row = el("div", { class: "hd-row" }, this.skip);
    this.entry = el("div", { class: "hd-entry" }, this.ask, this.opts, this.row);
    this.result = el("div", { class: "hd-result" });
    this.stats = el("div", { class: "hd-stats" });
    this.statsBtn = el("button", { class: "btn ghost sm hd-statsbtn" });
    this.dlg.append(this.title, this.play, this.bar, this.tries, this.entry, this.result, this.statsBtn, this.stats);
    document.body.append(this.dlg);

    this.play.onclick = () => (this.audio.paused ? this._snippet() : this.audio.pause());
    this.skip.onclick = () => this._submit(null);
    this.statsBtn.onclick = () => { this.stats.hidden = !this.stats.hidden; };
  }

  // ── state ──
  _load() {
    this.day = today();
    const key = dayKey(this.day);
    let s = store.get(KEY, null);
    if (!s || s.day !== key) {
      const g = dailyGenre(this.day, this.isOk);
      s = { day: key, ans: g ? g.n : null, att: [], done: false, win: false };
      store.set(KEY, s);
    }
    this.s = s;
    this.ans = s.ans != null ? model.G[model.byName.get(s.ans)] || null : null;
    this._opts = null;   // options are a function of the day: rebuilt on the next render
  }
  _stats() { return Object.assign({ played: 0, wins: 0, streak: 0, max: 0, dist: [0, 0, 0, 0, 0, 0], last: null, lastWin: null }, store.get(SKEY, {})); }

  async open() {
    this.player.pause();
    this.dlg.showModal();
    await model.tracksReady;
    this._load();
    if (!this.ans || !trackOf(this.ans.i)) { toast(t("Hôm nay chưa có bài")); }
    else {
      this.player.gameSrc(this.audio, "https://p.scdn.co/mp3-preview/" + trackOf(this.ans.i)[0]);
      this.audio.onerror = () => toast(t("Không tải được bài hôm nay"));
    }
    this._render();
    this.stats.hidden = !this.s.done;
    clearInterval(this._cd);
    this._cd = setInterval(() => this._countdown(), 20000);
  }

  _limit() { return this.s.done ? 30 : LENS[Math.min(this.s.att.length, 5)]; }

  _render() {
    if (!this.s) return;
    const s = this.s, n = s.att.length, lim = this._limit();
    this.title.textContent = `🎧 ${t("Nghe đoán mỗi ngày")} #${dayNo(this.day)}`;
    this.play.setAttribute("aria-label", t("Nghe lại"));
    this.fill.style.width = (Math.min(lim, 16) / 16) * 100 + "%";
    this.tries.textContent = "";
    for (let k = 0; k < 6; k++) {
      const a = s.att[k];
      const li = el("li", { class: "hd-try" });
      if (!a) { li.dataset.state = k === n && !s.done ? "now" : "empty"; li.append(el("span", { class: "hd-n" }, `${LENS[k]}s`), el("span", { class: "muted" }, k === n && !s.done ? t("Lần {n}", { n: k + 1 }) : "")); }
      else if (a.g == null) { li.dataset.state = "skip"; li.append(el("span", { class: "hd-n" }, `${LENS[k]}s`), el("span", { class: "muted" }, "⏭ " + t("Bỏ qua"))); }
      else {
        const g = model.G[model.byName.get(a.g)];
        li.dataset.state = a.ok ? "win" : a.h === "hot" ? "close" : "wrong";
        li.append(el("span", { class: "hd-n" }, `${LENS[k]}s`), el("span", { class: "hd-g" }, a.g));
        if (!a.ok) li.append(el("small", { class: "hd-hint" }, t(HINT[a.h]) + (g ? " · " + famEmoji(g.f[0]) + " " + t("họ {f}", { f: famLabel(g.f[0]) }) : "")));
        else li.append(el("small", { class: "hd-hint" }, "🟩"));
      }
      this.tries.append(li);
    }
    this.entry.hidden = s.done;
    this.skip.textContent = t("Bỏ qua (+{n}s)", { n: (LENS[Math.min(n + 1, 5)] - LENS[Math.min(n, 5)]) || 0 });
    this.skip.hidden = n >= 5;
    this.ask.textContent = t("Thể loại nào đây? Chọn 1 trong {n}:", { n: N_OPTS });
    this._optsUI();
    this.statsBtn.textContent = t("📊 Thống kê");
    this.statsBtn.hidden = !!s.done;
    this._result();
    this._statsUI();
    this._countdown();
  }

  _result() {
    const s = this.s; this.result.textContent = ""; this.result.hidden = !s.done;
    if (!s.done || !this.ans) return;
    const tr = trackOf(this.ans.i);
    this.result.append(
      el("div", { class: "quiz-verdict" }, s.win ? t("🎉 Đúng rồi! Bạn đoán trúng ở lần {n}/6", { n: s.att.length }) : t("😅 Hết lượt. Thể loại hôm nay là")),
      el("div", { class: "hd-ans", style: `--c:${this.ans.c}` }, this.ans.n),
      el("div", { class: "quiz-credit" }, "🎵 ", el("b", {}, tr[2]), " — ", tr[3]),
      el("div", { class: "hd-row" },
        el("button", { class: "btn primary sm", onclick: () => { this.audio.pause(); this.dlg.close(); this.onShow(this.ans.i, 0); } }, "▶ " + t("Nghe cả bài")),
        el("button", { class: "btn ghost sm", onclick: () => this._share() }, t("📋 Chia sẻ"))),
      el("p", { class: "muted hd-cd" }));
  }

  _statsUI() {
    const st = this._stats();
    this.stats.textContent = "";
    const box = (v, l) => el("div", {}, el("b", {}, String(v)), el("small", {}, t(l)));
    const mx = Math.max(1, ...st.dist);
    this.stats.append(
      el("div", { class: "hd-nums" }, box(st.played, "Đã chơi"), box(st.played ? Math.round((st.wins / st.played) * 100) : 0, "% thắng"), box(st.streak, "Chuỗi"), box(st.max, "Chuỗi dài nhất")),
      el("h3", {}, t("Phân bố lượt đoán")),
      ...st.dist.map((c, k) => el("div", { class: "hd-dist" + (this.s.done && this.s.win && this.s.att.length === k + 1 ? " me" : "") },
        el("span", {}, String(k + 1)), el("div", {}, el("i", { style: `width:${Math.max(c ? 8 : 0, (c / mx) * 100)}%` }, String(c))))));
  }

  _countdown() {
    const cd = this.result.querySelector(".hd-cd");
    if (!cd) return;
    const n = new Date(), nx = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    const m = Math.max(0, Math.ceil((nx - n) / 60000));
    cd.textContent = t("Bài mới sau {t}", { t: `${pad(Math.floor(m / 60))}:${pad(m % 60)}` });
  }

  // ── audio: play from 0 to the unlocked length, stopped by a frame loop (timeupdate is too coarse for 1 s) ──
  _snippet() {
    if (!this.ans) return;
    const a = this.audio, lim = this._limit();
    cancelAnimationFrame(this._raf);
    a.currentTime = 0;
    a.play().then(() => {
      const tick = () => {
        const full = this.s.done;
        this.cur.style.width = Math.min(a.currentTime, 16) / 16 * 100 + "%";
        if (a.paused || a.ended) return;
        if (!full && a.currentTime >= lim) { a.pause(); return; }
        this._raf = requestAnimationFrame(tick);
      };
      tick();
    }).catch(() => (this.dlg.dataset.playing = "false"));
  }

  // ── guessing: one tap on one of the day's options; a wrong one stays greyed out with its hint ──
  _optsUI() {
    this.opts.textContent = "";
    if (!this.ans) return;
    this._opts ||= dailyOptions(this.day, this.ans, this.isOk);
    for (const g of this._opts) {
      const a = this.s.att.find((x) => x.g === g.n);
      const b = el("button", { class: "hd-opt", type: "button", disabled: a ? "" : null, style: `--c:${g.c}` }, el("i", { class: "dot" }), el("span", {}, g.n));
      if (a && !a.ok) { b.dataset.hint = a.h; b.append(el("small", {}, t(HINT[a.h]).slice(0, 2))); }
      b.onclick = () => this._submit(g.n);
      this.opts.append(b);
    }
  }

  _dist(g, a) { return Math.hypot(g.e - a.e, g.b - a.b); }

  _submit(name) {
    const s = this.s;
    if (!s || s.done || !this.ans) return;
    let rec;
    if (name == null) rec = { g: null };
    else {
      const g = model.G[model.byName.get(name)];
      if (!g) { toast(t("Chọn một thể loại trong danh sách")); return; }
      if (s.att.some((x) => x.g === name)) { toast(t("Bạn đã đoán thể loại này rồi")); return; }
      const ok = g.i === this.ans.i;
      const d = this._dist(g, this.ans);
      rec = { g: name, ok, h: ok ? null : d < 0.07 ? "hot" : d < 0.2 ? "warm" : "cold" };
    }
    s.att.push(rec);
    if (rec.ok) { s.done = true; s.win = true; }
    else if (s.att.length >= 6) { s.done = true; s.win = false; }
    store.set(KEY, s);
    if (s.done) this._finish();
    this.audio.pause();
    this._render();
    this.stats.hidden = !s.done;
    if (!s.done) this._snippet();
  }

  _finish() {
    const st = this._stats(), s = this.s, no = dayNo(this.day);
    st.played++;
    if (s.win) {
      st.wins++; st.dist[s.att.length - 1]++;
      st.streak = st.lastWin === no - 1 ? st.streak + 1 : 1;
      st.lastWin = no;
      st.max = Math.max(st.max, st.streak);
    } else st.streak = 0;
    st.last = no;
    store.set(SKEY, st);
  }

  shareText() {
    const s = this.s;
    const sq = s.att.map((a) => (a.ok ? "🟩" : a.h === "hot" ? "🟨" : "🟥"));
    while (sq.length < 6) sq.push("⬜");
    return `Everynoise 🎧 #${dayNo(this.day)} ${s.win ? s.att.length : "X"}/6\n${sq.join("")}\n${URL_SHARE}`;
  }
  async _share() {
    const text = this.shareText();
    if (matchMedia("(pointer: coarse)").matches && navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = el("textarea", {}); ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand("copy"); } catch {} ta.remove();
    }
    toast(t("Đã sao chép kết quả"));
  }
}
const HINT = { hot: "🔥 Rất gần", warm: "🌡️ Gần", cold: "❄️ Xa" };
