# Kết quả kiểm tra Cào Cào

## Tối ưu lõi 1.2.0 (08/10/2026, Asia/Bangkok)

Issue: [#3](https://github.com/vankhoa-gubit/CaoCao-Tool/issues/3). Nhánh: `codex/issue-3-core-optimizations`, dựa trên bản Việt/Anh `c4e08c9`.

**PASS: 78/78 ca** qua `npm test`: 63 ca trước đó và 15 ca tối ưu mới. Lượt cuối hoàn tất trong **101,3 giây**, không có FAIL, CANCELLED hoặc SKIPPED. Log: `.qa/optimization-full-test-final.log`. `git diff --check` không có lỗi whitespace.

| Nhóm | Kết quả và bằng chứng |
| --- | --- |
| Điều phối | 8 yêu cầu tạo đồng thời chỉ nhận 2; chạy tiếp/direct start cùng dùng admission. HTTP tạo và chạy tiếp trả 409 + `{code, params}` khi hết chỗ. Pause, lỗi cấu hình, lỗi request, lỗi ghi checkpoint và hoàn tất đều trả chỗ |
| Đóng server | Đợi tác vụ tạo đang chờ, từ chối bắt đầu mới; không rò slot hoặc pending promise |
| Lịch sử | 37 tác vụ qua 3 trang 15/15/7; tìm tên/mã, lọc trạng thái, trang vượt cuối, query sai. API phân trang không chứa logs/samples/outputPath; chi tiết và endpoint cũ vẫn hoạt động |
| UI lịch sử | Truy cập lượt cũ ngoài 15 đầu tiên, chọn chi tiết, lọc kết hợp và thông báo không có kết quả; giữ dữ liệu/focus/ngôn ngữ. Response tìm kiếm cũ bị trì hoãn không ghi đè bộ lọc mới |
| Cập nhật UI | Clock Playwright xác nhận nhịp 15 giây khi rảnh, không tải lại chi tiết không đổi; sự kiện visibility mô phỏng xác nhận 60 giây khi ẩn và lấy snapshot khi hiện lại. Luồng tải/quét/chạy tiếp vẫn được kiểm tra với server cục bộ thật |
| Khôi phục | Metadata hợp lệ không giữ khóa loại trùng; chạy tiếp dựng khóa, xuất đủ ID và giải phóng khóa. Checkpoint bị chỉnh sửa, JSON hỏng, bị thiếu, legacy, cũ hoặc cấu hình đổi đều đọc lại file trang. Mất file giữa chuỗi báo lỗi, từ chối resume, không ghi đè file còn lại |
| Việt/Anh | Thông báo mới phát mã explicit; bounds dùng descriptor lồng cho label. Dịch không phụ thuộc câu tiếng Việt; literal parameters và bản ghi nguồn giữ nguyên. Nhật ký/checkpoint cũ vẫn dịch được |
| Responsive | Cả Việt/Anh tại 320, 375, 414, 768, 1440 px không tràn ngang hoặc vượt màn hình; không có pageerror. Đã xem ảnh English 320 px và 1440 px trong `.qa/history-ui-EUVm4I/` |

### Benchmark khởi động

Chạy `npm run benchmark:startup` trên Node.js **v24.21.0**. Mỗi dataset gồm 20 tác vụ; 10.000 bản ghi có 40 file trang, 100.000 bản ghi có 400 file trang. So sánh đúng `JobManager.init/Job.restore` cũ lấy từ Git tại `c4e08c9` với mã mới, trên cùng dữ liệu. Mỗi chế độ đo 3 lần trong tiến trình Node riêng với `--expose-gc`, lấy trung vị. Các lượt đo cuối chạy sau khi suite đã kết thúc.

| Bản ghi | Cũ: đọc trang và dựng khóa | Mới: metadata hợp lệ | Mới: đọc lại trang để khôi phục |
| --- | --- | --- | --- |
| 10.000 | 63,32 ms; heap giữ lại 1,07 MB | 30,07 ms; heap giữ lại 0,15 MB | 80,22 ms; heap giữ lại 0,22 MB |
| 100.000 | 447,58 ms; heap giữ lại 10,99 MB | 31,87 ms; heap giữ lại 0,14 MB | 488,56 ms; heap giữ lại 0,25 MB |

- Với 100.000 bản ghi, khởi động qua metadata nhanh khoảng **14 lần** trong fixture này. RSS trung vị: **172,46 MB → 117,43 MB**. Heap giữ lại là phần tăng sau khi dựng lịch sử, không phải toàn bộ RAM của chương trình.
- Danh sách JSON của 20 tác vụ là **23.304 byte**; kết quả phân trang 15 tác vụ là **5.806 byte**, giảm khoảng **75%**. Chi tiết một tác vụ là **1.166 byte**, chỉ tải khi chọn hoặc metadata đổi. Đây là số byte serialization trong benchmark, chưa gồm headers HTTP và trường `activity`.
- Xuất JSON được kiểm tra đủ **10.000/100.000 ID**, không thiếu/trùng. Hash của toàn bộ **40/400 file trang** khớp trước/sau. Dữ liệu trong `data/` không dùng để benchmark hoặc kiểm thử.
- Bằng chứng: `.qa/startup-benchmark-fPfysk/result.json`, `.qa/optimization-benchmark-isolated.log`. Script có trong `scripts/benchmark-startup.mjs`.

Cache file của hệ điều hành không được xóa; các số đo không chứng minh thời gian đọc đĩa sau khi máy vừa bật. Checksum xác minh metadata checkpoint và dấu cấu hình; nhánh khởi động nhanh không tính lại hash nội dung mọi file trang. Checkpoint cần khôi phục vẫn phải đọc dữ liệu cũ một lần; khóa loại trùng được đọc/dựng trước khi chạy tiếp. Lượt này kiểm tra nguồn cục bộ và dữ liệu QA, chưa chạy lại website ngoài dự án.

## Ngôn ngữ giao diện (08/10/2026, Asia/Bangkok)

Issue: [#2](https://github.com/vankhoa-gubit/CaoCao-Tool/issues/2). Nhánh: `codex/issue-2-english-language`.

**PASS: 63/63 ca** qua `npm test`, gồm 51 ca hiện có và 12 ca Việt/Anh mới. Lượt cuối hoàn tất trong **109,3 giây**, không có FAIL, CANCELLED hoặc SKIPPED. Log: `.qa/english-language-test.log`.

| Kiểm tra Việt/Anh | Kết quả | Bằng chứng |
| --- | --- | --- |
| Nút ngôn ngữ và bàn phím | PASS | Enter chuyển Việt → Anh; cập nhật `html.lang`, tiêu đề, nhãn hỗ trợ đọc màn hình và trạng thái nút; giữ focus |
| Lưu lựa chọn | PASS | Reload giữ English; giá trị lưu không được hỗ trợ dùng tiếng Việt; nút vẫn hoạt động khi localStorage bị chặn |
| Đồng bộ các tab | PASS | Đổi ngôn ngữ ở tab khác cập nhật tab hiện tại và giữ cấu hình đang nhập |
| Chuyển khi đang quét/tạo tác vụ | PASS | Giữ URL và trạng thái khóa nút; chỉ tạo một lượt quét và một yêu cầu tạo tác vụ |
| Báo cáo và lựa chọn nguồn | PASS | Nhãn, báo cáo nhận diện và mẫu chuyển theo ngôn ngữ; giữ nguồn DOM, chiến lược, giới hạn và checkbox tải file |
| Tải dữ liệu bằng giao diện tiếng Anh | PASS | Nhận diện nguồn mẫu, đạt giới hạn, chạy tiếp tới Completed; xuất JSON đủ 18 bản ghi và 18 ID duy nhất |
| Trạng thái, nhật ký và lỗi | PASS | Trạng thái giới hạn/chạy tiếp/hoàn tất và nhật ký cập nhật ngay; dịch lỗi JSON ở client và lỗi giới hạn trả từ backend |
| Preview và nhập archive | PASS | Dịch nhãn kết quả, thông báo nhập file, tổng và offset; giữ cấu hình, request và nội dung nguồn tiếng Việt |
| Định dạng số | PASS | Bộ đếm `1.234 / 5.678` ở tiếng Việt thành `1,234 / 5,678` ở English; giữ tên người dùng đặt và nội dung bản ghi |
| Responsive và JavaScript | PASS | Cả hai ngôn ngữ tại 320×900, 375×900, 414×900, 768×900 và 1440×900; không tràn ngang, nút không vượt viewport, không có pageerror |

Đã xem trực tiếp ảnh desktop và mobile 320 px ở cả hai ngôn ngữ. Ảnh của lượt kiểm tra cuối nằm tại `.qa/language-LHRrXg/screenshots/`; dữ liệu kiểm tra nằm trong `.qa/`. Phạm vi chứng minh là giao diện web trên trình duyệt Chromium/Edge với HTTP server và dữ liệu mẫu cục bộ.

## Lượt kiểm tra trước

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
