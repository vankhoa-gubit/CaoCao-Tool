import { readLanguage, saveLanguage } from './i18n.js';
const strings = {
  home: ['Cào Cào / Thư viện', 'Cào Cào / Library'],
  title: ['Lưu ngay từ trang bạn đang đọc.', 'Save from the page you are reading.'],
  intro: ['Tiện ích đọc bài viết, bảng, danh sách và bộ thẻ trong trình duyệt. Bạn xem mẫu rồi lưu vào thư viện trên máy.', 'The extension reads articles, tables, lists and flashcards in your browser. Review the samples and save to your local library.'],
  connectionTitle: ['Kết nối với ứng dụng', 'Connect the local application'],
  connectionHint: ['Chỉ cài một lần trên mỗi máy Windows. Tiện ích sẽ tự mở Cào Cào khi bạn dùng.', 'Set this up once on each Windows computer. The extension opens Cào Cào when you use it.'],
  install: ['Cài kết nối Chrome / Edge', 'Install Chrome / Edge connection'],
  installerHint: ['Bộ cài đăng ký kết nối trong tài khoản Windows hiện tại. Bạn cũng có thể chạy install-extension.cmd trong thư mục ứng dụng.', 'Setup registers the connection for your current Windows account. You can also run install-extension.cmd in the application folder.'],
  extensionTitle: ['Thêm tiện ích vào trình duyệt', 'Add the browser extension'],
  development: ['Bản phát triển được cài từ thư mục trên máy; chưa phát hành lên Chrome Web Store.', 'This development version is loaded from a local folder; it has not been published to the Chrome Web Store.'],
  loadUnpacked: ['Mở chrome://extensions hoặc edge://extensions, bật Developer mode, chọn Load unpacked rồi chọn thư mục:', 'Open chrome://extensions or edge://extensions, enable Developer mode, select Load unpacked and choose this folder:'],
  copy: ['Sao chép', 'Copy'], download: ['Tải gói extension ZIP', 'Download extension ZIP'],
  zipHint: ['nếu muốn giải nén sang thư mục riêng. Giữ thư mục đã cài trên máy.', 'to extract into a separate folder. Keep the installed folder on your computer.'],
  usageTitle: ['Mở trang và lưu vào Cào Cào', 'Open a page and save to Cào Cào'],
  usage: ['Ghim biểu tượng Cào Cào. Mở website, bấm biểu tượng, chọn Đọc trang, kiểm tra mẫu và Lưu vào thư viện.', 'Pin the Cào Cào icon. Open a website, click the icon, select Read page, check the samples, then Save to library.'],
  manual: ['Giữ tab nguồn mở khi đọc nhiều trang. Nếu có đăng nhập hoặc xác minh, hoàn thành trong tab nguồn. Bản đang đọc được giữ lại khi đóng popup.', 'Keep the source tab open while collecting more pages. Complete any sign-in or verification there. Your capture is kept when the popup closes.'],
  privacyTitle: ['Dữ liệu được giữ ở đâu?', 'Where is content stored?'],
  privacy: ['Bản đang đọc được giữ trong tiện ích; bản đã lưu nằm trong thư viện trên máy. Tiện ích không gửi cookie, mật khẩu hay token đăng nhập sang Cào Cào.', 'Your current capture is stored in the extension; saved content is in the local library. The extension does not send cookies, passwords or sign-in tokens to Cào Cào.'],
  limits: ['Mỗi bản đọc tối đa 5.000 mục / 4 MiB, mỗi lượt tối đa 120 thao tác / 5 phút. Chỉ xác nhận đủ khi khớp tổng nguồn cung cấp. Các website có cấu trúc riêng có thể cần thêm bộ đọc.', 'Each capture is limited to 5,000 items / 4 MiB; each pass to 120 actions / 5 minutes. Completeness is confirmed only against a reported source total. Sites with custom structures may need an additional reader.'],
  back: ['Quay lại thư viện', 'Back to library'],
  seen: ['Tiện ích đã kết nối lúc {time}.', 'The extension connected at {time}.'],
  setupError: ['Chưa đọc được thông tin kết nối. Tải lại trang để thử lại.', 'Connection details are unavailable. Reload this page to retry.'],
  installing: ['Đang cài kết nối…', 'Installing the connection…'],
  installed: ['Đã cài kết nối. Thêm tiện ích theo bước 2.', 'Connection installed. Add the extension in step 2.'],
  installError: ['Chưa cài được kết nối. Chạy install-extension.cmd trong thư mục ứng dụng để thử lại.', 'Installation failed. Run install-extension.cmd in the application folder to retry.'],
  copied: ['Đã sao chép đường dẫn thư mục extension.', 'Extension folder path copied.'],
  copyManual: ['Nhấn Ctrl+C để sao chép đường dẫn đã chọn.', 'Press Ctrl+C to copy the selected path.']
};
let language = readLanguage(), notice, noticeParams = {}, info;
const status = document.getElementById('setup-status'), button = document.getElementById('install-connection');
const t = (key, params = {}) => (strings[key]?.[language === 'en' ? 1 : 0] || key).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '');
function render() {
  document.documentElement.lang = language; document.title = t('title');
  document.querySelectorAll('[data-setup]').forEach(node => { node.textContent = t(node.dataset.setup); });
  document.getElementById('setup-language').textContent = language === 'vi' ? 'EN' : 'VI';
  status.textContent = notice ? t(notice, noticeParams) : '';
}
function announce(key, params = {}) { notice = key; noticeParams = params; render(); }
document.getElementById('setup-language').addEventListener('click', () => { language = language === 'vi' ? 'en' : 'vi'; saveLanguage(language); render(); });
render();
try {
  const response = await fetch('/api/extension/setup'); if (!response.ok) throw new Error(); info = await response.json();
  document.getElementById('extension-path').value = info.extensionPath;
  if (info.lastSeenAt) announce('seen', { time: new Date(info.lastSeenAt).toLocaleTimeString(language) });
  button.disabled = !info.canInstall;
} catch { button.disabled = true; announce('setupError'); }
button.addEventListener('click', async () => {
  button.disabled = true; announce('installing');
  try {
    const response = await fetch('/api/extension/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ install: true }) });
    if (!response.ok) throw new Error(); announce('installed');
  } catch { announce('installError'); }
  finally { button.disabled = !info?.canInstall; }
});
document.getElementById('copy-extension-path').addEventListener('click', async () => {
  const input = document.getElementById('extension-path');
  try { await navigator.clipboard.writeText(input.value); announce('copied'); }
  catch { input.select(); announce('copyManual'); }
});
