const http = require('node:http');
const path = require('node:path');

const BRIDGE_HOST = process.env.LLM_BP_HOST || '127.0.0.1';
const BRIDGE_PORT = Number(process.env.LLM_BP_PORT || process.env.PORT || 4399);

const TOOLS = [
  {
    name: 'browser_get_state',
    description: 'Read current active browser tab URL, title, viewport size, <canvas> regions, indexed interactive DOM elements ([#0], [#1], ...), and visible page text. Optionally captures a screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        includeScreenshot: { type: 'boolean', description: 'Also capture and attach a PNG screenshot of the tab' },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Capture a PNG screenshot of the active browser tab and return both the image and saved file path.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_click',
    description: 'Click an interactive DOM element by its [#N] index from browser_get_state.',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Element index N from [#N]' },
        human: { type: 'boolean', description: 'Use slower human-like cursor movement' },
      },
      required: ['index'],
    },
  },
  {
    name: 'browser_click_xy',
    description: 'Click at viewport CSS pixel coordinates (x, y). Works on <canvas>, WebGL, and inside <iframe> games.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Viewport X coordinate in CSS pixels' },
        y: { type: 'number', description: 'Viewport Y coordinate in CSS pixels' },
        fast: { type: 'boolean', description: 'Skip cursor animation for instant click (default true)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'browser_move_xy',
    description: 'Move mouse cursor to viewport CSS pixel coordinates (x, y).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Viewport X coordinate in CSS pixels' },
        y: { type: 'number', description: 'Viewport Y coordinate in CSS pixels' },
        fast: { type: 'boolean', description: 'Instant move without animation' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'browser_mouse_path',
    description: 'Sweep mouse cursor smoothly across a list of [x, y] viewport coordinates (useful for canvas/raking/drawing games).',
    inputSchema: {
      type: 'object',
      properties: {
        points: {
          type: 'array',
          description: 'Array of [x, y] coordinate pairs',
          items: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2,
          },
        },
        stepMs: { type: 'number', description: 'Milliseconds per segment (default 45)' },
      },
      required: ['points'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input/textarea element by [#N] index.',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Element index N from [#N]' },
        value: { type: 'string', description: 'Text to type' },
        pressEnter: { type: 'boolean', description: 'Submit / press Enter after typing' },
      },
      required: ['index', 'value'],
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option in a <select> dropdown by [#N] index.',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Element index N from [#N]' },
        value: { type: 'string', description: 'Option value or visible text' },
      },
      required: ['index', 'value'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page or a specific element into view.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Pixels to scroll (default 500)' },
        index: { type: 'number', description: 'Optional [#N] element index to scroll into view' },
      },
    },
  },
  {
    name: 'browser_press_key',
    description: 'Dispatch a keyboard key press (e.g. Enter, Escape, Tab, ArrowDown, Space).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'KeyboardEvent key name' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the active tab to an http/https URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target http:// or https:// URL' },
      },
      required: ['url'],
    },
  },
];

function callBridge(tool, args) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ tool, args: args || {} });
    const req = http.request({
      hostname: BRIDGE_HOST,
      port: BRIDGE_PORT,
      path: '/api/mcp/command',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 26000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.ok) {
            reject(new Error(data.error || `Bridge returned HTTP ${res.statusCode}`));
          } else {
            resolve(data.result || {});
          }
        } catch (err) {
          reject(new Error(`Invalid bridge JSON: ${err.message}`));
        }
      });
    });
    req.on('error', (err) => reject(new Error(`Cannot reach LLM Browser Pilot bridge (${BRIDGE_HOST}:${BRIDGE_PORT}): ${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timed out waiting for Chrome extension to execute browser tool. Make sure Chrome with LLM Browser Pilot is open.'));
    });
    req.write(payload);
    req.end();
  });
}

let useContentLength = true;

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  if (useContentLength) {
    const len = Buffer.byteLength(json, 'utf8');
    process.stdout.write(`Content-Length: ${len}\r\n\r\n${json}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return sendMessage({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'llm-browser-pilot', version: '1.0.0' },
      },
    });
  }

  if (method === 'notifications/initialized' || id === undefined) {
    return;
  }

  if (method === 'ping') {
    return sendMessage({ jsonrpc: '2.0', id, result: {} });
  }

  if (method === 'tools/list') {
    return sendMessage({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  }

  if (method === 'tools/call') {
    const toolName = params?.name || '';
    const args = params?.arguments || {};
    try {
      const result = await callBridge(toolName, args);
      const content = [];
      const textPayload = { ...result };
      delete textPayload.imageBase64;
      content.push({ type: 'text', text: JSON.stringify(textPayload, null, 2) });
      if (result.imageBase64) {
        content.push({ type: 'image', data: result.imageBase64, mimeType: 'image/png' });
      }
      return sendMessage({ jsonrpc: '2.0', id, result: { content, isError: result.ok === false } });
    } catch (err) {
      return sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        },
      });
    }
  }

  return sendMessage({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

let buffer = Buffer.alloc(0);

function processBuffer() {
  while (buffer.length > 0) {
    // Support Content-Length framing (standard MCP stdio)
    const headerEnd = buffer.indexOf('\r\n\r\n');
    const startsWithBrace = buffer[0] === 0x7b; // '{'

    if (!startsWithBrace && headerEnd !== -1) {
      const header = buffer.slice(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const len = Number.parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + len) return;
      const bodyStr = buffer.slice(bodyStart, bodyStart + len).toString('utf8');
      buffer = buffer.slice(bodyStart + len);
      useContentLength = true;
      try {
        handleRequest(JSON.parse(bodyStr));
      } catch {}
      continue;
    }

    // Fallback: newline-delimited JSON
    if (startsWithBrace) {
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      const line = buffer.slice(0, nl).toString('utf8').trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      useContentLength = false;
      try {
        handleRequest(JSON.parse(line));
      } catch {}
      continue;
    }

    return;
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});

process.stdin.on('end', () => process.exit(0));
