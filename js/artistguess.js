// "Đoán nghệ sĩ": play a 30 s preview, pick the artist among four.
// Answer = a random demo track of a random genre (tracksOf). Distractors = artists of nearby genres
// (track #1 of each, already in memory), never the same artist name. Easy: loosely related genres, hard: the closest ones.
import { $, el, toast, shuffle, store } from "./util.js";
import { model, nearest, trackOf, tracksOf } from "./data.js";
import { t } from "./i18n.js";
import { initVizBtn } from "./vizbtn.js";

const pick = (a) => a[Math.floor(Math.random() * a.length)];
/** Lower-case name parts, so "A & B" clashes with "A" and "B". */
const parts = (s) => s.toLowerCase().split(/\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bwith\b|\bx\b)\s*/).map((x) => x.trim()).filter(Boolean);

export function initArtistGuess({ player, isOk, onShow }) {
  const dlg = $("#artistq");
  const audio = new Audio();
  audio.preload = "auto";
  player.solo(audio);
  const vb = initVizBtn($("#aq-play"), { player, dlg, audio });
  let level = store.get("nm:artistLevel", "easy");
  let score = 0, total = 0, streak = 0, best = store.get("nm:artistBest", 0);
  let ans = null, tr = null, tk = 0, answered = false, retries = 0, seq = 0;

  const levelUI = () => dlg.querySelectorAll("[data-level]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.level === level));
  const scoreUI = () => {
    $("#aq-score").textContent = `${score}/${total}`;
    $("#aq-streak").textContent = streak >= 2 ? `🔥 ${streak}` : "";
    $("#aq-best").textContent = t("Kỷ lục chuỗi: {n}", { n: best });
  };
  const pool = () => model.G.filter((g) => isOk(g) && trackOf(g.i) && !g.ap && (level !== "easy" || g.k >= 4));

  /** Three plausible wrong artists: from the answer's neighbourhood, distinct from the answer and from each other. */
  function distractors(g, artist) {
    const hard = level === "hard";
    const near = nearest(g.i, hard ? 10 : 45, (h) => isOk(h) && !!trackOf(h.i)).map(([i]) => model.G[i]);
    const cand = hard ? near : near.slice(5);                // easy skips the very closest sub-genres
    const taken = new Set(parts(artist));
    const out = [];
    for (const h of shuffle(cand.slice())) {
      const name = trackOf(h.i)[2], ps = parts(name);
      if (!name || ps.some((p) => taken.has(p))) continue;
      ps.forEach((p) => taken.add(p));
      out.push(name);
      if (out.length >= 3) break;
    }
    return out;
  }

  async function question() {
    const my = ++seq;
    const g0 = pool();
    if (g0.length < 8) { toast(t("Không đủ thể loại để chơi với bộ lọc hiện tại")); return; }
    audio.pause();
    $("#aq-opts").textContent = "";
    $("#aq-feedback").hidden = true; $("#aq-next").hidden = true;
    $("#aq-progress").style.width = "0%";
    for (let tries = 0; tries < 12; tries++) {
      const g = pick(g0);
      const list = await tracksOf(g.i);
      if (my !== seq) return;
      if (!list.length) continue;
      const n = Math.floor(Math.random() * list.length), artist = list[n][2];
      const wrong = distractors(g, artist);
      if (wrong.length < 3) continue;
      ans = g; tr = list[n]; tk = n; answered = false;
      const box = $("#aq-opts");
      for (const name of shuffle([artist, ...wrong])) {
        box.append(el("button", { class: "quiz-opt", style: "--c:var(--accent)", onclick: (ev) => guess(name === artist, ev.currentTarget) }, name));
      }
      play();
      return;
    }
    toast(t("Không đủ thể loại để chơi với bộ lọc hiện tại"));
  }

  function play() {
    const my = seq;
    player.gameSrc(audio, "https://p.scdn.co/mp3-preview/" + tr[0]);
    audio.onerror = () => {   // dead preview: another song of the same artist's genre can't keep the answer, so re-ask
      if (my === seq && !answered && retries++ < 5) question();
    };
    audio.play().catch(() => (dlg.dataset.playing = "false"));
  }

  function guess(right, btn) {
    if (answered) return;
    answered = true; total++;
    if (right) { score++; streak++; best = Math.max(best, streak); store.set("nm:artistBest", best); } else streak = 0;
    scoreUI();
    for (const b of $("#aq-opts").children) {
      if (b.textContent === tr[2]) b.dataset.result = "right";
      else if (b === btn) b.dataset.result = "wrong";
      b.disabled = true;
    }
    const fb = $("#aq-feedback");
    fb.hidden = false; fb.textContent = "";
    fb.append(
      el("div", { class: "quiz-verdict" }, right ? t(pick(["🎉 Chính xác!", "🌟 Giỏi quá!", "👏 Đúng rồi!"])) : t("😅 Chưa đúng — là {a}", { a: tr[2] })),
      el("div", { class: "quiz-credit" }, "🎵 ", el("b", {}, tr[3]), " — ", ans.n),
      el("button", { class: "btn ghost sm", onclick: () => { dlg.close(); onShow(ans.i, tk); } }, t("📍 Xem trên bản đồ")),
    );
    $("#aq-next").hidden = false;
    $("#aq-next").focus();
  }

  audio.addEventListener("canplay", () => (retries = 0));
  audio.addEventListener("play", () => (dlg.dataset.playing = "true"));
  audio.addEventListener("pause", () => (dlg.dataset.playing = "false"));
  audio.addEventListener("ended", () => (dlg.dataset.playing = "false"));
  audio.addEventListener("timeupdate", () => { $("#aq-progress").style.width = (audio.currentTime / (audio.duration || 30)) * 100 + "%"; });
  dlg.addEventListener("close", () => { audio.pause(); seq++; });
  $("#aq-play").onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
  $("#aq-next").onclick = question;
  dlg.querySelectorAll("[data-level]").forEach((b) => {
    b.onclick = () => { level = b.dataset.level; store.set("nm:artistLevel", level); levelUI(); question(); };
  });
  addEventListener("langchange", () => {
    if (!dlg.open) return;
    scoreUI();
    if (answered) { const b = $("#aq-feedback button"); if (b) b.textContent = t("📍 Xem trên bản đồ"); }
  });

  $("#ex-artist").onclick = async () => {
    $("#games").close();
    player.pause();
    dlg.showModal();
    levelUI(); scoreUI(); vb.start();
    await model.tracksReady;
    question();
  };
}
