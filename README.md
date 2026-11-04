# Noisemap

Bản đồ tương tác của **gần 6.000 thể loại nhạc** dựa trên [Every Noise at Once](https://everynoise.com): bấm vào thể loại nào thì nghe ngay bài mẫu của thể loại đó, kèm credit tên bài và nghệ sĩ. Có tìm kiếm, bộ lọc, hành trình khám phá, trò chơi đoán thể loại và chế độ trẻ em.

**Bản chạy thật:** https://everynoise.pages.dev

## Every Noise at Once hoạt động thế nào?

- Đây là dự án của **Glenn McDonald**, lúc anh còn là "data alchemist" ở Spotify. Mỗi chữ trên bản đồ là một *micro-genre* mà Spotify tự rút ra từ việc nghệ sĩ nào hay được nghe cùng nhau và từ dữ liệu âm thanh.
- **Vị trí** lấy từ đặc trưng âm thanh trung bình của các bài trong genre:
  - trục dọc: dưới là mộc mạc (organic), trên là máy móc, điện tử
  - trục ngang: trái là dày, mờ ảo (atmospheric), phải là sắc, nảy (bouncy)
  - genre đứng gần nhau thường nghe giống nhau.
- **Màu** cũng trộn từ các chỉ số âm thanh. **Cỡ chữ** thể hiện độ phổ biến.
- Mỗi genre có **một bài mẫu** (bản nghe thử 30 giây của Spotify). Bấm vào genre là nghe.
- Site gốc là một trang HTML tĩnh rất dài (mỗi genre là một `<div>` đặt bằng toạ độ tuyệt đối) và ngừng cập nhật từ cuối 2023.

## Tính năng

**Bản đồ**
- Mở ra là thấy toàn cảnh. Zoom bằng cuộn chuột, trackpad, chụm hai ngón hoặc double-click. Kéo có quán tính, có minimap.
- Nhãn hiện dần theo mức zoom giống app bản đồ, không bao giờ đè lên nhau.
- Bản đồ tự xoay theo màn hình: ngang thì trục mộc → điện tử nằm ngang, dọc thì giữ hướng như site gốc.

**Player nổi ở dưới**
- Phát, dừng, bài trước/tiếp, tua, lặp lại một bài, chỉnh âm lượng và tốc độ (0.75×–1.5×).
- **Tự chuyển** (sau mỗi bài): *Gần* là trôi sang genre gần giống mà bạn chưa nghe, giống một đài radio lang thang trên bản đồ. *Ngẫu nhiên* là nhảy bất kỳ. Hoặc tắt.
- **Credit** bài đang phát: tên bài, nghệ sĩ, link nghe đầy đủ trên Spotify, YouTube, Apple Music, Deezer.
- **Chi tiết âm thanh**: nguồn phát, độ dài, Spotify track ID, phổ tần số thật (Web Audio).
- **Visualizer nảy theo beat** kiểu video NCS: cột đối xứng (bass ở giữa), bật lên tức thì rồi rơi dần, có vạch đỉnh. Mỗi dải tần tự cân mức nên nhạc dày, master to vẫn thấy nảy. Bắt tiếng kick ở dải 40–140 Hz, mỗi kick thì phát sáng và trên bản đồ toả ra một vòng sóng.
- Điều khiển được từ màn hình khoá và tai nghe (Media Session). Phím tắt: `Space` phát/dừng, `N` bài tiếp, `L` lặp, `←`/`→` tua 5 giây.

**Khám phá**
- Tìm kiếm có gợi ý, chấp nhận gõ sai ("shogaze" → shoegaze).
- Lọc theo 19 nhóm nhạc, quốc gia, local scene, mục yêu thích, "chưa nghe", và 2 thanh trượt theo trục âm thanh.
- Trang chi tiết mỗi genre: thể loại cha, nhánh con, genre nghe gần giống.
- 🧭 **Hành trình**: Vòng quanh thế giới, Nhạc cho bé, Đoán nhạc cụ, Cỗ máy thời gian, Từ mộc đến điện tử, Trôi ngẫu nhiên. Bản đồ bay theo từng bài.
- 🎯 **Đoán thể loại**: nghe 30 giây rồi chọn 1 trong 4 đáp án, có hai mức Dễ/Khó, tính điểm và chuỗi đúng liên tiếp.
- 🎧 Đếm số thể loại bạn đã nghe. Lưu yêu thích. Link chia sẻ được (`#g=shoegaze`).

**🧒 Chế độ trẻ em**
- Chữ và nút to hơn, ẩn bộ lọc nâng cao.
- Ẩn metal, hip hop/rap và các genre có tên gợi chủ đề người lớn.
- Bỏ qua bản Deezer có cờ explicit.
- Lưu ý: dữ liệu không có cờ "nội dung nhạy cảm" cho từng bản Spotify, nên đây chỉ là bộ lọc gần đúng.

**Thiết bị**: điện thoại (chi tiết hiện dạng bottom sheet), iPad (panel nổi trên bản đồ), desktop (3 cột), giao diện sáng/tối.

## Âm thanh

- Bài mẫu là bản nghe thử 30 giây của Spotify mà Every Noise đã chọn cho mỗi genre (`https://p.scdn.co/mp3-preview/<id>`).
- Nếu một bản không tải được, player tìm **đúng bài đó (cùng nghệ sĩ, cùng tên)** trên Deezer qua JSONP (không cần API key) và phát bản nghe thử 30 giây ở đó. Credit vẫn giữ nguyên.
- Nếu cả hai đều không được, player báo lỗi, đưa link nghe trên Spotify, và (khi bật tự chuyển) nhảy sang bài kế.

## Chạy

Không cần build, không có dependency:

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

## Deploy

Site chạy trên Cloudflare Pages, project `everynoise` → https://everynoise.pages.dev. Project này deploy tay, chưa nối với GitHub, nên push code mới sẽ không tự deploy.

Chỉ upload những file mà trang thật sự tải (`scripts/` và `data/raw/` chỉ dùng khi build dữ liệu). Script cũng gắn version mới cho service worker:

```bash
./scripts/deploy.sh
```

## Cài lên iPad / điện thoại (PWA)

1. Mở https://everynoise.pages.dev bằng **Safari**.
2. Bấm nút Chia sẻ, chọn **Thêm vào MH chính** (Add to Home Screen).
3. App **Noisemap** hiện trên màn hình chính, mở toàn màn hình, không có thanh địa chỉ.

- App đã cài có bộ nhớ riêng, tách khỏi Safari. Bật 🧒 Trẻ em **một lần trong app** thì lần sau app tự nhớ.
- Service worker (`sw.js`) cache giao diện và dữ liệu genre, nên app mở gần như ngay lập tức và bản đồ vẫn xem được khi mất mạng.
- **Nhạc không bị cache.** Mỗi bài vẫn tải lúc bấm nghe, nên phải có mạng mới nghe được.
- Sau mỗi lần deploy, app chạy bản cũ ở lần mở đầu tiên rồi lấy bản mới ở lần mở sau. Toàn bộ file đổi cùng một lúc, không bị lẫn bản cũ với bản mới.
- Khi chạy trên `localhost`, service worker không đăng ký, nên sửa code xong là thấy ngay.

## Dữ liệu

| File | Nội dung | Nguồn |
|---|---|---|
| `data/raw/genre_attrs.csv` | tên genre, toạ độ x/y, màu | scrape từ everynoise.com bởi [AyrtonB/EveryNoise-Watch](https://github.com/AyrtonB/EveryNoise-Watch) (CC-BY-SA 4.0) |
| `data/raw/previews.json` | genre → bản nghe thử, Spotify track ID, nghệ sĩ, tên bài | trích từ [jtbartee/everynoise-jukebox](https://github.com/jtbartee/everynoise-jukebox) (dữ liệu gốc của everynoise.com) |

`python3 scripts/build_data.py` tạo ra:

- `data/genres.json`: vị trí, màu và các trường suy luận.
  - `f`: nhóm nhạc
  - `co`: quốc gia
  - `s`: local scene
  - `p` / `k`: thể loại cha và số nhánh con
  - `kid`: có qua bộ lọc trẻ em không
  - `ap`: vị trí ước tính

  Có 533 genre chỉ xuất hiện trong danh sách bài mẫu mà không có toạ độ. Script đặt chúng cạnh genre cha và đánh dấu "vị trí ước tính".
- `data/tracks.json`: bài mẫu, xếp cùng thứ tự với `genres.json`. Trang tải file này sau khi bản đồ đã hiện.

Nhóm nhạc, quốc gia và cờ trẻ em được đoán từ tên genre nên có chỗ chưa đúng. Sửa từ điển trong script rồi chạy lại.

## Cấu trúc

```
index.html
manifest.webmanifest  PWA: tên, icon, chế độ toàn màn hình
sw.js                cache giao diện + dữ liệu (không cache nhạc)
icons/               icon app (icon.svg là bản gốc)
css/style.css        giao diện, theme sáng/tối, responsive, chế độ trẻ em
js/main.js           nối mọi thứ: tìm kiếm, bộ lọc, panel chi tiết, phím tắt, URL
js/map.js            renderer canvas 2 lớp, nhãn theo mức zoom, cache sprite, cử chỉ
js/player.js         player: Spotify preview → Deezer fallback, visualizer, Media Session
js/tours.js          các hành trình
js/quiz.js           trò đoán thể loại
js/beat.js           phân tích nhạc: cột nảy (auto gain theo dải) + bắt kick cho mọi visualizer
js/data.js           tải dữ liệu, láng giềng gần nhất
scripts/build_data.py
scripts/deploy.sh    build dist/ + deploy Cloudflare Pages
```

Hiệu năng bản đồ:
- Lớp nền (chấm + nhãn) chỉ vẽ lại khi bản đồ di chuyển.
- Hiệu ứng "đang phát" và vòng chọn nằm ở lớp riêng.
- Bộ nhãn cho mỗi mức zoom được tính sẵn khi trình duyệt rảnh.
- Mỗi nhãn được cache thành ảnh nhỏ, nên kéo bản đồ chỉ mất khoảng 1ms mỗi frame.

Dữ liệu genre © Glenn McDonald / everynoise.com. Âm thanh thuộc về nghệ sĩ và các nền tảng phát hành. Noisemap chỉ phát bản nghe thử công khai và luôn ghi credit.
