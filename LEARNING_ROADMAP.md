# Các đợt mở rộng thư viện học tập

Nhóm ưu tiên: người học và người đọc. Luồng chính: URL → xem mẫu → bộ sưu tập → lưu → đọc/ghi chú/học → xuất. Nhánh triển khai: `codex/learning-library`, dựa trên `origin/main` tại `3f1a30c`.

| Đợt | Issue | Phần triển khai |
| --- | --- | --- |
| 1. Củng cố lõi | [#7](https://github.com/vankhoa-gubit/CaoCao-Tool/issues/7) | Chỉ mục loại trùng/bảng/so sánh trên đĩa; checksum trang; hàng đợi tệp; phục hồi; retry/backoff; giới hạn response |
| 2. Thư viện và đọc | [#8](https://github.com/vankhoa-gubit/CaoCao-Tool/issues/8) | Bài đơn/danh sách/PDF; bộ sưu tập, thẻ, ghi chú, tìm kiếm; đọc trên máy; Việt/Anh |
| 3. Câu hỏi và xuất | [#9](https://github.com/vankhoa-gubit/CaoCao-Tool/issues/9) | Nhận diện câu hỏi/nhập job; mẫu ánh xạ trường; thẻ học và bàn phím; HTML/Markdown/CSV/PDF |
| 4. Kiểm chứng và khởi động | [#10](https://github.com/vankhoa-gubit/CaoCao-Tool/issues/10) | Hồi quy API/Chromium; ngắt tiến trình; benchmark 100 nghìn/1 triệu ID; ảnh responsive; launcher; tài liệu |

## Gate trước push

- Suite hồi quy và suite thư viện qua HTTP/Chromium thực tế.
- Kiểm thử kill tiến trình giữa trang và checkpoint, sau giao dịch thư viện; chạy tiếp giữ đủ ID/cursor.
- Kiểm tra tệp lỗi, tải lại riêng, Range/ETag và file PDF xuất từ ứng dụng.
- UI Việt/Anh tại 1440×900, 768×1024, 390×844; giữ ghi chú/focus khi đổi ngôn ngữ.
- Benchmark bằng `npm run benchmark:learning`, nguồn HTTP cục bộ, tiến trình đo riêng cho 100.000 và 1.000.000 bản ghi.
- Kiểm tra diff và chỉ push sau khi hoàn thành các gate.

Fixture, cơ sở dữ liệu, log, ảnh và số đo nằm trong `.qa/`, không đưa vào Git. `data/` không được dùng để seed hoặc kiểm thử. Các bằng chứng cuối cùng được ghi trong [QA_REPORT.md](QA_REPORT.md); checklist GitHub được cập nhật theo những kiểm tra thực sự đã chạy.

## Phạm vi bản này

Thư viện cá nhân chạy trên máy; PDF được lưu và mở bằng tệp gốc. Chưa có OCR/tìm chữ trong PDF, đồng bộ đám mây, installer chứa sẵn Node hoặc nghiên cứu với người dùng thật. Độ chính xác cào website bên ngoài cần kiểm chứng trên từng nguồn cụ thể.
