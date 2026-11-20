(function (globalScope) {
  const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:4399';

  const DEFAULT_MODULES = [
    {
      id: 'general-pilot',
      name: 'Browser Pilot',
      icon: '🧭',
      description: 'Universal browser assistant. Reads page DOM & executes browser_action blocks.',
      builtin: true,
      enabled: true,
      autoExtract: true,
      autoActivate: false,
      preferredProvider: '',
      preferredModel: '',
      bindings: [],
      systemPrompt: [
        'You are LLM Browser Pilot, an AI assistant running inside Chrome via a local CLI wrapper.',
        'When the user asks you to interact with the current web page (click, type, scroll, navigate, select, highlight, extract),',
        'output one or more ```browser_action``` JSON blocks using the indexed DOM elements [#N] provided in the page context.',
        'Supported actions:',
        '- {"type": "click", "index": 0} or {"type": "click", "text": "Button"}',
        '- {"type": "type", "index": 0, "value": "text", "pressEnter": true}',
        '- {"type": "select", "index": 0, "value": "option"}',
        '- {"type": "scroll", "direction": "down", "amount": 500}',
        '- {"type": "navigate", "url": "https://..."}',
        '- {"type": "press_key", "key": "Escape"}',
        '- {"type": "highlight", "index": 0}',
        'Be concise, accurate, and always explain what each action does.'
      ].join('\n'),
      quickActions: [
        { label: 'Summarize page', prompt: 'Summarize the key points of this page concisely.' },
        { label: 'List interactive actions', prompt: 'List the main actions/forms available on this page using the [#N] elements.' },
        { label: 'Extract structured data', prompt: 'Extract the main structured data (tables, lists, key-value pairs) from this page as Markdown.' }
      ],
      customHtml: ''
    },
    {
      id: 'page-summarizer',
      name: 'Page Summarizer',
      icon: '📄',
      description: 'Extracts TL;DR, key takeaways, entities, and links from articles or docs.',
      builtin: true,
      enabled: true,
      autoExtract: true,
      autoActivate: false,
      preferredProvider: '',
      preferredModel: '',
      bindings: [],
      systemPrompt: [
        'You are a precision reading & extraction assistant.',
        'Analyze the provided page text and produce:',
        '1. **TL;DR** (2-3 sentences)',
        '2. **Key Takeaways** (bullet list)',
        '3. **Actionable Items / Important Links** (if any)'
      ].join('\n'),
      quickActions: [
        { label: 'TL;DR + Bullets', prompt: 'Give me a TL;DR and 5 key bullet points from this page.' },
        { label: 'Explain simply', prompt: 'Explain the content of this page in simple terms.' }
      ],
      customHtml: ''
    },
    {
      id: 'github-reviewer',
      name: 'GitHub Pilot',
      icon: '🐙',
      description: 'Code, PR, and issue assistant automatically bound to github.com.',
      builtin: true,
      enabled: true,
      autoExtract: true,
      autoActivate: true,
      preferredProvider: '',
      preferredModel: '',
      bindings: ['github.com'],
      systemPrompt: [
        'You are an expert senior software engineer reviewing a GitHub repository, issue, or Pull Request.',
        'Focus on architecture, edge cases, security, performance, and concrete code suggestions.',
        'If the user asks to navigate or click tabs/files on GitHub, emit ```browser_action``` blocks.'
      ].join('\n'),
      quickActions: [
        { label: 'Review this page', prompt: 'Review the code / PR / issue shown on this GitHub page and highlight potential bugs or improvements.' },
        { label: 'Explain repo/file', prompt: 'Explain what this repository or file does and how it is structured.' }
      ],
      customHtml: ''
    },
    {
      id: 'form-pilot',
      name: 'Form Pilot',
      icon: '📝',
      description: 'Inspects form fields on the page and fills them via browser_action blocks.',
      builtin: true,
      enabled: true,
      autoExtract: true,
      autoActivate: true,
      preferredProvider: '',
      preferredModel: '',
      bindings: ['docs.google.com/forms/*', 'forms.gle/*'],
      systemPrompt: [
        'You are a Form Filling Pilot.',
        'Inspect all input, textarea, and select elements [#N] in the page context.',
        'When asked to fill a form, emit ```browser_action``` blocks with {"type": "type", "index": N, "value": "..."} or {"type": "select", "index": N, "value": "..."}.',
        'Never submit a form unless the user explicitly asks you to click Submit.'
      ].join('\n'),
      quickActions: [
        { label: 'Analyze form fields', prompt: 'List all form fields on this page with their [#N] index and expected values.' },
        { label: 'Fill with test data', prompt: 'Fill out the visible form fields with realistic test data (do NOT click submit).' }
      ],
      customHtml: ''
    },
    {
      id: 'file-pilot',
      name: 'File & Form Pilot',
      icon: '📎',
      description: 'Attach reference files (resume, docs, JSON, notes) so the LLM can read them and fill out forms.',
      builtin: true,
      enabled: true,
      supportsFiles: true,
      autoExtract: true,
      autoActivate: false,
      preferredProvider: '',
      preferredModel: '',
      bindings: [],
      systemPrompt: [
        'You are File & Form Pilot, an AI assistant with access to user-attached reference files (such as a resume, profile, or notes) provided in the [ATTACHED FILES] section.',
        'Use the attached files as the authoritative source of facts when answering questions or filling out forms on the current page.',
        'When filling out a form:',
        '- Match each form field [#N] to the corresponding information in the attached files.',
        '- Emit ```browser_action``` blocks with {"type": "type", "index": N, "value": "..."} or {"type": "select", "index": N, "value": "..."} or {"type": "click", "index": N}.',
        '- Never fabricate personal details (phone, email, address, dates) that are not present in the attached files; if something is missing, leave it blank and tell the user.',
        '- Never click Submit unless the user explicitly asks you to submit.'
      ].join('\n'),
      quickActions: [
        { label: 'Fill form from files', prompt: 'Using the attached file(s), inspect all form fields [#N] on this page and fill them out accurately with browser_action blocks. Do NOT click submit unless I ask.' },
        { label: 'Match page to files', prompt: 'Compare the current page against my attached file(s) and highlight matches, gaps, and suggested answers.' },
        { label: 'Summarize files', prompt: 'Summarize the key facts from my attached files.' }
      ],
      customHtml: ''
    }
  ];

  function escapeRegex(str) {
    return str.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }

  function matchBinding(pattern, urlString) {
    const raw = String(pattern || '').trim();
    if (!raw || !urlString) return false;
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      return false;
    }

    // Regex pattern: /.../flags
    const regexMatch = raw.match(/^\/(.+)\/([gimsuy]*)$/);
    if (regexMatch) {
      try {
        return new RegExp(regexMatch[1], regexMatch[2]).test(urlString);
      } catch {
        return false;
      }
    }

    const host = parsed.hostname.toLowerCase();
    const hostAndPath = (parsed.hostname + parsed.pathname + parsed.search).toLowerCase();
    const target = raw.toLowerCase();

    // Plain domain (no scheme, no slash, no wildcard) -> matches exact domain or subdomain
    if (!target.includes('://') && !target.includes('/') && !target.includes('*')) {
      return host === target || host.endsWith('.' + target);
    }

    // Wildcard pattern
    if (target.includes('*')) {
      const hasScheme = target.includes('://');
      const regexStr = '^' + target.split('*').map(escapeRegex).join('.*') + '$';
      try {
        const re = new RegExp(regexStr, 'i');
        return hasScheme ? re.test(urlString) : re.test(hostAndPath);
      } catch {
        return false;
      }
    }

    // Prefix match (e.g. https://github.com/user or github.com/user)
    if (target.includes('://')) {
      return urlString.toLowerCase().startsWith(target);
    }
    return hostAndPath.startsWith(target);
  }

  function getMatchedModules(modules, urlString) {
    if (!Array.isArray(modules) || !urlString) return [];
    return modules.filter((mod) => {
      if (!mod || mod.enabled === false) return false;
      const bindings = Array.isArray(mod.bindings) ? mod.bindings : [];
      return bindings.some((b) => matchBinding(b, urlString));
    });
  }

  const MAX_ATTACHED_FILES_CHARS = 60000;

  function formatAttachedFilesSection(files) {
    if (!Array.isArray(files) || !files.length) return '';
    const active = files.filter((f) => f && f.enabled !== false && typeof f.content === 'string' && f.content.trim());
    if (!active.length) return '';

    let remaining = MAX_ATTACHED_FILES_CHARS;
    const blocks = [];
    for (const file of active) {
      if (remaining <= 0) break;
      const raw = file.content;
      const sliced = raw.length > remaining ? `${raw.slice(0, remaining)}\n...[truncated]` : raw;
      remaining -= sliced.length;
      const safeName = String(file.name || 'untitled').replace(/"/g, "'");
      blocks.push(`<attached_file name="${safeName}" chars="${raw.length}">\n${sliced}\n</attached_file>`);
    }

    if (!blocks.length) return '';
    return `[ATTACHED FILES (${blocks.length} active)]\nUse these user-provided files as reference data:\n${blocks.join('\n\n')}`;
  }

  async function loadPilotState() {
    const data = await chrome.storage.local.get([
      'bridgeUrl',
      'selectedProvider',
      'selectedModel',
      'modules',
      'activeModuleId',
      'customProviders',
      'autoRunActions',
      'includePageContext',
      'conversations',
      'chatHistory',
      'activeChatId',
      'siteMemory',
      'attachedFiles',
      'migratedBuiltins'
    ]);

    let modules = Array.isArray(data.modules) && data.modules.length
      ? data.modules
      : structuredClone(DEFAULT_MODULES);

    const migratedBuiltins = Array.isArray(data.migratedBuiltins) ? [...data.migratedBuiltins] : [];
    if (Array.isArray(data.modules) && data.modules.length && !migratedBuiltins.includes('file-pilot')) {
      const filePilot = DEFAULT_MODULES.find((m) => m.id === 'file-pilot');
      if (filePilot && !modules.some((m) => m.id === 'file-pilot')) {
        modules = [...modules, structuredClone(filePilot)];
      }
      migratedBuiltins.push('file-pilot');
      await chrome.storage.local.set({ modules, migratedBuiltins });
    }

    return {
      bridgeUrl: data.bridgeUrl || DEFAULT_BRIDGE_URL,
      selectedProvider: data.selectedProvider || 'agy',
      selectedModel: data.selectedModel || '',
      modules,
      activeModuleId: data.activeModuleId || modules[0]?.id || 'general-pilot',
      customProviders: Array.isArray(data.customProviders) ? data.customProviders : [],
      autoRunActions: data.autoRunActions !== undefined ? Boolean(data.autoRunActions) : true,
      includePageContext: data.includePageContext !== undefined ? Boolean(data.includePageContext) : true,
      conversations: data.conversations && typeof data.conversations === 'object' ? data.conversations : {},
      chatHistory: Array.isArray(data.chatHistory) ? data.chatHistory : [],
      activeChatId: data.activeChatId || '',
      siteMemory: data.siteMemory && typeof data.siteMemory === 'object' ? data.siteMemory : {},
      attachedFiles: Array.isArray(data.attachedFiles) ? data.attachedFiles : []
    };
  }

  async function savePilotState(patch) {
    await chrome.storage.local.set(patch);
  }

  const api = {
    DEFAULT_BRIDGE_URL,
    DEFAULT_MODULES,
    matchBinding,
    getMatchedModules,
    formatAttachedFilesSection,
    loadPilotState,
    savePilotState
  };

  if (typeof globalScope !== 'undefined') {
    globalScope.PilotModules = api;
  }
})(typeof self !== 'undefined' ? self : window);
