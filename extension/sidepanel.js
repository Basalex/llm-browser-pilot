(function () {
  const state = {
    bridgeUrl: PilotModules.DEFAULT_BRIDGE_URL,
    bridgeOnline: false,
    providers: [],
    customProviders: [],
    selectedProvider: 'agy',
    selectedModel: '',
    modules: [],
    activeModuleId: 'general-pilot',
    autoRunActions: false,
    includePageContext: true,
    conversations: {},
    chatHistory: [],
    activeChatId: '',
    siteMemory: {},
    attachedFiles: [],
    running: false,
    currentTab: { id: null, url: '', title: '' },
    matchedModuleIds: [],
    editingModuleId: null,
    editingFileId: null,
  };

  const els = {
    bridgeDot: document.getElementById('bridgeDot'),
    refreshProvidersBtn: document.getElementById('refreshProvidersBtn'),
    newChatBtn: document.getElementById('newChatBtn'),
    providerSelect: document.getElementById('providerSelect'),
    modelSelect: document.getElementById('modelSelect'),
    domainPill: document.getElementById('domainPill'),
    siteNotesBtn: document.getElementById('siteNotesBtn'),
    activeModulePill: document.getElementById('activeModulePill'),
    matchedCountBadge: document.getElementById('matchedCountBadge'),
    runningBar: document.getElementById('runningBar'),
    runningText: document.getElementById('runningText'),
    topStopBtn: document.getElementById('topStopBtn'),
    customModulePanel: document.getElementById('customModulePanel'),
    fileAttachmentsPanel: document.getElementById('fileAttachmentsPanel'),
    filePanelTitle: document.getElementById('filePanelTitle'),
    attachFileInput: document.getElementById('attachFileInput'),
    pasteTextFileBtn: document.getElementById('pasteTextFileBtn'),
    clearFilesBtn: document.getElementById('clearFilesBtn'),
    filePanelError: document.getElementById('filePanelError'),
    attachedFilesList: document.getElementById('attachedFilesList'),
    messages: document.getElementById('messages'),
    emptyState: document.getElementById('emptyState'),
    quickActions: document.getElementById('quickActions'),
    includeContextToggle: document.getElementById('includeContextToggle'),
    autoRunToggle: document.getElementById('autoRunToggle'),
    promptInput: document.getElementById('promptInput'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn'),
    historyList: document.getElementById('historyList'),
    historyNewChatBtn: document.getElementById('historyNewChatBtn'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    modulesList: document.getElementById('modulesList'),
    newModuleBtn: document.getElementById('newModuleBtn'),
    moduleEditorModal: document.getElementById('moduleEditorModal'),
    editorTitle: document.getElementById('editorTitle'),
    closeEditorBtn: document.getElementById('closeEditorBtn'),
    cancelEditorBtn: document.getElementById('cancelEditorBtn'),
    saveModuleBtn: document.getElementById('saveModuleBtn'),
    modIcon: document.getElementById('modIcon'),
    modName: document.getElementById('modName'),
    modDesc: document.getElementById('modDesc'),
    modSystemPrompt: document.getElementById('modSystemPrompt'),
    modBindings: document.getElementById('modBindings'),
    modAutoActivate: document.getElementById('modAutoActivate'),
    modAutoExtract: document.getElementById('modAutoExtract'),
    modSupportsFiles: document.getElementById('modSupportsFiles'),
    modProvider: document.getElementById('modProvider'),
    modModel: document.getElementById('modModel'),
    modQuickActions: document.getElementById('modQuickActions'),
    modCustomHtml: document.getElementById('modCustomHtml'),
    siteMemoryModal: document.getElementById('siteMemoryModal'),
    closeSiteMemBtn: document.getElementById('closeSiteMemBtn'),
    cancelSiteMemBtn: document.getElementById('cancelSiteMemBtn'),
    saveSiteMemBtn: document.getElementById('saveSiteMemBtn'),
    deleteSiteMemBtn: document.getElementById('deleteSiteMemBtn'),
    siteMemDomainSelect: document.getElementById('siteMemDomainSelect'),
    siteMemContent: document.getElementById('siteMemContent'),
    fileModal: document.getElementById('fileModal'),
    fileModalTitle: document.getElementById('fileModalTitle'),
    closeFileModalBtn: document.getElementById('closeFileModalBtn'),
    cancelFileModalBtn: document.getElementById('cancelFileModalBtn'),
    saveFileModalBtn: document.getElementById('saveFileModalBtn'),
    fileModalName: document.getElementById('fileModalName'),
    fileModalContent: document.getElementById('fileModalContent'),
    bridgeUrlInput: document.getElementById('bridgeUrlInput'),
    saveBridgeBtn: document.getElementById('saveBridgeBtn'),
    addCustomCliBtn: document.getElementById('addCustomCliBtn'),
    customCliList: document.getElementById('customCliList'),
    exportModulesBtn: document.getElementById('exportModulesBtn'),
    importModulesInput: document.getElementById('importModulesInput'),
    resetModulesBtn: document.getElementById('resetModulesBtn'),
  };

  function getActiveModule() {
    return state.modules.find((m) => m.id === state.activeModuleId) || state.modules[0];
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderSimpleMarkdown(text) {
    const escaped = escapeHtml(text);
    // Extract code blocks first
    const blocks = [];
    let processed = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      if (lang === 'browser_action' || lang === 'plan_update' || lang === 'site_memory') return '';
      const idx = blocks.length;
      blocks.push(`<pre><code>${code}</code></pre>`);
      return `__CODE_BLOCK_${idx}__`;
    });

    processed = processed
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^- (.+)$/gm, '• $1')
      .replace(/\n/g, '<br/>');

    for (let i = 0; i < blocks.length; i += 1) {
      processed = processed.replace(`__CODE_BLOCK_${i}__`, blocks[i]);
    }
    return processed;
  }

  function extractBrowserActions(text) {
    const actions = [];
    const re = /```browser_action\s*([\s\S]*?)```/gi;
    let match;
    while ((match = re.exec(text)) !== null) {
      const raw = match[1].trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) actions.push(...parsed);
        else if (parsed && typeof parsed === 'object') actions.push(parsed);
        continue;
      } catch {
        // Fallback: multiple JSON lines inside a single block
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) continue;
          try {
            const obj = JSON.parse(trimmed);
            if (obj && typeof obj === 'object') actions.push(obj);
          } catch {}
        }
      }
    }
    return actions;
  }

  function extractPlanUpdates(text) {
    const updates = [];
    const re = /```plan_update\s*([\s\S]*?)```/gi;
    let match;
    while ((match = re.exec(text)) !== null) {
      const raw = match[1].trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') updates.push(parsed);
      } catch {
        updates.push({ reason: raw, steps: [] });
      }
    }
    return updates;
  }

  function renderPlanUpdateCards(msgEl, updates, stateTracker, maxReplans) {
    const container = msgEl.querySelector('.msg-actions');
    for (const upd of updates) {
      const allowed = stateTracker.replansUsed < maxReplans;
      if (allowed) stateTracker.replansUsed += 1;
      const card = document.createElement('div');
      card.className = 'action-card';
      const stepsHtml = Array.isArray(upd.steps) && upd.steps.length
        ? `<div class="action-code">${upd.steps.map((s, i) => `${i + 1}. ${escapeHtml(s)}`).join('\n')}</div>`
        : '';
      card.innerHTML = `
        <div class="action-card-head">
          <span class="action-badge">${allowed ? `🔄 Plan revised (${stateTracker.replansUsed}/${maxReplans})` : `⚠ Plan revision limit reached (${maxReplans}/${maxReplans})`}</span>
        </div>
        <div class="muted small">${escapeHtml(upd.reason || 'Adjusted plan based on page state')}</div>
        ${stepsHtml}
      `;
      container.prepend(card);
    }
  }

  async function refreshProviders() {
    try {
      const res = await fetch(`${state.bridgeUrl}/api/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customProviders: state.customProviders }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.providers = Array.isArray(data.providers) ? data.providers : [];
      state.bridgeOnline = true;
    } catch {
      state.bridgeOnline = false;
      state.providers = [];
    }
    renderBridgeStatus();
    renderProviderSelectors();
  }

  function renderBridgeStatus() {
    els.bridgeDot.classList.toggle('online', state.bridgeOnline);
    els.bridgeDot.title = state.bridgeOnline
      ? `Bridge online at ${state.bridgeUrl}`
      : `Bridge offline (${state.bridgeUrl}) — run start-bridge.cmd or npm start`;
  }

  function renderProviderSelectors() {
    els.providerSelect.innerHTML = '';
    if (!state.providers.length) {
      const opt = document.createElement('option');
      opt.value = state.selectedProvider || 'agy';
      opt.textContent = state.bridgeOnline ? 'No CLIs detected' : 'Bridge Offline';
      els.providerSelect.appendChild(opt);
      els.modelSelect.innerHTML = '<option value="">Default</option>';
      return;
    }

    for (const p of state.providers) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.icon} ${p.name}${p.available ? '' : ' (not found)'}`;
      els.providerSelect.appendChild(opt);
    }

    if (!state.providers.some((p) => p.id === state.selectedProvider)) {
      const firstAvail = state.providers.find((p) => p.available) || state.providers[0];
      state.selectedProvider = firstAvail.id;
    }
    els.providerSelect.value = state.selectedProvider;
    renderModelOptions();
  }

  function renderModelOptions() {
    const provider = state.providers.find((p) => p.id === state.selectedProvider);
    els.modelSelect.innerHTML = '';
    const models = provider?.models || [];
    if (!models.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Default CLI model';
      els.modelSelect.appendChild(opt);
      state.selectedModel = '';
      return;
    }

    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      els.modelSelect.appendChild(opt);
    }

    const valid = models.some((m) => m.id === state.selectedModel);
    if (!valid) {
      state.selectedModel = provider.defaultModel || models[0].id;
    }
    els.modelSelect.value = state.selectedModel;
  }

  function updateContextHeader() {
    let hostLabel = 'No active tab';
    if (state.currentTab.url) {
      try {
        hostLabel = new URL(state.currentTab.url).hostname || state.currentTab.url;
      } catch {
        hostLabel = state.currentTab.url;
      }
    }
    els.domainPill.textContent = hostLabel;
    els.domainPill.title = state.currentTab.url || hostLabel;

    const mod = getActiveModule();
    if (mod) {
      const isMatched = state.matchedModuleIds.includes(mod.id);
      els.activeModulePill.textContent = `${mod.icon || '🧩'} ${mod.name}${isMatched ? ' ★' : ''}`;
    }

    const matchCount = state.matchedModuleIds.length;
    els.matchedCountBadge.textContent = String(matchCount);
    els.matchedCountBadge.classList.toggle('hidden', matchCount === 0);

    renderActiveModuleChrome();
  }

  function renderActiveModuleChrome() {
    const mod = getActiveModule();
    els.quickActions.innerHTML = '';
    if (mod && Array.isArray(mod.quickActions)) {
      for (const qa of mod.quickActions) {
        if (!qa?.label || !qa?.prompt) continue;
        const btn = document.createElement('button');
        btn.className = 'quick-chip';
        btn.textContent = qa.label;
        btn.addEventListener('click', () => {
          els.promptInput.value = qa.prompt;
          sendPrompt();
        });
        els.quickActions.appendChild(btn);
      }
    }

  function sanitizeCustomHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const blocked = doc.querySelectorAll('script, iframe, object, embed, style, link, meta, base, form');
    blocked.forEach((node) => node.remove());
    for (const el of doc.body.querySelectorAll('*')) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const val = String(attr.value || '').trim().toLowerCase();
        if (name.startsWith('on') || ((name === 'href' || name === 'src' || name === 'action' || name === 'formaction') && val.startsWith('javascript:'))) {
          el.removeAttribute(attr.name);
        }
      }
    }
    return doc.body.innerHTML;
  }

    if (mod?.customHtml?.trim()) {
      els.customModulePanel.innerHTML = sanitizeCustomHtml(mod.customHtml);
      els.customModulePanel.classList.remove('hidden');
      els.customModulePanel.querySelectorAll('[data-prompt]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = btn.getAttribute('data-prompt');
          if (p) {
            els.promptInput.value = p;
            sendPrompt();
          }
        });
      });
    } else {
      els.customModulePanel.innerHTML = '';
      els.customModulePanel.classList.add('hidden');
    }

    renderAttachedFilesPanel();
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function setFilePanelError(msg) {
    if (!msg) {
      els.filePanelError.textContent = '';
      els.filePanelError.classList.add('hidden');
      return;
    }
    els.filePanelError.textContent = msg;
    els.filePanelError.classList.remove('hidden');
  }

  async function readUploadedFile(file) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.docx') || lower.endsWith('.pdf')) {
      if (file.size > 3.5 * 1024 * 1024) {
        throw new Error(`${file.name}: file exceeds 3.5 MB limit.`);
      }
      const base64 = arrayBufferToBase64(await file.arrayBuffer());
      const res = await fetch(`${state.bridgeUrl}/api/files/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, base64 }),
      }).catch(() => null);
      if (!res) {
        throw new Error(`Bridge is offline; cannot extract ${file.name}. Start the bridge or attach .txt/.md.`);
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) {
        throw new Error('Bridge is running an older version without /api/files/extract. Restart the bridge (stop-bridge.cmd -> start-bridge.cmd).');
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Failed to extract text from ${file.name}`);
      }
      return data.text;
    }

    if (file.size > 2 * 1024 * 1024) {
      throw new Error(`${file.name}: text file exceeds 2 MB limit.`);
    }
    return await file.text();
  }

  async function handleFileUploads(fileList) {
    if (!fileList || !fileList.length) return;
    setFilePanelError('');
    const errors = [];

    for (const file of Array.from(fileList)) {
      try {
        const content = await readUploadedFile(file);
        if (!content || !content.trim()) {
          errors.push(`${file.name}: file is empty or contains no readable text.`);
          continue;
        }
        const existingIdx = state.attachedFiles.findIndex((f) => f.name === file.name);
        const entry = {
          id: existingIdx >= 0 ? state.attachedFiles[existingIdx].id : `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          type: file.type || 'text/plain',
          size: file.size || content.length,
          content,
          enabled: true,
          addedAt: Date.now(),
        };
        if (existingIdx >= 0) state.attachedFiles[existingIdx] = entry;
        else state.attachedFiles.push(entry);
      } catch (err) {
        errors.push(err.message || `Failed to read ${file.name}`);
      }
    }

    await PilotModules.savePilotState({ attachedFiles: state.attachedFiles });
    renderAttachedFilesPanel();
    if (errors.length) setFilePanelError(errors.join(' '));
  }

  function openFileModal(fileObj = null) {
    state.editingFileId = fileObj?.id || null;
    els.fileModalTitle.textContent = fileObj ? `📎 Edit: ${fileObj.name}` : '📋 Paste Text / Resume';
    els.fileModalName.value = fileObj?.name || 'resume.md';
    els.fileModalContent.value = fileObj?.content || '';
    els.fileModal.classList.remove('hidden');
    els.fileModalContent.focus();
  }

  function renderAttachedFilesPanel() {
    const mod = getActiveModule();
    if (!mod?.supportsFiles) {
      els.fileAttachmentsPanel.classList.add('hidden');
      return;
    }

    els.fileAttachmentsPanel.classList.remove('hidden');
    const files = state.attachedFiles || [];
    const activeCount = files.filter((f) => f.enabled !== false).length;
    els.filePanelTitle.textContent = `📎 Attached Files (${activeCount}/${files.length})`;
    els.clearFilesBtn.classList.toggle('hidden', files.length === 0);
    els.attachedFilesList.innerHTML = '';

    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'attached-files-empty';
      empty.textContent = 'Drop or attach a resume, profile, or notes (.txt, .md, .json, .csv, .docx, .pdf) so the LLM can use it.';
      els.attachedFilesList.appendChild(empty);
      return;
    }

    for (const file of files) {
      const chip = document.createElement('div');
      chip.className = `file-chip${file.enabled === false ? ' disabled' : ''}`;

      const left = document.createElement('div');
      left.className = 'file-chip-left';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = file.enabled !== false;
      cb.title = 'Include this file in LLM context';
      cb.addEventListener('change', async () => {
        file.enabled = cb.checked;
        await PilotModules.savePilotState({ attachedFiles: state.attachedFiles });
        renderAttachedFilesPanel();
      });

      const nameEl = document.createElement('span');
      nameEl.className = 'file-chip-name';
      nameEl.textContent = file.name;
      nameEl.title = file.name;

      const metaEl = document.createElement('span');
      metaEl.className = 'file-chip-meta';
      metaEl.textContent = formatBytes(file.size || file.content?.length || 0);

      left.append(cb, nameEl, metaEl);

      const actions = document.createElement('div');
      actions.className = 'file-chip-actions';

      const viewBtn = document.createElement('button');
      viewBtn.className = 'file-chip-btn';
      viewBtn.textContent = '👁';
      viewBtn.title = 'Preview / Edit content';
      viewBtn.addEventListener('click', () => openFileModal(file));

      const removeBtn = document.createElement('button');
      removeBtn.className = 'file-chip-btn';
      removeBtn.textContent = '🗑️';
      removeBtn.title = 'Remove file';
      removeBtn.addEventListener('click', async () => {
        state.attachedFiles = state.attachedFiles.filter((f) => f.id !== file.id);
        await PilotModules.savePilotState({ attachedFiles: state.attachedFiles });
        renderAttachedFilesPanel();
      });

      actions.append(viewBtn, removeBtn);
      chip.append(left, actions);
      els.attachedFilesList.appendChild(chip);
    }
  }

  async function getCurrentWindowTabId() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0]?.id || state.currentTab?.id || null;
    } catch {
      return state.currentTab?.id || null;
    }
  }

  async function syncActiveTab(autoActivateMatched = true) {
    const tabId = await getCurrentWindowTabId();
    const res = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO', tabId }).catch(() => null);
    if (!res?.ok) return;
    state.currentTab = res.tab || { id: null, url: '', title: '' };
    state.matchedModuleIds = Array.isArray(res.matchedModuleIds) ? res.matchedModuleIds : [];

    if (autoActivateMatched && state.matchedModuleIds.length) {
      const autoMod = state.modules.find(
        (m) => state.matchedModuleIds.includes(m.id) && m.autoActivate
      );
      if (autoMod && autoMod.id !== state.activeModuleId) {
        await activateModule(autoMod.id, false);
      }
    }
    updateContextHeader();
    renderModulesList();
  }

  async function activateModule(moduleId, save = true) {
    const mod = state.modules.find((m) => m.id === moduleId);
    if (!mod) return;
    state.activeModuleId = mod.id;
    if (mod.autoExtract !== undefined) {
      state.includePageContext = Boolean(mod.autoExtract);
      els.includeContextToggle.checked = state.includePageContext;
    }
    if (mod.preferredProvider && state.providers.some((p) => p.id === mod.preferredProvider)) {
      state.selectedProvider = mod.preferredProvider;
      els.providerSelect.value = state.selectedProvider;
      renderModelOptions();
    }
    if (mod.preferredModel) {
      state.selectedModel = mod.preferredModel;
      els.modelSelect.value = state.selectedModel;
    }
    if (save) {
      await PilotModules.savePilotState({ activeModuleId: mod.id });
    }
    updateContextHeader();
    renderModulesList();
  }

  function appendMessage(role, text, metaLabel = '') {
    els.emptyState.classList.add('hidden');
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.innerHTML = `
      <div class="msg-meta">
        <span>${escapeHtml(metaLabel || (role === 'user' ? 'You' : 'Pilot'))}</span>
      </div>
      <div class="activity-strip hidden"></div>
      <div class="msg-body">${role === 'user' ? escapeHtml(text).replace(/\n/g, '<br/>') : renderSimpleMarkdown(text)}</div>
      <div class="msg-actions"></div>
    `;
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
    return div;
  }

  async function executeAction(action, statusEl) {
    if (statusEl) {
      statusEl.textContent = 'Running...';
      statusEl.className = 'action-status';
    }
    const tabId = await getCurrentWindowTabId();
    const res = await chrome.runtime.sendMessage({
      type: 'EXECUTE_BROWSER_ACTION',
      tabId,
      action,
    }).catch((err) => ({ ok: false, error: err.message }));

    if (statusEl) {
      if (res?.ok) {
        statusEl.textContent = `✓ ${res.detail || 'Done'}`;
        statusEl.className = 'action-status ok';
      } else {
        statusEl.textContent = `✕ ${res?.error || 'Failed'}`;
        statusEl.className = 'action-status err';
      }
    }
    return res;
  }

  async function renderActionCards(msgEl, text, autoRun = false) {
    const container = msgEl.querySelector('.msg-actions');
    container.innerHTML = '';
    const actions = extractBrowserActions(text);
    const pendingRuns = [];
    for (const action of actions) {
      const card = document.createElement('div');
      card.className = 'action-card';
      card.innerHTML = `
        <div class="action-card-head">
          <span class="action-badge">⚡ browser_action: ${escapeHtml(action.type || 'action')}</span>
          <button class="btn-primary btn-sm run-action-btn">▶ Run</button>
        </div>
        <div class="action-status"></div>
        <pre class="action-code">${escapeHtml(JSON.stringify(action, null, 2))}</pre>
      `;
      const btn = card.querySelector('.run-action-btn');
      const statusEl = card.querySelector('.action-status');
      btn.addEventListener('click', () => executeAction(action, statusEl));
      container.appendChild(card);

      if (autoRun) {
        pendingRuns.push({ action, statusEl });
      }
    }

    const results = [];
    for (const item of pendingRuns) {
      const res = await executeAction(item.action, item.statusEl);
      results.push({ action: item.action, ...res });
      await new Promise((r) => setTimeout(r, 150));
    }
    return results;
  }

  async function buildPageContextSection(showError = true) {
    if (!state.includePageContext) return { pageSection: '', pilotProtocol: '' };
    const tabId = await getCurrentWindowTabId();
    const pageRes = await chrome.runtime.sendMessage({ type: 'EXTRACT_ACTIVE_PAGE', tabId }).catch((err) => ({ ok: false, error: err.message }));
    if (!pageRes?.ok || !pageRes.context) {
      if (showError) {
        appendMessage('error', `Could not read page context: ${pageRes?.error || 'Reload the tab and try again.'}`);
      }
      return { pageSection: '', pilotProtocol: '' };
    }

    const c = pageRes.context;
    const pageSection = [
      '[CURRENT BROWSER TAB]',
      `Title: ${c.title}`,
      `URL: ${c.url}`,
      c.selection ? `Selected text:\n${c.selection}` : '',
      c.elements?.length ? `Interactive elements:\n${c.elements.join('\n')}` : '',
      c.text ? `Page text:\n${c.text}` : '',
    ].filter(Boolean).join('\n\n');

    const pilotProtocol = [
      '[BROWSER PILOT PROTOCOL]',
      'You are connected to the user\'s active Chrome tab via the LLM Browser Pilot extension.',
      'Do NOT use local file/shell tools to browse or claim you have no browser access.',
      'To interact with the page (click, type, select, scroll, navigate, press_key, highlight), output one or more ```browser_action``` JSON blocks using the [#N] elements from [CURRENT BROWSER TAB], e.g.:',
      '```browser_action',
      '{"type": "click", "index": 0}',
      '```',
      'After executing your browser_action blocks, the extension will automatically send you [BROWSER ACTION RESULTS] and the updated [CURRENT BROWSER TAB] so you can continue multi-step tasks.',
      'If during execution you notice an obstacle, unexpected popup, redirect, or DOM change that affects your plan, you may revise your work plan up to 3 times by emitting a ```plan_update``` JSON block:',
      '```plan_update',
      '{"reason": "Why the plan changed", "steps": ["Next step 1", "Next step 2"]}',
      '```',
      'Only omit browser_action blocks when the task is completely finished or you need user input.',
    ].join('\n');

    return { pageSection, pilotProtocol };
  }

  async function streamSingleTurn({ prompt, convKey, assistantLabel }) {
    const conversationId = state.conversations[convKey] || '';
    const assistantEl = appendMessage('assistant', '', assistantLabel);
    const activityEl = assistantEl.querySelector('.activity-strip');
    const bodyEl = assistantEl.querySelector('.msg-body');

    state.activeRequestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    let accumulated = '';

    const response = await fetch(`${state.bridgeUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: state.abortController.signal,
      body: JSON.stringify({
        requestId: state.activeRequestId,
        providerId: state.selectedProvider,
        model: state.selectedModel,
        prompt,
        conversationId,
        customProviders: state.customProviders,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Bridge returned HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'message';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const payloadStr = line.slice(5).trim();
          if (!payloadStr) continue;
          let payload;
          try { payload = JSON.parse(payloadStr); } catch { continue; }

          if (currentEvent === 'delta' && payload.text) {
            accumulated += payload.text;
            bodyEl.innerHTML = renderSimpleMarkdown(accumulated);
            els.messages.scrollTop = els.messages.scrollHeight;
          } else if (currentEvent === 'activity' && payload.text) {
            activityEl.textContent = payload.text;
            activityEl.classList.remove('hidden');
          } else if (currentEvent === 'done') {
            if (payload.content && !accumulated) {
              accumulated = payload.content;
              bodyEl.innerHTML = renderSimpleMarkdown(accumulated);
            }
            if (payload.conversationId) {
              state.conversations[convKey] = payload.conversationId;
              await PilotModules.savePilotState({ conversations: state.conversations });
            }
            activityEl.classList.add('hidden');
          } else if (currentEvent === 'error') {
            throw new Error(payload.message || 'CLI error');
          }
        }
      }
    }

    return { assistantEl, bodyEl, accumulated };
  }

  function updateRunningUI(runState) {
    const isRunning = Boolean(runState?.running);
    state.running = isRunning;
    els.runningBar.classList.toggle('hidden', !isRunning);
    els.sendBtn.classList.toggle('hidden', isRunning);
    els.stopBtn.classList.toggle('hidden', !isRunning);
    if (isRunning) {
      els.runningText.textContent = runState.statusText || (runState.step ? `Working (Step ${runState.step})...` : 'Working...');
    }
  }

  function renderStoredActionResults(msgEl, actionResults = []) {
    const container = msgEl.querySelector('.msg-actions');
    for (const item of actionResults) {
      const action = item.action || item;
      const card = document.createElement('div');
      card.className = 'action-card';
      let statusHtml = '';
      if (item.ok === true) {
        statusHtml = `<div class="action-status ok">✓ ${escapeHtml(item.detail || 'Done')}</div>`;
      } else if (item.ok === false) {
        statusHtml = `<div class="action-status err">✕ ${escapeHtml(item.error || 'Failed')}</div>`;
      } else {
        statusHtml = '<div class="action-status"></div>';
      }
      card.innerHTML = `
        <div class="action-card-head">
          <span class="action-badge">⚡ browser_action: ${escapeHtml(action.type || 'action')}</span>
          <button class="btn-primary btn-sm run-action-btn">▶ Run</button>
        </div>
        ${statusHtml}
        <pre class="action-code">${escapeHtml(JSON.stringify(action, null, 2))}</pre>
      `;
      const btn = card.querySelector('.run-action-btn');
      const statusEl = card.querySelector('.action-status');
      btn.addEventListener('click', () => executeAction(action, statusEl));
      container.appendChild(card);
    }
  }

  function renderChatMessages(chat) {
    els.messages.innerHTML = '';
    if (!chat || !Array.isArray(chat.messages) || chat.messages.length === 0) {
      els.messages.appendChild(els.emptyState);
      els.emptyState.classList.remove('hidden');
      return;
    }
    els.emptyState.classList.add('hidden');
    for (const m of chat.messages) {
      const msgEl = appendMessage(m.role, m.text || '', m.metaLabel || '');
      const activityEl = msgEl.querySelector('.activity-strip');
      if (m.activity) {
        activityEl.textContent = m.activity;
        activityEl.classList.remove('hidden');
      }
      if (Array.isArray(m.planUpdates) && m.planUpdates.length) {
        for (const upd of m.planUpdates) {
          const card = document.createElement('div');
          card.className = 'action-card';
          const stepsHtml = Array.isArray(upd.steps) && upd.steps.length
            ? `<div class="action-code">${upd.steps.map((s, i) => `${i + 1}. ${escapeHtml(s)}`).join('\n')}</div>`
            : '';
          card.innerHTML = `
            <div class="action-card-head">
              <span class="action-badge">${upd.allowed !== false ? `🔄 Plan revised (${upd.revisionNumber || 1}/${upd.maxReplans || 3})` : `⚠ Plan revision limit reached (${upd.maxReplans || 3}/${upd.maxReplans || 3})`}</span>
            </div>
            <div class="muted small">${escapeHtml(upd.reason || 'Adjusted plan based on page state')}</div>
            ${stepsHtml}
          `;
          msgEl.querySelector('.msg-actions').appendChild(card);
        }
      }
      if (Array.isArray(m.siteMemoryUpdates) && m.siteMemoryUpdates.length) {
        for (const mem of m.siteMemoryUpdates) {
          const card = document.createElement('div');
          card.className = 'action-card';
          card.innerHTML = `
            <div class="action-card-head">
              <span class="action-badge">📝 Site memory updated (${escapeHtml(mem.domain)}.md)</span>
            </div>
            <div class="muted small">${escapeHtml(mem.note || 'Updated playbook')}</div>
          `;
          msgEl.querySelector('.msg-actions').appendChild(card);
        }
      }
      if (Array.isArray(m.actionResults) && m.actionResults.length) {
        renderStoredActionResults(msgEl, m.actionResults);
      }
    }
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function renderHistoryList() {
    if (!els.historyList) return;
    els.historyList.innerHTML = '';
    if (!state.chatHistory.length) {
      els.historyList.innerHTML = '<p class="muted">No saved chats yet. Start a conversation in the Pilot tab.</p>';
      return;
    }
    const sorted = [...state.chatHistory].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const chat of sorted) {
      const card = document.createElement('div');
      card.className = `history-card${chat.id === state.activeChatId ? ' active-chat' : ''}`;
      const dateStr = chat.updatedAt ? new Date(chat.updatedAt).toLocaleString() : '';
      const msgCount = Array.isArray(chat.messages) ? chat.messages.length : 0;
      let domainLabel = chat.domain || '';
      if (!domainLabel && chat.url) {
        try { domainLabel = new URL(chat.url).hostname; } catch {}
      }
      const domainHtml = domainLabel
        ? `<div class="module-bindings"><span class="binding-tag" title="${escapeHtml(chat.url || domainLabel)}">🌐 ${escapeHtml(domainLabel)}</span></div>`
        : '';
      card.innerHTML = `
        <div class="module-card-top">
          <div class="module-title">${escapeHtml(chat.title || 'Untitled Chat')}</div>
          <button class="btn-danger btn-sm del-chat-btn">✕</button>
        </div>
        ${domainHtml}
        <div class="muted small">${escapeHtml(chat.providerId || 'agy')} · ${msgCount} msg(s) · ${escapeHtml(dateStr)}</div>
      `;
      card.addEventListener('click', async (e) => {
        if (e.target.closest('.del-chat-btn')) return;
        state.activeChatId = chat.id;
        await PilotModules.savePilotState({ activeChatId: chat.id });
        if (chat.moduleId) await activateModule(chat.moduleId, true);
        if (chat.providerId && state.providers.some((p) => p.id === chat.providerId)) {
          state.selectedProvider = chat.providerId;
          els.providerSelect.value = chat.providerId;
          renderModelOptions();
        }
        if (chat.model) {
          state.selectedModel = chat.model;
          els.modelSelect.value = chat.model;
        }
        renderChatMessages(chat);
        renderHistoryList();
        switchTab('pilot');
        if (chat.url && /^https?:\/\//i.test(chat.url)) {
          const tabId = await getCurrentWindowTabId();
          chrome.runtime.sendMessage({ type: 'OPEN_CHAT_URL', url: chat.url, tabId }).catch(() => {});
        }
      });
      card.querySelector('.del-chat-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        state.chatHistory = state.chatHistory.filter((c) => c.id !== chat.id);
        if (state.activeChatId === chat.id) {
          state.activeChatId = state.chatHistory[0]?.id || '';
        }
        await PilotModules.savePilotState({ chatHistory: state.chatHistory, activeChatId: state.activeChatId });
        const activeChat = state.chatHistory.find((c) => c.id === state.activeChatId);
        renderChatMessages(activeChat);
        renderHistoryList();
      });
      els.historyList.appendChild(card);
    }
  }

  async function sendPrompt() {
    const rawUserText = els.promptInput.value.trim();
    if (!rawUserText || state.running) return;
    if (!state.bridgeOnline) {
      appendMessage('error', `Local CLI bridge is offline (${state.bridgeUrl}). Start it with start-bridge.cmd or npm start.`);
      return;
    }

    els.promptInput.value = '';
    const mod = getActiveModule();
    const tabId = await getCurrentWindowTabId();
    if (!state.activeChatId) {
      state.activeChatId = `chat_${Date.now().toString(36)}`;
    }

    updateRunningUI({ running: true, step: 1, statusText: 'Starting...' });
    const res = await chrome.runtime.sendMessage({
      type: 'START_AGENT_RUN',
      params: {
        chatId: state.activeChatId,
        userText: rawUserText,
        bridgeUrl: state.bridgeUrl,
        providerId: state.selectedProvider,
        model: state.selectedModel,
        moduleId: mod?.id || 'general-pilot',
        tabId,
        includePageContext: state.includePageContext,
        autoRunActions: state.autoRunActions,
      },
    }).catch((err) => ({ ok: false, error: err.message }));

    if (!res?.ok) {
      updateRunningUI({ running: false });
      appendMessage('error', res?.error || 'Failed to start agent run');
    }
  }

  function renderModulesList() {
    els.modulesList.innerHTML = '';
    const matchedSet = new Set(state.matchedModuleIds);
    const matched = state.modules.filter((m) => matchedSet.has(m.id));
    const others = state.modules.filter((m) => !matchedSet.has(m.id));

    let currentHost = '';
    try {
      if (state.currentTab.url) currentHost = new URL(state.currentTab.url).hostname;
    } catch {}

    const renderGroup = (title, items) => {
      if (!items.length) return;
      const heading = document.createElement('div');
      heading.className = 'module-group-title';
      heading.textContent = title;
      els.modulesList.appendChild(heading);

      for (const mod of items) {
        const isMatched = matchedSet.has(mod.id);
        const isActive = mod.id === state.activeModuleId;
        const card = document.createElement('div');
        card.className = `module-card${isMatched ? ' matched' : ''}${isActive ? ' active-mod' : ''}`;

        const bindingsHtml = (mod.bindings || []).map((b) => `<span class="binding-tag">${escapeHtml(b)}</span>`).join('');
        card.innerHTML = `
          <div class="module-card-top">
            <div class="module-title">${escapeHtml(mod.icon || '🧩')} ${escapeHtml(mod.name)}</div>
            <label class="toggle-chip">
              <input type="checkbox" class="mod-enable-cb" ${mod.enabled !== false ? 'checked' : ''} />
              <span>Enabled</span>
            </label>
          </div>
          <p class="muted">${escapeHtml(mod.description || '')}</p>
          ${bindingsHtml ? `<div class="module-bindings">${bindingsHtml}</div>` : '<div class="muted small">Global (no site binding)</div>'}
          <div class="module-actions">
            <button class="btn-primary btn-sm use-mod-btn">${isActive ? '✓ Active' : 'Use'}</button>
            ${currentHost ? `<button class="btn-secondary btn-sm bind-domain-btn">+ Bind ${escapeHtml(currentHost)}</button>` : ''}
            ${state.currentTab.url ? '<button class="btn-secondary btn-sm bind-page-btn">+ Bind Page</button>' : ''}
            <button class="btn-secondary btn-sm edit-mod-btn">Edit</button>
            ${mod.builtin ? '' : '<button class="btn-danger btn-sm del-mod-btn">Delete</button>'}
          </div>
        `;

        card.querySelector('.mod-enable-cb').addEventListener('change', async (e) => {
          mod.enabled = e.target.checked;
          await PilotModules.savePilotState({ modules: state.modules });
          await syncActiveTab(false);
        });

        card.querySelector('.use-mod-btn').addEventListener('click', async () => {
          await activateModule(mod.id, true);
          switchTab('pilot');
        });

        card.querySelector('.bind-domain-btn')?.addEventListener('click', async () => {
          mod.bindings = Array.isArray(mod.bindings) ? mod.bindings : [];
          if (!mod.bindings.includes(currentHost)) {
            mod.bindings.push(currentHost);
            await PilotModules.savePilotState({ modules: state.modules });
            await syncActiveTab(false);
          }
        });

        card.querySelector('.bind-page-btn')?.addEventListener('click', async () => {
          try {
            const u = new URL(state.currentTab.url);
            const pattern = `${u.hostname}${u.pathname}`;
            mod.bindings = Array.isArray(mod.bindings) ? mod.bindings : [];
            if (!mod.bindings.includes(pattern)) {
              mod.bindings.push(pattern);
              await PilotModules.savePilotState({ modules: state.modules });
              await syncActiveTab(false);
            }
          } catch {}
        });

        card.querySelector('.edit-mod-btn').addEventListener('click', () => openModuleEditor(mod));
        card.querySelector('.del-mod-btn')?.addEventListener('click', async () => {
          state.modules = state.modules.filter((m) => m.id !== mod.id);
          if (state.activeModuleId === mod.id) state.activeModuleId = state.modules[0]?.id || '';
          await PilotModules.savePilotState({ modules: state.modules, activeModuleId: state.activeModuleId });
          await syncActiveTab(false);
        });

        els.modulesList.appendChild(card);
      }
    };

    renderGroup('Matched for current site', matched);
    renderGroup(matched.length ? 'Other modules' : 'All modules', others);
  }

  function openModuleEditor(mod = null) {
    state.editingModuleId = mod?.id || null;
    els.editorTitle.textContent = mod ? `Edit: ${mod.name}` : 'Create Custom Module';
    els.modIcon.value = mod?.icon || '🧩';
    els.modName.value = mod?.name || '';
    els.modDesc.value = mod?.description || '';
    els.modSystemPrompt.value = mod?.systemPrompt || '';
    els.modBindings.value = (mod?.bindings || []).join('\n');
    els.modAutoActivate.checked = mod ? Boolean(mod.autoActivate) : true;
    els.modAutoExtract.checked = mod ? mod.autoExtract !== false : true;
    els.modSupportsFiles.checked = Boolean(mod?.supportsFiles);
    els.modModel.value = mod?.preferredModel || '';
    els.modQuickActions.value = (mod?.quickActions || []).map((q) => `${q.label} | ${q.prompt}`).join('\n');
    els.modCustomHtml.value = mod?.customHtml || '';

    els.modProvider.innerHTML = '<option value="">(Use current provider)</option>';
    for (const p of state.providers) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.icon} ${p.name}`;
      els.modProvider.appendChild(opt);
    }
    els.modProvider.value = mod?.preferredProvider || '';
    els.moduleEditorModal.classList.remove('hidden');
  }

  async function saveModuleFromEditor() {
    const name = els.modName.value.trim();
    if (!name) return;

    const bindings = els.modBindings.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const quickActions = els.modQuickActions.value
      .split('\n')
      .map((line) => {
        const idx = line.indexOf('|');
        if (idx === -1) return null;
        return { label: line.slice(0, idx).trim(), prompt: line.slice(idx + 1).trim() };
      })
      .filter((q) => q && q.label && q.prompt);

    const existing = state.editingModuleId
      ? state.modules.find((m) => m.id === state.editingModuleId)
      : null;

    const moduleObj = {
      id: existing?.id || `custom_${Date.now().toString(36)}`,
      name,
      icon: els.modIcon.value.trim() || '🧩',
      description: els.modDesc.value.trim(),
      builtin: Boolean(existing?.builtin),
      enabled: existing ? existing.enabled !== false : true,
      systemPrompt: els.modSystemPrompt.value.trim(),
      bindings,
      autoActivate: els.modAutoActivate.checked,
      autoExtract: els.modAutoExtract.checked,
      supportsFiles: els.modSupportsFiles.checked,
      preferredProvider: els.modProvider.value,
      preferredModel: els.modModel.value.trim(),
      quickActions,
      customHtml: els.modCustomHtml.value.trim(),
    };

    if (existing) {
      const idx = state.modules.findIndex((m) => m.id === existing.id);
      state.modules[idx] = moduleObj;
    } else {
      state.modules.push(moduleObj);
    }

    await PilotModules.savePilotState({ modules: state.modules });
    els.moduleEditorModal.classList.add('hidden');
    await syncActiveTab(false);
    updateContextHeader();
  }

  function renderCustomCliList() {
    els.customCliList.innerHTML = '';
    if (!state.customProviders.length) {
      els.customCliList.innerHTML = '<p class="muted small">No custom CLIs added yet.</p>';
      return;
    }
    for (const cp of state.customProviders) {
      const row = document.createElement('div');
      row.className = 'custom-cli-item';
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(cp.icon || '⚙')} ${escapeHtml(cp.name)}</strong>
          <div class="muted small"><code>${escapeHtml(cp.command)} ${escapeHtml(cp.argsTemplate || '')}</code></div>
        </div>
        <button class="btn-danger btn-sm">Remove</button>
      `;
      row.querySelector('button').addEventListener('click', async () => {
        state.customProviders = state.customProviders.filter((x) => x.id !== cp.id);
        await PilotModules.savePilotState({ customProviders: state.customProviders });
        renderCustomCliList();
        await refreshProviders();
      });
      els.customCliList.appendChild(row);
    }
  }

  function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.toggle('active', v.id === `view-${tabName}`);
    });
  }

  async function init() {
    const loaded = await PilotModules.loadPilotState();
    Object.assign(state, loaded);

    els.bridgeUrlInput.value = state.bridgeUrl;
    els.includeContextToggle.checked = state.includePageContext;
    els.autoRunToggle.checked = state.autoRunActions;

    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    els.refreshProvidersBtn.addEventListener('click', refreshProviders);
    const startNewChat = async () => {
      state.activeChatId = `chat_${Date.now().toString(36)}`;
      await PilotModules.savePilotState({ activeChatId: state.activeChatId });
      renderChatMessages(null);
      renderHistoryList();
      switchTab('pilot');
      els.promptInput.focus();
    };

    els.newChatBtn.addEventListener('click', startNewChat);
    els.historyNewChatBtn.addEventListener('click', startNewChat);

    els.clearHistoryBtn.addEventListener('click', async () => {
      state.chatHistory = [];
      state.activeChatId = '';
      await PilotModules.savePilotState({ chatHistory: [], activeChatId: '' });
      renderChatMessages(null);
      renderHistoryList();
    });

    els.providerSelect.addEventListener('change', async () => {
      state.selectedProvider = els.providerSelect.value;
      renderModelOptions();
      await PilotModules.savePilotState({
        selectedProvider: state.selectedProvider,
        selectedModel: state.selectedModel,
      });
    });

    els.modelSelect.addEventListener('change', async () => {
      state.selectedModel = els.modelSelect.value;
      await PilotModules.savePilotState({ selectedModel: state.selectedModel });
    });

    els.includeContextToggle.addEventListener('change', async () => {
      state.includePageContext = els.includeContextToggle.checked;
      await PilotModules.savePilotState({ includePageContext: state.includePageContext });
    });

    els.autoRunToggle.addEventListener('change', async () => {
      state.autoRunActions = els.autoRunToggle.checked;
      await PilotModules.savePilotState({ autoRunActions: state.autoRunActions });
    });

    els.sendBtn.addEventListener('click', sendPrompt);
    els.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
      }
    });

    const handleStop = () => {
      chrome.runtime.sendMessage({ type: 'STOP_AGENT_RUN' }).catch(() => {});
    };
    els.stopBtn.addEventListener('click', handleStop);
    els.topStopBtn.addEventListener('click', handleStop);

    const openSiteMemoryModal = async () => {
      const loaded = await PilotModules.loadPilotState();
      state.siteMemory = loaded.siteMemory || {};
      let currentHost = '';
      try {
        if (state.currentTab.url) currentHost = new URL(state.currentTab.url).hostname.replace(/^www\./, '').toLowerCase();
      } catch {}

      const domains = new Set(Object.keys(state.siteMemory));
      if (currentHost) domains.add(currentHost);

      els.siteMemDomainSelect.innerHTML = '';
      if (!domains.size) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No domain notes yet';
        els.siteMemDomainSelect.appendChild(opt);
        els.siteMemContent.value = '';
      } else {
        for (const d of domains) {
          const opt = document.createElement('option');
          opt.value = d;
          opt.textContent = state.siteMemory[d]?.content ? `${d}.md ★` : `${d}.md (new)`;
          els.siteMemDomainSelect.appendChild(opt);
        }
        const initialDomain = currentHost || Array.from(domains)[0];
        els.siteMemDomainSelect.value = initialDomain;
        els.siteMemContent.value = state.siteMemory[initialDomain]?.content || `# ${initialDomain}\n`;
      }
      els.siteMemoryModal.classList.remove('hidden');
    };

    els.siteNotesBtn.addEventListener('click', openSiteMemoryModal);
    els.closeSiteMemBtn.addEventListener('click', () => els.siteMemoryModal.classList.add('hidden'));
    els.cancelSiteMemBtn.addEventListener('click', () => els.siteMemoryModal.classList.add('hidden'));
    els.siteMemDomainSelect.addEventListener('change', () => {
      const d = els.siteMemDomainSelect.value;
      els.siteMemContent.value = state.siteMemory[d]?.content || (d ? `# ${d}\n` : '');
    });
    els.saveSiteMemBtn.addEventListener('click', async () => {
      const d = els.siteMemDomainSelect.value;
      if (!d) return;
      state.siteMemory[d] = {
        domain: d,
        content: els.siteMemContent.value,
        updatedAt: Date.now(),
      };
      await PilotModules.savePilotState({ siteMemory: state.siteMemory });
      els.siteMemoryModal.classList.add('hidden');
    });
    els.deleteSiteMemBtn.addEventListener('click', async () => {
      const d = els.siteMemDomainSelect.value;
      if (!d) return;
      delete state.siteMemory[d];
      await PilotModules.savePilotState({ siteMemory: state.siteMemory });
      els.siteMemoryModal.classList.add('hidden');
    });

    els.attachFileInput.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (files?.length) await handleFileUploads(files);
      e.target.value = '';
    });
    els.pasteTextFileBtn.addEventListener('click', () => openFileModal(null));
    els.clearFilesBtn.addEventListener('click', async () => {
      state.attachedFiles = [];
      setFilePanelError('');
      await PilotModules.savePilotState({ attachedFiles: [] });
      renderAttachedFilesPanel();
    });
    els.fileAttachmentsPanel.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.fileAttachmentsPanel.classList.add('drag-over');
    });
    els.fileAttachmentsPanel.addEventListener('dragleave', () => {
      els.fileAttachmentsPanel.classList.remove('drag-over');
    });
    els.fileAttachmentsPanel.addEventListener('drop', async (e) => {
      e.preventDefault();
      els.fileAttachmentsPanel.classList.remove('drag-over');
      if (e.dataTransfer?.files?.length) {
        await handleFileUploads(e.dataTransfer.files);
      }
    });

    const closeFileModal = () => els.fileModal.classList.add('hidden');
    els.closeFileModalBtn.addEventListener('click', closeFileModal);
    els.cancelFileModalBtn.addEventListener('click', closeFileModal);
    els.saveFileModalBtn.addEventListener('click', async () => {
      const name = els.fileModalName.value.trim() || 'note.txt';
      const content = els.fileModalContent.value;
      if (!content.trim()) return;
      if (state.editingFileId) {
        const idx = state.attachedFiles.findIndex((f) => f.id === state.editingFileId);
        if (idx >= 0) {
          state.attachedFiles[idx] = {
            ...state.attachedFiles[idx],
            name,
            content,
            size: content.length,
          };
        }
      } else {
        state.attachedFiles.push({
          id: `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name,
          type: 'text/plain',
          size: content.length,
          content,
          enabled: true,
          addedAt: Date.now(),
        });
      }
      await PilotModules.savePilotState({ attachedFiles: state.attachedFiles });
      renderAttachedFilesPanel();
      closeFileModal();
    });

    els.newModuleBtn.addEventListener('click', () => openModuleEditor(null));
    els.closeEditorBtn.addEventListener('click', () => els.moduleEditorModal.classList.add('hidden'));
    els.cancelEditorBtn.addEventListener('click', () => els.moduleEditorModal.classList.add('hidden'));
    els.saveModuleBtn.addEventListener('click', saveModuleFromEditor);

    els.saveBridgeBtn.addEventListener('click', async () => {
      state.bridgeUrl = els.bridgeUrlInput.value.trim().replace(/\/+$/, '') || PilotModules.DEFAULT_BRIDGE_URL;
      await PilotModules.savePilotState({ bridgeUrl: state.bridgeUrl });
      await refreshProviders();
    });

    els.addCustomCliBtn.addEventListener('click', async () => {
      const name = prompt('Provider display name (e.g. My Local LLM):');
      if (!name) return;
      const command = prompt('CLI executable or command (e.g. llm, aichat, python):');
      if (!command) return;
      const argsTemplate = prompt('Args template (use {{prompt}} and optional {{model}}):', '{{prompt}}') || '{{prompt}}';
      state.customProviders.push({
        id: `cli_${Date.now().toString(36)}`,
        name: name.trim(),
        command: command.trim(),
        argsTemplate,
        outputFormat: 'plain-text',
        icon: '⚙',
      });
      await PilotModules.savePilotState({ customProviders: state.customProviders });
      renderCustomCliList();
      await refreshProviders();
    });

    els.exportModulesBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state.modules, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'llm-browser-pilot-modules.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    els.importModulesInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (Array.isArray(parsed) && parsed.length) {
          state.modules = parsed;
          await PilotModules.savePilotState({ modules: state.modules });
          await syncActiveTab(false);
        }
      } catch {}
    });

    els.resetModulesBtn.addEventListener('click', async () => {
      state.modules = structuredClone(PilotModules.DEFAULT_MODULES);
      state.activeModuleId = state.modules[0].id;
      await PilotModules.savePilotState({ modules: state.modules, activeModuleId: state.activeModuleId });
      await syncActiveTab(false);
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'TAB_CONTEXT_CHANGED') {
        syncActiveTab(true);
      } else if (msg?.type === 'RUN_STATE_UPDATED') {
        updateRunningUI(msg.runState);
        if (msg.runState?.chat) {
          const updatedChat = msg.runState.chat;
          const idx = state.chatHistory.findIndex((c) => c.id === updatedChat.id);
          if (idx >= 0) state.chatHistory[idx] = updatedChat;
          else state.chatHistory.unshift(updatedChat);
          if (!state.activeChatId || state.activeChatId === updatedChat.id) {
            state.activeChatId = updatedChat.id;
            renderChatMessages(updatedChat);
          }
          renderHistoryList();
        }
      }
    });

    renderCustomCliList();
    await refreshProviders();
    await syncActiveTab(true);

    const activeChat = state.chatHistory.find((c) => c.id === state.activeChatId) || state.chatHistory[0] || null;
    if (activeChat) {
      state.activeChatId = activeChat.id;
      renderChatMessages(activeChat);
    }
    renderHistoryList();
    const runRes = await chrome.runtime.sendMessage({ type: 'GET_RUN_STATE' }).catch(() => null);
    if (runRes?.ok) {
      updateRunningUI(runRes.runState);
    }
  }

  init();
})();
