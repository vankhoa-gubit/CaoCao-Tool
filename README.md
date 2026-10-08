# Cào Cào

Tool chạy trên máy để nhập **URL trang web**, tự quan sát dữ liệu và cách tải tiếp, rồi lưu kết quả về thư mục dự án. Giao diện hỗ trợ tiếng Việt và tiếng Anh, có tiến độ và báo cáo khả năng cào trước khi chạy.

Chọn **Tiếng Việt** hoặc **English** ở thanh đầu trang để chuyển ngôn ngữ. Tiếng Việt là mặc định; lựa chọn được nhớ trên trình duyệt cho lần mở tiếp theo. Có thể chuyển ngay khi đang quét hoặc xem tác vụ. Nội dung dữ liệu nguồn, tên tác vụ và file xuất được giữ nguyên.

## Chạy tool

Máy cần Node.js 22 trở lên và Chrome hoặc Edge. Trong thư mục dự án:

```powershell
npm ci
npm start
```

Mở địa chỉ được in trong terminal, mặc định `http://127.0.0.1:4317`. Có thể nhấp đúp `start.cmd` để mở tool. Nếu cổng bận, tool thử cổng kế tiếp. Chọn cổng riêng bằng `node src/server.mjs --port 4500`.

Nếu không có Chrome/Edge, chạy `npx playwright install chromium`. Có thể chọn trình duyệt qua biến `CAOCAO_BROWSER=chrome` hoặc `msedge`.

## Dùng bằng URL

1. Dán URL danh sách hoặc bài viết và bấm **Nhận diện trang**.
2. Tool mở trình duyệt, quan sát các response JSON, thử nút tiếp theo/cuộn tới cuối nội dung và kiểm tra request API nếu nhận diện được.
3. Xem dữ liệu mẫu, nguồn được chọn, cách phân trang và mức nhận diện. Nếu có nhiều API, có thể chọn lại nguồn hoặc lấy nội dung hiển thị.
4. Bấm **Bắt đầu cào dữ liệu**. Theo dõi số bản ghi, cụm đã lưu, request, bản ghi trùng và nhật ký.
5. Tải JSON, JSONL hoặc CSV; hoặc mở thư mục dữ liệu được hiển thị. Có thể tải phần đã lưu khi tác vụ vẫn đang chạy.

Hai nút dữ liệu mẫu trên màn hình chạy với trang thật do server cục bộ phục vụ: **cuộn tải từng cụm** và **trang kế tiếp**. Mỗi nguồn mẫu có 18 bản ghi.

### Nhận diện và giới hạn

- Nhận diện các mẫu thường gặp: số trang, offset, cursor, URL tiếp theo và trang nằm trong từng cụm (`batch/cluster/group`). Đường dẫn request/response được suy ra từ dữ liệu đã quan sát.
- Với flashcard/câu hỏi tải từng cụm, tool nhận diện nút **Next card / Next question / Câu tiếp theo**, chuyển đủ câu để tìm request tải cụm mới, rồi ưu tiên API GET phân trang nếu tải thử thành công. `totalQuestions`, `hasMore`, `nextOffset` và `questionId` được dùng để theo dõi tổng, tải tiếp và loại trùng. HTTP/2 pseudoheaders trong request trình duyệt được loại khỏi cấu hình replay.
- Với API offset tự nhận diện, lượt tải bắt đầu từ **offset 0** dù request quan sát được đang ở giữa danh sách. Các cụm tiếp theo vẫn theo `nextOffset`; cấu hình thủ công giữ điểm bắt đầu do người dùng nhập.
- Nếu tác vụ cũ đã đi đến cuối nhưng còn thiếu dữ liệu vì bắt đầu ở offset lớn hơn 0, bấm **Chạy tiếp** để tải bù phần đầu. Tool giữ dữ liệu và lịch sử đã lưu, chỉ tải các cụm trước offset bắt đầu cũ.
- Khi nhận diện đủ tham số và request tải thử thành công, ưu tiên API. Nếu chưa đủ, theo dõi trình duyệt, thu response JSON hoặc nội dung HTML, bấm nút tiếp/cuộn vùng nội dung.
- Tool báo rõ trang yêu cầu đăng nhập hoặc xác minh. Dùng **Mở trang để đăng nhập**, tự đăng nhập trong cửa sổ được mở, rồi bấm **Lưu phiên & quét lại** trước khi đóng cửa sổ. Tool không vượt CAPTCHA.
- Tự nhận diện là heuristic; API phụ, bảng điều khiển phức tạp, iframe, WebSocket và cấu trúc riêng có thể cần chọn nguồn hoặc cấu hình thủ công. Chưa thể bảo đảm lấy toàn bộ dữ liệu chỉ từ mọi URL.
- Với trình duyệt, thay đổi nội dung sau khi chuyển câu/thẻ được tính là tiến triển ngay cả khi chưa có request mới. Dừng sau 3 lượt không thấy dữ liệu hoặc nội dung thay đổi; nếu tổng khai báo còn thiếu hoặc nguồn báo `hasMore: true`, trạng thái là **Chưa tải đủ**, có thể chạy tiếp. Khi không có tổng/cờ kết thúc, dừng vì không tiến triển vẫn không chứng minh rằng nguồn đã hết dữ liệu ẩn.
- Tổng do API khai báo được dùng cho cả chế độ API và trình duyệt. Giao diện hiển thị **đã lưu / tổng**; tác vụ không báo hoàn tất khi tổng đã biết vẫn còn thiếu. Báo cáo quét cũng hiển thị tổng cạnh nguồn dữ liệu.

## Tạm dừng và chạy tiếp

Mỗi trang/cụm được ghi thành file hoàn chỉnh trước khi cập nhật điểm chạy tiếp. Bản ghi được loại trùng bằng ID nhận diện được hoặc toàn bộ nội dung.

- **API:** chạy tiếp từ trang/cursor/cụm kế tiếp đã lưu.
- **Trình duyệt:** mở lại nguồn, đi lại các thao tác đã thực hiện và loại bản ghi đã lưu trước khi tiến tiếp. Cách này có thể chậm khi đã cuộn nhiều cụm.
- Khi đạt giới hạn mỗi lượt, trạng thái là **Đạt giới hạn** và có nút **Chạy tiếp**. Giới hạn bản ghi trong cấu hình được kiểm tra tại ranh giới cụm để không bỏ phần còn lại của một trang.
- Giới hạn trình duyệt tính theo số cụm có bản ghi mới; chuyển từng câu không làm hết giới hạn 200 cụm. Giới hạn thao tác riêng `limits.maxActions` mặc định là 10.000 mỗi lượt để tránh thao tác vô hạn.
- Tác vụ cũ từng báo hoàn tất được kiểm tra lại từ response đã lưu khi server khởi động. Nếu mới lưu một phần tổng hoặc nguồn còn `hasMore`, trạng thái đổi thành **Chưa tải đủ**; các file dữ liệu đã lưu được giữ nguyên.
- Sau khi server/máy bị dừng, các tác vụ đang chạy được khôi phục ở trạng thái tạm dừng. Chúng không tự gửi request trở lại.

## Tối ưu tác vụ và lịch sử (1.2.0)

- Tạo mới và **Chạy tiếp** cùng dùng bộ điều phối tối đa **2 tác vụ** trong một tiến trình. Yêu cầu tạo mới giữ chỗ trước khi ghi file; chỗ được trả sau khi tạm dừng, hoàn tất hoặc lỗi. Khi hết chỗ, API trả HTTP **409** cùng thông báo Việt/Anh.
- Lịch sử có tìm theo tên/mã tác vụ, lọc trạng thái và phân trang **15 lượt/trang**. Có thể truy cập tất cả lượt tải cũ. Nhật ký và mẫu dữ liệu chỉ tải cho lượt đang chọn.
- Giao diện cập nhật mỗi **1,2 giây** khi có tác vụ/quét đang chạy, **15 giây** khi rảnh và **60 giây** khi tab ẩn. Khi quay lại tab hoặc mạng kết nối lại, giao diện lấy trạng thái mới. Tìm kiếm/lọc không xóa cấu hình hay nội dung đã nhập.
- Checkpoint phiên bản 2 lưu metadata kèm SHA-256 và dấu cấu hình. Nếu metadata hợp lệ và danh sách file trang khớp, khởi động không đọc lại nội dung trang. Checkpoint cũ, thiếu, hỏng hoặc không khớp sẽ được khôi phục từ các file trang đã ghi.
- Khóa loại trùng được dựng khi chạy tiếp và giải phóng sau mỗi lượt. File dữ liệu gốc và cách xuất JSON/JSONL/CSV vẫn giữ cấu trúc nguồn. Nếu chuỗi file trang bị đứt ở giữa, tool báo lỗi và yêu cầu khôi phục file trước khi chạy tiếp để tránh ghi đè dữ liệu.
- Thông báo mới dùng `{code, params}` qua catalog chung Việt/Anh. API/checkpoint vẫn giữ các trường chuỗi để tương thích; giao diện vẫn dịch được nhật ký cũ. Tên tác vụ, dữ liệu nguồn, đường dẫn và file xuất được giữ nguyên.

### API lịch sử

`GET /api/jobs?page=1&limit=15&search=keyword&status=completed` trả `{jobs, pagination, activity}`. `limit` từ 1–100; `status` bỏ trống hoặc là `running`, `paused`, `limited`, `incomplete`, `failed`, `completed`. Trang vượt cuối được đưa về trang cuối.

Danh sách phân trang không chứa `logs`, `samples`, `outputPath`; lấy chi tiết qua `GET /api/jobs/:id`. `GET /api/jobs` không có query vẫn trả định dạng cũ `{jobs}`.

### Đo hiệu năng khởi động

```powershell
npm run benchmark:startup
```

Script tạo riêng 10.000 và 100.000 bản ghi trong `.qa/`, so sánh cách khôi phục cũ tại commit `c4e08c9` với metadata mới và chế độ đọc lại file trang. Mỗi chế độ đo 3 lần trong tiến trình Node riêng, lấy trung vị, xác minh đủ ID trong bản xuất và hash từng file trang. Kết quả nằm trong `.qa/startup-benchmark-*/result.json`; số đo đã thực hiện nằm trong `QA_REPORT.md`. Có thể chọn bản cũ khác bằng `npm run benchmark:startup -- --baseline <git-ref>`.

## Cấu hình nâng cao

Hỗ trợ dán **Copy as cURL (bash)**, cURL dạng Windows cmd thường gặp, nhập request JSON, payload JSON hoặc HAR có response JSON. cURL chỉ được phân tích thành URL/headers/payload; không chạy qua shell. HAR cho phép chọn request; payload riêng cần bổ sung URL API.

Có thể nhập **file cụm dữ liệu đã lưu** (`pages/*.json` hoặc nội dung JSON trong file `.txt`) với `items`, `position.pageUrl` và `response.captures`. Tool đọc metadata trong response để hiển thị số đã lưu/tổng, `hasMore`, `nextOffset` và khóa loại trùng. Nếu file có URL trang nguồn, tool tự quét lại URL để quan sát request thật và tải các cụm còn lại. Nếu file thiếu URL trang, nhập URL nguồn rồi bấm **Nhận diện trang**. File archive thiếu method/headers vẫn được đọc để chẩn đoán; thông tin request được lấy từ lượt quét mới.

Có mẫu trong `examples/page.json`, `examples/batches.json`, `examples/cursor.json`. Hai mẫu đầu dùng server cục bộ tại cổng 4317; mẫu cursor cần thay URL và đường dẫn response theo nguồn thực tế.

| Trường | Ý nghĩa |
| --- | --- |
| `request.url/method/headers/body` | Request GET hoặc POST, có thể chứa cookie/token của phiên được cung cấp |
| `request.bodyType` | `json`, `form` hoặc `raw`; phân trang trong body cần JSON |
| `extract.itemsPath` | Mảng bản ghi, ví dụ `data.items`, `data.edges`, `$` cho mảng ở root |
| `extract.uniqueKey` | Khóa loại trùng, ví dụ `id` hoặc `node.id`; để trống để so sánh nội dung |
| `pagination.mode` | `none`, `page`, `offset`, `cursor`, `nextUrl`, `batch` |
| `pagination.location/param` | `query` hoặc `body`; tham số trong body hỗ trợ dạng `variables.after` |
| `pagination.start/step` | Giá trị bắt đầu và bước tăng cho page/offset |
| `pagination.nextPath` | Đường dẫn cursor, URL hoặc `nextOffset` trong response; với offset còn dữ liệu, giá trị phải tăng |
| `pagination.hasMorePath` | Cờ boolean báo còn trang; không có cờ thì page/offset dừng khi mảng rỗng |
| `pagination.totalPath` | Tổng số bản ghi nguyên không âm do API khai báo |
| `pagination.pageSize/sizeParam` | Kích thước trang và tên tham số kích thước |
| `pagination.stopOnShortPage` | Chỉ bật khi nguồn bảo đảm trang thiếu bản ghi là trang cuối |
| `pagination.batch` | `param/location/start/step/nextPath/hasMorePath` của cụm bên ngoài; reset trang khi chuyển cụm |
| `limits` | `maxRequests/maxItems` mỗi lượt, `maxActions` cho thao tác trình duyệt, `delayMs`, `timeoutMs`, `retries`, giới hạn response |
| `download.enabled/paths` | Tải thêm file từ các trường URL, ví dụ `fileUrl`, `imageUrl`, `images` |
| `saveRaw` | Lưu response gốc hoặc HTML cùng từng cụm, mặc định bật |

Tool thử lại lỗi mạng, timeout, HTTP 429 và một số lỗi 5xx với thời gian chờ tăng dần và `Retry-After`. Các cursor/request lặp lại và đường dẫn response không khớp sẽ báo lỗi để tránh vòng lặp hoặc kết thúc sai.

### Chạy từ terminal

```powershell
node src/cli.mjs --url https://example.com/list
node src/cli.mjs --config examples/batches.json
node src/cli.mjs --resume <job-id>
```

CLI xuất JSONL sau lượt chạy. Ctrl+C tạm dừng và giữ phần đã lưu.

## Dữ liệu trên máy

```text
data/
  sessions/                 Phiên trình duyệt theo nguồn
  scans/                    Báo cáo nhận diện và request quan sát
  jobs/<job-id>/
    config.json             Cấu hình request của tác vụ
    checkpoint.json         Tiến độ và vị trí chạy tiếp
    pages/00000001.json      Bản ghi mới, response gốc, vị trí kế tiếp
    files/                  File/ảnh đã tải thêm
    exports/data.jsonl      File được tạo khi xuất dữ liệu
```

Request, cookie/token và dữ liệu có thể xuất hiện trong các file cục bộ này để hỗ trợ chạy tiếp. Thư mục `data/` được bỏ qua trong Git. Server chỉ lắng nghe trên loopback, từ chối Origin/Host bên ngoài; thông tin xác thực không được gửi theo URL phân trang khác nguồn hoặc file tải từ host khác. CSV dùng UTF-8 BOM và vô hiệu hóa chuỗi có thể được Excel hiểu thành công thức.

## Kiểm tra

```powershell
npm test
```

Các kiểm tra dùng HTTP server và trang mẫu cục bộ, gồm phân trang, cursor, cụm, khôi phục checkpoint, xuất dữ liệu và luồng trình duyệt. Kết quả cụ thể và phạm vi đã kiểm tra nằm trong `QA_REPORT.md`.
