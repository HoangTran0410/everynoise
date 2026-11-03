# Noisemap

Bản đồ tương tác của **5.453 thể loại nhạc** lấy từ [Every Noise at Once](https://everynoise.com), làm lại với giao diện mới, có tìm kiếm và bộ lọc.

## Every Noise at Once hoạt động thế nào?

- Đây là dự án của **Glenn McDonald**, lúc anh còn là "data alchemist" ở Spotify (trước đó là The Echo Nest). Mỗi chữ trên bản đồ là một *micro-genre* mà hệ thống Spotify tự rút ra từ việc nghệ sĩ nào hay được nghe cùng nhau, kết hợp với dữ liệu âm thanh.
- **Vị trí**: mỗi genre được đặt theo đặc trưng âm thanh trung bình của các bài hát trong genre đó (Echo Nest/Spotify phân tích audio). Trên site gốc:
  - trục dọc: **dưới = mộc mạc (organic)**, **trên = máy móc, điện tử (mechanical/electric)**
  - trục ngang: **trái = dày, mờ ảo (dense/atmospheric)**, **phải = sắc, nảy (spikier/bouncier)**
  - genre ở gần nhau thì thường nghe giống nhau.
- **Màu**: cũng trộn từ các chỉ số âm thanh (mỗi kênh R/G/B ứng với một chỉ số), nên vùng nào cùng tông màu thì cũng cùng "chất" âm thanh.
- **Cỡ chữ** trên site gốc ứng với độ phổ biến; bấm vào genre thì phát một đoạn nhạc mẫu, và mỗi genre có trang riêng với bản đồ nghệ sĩ và playlist "The Sound of …".
- Site gốc là HTML tĩnh rất lớn (một `<div>` cho mỗi genre, đặt bằng `top/left` tuyệt đối) và ngừng cập nhật từ cuối 2023, khi Glenn rời Spotify.

## Noisemap có gì mới

| | everynoise.com | Noisemap |
|---|---|---|
| Duyệt bản đồ | cuộn trang rất dài | canvas zoom/kéo mượt (chuột, trackpad, pinch trên điện thoại), minimap |
| Tìm kiếm | Ctrl+F của trình duyệt | gợi ý tức thì, chấp nhận gõ sai ("shogaze" → shoegaze), tìm cả theo quốc gia/nhóm |
| Bộ lọc | không có | 19 nhóm nhạc, quốc gia/khu vực, local scene, yêu thích, **thanh trượt theo 2 trục âm thanh** |
| Chi tiết genre | trang riêng | panel: thể loại cha, nhánh con, 10 genre "nghe gần giống", link Spotify/YouTube/Wikipedia |
| Khác | — | sáng/tối, đường link chia sẻ được (`#g=shoegaze`), phím tắt, dùng tốt trên mobile |

Bản đồ tự xoay theo màn hình: màn ngang thì trục organic → electric nằm ngang, màn dọc thì giữ hướng như site gốc.

Phím tắt: `/` tìm kiếm · `R` ngẫu nhiên · `F` xem toàn bộ (hoặc zoom vừa kết quả lọc) · `+`/`−` zoom · `Esc` đóng.

## Chạy

Không cần build, không có dependency:

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

Deploy được thẳng lên GitHub Pages / Netlify / Vercel (static).

## Dữ liệu

- `data/raw/genre_attrs.csv`: tên genre, toạ độ x/y và màu, scrape từ everynoise.com bởi [AyrtonB/EveryNoise-Watch](https://github.com/AyrtonB/EveryNoise-Watch) (CC-BY-SA 4.0).
- `scripts/build_data.py` tạo ra `data/genres.json` và thêm các trường suy luận:
  - `f`: nhóm nhạc, đoán từ từ khoá trong tên genre
  - `co`: quốc gia, đoán từ tính từ quốc tịch/tên thành phố (vd: "vietnamese", "viet", "aarhus")
  - `s`: "local scene" tự phát hiện (vd: "dalarna indie")
  - `p` / `k`: thể loại cha (tên ngắn hơn nằm trọn trong tên này) và số nhánh con

  Các trường này đoán từ tên nên có chỗ chưa đúng. Sửa từ điển trong script rồi chạy lại `python3 scripts/build_data.py`.

Vì dữ liệu gốc không có file nhạc mẫu, nút "Nghe" mở playlist "The Sound of …" trên Spotify hoặc tìm trên YouTube.

## Cấu trúc

```
index.html          giao diện
css/style.css       giao diện, theme sáng/tối, responsive
js/app.js           renderer canvas, tìm kiếm, bộ lọc, panel chi tiết
data/genres.json    dữ liệu đã xử lý (~600 KB, gzip ~120 KB)
scripts/build_data.py
```

Dữ liệu genre © Glenn McDonald / everynoise.com, phân phối lại theo CC-BY-SA 4.0.
