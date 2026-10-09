import { getAt, httpUrl } from './config.mjs';
import { MessageError } from './messages.mjs';

export const textValue = value => value == null ? '' : typeof value === 'object' ? String(value.text ?? value.content ?? value.label ?? value.title ?? JSON.stringify(value)) : String(value);
export function questionFields(record) {
  const find = paths => paths.find(path => getAt(record, path) != null) || '';
  return { question: find(['question.text', 'question.content', 'question', 'prompt', 'content', 'text', 'title', 'nested.title']), choices: find(['options', 'choices', 'answers', 'question.options']), answer: find(['correctAnswer', 'correct_answer', 'answer', 'answerText', 'solution', 'question.answer']), id: find(['questionId', 'id', '_id']) };
}
export function questionRecord(record, fields = questionFields(record)) {
  const body = textValue(fields.question ? getAt(record, fields.question) : record).trim();
  if (!body) throw new MessageError('learning.questionMissing');
  const choices = fields.choices ? getAt(record, fields.choices) : [];
  return { title: body.slice(0, 160), body, choices: Array.isArray(choices) ? choices.map(textValue) : choices ? [textValue(choices)] : [], answer: fields.answer ? textValue(getAt(record, fields.answer)) : '', sourceId: fields.id ? textValue(getAt(record, fields.id)) : '' };
}

export async function readLearningPage(page, url, signal) {
  signal?.throwIfAborted();
  const navigation = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (navigation?.status() >= 400) throw new MessageError('browser.http', { status: navigation.status() });
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => {
    const clean = value => (value || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const scope = document.querySelector('article, [role="main"], main') || document.body;
    const visible = el => { const r = el.getBoundingClientRect(); return r.width && r.height && getComputedStyle(el).visibility !== 'hidden'; };
    const skip = el => el.closest('nav,header,footer,aside,script,style,form,[aria-hidden="true"]');
    const blocks = [...scope.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre')].filter(el => visible(el) && !skip(el) && !el.parentElement.closest('li,blockquote,pre')).map(el => clean(el.innerText)).filter(Boolean);
    const body = blocks.length ? blocks.join('\n\n') : clean(scope.innerText);
    const title = clean(document.querySelector('article h1,main h1,h1')?.innerText || document.title);
    const links = [...new Set([...document.querySelectorAll('main a[href], [role="main"] a[href], article a[href]')].filter(a => !skip(a) && clean(a.innerText).length > 5).map(a => a.href).filter(href => { try { const u = new URL(href); return /^https?:$/.test(u.protocol) && u.origin === location.origin && u.pathname !== location.pathname; } catch { return false; } }))].slice(0, 100);
    const files = [...new Set([...scope.querySelectorAll('a[href]')].map(a => a.href).filter(href => /\.(pdf|docx?|pptx?|xlsx?|txt)(?:[?#]|$)/i.test(href)).concat([...scope.querySelectorAll('img')].map(img => img.currentSrc || img.src).filter(src => /^https?:/.test(src))))].slice(0, 30);
    const screen = clean(document.body.innerText).slice(0, 12000);
    const blocked = /verify.*human|checking your browser|just a moment|xác minh.*(con người|robot)/i.test(document.title + screen) || Boolean(document.querySelector('iframe[src*="captcha"],.g-recaptcha,#challenge-running'));
    const login = Boolean(document.querySelector('input[type="password"]')) && /login|sign in|đăng nhập/i.test(document.title + screen);
    return { title, body, url: location.href, author: document.querySelector('[rel="author"], [itemprop="author"]')?.textContent?.trim() || '', publishedAt: document.querySelector('time[datetime]')?.getAttribute('datetime') || '', links, files, blocked, login };
  });
  if (result.blocked) throw new MessageError('browser.blocked');
  if (result.login) throw new MessageError('browser.login');
  if (!result.body || Buffer.byteLength(result.body) > 2 * 1024 * 1024) throw new MessageError('learning.contentLimit');
  result.url = httpUrl(result.url).href;
  return result;
}
