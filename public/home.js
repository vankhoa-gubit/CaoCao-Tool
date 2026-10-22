import { readLanguage, saveLanguage } from './i18n.js';

// Existing library bookmarks and links from the extension keep their destination.
function openAppBookmark() {
  if (['#library', '#quick', '#sources', '#data'].includes(location.hash)) {
    location.replace('/app' + location.hash);
    return true;
  }
  return false;
}
if (!openAppBookmark()) {
  const english = {
    skip: 'Skip to content', navigation: 'Main navigation', language: 'Choose language',
    howLink: 'How it works', extensionLink: 'Chrome extension', openLibrary: 'Open library',
    title: 'Keep what matters. Learn your own way.',
    intro: 'An article to revisit, a document to annotate, a set of questions to study. Cào Cào keeps them together in a library on your computer.',
    download: 'Download extension ZIP',
    optional: 'Use the website without an extension. The optional extension supports Chrome / Edge on Windows.',
    installGuide: 'Extension setup guide', studyTitle: 'Try a study card', sample: 'Interactive example',
    questionLabel: 'Question', question: 'Where does Cào Cào keep your saved content?',
    answer: 'In a library on your computer. Revisit saved content, add your own notes and export it when you need to.',
    reveal: 'Show answer', hide: 'Hide answer', studyHint: 'Save something worth learning. Read and review it when you need it.',
    workflowTitle: 'From a link to your own learning space.', workflowIntro: 'Start with something you want to learn. Keep everything in the same library.',
    step1Title: 'Choose what to keep', step1: 'Paste a link into the website, or use the extension to read the page you have open.',
    step2Title: 'Preview, then save', step2: 'Check the captured content and choose a collection before adding it to your library.',
    step3Title: 'Read, annotate, review', step3: 'Search by topic, write your own notes, study questions with flashcards or export content.',
    extensionTitle: 'Reading something good? Save it from that tab.',
    extensionIntro: 'Some sites require a login or block automated URL scans. The extension reads content already displayed in your current tab, reducing repeated sign-ins and page loads.',
    setupLink: 'Set up for Chrome / Edge', development: 'Development version. One-time manual setup; not yet available in the Chrome Web Store.',
    benefit1Title: 'Use the page you signed in to', benefit1: 'Read content you can already access in your browser. Complete any login or verification in the source tab.',
    benefit2Title: 'Less copying by hand', benefit2: 'Read supported articles, tables, lists and flashcards. Load more content during the same capture.',
    benefit3Title: 'Preview, then save to the same library', benefit3: 'Review the samples and choose a collection. Confirmation imports your reviewed capture without scanning the source again.',
    benefit4Title: 'Choose which page to read', benefit4: 'Tab access is granted when you click the extension. Cookies, passwords and sign-in tokens are not sent to Cào Cào.',
    comparisonTitle: 'Choose how to save each source.', comparisonNeed: 'What you need', website: 'Cào Cào website', withExtension: 'With Chrome / Edge extension',
    compareLibrary: 'Read, search, annotate and study', available: 'Included', sameLibrary: 'Uses the same library',
    compareUrl: 'Save from a link', urlAccess: 'When the source allows access', tabAccess: 'Also read an open tab',
    compareLogin: 'Save content from a signed-in tab', separateSession: 'May need a separate login', existingSession: 'Uses content already displayed',
    compareSetup: 'Initial setup', runApp: 'Open the Cào Cào application', oneTimeSetup: 'Install the extension and local connection once on Windows',
    accessLimit: 'The extension cannot guarantee access to every website or bypass every block. You must have access to the content; sign-in and CAPTCHA remain manual.',
    faqTitle: 'Before you start', faq1Title: 'Can I use it without an extension?',
    faq1: 'Yes. The library, notes, search, flashcards, exports and URL scans where the source allows access still work. The extension adds saving from your browser.',
    faq2Title: 'Is downloading the ZIP enough?', faq2: 'Extract the ZIP, install the local Cào Cào connection, then load the extension folder in Chrome or Edge. The setup page includes a connection installer and your local folder path.',
    faq3Title: 'Does Cào Cào need to be running?', faq3: 'The local application needs to run to open your library. After setting up the Windows connection, the extension can start it when you use it.',
    footer: 'A place for what you want to learn.', footerNav: 'Footer links', quick: 'Data collection tools'
  };
  const nodes = [...document.querySelectorAll('[data-home]')];
  const vietnamese = Object.fromEntries(nodes.map(node => [node.dataset.home, node.textContent]));
  vietnamese.hide = 'Ẩn đáp án';
  const labels = [...document.querySelectorAll('[data-home-aria]')].map(node => ({ node, text: node.getAttribute('aria-label') }));
  const description = document.querySelector('meta[name="description"]'), originalDescription = description.content;
  let language = readLanguage();
  function render() {
    document.documentElement.lang = language;
    document.title = language === 'en' ? 'Cào Cào · A library for what you want to learn' : 'Cào Cào · Thư viện cho điều bạn muốn học';
    description.content = language === 'en' ? 'Save articles, documents and questions to your local Cào Cào library. Read, annotate and study with flashcards. Optional Chrome and Edge extension.' : originalDescription;
    for (const node of nodes) node.textContent = (language === 'en' ? english : vietnamese)[node.dataset.home];
    for (const { node, text } of labels) node.setAttribute('aria-label', language === 'en' ? english[node.dataset.homeAria] : text);
    for (const button of document.querySelectorAll('[data-home-language]')) button.setAttribute('aria-pressed', String(button.dataset.homeLanguage === language));
  }
  for (const button of document.querySelectorAll('[data-home-language]')) button.addEventListener('click', () => { language = button.dataset.homeLanguage; saveLanguage(language); render(); });
  document.getElementById('reveal-sample').addEventListener('click', event => {
    const answer = document.getElementById('sample-answer'); answer.hidden = !answer.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!answer.hidden));
    event.currentTarget.dataset.home = answer.hidden ? 'reveal' : 'hide'; render();
  });
  window.addEventListener('pageshow', () => { language = readLanguage(); render(); });
  render();
}
window.addEventListener('hashchange', openAppBookmark);
