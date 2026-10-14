import { msg, formatMessage, MessageError, fields } from './messages.mjs';
import { chromium } from 'playwright';
import { mkdir, access, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { httpUrl, getAt, normalizeConfig, buildRequest, initialState } from './config.mjs';
import { analyzeCaptures, collectionMetadata } from './detect.mjs';
import { fetchJson, wait } from './net.mjs';

export class BrowserSessions {
  constructor(directory) { this.directory = directory; this.logins = new Map(); }
  statePath(url) { return join(this.directory, `${createHash('sha256').update(httpUrl(url).origin).digest('hex').slice(0, 24)}.json`); }
  async open(url, { headless = true, signal, lightweight = false, acceptDownloads = false } = {}) {
    await mkdir(this.directory, { recursive: true });
    let browser;
    const channels = process.env.CAOCAO_BROWSER ? [process.env.CAOCAO_BROWSER] : process.platform === 'win32' ? ['msedge', 'chrome', undefined] : ['chrome', undefined];
    for (const channel of channels) {
      signal?.throwIfAborted();
      try { browser = await chromium.launch({ channel, headless, timeout: 12000 }); break; } catch { /* Try the next installed browser. */ }
    }
    if (!browser) throw new MessageError('browser.unavailable');
    let storageState;
    try { await access(this.statePath(url)); storageState = this.statePath(url); } catch { /* First visit. */ }
    const context = await browser.newContext({ storageState, viewport: { width: 1365, height: 900 }, locale: 'vi-VN', acceptDownloads, serviceWorkers: 'block' });
    const page = await context.newPage();
    if (lightweight) await page.route('**/*', route => ['image','media','font'].includes(route.request().resourceType()) ? route.abort() : route.continue());
    page.setDefaultTimeout(10000);
    const abort = () => browser.close().catch(() => {});
    signal?.addEventListener('abort', abort, { once: true });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      signal?.removeEventListener('abort', abort);
      try {
        const target = this.statePath(url), temp = `${target}.${randomUUID()}.tmp`;
        await context.storageState({ path: temp, indexedDB: true });
        await rename(temp, target);
      } catch { /* Closing after cancellation cannot always save the session. */ }
      await browser.close().catch(() => {});
    };
    return { page, context, browser, close };
  }
  async login(url) {
    httpUrl(url);
    if (this.logins.size) throw new MessageError('login.alreadyOpen');
    const session = await this.open(url, { headless: false });
    const id = randomUUID();
    this.logins.set(id, session);
    session.browser.on('disconnected', () => this.logins.delete(id));
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    return id;
  }
  async saveLogin(id) {
    const session = this.logins.get(id);
    if (!session) throw new MessageError('login.closed');
    await session.close(); this.logins.delete(id);
  }
  async closeAll() { await Promise.allSettled([...this.logins.values()].map(session => session.close())); this.logins.clear(); }
}

export function monitorPage(page, maxBytes = 20 * 1024 * 1024) {
  const captures = [], pending = new Set(), active = new Set(), errors = [], failures = [];
  let requests = 0;
  const onRequest = request => { if (['fetch', 'xhr'].includes(request.resourceType())) { requests++; active.add(request); } };
  const onDone = request => active.delete(request);
  const onResponse = response => {
    const request = response.request();
    if (!['fetch', 'xhr', 'document'].includes(request.resourceType())) return;
    if ([401, 403, 429].includes(response.status())) errors.push(response.status());
    if (response.status() >= 400) failures.push({ status: response.status(), url: request.url(), method: request.method(), document: request.resourceType() === 'document' && request.frame() === page.mainFrame() });
    if (!response.ok() || !/json/i.test(response.headers()['content-type'] || '') || !['GET', 'POST'].includes(request.method())) return;
    if (Number(response.headers()['content-length']) > maxBytes) return;
    const task = (async () => {
      const bytes = await response.body();
      if (bytes.length > maxBytes || captures.length >= 500) return;
      let json;
      try { json = JSON.parse(bytes.toString('utf8')); } catch { return; }
      const raw = request.postData();
      let body = null, bodyType = 'raw';
      if (raw) {
        try { body = JSON.parse(raw); bodyType = 'json'; }
        catch { body = raw; bodyType = /urlencoded/i.test(request.headers()['content-type'] || '') ? 'form' : 'raw'; }
      }
      captures.push({ url: request.url(), method: request.method(), headers: await request.allHeaders(), body, bodyType, response: json });
    })().catch(() => {}).finally(() => pending.delete(task));
    pending.add(task);
  };
  page.on('request', onRequest); page.on('requestfinished', onDone); page.on('requestfailed', onDone); page.on('response', onResponse);
  return {
    captures, errors, failures, get requests() { return requests; },
    async settle(signal, minimum = 1200, maximum = 10000) {
      const start = Date.now();
      do { await wait(Math.min(200, Math.max(25, minimum)), signal); } while (Date.now() - start < minimum || ((active.size || pending.size) && Date.now() - start < maximum));
    },
    stop() { page.off('request', onRequest); page.off('requestfinished', onDone); page.off('requestfailed', onDone); page.off('response', onResponse); },
  };
}

export async function readDom(page, maxBytes = 20 * 1024 * 1024) {
  const result = await page.evaluate(limit => {
    const visible = element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'; };
    const region = document.querySelector('main, [role="main"]') || document.body;
    const clean = value => (value || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    let best = [], selector = '', score = 0;
    for (const candidate of ['article', '[role="listitem"]', 'table tbody tr', 'ul > li', 'ol > li', '.product-card', '.post-card', '.card']) {
      const items = [...region.querySelectorAll(candidate)].filter(element => visible(element) && !element.closest('nav, header, footer, aside') && clean(element.innerText).length > 25);
      const value = items.length * 3 + items.filter(element => element.querySelector('h1,h2,h3')).length * 2;
      if (items.length > 1 && value > score) { best = items; selector = candidate; score = value; }
    }
    const structured = best.length > 1;
    if (!best.length) best = [region.querySelector('article') || region];
    const records = best.map(element => {
      const heading = element.querySelector('h1,h2,h3,h4');
      const anchor = heading?.closest('a[href]') || heading?.querySelector('a[href]') || [...element.querySelectorAll('a[href]')].find(a => clean(a.innerText).length > 3 && !a.getAttribute('href').startsWith('#'));
      const text = clean(element.innerText);
      const url = anchor?.href || location.href;
      const title = clean(anchor?.getAttribute('title') || heading?.innerText || anchor?.innerText || document.title);
      return { _key: `${element.getAttribute('data-id') || element.id || url}|${title}|${text}`, title, url, text, images: [...element.querySelectorAll('img')].map(img => img.currentSrc || img.src).filter(src => /^https?:/.test(src)), links: [...element.querySelectorAll('a[href]')].map(a => ({ text: clean(a.innerText), url: a.href })).filter(link => /^https?:/.test(link.url)), sourceUrl: location.href };
    }).filter(record => record.text.length > 20);
    const bodyText = clean(document.body?.innerText).slice(0, 12000);
    const blocked = /checking your browser|verify (you are|that you are) human|just a moment|security verification|enable javascript and cookies|xác minh.*(con người|robot)/i.test(document.title + ' ' + bodyText) || Boolean(document.querySelector('iframe[src*="captcha"], .g-recaptcha, #challenge-running'));
    const needsLogin = Boolean(document.querySelector('input[type="password"]')) && /login|sign in|đăng nhập/i.test(document.title + ' ' + bodyText) && !structured;
    if (new TextEncoder().encode(JSON.stringify(records)).length > limit) return { errorCode: 'browser.contentLimit' };
    return { title: document.title, url: location.href, records, selector, structured, blocked, needsLogin };
  }, maxBytes);
  if (result.errorCode) throw new MessageError(result.errorCode);
  return result;
}

export async function findNext(page) {
  return page.evaluate(() => {
    document.querySelectorAll('[data-caocao-next]').forEach(element => element.removeAttribute('data-caocao-next'));
    const candidates = [...document.querySelectorAll('a[rel="next"], button, a, [role="button"]')];
    let found, bestScore = 0;
    const study = /flash.?card|câu hỏi|question|thẻ ghi nhớ|quiz/i.test(document.title + ' ' + document.body.innerText.slice(0, 12000));
    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || element.disabled || element.getAttribute('aria-disabled') === 'true' || /(?:^|\s)disabled(?:\s|$)/.test(element.className || '')) continue;
      const label = ([element.getAttribute('aria-label'), element.getAttribute('title'), element.innerText].find(value => value?.trim()) || '').trim().replace(/\s+/g, ' ');
      const rel = element.getAttribute('rel') === 'next';
      const inPager = element.closest('nav, [class*="pagination"], [class*="pager"]');
      const item = /(?:next (?:question|card|flashcard)|(?:câu(?: hỏi)?|thẻ) (?:tiếp(?: theo)?|sau))/i.test(label);
      const plainNext = /^(next(?: page)?|trang (?:sau|tiếp)|tiếp(?: theo)?|load more|show more|xem thêm|tải thêm)$/i.test(label);
      const arrow = /^[›»→]$/.test(label) || !label && element.querySelector('svg[class*="chevron-right"], svg[class*="arrow-right"], [data-icon="chevron-right"]');
      if (!rel && !item && !plainNext && !(arrow && (inPager || study))) continue;
      if (element.tagName === 'A') {
        try { const url = new URL(element.href); if (url.origin !== location.origin || url.href === location.href || !/^https?:$/.test(url.protocol)) continue; } catch { continue; }
      }
      const score = rel ? 100 : item ? 90 : inPager ? 80 : plainNext ? 60 : 40;
      if (score <= bestScore) continue;
      bestScore = score;
      found = { element, type: element.tagName === 'A' ? 'page' : item || study && !/load more|show more|xem thêm|tải thêm|page|trang/i.test(label) ? 'nextItem' : 'button' };
    }
    if (!found) return null;
    found.element.setAttribute('data-caocao-next', 'true');
    return { type: found.type, label: (found.element.getAttribute('aria-label') || found.element.getAttribute('title') || found.element.innerText || 'Chuyển tiếp').trim(), href: found.element.tagName === 'A' ? found.element.href : null };
  });
}

export async function advancePage(page) {
  const next = await findNext(page);
  if (next) {
    await page.locator('[data-caocao-next="true"]').click({ timeout: 10000 });
    return { action: next.type === 'page' ? 'page' : next.type === 'nextItem' ? 'nextItem' : 'loadMore', label: next.label };
  }
  const scroll = await page.evaluate(() => {
    const scrollables = [...document.querySelectorAll('body *')].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 200 && rect.height > 150 && element.scrollHeight > element.clientHeight + 80 && /auto|scroll/.test(getComputedStyle(element).overflowY);
    }).sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
    const target = scrollables[0] || document.scrollingElement;
    const before = target.scrollTop;
    target.scrollTop = target.scrollHeight;
    target.dispatchEvent(new Event('scroll', { bubbles: true }));
    if (target === document.scrollingElement) window.dispatchEvent(new Event('scroll'));
    return { before, after: target.scrollTop, height: target.scrollHeight };
  });
  return { action: 'scroll', ...scroll };
}

export function browserConfig(url, candidate, name, limits) {
  const config = normalizeConfig({ name, request: { url }, extract: { itemsPath: candidate?.itemsPath || '$', uniqueKey: candidate?.source.uniqueKey || '_key' }, limits, download: { paths: candidate?.filePaths || ['images'] } });
  return { ...config, kind: 'browser', source: candidate?.source || null };
}

export async function scanWebsite(url, sessions, update = () => {}, signal, options = {}) {
  httpUrl(url);
  update({ ...fields(msg('scan.opening'), 'stage'), requests: 0, records: 0 });
  const session = await sessions.open(url, { signal });
  const monitor = monitorPage(session.page);
  try {
    const navigation = await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await monitor.settle(signal, options.waitMs || 1400);
    let dom = await readDom(session.page);
    const actions = [];
    if (!dom.blocked && !dom.needsLogin && navigation?.status() < 400) {
      let rounds = options.rounds ?? 2;
      for (let round = 0; round < rounds; round++) {
        update({ ...fields(msg('scan.next'), 'stage'), requests: monitor.requests, records: dom.records.length });
        const action = await advancePage(session.page); actions.push(action.action);
        await monitor.settle(signal, action.action === 'nextItem' ? 150 : options.waitMs || 1400);
        dom = await readDom(session.page);
        const main = analyzeCaptures(monitor.captures, dom)[0];
        if (action.action === 'nextItem' && main?.pagination === 'none' && (main.source.hasMore === true || main.total > main.observedRecords)) {
          rounds = Math.min(options.maxActions || 60, Math.max(rounds, (main.source.pageSize || 30) + 3));
          update({ ...fields(msg('scan.nextQuestion'), 'stage'), requests: monitor.requests, records: main.observedRecords });
        }
        if (round >= (options.rounds ?? 2) - 1 && main?.apiConfig && main.pagination !== 'none') break;
      }
    }
    update({ ...fields(msg('scan.detecting'), 'stage'), requests: monitor.requests, records: dom.records.length });
    const candidates = analyzeCaptures(monitor.captures, dom);
    let blocked = dom.blocked, needsLogin = dom.needsLogin;
    if (navigation?.status() === 401) needsLogin = true;
    if ([403, 429].includes(navigation?.status())) blocked = true;
    const main = candidates[0];
    let apiVerified = false;
    if (main?.apiConfig && !blocked && !needsLogin && (main.method === 'GET' || main.pagination !== 'none')) {
      update({ ...fields(msg('scan.verifying'), 'stage'), requests: monitor.requests, records: main.observedRecords });
      try {
        const probe = await fetchJson(buildRequest(main.apiConfig, initialState(main.apiConfig)), { ...main.apiConfig.limits, timeoutMs: 8000, retries: 0 }, signal);
        apiVerified = Array.isArray(getAt(probe, main.itemsPath));
      } catch { /* Browser rendering may still work when direct replay is rejected. */ }
    }
    const hasInteractive = actions.some(action => ['page', 'loadMore', 'nextItem'].includes(action));
    const paginated = main && main.pagination !== 'none';
    const useApi = apiVerified && (paginated || !hasInteractive && !actions.includes('scroll'));
    const capability = blocked ? 'blocked' : needsLogin ? 'login' : main ? (apiVerified && paginated ? 'high' : 'medium') : dom.structured ? 'medium' : dom.records.length ? 'content' : 'unknown';
    const messages = {
      blocked: 'scan.blocked', login: 'scan.login', high: 'scan.high',
      medium: main ? 'scan.json' : 'scan.blocks', content: 'scan.content', unknown: 'scan.unknown',
    };
    const recommendation = useApi ? { ...main.apiConfig, kind: 'api' } : browserConfig(url, main, dom.title);
    return {
      url, finalUrl: dom.url, title: dom.title, capability, ...fields(msg(messages[capability])),
      requests: monitor.requests, responses: monitor.captures.length, actions: [...new Set(actions)],
      candidates, apiVerified, recommendedMode: useApi ? 'api' : 'browser', recommendation,
      browserConfig: browserConfig(url, main, dom.title),
      sample: main?.sample || dom.records.slice(0, 3).map(({_key, ...record}) => record),
      observedRecords: main?.observedRecords || dom.records.length,
      total: main?.total ?? null,
      warnings: [...new Set(monitor.errors)].map(status => formatMessage(msg('scan.http', { status }))),
      warningMessages: [...new Set(monitor.errors)].map(status => msg('scan.http', { status })),
    };
  } finally { monitor.stop(); await session.close(); }
}

function sourceMatches(capture, source, sessionId) {
  if (!source || capture.method !== source.method) return false;
  const url = new URL(capture.url), parts = source.pathname.split('/');
  if (source.sessionPathIndex != null && sessionId != null) parts[source.sessionPathIndex] = encodeURIComponent(String(sessionId));
  return url.origin === source.origin && url.pathname === parts.join('/');
}

export async function runBrowser(job, sessions, signal) {
  const config = job.config;
  job.log(msg('browser.opening'));
  const session = await sessions.open(config.request.url, { signal });
  const monitor = monitorPage(session.page, config.limits.maxResponseBytes);
  const checkpointUrl = job.progress.position?.pageUrl;
  const jump = !config.source && job.state?.navigation === 'page' && checkpointUrl && checkpointUrl !== config.request.url && new URL(checkpointUrl).origin === new URL(config.request.url).origin;
  const replayUntil = jump ? 0 : job.state?.round || 0;
  let idle = 0, runItems = 0, runBatches = 0, previousAction, previousView, sessionId;
  let source = config.source;
  const history = [], views = new Set(), consumed = new Set();
  const maxActions = config.limits.maxActions || 10000;
  if (source?.pagination !== 'batch' && Number.isSafeInteger(source?.total)) job.progress.total = source.total;
  try {
    await session.page.goto(jump ? checkpointUrl : config.request.url, { waitUntil: 'domcontentloaded', timeout: config.limits.timeoutMs });
    for (let round = 0; round < maxActions + replayUntil; round++) {
      signal.throwIfAborted();
      await monitor.settle(signal, Math.max(config.limits.delayMs, previousAction?.action === 'nextItem' ? 100 : 1200), config.limits.timeoutMs);
      const dom = await readDom(session.page, config.limits.maxResponseBytes);
      if (dom.blocked) throw new MessageError('browser.blocked');
      if (dom.needsLogin) throw new MessageError('browser.login');
      let items = [], raw;
      const recent = monitor.captures.splice(0);
      history.push(...recent);
      // Retain the bootstrap and a bounded window, never all response payloads.
      while (history.length > 12) {
        const index = history.findIndex(capture => !sourceMatches(capture, source?.seed));
        history.splice(index < 0 ? 0 : index, 1);
      }
      for (const capture of consumed) if (!history.includes(capture)) consumed.delete(capture);
      if (source) {
        const fresh = recent.length ? analyzeCaptures(history).find(candidate => {
          const next = candidate.source;
          if (!next.seed) return false;
          if (next.seed.origin === source.origin && next.seed.pathname === source.pathname && next.seed.method === source.method) return next.seed.itemsPath === source.itemsPath;
          const parts = next.pathname.split('/'), old = source.pathname.split('/');
          return next.origin === source.origin && next.method === source.method && next.itemsPath === source.itemsPath && parts.length === old.length && parts.every((part, index) => index === next.sessionPathIndex || part === old[index]);
        }) : null;
        if (fresh) source = fresh.source;
        const bootstrap = history.filter(capture => sourceMatches(capture, source.seed)).at(-1);
        if (bootstrap) sessionId = getAt(bootstrap.response, source.seed.sessionIdPath);
      }
      const failures = monitor.failures.splice(0);
      const relevantFailure = failures.find(failure => failure.document || sourceMatches(failure, source, sessionId) || sourceMatches(failure, source?.seed));
      if (relevantFailure) throw new MessageError('browser.http', { status: relevantFailure.status });
      let hasMore;
      if (source) {
        const available = [...recent, ...history.filter(capture => sourceMatches(capture, source.seed) && !consumed.has(capture) && !recent.includes(capture))];
        const matched = available.flatMap(capture => sourceMatches(capture, source, sessionId) ? [{ capture, itemsPath: source.itemsPath }] : sourceMatches(capture, source.seed) ? [{ capture, itemsPath: source.seed.itemsPath }] : []);
        for (const { capture } of matched) consumed.add(capture);
        items = matched.flatMap(({ capture, itemsPath }) => { const value = getAt(capture.response, itemsPath); return Array.isArray(value) ? value : []; });
        for (const { capture, itemsPath } of matched) {
          const metadata = collectionMetadata(capture.response, itemsPath);
          if (source.pagination !== 'batch' && metadata.total !== null) job.progress.total = metadata.total;
          if (metadata.hasMore !== undefined) hasMore = metadata.hasMore;
        }
        raw = { captures: matched.map(({ capture, itemsPath }) => ({ url: capture.url, method: capture.method, itemsPath, response: capture.response })) };
      } else {
        items = dom.records;
        const html = await session.page.content();
        if (config.saveRaw && Buffer.byteLength(html) > config.limits.maxResponseBytes) throw new MessageError('browser.htmlLimit');
        raw = { html, url: dom.url };
      }
      if (config.download.enabled) {
        const cookies = await session.context.cookies(config.request.url);
        if (cookies.length) config.request.headers.cookie = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
      }
      const saved = await job.commit(items, raw, { round: round + 1, idleCount: idle, navigation: previousAction?.action || job.state?.navigation || null }, { engine: 'browser', round: round + 1, pageUrl: dom.url });
      runItems += saved;
      if (saved > 0) runBatches++;
      job.progress.requests = monitor.requests;
      job.progress.actions = round;
      const view = createHash('sha256').update(JSON.stringify([dom.url, dom.records.map(record => record._key)])).digest('hex');
      const advanced = previousAction && ['page', 'nextItem', 'loadMore'].includes(previousAction.action) && previousView !== view && !views.has(view);
      if (saved > 0 || advanced) idle = 0;
      else if (round >= replayUntil) idle++;
      views.add(view); previousView = view;
      const missing = Number.isSafeInteger(job.progress.total) && job.progress.items < job.progress.total;
      const counts = job.progress.total != null ? `${job.progress.items}/${job.progress.total}` : String(job.progress.items);
      job.setStage(msg(round < replayUntil ? 'browser.replaying' : previousAction?.action === 'nextItem' ? 'browser.moving' : 'browser.monitoring', { count: counts }));
      job.state.idleCount = idle;
      if (hasMore !== undefined) job.state.hasMore = hasMore;
      await job.persist();
      if (job.progress.total != null && !missing) return 'end';
      if (source?.pagination !== 'batch' && hasMore === false) return missing ? 'incomplete' : 'end';
      if (idle >= 3) return missing || job.state.hasMore === true ? 'incomplete' : 'idle';
      if (runBatches >= config.limits.maxRequests || round + 1 >= maxActions + replayUntil || config.limits.maxItems && runItems >= config.limits.maxItems) return 'limited';
      const action = await advancePage(session.page);
      previousAction = action;
      if (action.action !== 'nextItem' || round % 10 === 0) job.log(msg(action.action === 'page' ? 'browser.nextPage' : action.action === 'nextItem' ? 'browser.nextItem' : action.action === 'loadMore' ? 'browser.loadMore' : 'browser.scroll'));
    }
    return 'limited';
  } finally { monitor.stop(); await session.close(); }
}
