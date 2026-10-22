import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildExtension } from '../scripts/build-extension.mjs';
import { createApp, listen } from '../src/server.mjs';
import { projectRoot, qaDirectory, removeQaDirectory, testBrowser } from './extension-helpers.mjs';

test('The installable ZIP contains exactly the extension files and an independent ZIP reader verifies every byte', { skip: process.platform !== 'win32' }, async () => {
  const directory = await qaDirectory('extension-package-');
  try {
    const built = await buildExtension({ quiet: true }), script = join(directory, 'read-zip.ps1');
    await writeFile(script, `param([string]$ZipPath)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $rows = @($zip.Entries | ForEach-Object {
    $stream = $_.Open(); $sha = [System.Security.Cryptography.SHA256]::Create()
    try { @{ name = $_.FullName; bytes = $_.Length; hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() } }
    finally { $stream.Dispose(); $sha.Dispose() }
  })
  ConvertTo-Json -InputObject $rows -Compress
} finally { $zip.Dispose() }
`, 'utf8');
    const rows = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ZipPath', built.target], { encoding: 'utf8', windowsHide: true }));
    assert.equal(rows.length, 14); assert.deepEqual(rows.map(row => row.name).sort(), built.files.slice().sort());
    for (const row of rows) {
      assert.doesNotMatch(row.name, /\.\.|data\/|node_modules|\.env|native-host|\.key/);
      const bytes = await readFile(join(projectRoot, 'extension', row.name));
      assert.equal(row.bytes, bytes.length); assert.equal(row.hash, createHash('sha256').update(bytes).digest('hex'));
    }
    const manifest = JSON.parse(await readFile(join(projectRoot, 'extension', 'manifest.json'), 'utf8'));
    assert.equal(manifest.manifest_version, 3); assert.deepEqual(manifest.permissions.slice().sort(), ['activeTab', 'nativeMessaging', 'scripting', 'storage']);
    assert.equal(manifest.host_permissions, undefined); assert.equal(manifest.optional_host_permissions, undefined);
  } finally { await removeQaDirectory(directory); }
});

test('The setup page switches language, preserves the extension path, and serves a ZIP under the existing CSP', async () => {
  const directory = await qaDirectory('extension-setup-'); let app, browser;
  try {
    app = await createApp({ dataDirectory: directory }); const origin = await listen(app, 0);
    browser = await testBrowser(); const page = await browser.newPage({ viewport: { width: 390, height: 720 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(origin + '/extension'); assert.equal(response.status(), 200); assert.match(response.headers()['content-security-policy'], /script-src 'self'/);
    await page.waitForFunction(() => document.getElementById('extension-path').value);
    const path = await page.locator('#extension-path').inputValue(); assert.equal(path, join(projectRoot, 'extension'));
    assert.equal(await page.locator('h1').textContent(), 'Lưu ngay từ trang bạn đang đọc.');
    await page.locator('#setup-language').click(); assert.equal(await page.locator('h1').textContent(), 'Save from the page you are reading.');
    assert.equal(await page.locator('#extension-path').inputValue(), path);
    assert.ok((await page.locator('[data-setup]').allTextContents()).every(text => text.trim()));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const download = await fetch(origin + '/extension-download'); assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'application/zip'); assert.ok((await download.arrayBuffer()).byteLength > 10000);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await app?.close(); await removeQaDirectory(directory); }
});
