import { setTimeout as delay } from 'node:timers/promises';
import { httpUrl } from './config.mjs';

export async function wait(ms, signal) {
  if (ms > 0) await delay(ms, undefined, { signal });
  signal?.throwIfAborted();
}

export async function fetchResponse(request, limits, signal) {
  let url = httpUrl(request.url);
  let method = request.method || 'GET';
  let body = request.body;
  const headers = { ...request.headers };
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(limits.timeoutMs)]) : AbortSignal.timeout(limits.timeoutMs);
  for (let redirect = 0; redirect < 6; redirect++) {
    const response = await fetch(url, { method, headers, body, signal: combined, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.get('location')) return { response, signal: combined };
    const next = httpUrl(response.headers.get('location'), url);
    await response.body?.cancel();
    if (next.origin !== url.origin) {
      // Never forward a captured session or API key to another host.
      for (const key of Object.keys(headers)) delete headers[key];
    }
    if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) {
      method = 'GET'; body = undefined; delete headers['content-type'];
    }
    url = next;
  }
  throw new Error('Nguồn chuyển hướng quá nhiều lần.');
}

export async function readBounded(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Dữ liệu vượt giới hạn kích thước đã cấu hình.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Dữ liệu vượt giới hạn kích thước đã cấu hình.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function retryFetch(request, limits, signal, onRetry, consume) {
  for (let attempt = 0; ; attempt++) {
    try {
      signal?.throwIfAborted();
      const { response } = await fetchResponse(request, limits, signal);
      if (!response.ok) {
        const status = response.status;
        const retryAfter = response.headers.get('retry-after');
        await response.body?.cancel();
        const error = new Error([401, 403].includes(status) ? `HTTP ${status}: nguồn yêu cầu đăng nhập hoặc từ chối request. Quét lại sau khi đăng nhập.` : `Nguồn trả về HTTP ${status}.`);
        error.retryable = [408, 425, 429, 500, 502, 503, 504].includes(status);
        error.retryAfter = retryAfter;
        throw error;
      }
      return await consume(response);
    } catch (error) {
      if (signal?.aborted) throw error;
      const retryable = error.retryable ?? ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name);
      if (!retryable || attempt >= limits.retries) {
        if (error.name === 'TypeError') throw new Error('Không kết nối được nguồn dữ liệu. Kiểm tra URL và kết nối mạng.');
        if (['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('Nguồn phản hồi quá chậm. Có thể tăng timeout và chạy tiếp.');
        throw error;
      }
      const seconds = Number(error.retryAfter);
      const after = error.retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(error.retryAfter) - Date.now()) : 0;
      const duration = Math.min(60000, Math.max(300 * 2 ** attempt, Number.isFinite(after) ? after : 0));
      onRetry?.(attempt + 1, duration);
      await wait(duration, signal);
    }
  }
}

export async function fetchJson(request, limits, signal, onRetry) {
  return retryFetch(request, limits, signal, onRetry, async response => {
    const bytes = await readBounded(response, limits.maxResponseBytes);
    try { return JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error('Nguồn không trả về JSON. Hãy dùng chế độ trình duyệt nếu dữ liệu nằm trong HTML hoặc cần phiên đăng nhập.'); }
  });
}
