// UI language (vi / en). Vietnamese text in the code and in index.html is the key;
// EN holds the English for each key. Missing keys fall back to Vietnamese.
import { store } from "./util.js";

const EN = {
  // ── index.html: static text, titles, aria-labels, placeholders ──
  "Khám phá gần 6.000 thể loại nhạc trên một tấm bản đồ: bấm để nghe, tìm kiếm, lọc, đi hành trình và chơi đoán thể loại.":
    "Explore almost 6,000 music genres on one map: tap to listen, search, filter, take a journey and play the genre quiz.",
  "Bộ lọc": "Filters",
  "Bộ lọc & danh sách": "Filters & list",
  "Tìm thể loại… (vd: shoegaze, vietnamese, lullaby)": "Search genres… (e.g. shoegaze, vietnamese, lullaby)",
  "Tìm thể loại… (vd: lullaby, piano, samba)": "Search genres… (e.g. lullaby, piano, samba)",
  "Tìm thể loại…": "Search genres…",
  "Tìm…": "Search…",
  "Tìm quốc gia…": "Search countries…",
  "Không có kết quả": "No results",
  "Chưa nghe thể loại nào. Bấm một chấm trên bản đồ để nghe.": "No genres heard yet. Tap a dot on the map to listen.",
  "Xem tất cả ({n})": "Show all ({n})",
  "Tìm thể loại": "Search genres",
  "Hành trình & trò chơi": "Journeys & games",
  "Khám phá": "Explore",
  "Chơi đoán thể loại": "Play the genre quiz",
  "Đoán nhạc": "Quiz",
  "Chế độ trẻ em: chữ to, chỉ hiện thể loại phù hợp": "Kids mode: bigger text, kid-friendly genres only",
  "Trẻ em": "Kids",
  "Số thể loại bạn đã nghe": "Genres you have heard",
  "Nhóm nhạc": "Families",
  "Bỏ chọn": "Clear",
  "Quốc gia / khu vực": "Country / region",
  "Quốc gia": "Country",
  "🌐 Tất cả": "🌐 All",
  'Chỉ "local scene" (indie thành phố…)': 'Only "local scenes" (city indie…)',
  "Chỉ mục yêu thích": "Favourites only",
  "Chỉ thể loại chưa nghe": "Only genres I haven't heard",
  "Đặc tính âm thanh": "Sound",
  "Đặt lại": "Reset",
  "🌿 Mộc": "🌿 Organic",
  "Điện tử ⚡": "Electric ⚡",
  "⚡ Điện tử": "⚡ Electric",
  "Mộc tối thiểu": "Organic minimum",
  "Điện tử tối đa": "Electric maximum",
  "🌫 Dày, mờ ảo": "🌫 Dense, atmospheric",
  "Nảy, sắc 🎈": "Spiky, bouncy 🎈",
  "🌫 Dày · mờ ảo": "🌫 Dense · atmospheric",
  "🎈 Nảy · sắc": "🎈 Spiky · bouncy",
  "🌫 Dày": "🌫 Dense",
  "Nảy 🎈": "Bouncy 🎈",
  "Dày tối thiểu": "Dense minimum",
  "Nảy tối đa": "Bouncy maximum",
  "thể loại": "genres",
  "Sắp xếp": "Sort",
  "Liên quan": "Relevance",
  "Nhiều nhánh con": "Most subgenres",
  "Điện tử nhất": "Most electric",
  "Mộc nhất": "Most organic",
  "Nảy nhất": "Bounciest",
  "Xem thêm": "Show more",
  "Xoá tất cả bộ lọc": "Clear all filters",
  "Bản đồ thể loại nhạc. Kéo để di chuyển, cuộn hoặc chụm hai ngón để phóng to.":
    "Music genre map. Drag to move, scroll or pinch to zoom.",
  "Dừng": "Stop",
  "Phóng to (+)": "Zoom in (+)",
  "Phóng to": "Zoom in",
  "Thu nhỏ (−)": "Zoom out (−)",
  "Thu nhỏ": "Zoom out",
  "Xem toàn cảnh (F)": "Show everything (F)",
  "Xem toàn cảnh": "Show everything",
  "Ngẫu nhiên (R)": "Random (R)",
  "Ngẫu nhiên": "Random",
  "Bấm để di chuyển nhanh": "Tap to jump there",
  "Đang tải bản đồ âm nhạc…": "Loading the music map…",
  "Tua": "Seek",
  "Xem chi tiết": "Show details",
  "Xem chi tiết bài đang phát": "Show details of the playing track",
  "Bấm vào một thể loại để nghe 🎧": "Tap a genre to listen 🎧",
  "Mỗi chấm là một thể loại nhạc": "Every dot is a music genre",
  "Trước": "Previous",
  "Phát (Space)": "Play (Space)",
  "Phát": "Play",
  "Tạm dừng (Space)": "Pause (Space)",
  "Tạm dừng": "Pause",
  "Tiếp (N)": "Next (N)",
  "Tiếp": "Next",
  "Lặp lại bài này (L)": "Repeat this track (L)",
  "Lặp lại": "Repeat",
  "Tự chuyển": "Auto-advance",
  "Gần": "Near",
  "Tắt": "Off",
  "Tắt tiếng": "Mute",
  "Âm lượng": "Volume",
  "Credit & chi tiết": "Credits & details",
  "Credit và chi tiết": "Credits and details",
  "Đóng": "Close",
  "Đóng (Esc)": "Close (Esc)",
  "Phát bài mẫu": "Play the sample track",
  "Bài mẫu của thể loại này": "Sample track for this genre",
  "Yêu thích": "Favourite",
  "Nghe đầy đủ:": "Full track on:",
  "Chi tiết âm thanh": "Audio details",
  "Nguồn": "Source",
  "Độ dài": "Length",
  "bản nghe thử ~30 giây": "~30 second preview",
  "Tốc độ": "Speed",
  "Phổ âm": "Spectrum",
  "📍 Vị trí ước tính theo thể loại cha": "📍 Position estimated from the parent genre",
  "Thể loại cha": "Parent genres",
  "Nhánh con": "Subgenres",
  "Nghe gần giống": "Sounds similar",
  "(hàng xóm trên bản đồ)": "(neighbours on the map)",
  "🔗 Sao chép liên kết": "🔗 Copy link",
  "Trang gốc trên everynoise.com ↗": "Original page on everynoise.com ↗",
  "Tìm hiểu trên Wikipedia ↗": "Read on Wikipedia ↗",
  "Chào mừng tới Everynoise!": "Welcome to Everynoise!",
  "🚀 Đi một hành trình": "🚀 Take a journey",
  "🎮 Trò chơi": "🎮 Games",
  "Đoán thể loại": "Guess the genre",
  "Nghe 30 giây rồi chọn đúng tên thể loại. Ai đúng nhiều nhất?": "Listen for 30 seconds, then pick the right genre. Who gets the most?",
  "🗺️ Tự do khám phá bản đồ": "🗺️ Explore the map freely",
  "Bật chế độ trẻ em": "Turn on kids mode",
  "🎯 Đoán thể loại": "🎯 Guess the genre",
  "Độ khó": "Difficulty",
  "😊 Dễ": "😊 Easy",
  "🤯 Khó": "🤯 Hard",
  "Điểm:": "Score:",
  "Nghe lại / tạm dừng": "Replay / pause",
  "Bạn nghĩ đây là thể loại gì?": "Which genre do you think this is?",
  "Câu tiếp theo →": "Next question →",
  "Bản đồ này hoạt động thế nào?": "How does this map work?",
  "Đổi ngôn ngữ": "Change language",
  "Cài đặt": "Settings",
  "⚙️ Cài đặt": "⚙️ Settings",
  "🌐 Ngôn ngữ": "🌐 Language",
  "Ngôn ngữ": "Language",
  "🎨 Giao diện": "🎨 Theme",
  "Giao diện": "Theme",
  "Tự động": "Auto",
  "Sáng": "Light",
  "Tối": "Dark",
  "🧒 Chế độ trẻ em": "🧒 Kids mode",
  "⭐ Yêu thích": "⭐ Favourites",
  "Chưa có mục yêu thích. Bấm ☆ trong trang chi tiết thể loại để thêm.": "No favourites yet. Tap ☆ on a genre's detail page to add one.",
  "🎧 Lịch sử nghe": "🎧 Listening history",
  "Xoá lịch sử": "Clear history",
  "Bấm lần nữa để xoá": "Tap again to clear",
  "Đã xoá lịch sử nghe": "Listening history cleared",
  "Đã nghe {a} / {b} thể loại": "Heard {a} / {b} genres",
  "🔄 Cập nhật": "🔄 Updates",
  "Phiên bản:": "Version:",
  "Kiểm tra cập nhật": "Check for updates",
  "Tải lại để dùng bản mới": "Reload to use the new version",
  "ℹ️ Cách hoạt động": "ℹ️ How it works",
  "Bỏ khỏi yêu thích": "Remove from favourites",
  "Đang kiểm tra…": "Checking…",
  "✅ Bạn đang dùng bản mới nhất.": "✅ You have the latest version.",
  "⬇️ Đang tải bản mới…": "⬇️ Downloading the new version…",
  "🎉 Đã có bản mới!": "🎉 A new version is ready!",
  "Không kiểm tra được (đang offline?)": "Couldn't check (offline?)",
  "Bản chạy local, không có service worker.": "Local build, no service worker.",

  // ── multi-markup blocks (data-i18n-html) ──
  "html:welcome":
    "This is a map of <b>almost 6,000 music genres</b> from around the world. Every word is a genre: <b>tap it to listen</b>. Genres close to each other sound alike.",
  "html:about1":
    "<b>Every Noise at Once</b> (everynoise.com) is a project by Glenn McDonald, made while he was the “data alchemist” at Spotify. Every word on the map is a <i>micro-genre</i> that Spotify's systems discovered from listening behaviour and the audio of millions of artists.",
  "html:about2":
    "<li><b>Position</b>: from the average audio features of the tracks in the genre. One axis runs from <b>organic</b> to <b>mechanical, electric</b>; the other from <b>dense, atmospheric</b> to <b>spiky, bouncy</b>. Close together means similar sound.</li>" +
    "<li><b>Colour</b>: also mixed from the audio features, so areas of the same colour share a similar “feel”.</li>" +
    "<li><b>Sound</b>: every genre has a sample track picked by Every Noise. Everynoise plays Spotify's 30-second preview and names the song and artist so you can hear it in full elsewhere. If the Spotify preview won't load, Everynoise finds the same song on Deezer.</li>" +
    "<li>The original site stopped updating at the end of 2023, when Glenn left Spotify.</li>",
  "html:about3":
    "<b>Kids mode</b> hides families like metal and hip hop, and genres whose names hint at adult themes. The data has no per-track “explicit” flag, so it is only a rough filter: best to explore together with your child.",
  "html:about4":
    "Data: coordinates &amp; colours from <a href=\"https://github.com/AyrtonB/EveryNoise-Watch\" target=\"_blank\" rel=\"noopener\">EveryNoise-Watch</a> (CC-BY-SA 4.0); sample tracks from <a href=\"https://github.com/jtbartee/everynoise-jukebox\" target=\"_blank\" rel=\"noopener\">everynoise-jukebox</a>; all of it comes from everynoise.com. Audio belongs to the artists and the platforms that publish it.",
  "html:about5":
    "Shortcuts: <kbd>/</kbd> search · <kbd>Space</kbd> play/pause · <kbd>N</kbd> next · <kbd>L</kbd> repeat · <kbd>←</kbd>/<kbd>→</kbd> seek 5s · <kbd>R</kbd> random · <kbd>F</kbd> show all · <kbd>Esc</kbd> close",

  // ── js/main.js ──
  "Không có thể loại nào khớp 🙈 Thử nới bộ lọc nhé.": "No genres match 🙈 Try loosening the filters.",
  "{n} nhánh": "{n} subgenres",
  "Đã nghe": "Heard",
  "Xem thêm ({n})": "Show more ({n})",
  "📍 Đang lọc: {c}": "📍 Filtering: {c}",
  "Bạn đã nghe {a} / {b} thể loại": "You have heard {a} / {b} genres",
  "Lọc theo nhóm này": "Filter by this family",
  "{e} Đang lọc: {f}": "{e} Filtering: {f}",
  "Lọc theo quốc gia này": "Filter by this country",
  "✓ Đã nghe": "✓ Heard",
  "+{n} nữa…": "+{n} more…",
  "Đang tải danh sách bài mẫu…": "Loading sample tracks…",
  "Chưa có bài mẫu cho thể loại này": "No sample track for this genre yet",
  "Thử các thể loại gần giống bên dưới nhé": "Try the similar genres below",
  "Bản nghe thử Spotify (chưa phát)": "Spotify preview (not played yet)",
  "Bản nghe thử 30s của Spotify (bài mẫu Every Noise chọn)": "Spotify 30s preview (the track Every Noise picked)",
  "Bản nghe thử 30s của Deezer (cùng bài hát, vì bản Spotify không tải được)": "Deezer 30s preview (same song, the Spotify one didn't load)",
  "Không tải được bản nghe thử": "Couldn't load the preview",
  "{d} (bản nghe thử)": "{d} (preview)",
  "Phổ tần số thật (Web Audio)": "Real frequency spectrum (Web Audio)",
  "Mô phỏng (máy chủ không cho đọc dữ liệu âm thanh)": "Simulated (the server doesn't allow reading the audio)",
  "⭐ Đã thêm vào yêu thích": "⭐ Added to favourites",
  "Đã bỏ khỏi yêu thích": "Removed from favourites",
  "🔗 Đã sao chép liên kết": "🔗 Link copied",
  "Hành trình này chưa có đủ bài 😢": "This journey doesn't have enough tracks 😢",
  "{e} Bắt đầu: {t}": "{e} Starting: {t}",
  "🎉 Xong hành trình “{t}”!": "🎉 Journey “{t}” complete!",
  "Đã dừng hành trình": "Journey stopped",
  "🧒 Đã bật chế độ trẻ em": "🧒 Kids mode on",
  "Đã tắt chế độ trẻ em": "Kids mode off",
  "⏸ bấm để dừng": "⏸ tap to pause",
  "▶ bấm để nghe": "▶ tap to listen",
  "Không tải được dữ liệu 😢": "Couldn't load the data 😢",
  "Hãy mở qua một web server (vd: <code>python3 -m http.server</code>).": "Open it through a web server (e.g. <code>python3 -m http.server</code>).",

  // ── js/player.js ──
  "“{g}” chưa có bài mẫu 😢": "“{g}” has no sample track yet 😢",
  "Không phát được bản nghe thử này. Thử mở trên Spotify nhé!": "Couldn't play this preview. Try opening it on Spotify!",
  "🔁 Lặp lại bài này": "🔁 Repeating this track",
  "Tắt lặp lại": "Repeat off",
  "Lặp lại: tắt (L)": "Repeat: off (L)",
  "Lặp lại thể loại này (L)": "Repeat this genre (L)",
  "🔁 Lặp lại thể loại này": "🔁 Repeating this genre",
  "Tự chuyển: tắt": "Auto-advance: off",
  "Tự chuyển sang thể loại gần giống": "Auto-advance to a similar genre",
  "Tự chuyển ngẫu nhiên": "Auto-advance to a random genre",
  "Thể loại: {g} · Everynoise": "Genre: {g} · Everynoise",

  // ── js/quiz.js ──
  "Kỷ lục chuỗi: {n}": "Best streak: {n}",
  "Không đủ thể loại để chơi với bộ lọc hiện tại": "Not enough genres to play with the current filters",
  "🎉 Chính xác!": "🎉 Correct!",
  "🌟 Giỏi quá!": "🌟 Great job!",
  "👏 Đúng rồi!": "👏 That's right!",
  "😅 Chưa đúng — đây là “{g}”": "😅 Not quite — this is “{g}”",
  "📍 Xem trên bản đồ": "📍 Show on the map",

  // ── js/tours.js ──
  "Vòng quanh thế giới": "Around the world",
  "Bay qua 25 nền âm nhạc từ Việt Nam tới Hawaii.": "Fly over 25 music cultures from Vietnam to Hawaii.",
  "Nhạc cho bé": "Music for little ones",
  "Bài hát thiếu nhi, ru ngủ và nhảy múa khắp thế giới.": "Children's songs, lullabies and dance tunes from around the world.",
  "Đoán nhạc cụ": "Guess the instrument",
  "Mỗi thể loại là một nhạc cụ: piano, đàn tranh, kèn túi…": "Each genre is an instrument: piano, zither, bagpipes…",
  "Cỗ máy thời gian": "Time machine",
  "Từ nhạc trung cổ tới hyperpop, theo dòng lịch sử.": "From medieval music to hyperpop, through history.",
  "Từ mộc đến điện tử": "From organic to electric",
  "Đi một đường thẳng trên bản đồ: từ nhạc mộc sang nhạc máy.": "A straight line across the map: from acoustic to machine music.",
  "Trôi ngẫu nhiên": "Random drift",
  "Bắt đầu ở một nơi bất kỳ rồi trôi sang hàng xóm gần nhất.": "Start anywhere and drift to the nearest neighbour.",
  // passport
  "Hộ chiếu âm nhạc": "Music passport",
  "🛂 Hộ chiếu âm nhạc": "🛂 Music passport",
  "Tấm thẻ tổng kết những thể loại bạn đã nghe, để lưu và khoe với bạn bè.": "A card summing up the genres you have heard, to save and show your friends.",
  "Bạn chưa nghe thể loại nào. Bấm một chấm trên bản đồ để nghe, rồi quay lại đây lấy hộ chiếu nhé!": "You haven't heard any genre yet. Tap a dot on the map to listen, then come back for your passport!",
  "📤 Chia sẻ": "📤 Share",
  "💾 Lưu ảnh": "💾 Save image",
  "Đã lưu ảnh": "Image saved",
  "HỘ CHIẾU ÂM NHẠC": "MUSIC PASSPORT",
  "Huyền thoại": "Legend",
  "Nhà du hành": "Traveller",
  "Thám hiểm": "Explorer",
  "Tập nghe": "Beginner",
  "1 quốc gia": "1 country",
  "1 yêu thích": "1 favourite",
  "{n} quốc gia": "{n} countries",
  "{n} yêu thích": "{n} favourites",
  "TOP 5 HỌ NHẠC": "TOP 5 FAMILIES",
  "HIẾM NHẤT": "RAREST",
  "ĐẦU TIÊN": "FIRST",
  "GẦN ĐÂY": "LATEST",
  // genre path
  "Đường đi âm nhạc": "Genre path",
  "🧭 Đường đi âm nhạc": "🧭 Genre path",
  "Chọn hai thể loại và xem chúng nối với nhau qua những thể loại nào.": "Pick two genres and see which genres connect them.",
  "🧭 Đi từ đây tới…": "🧭 Path from here…",
  "Từ": "From",
  "Tới": "To",
  "Đổi chiều": "Swap",
  "🎲 Ngẫu nhiên": "🎲 Random",
  "Chọn ngẫu nhiên hai thể loại xa nhau": "Pick two far-apart genres at random",
  "▶ Nghe hết đường đi": "▶ Play the whole path",
  "🔗 Chia sẻ": "🔗 Share",
  "Bắt đầu từ…": "Start from…",
  "Đi tới…": "Go to…",
  "Chọn thể loại…": "Pick a genre…",
  "Đang tìm đường…": "Finding the way…",
  "Chọn hai thể loại, hoặc bấm 🎲 để thử ngẫu nhiên.": "Pick two genres, or tap 🎲 for a random pair.",
  "Không tìm thấy đường đi giữa hai thể loại này 😢": "No path found between these two genres 😢",
  "Hai thể loại này là một!": "These are the same genre!",
  "{n} bước": "{n} steps",
  "Thể loại này không có trong chế độ hiện tại": "That genre is not available in the current mode",
  // world map
  "Nhạc khắp thế giới": "Music around the world",
  "🌍 Nhạc khắp thế giới": "🌍 Music around the world",
  "Bấm vào một quốc gia trên bản đồ để nghe nhạc của nơi đó.": "Tap a country on the map to hear its music.",
  "Bấm một quốc gia để nghe nhạc ở đó. Kéo hoặc véo hai ngón để phóng to.": "Tap a country to hear its music. Drag or pinch to zoom.",
  "Bấm một quốc gia để xem thể loại nhạc ở đó.": "Tap a country to see its genres.",
  "🔎 Tìm quốc gia": "🔎 Find a country",
  "Chưa có": "None",
  "Ít": "Few",
  "Nhiều": "Many",
  "Khu vực & nơi nhỏ": "Regions & small places",
  "Về toàn cảnh": "Reset view",
  "▶ Nghe tất cả": "▶ Play all",
  "{n} thể loại": "{n} genres",
  "{a}/{b} đã nghe": "{a}/{b} heard",
  "Chưa có thể loại nào ở đây.": "No genres here yet.",
  "Không tải được bản đồ 😢": "Could not load the map 😢",
  // more songs per genre
  "🎲 Bài khác": "🎲 Another song",
  "Các bài mẫu cùng thể loại": "More songs in this genre",
  "Phát bài {s} — {a}": "Play {s} — {a}",
};

export const LANGS = ["vi", "en"];
const pickLang = () => {
  const saved = store.get("nm:lang", null);
  if (LANGS.includes(saved)) return saved;
  return /^vi\b/i.test(navigator.language || "") ? "vi" : "en";
};
export let lang = pickLang();
export const locale = () => (lang === "vi" ? "vi-VN" : "en-US");
export const fmtN = (n) => n.toLocaleString(locale());

/** Translate a Vietnamese key; `{name}` placeholders are filled from `vars`. */
export function t(vi, vars) {
  let s = lang === "en" && EN[vi] != null ? EN[vi] : vi;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return s;
}
export const hasKey = (vi) => vi in EN;   // for the key-coverage check

// ── static DOM: remember every translatable text node / attribute once, then swap ──
const ATTRS = ["title", "aria-label", "placeholder"];
let slots = null;   // [{ node, attr|null, key, lead, trail }]
function collect() {
  slots = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest("script,style,[data-i18n-html]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n; (n = walker.nextNode());) {
    const raw = n.nodeValue, key = raw.trim();
    if (key && key in EN) slots.push({ node: n, attr: null, key, lead: raw.match(/^\s*/)[0], trail: raw.match(/\s*$/)[0] });
  }
  for (const elx of document.querySelectorAll("*")) {
    for (const a of ATTRS) { const v = elx.getAttribute(a); if (v && v in EN) slots.push({ node: elx, attr: a, key: v }); }
  }
  const meta = document.querySelector('meta[name="description"]');
  if (meta && meta.content in EN) slots.push({ node: meta, attr: "content", key: meta.content });
  for (const elx of document.querySelectorAll("[data-i18n-html]")) elx._vi = elx.innerHTML;
}
/** Apply the current language to index.html. Only touches values still showing a translation
 *  we set (or the original), so text that scripts replaced later is left alone. */
export function applyStatic() {
  if (!slots) collect();
  for (const s of slots) {
    const cur = s.attr ? s.node.getAttribute(s.attr) : s.node.nodeValue.trim();
    if (cur !== s.key && cur !== EN[s.key]) continue;
    const v = t(s.key);
    if (s.attr) s.node.setAttribute(s.attr, v); else s.node.nodeValue = s.lead + v + s.trail;
  }
  for (const elx of document.querySelectorAll("[data-i18n-html]")) {
    elx.innerHTML = lang === "en" ? EN["html:" + elx.dataset.i18nHtml] ?? elx._vi : elx._vi;
  }
  document.documentElement.lang = lang;
}

export function setLang(l) {
  if (!LANGS.includes(l) || l === lang) return;
  lang = l;
  store.set("nm:lang", l);
  applyStatic();
  dispatchEvent(new CustomEvent("langchange", { detail: l }));
}
