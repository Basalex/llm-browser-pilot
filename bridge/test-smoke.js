const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

// 1. Validate manifest & referenced extension files
const extDir = path.resolve(__dirname, '..', 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
assert.strictEqual(manifest.manifest_version, 3);
assert.ok(fs.existsSync(path.join(extDir, manifest.side_panel.default_path)));
assert.ok(fs.existsSync(path.join(extDir, manifest.background.service_worker)));
for (const iconPath of Object.values(manifest.icons)) {
  assert.ok(fs.existsSync(path.join(extDir, iconPath)), `Missing icon: ${iconPath}`);
}

// 2. Validate module domain/page binding matcher
global.window = {};
require(path.join(extDir, 'modules.js'));
const { matchBinding, getMatchedModules, formatAttachedFilesSection, DEFAULT_MODULES } = global.window.PilotModules;
const { docxXmlToText } = require('./file-extractor');

assert.strictEqual(matchBinding('github.com', 'https://github.com/openai/codex'), true);
assert.strictEqual(matchBinding('github.com', 'https://gist.github.com/user'), true);
assert.strictEqual(matchBinding('github.com', 'https://example.com'), false);
assert.strictEqual(matchBinding('*.youtube.com/*', 'https://www.youtube.com/watch?v=123'), true);
assert.strictEqual(matchBinding('docs.google.com/forms/*', 'https://docs.google.com/forms/d/e/123/viewform'), true);
assert.strictEqual(matchBinding('/issues\\/\\d+$/', 'https://github.com/org/repo/issues/42'), true);

const matchedGh = getMatchedModules(DEFAULT_MODULES, 'https://github.com/org/repo');
assert.ok(matchedGh.some((m) => m.id === 'github-reviewer'));

const filePilot = DEFAULT_MODULES.find((m) => m.id === 'file-pilot');
assert.ok(filePilot && filePilot.supportsFiles === true, 'file-pilot module should exist with supportsFiles=true');

const formattedFiles = formatAttachedFilesSection([
  { name: 'resume.md', content: 'Jane Doe\nSenior Engineer', enabled: true },
  { name: 'secret.txt', content: 'Ignore me', enabled: false },
]);
assert.ok(formattedFiles.includes('[ATTACHED FILES (1 active)]'));
assert.ok(formattedFiles.includes('Jane Doe'));
assert.ok(!formattedFiles.includes('Ignore me'));
assert.strictEqual(formatAttachedFilesSection([]), '');

const parsedDocx = docxXmlToText('<w:p><w:r><w:t>Hello &amp; Welcome</w:t></w:r></w:p><w:p><w:r><w:t>Line 2</w:t></w:r></w:p>');
assert.strictEqual(parsedDocx, 'Hello & Welcome\nLine 2');

// 3. Validate bridge server HTTP endpoints
const port = 4499;
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function httpRequest(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function httpGet(url) {
  return httpRequest(url, { method: 'GET' });
}

function httpPost(url, payload) {
  const data = JSON.stringify(payload);
  return httpRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
    body: data,
  });
}

child.stdout.once('data', async () => {
  try {
    const health = await httpGet(`http://127.0.0.1:${port}/api/health`);
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.body.ok, true);

    const prov = await httpGet(`http://127.0.0.1:${port}/api/providers`);
    assert.strictEqual(prov.status, 200);
    assert.ok(Array.isArray(prov.body.providers));
    assert.ok(prov.body.providers.length >= 6);

    const extracted = await httpPost(`http://127.0.0.1:${port}/api/files/extract`, {
      name: 'resume.txt',
      base64: Buffer.from('John Doe - Full Stack Developer', 'utf8').toString('base64'),
    });
    assert.strictEqual(extracted.status, 200);
    assert.strictEqual(extracted.body.ok, true);
    assert.strictEqual(extracted.body.text, 'John Doe - Full Stack Developer');

    const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const shot = await httpPost(`http://127.0.0.1:${port}/api/screenshot`, {
      dataUrl: `data:image/png;base64,${tinyPngBase64}`,
    });
    assert.strictEqual(shot.status, 200);
    assert.strictEqual(shot.body.ok, true);
    assert.ok(shot.body.filePath && fs.existsSync(shot.body.filePath), 'Screenshot file should exist');
    fs.unlinkSync(shot.body.filePath);

    // 4. Validate MCP bridge command -> poll -> result flow
    const mcpCmdPromise = httpPost(`http://127.0.0.1:${port}/api/mcp/command`, {
      tool: 'browser_click_xy',
      args: { x: 100, y: 200 },
    });
    const polled = await httpGet(`http://127.0.0.1:${port}/api/mcp/poll`);
    assert.strictEqual(polled.status, 200);
    assert.strictEqual(polled.body.command.tool, 'browser_click_xy');
    const delivered = await httpPost(`http://127.0.0.1:${port}/api/mcp/result`, {
      id: polled.body.command.id,
      result: { ok: true, detail: 'Clicked at (100, 200)' },
    });
    assert.strictEqual(delivered.body.delivered, true);
    const mcpResp = await mcpCmdPromise;
    assert.strictEqual(mcpResp.status, 200);
    assert.strictEqual(mcpResp.body.result.ok, true);

    // 4. Validate security protections (Origin & Content-Type)
    const evilOrigin = await httpRequest(`http://127.0.0.1:${port}/api/health`, {
      method: 'GET',
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.strictEqual(evilOrigin.status, 403);

    const extOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
    const goodOrigin = await httpRequest(`http://127.0.0.1:${port}/api/health`, {
      method: 'GET',
      headers: { Origin: extOrigin },
    });
    assert.strictEqual(goodOrigin.status, 200);
    assert.strictEqual(goodOrigin.headers['access-control-allow-origin'], extOrigin);

    const badContentType = await httpRequest(`http://127.0.0.1:${port}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    assert.strictEqual(badContentType.status, 415);

    console.log('ALL SMOKE TESTS PASSED');
    console.log('Detected CLIs:', prov.body.providers.filter((p) => p.available).map((p) => p.id).join(', ') || 'none');
    child.kill();
    process.exit(0);
  } catch (err) {
    console.error(err);
    child.kill();
    process.exit(1);
  }
});

setTimeout(() => {
  console.error('Bridge startup timed out');
  child.kill();
  process.exit(1);
}, 5000);
