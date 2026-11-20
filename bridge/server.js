const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listProviders } = require('./providers');
const { streamPrompt } = require('./cli-runner');
const { extractTextFromBuffer } = require('./file-extractor');

const SCREENSHOT_DIR = path.join(os.tmpdir(), 'llmbp-sandbox', 'screenshots');

function saveScreenshotBuffer(buffer, ext = 'png') {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  // Keep only recent screenshots to avoid filling temp storage
  try {
    const entries = fs.readdirSync(SCREENSHOT_DIR)
      .map((name) => ({ name, full: path.join(SCREENSHOT_DIR, name) }))
      .map((item) => ({ ...item, mtime: fs.statSync(item.full).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of entries.slice(12)) {
      fs.unlinkSync(old.full);
    }
  } catch {}
  const safeExt = ext === 'jpg' || ext === 'jpeg' ? 'jpg' : 'png';
  const filePath = path.join(SCREENSHOT_DIR, `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${safeExt}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

const PORT = Number(process.env.PORT) || 4399;
const HOST = process.env.HOST || '127.0.0.1';

const activeRequests = new Map();
const mcpCommandQueue = [];
const mcpPollWaiters = [];
const mcpPendingResults = new Map();

function dispatchMcpCommand(command) {
  if (mcpPollWaiters.length > 0) {
    const waiter = mcpPollWaiters.shift();
    clearTimeout(waiter.timer);
    waiter.resolve(command);
  } else {
    mcpCommandQueue.push(command);
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true; // Non-browser local callers (e.g. Node tests / curl)
  return /^(chrome|edge|moz)-extension:\/\/[a-z0-9-]+$/i.test(String(origin).trim());
}

function setCorsHeaders(req, res) {
  const origin = req?.headers?.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(req, res, statusCode, payload) {
  setCorsHeaders(req, res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 15 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function writeSse(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

  if (!isAllowedOrigin(req.headers.origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Forbidden origin' }));
    return;
  }

  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST') {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      sendJson(req, res, 415, { ok: false, error: 'Content-Type must be application/json' });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(req, res, 200, {
      ok: true,
      service: 'llm-browser-pilot-bridge',
      version: '1.0.0',
      cwd: process.cwd(),
      platform: process.platform,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/providers') {
    sendJson(req, res, 200, {
      ok: true,
      providers: listProviders([]),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/providers') {
    try {
      const body = await readBody(req);
      const customProviders = Array.isArray(body.customProviders) ? body.customProviders : [];
      sendJson(req, res, 200, {
        ok: true,
        providers: listProviders(customProviders),
      });
    } catch (err) {
      sendJson(req, res, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/abort') {
    try {
      const body = await readBody(req);
      const requestId = String(body.requestId || '');
      const controller = activeRequests.get(requestId);
      if (controller) {
        controller.abort();
        activeRequests.delete(requestId);
      }
      sendJson(req, res, 200, { ok: true, aborted: Boolean(controller) });
    } catch (err) {
      sendJson(req, res, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/stream') {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      sendJson(req, res, 400, { ok: false, error: err.message });
      return;
    }

    const requestId = String(body.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const controller = new AbortController();
    activeRequests.set(requestId, controller);

    setCorsHeaders(req, res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    req.on('close', () => {
      if (!res.writableEnded) {
        controller.abort();
        activeRequests.delete(requestId);
      }
    });

    writeSse(res, 'start', { requestId });

    const allowUnsafe = process.env.LLMBP_ALLOW_UNSAFE === '1';
    const rawScreenshot = String(body.screenshotPath || '').trim();
    const resolvedScreenshot = rawScreenshot ? path.resolve(rawScreenshot) : '';
    const safeScreenshotPath = resolvedScreenshot.startsWith(path.resolve(SCREENSHOT_DIR) + path.sep)
      ? resolvedScreenshot
      : '';

    try {
      const result = await streamPrompt({
        providerId: body.providerId || 'agy',
        model: body.model || '',
        prompt: body.prompt || '',
        cwd: body.cwd || process.cwd(),
        conversationId: body.conversationId || '',
        browserMode: allowUnsafe ? (body.browserMode !== false) : true,
        screenshotPath: safeScreenshotPath,
        customProviders: Array.isArray(body.customProviders) ? body.customProviders : [],
        signal: controller.signal,
        onEvent: (ev) => {
          writeSse(res, ev.type, ev);
        },
      });
      writeSse(res, 'done', {
        requestId,
        content: result.content,
        reasoning: result.reasoning,
        conversationId: result.conversationId,
      });
    } catch (err) {
      writeSse(res, 'error', {
        requestId,
        message: err.message || 'CLI execution failed',
      });
    } finally {
      activeRequests.delete(requestId);
      if (!res.writableEnded) res.end();
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/files/extract') {
    try {
      const body = await readBody(req);
      const name = String(body.name || 'file.txt');
      const base64 = String(body.base64 || '');
      if (!base64) {
        sendJson(req, res, 400, { ok: false, error: 'Missing base64 file content' });
        return;
      }
      const buffer = Buffer.from(base64, 'base64');
      const text = await extractTextFromBuffer(name, buffer);
      sendJson(req, res, 200, { ok: true, name, text });
    } catch (err) {
      sendJson(req, res, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/screenshot') {
    try {
      const body = await readBody(req);
      let base64 = String(body.base64 || '');
      let ext = String(body.ext || 'png').toLowerCase();
      const dataUrl = String(body.dataUrl || '');
      if (dataUrl) {
        const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
        if (!match) {
          sendJson(req, res, 400, { ok: false, error: 'Invalid image dataUrl' });
          return;
        }
        ext = match[1].toLowerCase();
        base64 = match[2];
      }
      if (!base64) {
        sendJson(req, res, 400, { ok: false, error: 'Missing screenshot image data' });
        return;
      }
      const buffer = Buffer.from(base64, 'base64');
      const filePath = saveScreenshotBuffer(buffer, ext);
      sendJson(req, res, 200, { ok: true, filePath });
    } catch (err) {
      sendJson(req, res, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mcp/command') {
    try {
      const body = await readBody(req);
      const tool = String(body.tool || '').trim();
      if (!tool) {
        sendJson(req, res, 400, { ok: false, error: 'Missing tool name' });
        return;
      }
      const id = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const command = { id, tool, args: body.args || {} };

      const resultPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          mcpPendingResults.delete(id);
          reject(new Error('Timed out waiting for Chrome extension to respond'));
        }, 25000);
        mcpPendingResults.set(id, { resolve, reject, timer });
      });

      dispatchMcpCommand(command);
      const result = await resultPromise;
      sendJson(req, res, 200, { ok: true, result });
    } catch (err) {
      sendJson(req, res, 504, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/mcp/poll') {
    if (mcpCommandQueue.length > 0) {
      const cmd = mcpCommandQueue.shift();
      sendJson(req, res, 200, { ok: true, command: cmd });
      return;
    }
    const cmd = await new Promise((resolve) => {
      const entry = {
        resolve,
        timer: setTimeout(() => {
          const idx = mcpPollWaiters.indexOf(entry);
          if (idx >= 0) mcpPollWaiters.splice(idx, 1);
          resolve(null);
        }, 18000),
      };
      req.on('close', () => {
        clearTimeout(entry.timer);
        const idx = mcpPollWaiters.indexOf(entry);
        if (idx >= 0) mcpPollWaiters.splice(idx, 1);
      });
      mcpPollWaiters.push(entry);
    });
    if (!res.writableEnded) {
      sendJson(req, res, 200, { ok: true, command: cmd });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mcp/result') {
    try {
      const body = await readBody(req);
      const id = String(body.id || '');
      const pending = mcpPendingResults.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        mcpPendingResults.delete(id);
        pending.resolve(body.result || { ok: true });
      }
      sendJson(req, res, 200, { ok: true, delivered: Boolean(pending) });
    } catch (err) {
      sendJson(req, res, 400, { ok: false, error: err.message });
    }
    return;
  }

  sendJson(req, res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[LLM Browser Pilot Bridge] Listening on http://${HOST}:${PORT}`);
  const available = listProviders([]).filter((p) => p.available).map((p) => p.name);
  console.log(`[LLM Browser Pilot Bridge] Detected CLIs: ${available.length ? available.join(', ') : 'none in PATH (custom CLIs still supported)'}`);
});
