const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const { listProviders, resolveLaunchSpec } = require('./providers');

const ROOT_DIR = path.resolve(__dirname, '..');
const EXTENSION_DIR = path.join(ROOT_DIR, 'extension');
const MCP_SCRIPT = path.join(__dirname, 'mcp.js');
const BRIDGE_URL = 'http://127.0.0.1:4399/api/health';

function checkBridgeHealth() {
  return new Promise((resolve) => {
    const req = http.get(BRIDGE_URL, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function findExecutable(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return '';
}

function getBrowsers() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';

  const browsers = [
    {
      id: 'chrome',
      name: 'Google Chrome',
      exe: findExecutable([
        path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
      ]),
      userDataDir: path.join(local, 'Google\\Chrome\\User Data'),
      extensionsUrl: 'chrome://extensions',
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      exe: findExecutable([
        path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(local, 'Microsoft\\Edge\\Application\\msedge.exe'),
      ]),
      userDataDir: path.join(local, 'Microsoft\\Edge\\User Data'),
      extensionsUrl: 'edge://extensions',
    },
  ];

  return browsers.filter((b) => Boolean(b.exe));
}

function isExtensionInProfile(userDataDir, profileDir) {
  const prefFiles = ['Secure Preferences', 'Preferences'];
  for (const file of prefFiles) {
    const fullPath = path.join(userDataDir, profileDir, file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      if (raw.includes(EXTENSION_DIR.replace(/\\/g, '\\\\')) || raw.includes('LLM Browser Pilot')) {
        return true;
      }
    } catch {}
  }
  return false;
}

function readBrowserProfiles(browser) {
  const localStatePath = path.join(browser.userDataDir, 'Local State');
  const profiles = [];

  if (fs.existsSync(localStatePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
      const infoCache = data?.profile?.info_cache || {};
      for (const [dirName, meta] of Object.entries(infoCache)) {
        profiles.push({
          browser,
          profileDir: dirName,
          displayName: meta.name || dirName,
          account: meta.user_name || meta.gaia_name || '',
          installed: isExtensionInProfile(browser.userDataDir, dirName),
        });
      }
    } catch {}
  }

  if (profiles.length === 0 && fs.existsSync(path.join(browser.userDataDir, 'Default'))) {
    profiles.push({
      browser,
      profileDir: 'Default',
      displayName: 'Default',
      account: '',
      installed: isExtensionInProfile(browser.userDataDir, 'Default'),
    });
  }

  return profiles;
}

function copyToClipboard(text) {
  try {
    const res = spawnSync('clip', [], { input: text, encoding: 'utf8' });
    return res.status === 0;
  } catch {
    return false;
  }
}

function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function ensureMcpRegistered(providers) {
  if (!fs.existsSync(MCP_SCRIPT)) return [];
  const supported = new Set(['agy', 'codex', 'gemini', 'claude', 'grok']);
  const results = [];

  for (const p of providers) {
    if (!p.available || !supported.has(p.id)) continue;
    try {
      const listSpec = resolveLaunchSpec(p.binary, ['mcp', 'list']);
      const listRes = spawnSync(listSpec.command, listSpec.args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4500,
      });
      const listOut = `${listRes.stdout || ''}\n${listRes.stderr || ''}`;
      if (listOut.includes('llm-browser-pilot')) {
        results.push(`${p.name} (ready)`);
        continue;
      }

      const addArgs = (p.id === 'codex' || p.id === 'claude' || p.id === 'grok')
        ? ['mcp', 'add', 'llm-browser-pilot', '--', process.execPath, MCP_SCRIPT]
        : ['mcp', 'add', 'llm-browser-pilot', process.execPath, MCP_SCRIPT];
      const addSpec = resolveLaunchSpec(p.binary, addArgs);
      const addRes = spawnSync(addSpec.command, addSpec.args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      });
      if (addRes.status === 0) {
        results.push(`${p.name} (added)`);
      } else {
        results.push(`${p.name} (skipped)`);
      }
    } catch {
      results.push(`${p.name} (skipped)`);
    }
  }
  return results;
}

async function main() {
  console.log('');
  console.log('====================================================');
  console.log('  LLM Browser Pilot - Setup & Launcher');
  console.log('====================================================');

  const bridgeUp = await checkBridgeHealth();
  console.log(`Bridge status : ${bridgeUp ? 'ONLINE (http://127.0.0.1:4399)' : 'OFFLINE'}`);

  const providers = listProviders([]);
  const available = providers.filter((p) => p.available);
  if (available.length > 0) {
    console.log(`Detected CLIs : ${available.map((p) => p.name).join(', ')}`);
    const mcpResults = ensureMcpRegistered(available);
    if (mcpResults.length > 0) {
      console.log(`MCP server    : ${mcpResults.join(', ')}`);
    }
  } else {
    console.log('Detected CLIs : NONE found in PATH');
    console.log('  Tip: Install at least one CLI (e.g. ollama, claude, codex, gemini, grok, agy)');
    console.log('       or add a Custom CLI inside the extension settings.');
  }
  console.log('');

  const browsers = getBrowsers();
  const allProfiles = browsers.flatMap((b) => readBrowserProfiles(b));

  if (allProfiles.length === 0) {
    console.log('No Chrome or Edge profiles detected automatically.');
    console.log(`Extension folder: ${EXTENSION_DIR}`);
    console.log('Open chrome://extensions -> Enable Developer mode -> Load unpacked.');
    return;
  }

  console.log('Select a browser profile to open/install the extension:');
  allProfiles.forEach((p, idx) => {
    const acct = p.account ? ` - ${p.account}` : '';
    const status = p.installed ? ' [extension detected]' : '';
    console.log(`  [${idx + 1}] ${p.browser.name}: ${p.displayName} (${p.profileDir}${acct})${status}`);
  });
  console.log('  [0] Skip opening browser (bridge only)');
  console.log('');

  const choice = await askQuestion(`Enter choice [1-${allProfiles.length}, or 0]: `);
  const num = Number.parseInt(choice, 10);

  if (choice === '0' || Number.isNaN(num) || num < 1 || num > allProfiles.length) {
    if (choice !== '0') console.log('No valid profile selected. Keeping bridge running.');
    return;
  }

  const selected = allProfiles[num - 1];
  const copied = copyToClipboard(EXTENSION_DIR);

  console.log('');
  console.log(`Opening ${selected.browser.name} (${selected.displayName})...`);
  if (!selected.installed) {
    console.log('');
    console.log('First-time setup in this profile:');
    console.log('  1. Enable "Developer mode" (top-right toggle).');
    console.log('  2. Click "Load unpacked".');
    console.log(`  3. Paste the extension path${copied ? ' (already copied to your clipboard!)' : ''}:`);
    console.log(`     ${EXTENSION_DIR}`);
  }

  const targetUrl = selected.installed ? 'https://www.google.com' : selected.browser.extensionsUrl;
  const child = spawn(
    selected.browser.exe,
    [`--profile-directory=${selected.profileDir}`, targetUrl],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
}

main().catch((err) => {
  console.error('Launcher error:', err.message);
  process.exit(1);
});
