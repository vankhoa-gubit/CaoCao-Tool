// Stable message codes shared by the server and browser. Source data stays verbatim.
export const catalog = {
  "request.failed": [
    "Yêu cầu thất bại.",
    "The request failed."
  ],
  "config.invalidJson": [
    "Cấu hình JSON không hợp lệ. Kiểm tra dấu phẩy và dấu nháy.",
    "Invalid JSON configuration. Check commas and quotation marks."
  ],
  "scan.urlRequired": [
    "Nhập URL trang cần lấy dữ liệu.",
    "Enter the URL of the page to collect data from."
  ],
  "import.requestReady": [
    "Đã đọc request. Kiểm tra phân trang rồi bấm Xem thử.",
    "Request imported. Check pagination, then select Preview a request."
  ],
  "clipboard.manual": [
    "Chọn đường dẫn và nhấn Ctrl+C để sao chép.",
    "Select the path and press Ctrl+C to copy it."
  ],
  "import.fileTooLarge": [
    "File nhập vượt 30 MB.",
    "The imported file exceeds 30 MB."
  ],
  "login.instructions": [
    "Đăng nhập trong cửa sổ vừa mở, sau đó bấm Lưu phiên & quét lại trước khi đóng cửa sổ.",
    "Sign in in the window that opened, then select Save session & rescan before closing it."
  ],
  "path.type": [
    "Đường dẫn JSON phải là chuỗi.",
    "The JSON path must be a string."
  ],
  "path.unsupported": [
    "Đường dẫn JSON chứa khóa không được hỗ trợ.",
    "The JSON path contains an unsupported key."
  ],
  "pagination.paramEmpty": [
    "Tên tham số phân trang không được để trống.",
    "The pagination parameter name cannot be empty."
  ],
  "url.invalid": [
    "URL không hợp lệ. Nhập URL đầy đủ bắt đầu bằng http:// hoặc https://.",
    "Invalid URL. Enter a complete URL starting with http:// or https://."
  ],
  "url.protocol": [
    "Chỉ hỗ trợ URL HTTP/HTTPS không chứa tài khoản trong URL.",
    "Only HTTP/HTTPS URLs without embedded credentials are supported."
  ],
  "config.object": [
    "Cấu hình phải là một object JSON.",
    "The configuration must be a JSON object."
  ],
  "request.method": [
    "Tool tải dữ liệu hỗ trợ GET và POST.",
    "Data collection supports GET and POST."
  ],
  "headers.object": [
    "Headers phải là object JSON.",
    "Headers must be a JSON object."
  ],
  "headers.invalid": [
    "Header không hợp lệ.",
    "Invalid header."
  ],
  "payload.type": [
    "Payload chỉ hỗ trợ JSON, form hoặc text.",
    "The payload must use JSON, form or text."
  ],
  "payload.json": [
    "Payload JSON không hợp lệ.",
    "Invalid JSON payload."
  ],
  "payload.object": [
    "Payload JSON/form phải là object để cập nhật tham số.",
    "The JSON/form payload must be an object to update its parameters."
  ],
  "request.getBody": [
    "GET không có payload. Đưa tham số vào query URL hoặc dùng POST.",
    "GET cannot have a payload. Add parameters to the URL query or use POST."
  ],
  "pagination.mode": [
    "Kiểu phân trang không được hỗ trợ.",
    "Unsupported pagination mode."
  ],
  "pagination.location": [
    "Vị trí tham số phải là query hoặc body.",
    "The parameter location must be query or body."
  ],
  "pagination.batchLocation": [
    "Vị trí tham số cụm phải là query hoặc body.",
    "The batch parameter location must be query or body."
  ],
  "pagination.paramRequired": [
    "Nhập tên tham số phân trang.",
    "Enter the pagination parameter name."
  ],
  "pagination.body": [
    "Phân trang trong payload cần POST và payload kiểu JSON.",
    "Pagination in a payload requires POST and a JSON payload."
  ],
  "pagination.nextGet": [
    "Phân trang bằng URL tiếp theo cần request GET.",
    "Next-URL pagination requires a GET request."
  ],
  "pagination.nextPath": [
    "Nhập đường dẫn cursor/URL tiếp theo trong response.",
    "Enter the next cursor/URL path in the response."
  ],
  "pagination.batchEnd": [
    "Kiểu cụm cần nextPath hoặc hasMorePath của cụm để biết khi nào kết thúc.",
    "Batch pagination requires nextPath or hasMorePath to determine when to stop."
  ],
  "pagination.batchToken": [
    "Cụm dạng chuỗi cần đường dẫn nextPath của cụm.",
    "String batch identifiers require a batch nextPath."
  ],
  "download.paths": [
    "Nhập đường dẫn URL file trong mỗi bản ghi.",
    "Enter the file URL path in each record."
  ],
  "pagination.crossOrigin": [
    "URL trang tiếp theo khác nguồn ban đầu.",
    "The next-page URL belongs to a different origin."
  ],
  "pagination.noNext": [
    "Response báo còn dữ liệu nhưng không có cursor/URL tiếp theo.",
    "The response reports more data but has no next cursor/URL."
  ],
  "pagination.cursorLoop": [
    "Cursor không thay đổi. Tool đã dừng để tránh lặp vô hạn.",
    "The cursor did not change. Collection stopped to avoid an infinite loop."
  ],
  "pagination.offsetLoop": [
    "Nguồn báo còn dữ liệu nhưng nextOffset không tăng.",
    "The source reports more data but nextOffset did not increase."
  ],
  "pagination.noBatch": [
    "Response báo còn cụm nhưng không có mã cụm tiếp theo.",
    "The response reports more batches but has no next batch identifier."
  ],
  "pagination.batchLoop": [
    "Mã cụm không thay đổi. Tool đã dừng để tránh lặp vô hạn.",
    "The batch identifier did not change. Collection stopped to avoid an infinite loop."
  ],
  "label.start": [
    "Trang/offset bắt đầu",
    "Starting page/offset"
  ],
  "label.step": [
    "Bước tăng",
    "Step"
  ],
  "label.pageSize": [
    "Số bản ghi mỗi trang",
    "Records per page"
  ],
  "label.batchStep": [
    "Bước tăng cụm",
    "Batch step"
  ],
  "label.maxRequests": [
    "Giới hạn request mỗi lượt",
    "Request limit per run"
  ],
  "label.maxActions": [
    "Giới hạn thao tác trình duyệt mỗi lượt",
    "Browser action limit per run"
  ],
  "label.maxItems": [
    "Giới hạn bản ghi mỗi lượt",
    "Record limit per run"
  ],
  "label.delay": [
    "Độ trễ",
    "Delay"
  ],
  "label.retries": [
    "Số lần thử lại",
    "Retry count"
  ],
  "label.maxResponse": [
    "Giới hạn response",
    "Response size limit"
  ],
  "label.maxFile": [
    "Giới hạn file",
    "File size limit"
  ],
  "network.redirects": [
    "Nguồn chuyển hướng quá nhiều lần.",
    "The source redirected too many times."
  ],
  "network.tooLarge": [
    "Dữ liệu vượt giới hạn kích thước đã cấu hình.",
    "The data exceeds the configured size limit."
  ],
  "network.connection": [
    "Không kết nối được nguồn dữ liệu. Kiểm tra URL và kết nối mạng.",
    "Cannot connect to the data source. Check the URL and your network connection."
  ],
  "network.timeout": [
    "Nguồn phản hồi quá chậm. Có thể tăng timeout và chạy tiếp.",
    "The source is responding too slowly. Increase the timeout and resume."
  ],
  "network.notJson": [
    "Nguồn không trả về JSON. Hãy dùng chế độ trình duyệt nếu dữ liệu nằm trong HTML hoặc cần phiên đăng nhập.",
    "The source did not return JSON. Use browser mode for HTML data or pages requiring a login session."
  ],
  "curl.quote": [
    "cURL bị thiếu dấu đóng nháy. Dùng Copy as cURL (bash) trong tab Network.",
    "The cURL request has an unclosed quote. Use Copy as cURL (bash) in the Network tab."
  ],
  "curl.start": [
    "Request cần bắt đầu bằng curl.",
    "The request must start with curl."
  ],
  "curl.value": [
    "cURL bị thiếu giá trị tham số.",
    "The cURL request is missing a parameter value."
  ],
  "curl.header": [
    "Header cURL không hợp lệ.",
    "Invalid cURL header."
  ],
  "curl.cookie": [
    "Chỉ hỗ trợ cookie dạng tên=giá trị.",
    "Cookies must use the name=value format."
  ],
  "curl.file": [
    "Không đọc file @ trong cURL. Hãy dán payload trực tiếp.",
    "File references with @ are not read from cURL. Paste the payload directly."
  ],
  "curl.content": [
    "cURL chứa nội dung không phải request được hỗ trợ.",
    "The cURL input contains unsupported request content."
  ],
  "curl.json": [
    "Payload JSON trong cURL không hợp lệ.",
    "Invalid JSON payload in the cURL request."
  ],
  "import.invalid": [
    "Nội dung nhập không hợp lệ hoặc vượt 30 MB.",
    "The input is invalid or exceeds 30 MB."
  ],
  "import.format": [
    "Dán cURL hoặc tải file JSON/HAR hợp lệ.",
    "Paste cURL or upload a valid JSON/HAR file."
  ],
  "har.empty": [
    "HAR không chứa response JSON GET/POST.",
    "The HAR contains no GET/POST JSON responses."
  ],
  "har.notFound": [
    "Không tìm thấy request trong HAR.",
    "Request not found in the HAR."
  ],
  "import.payloadReady": [
    "Đã nhập payload JSON. Điền URL API và chọn POST trong cấu hình nâng cao.",
    "JSON payload imported. Enter the API URL and select POST in the advanced configuration."
  ],
  "download.retry": [
    "Đang thử lại việc tải file.",
    "Retrying the file download."
  ],
  "download.tooLarge": [
    "File vượt giới hạn kích thước đã cấu hình.",
    "The file exceeds the configured size limit."
  ],
  "job.ready": [
    "Sẵn sàng",
    "Ready"
  ],
  "job.recovered": [
    "Đã khôi phục điểm lưu sau khi máy chủ dừng. Bấm Chạy tiếp để tiếp tục.",
    "The checkpoint was restored after the server stopped. Select Resume to continue."
  ],
  "job.incompleteStage": [
    "Chưa tải đủ dữ liệu; có thể chạy tiếp",
    "Data is incomplete; you can resume"
  ],
  "pagination.requestLoop": [
    "Request phân trang đã lặp lại. Tool dừng để tránh vòng lặp.",
    "A pagination request repeated. Collection stopped to avoid a loop."
  ],
  "job.apiStage": [
    "Đang tải dữ liệu từ API",
    "Collecting data from the API"
  ],
  "pagination.responseLoop": [
    "Nguồn trả về cùng một trang 3 lần liên tiếp. Kiểm tra tham số phân trang.",
    "The source returned the same page 3 times in a row. Check the pagination parameters."
  ],
  "job.running": [
    "Tác vụ đang chạy.",
    "The run is already in progress."
  ],
  "job.completed": [
    "Tác vụ đã kết thúc. Tạo lượt mới nếu muốn tải lại.",
    "The run has completed. Create a new run to collect the data again."
  ],
  "job.started": [
    "Bắt đầu tải dữ liệu.",
    "Data collection started."
  ],
  "job.limitedStage": [
    "Đã đạt giới hạn mỗi lượt; có thể chạy tiếp",
    "The run limit was reached; you can resume"
  ],
  "job.idleStage": [
    "Không thấy dữ liệu hoặc nội dung thay đổi sau 3 lần kiểm tra",
    "No new data or content changes after 3 checks"
  ],
  "job.endStage": [
    "Đã tải đủ tổng khai báo hoặc nguồn báo hết dữ liệu",
    "The reported total was collected or the source reported no more data"
  ],
  "job.pausedStage": [
    "Đã tạm dừng và lưu vị trí",
    "Paused and saved the current position"
  ],
  "job.failedStage": [
    "Đã dừng vì lỗi",
    "Stopped due to an error"
  ],
  "export.format": [
    "Định dạng tải về không hợp lệ.",
    "Invalid download format."
  ],
  "browser.source": [
    "Nguồn dữ liệu trình duyệt không hợp lệ.",
    "Invalid browser data source."
  ],
  "job.notFound": [
    "Không tìm thấy tác vụ.",
    "Run not found."
  ],
  "browser.unavailable": [
    "Không mở được trình duyệt. Cài Chrome/Edge, hoặc chạy npx playwright install chromium.",
    "Cannot open a browser. Install Chrome/Edge, or run npx playwright install chromium."
  ],
  "login.alreadyOpen": [
    "Đang có cửa sổ đăng nhập. Lưu phiên trước khi mở cửa sổ khác.",
    "A sign-in window is already open. Save the session before opening another window."
  ],
  "login.closed": [
    "Cửa sổ đăng nhập đã đóng. Mở lại và bấm Lưu phiên trước khi đóng cửa sổ.",
    "The sign-in window was closed. Reopen it and save the session before closing the window."
  ],
  "browser.contentLimit": [
    "Nội dung trang vượt giới hạn response. Tăng maxResponseBytes trong cấu hình để lấy đầy đủ.",
    "Page content exceeds the response limit. Increase maxResponseBytes in the configuration to collect it all."
  ],
  "scan.opening": [
    "Đang mở trang",
    "Opening page"
  ],
  "scan.next": [
    "Đang kiểm tra cách tải tiếp",
    "Checking how to load more"
  ],
  "scan.nextQuestion": [
    "Đang chuyển câu để tìm request tải cụm tiếp theo",
    "Moving between questions to find the next batch request"
  ],
  "scan.detecting": [
    "Đang nhận diện nguồn dữ liệu",
    "Detecting data sources"
  ],
  "scan.verifying": [
    "Đang xác nhận request có thể tải lại",
    "Verifying that the request can be replayed"
  ],
  "scan.blocked": [
    "Trang đang chặn truy cập tự động hoặc yêu cầu xác minh. Tool không vượt CAPTCHA.",
    "The page blocks automated access or requires verification. The tool cannot bypass CAPTCHA."
  ],
  "scan.login": [
    "Trang yêu cầu đăng nhập. Mở trình duyệt đăng nhập, lưu phiên rồi quét lại.",
    "The page requires sign-in. Open the browser, sign in, save the session and rescan."
  ],
  "scan.high": [
    "Đã tìm thấy dữ liệu JSON, nhận diện phân trang và tải thử thành công.",
    "JSON data found, pagination detected and a test request succeeded."
  ],
  "scan.json": [
    "Đã thấy dữ liệu JSON. Có thể theo dõi trình duyệt để thu từng cụm tải thêm.",
    "JSON data found. Monitor the browser to collect each additional batch."
  ],
  "scan.blocks": [
    "Đã tìm thấy các khối nội dung. Có thể lấy nội dung và theo nút/cuộn tải thêm.",
    "Content blocks found. Collect content and use buttons or scrolling to load more."
  ],
  "scan.content": [
    "Đọc được nội dung trang. Chưa xác định được danh sách bản ghi; sẽ lưu văn bản, ảnh và liên kết theo từng trang.",
    "Page content is available. No record list was detected; text, images and links will be saved per page."
  ],
  "scan.unknown": [
    "Chưa tìm thấy dữ liệu có thể thu. Có thể thử lại sau khi trang tải đầy đủ.",
    "No collectable data found yet. Try again after the page has fully loaded."
  ],
  "browser.opening": [
    "Đang mở trình duyệt để thu dữ liệu.",
    "Opening a browser to collect data."
  ],
  "browser.blocked": [
    "Trang yêu cầu xác minh hoặc đang chặn tự động.",
    "The page requires verification or blocks automation."
  ],
  "browser.login": [
    "Phiên đăng nhập chưa có hoặc đã hết hạn. Mở trình duyệt đăng nhập rồi quét lại.",
    "The login session is missing or expired. Open the browser, sign in and rescan."
  ],
  "browser.htmlLimit": [
    "HTML trang vượt giới hạn response. Tăng maxResponseBytes hoặc tắt saveRaw trong cấu hình.",
    "Page HTML exceeds the response limit. Increase maxResponseBytes or disable saveRaw in the configuration."
  ],
  "browser.replaying": [
    "Đang khôi phục vị trí, lọc bản ghi đã lưu",
    "Restoring the position and filtering saved records"
  ],
  "browser.nextPage": [
    "Chuyển sang trang tiếp theo.",
    "Moving to the next page."
  ],
  "browser.nextItem": [
    "Đang chuyển câu/thẻ để kích hoạt tải cụm tiếp theo.",
    "Moving to the next question/card to load another batch."
  ],
  "browser.loadMore": [
    "Tải cụm tiếp theo qua nút trên trang.",
    "Loading the next batch using the page button."
  ],
  "browser.scroll": [
    "Cuộn tới cuối vùng nội dung để tải cụm tiếp theo.",
    "Scrolling to the end of the content to load the next batch."
  ],
  "request.contentType": [
    "Request cần Content-Type application/json.",
    "The request requires Content-Type application/json."
  ],
  "request.tooLarge": [
    "Nội dung gửi lên vượt 32 MB.",
    "The submitted content exceeds 32 MB."
  ],
  "request.json": [
    "Nội dung JSON gửi lên không hợp lệ.",
    "Invalid JSON in the submitted content."
  ],
  "request.host": [
    "Host không được phép truy cập tool cục bộ.",
    "This host is not allowed to access the local tool."
  ],
  "request.origin": [
    "Yêu cầu từ trang khác bị từ chối.",
    "Requests from other sites are rejected."
  ],
  "scan.notFoundRescan": [
    "Không tìm thấy lượt quét. Quét lại URL.",
    "Scan not found. Rescan the URL."
  ],
  "scan.notFound": [
    "Không tìm thấy lượt quét.",
    "Scan not found."
  ],
  "scan.cancelled": [
    "Lượt quét đã được hủy.",
    "The scan was cancelled."
  ],
  "scan.running": [
    "Một URL đang được quét. Đợi lượt quét kết thúc.",
    "A URL is being scanned. Wait for that scan to finish."
  ],
  "scan.preparing": [
    "Đang chuẩn bị",
    "Preparing"
  ],
  "scan.timeout": [
    "Lượt quét đã hết thời gian. Trang có thể tải quá chậm; hãy thử lại.",
    "The scan timed out. The page may be loading too slowly; try again."
  ],
  "scan.complete": [
    "Đã nhận diện",
    "Analysis complete"
  ],
  "job.capacityTwo": [
    "Đã có 2 tác vụ đang chạy. Tạm dừng một tác vụ hoặc chờ hoàn tất.",
    "Two runs are already in progress. Pause one or wait for it to finish."
  ],
  "scan.required": [
    "Quét URL thành công trước khi bắt đầu.",
    "Successfully scan the URL before starting."
  ],
  "scan.apiIncomplete": [
    "Nguồn này chưa nhận diện đủ tham số API. Chọn cách tải qua trình duyệt.",
    "The API parameters could not be fully detected. Choose browser collection."
  ],
  "route.notFound": [
    "Không tìm thấy địa chỉ.",
    "Address not found."
  ],
  "path.invalid": [
    "Đường dẫn JSON không hợp lệ: {path}. Dùng dạng data.items hoặc data[0].items.",
    "Invalid JSON path: {path}. Use data.items or data[0].items."
  ],
  "path.write": [
    "Không thể ghi tham số bên trong {path}.",
    "Cannot write a parameter inside {path}."
  ],
  "config.integer": [
    "{label} phải là số nguyên từ {min} đến {max}.",
    "{label} must be an integer from {min} to {max}."
  ],
  "pagination.flag": [
    "{field} cần là true/false trong response. Kiểm tra lại đường dẫn kết thúc phân trang.",
    "{field} must be true/false in the response. Check the pagination end path."
  ],
  "pagination.missing": [
    "Không tìm thấy {field} trong response. Không thể xác định trang tiếp theo.",
    "{field} was not found in the response. Cannot determine the next page."
  ],
  "pagination.token": [
    "{field} phải là chuỗi, số hoặc null.",
    "{field} must be a string, number or null."
  ],
  "pagination.total": [
    "{field} phải là tổng số bản ghi không âm.",
    "{field} must be a non-negative total record count."
  ],
  "network.auth": [
    "HTTP {status}: nguồn yêu cầu đăng nhập hoặc từ chối request. Quét lại sau khi đăng nhập.",
    "HTTP {status}: the source requires sign-in or rejected the request. Sign in and rescan."
  ],
  "network.http": [
    "Nguồn trả về HTTP {status}.",
    "The source returned HTTP {status}."
  ],
  "curl.option": [
    "Chưa hỗ trợ tùy chọn cURL {option}. Dùng request từ Copy as cURL (bash).",
    "Unsupported cURL option {option}. Use a request from Copy as cURL (bash)."
  ],
  "record.key": [
    "Bản ghi không có khóa {key}. Kiểm tra khóa loại trùng hoặc để trống để so sánh toàn bộ nội dung.",
    "A record is missing the key {key}. Check the deduplication key or leave it empty to compare full content."
  ],
  "download.saved": [
    "Đã tải file {name}.",
    "Downloaded file {name}."
  ],
  "job.checked": [
    "Đã kiểm tra dữ liệu cũ: {error}",
    "Checked saved data: {error}"
  ],
  "job.prefixIncomplete": [
    "Đã lưu {count} bản ghi. Lượt tải bắt đầu ở offset {offset}; bấm Chạy tiếp để tải bù phần đầu bị bỏ sót.",
    "Saved {count} records. The run started at offset {offset}; select Resume to collect the missing beginning."
  ],
  "job.incomplete": [
    "Đã lưu {count} bản ghi. Nguồn vẫn còn dữ liệu nhưng chưa tải tiếp được. Có thể chạy tiếp hoặc đăng nhập và quét lại URL.",
    "Saved {count} records. The source still has data but it could not be loaded. Resume, or sign in and rescan the URL."
  ],
  "job.saved": [
    "Đã lưu cụm {batch}: {count} bản ghi mới, {duplicates} bản ghi trùng.",
    "Saved batch {batch}: {count} new records, {duplicates} duplicates."
  ],
  "network.retry": [
    "Thử lại request lần {attempt} sau {delay} ms.",
    "Retrying request, attempt {attempt}, after {delay} ms."
  ],
  "record.array": [
    "Không tìm thấy mảng bản ghi tại {path}. Dùng Xem thử để xác định đường dẫn.",
    "No record array found at {path}. Use Preview a request to find the path."
  ],
  "job.prefixRecovery": [
    "Đang tải bù phần đầu bị bỏ sót: offset 0 đến trước {offset}.",
    "Collecting the missing beginning: offset 0 up to {offset}."
  ],
  "checkpoint.failed": [
    "Không lưu được checkpoint: {error}",
    "Cannot save the checkpoint: {error}"
  ],
  "checkpoint.pages": [
    "Các file cụm bị thiếu hoặc sai thứ tự. Khôi phục file gốc trước khi chạy tiếp.",
    "Batch files are missing or out of order. Restore the original files before resuming."
  ],
  "scan.http": [
    "Một request trên trang trả về HTTP {status}.",
    "A request on the page returned HTTP {status}."
  ],
  "browser.http": [
    "Nguồn dữ liệu trả về HTTP {status}. Kiểm tra phiên đăng nhập hoặc quét lại trang trước khi chạy tiếp.",
    "The data source returned HTTP {status}. Check your login session or rescan the page before resuming."
  ],
  "browser.moving": [
    "Đã lưu {count} bản ghi; đang chuyển câu để tải cụm tiếp theo",
    "Saved {count} records; moving between questions to load the next batch"
  ],
  "browser.monitoring": [
    "Đã lưu {count} bản ghi; đang theo dõi dữ liệu mới",
    "Saved {count} records; monitoring for new data"
  ],
  "archive.end.manual": [
    "Đã đọc file dữ liệu đã lưu: {count} bản ghi. Nhập URL trang nguồn rồi bấm Nhận diện trang để tìm request tải tiếp.",
    "Read saved data file: {count} records. Enter the source page URL and select Analyze page to find the next request."
  ],
  "archive.end.url": [
    "Đã đọc file dữ liệu đã lưu: {count} bản ghi. Đang nhận diện lại URL để tìm request tải các cụm còn lại.",
    "Read saved data file: {count} records. Rescanning the URL to find requests for the remaining batches."
  ],
  "archive.more.manual": [
    "Đã đọc file dữ liệu đã lưu: {count} bản ghi. Nguồn còn cụm tiếp theo. Nhập URL trang nguồn rồi bấm Nhận diện trang để tìm request tải tiếp.",
    "Read saved data file: {count} records. The source has more batches. Enter the source page URL and select Analyze page to find the next request."
  ],
  "archive.more.url": [
    "Đã đọc file dữ liệu đã lưu: {count} bản ghi. Nguồn còn cụm tiếp theo. Đang nhận diện lại URL để tìm request tải các cụm còn lại.",
    "Read saved data file: {count} records. The source has more batches. Rescanning the URL to find requests for the remaining batches."
  ],
  "label.timeout": [
    "Timeout",
    "Timeout"
  ],
  "job.capacity": [
    "Đã có {limit} tác vụ đang chạy. Tạm dừng một tác vụ hoặc chờ hoàn tất.",
    "{limit} runs are already in progress. Pause one or wait for it to finish."
  ],
  "manager.closed": [
    "Tool đang đóng. Không thể bắt đầu tác vụ mới.",
    "The tool is closing. A new run cannot be started."
  ],
  "history.query": [
    "Tham số lịch sử không hợp lệ.",
    "Invalid history parameters."
  ],
  "port.busy": [
    "Các cổng 4317–4326 đang bận. Chạy node src/server.mjs --port 4500.",
    "Ports 4317–4326 are busy. Run node src/server.mjs --port 4500."
  ],
  "port.invalid": [
    "Cổng không hợp lệ.",
    "Invalid port."
  ],
  "system.detail": [
    "{detail}",
    "{detail}"
  ]
};

export function msg(code, params = {}) {
  if (!Object.hasOwn(catalog, code)) throw new Error('Unknown message code: ' + code);
  return { code, params };
}

export function formatMessage(value, language = 'vi') {
  if (value == null) return '';
  if (typeof value === 'string') return language === 'en' ? formatMessage(decodeLegacy(value), language) : value;
  const templates = catalog[value.code];
  if (!templates) return value.code || '';
  const template = templates[language === 'en' ? 1 : 0];
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (!Object.hasOwn(value.params || {}, key)) return match;
    const param = value.params[key];
    // Only nested descriptors are translated. Literal parameters may contain source data.
    return param && typeof param === 'object' && param.code ? formatMessage(param, language) : String(param);
  });
}

// Compatibility only: decode old checkpoints/logs that stored Vietnamese sentences.
const legacy = new Map(Object.entries(catalog).filter(([, pair]) => !pair[0].includes('{')).map(([code, pair]) => [pair[0], code]));
const patterns = Object.entries(catalog).filter(([code, pair]) => code !== 'system.detail' && pair[0].includes('{')).map(([code, pair]) => {
  const keys = [];
  const pattern = pair[0].split(/\{(\w+)\}/).map((part, index) => {
    if (index % 2) { keys.push(part); return '(.+?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { code, keys, pattern: new RegExp('^' + pattern + '$', 's') };
});
export function decodeLegacy(value) {
  if (typeof value !== 'string') return value;
  if (legacy.has(value)) return msg(legacy.get(value));
  for (const { code, keys, pattern } of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    return msg(code, Object.fromEntries(keys.map((key, i) => [key, ['label', 'error'].includes(key) ? decodeLegacy(match[i + 1]) : match[i + 1]])));
  }
  return msg('system.detail', { detail: value });
}
export class MessageError extends Error {
  constructor(code, params = {}) {
    const descriptor = typeof code === 'object' ? code : msg(code, params);
    super(formatMessage(descriptor));
    this.messageData = descriptor;
  }
}
export const errorMessage = error => error?.messageData || msg('system.detail', { detail: error?.message || String(error) });
export function fields(value, field = 'message') {
  return { [field]: formatMessage(value), [field === 'message' ? 'messageData' : field + 'Message']: value };
}
