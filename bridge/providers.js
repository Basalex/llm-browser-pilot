const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AGY_MODELS = [
  { id: 'gemini-4-hydrogen-medium', name: 'Gemini 4 Hydrogen (Medium)' },
  { id: 'gemini-4-hydrogen-high', name: 'Gemini 4 Hydrogen (High)' },
  { id: 'gemini-4-hydrogen-xhigh', name: 'Gemini 4 Hydrogen (XHigh)' },
  { id: 'gemini-4-hydrogen-low', name: 'Gemini 4 Hydrogen (Low)' },
  { id: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium)' },
  { id: 'gemini-4-argon-high', name: 'Gemini 4 Argon (High)' },
  { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
  { id: 'claude-sonnet-5-5-medium', name: 'Claude Sonnet 5.5 (Medium)' },
  { id: 'claude-sonnet-5-5-high', name: 'Claude Sonnet 5.5 (High)' },
  { id: 'claude-opus-5-5-medium', name: 'Claude Opus 5.5 (Medium)' },
  { id: 'claude-opus-5-5-high', name: 'Claude Opus 5.5 (High)' },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
];

const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'sonnet', name: 'Sonnet (alias)' },
  { id: 'opus', name: 'Opus (alias)' },
  { id: 'haiku', name: 'Haiku (alias)' },
  { id: '', name: 'Default (Claude CLI)' },
];

const CODEX_DEFAULT_MODELS = [
  { id: 'gpt-6-luna', name: 'GPT-6-Luna' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna' },
  { id: 'gpt-5.5', name: 'GPT-5.5' },
  { id: 'o3', name: 'o3' },
  { id: '', name: 'Default (Codex CLI)' },
];

const GROK_MODELS = [
  { id: 'grok-4.7', name: 'Grok 4.7' },
  { id: 'grok-4.5', name: 'Grok 4.5' },
  { id: 'grok-4-fast', name: 'Grok 4 Fast' },
  { id: '', name: 'Default (Grok CLI)' },
];

const GEMINI_MODELS = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: '', name: 'Default (Gemini CLI)' },
];

const OLLAMA_MODELS = [
  { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder 14B' },
  { id: 'llama3.2', name: 'Llama 3.2' },
  { id: 'mistral', name: 'Mistral' },
];

const QWEN_MODELS = [
  { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus' },
  { id: 'qwen3-coder-flash', name: 'Qwen3 Coder Flash' },
  { id: '', name: 'Default (Qwen CLI)' },
];

const KIMI_MODELS = [
  { id: 'kimi-k2.5', name: 'Kimi K2.5' },
  { id: 'kimi-k2', name: 'Kimi K2' },
  { id: 'kimi-for-coding', name: 'Kimi for Coding' },
  { id: '', name: 'Default (Kimi CLI)' },
];

const IFLOW_MODELS = [
  { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus' },
  { id: 'deepseek-v3.2', name: 'DeepSeek V3.2' },
  { id: 'kimi-k2', name: 'Kimi K2' },
  { id: 'glm-4.7', name: 'GLM-4.7' },
  { id: '', name: 'Default (iFlow CLI)' },
];

function findInPath(cmdName) {
  const raw = String(cmdName || '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw) && fs.existsSync(raw)) return raw;
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (path.extname(raw) ? [''] : ['.exe', '.cmd', '.bat', '.com', ''])
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${raw}${ext}`);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return '';
}

function findFirstExisting(candidates, fallbackName) {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return findInPath(fallbackName) || fallbackName;
}

function findAgyBinary() {
  const local = process.env.LOCALAPPDATA || '';
  const home = os.homedir();
  return findFirstExisting([
    path.join(local, 'agy', 'bin', 'agy.exe'),
    path.join(home, 'AppData', 'Local', 'agy', 'bin', 'agy.exe'),
    path.join(home, '.gemini', 'antigravity-cli', 'bin', 'agy.exe'),
    path.join(home, '.gemini', 'antigravity', 'bin', 'agy.exe'),
  ], 'agy');
}

function findGrokBinary() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || '';
  return findFirstExisting([
    path.join(home, '.grok', 'bin', 'grok.exe'),
    path.join(local, 'grok', 'bin', 'grok.exe'),
  ], 'grok');
}

function findCodexBinary() {
  const home = os.homedir();
  const appData = process.env.APPDATA || '';
  return findFirstExisting([
    path.join(appData, 'npm', 'codex.cmd'),
    path.join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
  ], 'codex');
}

function findClaudeBinary() {
  const home = os.homedir();
  const appData = process.env.APPDATA || '';
  const local = process.env.LOCALAPPDATA || '';
  return findFirstExisting([
    path.join(home, '.local', 'bin', 'claude.exe'),
    path.join(local, 'Programs', 'claude', 'claude.exe'),
    path.join(appData, 'npm', 'claude.cmd'),
  ], 'claude');
}

function findGeminiBinary() {
  const appData = process.env.APPDATA || '';
  return findFirstExisting([
    path.join(appData, 'npm', 'gemini.cmd'),
  ], 'gemini');
}

function findOllamaBinary() {
  const local = process.env.LOCALAPPDATA || '';
  return findFirstExisting([
    path.join(local, 'Programs', 'Ollama', 'ollama.exe'),
  ], 'ollama');
}

function findQwenBinary() {
  const appData = process.env.APPDATA || '';
  return findFirstExisting([
    path.join(appData, 'npm', 'qwen.cmd'),
  ], 'qwen');
}

function findKimiBinary() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || '';
  return findFirstExisting([
    path.join(home, '.local', 'bin', 'kimi.exe'),
    path.join(local, 'Programs', 'kimi', 'kimi.exe'),
  ], 'kimi');
}

function findIflowBinary() {
  const appData = process.env.APPDATA || '';
  return findFirstExisting([
    path.join(appData, 'npm', 'iflow.cmd'),
  ], 'iflow');
}

function readCodexCachedModels() {
  try {
    const file = path.join(os.homedir(), '.codex', 'models_cache.json');
    if (!fs.existsSync(file)) return CODEX_DEFAULT_MODELS;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const models = Array.isArray(raw?.models) ? raw.models : [];
    const visible = models
      .filter((m) => m && m.slug && m.visibility !== 'hide')
      .map((m) => ({ id: String(m.slug), name: String(m.display_name || m.slug) }));
    const seen = new Set(visible.map((m) => m.id));
    for (const def of CODEX_DEFAULT_MODELS) {
      if (def.id && !seen.has(def.id)) {
        seen.add(def.id);
        visible.push(def);
      }
    }
    visible.push({ id: '', name: 'Default (Codex CLI)' });
    return visible.length ? visible : CODEX_DEFAULT_MODELS;
  } catch {
    return CODEX_DEFAULT_MODELS;
  }
}

function resolveLaunchSpec(binary, args = []) {
  const raw = String(binary || '').trim();
  if (!raw) return { command: raw, args };

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(raw) && fs.existsSync(raw)) {
    try {
      const content = fs.readFileSync(raw, 'utf8');
      const dir = path.dirname(raw);
      const exeMatch = content.match(/"%dp0%\\([^"]+\.exe)"/i);
      if (exeMatch) {
        const targetExe = path.resolve(dir, exeMatch[1]);
        if (fs.existsSync(targetExe)) {
          return { command: targetExe, args };
        }
      }
      const jsMatch = content.match(/"%dp0%\\([^"]+\.(?:js|mjs|cjs))"/i);
      if (jsMatch) {
        const targetJs = path.resolve(dir, jsMatch[1]);
        if (fs.existsSync(targetJs)) {
          const localNode = path.join(dir, 'node.exe');
          const nodeCmd = fs.existsSync(localNode) ? localNode : (findInPath('node') || 'node');
          return { command: nodeCmd, args: [targetJs, ...args] };
        }
      }
    } catch {}
    return { command: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/c', raw, ...args] };
  }

  return { command: raw, args };
}

function isBinaryAvailable(cmd) {
  const raw = String(cmd || '').trim();
  if (!raw) return false;
  if (path.isAbsolute(raw)) return fs.existsSync(raw);
  return Boolean(findInPath(raw));
}

const BUILTIN_PROVIDERS = [
  {
    id: 'agy',
    name: 'Agy',
    fullName: 'Antigravity CLI',
    icon: '⚡',
    color: '#4796ff',
    defaultModel: 'claude-sonnet-5-5-medium',
    outputFormat: 'agy-json',
    getBinary: findAgyBinary,
    getModels: () => AGY_MODELS,
  },
  {
    id: 'claude',
    name: 'Claude',
    fullName: 'Claude Code CLI',
    icon: '✦',
    color: '#d97706',
    defaultModel: 'claude-opus-5-5',
    outputFormat: 'claude-json',
    getBinary: findClaudeBinary,
    getModels: () => CLAUDE_MODELS,
  },
  {
    id: 'codex',
    name: 'Codex',
    fullName: 'OpenAI Codex CLI',
    icon: '◈',
    color: '#10b981',
    defaultModel: 'gpt-6-luna',
    outputFormat: 'codex-json',
    getBinary: findCodexBinary,
    getModels: readCodexCachedModels,
  },
  {
    id: 'grok',
    name: 'Grok',
    fullName: 'Grok CLI',
    icon: '𝕏',
    color: '#f59e0b',
    defaultModel: 'grok-4.7',
    outputFormat: 'grok-json',
    getBinary: findGrokBinary,
    getModels: () => GROK_MODELS,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    fullName: 'Gemini CLI',
    icon: '✧',
    color: '#3b82f6',
    defaultModel: 'gemini-2.5-pro',
    outputFormat: 'gemini-json',
    getBinary: findGeminiBinary,
    getModels: () => GEMINI_MODELS,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    fullName: 'Ollama Local CLI',
    icon: '🦙',
    color: '#8b5cf6',
    defaultModel: 'qwen2.5-coder:14b',
    outputFormat: 'plain-text',
    getBinary: findOllamaBinary,
    getModels: () => OLLAMA_MODELS,
  },
  {
    id: 'qwen',
    name: 'Qwen',
    fullName: 'Qwen Code CLI (OAuth / Subscription)',
    icon: '🟣',
    color: '#7c3aed',
    defaultModel: 'qwen3-coder-plus',
    outputFormat: 'gemini-json',
    getBinary: findQwenBinary,
    getModels: () => QWEN_MODELS,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    fullName: 'Kimi Code CLI (Subscription)',
    icon: '🌙',
    color: '#06b6d4',
    defaultModel: 'kimi-k2.5',
    outputFormat: 'claude-json',
    getBinary: findKimiBinary,
    getModels: () => KIMI_MODELS,
  },
  {
    id: 'iflow',
    name: 'iFlow',
    fullName: 'iFlow CLI (OAuth / Subscription)',
    icon: '🌊',
    color: '#14b8a6',
    defaultModel: 'qwen3-coder-plus',
    outputFormat: 'plain-text',
    getBinary: findIflowBinary,
    getModels: () => IFLOW_MODELS,
  },
];

function listProviders(customProviders = []) {
  const result = BUILTIN_PROVIDERS.map((p) => {
    const binary = p.getBinary();
    const available = isBinaryAvailable(binary);
    return {
      id: p.id,
      name: p.name,
      fullName: p.fullName,
      icon: p.icon,
      color: p.color,
      builtin: true,
      binary,
      available,
      defaultModel: p.defaultModel,
      outputFormat: p.outputFormat,
      models: p.getModels(),
    };
  });

  for (const cp of Array.isArray(customProviders) ? customProviders : []) {
    if (!cp || !cp.id || !cp.command) continue;
    const binary = findInPath(cp.command) || cp.command;
    result.push({
      id: String(cp.id),
      name: String(cp.name || cp.id),
      fullName: String(cp.fullName || cp.name || cp.id),
      icon: String(cp.icon || '⚙'),
      color: String(cp.color || '#94a3b8'),
      builtin: false,
      binary,
      available: isBinaryAvailable(binary),
      defaultModel: String(cp.defaultModel || ''),
      outputFormat: String(cp.outputFormat || 'plain-text'),
      argsTemplate: String(cp.argsTemplate || '{{prompt}}'),
      promptDelivery: String(cp.promptDelivery || 'arg'),
      models: Array.isArray(cp.models) ? cp.models : [],
    });
  }

  return result;
}

function getProvider(providerId, customProviders = []) {
  const all = listProviders(customProviders);
  return all.find((p) => p.id === providerId) || all[0];
}

module.exports = {
  AGY_MODELS,
  listProviders,
  getProvider,
  resolveLaunchSpec,
  isBinaryAvailable,
};
