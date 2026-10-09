# Cào Cào

Ứng dụng chạy trên máy để **lưu bài viết, tài liệu và câu hỏi vào thư viện học tập cá nhân**. Bạn có thể đọc lại, ghi chú, tìm nội dung và ôn bằng thẻ học. Các màn hình Tải nhanh, Nguồn & hàng đợi và Xem dữ liệu hỗ trợ thu thập JSON, phân trang và xuất dữ liệu.

Chọn **Tiếng Việt** hoặc **English** ở thanh đầu trang để chuyển ngôn ngữ. Tiếng Việt là mặc định; lựa chọn được nhớ trên trình duyệt cho lần mở tiếp theo. Có thể chuyển ngay khi đang quét hoặc xem tác vụ. Nội dung dữ liệu nguồn, tên tác vụ và file xuất được giữ nguyên.

## Chạy tool

Máy cần **Node.js 22.13 trở lên** và Chrome hoặc Edge. Trên Windows, nhấp đúp **start.cmd**: launcher kiểm tra Node/trình duyệt, cài dependencies bằng `npm ci` ở lần đầu nếu thiếu, rồi mở **Thư viện học tập**. Lần chuẩn bị đầu tiên cần mạng. Để kiểm tra môi trường mà chưa chạy server: `node scripts/launch.mjs --check`.

Nếu dùng terminal, chạy trong thư mục dự án:

```powershell
npm ci
npm start
```

Mở địa chỉ được in trong terminal, mặc định `http://127.0.0.1:4317`. Có thể nhấp đúp `start.cmd` để mở tool. Nếu cổng bận, tool thử cổng kế tiếp. Chọn cổng riêng bằng `node src/server.mjs --port 4500`.

Nếu không có Chrome/Edge, chạy `npx playwright install chromium`. Có thể chọn trình duyệt qua biến `CAOCAO_BROWSER=chrome` hoặc `msedge`.

## Thư viện học tập (1.4.0)

Mở tab **Thư viện học tập**, hoặc thêm `/#library` vào địa chỉ ứng dụng.

1. Dán **Đường dẫn nội dung** và chọn **Bài viết**, **Tài liệu / PDF** hoặc **Câu hỏi**.
2. Với bài viết, chọn một bài hoặc danh sách. Bấm **Xem mẫu trước khi lưu** để kiểm tra nội dung. Trang danh sách lấy liên kết cùng website trong vùng nội dung, tối đa 100 liên kết, rồi lưu nội dung từng bài.
3. Tạo/chọn **bộ sưu tập**, chọn tải tệp nếu cần, rồi bấm lưu. Nội dung và tệp có tiến độ riêng. Có thể tạm dừng/chạy tiếp lượt lưu và thử lại tệp lỗi trong phần đọc.
4. Mở nội dung trong thư viện để đọc, sửa tên, thêm thẻ hoặc ghi chú. Tìm theo tiêu đề, nội dung, thẻ, ghi chú; lọc theo loại và bộ sưu tập. Xóa bộ sưu tập giữ các nội dung trong thư viện.
5. Với câu hỏi, chuyển sang **Thẻ học**, thử trả lời rồi mở đáp án. Phím trái/phải chuyển câu; phím cách mở/ẩn đáp án khi đang ở vùng thẻ. Câu hỏi chưa có đáp án từ nguồn được ghi rõ.

Các nút bài viết, danh sách, PDF và câu hỏi mẫu dùng HTTP thật do ứng dụng phục vụ. Bạn cũng có thể mở **Thêm câu hỏi từ lượt tải đã có**, chọn lượt tải và kiểm tra ánh xạ câu hỏi/lựa chọn/đáp án/ID. Mẫu cập nhật khi đổi trường. Giá trị đáp án `0`, `false` và câu hỏi thiếu đáp án được giữ đúng.

Nội dung chữ, nguồn và ngày lưu được giữ trong `data/library/library.sqlite`. Tệp đã tải nằm trong `data/library/files/`; phần đọc dùng đường dẫn cục bộ. Sau khi đã lưu, đọc bài và mở tệp hoàn tất không cần tải lại nguồn; server cục bộ vẫn cần chạy. Phần đọc hiển thị chữ, không chạy HTML của website nguồn.

**Xuất nội dung:** HTML, Markdown, CSV theo nội dung đang lọc hoặc từng mục; PDF theo bộ đang lọc/từng mục. HTML được escape và CSV bảo vệ giá trị có thể bị spreadsheet hiểu thành công thức. PDF giới hạn **500 mục / 10 MB HTML**; với bộ lớn, dùng định dạng streaming. Tệp đính kèm được lưu riêng, không nhúng vào các file xuất này.

### Phục hồi, bộ nhớ và băng thông

- Trang cào được ghi vào file tạm, flush rồi đổi tên; SHA-256 kiểm tra nội dung trang mới khi khôi phục, đọc/xuất dữ liệu. Checkpoint metadata hợp lệ vẫn giúp khởi động nhanh; chạy tiếp xác minh lại các trang đã lưu. File trang cũ không có checksum vẫn đọc được.
- Loại trùng dùng chỉ mục SQLite trên đĩa; sau lượt chạy giải phóng kết nối và dữ liệu tra cứu. Bảng/tìm kiếm dùng chỉ mục dẫn tới trang gốc; so sánh dùng join SQLite và chỉ đưa trang kết quả đang xem vào RAM. Chỉ mục phụ dùng WAL/NORMAL với ngân sách cache 64 MiB/kết nối chỉ mục và có thể dựng lại từ các trang nguồn; trang gốc, checkpoint, hàng đợi tệp và thư viện vẫn dùng flush/FULL.
- URL tệp được đưa vào hàng đợi bền vững **sau khi trang/cursor đã commit**. Tệp lỗi không làm mất bản ghi. API `POST /api/jobs/files/retry` với body `{"jobId":"mã lượt tải"}` thử lại tệp riêng; lỗi URL không hợp lệ vẫn được giữ trong báo cáo.
- Thư viện dùng giao dịch SQLite để lưu nội dung và cursor nhập cùng nhau. Lượt bị ngắt được khôi phục ở trạng thái tạm dừng. Tải tệp dùng `Range` / `If-Range` khi máy chủ cung cấp ETag mạnh; kiểm tra độ dài và magic PDF trước khi hoàn tất. PDF đã lưu với ETag không đổi được tái sử dụng.
- Trình duyệt trích bài trong thư viện chặn ảnh, media và font; HTML/CSS/JavaScript/XHR vẫn chạy. Tệp/ảnh đính kèm chỉ tải khi chọn. Lịch sử JSON quan sát được giới hạn 12 response; tôn trọng `Retry-After`, dùng backoff kèm jitter.
- Crawl, nhập nội dung, quét mẫu và xuất PDF dùng chung giới hạn **2 tác vụ trong một tiến trình**. Chạy một phiên server cho mỗi thư mục dữ liệu.

Giới hạn hiện tại: bài tối đa **2 MB chữ**, mẫu ánh xạ câu hỏi tối đa **512 KB**, tối đa 30 URL tệp/ảnh mỗi bài và **100 MB/tệp thư viện**. Trích bài dựa vào cấu trúc HTML phổ biến; trang riêng, nội dung tải chậm, đăng nhập hoặc CAPTCHA có thể cần kiểm tra và chọn lại nguồn. Đọc tài liệu PDF dùng tệp gốc; tìm kiếm thư viện hiện tìm metadata/ghi chú, chưa trích chữ bên trong PDF hoặc OCR.

Các đợt phát triển và issue: [LEARNING_ROADMAP.md](LEARNING_ROADMAP.md). Kết quả kiểm chứng và giới hạn số đo: [QA_REPORT.md](QA_REPORT.md).

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
- **Trình duyệt:** với HTML chuyển trang bằng URL cùng nguồn, chạy tiếp từ URL đã lưu khi nhận diện được cách chuyển trang. Trang động/cuộn/câu hỏi chuyển nội dung mở lại nguồn, đi lại thao tác và loại bản ghi đã lưu trước khi tiến tiếp; có thể chậm khi đã cuộn nhiều cụm.
- Khi đạt giới hạn mỗi lượt, trạng thái là **Đạt giới hạn** và có nút **Chạy tiếp**. Giới hạn bản ghi trong cấu hình được kiểm tra tại ranh giới cụm để không bỏ phần còn lại của một trang.
- Giới hạn trình duyệt tính theo số cụm có bản ghi mới; chuyển từng câu không làm hết giới hạn 200 cụm. Giới hạn thao tác riêng `limits.maxActions` mặc định là 10.000 mỗi lượt để tránh thao tác vô hạn.
- Tác vụ cũ từng báo hoàn tất được kiểm tra lại từ response đã lưu khi server khởi động. Nếu mới lưu một phần tổng hoặc nguồn còn `hasMore`, trạng thái đổi thành **Chưa tải đủ**; các file dữ liệu đã lưu được giữ nguyên.
- Sau khi server/máy bị dừng, các tác vụ đang chạy được khôi phục ở trạng thái tạm dừng. Chúng không tự gửi request trở lại.

## Nguồn, hàng đợi và dữ liệu (1.3.0)

Thanh điều hướng có **Tải nhanh**, **Nguồn & hàng đợi** và **Xem dữ liệu**. Tất cả khu vực hỗ trợ Việt/Anh; dữ liệu nguồn và nội dung form được giữ khi đổi ngôn ngữ.

### Hồ sơ nguồn

Trong **Nguồn & hàng đợi**, tạo hồ sơ bằng tên, URL và cách lấy dữ liệu. Có thể bấm **Lưu thành hồ sơ** ở kết quả nhận diện hoặc cấu hình nâng cao để điền sẵn form, rồi bấm **Lưu hồ sơ**.

- **Request API đã cấu hình:** nhập endpoint, GET/POST, đường dẫn mảng, khóa ID, phân trang `none/page/offset/cursor/nextUrl/batch`. Form có tham số query/body, điểm bắt đầu, bước tăng, kích thước, cursor/URL/cờ kết thúc/tổng và token cụm. Headers, payload và giới hạn nằm trong phần có thể mở rộng.
- **Nhận diện lại mỗi lượt:** quét URL trong mỗi lượt mới và dùng cấu hình được nhận diện; giữ trường ưu tiên, trường bắt buộc, giới hạn và lựa chọn tải file trong hồ sơ.
- **Theo dõi trình duyệt:** dùng nguồn đã nhận diện nếu lưu từ Tải nhanh; hồ sơ mới lấy nội dung trang. Khóa `_key` của nội dung hiển thị không được xem là ID ổn định khi so sánh.
- Trường ưu tiên và trường bắt buộc hỗ trợ đường dẫn như `id`, `nested.title`, mỗi dòng một trường hoặc ngăn bằng dấu phẩy. Trường ưu tiên áp dụng cho bảng/xuất lọc; bản ghi gốc vẫn được lưu đầy đủ.
- Chọn ID ổn định để so sánh thay đổi. **Thêm nguồn vào hàng đợi** lưu các giá trị form hiện tại trước khi chạy. Xóa hồ sơ giữ lại file và lịch sử tải; hồ sơ có lượt đang chờ/chạy cần hủy các lượt đó trước.

### Nhiều URL và hàng đợi

Dán **1–100 URL HTTP/HTTPS**, mỗi URL một dòng, chọn hồ sơ hoặc tự nhận diện từng URL. URL lặp trong cùng lần nhập được gộp lại. Hàng đợi và lịch dùng chung giới hạn **2 lượt** với Tải nhanh và Chạy tiếp; giai đoạn nhận diện của hàng đợi cũng giữ một chỗ.

Mỗi mục có trạng thái, số bản ghi, số lần thử và lỗi riêng. **Hủy lượt** dừng việc nhận diện/tải. **Thử lại** tiếp tục job đã có từ checkpoint; lượt thất bại trước khi tạo job sẽ được nhận diện lại. Lượt đang chạy và đã hoàn tất không được thử lại. Khi khởi động lại, lượt đang chờ tiếp tục chạy; lượt bị gián đoạn được giữ ở trạng thái tạm dừng để người dùng thử lại.

Job giữ cấu hình tại thời điểm được tạo. Mục đang chờ dùng hồ sơ tại thời điểm bắt đầu; chỉnh hồ sơ không thay request của job đã tạo. Khi dùng một hồ sơ API cho URL khác, URL đó phải cùng origin với request đã lưu và trở thành URL request của lượt đó. Quy tắc này bảo vệ headers đăng nhập; URL trang gốc của hồ sơ vẫn có thể khác endpoint API. Retry job giữ nguyên endpoint và các file đã lưu.

### Bảng và xuất lọc

Bấm **Xem dữ liệu** trong một lượt tải hoặc chọn nguồn/lượt trong khu vực dữ liệu. Danh sách chọn lượt có phân trang để truy cập lịch sử cũ.

- Bảng có 25/50/100/200 bản ghi mỗi trang, tìm kiếm toàn bộ JSON không phân biệt hoa/thường, chọn cột và thêm đường dẫn lồng nhau. Số trang vượt cuối được đưa về trang cuối.
- Ô bảng chỉ hiển thị tối đa 400 ký tự; **Xem đầy đủ** mở bản ghi JSON gốc. Bảng rộng có thể cuộn ngang bằng chuột hoặc bàn phím trong vùng bảng.
- JSON/JSONL/CSV dưới bảng xuất **tất cả bản ghi phù hợp bộ lọc**, với các cột đang áp dụng, không chỉ trang hiện tại. Trường lồng nhau được xuất bằng tên đường dẫn cột. CSV tiếp tục bảo vệ công thức. Nút xuất trong Tải nhanh xuất bản gốc đầy đủ.
- Đọc và xuất theo các file trang đã commit, giữ tối đa một trang nguồn và trang kết quả trong RAM. Bảng đọc một snapshot; **Đọc lại dữ liệu** cập nhật lượt đang chạy. Xuất lọc dùng snapshot tại lúc gửi yêu cầu xuất.

### Lịch và so sánh

Bật **Tải định kỳ**, đặt khoảng 1–525600 phút và lưu hồ sơ. Lịch chạy khi server đang mở, lưu thời điểm tiếp theo trong `data/workspace.json`. Sau downtime chỉ thêm một lượt đến hạn. Nguồn còn lượt đang chờ/chạy sẽ bỏ qua kỳ đó; thời điểm kế tiếp tính từ hiện tại, tránh chạy chồng hoặc tải bù hàng loạt.

Trong **So sánh lượt tải**, chọn hai lượt của cùng hồ sơ và cùng khóa loại trùng. Kết quả gồm mới, thay đổi, vắng mặt và không đổi, có lọc/phân trang và mở bản ghi trước/sau. So sánh dùng khóa đã lưu và hash nội dung chuẩn hóa, giữ khóa/hash/chỉ số trong RAM thay vì toàn bộ bản ghi. Chọn trang lịch sử khác trong bộ chọn lượt để lấy một baseline cũ hơn.

**Vắng mặt** là kết quả giữa hai snapshot. Khi một lượt chưa có bằng chứng lấy đủ, giao diện ghi rõ đây là ứng viên, chưa xác nhận bản ghi đã biến mất ở nguồn. Khi dùng hash nội dung hoặc `_key` thay vì ID ổn định, thay đổi nội dung có thể xuất hiện thành mới/vắng mặt. Snapshot và cờ kết thúc do nguồn khai báo không chứng minh việc xóa ở hệ thống gốc.

### Báo cáo chất lượng

Báo cáo đọc dữ liệu khi người dùng mở tab, thống kê có/thiếu trường, giá trị trống, kiểu dữ liệu và số bản ghi vi phạm trường bắt buộc. `0` và `false` có dữ liệu; `null`, chuỗi rỗng/chỉ khoảng trắng, mảng rỗng và trường vắng được xem là trống. Trường nested được theo dõi tối đa 6 cấp, tối đa 500 trường; chi tiết lỗi file hiển thị tối đa 100, tổng lỗi vẫn đầy đủ.

Lỗi HTTP/kích thước/kết nối khi tải file được lưu cùng cụm và nhật ký; bản ghi nguồn vẫn được commit, lượt có thể hoàn tất với cảnh báo lỗi file. File chưa tải được không được tính vào số file thành công. Hủy tác vụ vẫn dừng commit đang thực hiện. Báo cáo cấu trúc đối chiếu với lượt trước cùng nguồn, nêu trường mới/vắng và khác biệt kiểu; có cảnh báo nếu một lượt chưa được xác nhận lấy đủ.

Mức xác nhận:

| Mức | Bằng chứng |
| --- | --- |
| Đủ theo tổng nguồn khai báo | Lượt hoàn tất, số ID đã lưu đạt tổng toàn nguồn; tổng trong một cụm không được dùng cho toàn bộ nguồn |
| Nguồn xác nhận hết dữ liệu | Lượt hoàn tất và cờ còn dữ liệu/cụm bằng `false`, hoặc cursor/URL/token cụm tiếp theo rỗng được lưu |
| Chưa có bằng chứng lấy đủ | Lượt hoàn tất qua trang rỗng, trang ngắn hoặc trình duyệt không tiến triển, nhưng thiếu tổng/cờ kết thúc rõ ràng |
| Lượt còn thiếu/chưa kết thúc | Đang chạy, tạm dừng, lỗi, đạt giới hạn hoặc chưa đủ tổng |

### API mở rộng

| Endpoint | Chức năng |
| --- | --- |
| `GET/POST /api/sources`; `GET/POST/DELETE /api/sources/:id` | Danh sách, tạo, đọc, sửa, xóa hồ sơ |
| `POST /api/sources/:id/run`; `GET /api/sources/:id/runs?page=&limit=` | Thêm nguồn vào hàng đợi; lịch sử theo nguồn |
| `GET /api/workspace?page=&status=` | Nguồn và snapshot hàng đợi, 20 mục/trang |
| `POST /api/queue` | `{urls: ["https://..."], sourceId?: "..."}`; cũng nhận URLs dạng text nhiều dòng |
| `POST /api/queue/:id/retry` hoặc `/cancel` | Thử lại/hủy từng lượt |
| `GET /api/jobs/:id/records?page=&limit=&search=&columns=` | Bảng; `columns` là JSON array được URL encode |
| `GET /api/jobs/:id/records/:index` | JSON đầy đủ theo chỉ số 0-based |
| `GET /api/jobs/:id/records/export/json\|jsonl\|csv` | Xuất lọc dạng streaming, hỗ trợ `search`/`columns` |
| `GET /api/jobs/:id/compare?base=&type=&page=&limit=` | So sánh; `type` trống hoặc `added/changed/missing` |
| `GET /api/jobs/:id/quality` | Báo cáo chất lượng và bằng chứng hoàn tất |

Từ 1.4.0, bảng/tìm kiếm và so sánh dùng chỉ mục SQLite trên đĩa, dựng từ các trang nguồn ở lần đầu và bổ sung trang mới. Các báo cáo được cache tối đa 4 snapshot trong một tiến trình và không tính lại khi polling lịch sử. Lịch vẫn cần server đang chạy.

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
  library/library.sqlite    Nội dung, bộ sưu tập, thẻ, ghi chú và lượt nhập
  library/files/            Tệp thư viện đã tải và phần đang tải tiếp
  sessions/                 Phiên trình duyệt theo nguồn
  scans/                    Báo cáo nhận diện và request quan sát
  jobs/<job-id>/
    config.json             Cấu hình request của tác vụ
    checkpoint.json         Tiến độ và vị trí chạy tiếp
    pages/00000001.json      Bản ghi mới, response gốc, vị trí kế tiếp
    keys.sqlite             Chỉ mục loại trùng có thể dựng lại
    dataset-index.sqlite    Chỉ mục bảng/tìm kiếm có thể dựng lại
    file-queue.sqlite       Hàng đợi tải tệp theo trang đã commit
    files/                  File/ảnh đã tải thêm
    exports/data.jsonl      File được tạo khi xuất dữ liệu
```

Request, cookie/token và dữ liệu có thể xuất hiện trong các file cục bộ này để hỗ trợ chạy tiếp. Thư mục `data/` được bỏ qua trong Git. Server chỉ lắng nghe trên loopback, từ chối Origin/Host bên ngoài; thông tin xác thực không được gửi theo URL phân trang khác nguồn hoặc file tải từ host khác. CSV dùng UTF-8 BOM và vô hiệu hóa chuỗi có thể được Excel hiểu thành công thức.

## Kiểm tra

```powershell
npm test
npm run benchmark:learning
```

Các kiểm tra dùng HTTP server và trang mẫu cục bộ, gồm phân trang, cursor, cụm, khôi phục checkpoint, xuất dữ liệu và luồng trình duyệt. Kết quả cụ thể và phạm vi đã kiểm tra nằm trong `QA_REPORT.md`.
