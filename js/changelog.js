// "✨ Có gì mới": a short, hand-written list of what each release brings (newest first), in plain words for users.
// Opens by itself once after an update that added an entry (never on the very first visit), and from
// Settings > About any time. Add a new entry at the top of LOG when a release has something users will notice.
import { $, el, store } from "./util.js";
import { t, lang, addStrings } from "./i18n.js";

const SEEN = "nm:log-seen";
/** [date, [[vi, en], ...]] — newest first. */
export const LOG = [
  ["2026-11-06", [
    ["📻 Radio theo giờ đổi \"vị\" mỗi ngày (vd. buổi sáng: Indie tươi / Cà phê jazz / Pop khắp thế giới) và tránh lặp thể loại đã nghe mấy hôm trước; thẻ trong Khám phá luôn đúng giờ hiện tại.", "📻 Time-of-day radio now has a different flavour each day (e.g. morning: Fresh indie / Coffee jazz / World pop) and steers clear of genres from the last few days; the Explore card always shows the current time."],
    ["▶ Nghe tất cả: phát lần lượt các thể loại ⭐ yêu thích hoặc ❤️ bài hát đã lưu (Cài đặt › Của bạn).", "▶ Play all: play your ⭐ favourite genres or ❤️ saved songs one after another (Settings › Yours)."],
    ["Nút đường đi trên thanh hành trình: bật/tắt vệt nối các bước trên bản đồ, dùng được cho mọi hành trình.", "Path button on the journey bar: show or hide the line joining the steps on the map, for any journey."],
    ["Đang nghe hành trình mà bấm sang bài khác vẫn không mất hành trình: bấm ⏭ là quay về bước tiếp theo.", "Playing something else during a journey no longer ends it: ⏭ takes you back to the next step."],
    ["🔗 Chia sẻ được mọi hành trình, kể cả danh sách yêu thích hay bài đã lưu (tới 200 bước); người nhận mở link là có lộ trình y hệt.", "🔗 Share any journey, even your favourites or saved songs (up to 200 steps); the link opens the same route for whoever gets it."],
    ["Thẻ Thể loại hôm nay giờ kể một điều thú vị thật về thể loại đó.", "The Genre of the day card now tells a real fun fact about the genre."],
    ["✨ Có gì mới: bảng này, để bạn biết mỗi bản cập nhật có gì.", "✨ What's new: this list, so you know what each update brings."],
  ]],
  ["2026-11-05", [
    ["💡 Điều thú vị: hơn 2.300 fact về 1.265 thể loại, bấm ‹ › để xem tiếp. Game đoán thể loại cũng hiện fact sau khi trả lời.", "💡 Fun facts: over 2,300 facts about 1,265 genres, tap ‹ › for more. Genre games show them after you answer."],
    ["Bìa album và ảnh nghệ sĩ khắp nơi; bấm vào ảnh để xem to, chụm hoặc lăn chuột để phóng.", "Album covers and artist photos everywhere; tap a picture to see it big, pinch or scroll to zoom."],
    ["💾 Sao lưu: xuất dữ liệu ra file rồi nhập lại trên máy khác (Cài đặt › Của bạn).", "💾 Backup: export your data to a file and import it on another device (Settings › Yours)."],
    ["Game mới: Nghe đoán mỗi ngày, Nghe A/B, Thể loại hôm nay, Radio theo giờ, cấp bậc và con dấu hộ chiếu.", "New: daily Guess by ear, A/B listening, Genre of the day, Time-of-day radio, passport ranks and stamps."],
    ["🧭 Lộ trình của tôi, 🎞 trail trực tiếp, và chia sẻ mọi thứ bằng một đường link.", "🧭 My routes, 🎞 live trail, and share anything with one link."],
    ["Mỗi thể loại có thêm một câu giải thích dễ hiểu cho trẻ em; 12 hành trình khám phá mới.", "Every genre has a kid-friendly one-line explanation; 12 new guided journeys."],
  ]],
  ["2026-11-04", [
    ["Tìm trong 425.000 nghệ sĩ, trang nghệ sĩ sáng lên trên bản đồ, game Cầu nối nghệ sĩ.", "Search 425,000 artists, artist pages glow on the map, Artist bridge game."],
    ["Game mới: Đoán nhạc cụ (36 nhạc cụ) và Đoán nghệ sĩ.", "New games: Guess the instrument (36 instruments) and Guess the artist."],
    ["❤️ Lưu bài hát; radio mỗi thể loại phát mãi không hết bài.", "❤️ Save songs; each genre's radio now plays on and on."],
  ]],
];
const latest = LOG[0][0];

addStrings({ "✨ Có gì mới": "✨ What's new", "Đã hiểu": "Got it" });

let dlg = null;
function build() {
  const close = el("button", { class: "icon-btn close", "aria-label": t("Đóng"), onclick: () => dlg.close() });
  close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>';
  const fmt = (d) => new Date(d + "T12:00:00").toLocaleDateString(lang === "en" ? "en-GB" : "vi-VN", { day: "numeric", month: "long", year: "numeric" });
  const body = el("div", { class: "log-body" }, ...LOG.map(([d, items], k) => el("section", { class: "log-day" + (k ? "" : " new") },
    el("h3", {}, fmt(d)), el("ul", {}, ...items.map((it) => el("li", {}, it[lang === "en" ? 1 : 0]))))));
  dlg = el("dialog", { class: "modal changelog", id: "changelog" }, close, el("h2", {}, t("✨ Có gì mới")), body,
    el("button", { class: "btn primary full", onclick: () => dlg.close() }, t("Đã hiểu")));
  dlg.addEventListener("close", () => store.set(SEEN, latest));
  document.body.append(dlg);
}
export function openChangelog() {
  if (!dlg) build();
  dlg.querySelector(".log-body").scrollTop = 0;
  dlg.showModal();
}

/** `fresh`: the very first visit (nothing new to tell yet). Otherwise shows once when an entry is unseen. */
export function initChangelog({ fresh }) {
  $("#set-log")?.addEventListener("click", () => { $("#settings")?.close(); openChangelog(); });
  if (fresh) { store.set(SEEN, latest); return; }
  if (store.get(SEEN, "") >= latest) return;
  // wait for the map to settle; don't pile on top of another open dialog (it will show next launch instead)
  setTimeout(() => { if (!document.querySelector("dialog[open]")) openChangelog(); }, 1500);
}
