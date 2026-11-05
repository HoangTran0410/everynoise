// "Đoán thể loại": play a 30s preview, pick the right genre among four.
import { factCard } from "./explain.js";
import { $, el, toast, shuffle, store } from "./util.js";
import { model, nearest, trackOf, tracksOf, radioOf } from "./data.js";
import { coverEl } from "./covers.js";
import { t } from "./i18n.js";
import { initVizBtn } from "./vizbtn.js";
import { likeBtn, songRec } from "./likes.js";

export class Quiz {
  constructor({ player, isOk, onShow }) {
    this.player = player;          // main player, paused while the quiz runs
    this.isOk = isOk;              // genre filter (kids mode)
    this.onShow = onShow;          // (i, n) => show genre on the map and play its song #n
    this.audio = new Audio();
    this.audio.preload = "auto";
    player.solo(this.audio);
    this.level = store.get("nm:quizLevel", "easy");
    this.score = 0; this.total = 0; this.streak = 0;
    this.best = store.get("nm:quizBest", 0);
    this.dlg = $("#quiz");
    this.audio.addEventListener("play", () => (this.dlg.dataset.playing = "true"));
    this.audio.addEventListener("pause", () => (this.dlg.dataset.playing = "false"));
    this.audio.addEventListener("ended", () => (this.dlg.dataset.playing = "false"));
    this.audio.addEventListener("timeupdate", () => {
      const d = this.audio.duration || 30;
      $("#quiz-progress").style.width = (this.audio.currentTime / d) * 100 + "%";
    });
    this.dlg.addEventListener("close", () => this.audio.pause());
    this.vb = initVizBtn($("#quiz-play"), { player, dlg: this.dlg, audio: this.audio });
    $("#quiz-play").onclick = () => (this.audio.paused ? this.audio.play().catch(() => {}) : this.audio.pause());
    $("#quiz-next").onclick = () => this.question();
    $("#quiz-back").onclick = () => this.resume();
    // stuck on a song? hear another one of the same (answer) genre — the options stay the same
    $("#quiz-another").onclick = () => this._another();
    this.dlg.querySelectorAll("[data-level]").forEach((b) => {
      b.onclick = () => { this.level = b.dataset.level; store.set("nm:quizLevel", this.level); this._levelUI(); this.question(); };
    });
  }

  /** Back from "show on the map": the same question and answer, score and streak kept. */
  resume() {
    $("#quiz-back").hidden = true;
    this.player.pause();
    this.dlg.showModal();
    this._scoreUI();
  }

  async open() {
    $("#quiz-back").hidden = true;
    this.player.pause();
    this.dlg.showModal();
    this._levelUI();
    this._scoreUI();
    this.vb.start();
    await model.tracksReady;
    this.question();
  }

  _levelUI() {
    this.dlg.querySelectorAll("[data-level]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.level === this.level));
  }
  _scoreUI() {
    $("#quiz-score").textContent = `${this.score}/${this.total}`;
    $("#quiz-streak").textContent = this.streak >= 2 ? `🔥 ${this.streak}` : "";
    $("#quiz-best").textContent = t("Kỷ lục chuỗi: {n}", { n: this.best });
  }

  _pool() {
    const easy = this.level === "easy";
    return model.G.filter((g) => this.isOk(g) && trackOf(g.i) && !g.ap && (!easy || g.k >= 4));
  }

  question() {
    const pool = this._pool();
    if (pool.length < 4) { toast(t("Không đủ thể loại để chơi với bộ lọc hiện tại")); return; }
    const ans = pool[Math.floor(Math.random() * pool.length)];
    let opts;
    if (this.level === "easy") {
      // far-apart genres from other families: guessable by ear
      const far = shuffle(pool.filter((g) => g.i !== ans.i && Math.hypot(g.e - ans.e, g.b - ans.b) > 0.22 && !g.f.some((f) => ans.f.includes(f))));
      opts = [ans];
      for (const g of far) { if (opts.length >= 4) break; if (!opts.some((o) => Math.hypot(o.e - g.e, o.b - g.b) < 0.12)) opts.push(g); }
    } else {
      const near = nearest(ans.i, 14, (h) => this.isOk(h) && !!trackOf(h.i)).map(([i]) => model.G[i]);
      opts = [ans, ...shuffle(near).slice(0, 3)];
    }
    if (opts.length < 4) opts.push(...shuffle(pool.filter((g) => !opts.includes(g))).slice(0, 4 - opts.length));
    this.ans = ans;
    this.answered = false;
    const box = $("#quiz-opts");
    box.textContent = "";
    for (const g of shuffle(opts)) {
      box.append(el("button", { class: "quiz-opt", style: `--c:${g.c}`, onclick: (ev) => this._pick(g, ev.currentTarget) }, g.n));
    }
    $("#quiz-feedback").hidden = true;
    $("#quiz-next").hidden = true;
    $("#quiz-progress").style.width = "0%";
    this.trs = [trackOf(ans.i)]; this.tk = 0;
    $("#quiz-another").hidden = true;
    this._playTrack();
    // 32% of the songs sit in several genres (a v-pop hit is also "vietnamese idol pop"): a song that is also in
    // one of the other options would have two right answers, so only the answer's own songs are offered
    const others = opts.filter((g) => g !== ans);
    Promise.all([tracksOf(ans.i), ...others.map((g) => radioOf(g.i).catch(() => []))]).then(([all, ...lists]) => {
      if (this.ans !== ans) return;
      const taken = new Set(lists.flat().map((tr) => tr && tr[1]));
      const own = all.filter((tr) => !taken.has(tr[1]));
      const playing = this.trs[this.tk];
      const list = own.length ? own : all;
      if (!list.includes(playing)) list.unshift(playing);   // the demo song is already playing: keep it in the list
      this.trs = list; this.tk = list.indexOf(playing); this._trackUI();
      $("#quiz-another").hidden = list.length < 2;
    });
  }

  _trackUI() { $("#quiz-tn").textContent = this.trs.length > 1 ? `${this.tk + 1}/${this.trs.length}` : ""; }

  _playTrack(fails = 0) {
    const ans = this.ans, tr = this.trs[this.tk];
    $("#quiz-progress").style.width = "0%";
    this.player.gameSrc(this.audio, "https://p.scdn.co/mp3-preview/" + tr[0]);
    // a dead preview: try the genre's next song, and only give up on the question when all fail
    this.audio.onerror = () => {
      if (this.ans !== ans) return;
      if (fails + 1 < this.trs.length) { this.tk = (this.tk + 1) % this.trs.length; this._trackUI(); this._playTrack(fails + 1); }
      else this.question();
    };
    this.audio.play().catch(() => (this.dlg.dataset.playing = "false"));
  }

  _another() {
    if (this.trs.length < 2) { toast(t("Câu này không có bài khác")); return; }
    this.tk = (this.tk + 1) % this.trs.length;
    this._trackUI();
    this._playTrack();
  }

  _pick(g, btn) {
    if (this.answered) return;
    this.answered = true;
    this.player.heard(this.ans.i);
    const right = g.i === this.ans.i;
    this.total++;
    if (right) { this.score++; this.streak++; this.best = Math.max(this.best, this.streak); store.set("nm:quizBest", this.best); }
    else this.streak = 0;
    this._scoreUI();
    for (const b of $("#quiz-opts").children) {
      if (b.textContent === this.ans.n) b.dataset.result = "right";
      else if (b === btn) b.dataset.result = "wrong";
      b.disabled = true;
    }
    const tr = this.trs[this.tk];
    const fb = $("#quiz-feedback");
    fb.hidden = false;
    fb.textContent = "";
    fb.append(
      coverEl(tr[1], { size: 300, color: this.ans.c, cls: "quiz-cover" }),
      el("div", { class: "quiz-verdict" }, right ? t(pick(["🎉 Chính xác!", "🌟 Giỏi quá!", "👏 Đúng rồi!"])) : t("😅 Chưa đúng — đây là “{g}”", { g: this.ans.n })),
      el("div", { class: "quiz-credit" }, "🎵 ", el("b", {}, tr[3]), " — ", tr[2], likeBtn(() => songRec(this.ans.n, tr, this.tk), { cls: "icon-btn sm like-btn" })),
      factCard(this.ans.i),
      el("button", { class: "btn ghost sm", onclick: () => { this.dlg.close(); $("#quiz-back").hidden = false; this.onShow(this.ans.i, this.tk); } }, t("📍 Xem trên bản đồ")),
    );
    $("#quiz-next").hidden = false;
    $("#quiz-next").focus();
  }
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];
