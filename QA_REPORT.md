# Kết quả kiểm tra Cào Cào

Ngày kiểm tra: **07/10/2026**, múi giờ Asia/Bangkok.

## Kết quả

**PASS: 51/51 ca trên bản 1.1.2**, gồm 31 ca nền, 15 ca dữ liệu tải trì hoãn và 5 ca nhập file dữ liệu đã lưu. Không có FAIL, CANCELLED, SKIPPED trong lượt cuối.

Lệnh: `node --test --test-concurrency=1 test/*.test.mjs`. Thời gian: **157,1 giây**. Các lượt trước bị gián đoạn khi Windows vào Modern Standby; lượt cuối chạy đầy đủ và không thay đổi timeout hoặc bỏ ca.

Môi trường: Windows, Node.js **v24.21.0**, Playwright **1.63.0**, trình duyệt Chromium được mở từ bản Chrome/Edge trên máy. Dữ liệu kiểm tra nằm riêng trong `.qa/`; server sử dụng thực tế lưu trong `data/`.

| Nhóm kiểm tra | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Nhập URL qua giao diện → nhận diện → tải từng cụm | PASS | Trang mẫu cuộn: tự suy ra `batch` + `page`; 6 request, 18 ID duy nhất, 18 file; xuất JSON qua HTTP đúng 18 bản ghi |
| Phân trang HTML | PASS | Trình duyệt tự theo nút tiếp, lấy 18 bản ghi qua 4 trang |
| Cuộn và bắt response qua trình duyệt | PASS | Chạy với source đã quan sát, không replay API; lấy đủ 18 ID qua nhiều cụm |
| Tạm dừng/chạy tiếp | PASS | API khôi phục từ manager mới; không mất/trùng bản ghi. Browser mở lại, bỏ phần đã lưu rồi thu bản ghi mới |
| Giới hạn mỗi lượt | PASS | Trạng thái `limited`, có thể tiếp tục đến cuối; không báo hoàn thành khi chạm giới hạn |
| Page, offset, cursor POST, URL tiếp theo | PASS | HTTP server thực; bảo toàn bộ lọc trong payload và URL tương đối |
| Trang trong cụm | PASS | Chỉ chuyển cụm sau trang cuối. Có cả trang bắt đầu 0 và cụm đầu không có token |
| Loại trùng, phát hiện vòng lặp | PASS | ID trùng được lọc; cursor lặp và 3 trang giống nhau liên tiếp báo lỗi |
| HTTP 429 | PASS | Thử lại theo thời gian chờ rồi hoàn tất |
| Response/đường dẫn sai | PASS | Tác vụ báo lỗi, giữ phần đã lưu, không báo hoàn thành giả |
| Khôi phục checkpoint cũ | PASS | Trang đã ghi hoàn chỉnh được đọc lại để phục hồi vị trí kế tiếp |
| JSON / JSONL / CSV | PASS | Parse JSON/JSONL; CSV UTF-8 BOM, hợp nhất cột, escape nháy và chuỗi công thức |
| cURL / HAR / payload | PASS | Bash và Windows cmd; giữ nội dung shell dưới dạng chuỗi; chọn đúng request HAR |
| Danh sách DOM dài | PASS | Thu đủ 600 bản ghi trên một trang; không cắt ở 500 |
| Trang bị chặn | PASS | Trang mẫu HTTP 403 báo `blocked`, từ chối tạo tác vụ tự động |
| Host / Origin | PASS | Từ chối Origin bên ngoài và Host giả; kiểm tra Host bằng request HTTP nguyên bản |
| Giao diện | PASS | Không có lỗi JavaScript; không tràn ngang và nút không vượt màn hình tại 320, 375, 414, 768 px |
| URL flashcard tải trì hoãn | PASS | Trang mô phỏng 370 câu, ban đầu 30, request mới chỉ xuất hiện sau 28 lần Next; tự chọn GET offset, xuất đủ 370 ID qua 13 cụm, cụm cuối 10 câu |
| Browser qua nhiều lần Next | PASS | 370 câu qua 13 cụm, hơn 300 thao tác Next; ID phiên học khác lượt quét vẫn được liên kết qua response khởi tạo |
| Kích thước cụm không cố định | PASS | 379 câu, có cụm 15 câu và bản ghi giao nhau; request đi offset 0 → 30 → 45 theo `nextOffset`; xuất đủ 379 ID duy nhất |
| Nhận diện phiên đang ở giữa danh sách | PASS | Bootstrap offset 30 và GET offset 60 vẫn tải từ 0 đến đủ 379 câu; GET offset 90 không có bootstrap cũng bắt đầu 0. Cấu hình thủ công giữ offset đã nhập |
| Tải bù phần đầu cho tác vụ cũ | PASS | Tác vụ 319/379 bắt đầu offset 60 chỉ request offset 0 và 30; file cũ giữ nguyên. Giới hạn một request rồi mở manager mới vẫn tiếp tục từ offset 30 |
| Giới hạn cụm và khôi phục browser | PASS | Giới hạn 2 cụm lưu 60/95; mở manager mới rồi chạy tiếp đủ 95 câu, không trùng |
| Chọn nguồn đúng | PASS | HTTP/2 pseudoheaders không làm cấu hình null; ưu tiên API GET phân trang; không replay POST tạo phiên để xác nhận API; tự chuyển nguồn bootstrap sang GET khi quan sát được |
| Metadata theo danh sách | PASS | `totalQuestions`, `hasMore`, `nextOffset` lấy từ metadata của mảng đã chọn; không lấy cờ hết dữ liệu từ danh sách phụ |
| Thiếu dữ liệu | PASS | Next không đổi nội dung hoặc API kết thúc sớm ở 30/379 báo `incomplete`; giữ dữ liệu, cho chạy tiếp, xuất đủ sau khi nguồn tải tiếp |
| Kiểm tra tác vụ cũ | PASS | Đọc metadata từ file đã lưu để sửa trạng thái hoàn tất thiếu; nội dung file trang được giữ nguyên |
| File dữ liệu đã lưu | PASS | Nhận diện archive 30/379 câu, `questionId`, `nextOffset: 30` từ response lồng; xử lý archive thiếu method/headers hoặc URL trang, không biến archive thành payload request |
| UI nhập file TXT | PASS | Chọn file archive TXT → lấy URL trang nguồn → quét tự động → chọn API; xem tổng 30/379 trong mẫu, giữ nguyên cấu hình request nâng cao |

## Website bên ngoài dự án

Đã chạy `node scripts/live-smoke.mjs` với [Books to Scrape](https://books.toscrape.com/), website mẫu công khai dành cho thử nghiệm cào dữ liệu.

- Thời điểm: **16:41 ngày 07/10/2026** theo Asia/Bangkok.
- Tool tự nhận diện nội dung HTML và nút `next`; chọn chế độ trình duyệt.
- Giới hạn **2 lượt**: lưu **40 bản ghi**, **40 URL duy nhất**, mỗi bản ghi có tiêu đề và đường dẫn ảnh.
- Trạng thái cuối: **limited**, không có lỗi. Không kiểm tra toàn bộ website.
- Không bật tải ảnh trong ca này; chỉ kiểm tra đường dẫn ảnh có trong bản ghi.
- Bằng chứng: [live-result.json](.qa/live-result.json) và file JSON theo đường dẫn bên trong.

### MentorQuiz của người dùng

Nguồn: [Quiz 18, chế độ flashcard](https://mentorquiz.me/study/18/learn?mode=flashcard&returnUrl=%2Fmy-quizzes).

- Phiên đăng nhập mới đã được lưu. Kiểm tra trực tiếp xác nhận nguồn khai báo **379 câu**, `batchSize: 30`, `initialFlashcards.hasMore: true`, `nextOffset: 30` và khóa `questionId`.
- Tự tìm thấy GET `/api/study-sessions/227/flashcards` bên cạnh POST khởi tạo phiên, nhận diện `offset`, tải thử thành công và chọn API. Lỗi pseudoheaders HTTP/2 làm cấu hình API null đã được tái hiện và sửa.
- **PASS trên nguồn thật lúc 19:31 ngày 07/10/2026 (Asia/Bangkok): 379/379 câu qua 13 cụm, 379 ID duy nhất, đủ vị trí 1–379, không lỗi.** Giữ cấu trúc lựa chọn và đáp án. Đối chiếu cả 30 câu trong file người dùng gửi: `content`, `options`, `back` khớp với dữ liệu tải về.
- Tác vụ thật: `muy36blv-75938e20`. JSON đã xuất ở `data/jobs/muy36blv-75938e20/exports/data.json`; bằng chứng kiểm tra: `.qa/mentor-live-result.json`.
- File người dùng gửi là archive có `items` và `response.captures`, thiếu method/headers. Đã chạy parser mới trên đúng file: nhận diện 30/379, khóa `questionId`, `hasMore: true`, offset 0, `nextOffset: 30`, cỡ cụm 30. Bằng chứng: `.qa/user-sample-result.json`.
- Bản đang chạy **1.1.2** tại địa chỉ đang dùng [http://127.0.0.1:4317/](http://127.0.0.1:4317/). `/api/health` xác nhận phiên bản và các tính năng `deferred-batches`, `archive-import`, `offset-origin`, `prefix-recovery`. Dữ liệu và phiên đăng nhập được giữ.
- Khi khởi động bản sửa, tác vụ `muxy2akm-bb425303` được đổi từ `completed` thành `incomplete`, hiển thị **30/379**. Tác vụ còn lại giữ **15/15** và `completed`. Hash SHA-256 của cả hai file trang khớp trước/sau: dữ liệu cũ không bị sửa. Bằng chứng: `.qa/runtime-result.json`.

#### Sửa lượt tải thiếu 319/379

- Tác vụ `muy3nlkl-e059a81b` nhận diện GET tại `offset=60`, trong khi cụm bootstrap cũng đã ở `offset=30`. Cấu hình cũ dùng offset quan sát làm điểm bắt đầu, nên chỉ lưu vị trí 61–379: **319 câu qua 11 request**.
- Hai lần Chạy tiếp cũ lặp lại cùng 319 câu: **638 bản ghi trùng**, tổng **33 request/cụm**, vẫn thiếu vị trí 1–60.
- Bản 1.1.2 đặt điểm bắt đầu tự nhận diện offset về 0. Với tác vụ cũ đã cạn nguồn và bắt đầu giữa danh sách, Chạy tiếp tải bù phần đầu, giữ khóa loại trùng và lịch sử request. Điểm tải bù cũng được lưu để tiếp tục sau giới hạn hoặc khởi động lại.
- **PASS trên đúng tác vụ bị lỗi lúc 19:58 ngày 07/10/2026 (Asia/Bangkok): 379/379, completed, không lỗi.** Chỉ thêm hai request ở offset **0 và 30**, thêm **60 câu** vào hai file trang mới. Tổng request/cụm tăng **33 → 35**; thống kê trùng lịch sử vẫn là **638**, lượt tải bù không có bản ghi trùng mới.
- File JSON xuất qua HTTP có **379 ID duy nhất**, đủ mọi vị trí **1–379**. Hash SHA-256 của toàn bộ **33 file trang cũ** khớp trước/sau. Bằng chứng: `.qa/prefix-repair-before.json`, `.qa/prefix-repair-result.json`; script xác minh: `.qa/verify-prefix-repair.mjs`.
- JSON của chính tác vụ đã sửa: `data/jobs/muy3nlkl-e059a81b/exports/data.json`.

## Kiểm tra hình ảnh

Đã xem trực tiếp ảnh chụp desktop và mobile 320 px. Kiểm tra kích thước tự động bao phủ **1440×1000**, **320×900**, **375×900**, **414×900**, **768×900**. Ảnh nằm ở `.qa/screenshots/`:

- `desktop-empty.png`: màn hình nhập URL ban đầu.
- `desktop-completed.png`: nhận diện và tải xong nguồn mẫu.
- `mobile-320.png`, `mobile-375.png`, `mobile-414.png`, `mobile-768.png`: giao diện có báo cáo và lượt tải đã lưu.
- Bản sửa: đã xem ảnh desktop **1365×900** và mobile **320×900** hiển thị tiến độ 370/370. Không tràn ngang ở 320 px; ảnh nằm trong `.qa/deferred-bZ1ciw/ui-370-complete.png` và `ui-370-mobile.png`.

## Phạm vi chưa chứng minh

- Kết quả MentorQuiz chứng minh lượt tải đủ và lượt tải bù 60 câu còn thiếu trên quiz 18. Chưa kiểm tra các quiz khác, bộ lọc khác hoặc thay đổi cấu trúc API trong tương lai.
- Chưa kiểm tra đăng nhập SSO/MFA của website bên ngoài hoặc phiên hết hạn trong một lượt dài.
- Không có cơ chế vượt CAPTCHA; website chống tự động có thể từ chối.
- Nhận diện nguồn và DOM là heuristic. Iframe, WebSocket, menu phức tạp và API riêng có thể cần chọn lại nguồn hoặc dùng cấu hình nâng cao.
- Dừng browser dựa trên cả dữ liệu mới và thay đổi nội dung sau Next. Khi tổng/cờ còn dữ liệu đã biết, thiếu dữ liệu được báo `incomplete`. Khi nguồn không khai báo tổng hoặc cờ kết thúc, điều kiện không tiến triển vẫn không bảo đảm mọi dữ liệu ẩn hoặc tải chậm đã được lấy.
- Có thể tải file/ảnh bằng URL đã nhận diện. Chưa kiểm tra video streaming, URL blob hoặc file yêu cầu xác thực ở một host khác.

CodeGraph đã được khởi tạo bằng `codegraph init -i`; công cụ trạng thái xác nhận chỉ mục hoạt động và không liệt kê file đang chờ đồng bộ tại lần kiểm tra.
