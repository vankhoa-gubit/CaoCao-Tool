import { translate } from './i18n.js';
let { language = 'vi' } = await chrome.storage.local.get('language');
function render() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-t]').forEach(node => { node.textContent = translate(language, node.dataset.t); });
  document.querySelector('#language').textContent = language === 'vi' ? 'EN' : 'VI';
  document.title = translate(language, 'helpTitle');
}
document.querySelector('#language').addEventListener('click', async () => { language = language === 'vi' ? 'en' : 'vi'; await chrome.storage.local.set({ language }); render(); });
render();
