(function () {
  if (window.__llmPilotContentLoaded) return;
  window.__llmPilotContentLoaded = true;

  let indexedElements = [];

  function isElementVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getFieldLabelText(el) {
    const aria = el.getAttribute('aria-label') || '';
    if (aria.trim()) return aria.trim();

    const labelledBy = el.getAttribute('aria-labelledby') || '';
    if (labelledBy.trim()) {
      const texts = labelledBy.split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || '')
        .filter(Boolean);
      if (texts.length) return texts.join(' ').replace(/\s+/g, ' ').trim();
    }

    if (el.id) {
      const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(el.id) : el.id.replace(/"/g, '\\"');
      const explicitLabel = document.querySelector(`label[for="${escapedId}"]`);
      if (explicitLabel?.innerText?.trim()) {
        return explicitLabel.innerText.replace(/\s+/g, ' ').trim();
      }
    }

    const parentLabel = el.closest?.('label');
    if (parentLabel?.innerText?.trim()) {
      return parentLabel.innerText.replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  function elementLabel(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const type = el.getAttribute('type') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const name = el.getAttribute('name') || '';
    const title = el.getAttribute('title') || '';
    const isFormControl = tag === 'input' || tag === 'textarea' || tag === 'select' || role === 'combobox' || role === 'textbox';
    const fieldLabel = isFormControl ? getFieldLabelText(el) : (el.getAttribute('aria-label') || '');
    const text = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 80);

    const parts = [`<${tag}`];
    if (type) parts.push(`type="${type}"`);
    if (role) parts.push(`role="${role}"`);
    if (name) parts.push(`name="${name}"`);
    parts.push('>');

    const label = isFormControl
      ? [fieldLabel, placeholder, text && text !== fieldLabel ? `val="${text}"` : ''].filter(Boolean).join(' | ') || title || el.id || ''
      : text || fieldLabel || placeholder || title || el.id || '';
    return `${parts.join(' ')} ${label}`.trim().slice(0, 140);
  }

  function querySelectorAllDeep(root, selector, results = [], seen = new Set()) {
    if (!root || typeof root.querySelectorAll !== 'function') return results;
    for (const el of root.querySelectorAll(selector)) {
      if (!seen.has(el)) {
        seen.add(el);
        results.push(el);
      }
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        querySelectorAllDeep(el.shadowRoot, selector, results, seen);
      }
    }
    return results;
  }

  function extractPageContext() {
    const selector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="combobox"]',
      '[role="textbox"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[contenteditable="true"]'
    ].join(', ');

    const nodes = querySelectorAllDeep(document, selector);
    indexedElements = [];
    const elementsSummary = [];

    for (const el of nodes) {
      if (!isElementVisible(el)) continue;
      const idx = indexedElements.length;
      indexedElements.push(el);
      elementsSummary.push(`[#${idx}] ${elementLabel(el)}`);
      if (indexedElements.length >= 150) break;
    }

    const selection = String(window.getSelection ? window.getSelection() : '').trim().slice(0, 2000);
    const bodyText = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
    const canvases = [];
    for (const cv of querySelectorAllDeep(document, 'canvas')) {
      if (!isElementVisible(cv)) continue;
      const r = cv.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) continue;
      canvases.push({
        id: cv.id || '',
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
      if (canvases.length >= 8) break;
    }

    return {
      url: location.href,
      domain: location.hostname,
      title: document.title || '',
      isTopFrame: window === window.top,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      canvases,
      scrollable: document.documentElement.scrollHeight > window.innerHeight + 10,
      selection,
      text: bodyText,
      elements: elementsSummary
    };
  }

  function flashHighlight(el, color = '#38bdf8') {
    if (!el || !el.style) return;
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = `3px solid ${color}`;
    el.style.outlineOffset = '2px';
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOffset;
    }, 1600);
  }

  function resolveTargetElement(action) {
    if (typeof action.index === 'number') {
      if (indexedElements.length === 0 || !indexedElements[action.index]?.isConnected) {
        extractPageContext();
      }
      return indexedElements[action.index] || null;
    }
    if (action.selector) {
      return document.querySelector(action.selector);
    }
    if (action.text) {
      const needle = String(action.text).toLowerCase().trim();
      if (indexedElements.length === 0) extractPageContext();
      return indexedElements.find((el) => {
        if (!el.isConnected) return false;
        const txt = (el.innerText || el.getAttribute('aria-label') || el.value || el.title || '').toLowerCase();
        return txt.includes(needle);
      }) || null;
    }
    return null;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  let ghostCursorPos = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
  let ghostFadeTimer = null;

  function getOrCreateGhostCursor() {
    let cursor = document.getElementById('__llm_pilot_ghost_cursor');
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.id = '__llm_pilot_ghost_cursor';
      cursor.style.cssText = [
        'position: fixed',
        'top: 0',
        'left: 0',
        'width: 24px',
        'height: 24px',
        'pointer-events: none',
        'z-index: 2147483647',
        'transition: opacity 0.25s ease',
        'filter: drop-shadow(0 2px 6px rgba(0,0,0,0.45))',
      ].join(';');
      cursor.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M4 2L19 11.5L11.5 13.5L8.5 21L4 2Z" fill="#38bdf8" stroke="#0f172a" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>`;
      document.documentElement.appendChild(cursor);
    }
    if (ghostFadeTimer) clearTimeout(ghostFadeTimer);
    cursor.style.opacity = '1';
    return cursor;
  }

  function scheduleGhostFade() {
    if (ghostFadeTimer) clearTimeout(ghostFadeTimer);
    ghostFadeTimer = setTimeout(() => {
      const cursor = document.getElementById('__llm_pilot_ghost_cursor');
      if (cursor) cursor.style.opacity = '0';
    }, 1200);
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function dispatchMouseAt(target, evName, x, y) {
    if (!target) return;
    target.dispatchEvent(new MouseEvent(evName, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      buttons: evName === 'mousedown' || evName === 'pointerdown' ? 1 : 0,
    }));
  }

  function moveGhostCursorToPoint(targetX, targetY, durationMs = 280) {
    return new Promise((resolve) => {
      const clampedX = Math.max(0, Math.min(window.innerWidth - 1, Number(targetX) || 0));
      const clampedY = Math.max(0, Math.min(window.innerHeight - 1, Number(targetY) || 0));
      const startX = ghostCursorPos.x;
      const startY = ghostCursorPos.y;
      const ctrlX = (startX + clampedX) / 2 + (Math.random() * 28 - 14);
      const ctrlY = (startY + clampedY) / 2 + (Math.random() * 28 - 14);

      const cursor = getOrCreateGhostCursor();
      const startTime = performance.now();

      function step(now) {
        const rawT = durationMs <= 0 ? 1 : Math.min(1, (now - startTime) / durationMs);
        const t = easeInOutCubic(rawT);
        const inv = 1 - t;
        const x = inv * inv * startX + 2 * inv * t * ctrlX + t * t * clampedX;
        const y = inv * inv * startY + 2 * inv * t * ctrlY + t * t * clampedY;

        cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        ghostCursorPos = { x, y };

        const hovered = document.elementFromPoint(x, y);
        if (hovered) {
          dispatchMouseAt(hovered, 'pointermove', x, y);
          dispatchMouseAt(hovered, 'mousemove', x, y);
        }

        if (rawT < 1) {
          requestAnimationFrame(step);
        } else {
          scheduleGhostFade();
          resolve({ x: clampedX, y: clampedY });
        }
      }
      requestAnimationFrame(step);
    });
  }

  function moveGhostCursorTo(el, durationMs = 420) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    const rect = el.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2 + (Math.random() * 4 - 2);
    const targetY = rect.top + rect.height / 2 + (Math.random() * 4 - 2);
    return moveGhostCursorToPoint(targetX, targetY, durationMs);
  }

  async function dispatchClickAtPoint(x, y) {
    const target = document.elementFromPoint(x, y) || document.body;
    target?.focus?.();
    for (const evName of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      dispatchMouseAt(target, evName, x, y);
    }
    return target;
  }

  async function humanClickFallback(el) {
    const { x, y } = await moveGhostCursorTo(el);
    const target = document.elementFromPoint(x, y) || el;
    target.focus?.();
    for (const evName of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(evName, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    }
    if (target !== el && typeof el.click === 'function') {
      el.click();
    }
  }

  async function humanTypeFallback(el, val, pressEnter) {
    await humanClickFallback(el);
    if (el.isContentEditable) {
      el.textContent = '';
    } else {
      setNativeValue(el, '');
    }
    for (const ch of val) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      if (el.isContentEditable) {
        el.textContent += ch;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      } else {
        setNativeValue(el, (el.value || '') + ch);
      }
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 25));
    }
    if (pressEnter) {
      for (const evName of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(new KeyboardEvent(evName, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
      el.form?.requestSubmit?.();
    }
  }

  async function runBrowserAction(action) {
    if (!action || typeof action !== 'object') {
      return { ok: false, error: 'Invalid action payload' };
    }
    const type = String(action.type || '').toLowerCase();

    if (type === 'scroll') {
      const amount = Number(action.amount) || 500;
      const dy = action.direction === 'up' ? -amount : amount;
      const targetEl = (typeof action.index === 'number' || action.selector) ? resolveTargetElement(action) : null;
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        return { ok: true, detail: `Scrolled ${elementLabel(targetEl)} into view` };
      }
      const docScrollable = document.documentElement.scrollHeight > window.innerHeight + 10;
      if (docScrollable) {
        window.scrollBy({ top: dy, behavior: 'smooth' });
        return { ok: true, detail: `Scrolled ${action.direction || 'down'} by ${amount}px` };
      }
      // Fallback: find largest scrollable container (modals, drawers, embedded panels)
      let bestContainer = null;
      let bestArea = 0;
      for (const node of document.querySelectorAll('*')) {
        if (node.scrollHeight <= node.clientHeight + 10) continue;
        const st = window.getComputedStyle(node);
        if (st.overflowY !== 'auto' && st.overflowY !== 'scroll') continue;
        const area = node.clientWidth * node.clientHeight;
        if (area > bestArea) {
          bestArea = area;
          bestContainer = node;
        }
      }
      if (bestContainer) {
        bestContainer.scrollBy({ top: dy, behavior: 'smooth' });
        return { ok: true, detail: `Scrolled container ${action.direction || 'down'} by ${amount}px` };
      }
      window.scrollBy({ top: dy, behavior: 'smooth' });
      return { ok: true, detail: `Scrolled ${action.direction || 'down'} by ${amount}px` };
    }

    if (type === 'press_key') {
      const key = String(action.key || 'Enter');
      const target = document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      return { ok: true, detail: `Pressed key: ${key}` };
    }

  function checkIframeTarget(x, y, action) {
    if (action?._inChildFrame || window !== window.top) return null;
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit.tagName?.toLowerCase() !== 'iframe') return null;
    const rect = hit.getBoundingClientRect();
    return {
      src: hit.getAttribute('src') || hit.src || '',
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  }

    if (type === 'move_xy') {
      const iframeTarget = checkIframeTarget(Number(action.x) || 0, Number(action.y) || 0, action);
      if (iframeTarget) return { ok: false, forwardToIframe: iframeTarget };
      const dur = action.fast ? 0 : (Number(action.durationMs) ?? 220);
      const { x, y } = await moveGhostCursorToPoint(action.x, action.y, Number.isFinite(dur) ? dur : 220);
      return { ok: true, detail: `Moved cursor to (${Math.round(x)}, ${Math.round(y)})` };
    }

    if (type === 'click_xy') {
      const iframeTarget = checkIframeTarget(Number(action.x) || 0, Number(action.y) || 0, action);
      if (iframeTarget) return { ok: false, forwardToIframe: iframeTarget };
      const dur = action.fast ? 0 : (Number(action.durationMs) ?? 200);
      const { x, y } = await moveGhostCursorToPoint(action.x, action.y, Number.isFinite(dur) ? dur : 200);
      const target = await dispatchClickAtPoint(x, y);
      return { ok: true, detail: `Clicked at (${Math.round(x)}, ${Math.round(y)}) on <${target?.tagName?.toLowerCase() || 'body'}>` };
    }

    if (type === 'mouse_path') {
      const rawPoints = Array.isArray(action.points) ? action.points : [];
      if (!rawPoints.length) {
        return { ok: false, error: 'mouse_path requires a non-empty points array' };
      }
      const firstPt = rawPoints[0];
      const fx = Array.isArray(firstPt) ? firstPt[0] : firstPt?.x;
      const fy = Array.isArray(firstPt) ? firstPt[1] : firstPt?.y;
      if (typeof fx === 'number' && typeof fy === 'number') {
        const iframeTarget = checkIframeTarget(fx, fy, action);
        if (iframeTarget) return { ok: false, forwardToIframe: iframeTarget };
      }
      const defaultStepMs = action.fast ? 45 : 140;
      const stepMs = Math.max(20, Math.min(1000, Number(action.stepMs) || defaultStepMs));
      let moved = 0;
      for (const pt of rawPoints.slice(0, 60)) {
        const px = Array.isArray(pt) ? pt[0] : pt?.x;
        const py = Array.isArray(pt) ? pt[1] : pt?.y;
        if (typeof px !== 'number' || typeof py !== 'number') continue;
        await moveGhostCursorToPoint(px, py, stepMs);
        moved += 1;
      }
      if (!moved) return { ok: false, error: 'mouse_path had no valid numeric coordinates' };
      return { ok: true, detail: `Moved cursor along ${moved} points` };
    }

    if (type === 'eval') {
      return { ok: false, error: 'Blocked by security policy: eval is disabled' };
    }

    const el = resolveTargetElement(action);
    if (!el) {
      return { ok: false, error: `Target element not found (${JSON.stringify(action)})` };
    }

    flashHighlight(el);

    if (type === 'highlight') {
      return { ok: true, detail: `Highlighted ${elementLabel(el)}` };
    }

    if (type === 'hover') {
      await moveGhostCursorTo(el);
      return { ok: true, detail: `Hovered ${elementLabel(el)} (ghost cursor)` };
    }

    if (type === 'click') {
      if (action.human) {
        await humanClickFallback(el);
        return { ok: true, detail: `Clicked ${elementLabel(el)} (ghost cursor)` };
      }

      // Primary fast method
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const isOccluded = hit && hit !== el && !el.contains(hit) && !hit.contains(el);

      if (!isOccluded) {
        try {
          el.focus?.();
          for (const evName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
            el.dispatchEvent(new MouseEvent(evName, { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy }));
          }
          el.click();
          return { ok: true, detail: `Clicked ${elementLabel(el)}` };
        } catch {
          // Fall through to ghost cursor fallback
        }
      }

      // Fallback: human-like ghost cursor movement & coordinate click
      await humanClickFallback(el);
      return { ok: true, detail: `Clicked ${elementLabel(el)} (ghost cursor fallback)` };
    }

    if (type === 'type') {
      const val = String(action.value ?? '');
      if (!action.human) {
        try {
          el.focus?.();
          if (el.isContentEditable) {
            el.textContent = val;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: val, inputType: 'insertText' }));
          } else {
            setNativeValue(el, val);
          }
          const currentVal = el.isContentEditable ? el.textContent : el.value;
          if (currentVal === val) {
            if (action.pressEnter) {
              for (const evName of ['keydown', 'keypress', 'keyup']) {
                el.dispatchEvent(new KeyboardEvent(evName, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              }
              el.form?.requestSubmit?.();
            }
            return { ok: true, detail: `Typed "${val}" into ${elementLabel(el)}` };
          }
        } catch {
          // Fall through to ghost cursor typing fallback
        }
      }

      // Fallback: move ghost cursor, click to focus, and type char-by-char
      await humanTypeFallback(el, val, Boolean(action.pressEnter));
      return { ok: true, detail: `Typed "${val}" into ${elementLabel(el)} (ghost cursor fallback)` };
    }

    if (type === 'select') {
      const targetVal = String(action.value ?? '').toLowerCase();
      const options = Array.from(el.options || []);
      const match = options.find(
        (opt) => opt.value.toLowerCase() === targetVal || opt.text.toLowerCase().includes(targetVal)
      );
      if (!match) return { ok: false, error: `Option "${action.value}" not found` };
      el.value = match.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, detail: `Selected "${match.text}"` };
    }

    return { ok: false, error: `Unsupported action type: ${type}` };
  }

  window.__llmPilotExtractPageContext = extractPageContext;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'EXTRACT_PAGE_CONTEXT') {
      try {
        sendResponse({ ok: true, context: extractPageContext() });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
      return true;
    }

    if (msg?.type === 'RUN_BROWSER_ACTION') {
      Promise.resolve(runBrowserAction(msg.action))
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    return false;
  });
})();
