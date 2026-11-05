// "Đoán nhạc cụ": play a 30s preview of an instrument genre, pick the instrument among four.
import { $, el, toast, shuffle, store } from "./util.js";
import { model, trackOf, tracksOf } from "./data.js";
import { t } from "./i18n.js";
import { initVizBtn } from "./vizbtn.js";
import { likeBtn, songRec } from "./likes.js";

// [genre name, emoji, family (s string · w wind · p percussion · k keys), Vietnamese name, Vietnamese fun fact]
// The English names and facts are in i18n.js (// instruments).
const DATA = [
  ["classical piano", "🎹", "k", "đàn piano", "Piano ra đời ở Ý khoảng năm 1700, có 88 phím và đánh được cả nhỏ lẫn to."],
  ["cello", "🎻", "s", "đàn cello", "Cello đến từ Ý, to bằng một em bé và người chơi ngồi kẹp nó giữa hai chân."],
  ["violin", "🎻", "s", "vĩ cầm (violin)", "Violin có từ thế kỷ 16 ở Ý, chỉ có bốn dây mà chơi được rất nhiều giai điệu."],
  ["harp", "🎼", "s", "đàn hạc (harp)", "Đàn hạc là một trong những nhạc cụ cổ nhất, có từ Ai Cập cổ đại hơn 4.000 năm trước."],
  ["harpsichord", "🎹", "k", "đàn harpsichord", "Harpsichord là tiền thân của piano: dây được gảy chứ không bị búa gõ, nên tiếng nghe lanh canh."],
  ["classical guitar", "🎸", "s", "guitar cổ điển", "Guitar cổ điển có dây nylon mềm, đến từ Tây Ban Nha và cho tiếng đàn ấm áp."],
  ["accordion", "🪗", "k", "phong cầm (accordion)", "Phong cầm tạo tiếng bằng cách kéo và nén hộp gió, rất hay gặp ở châu Âu."],
  ["banjo", "🪕", "s", "đàn banjo", "Banjo có gốc từ những nhạc cụ của người châu Phi, rồi trở thành linh hồn của nhạc đồng quê Mỹ."],
  ["ukulele", "🪕", "s", "đàn ukulele", "Ukulele đến từ Hawaii, tên nghĩa là “con bọ chét nhảy”, vì ngón tay người chơi nhảy rất nhanh."],
  ["sitar", "🪕", "s", "đàn sitar", "Sitar là đàn nổi tiếng của Ấn Độ, có nhiều dây cộng hưởng nên tiếng ngân rất dài."],
  ["koto", "🪕", "s", "đàn koto (Nhật Bản)", "Koto là đàn dài 13 dây của Nhật Bản, đặt nằm trên sàn và gảy bằng móc đeo ở ngón tay."],
  ["guzheng", "🪕", "s", "đàn tranh (Trung Quốc)", "Guzheng của Trung Quốc có hơn 2.000 năm tuổi và là họ hàng gần của đàn tranh Việt Nam."],
  ["erhu", "🎻", "s", "đàn nhị (erhu)", "Erhu là đàn hai dây kéo bằng vĩ của Trung Quốc, tiếng nghe như người đang hát."],
  ["pipa", "🪕", "s", "đàn tỳ bà (pipa)", "Tỳ bà là đàn gảy hình quả lê của Trung Quốc, có hơn 1.500 năm tuổi và cũng được chơi ở Việt Nam."],
  ["shamisen", "🪕", "s", "đàn shamisen (Nhật Bản)", "Shamisen là đàn ba dây của Nhật Bản, gảy bằng miếng gảy lớn nên tiếng nghe rất giòn."],
  ["bagpipe", "🪈", "w", "kèn túi (bagpipe)", "Kèn túi nổi tiếng ở Scotland: người thổi bơm hơi vào một cái túi rồi ép ra cho tiếng kêu liên tục."],
  ["didgeridoo", "🪈", "w", "kèn didgeridoo (Úc)", "Didgeridoo là cây kèn dài của người bản địa Úc, làm từ thân cây bị mối ăn rỗng, hơn 1.000 năm tuổi."],
  ["marimba", "🥁", "p", "đàn marimba", "Marimba có các thanh gỗ gõ bằng dùi, phổ biến ở Trung Mỹ và Mexico."],
  ["steelpan", "🥁", "p", "trống thép (steelpan)", "Trống thép ra đời ở Trinidad, làm từ những thùng dầu cũ được gõ lõm thành các nốt nhạc."],
  ["kora", "🪕", "s", "đàn kora (Tây Phi)", "Kora của Tây Phi có 21 dây và làm từ quả bầu khô bọc da bò."],
  ["oud", "🪕", "s", "đàn oud (Ả Rập)", "Oud là đàn không phím của người Ả Rập, và là tổ tiên của đàn luýt châu Âu."],
  ["theremin", "🎹", "k", "đàn theremin", "Theremin là nhạc cụ duy nhất chơi mà không cần chạm vào: tay chỉ múa trong không khí."],
  ["mandolin", "🪕", "s", "đàn mandolin", "Mandolin nhỏ xinh đến từ Ý, có tám dây xếp thành bốn cặp."],
  ["gamelan", "🥁", "p", "dàn gamelan (Indonesia)", "Gamelan là dàn cồng chiêng và thanh kim loại của đảo Java và Bali, nhiều người cùng chơi như một nhạc cụ lớn."],
  ["tabla", "🪘", "p", "trống tabla (Ấn Độ)", "Tabla là đôi trống nhỏ của Ấn Độ, đánh bằng đầu ngón tay và cả lòng bàn tay."],
  ["shakuhachi", "🪈", "w", "sáo shakuhachi (Nhật Bản)", "Shakuhachi là cây sáo trúc của Nhật Bản, từng được các nhà sư thổi khi thiền."],
  ["djembe", "🪘", "p", "trống djembe (Tây Phi)", "Djembe là cái trống hình ly rượu của Tây Phi; nghĩa là “mọi người cùng tụ lại”."],
  ["taiko", "🥁", "p", "trống taiko (Nhật Bản)", "Taiko là trống lớn của Nhật Bản; tiếng trống to đến mức vang đi rất xa trong lễ hội."],
  ["panpipe", "🪈", "w", "sáo pan (panpipe)", "Sáo pan gồm nhiều ống dài ngắn khác nhau ghép lại, nổi tiếng ở vùng núi Andes."],
  ["duduk", "🪈", "w", "kèn duduk (Armenia)", "Duduk là cây kèn làm từ gỗ mơ của Armenia, có tiếng trầm ấm và hơi buồn."],
  ["dizi", "🪈", "w", "sáo trúc dizi (Trung Quốc)", "Dizi là cây sáo ngang bằng trúc của Trung Quốc, có thêm một lỗ dán màng để tiếng sáo rè rè trong trẻo."],
  ["balalaika", "🪕", "s", "đàn balalaika (Nga)", "Balalaika là cây đàn ba dây thân hình tam giác nổi tiếng của nước Nga."],
  ["classical organ", "🎹", "k", "đàn organ (đại phong cầm)", "Đàn organ ống trong nhà thờ là nhạc cụ lớn nhất thế giới, có khi với hàng nghìn ống."],
  ["classical flute", "🪈", "w", "sáo flute", "Flute ngày nay làm bằng kim loại nhưng vẫn là “sáo”; thổi ngang qua một lỗ ở đầu sáo."],
  ["classical trumpet", "🎺", "w", "kèn trumpet", "Trumpet chỉ có ba phím bấm, nhưng thay đổi cách thổi môi là ra được rất nhiều nốt."],
  ["classical saxophone", "🎷", "w", "kèn saxophone", "Saxophone do ông Adolphe Sax phát minh ở Bỉ năm 1846; làm bằng kim loại nhưng thổi bằng lưỡi gà."],
];

const ROUNDS = 10;
const FAM_ORDER = ["s", "w", "p", "k"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Instruments {
  constructor({ player, isOk, onShow }) {
    this.player = player;
    this.isOk = isOk;              // genre filter (kids mode)
    this.onShow = onShow;          // (i, n) => show genre on the map and play its song #n
    this.audio = new Audio();
    this.audio.preload = "auto";
    player.solo(this.audio);       // never plays together with the main player
    this.level = store.get("nm:instrLevel", "easy");
    this.best = store.get("nm:instrBest", 0);
    this.score = 0; this.round = 0; this.streak = 0;
    this.dlg = $("#instr");
    this.vb = initVizBtn($("#instr-play"), { player, dlg: this.dlg, audio: this.audio });
    this.cur = null; this.answered = false; this.picked = null; this.used = new Set(); this.skips = 0;
    const a = this.audio;
    a.addEventListener("play", () => (this.dlg.dataset.playing = "true"));
    a.addEventListener("pause", () => (this.dlg.dataset.playing = "false"));
    a.addEventListener("ended", () => (this.dlg.dataset.playing = "false"));
    a.addEventListener("timeupdate", () => { $("#instr-progress").style.width = (a.currentTime / (a.duration || 30)) * 100 + "%"; });
    this.dlg.addEventListener("close", () => a.pause());
    $("#instr-play").onclick = () => (a.paused ? a.play().catch(() => {}) : a.pause());
    $("#instr-next").onclick = () => (this.round >= ROUNDS ? this._end() : this.question());
    $("#instr-again").onclick = () => this._newGame();
    $("#instr-back").onclick = () => this.resume();
    this.dlg.querySelectorAll("[data-level]").forEach((b) => {
      b.onclick = () => { this.level = b.dataset.level; store.set("nm:instrLevel", this.level); this._newGame(); };
    });
    addEventListener("langchange", () => this.relabel());
  }

  /** The instruments that can be played now: genre exists, has a song, passes kids mode. */
  _items() {
    const out = [];
    for (const [g, emoji, fam, vi, fact] of DATA) {
      const i = model.byName.get(g);
      if (i == null || !trackOf(i) || !this.isOk(model.G[i])) continue;
      out.push({ g, i, emoji, fam, vi, fact });
    }
    return out;
  }

  async open() {
    $("#instr-back").hidden = true;
    this.player.pause();
    this.dlg.showModal();
    await model.tracksReady;
    if (!this.cur && this.round === 0) this._newGame(); else this._ui();
  }

  resume() {
    $("#instr-back").hidden = true;
    this.player.pause();
    this.dlg.showModal();
    this._ui();
  }

  _newGame() {
    this.score = 0; this.round = 0; this.streak = 0; this.used = new Set(); this.skips = 0;
    this.dlg.dataset.end = "false";
    this.question();
  }

  _ui() {
    this.dlg.querySelectorAll("[data-level]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.level === this.level));
    $("#instr-round").textContent = t("Câu {a}/{b}", { a: Math.min(Math.max(this.round, 1), ROUNDS), b: ROUNDS });
    $("#instr-score").textContent = `${this.score}`;
    $("#instr-streak").textContent = this.streak >= 2 ? `🔥 ${this.streak}` : "";
    $("#instr-best").textContent = t("Kỷ lục chuỗi: {n}", { n: this.best });
  }

  relabel() {
    this._ui();
    if (!this.cur) return;
    for (const b of $("#instr-opts").children) b.querySelector("span").textContent = t(b._it.vi);
    if (this.answered) this._feedback();
    if (this.dlg.dataset.end === "true") this._endUI();
  }

  question() {
    const items = this._items();
    if (items.length < 4) { toast(t("Không đủ nhạc cụ để chơi với bộ lọc hiện tại")); return; }
    this.round++;
    let pool = items.filter((x) => !this.used.has(x.g));
    if (!pool.length) pool = items;
    const ans = pick(pool);
    this.used.add(ans.g);
    const others = items.filter((x) => x !== ans);
    const opts = [ans];
    if (this.level === "easy") {
      // one instrument from each of three other families: different sound worlds
      for (const f of shuffle(FAM_ORDER.filter((f) => f !== ans.fam))) {
        const c = others.filter((x) => x.fam === f && !opts.includes(x));
        if (c.length) opts.push(pick(c));
      }
    } else {
      opts.push(...shuffle(others.filter((x) => x.fam === ans.fam)).slice(0, 3));
    }
    if (opts.length < 4) opts.push(...shuffle(others.filter((x) => !opts.includes(x))).slice(0, 4 - opts.length));
    this.cur = ans; this.answered = false; this.picked = null;
    const box = $("#instr-opts");
    box.textContent = "";
    for (const it of shuffle(opts)) {
      const b = el("button", { class: "quiz-opt instr-opt", onclick: () => this._pick(it, b) },
        el("i", { "aria-hidden": "true" }, it.emoji), el("span", {}, t(it.vi)));
      b._it = it;
      box.append(b);
    }
    $("#instr-feedback").hidden = true;
    $("#instr-next").hidden = true;
    $("#instr-progress").style.width = "0%";
    this._ui();
    this.trs = [trackOf(ans.i)]; this.tk = 0;
    this._playTrack();
    tracksOf(ans.i).then((all) => { if (this.cur === ans && all.length > 1) this.trs = all; });
  }

  _playTrack(fails = 0) {
    const ans = this.cur, tr = this.trs[this.tk];
    $("#instr-progress").style.width = "0%";
    this.player.gameSrc(this.audio, "https://p.scdn.co/mp3-preview/" + tr[0]);
    // a dead preview: try the genre's next song; when all fail, skip the question (round not counted)
    this.audio.onerror = () => {
      if (this.cur !== ans || this.answered) return;
      if (fails + 1 < this.trs.length) { this.tk = (this.tk + 1) % this.trs.length; this._playTrack(fails + 1); return; }
      if (++this.skips > 5) { toast(t("Không tải được nhạc. Kiểm tra mạng nhé!")); return; }
      this.round--;
      this.question();
    };
    this.audio.onplaying = () => { this.skips = 0; };
    this.audio.play().catch(() => (this.dlg.dataset.playing = "false"));
  }

  _pick(it, btn) {
    if (this.answered) return;
    this.answered = true; this.picked = it;
    this.player.heard(this.cur.i);
    const right = it === this.cur;
    if (right) { this.score++; this.streak++; this.best = Math.max(this.best, this.streak); store.set("nm:instrBest", this.best); }
    else this.streak = 0;
    this._ui();
    for (const b of $("#instr-opts").children) {
      if (b._it === this.cur) b.dataset.result = "right";
      else if (b === btn) b.dataset.result = "wrong";
      b.disabled = true;
    }
    this._verdict = right ? pick(["🎉 Chính xác!", "🌟 Giỏi quá!", "👏 Đúng rồi!"]) : null;
    this._feedback();
    const nx = $("#instr-next");
    nx.textContent = t(this.round >= ROUNDS ? "Xem kết quả 🏆" : "Câu tiếp theo →");
    nx.hidden = false;
    nx.focus();
  }

  _feedback() {
    const c = this.cur, tr = this.trs[this.tk];
    const fb = $("#instr-feedback");
    fb.hidden = false;
    fb.textContent = "";
    fb.append(
      el("div", { class: "quiz-verdict" }, this._verdict ? t(this._verdict) : t("😅 Chưa đúng — đây là {n}", { n: t(c.vi) })),
      el("div", { class: "instr-fact" }, el("i", { "aria-hidden": "true" }, c.emoji), " ", t(c.fact)),
      el("div", { class: "quiz-credit" }, "🎵 ", el("b", {}, tr[3]), " — ", tr[2], likeBtn(() => songRec(model.G[c.i].n, tr, this.tk), { cls: "icon-btn sm like-btn" })),
      el("button", { class: "btn ghost sm", onclick: () => { this.dlg.close(); $("#instr-back").hidden = false; this.onShow(c.i, this.tk); } }, t("📍 Xem trên bản đồ")),
    );
  }

  _end() {
    this.audio.pause();
    this.dlg.dataset.end = "true";
    this._endUI();
  }
  _endUI() {
    const s = this.score;
    $("#instr-final").textContent = `${s}/${ROUNDS}`;
    $("#instr-msg").textContent = t(s >= 9 ? "Giỏi lắm! 🌟" : s >= 6 ? "Khá lắm! 👍" : "Hãy thử lại nhé! 🌱");
    $("#instr-again").textContent = t("🔄 Chơi lại");
  }
}
