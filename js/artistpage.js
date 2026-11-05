// Artist page: a small dialog for one artist. Genres they are in (most central first, from the artist index),
// each row plays the artist's own track in that genre (data/ap profile shard); the genres glow on the map
// (map.setArtistSet, drawn in the overlay: once per frame, no gradients).
import { $, el, toast } from "./util.js";
import { model } from "./data.js";
import { t, fmtN } from "./i18n.js";
import { avatarEl } from "./covers.js";

const PAGE = 40;   // rows rendered at once (an artist can have 100+ genres)

export function initArtistPage({ artists, player, map, isOk, state, pick }) {
  const dlg = $("#artist");
  let genres = [], prof = [], shown = PAGE, name = "", token = 0, keepGlow = false;

  const trackFor = (i) => prof.find((p) => p.gs.includes(i))?.tr || null;

  function render() {
    const ul = $("#artist-genres");
    ul.textContent = "";
    const cur = player.current, trId = player.meta?.trackId;
    genres.slice(0, shown).forEach((i, rank) => {
      const g = model.G[i], tr = trackFor(i);
      const on = tr && cur === i && trId === tr[1];
      ul.append(el("li", { class: "ag-row" + (on ? " cur" : "") },
        el("button", {
          class: "ag-play", title: tr ? t("Nghe bài này") : g.n,
          onclick: () => { if (tr) player.play(i, { tr }); else { dlg.close(); pick(i); } },
        },
        el("span", { class: "dot", style: `background:${g.c}` }),
        el("span", { class: "ag-t" }, el("b", {}, g.n),
          el("small", {}, tr ? (on && player.playing ? "🔊 " : "♪ ") + tr[3] : (prof.length ? "" : t("Đang tải…")))),
        rank === 0 ? el("span", { class: "ag-top" }, t("Nổi bật nhất")) : null),
        el("button", { class: "icon-btn ag-go", title: t("Mở thể loại"), "aria-label": t("Mở thể loại"), onclick: () => { dlg.close(); pick(i); } }, "→")));
    });
    const more = $("#artist-more");
    more.hidden = genres.length <= shown;
    more.textContent = t("Xem thêm ({n})", { n: fmtN(genres.length - shown) });
  }

  async function open(artist) {
    if (!artist) return;
    const my = ++token;
    name = artist; genres = []; prof = []; shown = PAGE; keepGlow = false;
    $("#artist-name").textContent = artist;
    $("#artist-sub").textContent = t("Đang tải…");
    $("#artist-genres").textContent = "";
    $("#artist-more").hidden = true;
    $("#artist-map").disabled = true;
    if (!dlg.open) dlg.showModal();
    const k = await artists.lookup(artist);
    if (my !== token) return;
    if (k < 0 || (state.kids && artists.isBad(k))) { $("#artist-sub").textContent = t("Không tìm thấy nghệ sĩ này 🙈"); return; }
    name = artists.nameOf(k);
    $("#artist-name").textContent = name;
    $("#artist-av").replaceWith(Object.assign(avatarEl(name, { size: 56, cls: "artist-av" }), { id: "artist-av" }));
    genres = artists.centralGenres(k);
    $("#artist-sub").textContent = genres.length ? t("{n} thể loại", { n: fmtN(genres.length) }) + " · " + t("thể loại đầu là nơi nghệ sĩ nổi bật nhất") : t("Không tìm thấy nghệ sĩ này 🙈");
    $("#artist-map").disabled = !genres.length;
    map.setArtistSet(genres);
    render();
    prof = await artists.profile(name);
    if (my !== token) return;
    if (!prof.length) toast(t("Chưa có bài mẫu của nghệ sĩ này"));
    render();
  }

  dlg.addEventListener("close", () => {
    token++;
    if (!keepGlow) map.setArtistSet(null);
  });
  $("#artist-more").onclick = () => { shown += PAGE * 3; render(); };
  $("#artist-map").onclick = () => {
    keepGlow = true;      // the glow stays after closing until the next search / genre pick (see clear())
    dlg.close();
    map.fit(true, genres);
  };
  player.on("track", () => { if (dlg.open) render(); });
  player.on("state", () => { if (dlg.open) render(); });
  addEventListener("langchange", () => { if (dlg.open) { $("#artist-sub").textContent = genres.length ? t("{n} thể loại", { n: fmtN(genres.length) }) + " · " + t("thể loại đầu là nơi nghệ sĩ nổi bật nhất") : $("#artist-sub").textContent; render(); } });
  return { open, clear: () => { keepGlow = false; map.setArtistSet(null); }, get isOpen() { return dlg.open; } };
}
