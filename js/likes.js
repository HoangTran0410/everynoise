// Saved songs ("♥"): one record per Spotify track, newest first, kept in localStorage.
// Any screen that plays a song (player bar, games) gets a heart via likeBtn(get), where get()
// returns the song on screen right now: { g: genre name, id: track id, a: artist, s: song, n: index }.
import { el, store, toast, Emitter } from "./util.js";
import { t } from "./i18n.js";

const KEY = "nm:songs";
const MAX = 500;
let list = store.get(KEY, []);
export const likes = new Emitter();
likes.all = () => list;
likes.has = (id) => !!id && list.some((x) => x.id === id);
likes.set = (rec, on) => {
  if (!rec?.id) return;
  list = list.filter((x) => x.id !== rec.id);
  if (on) list.unshift({ g: rec.g, id: rec.id, a: rec.a, s: rec.s, n: rec.n ?? 0 });
  list = list.slice(0, MAX);
  store.set(KEY, list);
  likes.emit("change", rec.id);
};
likes.toggle = (rec) => {
  const on = !likes.has(rec?.id);
  likes.set(rec, on);
  toast(on ? t("❤️ Đã lưu bài hát — xem trong Cài đặt › Của bạn") : t("Đã bỏ lưu bài hát"));
  return on;
};

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" /></svg>';

/** A ♥ toggle bound to whatever song get() returns; call btn.refresh() after the song changes. */
export function likeBtn(get, { cls = "icon-btn like-btn", id } = {}) {
  const b = el("button", { class: cls, type: "button", title: t("Lưu bài hát"), "aria-label": t("Lưu bài hát"), "aria-pressed": "false" });
  if (id) b.id = id;
  b.innerHTML = HEART;
  b.refresh = () => {
    const rec = get();
    b.disabled = !rec?.id;
    b.setAttribute("aria-pressed", String(likes.has(rec?.id)));
  };
  b.onclick = (ev) => { ev.stopPropagation(); const rec = get(); if (rec?.id) likes.toggle(rec); };
  likes.on("change", b.refresh);
  b.refresh();
  return b;
}

/** Song record from a track tuple [preview, trackId, artist, song] of genre name g. */
export const songRec = (g, tr, n = 0) => (tr ? { g, id: tr[1], a: tr[2], s: tr[3], n } : null);
