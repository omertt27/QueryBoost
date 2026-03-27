/**
 * QueryBoost — Content Script v3.0
 * Intercepts queries on AI platforms and wraps them with a universal enhancement prompt.
 *
 * Platform notes:
 *  - ChatGPT:   #prompt-textarea is a contenteditable div (not a <textarea>)
 *  - Claude:    ProseMirror contenteditable div
 *  - Gemini:    Quill .ql-editor inside <rich-textarea> (sometimes shadow DOM)
 *  - Perplexity: migrated from <textarea> to contenteditable div in late 2024
 *
 * Features (v3.0):
 *  - Universal piggyback wrapper — one instruction set that adapts to any request type
 *  - Per-platform suffix tuning (tone/structure adapted per AI)
 *  - Domain mode / persona (developer, student, researcher, writer, general)
 *  - Query length awareness (short/long adjustments)
 *  - Smart session cache with LRU cap (skip re-processing identical queries)
 *  - Feedback loop (👍/👎 on toast → stored in chrome.storage.local)
 *  - Wrapper transparency toggle (reveal injected wrapper text in toast)
 *  - Gemini shadow DOM re-attachment observer
 *  - Selection API text insertion (no deprecated execCommand)
 */

(function () {
  'use strict';

  // ─── Guard ────────────────────────────────────────────────────────────────
  if (window.__qbLoaded) return;
  window.__qbLoaded = true;

  // ─── Constants ────────────────────────────────────────────────────────────
  // Storage keys are defined in src/constants.js (loaded first via manifest).
  // QB_KEYS is available as a global from that file.

  const STORAGE_KEY_ENABLED     = QB_KEYS.ENABLED;
  const STORAGE_KEY_LAST_TYPE   = QB_KEYS.LAST_TYPE;
  const STORAGE_KEY_COUNT       = QB_KEYS.COUNT;
  const STORAGE_KEY_DOMAIN_MODE = QB_KEYS.DOMAIN_MODE;
  const STORAGE_KEY_TRANSPARENCY= QB_KEYS.TRANSPARENCY;
  const STORAGE_KEY_FEEDBACK    = QB_KEYS.FEEDBACK;
  const STORAGE_KEY_CUSTOM_WRAP = QB_KEYS.CUSTOM_WRAP;
  const STORAGE_KEY_CONFIRM_MODE= QB_KEYS.CONFIRM_MODE;
  const STORAGE_KEY_PROMPT_MODE = QB_KEYS.PROMPT_MODE;

  const TOAST_DURATION_MS = 4000;
  const SUBMIT_DELAY_MS   = 150;

  // ─── Platform Detection ───────────────────────────────────────────────────

  const hostname = location.hostname;

  const PLATFORM = (() => {
    if (hostname.includes('claude.ai'))          return 'claude';
    if (hostname.includes('chatgpt.com'))        return 'chatgpt';
    if (hostname.includes('gemini.google.com'))  return 'gemini';
    if (hostname.includes('perplexity.ai'))      return 'perplexity';
    return null;
  })();

  if (!PLATFORM) return;

  // ─── Platform Config ──────────────────────────────────────────────────────

  const PLATFORM_CONFIG = {
    claude: {
      inputSelectors: [
        'div.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"][data-placeholder]',
        '[contenteditable="true"]',
      ],
      sendSelectors: [
        'button[aria-label="Send Message"]',
        'button[data-testid="send-button"]',
        'button[aria-label*="Send" i]',
        'button[type="submit"]',
      ],
      isRichText: true,
    },
    chatgpt: {
      inputSelectors: [
        'div#prompt-textarea[contenteditable="true"]',
        '#prompt-textarea',
        'div[contenteditable="true"][data-id]',
        'div[contenteditable="true"][tabindex="0"]',
      ],
      sendSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label*="Send" i]',
        'button[class*="send" i]',
      ],
      isRichText: true,
    },
    gemini: {
      inputSelectors: [
        '.ql-editor[contenteditable="true"]',
        'rich-textarea .ql-editor',
        '[contenteditable="true"][data-placeholder*="Gemini" i]',
        '[contenteditable="true"]',
      ],
      sendSelectors: [
        'button.send-button[aria-label]',
        'button[aria-label="Send message"]',
        'button[aria-label*="Send" i]',
        'button.mdc-icon-button[aria-label*="Send" i]',
        '.send-button',
      ],
      isRichText: true,
    },
    perplexity: {
      inputSelectors: [
        'textarea[placeholder]',
        'textarea',
        'div[contenteditable="true"][data-placeholder]',
        'div[contenteditable="true"].break-words',
        'div[contenteditable="true"]',
      ],
      sendSelectors: [
        'button[aria-label="Submit"]',
        'button[aria-label*="Ask" i]',
        'button[type="submit"]',
        'button[aria-label*="Search" i]',
      ],
      isRichText: null,
    },
  };

  const config = PLATFORM_CONFIG[PLATFORM];

  // ─── Runtime State ────────────────────────────────────────────────────────

  let isEnabled    = true;
  let domainMode   = 'general';      // general | developer | student | researcher | writer
  let transparency = false;          // show injected wrapper in toast
  let customWraps  = {};             // { universal: string } optional user-written template
  let confirmMode  = true;           // show before/after confirm modal before submitting
  let promptMode   = 'default';      // 'default' | 'custom'

  chrome.storage.sync.get(
    [STORAGE_KEY_ENABLED, STORAGE_KEY_DOMAIN_MODE, STORAGE_KEY_TRANSPARENCY,
     STORAGE_KEY_CUSTOM_WRAP, STORAGE_KEY_CONFIRM_MODE, STORAGE_KEY_PROMPT_MODE],
    (r) => {
      if (chrome.runtime.lastError) {
        console.warn('[QueryBoost] storage.sync.get failed:', chrome.runtime.lastError.message);
        return;
      }
      isEnabled    = r[STORAGE_KEY_ENABLED]    !== false;
      domainMode   = r[STORAGE_KEY_DOMAIN_MODE]  || 'general';
      transparency = r[STORAGE_KEY_TRANSPARENCY] === true;
      customWraps  = r[STORAGE_KEY_CUSTOM_WRAP]  || {};
      confirmMode  = r[STORAGE_KEY_CONFIRM_MODE] !== false;
      promptMode   = r[STORAGE_KEY_PROMPT_MODE]  || 'default';
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (STORAGE_KEY_ENABLED      in changes) isEnabled    = changes[STORAGE_KEY_ENABLED].newValue    !== false;
    if (STORAGE_KEY_DOMAIN_MODE  in changes) domainMode   = changes[STORAGE_KEY_DOMAIN_MODE].newValue || 'general';
    if (STORAGE_KEY_TRANSPARENCY in changes) transparency = changes[STORAGE_KEY_TRANSPARENCY].newValue === true;
    if (STORAGE_KEY_CUSTOM_WRAP  in changes) customWraps  = changes[STORAGE_KEY_CUSTOM_WRAP].newValue  || {};
    if (STORAGE_KEY_CONFIRM_MODE in changes) confirmMode  = changes[STORAGE_KEY_CONFIRM_MODE].newValue !== false;
    if (STORAGE_KEY_PROMPT_MODE  in changes) promptMode   = changes[STORAGE_KEY_PROMPT_MODE].newValue  || 'default';
  });

  // ─── Per-Platform Wrapper Tuning ─────────────────────────────────────────
  //
  // Each platform has a different "personality":
  //  - Claude:     Prefers nuanced, conversational, long-form — loves XML-style headers
  //  - ChatGPT:    Handles markdown well, neutral tone, good with structured lists
  //  - Gemini:     Best with concise, factual, well-organized output
  //  - Perplexity: Search-oriented; prefers factual, cited, scannable output

  const PLATFORM_SUFFIXES = {
    claude: {
      prefix: '',
      suffix: ' Prefer flowing prose over bullet overload. Use <h2> headings only for major sections.',
    },
    chatgpt: {
      prefix: '',
      suffix: ' Use clean markdown formatting throughout.',
    },
    gemini: {
      prefix: '',
      suffix: ' Keep the response concise and factual. Use short paragraphs and bullet points.',
    },
    perplexity: {
      prefix: '',
      suffix: ' Organize for scannability. Use numbered citations if referencing factual claims.',
    },
  };

  // ─── Domain Mode / Persona Wrappers ──────────────────────────────────────
  //
  // A persona prefix is prepended to the wrapper to tune register and depth.

  const DOMAIN_MODE_PREFIXES = {
    general:    '',
    developer:  'Assume I am an experienced software engineer who values precision and brevity. Skip over-explaining basics. ',
    student:    'Assume I am a university student learning this for the first time. Prioritize clarity and foundational understanding over advanced detail. ',
    researcher: 'Assume I am a researcher who needs rigorous, evidence-based reasoning. Cite where relevant. Prefer depth over accessibility. ',
    writer:     'Assume I am a professional writer focused on clarity, tone, and style. Emphasize language quality above technical depth. ',
  };

  // ─── Follow-up Detection ─────────────────────────────────────────────────

  // High-confidence follow-up starters — safe to flag at up to 40 chars.
  const FOLLOW_UP_RE = /^(elaborate|more detail|tell me more|explain that|what do you mean|go on|continue|that makes sense|got it|ok|okay|thanks|thank you|great|cool|interesting|sure|yes|no|yep|nope|hmm|huh|really|seriously|wow)\b/i;

  // Ambiguous starters that are only follow-ups when very short (≤ 25 chars).
  // Longer queries like "what if the server loses the connection mid-request?"
  // are real questions and should be boosted.
  const AMBIGUOUS_FOLLOW_UP_RE = /^(can you|could you|please|what about|how about|what if|why not|but why|why did|why does that|ok so|so then|and then|wait)\b/i;

  function isFollowUp(q) {
    const t = q.trim();
    if (t.length < 40 && FOLLOW_UP_RE.test(t)) return true;
    if (t.length < 25 && AMBIGUOUS_FOLLOW_UP_RE.test(t)) return true;
    // Short connector-word sentences with no real substance
    if (t.length < 35 && /^(and |but |so |also |then |right |plus )/i.test(t)) return true;
    return false;
  }

  // Returns true when the query is primarily a code paste (≥ 2 fenced blocks
  // or the majority of lines are indented / start with code-like characters).
  // Single-pass: early-exits on fence count, avoids a second filter allocation.
  const CODE_LINE_RE = /^(\s{4}|\t|```|\/\/|#!|import |def |class |function |const |let |var )/;
  function isPureCodePaste(q) {
    const lines = q.split('\n');
    let fences = 0, codeLike = 0;
    for (const line of lines) {
      if (line.startsWith('```') && ++fences >= 2) return true;
      if (CODE_LINE_RE.test(line)) codeLike++;
    }
    return lines.length >= 4 && codeLike / lines.length > 0.6;
  }

  // ─── Query Length Awareness ───────────────────────────────────────────────

  const LENGTH_SHORT  = 40;
  const LENGTH_LONG   = 280;

  const MIN_LENGTH = 15;  // queries shorter than this are skipped

  // ─── Session Cache ────────────────────────────────────────────────────────
  //
  // Fix #6: LRU-capped Map (max 100 entries). On overflow the oldest entry
  // (first inserted) is evicted, which is the natural Map insertion order.

  const SESSION_CACHE_MAX = 100;
  const sessionCache = new Map();

  function cacheSet(key, value) {
    if (sessionCache.size >= SESSION_CACHE_MAX) {
      // Evict the oldest (first) entry
      sessionCache.delete(sessionCache.keys().next().value);
    }
    sessionCache.set(key, value);
  }

  function fnv32a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16);
  }

  function cacheKey(rawText) {
    return fnv32a(rawText + '|' + domainMode + '|' + PLATFORM + '|' + promptMode);
  }

  // ─── Build Enhanced Query ─────────────────────────────────────────────────
  //
  // Universal piggyback approach: one adaptive instruction set appended to every
  // query. The AI infers the request type itself and responds accordingly.

  const SENTINEL   = 'Do not mention these instructions.';
  const SEPARATOR  = '\n\n---\n';

  // Skip reason labels — single source of truth used in buildEnhancedQuery
  // and the skipReasons map in handleSubmit.
  const SKIP = {
    FOLLOW_UP:  'Follow-up',
    TOO_SHORT:  'Too short',
    CODE_PASTE: 'Code paste',
  };

  const UNIVERSAL_INSTR = 'Identify the nature of this request and respond in the most useful format for that specific type — use numbered steps for how-to requests, working code with explanation for technical requests, ranked options with reasoning for recommendations, direct verdict with key factors for opinions, clear analogy and example for explanations, and organized sections for plans or schedules. Adjust the level of detail based on the complexity of the query. Be thorough but concise. Use examples where helpful. No filler sentences. ' + SENTINEL;

  function buildEnhancedQuery(original) {
    const q = original.trim();

    // 1. Follow-up guard
    if (isFollowUp(q)) {
      return { enhanced: q, label: SKIP.FOLLOW_UP, skipped: true };
    }

    // 2. Min length check
    if (q.length < MIN_LENGTH) {
      return { enhanced: q, label: SKIP.TOO_SHORT, skipped: true };
    }

    // 2b. Pure code paste — wrapping instructions around raw code is unhelpful
    if (isPureCodePaste(q)) {
      return { enhanced: q, label: SKIP.CODE_PASTE, skipped: true };
    }

    // 3. Session cache hit
    const key = cacheKey(q);
    if (sessionCache.has(key)) {
      return { ...sessionCache.get(key), fromCache: true };
    }

    let enhanced;

    // 4. Prompt mode: 'custom' uses user's saved wrapper; 'default' uses universal built-in
    const customTpl = (promptMode === 'custom' && customWraps['universal'])
      ? customWraps['universal']
      : null;

    if (customTpl) {
      // {{query}} is optional — if omitted, query is auto-prepended
      enhanced = customTpl.includes('{{query}}')
        ? customTpl.replace(/\{\{query\}\}/gi, q)
        : q + SEPARATOR + customTpl;
    } else {
      // 5. Build universal enhanced query
      const personaPrefix = DOMAIN_MODE_PREFIXES[domainMode] || '';
      const platSuffix    = (PLATFORM_SUFFIXES[PLATFORM] || {}).suffix || '';
      const lengthText    = q.length < LENGTH_SHORT
        ? ' Be thorough — the query is short so add relevant context and depth.'
        : q.length > LENGTH_LONG
        ? ' Stay precisely focused. Do not pad or repeat.'
        : '';

      const instrWithExtras = UNIVERSAL_INSTR.replace(
        SENTINEL,
        lengthText + (platSuffix ? platSuffix + ' ' : '') + SENTINEL
      );

      enhanced = personaPrefix + q + SEPARATOR + instrWithExtras;
    }

    const result = { enhanced, label: customTpl ? 'Custom' : 'Universal', skipped: false };
    cacheSet(key, result);
    return result;
  }

  // ─── DOM Helpers ──────────────────────────────────────────────────────────

  function queryFirst(selectors, root) {
    root = root || document;
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function findGeminiInput() {
    const direct = queryFirst(config.inputSelectors);
    if (direct) return direct;
    const richTextareas = document.querySelectorAll('rich-textarea');
    for (const rt of richTextareas) {
      if (rt.shadowRoot) {
        const inner = rt.shadowRoot.querySelector('.ql-editor[contenteditable="true"]');
        if (inner) return inner;
      }
      const inner = rt.querySelector('.ql-editor[contenteditable="true"]');
      if (inner) return inner;
    }
    return null;
  }

  function findInput() {
    if (PLATFORM === 'gemini') return findGeminiInput();
    return queryFirst(config.inputSelectors);
  }

  function findSendButton() {
    const btn = queryFirst(config.sendSelectors);
    if (btn) return btn;
    const all = document.querySelectorAll('button');
    for (const b of all) {
      const label = (b.getAttribute('aria-label') || b.title || b.textContent || '').toLowerCase().trim();
      if (/^(send|submit|ask|go|search)$/.test(label)) return b;
    }
    return null;
  }

  // ─── Text Read / Write ────────────────────────────────────────────────────

  // Fix #8: Determine rich-text vs textarea at runtime per element
  function elementIsRichText(el) {
    if (config.isRichText === true)  return true;
    if (config.isRichText === false) return false;
    // null → runtime probe: textarea elements are never contenteditable
    return el.tagName !== 'TEXTAREA' && el.getAttribute('contenteditable') === 'true';
  }

  function getInputText(el) {
    if (elementIsRichText(el)) return el.innerText || el.textContent || '';
    return el.value || '';
  }

  // setInputText: Robust 3-strategy cascade for React/Vue/Quill contenteditable.
  //
  // Strategy order (most reliable first):
  //   1. execCommand('selectAll') + execCommand('insertText')
  //      — the de-facto standard for React-controlled contenteditable; triggers
  //        React's synthetic onChange and keeps fiber state in sync.
  //        Still fully supported in Chrome for contenteditable nodes (2024+).
  //   2. ClipboardEvent paste
  //      — works for Quill (.ql-editor) and ProseMirror on Claude/Gemini.
  //   3. Direct DOM write + text nodes
  //      — last-resort; the visible DOM text is correct even if framework state
  //        isn't updated; the submit reads innerHTML/innerText so the right text
  //        is what gets sent.
  //
  // Every strategy concludes by firing InputEvent + Event('input'/'change') so
  // all major frameworks (React, Vue, Svelte, Quill, ProseMirror) see the edit.
  function setInputText(el, text) {
    // ── Strategy 0: Plain <textarea> (Perplexity legacy) ──────────────────
    if (!elementIsRichText(el)) {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      if (proto && proto.set) {
        proto.set.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // ── All contenteditable strategies ────────────────────────────────────
    el.focus();

    let succeeded = false;

    // ── Strategy 1: execCommand (most reliable for React contenteditable) ─
    try {
      document.execCommand('selectAll', false, null);
      succeeded = document.execCommand('insertText', false, text);
      // Verify the text actually landed
      if (succeeded) {
        const current = (el.innerText || el.textContent || '').trim();
        if (current !== text.trim()) succeeded = false;
      }
    } catch (_) {
      succeeded = false;
    }

    // ── Strategy 2: ClipboardEvent paste (Quill / ProseMirror) ───────────
    if (!succeeded) {
      try {
        el.innerHTML = '';
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: dt,
        }));
        const current = (el.innerText || el.textContent || '').trim();
        if (current === text.trim()) succeeded = true;
      } catch (_) {
        succeeded = false;
      }
    }

    // ── Strategy 3: Direct DOM write ─────────────────────────────────────
    if (!succeeded) {
      el.innerHTML = '';
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) el.appendChild(document.createElement('br'));
        el.appendChild(document.createTextNode(line));
      });
    }

    // ── Always fire framework update events ───────────────────────────────
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true,
      inputType: 'insertText', data: text,
    }));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ─── Submit ───────────────────────────────────────────────────────────────

  // triggerSubmit: fires the send action immediately (no internal delay).
  // The caller (verifyAndSubmit) is responsible for scheduling the right delay
  // after confirming the text was written to the input element.
  function triggerSubmit(inputEl, onDone) {
    const btn = findSendButton();
    if (btn && !btn.disabled) {
      btn.click();
    } else {
      ['keydown', 'keypress', 'keyup'].forEach(function (type) {
        inputEl.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter', code: 'Enter', keyCode: 13,
          which: 13, bubbles: true, cancelable: true,
        }));
      });
    }
    if (onDone) onDone();
  }

  // ─── Feedback Storage ─────────────────────────────────────────────────────

  function storeFeedback(signal) {
    // signal: 'up' | 'down'
    chrome.storage.local.get(STORAGE_KEY_FEEDBACK, (r) => {
      const fb = r[STORAGE_KEY_FEEDBACK] || [];
      fb.push({
        ts:       Date.now(),
        signal,
        platform: PLATFORM,
        mode:     domainMode,
      });
      // Keep last 500 feedback entries
      if (fb.length > 500) fb.splice(0, fb.length - 500);
      chrome.storage.local.set({ [STORAGE_KEY_FEEDBACK]: fb });
    });
  }

  // ─── Skip Toast (#1) ──────────────────────────────────────────────────────

  function showSkipToast(reason) {
    const existing = document.getElementById('qb-toast');
    if (existing) return; // don't interrupt a real toast

    const toast = document.createElement('div');
    toast.id = 'qb-toast';
    toast.className = 'qb-toast-skip';
    toast.setAttribute('role', 'status');

    toast.innerHTML =
      '<div class="qb-toast-main">' +
        '<span class="qb-toast-icon qb-toast-icon-dim">⚡</span>' +
        '<div class="qb-toast-text">' +
          '<span class="qb-toast-title qb-toast-title-dim">Boost skipped</span>' +
          '<span class="qb-toast-type">' + reason + '</span>' +
        '</div>' +
        '<button class="qb-toast-close" aria-label="Dismiss">✕</button>' +
      '</div>';

    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { toast.classList.add('qb-toast-visible'); });
    });

    function dismissSkip() {
      toast.classList.remove('qb-toast-visible');
      toast.classList.add('qb-toast-hiding');
      setTimeout(function () { if (toast.isConnected) toast.remove(); }, 350);
    }

    toast.querySelector('.qb-toast-close').addEventListener('click', dismissSkip);
    setTimeout(dismissSkip, 2500);
  }

  // ─── Toast ────────────────────────────────────────────────────────────────

  let toastTimer = null;

  function showToast(original, enhanced, fromCache) {
    const existing = document.getElementById('qb-toast');
    if (existing) existing.remove();
    if (toastTimer) clearTimeout(toastTimer);

    function esc(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
              .replace(/\n/g,'<br>');
    }

    // Extract injected wrapper text (what was added after the separator)
    const sepIdx     = enhanced.indexOf(SEPARATOR);
    const wrapperText= sepIdx >= 0 ? enhanced.slice(sepIdx + SEPARATOR.length) : '';

    const origSnippet   = original.length  > 130 ? original.slice(0, 130)  + '…' : original;
    const boostSnippet  = enhanced.length  > 220 ? enhanced.slice(0, 220)  + '…' : enhanced;
    const wrapperSnippet= wrapperText.length > 200 ? wrapperText.slice(0, 200) + '…' : wrapperText;

    const cacheBadge = fromCache ? '<span class="qb-cache-badge" title="Result from session cache">cached</span>' : '';
    const persona    = domainMode !== 'general' ? domainMode : '';
    const subtitle   = [PLATFORM, persona].filter(Boolean).join(' · ');

    const toast = document.createElement('div');
    toast.id = 'qb-toast';
    toast.setAttribute('role', 'status');

    toast.innerHTML =
      '<div class="qb-toast-main">' +
        '<span class="qb-toast-icon">⚡</span>' +
        '<div class="qb-toast-text">' +
          '<span class="qb-toast-title">Query boosted ' + cacheBadge + '</span>' +
          (subtitle ? '<span class="qb-toast-type">' + subtitle + '</span>' : '') +
        '</div>' +
        '<button class="qb-toast-peek" title="See what was added">' +
          '<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3C5 3 1.73 7.11 1.05 9.77a1 1 0 000 .46C1.73 12.89 5 17 10 17s8.27-4.11 8.95-6.77a1 1 0 000-.46C18.27 7.11 15 3 10 3zm0 11a4 4 0 110-8 4 4 0 010 8zm0-6a2 2 0 100 4 2 2 0 000-4z"/></svg>' +
          'Preview' +
        '</button>' +
        '<button class="qb-toast-close" aria-label="Dismiss">✕</button>' +
      '</div>' +

      // Feedback row
      '<div class="qb-toast-feedback">' +
        '<span class="qb-feedback-label">Was this boost helpful?</span>' +
        '<button class="qb-feedback-btn qb-feedback-up" data-val="up" title="Good boost">👍</button>' +
        '<button class="qb-feedback-btn qb-feedback-dn" data-val="down" title="Not helpful">👎</button>' +
      '</div>' +

      // Preview panel
      '<div class="qb-toast-preview" aria-hidden="true">' +
        '<div class="qb-preview-block">' +
          '<span class="qb-preview-label">Original</span>' +
          '<div class="qb-preview-text qb-preview-original">' + esc(origSnippet) + '</div>' +
        '</div>' +
        (transparency && wrapperText
          ? '<div class="qb-preview-block">' +
              '<span class="qb-preview-label">Injected wrapper</span>' +
              '<div class="qb-preview-text qb-preview-wrapper">' + esc(wrapperSnippet) + '</div>' +
            '</div>'
          : '<div class="qb-preview-block">' +
              '<span class="qb-preview-label">With boost</span>' +
              '<div class="qb-preview-text qb-preview-boosted">' + esc(boostSnippet) + '</div>' +
            '</div>'
        ) +
      '</div>';

    document.body.appendChild(toast);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        toast.classList.add('qb-toast-visible');
      });
    });

    function dismiss() {
      if (!toast.isConnected) return;
      toast.classList.remove('qb-toast-visible');
      toast.classList.add('qb-toast-hiding');
      setTimeout(function () { if (toast.isConnected) toast.remove(); }, 350);
      clearTimeout(toastTimer);
    }

    var previewOpen = false;
    toast.querySelector('.qb-toast-peek').addEventListener('click', function (e) {
      e.stopPropagation();
      previewOpen = !previewOpen;
      var preview = toast.querySelector('.qb-toast-preview');
      if (previewOpen) {
        preview.classList.add('qb-toast-preview-open');
        preview.setAttribute('aria-hidden', 'false');
      } else {
        preview.classList.remove('qb-toast-preview-open');
        preview.setAttribute('aria-hidden', 'true');
      }
      clearTimeout(toastTimer);
      toastTimer = setTimeout(dismiss, TOAST_DURATION_MS);
    });

    toast.querySelector('.qb-toast-close').addEventListener('click', dismiss);

    // Feedback buttons
    toast.querySelectorAll('.qb-feedback-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const signal = btn.dataset.val;
        storeFeedback(signal);
        // Visual confirmation
        var feedbackRow = toast.querySelector('.qb-toast-feedback');
        feedbackRow.textContent = '';
        var doneSpan = document.createElement('span');
        doneSpan.className = 'qb-feedback-done';
        doneSpan.textContent = signal === 'up' ? '👍 Thanks!' : '👎 Noted!';
        feedbackRow.appendChild(doneSpan);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(dismiss, 1800);
      });
    });

    toastTimer = setTimeout(dismiss, TOAST_DURATION_MS);
  }

  // ─── Confirm Modal ────────────────────────────────────────────────────────
  //
  // When confirmMode is ON, this modal shows a before/after comparison and
  // waits for the user to press "Send Enhanced", "Send Original", or "Cancel".
  // Calling code passes onSendEnhanced / onSendOriginal / onCancel callbacks.
  // The "Don't show again" checkbox writes false to STORAGE_KEY_CONFIRM_MODE.

  function showConfirmModal(original, enhanced, typeLabel, onSendEnhanced, onSendOriginal, onCancel) {
    // Remove any existing overlay
    var existing = document.getElementById('qb-confirm-overlay');
    if (existing) existing.remove();

    function esc(s) {
      return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/\n/g,'<br>');
    }

    // Extract just the injected wrapper (the part after the separator)
    var sepIdx    = enhanced.indexOf(SEPARATOR);
    var addedText = sepIdx >= 0 ? enhanced.slice(sepIdx + SEPARATOR.length) : '';

    var origSnippet    = original.length  > 400 ? original.slice(0, 400)  + '…' : original;
    var enhSnippet     = enhanced.length  > 600 ? enhanced.slice(0, 600)  + '…' : enhanced;
    var addedSnippet   = addedText.length > 400 ? addedText.slice(0, 400) + '…' : addedText;

    var overlay = document.createElement('div');
    overlay.id = 'qb-confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'QueryBoost — Review Enhanced Query');

    overlay.innerHTML =
      '<div id="qb-confirm-modal">' +
        '<div class="qbcm-header">' +
          '<span class="qbcm-icon">⚡</span>' +
          '<span class="qbcm-title">Your query was enhanced</span>' +
          '<span class="qbcm-badge">' + esc(typeLabel) + '</span>' +
        '</div>' +

        '<div class="qbcm-panels">' +
          '<div class="qbcm-panel qbcm-panel-original">' +
            '<span class="qbcm-panel-label">Original</span>' +
            '<div class="qbcm-panel-text">' + esc(origSnippet) + '</div>' +
          '</div>' +
          '<div class="qbcm-panel qbcm-panel-enhanced">' +
            '<span class="qbcm-panel-label">Enhanced ✦</span>' +
            '<div class="qbcm-panel-text">' + esc(enhSnippet) + '</div>' +
          '</div>' +
        '</div>' +

        (addedText
          ? '<div class="qbcm-added">' +
              '<span class="qbcm-added-label">What was added</span>' +
              '<div class="qbcm-added-text">' + esc(addedSnippet) + '</div>' +
            '</div>'
          : '') +

        '<div class="qbcm-footer">' +
          '<button class="qbcm-btn qbcm-btn-send" id="qbcm-send-enhanced">⚡ Send Enhanced</button>' +
          '<button class="qbcm-btn qbcm-btn-original" id="qbcm-send-original">Send Original</button>' +
          '<button class="qbcm-btn qbcm-btn-cancel" id="qbcm-cancel">Cancel</button>' +
          '<label class="qbcm-silent-row">' +
            '<input type="checkbox" id="qbcm-silent-checkbox" />' +
            '<span class="qbcm-silent-label">Don\'t show this again (switch to silent mode)</span>' +
          '</label>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add('qb-overlay-visible');
      });
    });

    function closeOverlay() {
      overlay.classList.remove('qb-overlay-visible');
      setTimeout(function () { if (overlay.isConnected) overlay.remove(); }, 280);
    }

    function maybeDisableConfirm() {
      var cb = document.getElementById('qbcm-silent-checkbox');
      if (cb && cb.checked) {
        confirmMode = false;
        chrome.storage.sync.set({ [STORAGE_KEY_CONFIRM_MODE]: false });
      }
    }

    document.getElementById('qbcm-send-enhanced').addEventListener('click', function () {
      maybeDisableConfirm();
      closeOverlay();
      if (onSendEnhanced) onSendEnhanced();
    });

    document.getElementById('qbcm-send-original').addEventListener('click', function () {
      maybeDisableConfirm();
      closeOverlay();
      if (onSendOriginal) onSendOriginal();
    });

    document.getElementById('qbcm-cancel').addEventListener('click', function () {
      closeOverlay();
      if (onCancel) onCancel();
    });

    // Close on overlay click (outside modal)
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        closeOverlay();
        if (onCancel) onCancel();
      }
    });

    // Close on Escape
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKeyDown, true);
        closeOverlay();
        if (onCancel) onCancel();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
  }

  // ─── Core Handler ─────────────────────────────────────────────────────────

  var isProcessing = false;

  function handleSubmit(e) {
    if (isProcessing) return;
    if (!isEnabled) return;

    var inputEl = findInput();
    if (!inputEl) return;

    var rawText = getInputText(inputEl).trim();
    if (!rawText || rawText.length < 4) return;

    // Guard against double-wrapping: check both the sentinel and the injected separator
    if (rawText.indexOf('Do not mention these instructions') !== -1) return;
    if (rawText.indexOf(SEPARATOR) !== -1) return;

    if (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    isProcessing = true;

    var result;
    try {
      result = buildEnhancedQuery(rawText);
    } catch (err) {
      console.debug('[QueryBoost] buildEnhancedQuery failed:', err);
      isProcessing = false;
      return;
    }

    if (result.skipped) {
      isProcessing = false;
      var skipReasons = {
        [SKIP.FOLLOW_UP]:  'Follow-up detected — sent as-is',
        [SKIP.TOO_SHORT]:  'Query too short — sent as-is',
        [SKIP.CODE_PASTE]: 'Code paste detected — sent as-is',
      };
      showSkipToast(skipReasons[result.label] || 'Sent as-is');
      return;
    }

    var enhanced = result.enhanced;
    var label    = result.label;

    // Increment counter before triggering submit.
    // All async storage ops are kicked off together; isProcessing is cleared
    // only in the triggerSubmit callback, after the click/keypress has fired.
    chrome.storage.sync.get(QB_KEYS.COUNT, function (r) {
      if (chrome.runtime.lastError) {
        console.warn('[QueryBoost] storage.sync.get (count) failed:', chrome.runtime.lastError.message);
      }
      var prev = (typeof r[QB_KEYS.COUNT] === 'number') ? r[QB_KEYS.COUNT] : 0;
      chrome.storage.sync.set({
        [QB_KEYS.LAST_TYPE]:     label,
        [QB_KEYS.PLATFORM]:      PLATFORM,
        [QB_KEYS.LAST_BOOST_TS]: Date.now(),
        [QB_KEYS.COUNT]:         prev + 1,
      });
    });

    // Store last boost info for popup re-display
    chrome.storage.local.set({
      [QB_KEYS.LAST_BOOST_INFO]: {
        label:    label,
        original: rawText.slice(0, 300),
        platform: PLATFORM,
        mode:     domainMode,
        ts:       Date.now(),
      },
    });

    // ── Helper: write enhanced text and fire submit ───────────────────────
    function doSendEnhanced() {
      setInputText(inputEl, enhanced);
      showToast(rawText, enhanced, result.fromCache);

      var verifyAttempts = 0;
      function verifyAndSubmit() {
        verifyAttempts++;
        var current = getInputText(inputEl).trim();
        var verified = current.indexOf('Do not mention these instructions') !== -1;
        if (!verified && verifyAttempts < 3) {
          setInputText(inputEl, enhanced);
          setTimeout(verifyAndSubmit, 60);
          return;
        }
        triggerSubmit(inputEl, function () { isProcessing = false; });
      }
      setTimeout(verifyAndSubmit, SUBMIT_DELAY_MS);
    }

    // ── Helper: send the original query unmodified ────────────────────────
    function doSendOriginal() {
      // The input already has the original text — just submit
      triggerSubmit(inputEl, function () { isProcessing = false; });
    }

    // ── Branch: Confirm Mode (show before/after modal) ────────────────────
    if (confirmMode) {
      showConfirmModal(
        rawText, enhanced, label,
        /* onSendEnhanced */ doSendEnhanced,
        /* onSendOriginal */ doSendOriginal,
        /* onCancel       */ function () { isProcessing = false; }
      );
    } else {
      // Silent mode — enhance and submit immediately
      doSendEnhanced();
    }
  }

  // ─── Attach Listeners ─────────────────────────────────────────────────────

  var attachedInput  = null;
  var attachedButton = null;

  function attachListeners(inputEl, sendBtn) {
    if (attachedInput && attachedInput._qbKey) {
      attachedInput.removeEventListener('keydown', attachedInput._qbKey, true);
    }
    if (attachedButton && attachedButton._qbClick) {
      attachedButton.removeEventListener('click', attachedButton._qbClick, true);
    }

    inputEl._qbKey = function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        handleSubmit(e);
      }
    };
    inputEl.addEventListener('keydown', inputEl._qbKey, true);
    attachedInput = inputEl;

    if (sendBtn) {
      sendBtn._qbClick = function (e) { handleSubmit(e); };
      sendBtn.addEventListener('click', sendBtn._qbClick, true);
      attachedButton = sendBtn;
    }
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────

  var debounce = null;

  function tryAttach() {
    var inputEl = findInput();
    var sendBtn = findSendButton();
    if (!inputEl) return;
    if (inputEl === attachedInput && sendBtn === attachedButton) return;
    attachListeners(inputEl, sendBtn);
  }

  // Document-level observer catches most DOM changes
  var observer = new MutationObserver(function () {
    clearTimeout(debounce);
    debounce = setTimeout(tryAttach, 250);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Fix #3: Gemini's <rich-textarea> mounts its editor inside a shadow root.
  // Mutations inside shadow DOM don't bubble to the document observer, so we
  // attach a second observer directly on each rich-textarea's shadow root
  // once it appears in the document.
  if (PLATFORM === 'gemini') {
    var observedShadowRoots = new WeakSet();

    function watchGeminiShadows() {
      document.querySelectorAll('rich-textarea').forEach(function (rt) {
        var root = rt.shadowRoot;
        if (!root || observedShadowRoots.has(root)) return;
        observedShadowRoots.add(root);
        new MutationObserver(function () {
          clearTimeout(debounce);
          debounce = setTimeout(tryAttach, 250);
        }).observe(root, { childList: true, subtree: true });
      });
    }

    // Run immediately and also on each document mutation (new rich-textarea may appear)
    watchGeminiShadows();
    new MutationObserver(watchGeminiShadows)
      .observe(document.documentElement, { childList: true, subtree: true });
  }

  tryAttach();
  setTimeout(tryAttach, 800);
  setTimeout(tryAttach, 2000);
  setTimeout(tryAttach, 4000);

  // ─── Messages ─────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (msg, _sender, respond) {
    if (msg.type === 'QB_PING')         respond({ alive: true, platform: PLATFORM });
    if (msg.type === 'QB_GET_PLATFORM') respond({ platform: PLATFORM });

    // QB_MANUAL_BOOST: triggered by the popup "Test Boost" button.
    // Reads whatever text is currently in the input, runs it through the full
    // enhancement pipeline (without submitting), and reports back the result.
    // This lets reviewers verify the feature works without having to type and send.
    if (msg.type === 'QB_MANUAL_BOOST') {
      var inputEl = findInput();
      if (!inputEl) {
        respond({ ok: false, error: 'Input field not found on this page.' });
        return;
      }
      var rawText = getInputText(inputEl).trim();
      if (!rawText || rawText.length < 4) {
        respond({ ok: false, error: 'Please type a query into the AI input first.' });
        return;
      }
      var result;
      try {
        result = buildEnhancedQuery(rawText);
      } catch (err) {
        respond({ ok: false, error: 'Enhancement error: ' + err.message });
        return;
      }
      if (result.skipped) {
        respond({ ok: false, error: 'Query was skipped: ' + result.label });
        return;
      }
      // Apply the enhancement to the input (preview only — no submit)
      setInputText(inputEl, result.enhanced);
      showToast(rawText, result.enhanced, result.fromCache);
      respond({ ok: true, label: result.label });
    }
  });

})();
