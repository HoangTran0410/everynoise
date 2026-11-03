// "Đoán thể loại": play a 30s preview, pick the right genre among four.
import { $, el, toast, shuffle, store } from "./util.js";
import { model, nearest, trackOf } from "./data.js";

export class Quiz {
  constructor({ player, isOk, onShow }) {
    this.player = player;          // main player, paused while the quiz runs
    this.isOk = isOk;              // genre filter (kids mode)
    this.onShow = onShow;          // (i) => show genre on the map
    this.audio = new Audio();
    this.audio.preload = "auto";
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
    $("#quiz-play").onclick = () => (this.audio.paused ? this.audio.play().catch(() => {}) : this.audio.pause());
    $("#quiz-next").onclick = () => this.question();
    this.dlg.querySelectorAll("[data-level]").forEach((b) => {
      b.onclick = () => { this.level = b.dataset.level; store.set("nm:quizLevel", this.level); this._levelUI(); this.question(); };
    });
  }

  async open() {
    this.player.pause();
    this.dlg.showModal();
    this._levelUI();
    this._scoreUI();
    await model.tracksReady;
    this.question();
  }

  _levelUI() {
    this.dlg.querySelectorAll("[data-level]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.level === this.level));
  }
  _scoreUI() {
    $("#quiz-score").textContent = `${this.score}/${this.total}`;
    $("#quiz-streak").textContent = this.streak >= 2 ? `🔥 ${this.streak}` : "";
    $("#quiz-best").textContent = `Kỷ lục chuỗi: ${this.best}`;
  }

  _pool() {
    const easy = this.level === "easy";
    return model.G.filter((g) => this.isOk(g) && trackOf(g.i) && !g.ap && (!easy || g.k >= 4));
  }

  question() {
    const pool = this._pool();
    if (pool.length < 4) { toast("Không đủ thể loại để chơi với bộ lọc hiện tại"); return; }
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
    const tr = trackOf(ans.i);
    this.audio.src = "https://p.scdn.co/mp3-preview/" + tr[0];
    this.audio.onerror = () => { if (this.ans === ans) this.question(); };
    this.audio.play().catch(() => (this.dlg.dataset.playing = "false"));
  }

  _pick(g, btn) {
    if (this.answered) return;
    this.answered = true;
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
    const tr = trackOf(this.ans.i);
    const fb = $("#quiz-feedback");
    fb.hidden = false;
    fb.textContent = "";
    fb.append(
      el("div", { class: "quiz-verdict" }, right ? pick(["🎉 Chính xác!", "🌟 Giỏi quá!", "👏 Đúng rồi!"]) : `😅 Chưa đúng — đây là “${this.ans.n}”`),
      el("div", { class: "quiz-credit" }, "🎵 ", el("b", {}, tr[3]), " — ", tr[2]),
      el("button", { class: "btn ghost sm", onclick: () => { this.dlg.close(); this.onShow(this.ans.i); } }, "📍 Xem trên bản đồ"),
    );
    $("#quiz-next").hidden = false;
    $("#quiz-next").focus();
  }
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];
