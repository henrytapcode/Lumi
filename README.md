# Ben — Web xem phim miễn phí

Nền tảng xem phim trực tuyến xây dựng bằng **Vanilla JS + CSS thuần** (không framework),
kết nối tới API `phim.nguonc.com`.

## Cấu trúc

```
web/
├── index.html   — HTML SPA (tất cả pages)
├── styles.css   — CSS variables, dark/light theme, responsive
├── app.js       — Logic: Cache, API, Auth, Router, Home/List/Detail/Watch
└── README.md
```

## Tính năng

### Giao diện
- ✅ **Dark / Light mode** — toggle mượt mà, lưu vào localStorage
- ✅ **Hero banner** xoay phim tự động (6s), click chấm để chuyển
- ✅ **Skeleton loading** — shimmer animation khi chờ API
- ✅ **Responsive** — mobile (hamburger nav), tablet, desktop
- ✅ **Smooth transitions** — card hover, modal slide, toast

### Tìm kiếm & lọc
- ✅ **Tìm kiếm real-time** với debounce 350ms, dropdown gợi ý ngay lập tức
- ✅ **Lọc theo thể loại** — 19+ thể loại với slug API chuẩn
- ✅ **Lọc theo quốc gia** — 17+ quốc gia
- ✅ **Lọc theo năm sản xuất** — 2010 đến hiện tại
- ✅ **Lọc theo ngôn ngữ** — Vietsub / Thuyết minh / Lồng tiếng
- ✅ **Tab loại phim** — Mới cập nhật / Phim lẻ / Phim bộ / TV Shows

### API endpoints sử dụng
| Mục đích | Endpoint |
|---|---|
| Mới cập nhật | `GET /films/phim-moi-cap-nhat?page={n}` |
| Danh sách loại | `GET /films/danh-sach/{slug}?page={n}` |
| Chi tiết phim | `GET /film/{slug}` |
| Theo thể loại | `GET /films/the-loai/{slug}?page={n}` |
| Theo quốc gia | `GET /films/quoc-gia/{slug}?page={n}` |
| Theo năm | `GET /films/nam-phat-hanh/{year}?page={n}` |
| Theo ngôn ngữ | `GET /films/ngon-ngu/{slug}?page={n}` |
| Tìm kiếm | `GET /films/search?keyword={kw}&page={n}` |

### Cache & hiệu năng
- **TTL cache**: list = 5 phút · detail = 15 phút · search = 2 phút
- **localStorage persistence** — cache sống sót qua reload
- **Promise.allSettled** — một row lỗi không ảnh hưởng rows khác
- **Timeout 10s + retry 2 lần** với backoff 800ms
- Debounce tìm kiếm 350ms

### Tài khoản
- ✅ **Đăng ký / Đăng nhập** (mock localStorage)
- ✅ **Đăng nhập Google** (stub)
- ✅ **Phim yêu thích** — lưu/xoá, xem danh sách
- ✅ **User dropdown menu** sau khi đăng nhập

### Xem phim
- ✅ **Player embed** toàn màn hình trong iframe
- ✅ **Danh sách tập** — lướt, chọn tập, chuyển server
- ✅ **Multi-server** — chuyển đổi nguồn dễ dàng

## Chạy ứng dụng

Mở bằng **Live Server** trong VS Code (`Go Live`) hoặc bất kỳ HTTP server nào.
*Không cần build, không cần Node.js.*

## Ghi chú kỹ thuật

- **Không dùng CORS proxy** vì API đã hỗ trợ CORS
- Slug phim được lưu trong từng item → dùng để gọi chi tiết, không phụ thuộc vị trí
- Xử lý lỗi hình ảnh bằng `onerror` fallback SVG
