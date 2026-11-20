const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { AGY_MODELS, getProvider, resolveLaunchSpec } = require('./providers');

const MAX_CLI_PROMPT_CHARS = 28000;

function killProcessTree(child) {
  if (!child) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => {});
    } catch {}
  }
  try {
    child.kill();
  } catch {}
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripAnsi(str) {
  return String(str || '').replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    ''
  );
}

function fitPromptForCli(prompt, maxChars = MAX_CLI_PROMPT_CHARS) {
  const raw = String(prompt || '');
  if (raw.length <= maxChars) return raw;
  const notice = '\n\n...[middle context truncated to fit CLI command length limit]...\n\n';
  const budget = Math.max(1000, maxChars - notice.length);
  const headChars = Math.floor(budget * 0.38);
  const tailChars = budget - headChars;
  return raw.slice(0, headChars) + notice + raw.slice(raw.length - tailChars);
}

function splitTemplateArgs(template) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function buildCustomArgs(template, vars) {
  const tokens = splitTemplateArgs(String(template || ''));
  return tokens.map((tok) =>
    tok
      .replace(/\{\{prompt\}\}/g, vars.prompt || '')
      .replace(/\{\{model\}\}/g, vars.model || '')
      .replace(/\{\{cwd\}\}/g, vars.cwd || '')
      .replace(/\{\{sessionId\}\}/g, vars.sessionId || '')
  );
}

function getSandboxDir() {
  const dir = path.join(os.tmpdir(), 'llmbp-sandbox');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}

function isSafeScreenshotPath(p) {
  if (!p) return false;
  const screenshotDir = path.resolve(getSandboxDir(), 'screenshots');
  const resolved = path.resolve(String(p));
  return resolved.startsWith(screenshotDir + path.sep) && fs.existsSync(resolved);
}

function buildInvocation({ provider, prompt, model, cwd, conversationId, browserMode = true, screenshotPath = '' }) {
  const bin = provider.binary;
  const id = provider.id;
  const effectiveCwd = browserMode ? getSandboxDir() : cwd;
  const validScreenshot = isSafeScreenshotPath(screenshotPath) ? path.resolve(screenshotPath) : '';

  if (id === 'agy') {
    const safePrompt = fitPromptForCli(prompt);
    const validAgyIds = new Set(AGY_MODELS.map((m) => m.id));
    const resolvedModel = (model && validAgyIds.has(model))
      ? model
      : (provider.defaultModel || 'claude-sonnet-5-5-medium');
    const args = [
      '--print', safePrompt,
      '--model', resolvedModel,
      '--output-format', 'stream-json',
      '--input-format', 'text',
      '--add-dir', effectiveCwd,
    ];
    if (validScreenshot) {
      const shotDir = path.dirname(validScreenshot);
      if (shotDir !== effectiveCwd) args.push('--add-dir', shotDir);
    }
    if (!browserMode) args.push('--dangerously-skip-permissions');
    if (conversationId) args.push('--conversation', conversationId);
    return {
      launch: resolveLaunchSpec(bin, args),
      stdinText: null,
      outputFormat: 'agy-json',
      tempFiles: [],
    };
  }

  if (id === 'claude') {
    const safePrompt = fitPromptForCli(prompt);
    const tempFiles = [];
    const args = [
      '-p', safePrompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];
    if (browserMode) {
      args.push('--tools', '', '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit');
      const mcpScript = path.join(__dirname, 'mcp.js');
      if (fs.existsSync(mcpScript)) {
        const mcpConfigPath = path.join(os.tmpdir(), `llmbp-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
        fs.writeFileSync(mcpConfigPath, JSON.stringify({
          mcpServers: {
            'llm-browser-pilot': {
              command: process.execPath,
              args: [mcpScript],
            },
          },
        }), 'utf8');
        tempFiles.push(mcpConfigPath);
        args.push('--mcp-config', mcpConfigPath);
      }
    } else {
      args.push('--dangerously-skip-permissions', '--add-dir', effectiveCwd);
    }
    if (model) args.push('--model', model);
    if (conversationId) args.push('--resume', conversationId);
    return {
      launch: resolveLaunchSpec(bin, args),
      stdinText: null,
      outputFormat: 'claude-json',
      tempFiles,
    };
  }

  if (id === 'codex') {
    const isResume = Boolean(conversationId);
    const sandboxFlag = browserMode ? '--sandbox' : '--dangerously-bypass-approvals-and-sandbox';
    const args = isResume
      ? ['exec', 'resume', conversationId, '-', '--json', '--skip-git-repo-check', ...(browserMode ? ['--sandbox', 'read-only'] : [sandboxFlag])]
      : ['exec', '-', '--json', '--skip-git-repo-check', ...(browserMode ? ['--sandbox', 'read-only'] : [sandboxFlag]), '-C', effectiveCwd];
    if (validScreenshot && !isResume) args.push('-i', validScreenshot);
    if (model) args.push('-m', model);
    return {
      launch: resolveLaunchSpec(bin, args),
      stdinText: String(prompt || ''),
      outputFormat: 'codex-json',
      tempFiles: [],
    };
  }

  if (id === 'grok') {
    const tempFiles = [];
    const args = [];
    const rawPrompt = String(prompt || '');
    if (rawPrompt.length > 6000) {
      const tmpFile = path.join(os.tmpdir(), `llmbp-grok-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.txt`);
      fs.writeFileSync(tmpFile, rawPrompt, 'utf8');
      tempFiles.push(tmpFile);
      args.push('--prompt-file', tmpFile);
    } else {
      args.push('-p', rawPrompt);
    }
    args.push(
      '--output-format', 'streaming-json',
      '--include-partial-messages',
      '--cwd', effectiveCwd,
      '--add-dir', effectiveCwd
    );
    if (!browserMode) args.push('--always-approve');
    if (model) args.push('--model', model);
    if (conversationId) args.push('--resume', conversationId);
    return {
      launch: resolveLaunchSpec(bin, args),
      stdinText: null,
      outputFormat: 'grok-json',
      tempFiles,
    };
  }

  if (id === 'gemini' || id === 'qwen') {
    const safePrompt = fitPromptForCli(prompt);
    const args = ['-p', safePrompt, '--output-format', 'stream-json'];
    if (!browserMode) args.push('--yolo');
    if (model) args.push('-m', model);
    return {
      launch: resolveLaunchSpec(bin, args),
      stdinText: null,
      outputFormat: 'gemini-json',
      tempFiles: [],
    };
  }

  if (id === 'kimi') {
    const safePrompt = fitPromptForCli(prompt);
    const args = ['--print', '-p', safePrompt, '--output-format', 'stream-json'];
    if (model) args.push('-m', model);
    return {
      launch: resolveLaunchSpec(bin, args),
      stdinText: null,
      outputFormat: 'claude-json',
      tempFiles: [],
    };
  }

  if (id === 'iflow') {
    const safePrompt = fitPromptForCli(prompt);
    const args = ['-p', safePrompt];
    if (!browserMode) args.push('--yolo');
    if (model) args.push('-m', model);
    return {
      launch: resolveLaunchSpec(bin, args),
      stdinText: null,
      outputFormat: 'plain-text',
      tempFiles: [],
    };
  }

  if (id === 'ollama') {
    const resolvedModel = model || provider.defaultModel || 'llama3.2';
    return {
      launch: resolveLaunchSpec(bin, ['run', resolvedModel]),
      stdinText: String(prompt || ''),
      outputFormat: 'plain-text',
      tempFiles: [],
    };
  }

  // Custom CLI provider
  const template = provider.argsTemplate || '{{prompt}}';
  const rawPrompt = String(prompt || '');
  const argsPrompt = provider.promptDelivery === 'stdin' ? '' : fitPromptForCli(rawPrompt);
  const args = buildCustomArgs(template, {
    prompt: argsPrompt,
    model: model || '',
    cwd,
    sessionId: conversationId || '',
  });
  if (provider.promptDelivery !== 'stdin' && !template.includes('{{prompt}}')) {
    args.push(argsPrompt);
  }
  return {
    launch: resolveLaunchSpec(bin, args),
    stdinText: provider.promptDelivery === 'stdin' ? rawPrompt : null,
    outputFormat: provider.outputFormat || 'plain-text',
    tempFiles: [],
  };
}

function streamPrompt({ providerId, model, prompt, cwd, conversationId, browserMode = true, screenshotPath = '', customProviders, signal, onEvent }) {
  const provider = getProvider(providerId || 'agy', customProviders);
  const workDir = browserMode ? getSandboxDir() : (cwd && fs.existsSync(cwd) ? cwd : process.cwd());
  const inv = buildInvocation({ provider, prompt, model, cwd: workDir, conversationId, browserMode, screenshotPath });

  return new Promise((resolve, reject) => {
    let settled = false;
    let fullContent = '';
    let reasoningText = '';
    let capturedConversationId = conversationId || '';
    let lastError = '';
    let claudeStreamedViaEvents = false;
    let grokStreamedViaEvents = false;
    const stderrChunks = [];

    const cleanup = () => {
      for (const f of inv.tempFiles) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch {}
      }
    };

    const finish = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve({ content: fullContent, reasoning: reasoningText, conversationId: capturedConversationId });
    };

    const child = spawn(inv.launch.command, inv.launch.args, {
      cwd: workDir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    if (inv.stdinText != null) {
      child.stdin.write(inv.stdinText);
    }
    child.stdin.end();

    if (signal) {
      const onAbort = () => {
        killProcessTree(child);
        finish(new Error('Aborted by user'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }

    child.on('error', (err) => {
      const msg = err.code === 'ENOENT'
        ? `CLI "${provider.name}" (${provider.binary}) was not found. Make sure it is installed and in PATH.`
        : `Failed to start ${provider.name} CLI: ${err.message}`;
      finish(new Error(msg));
    });

    const emitDelta = (text) => {
      if (!text) return;
      fullContent += text;
      onEvent?.({ type: 'delta', text });
    };

    const emitReasoning = (text) => {
      if (!text) return;
      reasoningText += text;
      onEvent?.({ type: 'reasoning', text });
    };

    const handleJsonLine = (msg, fmt) => {
      if (msg.conversation_id) capturedConversationId = msg.conversation_id;
      else if (msg.session_id) capturedConversationId = msg.session_id;
      else if (msg.thread_id) capturedConversationId = msg.thread_id;
      else if (msg.result?.conversation_id) capturedConversationId = msg.result.conversation_id;
      else if (msg.step_update?.conversation_id) capturedConversationId = msg.step_update.conversation_id;

      // Agy format
      if (fmt === 'agy-json' || msg.event === 'step_update' || msg.event === 'result') {
        if (msg.event === 'step_update' && msg.step_update) {
          const update = msg.step_update;
          if (update.text_delta) emitDelta(update.text_delta);
          if (update.thinking_delta) emitReasoning(update.thinking_delta);
          if (update.step_type && update.step_type !== 'agent_response' && update.step_type !== 'user_input') {
            const toolName = update.tool_name || update.tool_info?.name || update.step_type;
            onEvent?.({ type: 'activity', text: `${toolName} (${update.state || 'running'})` });
          }
          return;
        }
        if (msg.event === 'result' && msg.result) {
          if (!fullContent && msg.result.response) emitDelta(msg.result.response);
          return;
        }
      }

      // Claude format
      if (fmt === 'claude-json' || msg.type === 'stream_event' || (msg.type === 'result' && 'subtype' in msg)) {
        if (msg.type === 'stream_event' && msg.event) {
          const ev = msg.event;
          if (ev.type === 'content_block_delta' && ev.delta) {
            if (ev.delta.type === 'text_delta' && ev.delta.text) {
              claudeStreamedViaEvents = true;
              emitDelta(ev.delta.text);
            } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
              emitReasoning(ev.delta.thinking);
            }
          } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
            onEvent?.({ type: 'activity', text: `Tool: ${ev.content_block.name || 'tool'}...` });
          }
          return;
        }
        if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
          for (const block of msg.message.content) {
            if (block?.type === 'text' && block.text && !claudeStreamedViaEvents && !fullContent) {
              emitDelta(block.text);
            }
          }
          return;
        }
        if (msg.type === 'result') {
          if (msg.is_error) lastError = msg.result || 'Claude CLI error';
          else if (!fullContent && typeof msg.result === 'string' && msg.result) emitDelta(msg.result);
          return;
        }
      }

      // Codex format
      if (fmt === 'codex-json' || msg.type === 'thread.started' || msg.type === 'turn.completed' || msg.type === 'item.completed') {
        if (msg.type === 'turn.failed') {
          lastError = msg.error?.message || 'Codex CLI error';
          return;
        }
        if (msg.type === 'item.completed' && msg.item) {
          if (msg.item.type === 'agent_message' && msg.item.text) {
            emitDelta(fullContent ? `\n${msg.item.text}` : msg.item.text);
          } else if (msg.item.type === 'reasoning' && msg.item.text) {
            emitReasoning(reasoningText ? `\n${msg.item.text}` : msg.item.text);
          }
          return;
        }
      }

      // Grok format
      if (fmt === 'grok-json' || msg.type === 'available_commands' || msg.type === 'tool_call') {
        if (msg.type === 'available_commands') return;
        if (msg.type === 'error') {
          lastError = msg.message || 'Grok CLI error';
          return;
        }
        if (msg.type === 'thinking') {
          const t = msg.text || msg.thinking || msg.delta || '';
          if (t) emitReasoning(t);
          return;
        }
        if (msg.type === 'assistant') {
          if (typeof msg.text === 'string' && msg.text) {
            grokStreamedViaEvents = true;
            emitDelta(msg.text);
          } else if (Array.isArray(msg.message?.content)) {
            for (const block of msg.message.content) {
              if (block?.type === 'text' && block.text) {
                grokStreamedViaEvents = true;
                emitDelta(block.text);
              }
            }
          }
          return;
        }
        if (msg.type === 'result' && !grokStreamedViaEvents && !fullContent) {
          const resText = typeof msg.result === 'string' ? msg.result : (msg.response || msg.text || '');
          if (resText) emitDelta(resText);
          return;
        }
      }

      // Gemini CLI format
      if (fmt === 'gemini-json' || (msg.type === 'message' && msg.role === 'assistant')) {
        if (msg.type === 'error') {
          lastError = msg.message || msg.error?.message || 'Gemini CLI error';
          return;
        }
        if (msg.type === 'message' && msg.role === 'assistant' && msg.content) {
          emitDelta(msg.content);
          return;
        }
        if (msg.type === 'result' && !fullContent && msg.response) {
          emitDelta(msg.response);
          return;
        }
      }

      // Generic JSON fallback
      if (msg.type === 'error' && msg.message) lastError = msg.message;
      else if (typeof msg.text_delta === 'string') emitDelta(msg.text_delta);
      else if (typeof msg.delta === 'string') emitDelta(msg.delta);
    };

    if (inv.outputFormat === 'plain-text') {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        const clean = stripAnsi(chunk);
        if (clean) emitDelta(clean);
      });
    } else {
      const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      rl.on('line', (line) => {
        const trimmed = stripAnsi(line).trim();
        if (!trimmed) return;
        const parsed = safeJson(trimmed);
        if (parsed && typeof parsed === 'object') {
          handleJsonLine(parsed, inv.outputFormat);
        } else {
          emitDelta(`${trimmed}\n`);
        }
      });
    }

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const text = stripAnsi(chunk).trim();
      if (text) stderrChunks.push(text);
    });

    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0 && !fullContent) {
        const errText = lastError || stderrChunks.join('\n').slice(0, 1000) || `${provider.name} CLI exited with code ${code}`;
        finish(new Error(errText));
      } else {
        finish();
      }
    });
  });
}

module.exports = {
  streamPrompt,
};
