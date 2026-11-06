// Artist page: a small dialog for one artist. Genres they are in (most central first, from the artist index),
// each row plays the artist's own track in that genre (data/ap profile shard); the genres glow on the map
// (map.setArtistSet, drawn in the overlay: once per frame, no gradients).
import { $, el, toast } from "./util.js";
import { model } from "./data.js";
import { t, fmtN } from "./i18n.js";
import { avatarEl } from "./covers.js";

const PAGE = 40;   // rows rendered at once (an artist can have 100+ genres)

export function initArtistPage({ artists, player, map, isOk, state, pick, layer, showLayer }) {
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
    $("#artist-near").hidden = true;
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
    showNear(k, my);
    prof = await artists.profile(name);
    if (my !== token) return;
    if (!prof.length) toast(t("Chưa có bài mẫu của nghệ sĩ này"));
    render();
  }

  // "Nghệ sĩ gần đó": the closest points of the artist layer; the map behind marks this artist (when the layer is on,
  // it flies there too, so closing the page shows where they are)
  let point = -1;
  async function showNear(k, my) {
    point = -1;
    const L = layer ? await layer() : null;
    if (my !== token || !L) return;
    const j = L.at.get(k);
    if (j == null) return;
    point = j;
    if (map.aOn) flyToPoint(j);
    const ids = L.near(j, 10, (i) => !(state.kids && L.bad(i)));
    const box = $("#artist-near-list");
    box.replaceChildren(...ids.map((i) => el("button", { class: "an-chip", type: "button", onclick: () => open(L.name(i)) },
      el("span", { class: "dot", style: `background:${L.c[i]}` }), el("span", {}, L.name(i)))));
    $("#artist-near").hidden = !ids.length;
  }
  function flyToPoint(j) {
    const [wx, wy] = map.artistPoint(j);
    const z = Math.max(map.view.z, map.zRef * 14);
    map.markArtist(j);
    map.flyTo({ cx: wx + (60 + map.rightInset / 2) / z, cy: wy + map.padBottom / 2 / z, z });
  }

  dlg.addEventListener("close", () => {
    token++;
    if (!keepGlow) map.setArtistSet(null);
  });
  $("#artist-more").onclick = () => { shown += PAGE * 3; render(); };
  $("#artist-map").onclick = () => {
    keepGlow = true;      // the glow stays after closing until the next search / genre pick (see clear())
    dlg.close();
    if (point >= 0 && showLayer) { showLayer(true); flyToPoint(point); }
    else map.fit(true, genres);
  };
  player.on("track", () => { if (dlg.open) render(); });
  player.on("state", () => { if (dlg.open) render(); });
  addEventListener("langchange", () => { if (dlg.open) { $("#artist-sub").textContent = genres.length ? t("{n} thể loại", { n: fmtN(genres.length) }) + " · " + t("thể loại đầu là nơi nghệ sĩ nổi bật nhất") : $("#artist-sub").textContent; render(); } });
  return { open, clear: () => { keepGlow = false; map.setArtistSet(null); map.markArtist(-1); }, get isOpen() { return dlg.open; } };
}
