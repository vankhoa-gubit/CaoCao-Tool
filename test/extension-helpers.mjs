import { access, mkdtemp, rm, mkdir, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { chromium } from 'playwright';
import { projectRoot } from '../src/server.mjs';

export { projectRoot };
export async function browserOptions() {
  const candidates = [process.env.CAOCAO_TEST_BROWSER].filter(Boolean);
  if (process.platform === 'win32') {
    const directory = join(projectRoot, '.qa', 'browsers');
    const builds = (await readdir(directory).catch(() => [])).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const build of builds) candidates.push(join(directory, build, 'chrome-win64', 'chrome.exe'));
  }
  for (const executablePath of candidates) { try { await access(executablePath); return { executablePath }; } catch {} }
  return {};
}
export async function testBrowser() { return chromium.launch({ ...await browserOptions(), headless: true }); }
export async function qaDirectory(prefix) { await mkdir(join(projectRoot, '.qa'), { recursive: true }); return mkdtemp(join(projectRoot, '.qa', prefix)); }
export async function removeQaDirectory(path) {
  if (!path.startsWith(join(projectRoot, '.qa') + sep)) throw new Error('Refusing to remove a directory outside QA');
  await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
export async function until(predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) { const value = await predicate(); if (value) return value; if (Date.now() > end) throw new Error('Condition timed out'); await new Promise(resolve => setTimeout(resolve, 50)); }
}
