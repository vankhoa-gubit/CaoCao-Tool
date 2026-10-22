(() => {
  if (globalThis.CaoCaoReader) return;
  const clean = value => String(value || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const visible = element => {
    if (!element || element.closest('[hidden],[aria-hidden="true"],script,style,template')) return false;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const words = element => visible(element) ? clean(element.innerText) : '';
  const firstText = (element, selector) => [...element.querySelectorAll(selector)].map(words).find(Boolean) || '';
  const sourceUrl = () => {
    const url = new URL(location.href); url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid|funnelUUID)$|token|auth|secret|password|session|signature|^x-amz-|^cf_|^code$|^key$|api.?key/i.test(key)) url.searchParams.delete(key);
    return url.href;
  };
  const excluded = element => Boolean(element.closest('nav,header,footer,aside,form,[data-caocao-panel]'));
  function gate() {
    const title = clean(document.title), screen = clean(document.body?.innerText).slice(0, 12000);
    if (/access (?:to this page )?(?:has been )?denied|^forbidden|page (?:has been |is )?blocked/i.test(title)) return 'blocked';
    const challenge = [...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,#challenge-running,#challenge-stage')].some(visible);
    if (challenge || /^(just a moment|chờ một chút|attention required|access denied|security verification)/i.test(title) || /verify (you are|that you are) human|checking your browser|xác minh (bạn là|con người)/i.test(title + ' ' + screen.slice(0, 1500))) return 'waiting';
    if ([...document.querySelectorAll('input[type="password"]')].some(visible) && /sign in|log in|login|đăng nhập/i.test(title + ' ' + screen.slice(0, 2000)) && !document.querySelector('article,.SetPageTerm-content')) return 'login';
    return null;
  }
  function totalCount() {
    const explicit = [...document.querySelectorAll('[data-total-count],[data-total-terms],[aria-rowcount]')].filter(visible);
    for (const element of explicit) {
      const raw = element.getAttribute('data-total-count') ?? element.getAttribute('data-total-terms') ?? element.getAttribute('aria-rowcount');
      if (/^\d+$/.test(raw) && Number(raw) > 0) return Number(raw);
    }
    const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"],[data-testid="terms-count"],.SetPage-termsHeader')].filter(visible);
    for (const element of headings) {
      const value = words(element), match = value.match(/(?:terms in this set|thuật ngữ trong (?:học phần|bộ thẻ)(?: này)?)\s*\(?\s*([\d.,]+)/i) || value.match(/([\d.,]+)\s*(?:terms|flashcards|cards|thuật ngữ|thẻ|câu hỏi|items|mục)(?![\p{L}\p{N}])/iu);
      if (match) { const number = Number(match[1].replace(/[.,]/g, '')); if (Number.isSafeInteger(number) && number > 0) return number; }
    }
    const label = clean(document.body?.innerText).match(/(?:^|\n)(?:terms in this set|thuật ngữ trong (?:học phần|bộ thẻ)(?: này)?)\s*\(?\s*([\d.,]+)/i);
    if (label) { const number = Number(label[1].replace(/[.,]/g, '')); if (Number.isSafeInteger(number) && number > 0) return number; }
    return null;
  }
  function quizlet() {
    const records = [];
    const positions = new Map([...document.querySelectorAll('.SetPageTermsList-term')].map((row, index) => [row, index + 1]));
    const setId = location.pathname.match(/\d{6,}/)?.[0] || 'page';
    for (const row of document.querySelectorAll('.SetPageTermsList-term,.SetPageTerm-content,[data-testid="set-page-term"],.SetPageTerm')) {
      if (!visible(row)) continue;
      const sides = [...row.querySelectorAll('.TermText,[data-testid="TermText"]')].filter(visible);
      const body = firstText(row, '.SetPageTerm-wordText,[data-testid="term"]') || words(sides[0]);
      const answer = firstText(row, '.SetPageTerm-definitionText,[data-testid="definition"]') || words(sides[1]);
      if (body && answer) records.push({ title: body.slice(0, 160), body, answer, sourceId: row.getAttribute('data-term-id') || row.getAttribute('data-id') || (positions.has(row) ? `quizlet:${setId}:${positions.get(row)}` : '') });
    }
    return records;
  }
  function definitions(region) {
    const records = [];
    for (const term of region.querySelectorAll('dl dt')) {
      const definition = term.nextElementSibling;
      if (visible(term) && definition?.tagName === 'DD' && visible(definition) && words(term) && words(definition)) records.push({ title: words(term).slice(0, 160), body: words(term), answer: words(definition) });
    }
    return records;
  }
  function table(region) {
    let best = [];
    for (const element of region.querySelectorAll('table,[role="table"],[role="grid"]')) {
      if (!visible(element) || excluded(element)) continue;
      const headers = [...element.querySelectorAll('thead th,[role="columnheader"]')].map(words);
      const rows = [...element.querySelectorAll('tbody tr,[role="row"]')].filter(row => visible(row) && !row.closest('thead'));
      const records = [];
      for (const row of rows) {
        const cells = [...row.querySelectorAll('td,[role="cell"],[role="gridcell"]')].filter(visible).map(words);
        if (cells.length < 2 || !cells[0]) continue;
        const body = cells.length === 2 ? cells[0] : cells.map((value, index) => `${headers[index] || index + 1}: ${value}`).join('\n');
        records.push({ title: cells[0].slice(0, 160), body, answer: cells.length === 2 ? cells[1] : '', sourceId: row.getAttribute('data-id') || '' });
      }
      if (records.length > best.length) best = records;
    }
    return best;
  }
  function questions(region, force) {
    let best = [];
    const selectors = ['[data-question]', '.question-card', '.flashcard', '[role="listitem"]', 'ul > li', 'ol > li', '.card'];
    for (const selector of selectors) {
      const nodes = [...region.querySelectorAll(selector)].filter(element => visible(element) && !excluded(element) && !element.parentElement.closest(selector));
      const records = nodes.map(element => {
        const body = firstText(element, '[data-question-text],.question-text,.prompt,h2,h3,h4') || words(element);
        const answer = firstText(element, '[data-answer],.answer,.definition');
        const choices = [...element.querySelectorAll('[data-choice],.option')].filter(visible).map(words).filter(Boolean);
        return { title: body.slice(0, 160), body, answer, choices, sourceId: element.getAttribute('data-id') || '' };
      }).filter(record => record.body.length > 2 && record.body.length < 20000);
      if (records.length > best.length && (force || records.some(record => record.answer))) best = records;
    }
    return best;
  }
  function article(region) {
    const blocks = [...region.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre')].filter(element => visible(element) && !excluded(element) && !element.parentElement.closest('li,blockquote,pre')).map(words).filter(Boolean);
    const body = blocks.length ? blocks.join('\n\n') : words(region);
    if (!body || body.length < 20) return [];
    return [{ title: (firstText(document, 'article h1,main h1,h1') || clean(document.title)).slice(0, 300), body, answer: '', author: clean(document.querySelector('[rel="author"],[itemprop="author"]')?.textContent).slice(0, 300), publishedAt: (document.querySelector('time[datetime]')?.getAttribute('datetime') || '').slice(0, 100) }];
  }
  function read({ mode = 'auto' } = {}) {
    const source = { url: sourceUrl(), title: clean(document.title).slice(0, 300), adapter: 'article' }, state = gate();
    if (state) return { source, state: state === 'blocked' ? 'waiting' : state, reason: state, records: [], expectedTotal: null };
    const region = document.querySelector('main,[role="main"],article') || document.body;
    let records = [], adapter = 'article';
    if (mode !== 'article') {
      records = quizlet();
      if (records.length || /(^|\.)quizlet\.com$/.test(location.hostname)) adapter = 'quizlet';
      if (!records.length && adapter !== 'quizlet') { records = definitions(region); if (records.length) adapter = 'questions'; }
      if (!records.length && adapter !== 'quizlet') { records = table(region); if (records.length) adapter = 'table'; }
      if (!records.length && adapter !== 'quizlet') { records = questions(region, mode === 'question'); if (records.length) adapter = 'list'; }
    }
    if (!records.length && adapter !== 'quizlet' && mode !== 'question') records = article(region);
    if (mode === 'article') adapter = 'article';
    const truncated = records.length > 5000 || records.some(record => record.body.length > 2 * 1024 * 1024 || record.answer?.length > 200000);
    records = records.slice(0, 5000).map(record => ({ ...record, body: record.body.slice(0, 2 * 1024 * 1024), answer: (record.answer || '').slice(0, 200000), url: source.url }));
    source.adapter = adapter;
    return { source, state: records.length ? 'content' : 'empty', kind: adapter === 'article' ? 'article' : 'question', records, expectedTotal: adapter === 'article' && !truncated ? 1 : totalCount(), truncated, completeness: adapter === 'article' && !truncated ? 'complete' : 'unknown' };
  }
  function nextControl() {
    const candidates = [...document.querySelectorAll('a[rel="next"],button,a[role="button"],[role="button"],a[href]')];
    const matches = [];
    const termList = document.querySelector('[data-testid="terms-list"],.SetPageTermsList-term');
    for (const element of candidates) {
      if (!visible(element) || element.closest('form,header,footer,aside,[data-caocao-panel],[role="dialog"]') || element.matches(':disabled,[aria-disabled="true"]')) continue;
      const label = clean(element.getAttribute('aria-label') || element.innerText).replace(/[›»→]+/g, '').trim();
      if (termList && !element.matches('[rel="next"]') && /^(?:next(?: card| question)?|tiếp theo|câu tiếp theo)$/i.test(label)) continue;
      if (!element.matches('[rel="next"]') && !/^(see more|show more|load more|view more|xem thêm|hiển thị thêm|tải thêm|next(?: page| card| question)?|trang tiếp|trang sau|tiếp theo|câu tiếp theo)(?:\s*\([\d, .]+\)|\s+[\d, .]+(?:\s+(?:terms|cards|items|mục|thẻ))?)?$/i.test(label)) continue;
      if (element.tagName === 'A') {
        const href = element.getAttribute('href');
        if (href) { let target; try { target = new URL(href, location.href); } catch { continue; } if (!/^https?:$/.test(target.protocol) || target.origin !== location.origin) continue; }
      }
      matches.push({ element, priority: /^(?:see|show|load|view) more|^(?:xem|hiển thị|tải) thêm/i.test(label) ? 100 : element.matches('[rel="next"]') ? 80 : element.closest('nav,[aria-label*="pagination" i]') ? 60 : 10 });
    }
    return matches.sort((a, b) => b.priority - a.priority)[0]?.element || null;
  }
  function advance() {
    const state = gate(); if (state) return { state, action: 'none' };
    const control = nextControl();
    if (control) { control.click(); return { action: 'next' }; }
    const terms = [...document.querySelectorAll('.SetPageTermsList-term')].filter(visible);
    if (terms.length) {
      const last = terms.at(-1), before = last.getBoundingClientRect().top;
      last.scrollIntoView({ block: 'end', behavior: 'instant' });
      return { action: 'scroll', moved: last.getBoundingClientRect().top !== before };
    }
    const candidates = [...document.querySelectorAll('main *,[role="main"] *')].filter(element => visible(element) && element.clientHeight > 150 && element.clientWidth > 200 && element.scrollHeight > element.clientHeight + 80 && /auto|scroll/.test(getComputedStyle(element).overflowY));
    const target = candidates.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0] || document.scrollingElement;
    if (!target) return { action: 'none' };
    const before = target.scrollTop;
    target.scrollTop += Math.max(target.clientHeight * 0.8, 400);
    target.dispatchEvent(new Event('scroll', { bubbles: true }));
    if (target === document.scrollingElement) window.dispatchEvent(new Event('scroll'));
    return { action: 'scroll', moved: target.scrollTop !== before };
  }
  globalThis.CaoCaoReader = Object.freeze({ read, advance });
})();
