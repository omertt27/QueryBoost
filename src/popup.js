/**
 * QueryBoost — Popup Script v3.0
 * Handles: toggle, platform detection, domain mode, transparency,
 * universal custom wrapper, feedback summary, feedback log.
 *
 * All storage keys sourced from QB_KEYS (constants.js loaded first).
 * Consolidated onChanged handler refreshes all derived UI.
 * Feedback log built with createElement/textContent (no innerHTML XSS).
 */

'use strict';

// ── Storage keys from shared constants (constants.js loaded before this file) ─

const STORAGE_KEY_ENABLED      = QB_KEYS.ENABLED;
const STORAGE_KEY_LAST_TYPE    = QB_KEYS.LAST_TYPE;
const STORAGE_KEY_PLATFORM     = QB_KEYS.PLATFORM;
const STORAGE_KEY_COUNT        = QB_KEYS.COUNT;
const STORAGE_KEY_DOMAIN_MODE  = QB_KEYS.DOMAIN_MODE;
const STORAGE_KEY_TRANSPARENCY = QB_KEYS.TRANSPARENCY;
const STORAGE_KEY_FEEDBACK     = QB_KEYS.FEEDBACK;
const STORAGE_KEY_CUSTOM_WRAP  = QB_KEYS.CUSTOM_WRAP;
const STORAGE_KEY_LAST_BOOST_TS= QB_KEYS.LAST_BOOST_TS;
const STORAGE_KEY_CONFIRM_MODE = QB_KEYS.CONFIRM_MODE;

// ── Platform display config ───────────────────────────────

const PLATFORM_META = {
  Claude:      { className: 'platform-claude',      emoji: '🟠' },
  ChatGPT:     { className: 'platform-chatgpt',     emoji: '🟢' },
  Gemini:      { className: 'platform-gemini',      emoji: '🔵' },
  Perplexity:  { className: 'platform-perplexity',  emoji: '🟣' },
};

const DOMAIN_MODE_DESCRIPTIONS = {
  general:    'Standard mode — no persona applied',
  developer:  'Assumes senior engineer context; skips basics',
  student:    'Assumes first-time learner; prioritizes clarity',
  researcher: 'Assumes academic context; emphasizes rigor',
  writer:     'Assumes professional writer; emphasizes style',
};

// Actual persona prefix text prepended to every boosted query
const DOMAIN_MODE_PERSONAS = {
  general:    '',
  developer:  'Prefix: "Assume I am an experienced software engineer who values precision and brevity. Skip over-explaining basics."',
  student:    'Prefix: "Assume I am a university student learning this for the first time. Prioritize clarity and foundational understanding."',
  researcher: 'Prefix: "Assume I am a researcher who needs rigorous, evidence-based reasoning. Cite where relevant. Prefer depth over accessibility."',
  writer:     'Prefix: "Assume I am a professional writer focused on clarity, tone, and style. Emphasize language quality above technical depth."',
};

// ── DOM references ────────────────────────────────────────

const toggleInput         = document.getElementById('qb-toggle-input');
const toggleStatus        = document.getElementById('qb-toggle-status');
const platformCard        = document.getElementById('qb-platform-card');
const platformValue       = document.getElementById('qb-platform-value');
const platformNameEl      = document.getElementById('qb-platform-name');
const lastTypeEl          = document.getElementById('qb-last-type');
const boostCountEl        = document.getElementById('qb-boost-count');
const domainSelect        = document.getElementById('qb-domain-select');
const modeDescEl          = document.getElementById('qb-mode-desc');
const transparencyInput   = document.getElementById('qb-transparency-input');
const confirmInput        = document.getElementById('qb-confirm-input');
const resetFeedbackBtn    = document.getElementById('qb-reset-feedback');
const customTypeSelect    = document.getElementById('qb-custom-type-select');
const customTextarea      = document.getElementById('qb-custom-textarea');
const customSaveBtn       = document.getElementById('qb-custom-save');
const customClearBtn      = document.getElementById('qb-custom-clear');
const customStatusEl      = document.getElementById('qb-custom-status');
const customListEl        = document.getElementById('qb-custom-list');
const feedbackLogEl       = document.getElementById('qb-feedback-log');
const lastBoostTimeEl     = document.getElementById('qb-last-boost-time');
const storageValEl        = document.getElementById('qb-storage-val');
const storageBarEl        = document.getElementById('qb-storage-bar');
const modePersonaEl       = document.getElementById('qb-mode-persona');
const lastBoostDetailCard = document.getElementById('qb-last-boost-detail-card');
const lastBoostDetailBody = document.getElementById('qb-last-boost-detail');
const detailToggleBtn     = document.getElementById('qb-detail-toggle');

// ── Tab navigation ────────────────────────────────────────

document.querySelectorAll('.qb-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.qb-tab').forEach((t) => t.classList.remove('qb-tab-active'));
    btn.classList.add('qb-tab-active');

    const target = btn.dataset.tab;
    document.querySelectorAll('.qb-panel').forEach((p) => p.classList.add('qb-panel-hidden'));
    const panel = document.getElementById('panel-' + target);
    if (panel) panel.classList.remove('qb-panel-hidden');

    // Refresh data-heavy panels on open
    if (target === 'stats')  { loadFeedbackSummary(); loadFeedbackLog(); }
    if (target === 'custom') { loadCustomWrappers(); loadSyncStorageUsage(); }
  });
});

// ── Render helpers ────────────────────────────────────────

function renderToggle(enabled) {
  toggleInput.checked = enabled;
  toggleStatus.textContent = enabled ? 'Active — queries are being boosted' : 'Paused — queries sent as-is';
  toggleStatus.style.color = enabled ? '#3ecf8e' : '#f25f5c';
}

function renderPlatform(platformName) {
  platformCard.className = 'qb-card';
  const dot = platformValue.querySelector('.dot');
  if (platformName && PLATFORM_META[platformName]) {
    const meta = PLATFORM_META[platformName];
    platformCard.classList.add(meta.className);
    dot.className = 'dot active';
    platformNameEl.textContent = platformName;
  } else {
    dot.className = 'dot inactive';
    platformNameEl.textContent = 'Not active';
    platformNameEl.style.color = '#55556a';
  }
}

function renderLastType(lastType) {
  if (lastType) {
    lastTypeEl.textContent = lastType + ' ⚡';
    lastTypeEl.style.color = '#a78bfa';
    lastTypeEl.style.fontSize = '11px';
  } else {
    lastTypeEl.textContent = 'No boosts yet';
    lastTypeEl.style.color = '#55556a';
  }
}

function renderCount(count) {
  const n = Number(count) || 0;
  const current = parseInt(boostCountEl.textContent.replace(/,/g, ''), 10) || 0;
  if (n !== current) {
    boostCountEl.classList.remove('qb-count-bump');
    void boostCountEl.offsetWidth;
    boostCountEl.classList.add('qb-count-bump');
  }
  boostCountEl.textContent = n.toLocaleString();
}

function renderDomainMode(mode) {
  if (domainSelect) domainSelect.value = mode || 'general';
  if (modeDescEl)   modeDescEl.textContent = DOMAIN_MODE_DESCRIPTIONS[mode] || DOMAIN_MODE_DESCRIPTIONS.general;
  // #4: show the actual injected persona prefix text
  if (modePersonaEl) {
    const persona = DOMAIN_MODE_PERSONAS[mode] || '';
    modePersonaEl.textContent = persona;
    modePersonaEl.style.display = persona ? 'block' : 'none';
  }
}

function renderTransparency(val) {
  if (transparencyInput) transparencyInput.checked = !!val;
}

function renderConfirmMode(val) {
  if (confirmInput) confirmInput.checked = val !== false; // default true
}

// ── Last boost timestamp ──────────────────────────────────

function renderLastBoostTime(ts) {
  if (!lastBoostTimeEl) return;
  if (!ts) {
    lastBoostTimeEl.textContent = 'No boosts recorded yet';
    lastBoostTimeEl.style.color = '#55556a';
    return;
  }
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hrs  = Math.floor(mins / 60);
  let label;
  if (secs < 10)        label = 'Just now';
  else if (secs < 60)   label = secs + 's ago';
  else if (mins < 60)   label = mins + 'm ago';
  else if (hrs < 24)    label = hrs + 'h ago';
  else                  label = new Date(ts).toLocaleDateString();
  lastBoostTimeEl.textContent = label;
  // Green if recent (< 5 min), amber if stale (> 30 min), grey if none
  if (mins < 5)       lastBoostTimeEl.style.color = '#3ecf8e';
  else if (mins < 30) lastBoostTimeEl.style.color = '#f5c842';
  else                lastBoostTimeEl.style.color = '#8888a0';
}

// ── Sync storage byte counter ─────────────────────────────

const SYNC_QUOTA_BYTES = 102400; // Chrome's chrome.storage.sync limit: 100 KB

function loadSyncStorageUsage() {
  if (!storageValEl || !storageBarEl) return;
  chrome.storage.sync.getBytesInUse(null, (bytes) => {
    const kb   = (bytes / 1024).toFixed(1);
    const pct  = Math.min(100, Math.round((bytes / SYNC_QUOTA_BYTES) * 100));
    storageValEl.textContent = kb + ' KB / 100 KB (' + pct + '%)';
    storageBarEl.style.width = pct + '%';
    // Color: green < 50%, amber 50–80%, red > 80%
    if (pct < 50)       storageBarEl.style.background = '#3ecf8e';
    else if (pct < 80)  storageBarEl.style.background = '#f5c842';
    else                storageBarEl.style.background = '#f25f5c';
  });
}

// ── Feedback Summary ──────────────────────────────────────

function loadFeedbackSummary() {
  chrome.storage.sync.get([STORAGE_KEY_COUNT], (sr) => {
    const totalBoosts = sr[STORAGE_KEY_COUNT] || 0;
    chrome.storage.local.get([STORAGE_KEY_FEEDBACK], (r) => {
      const fb   = r[STORAGE_KEY_FEEDBACK] || [];
      const up   = fb.filter((e) => e.signal === 'up').length;
      const down = fb.filter((e) => e.signal === 'down').length;
      const total = up + down;
      const rate  = total > 0 ? Math.round((up / total) * 100) + '%' : '–';

      const el = document.getElementById('qb-feedback-summary');
      if (!el) return;
      el.innerHTML = '';

      const rows = [
        ['Total boosts', totalBoosts.toLocaleString()],
        ['👍 Helpful',   up],
        ['👎 Not helpful', down],
        ['Approval rate', rate],
      ];
      rows.forEach(([label, val]) => {
        const row = document.createElement('div');
        row.className = 'qb-ab-row';
        const lbl = document.createElement('span');
        lbl.textContent = label;
        const v = document.createElement('span');
        v.textContent = val;
        row.append(lbl, v);
        el.appendChild(row);
      });
    });
  });
}

// ── Feedback log ──────────────────────────────────────────

function loadFeedbackLog() {
  chrome.storage.local.get([STORAGE_KEY_FEEDBACK], (r) => {
    const fb = r[STORAGE_KEY_FEEDBACK] || [];

    // ── Recent entries (last 15) ──
    const recent = fb.slice(-15).reverse();
    feedbackLogEl.innerHTML = '';
    if (recent.length === 0) {
      const li = document.createElement('li');
      li.className = 'qb-feedback-empty';
      li.textContent = 'No feedback recorded yet.';
      feedbackLogEl.appendChild(li);
    } else {
      recent.forEach((entry) => {
        const d    = new Date(entry.ts);
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const li = document.createElement('li');
        li.className = 'qb-feedback-item';

        const icon = document.createElement('span');
        icon.className = 'qb-fi-icon';
        icon.textContent = entry.signal === 'up' ? '👍' : '👎';

        const meta = document.createElement('span');
        meta.className = 'qb-fi-meta';
        meta.textContent = [entry.platform, entry.mode].filter(Boolean).join(' · ');

        const timeEl = document.createElement('span');
        timeEl.className = 'qb-fi-time';
        timeEl.textContent = time;

        li.append(icon, meta, timeEl);
        feedbackLogEl.appendChild(li);
      });
    }
  });
}

// ── Custom Wrappers ───────────────────────────────────────

let _customWraps = {};

function loadCustomWrappers() {
  chrome.storage.sync.get(STORAGE_KEY_CUSTOM_WRAP, (r) => {
    _customWraps = r[STORAGE_KEY_CUSTOM_WRAP] || {};
    if (customTextarea) customTextarea.value = _customWraps['universal'] || '';
    renderCustomList();
  });
}

function renderCustomList() {
  if (!customListEl) return;
  const hasUniversal = !!_customWraps['universal'];
  if (!hasUniversal) {
    customListEl.innerHTML = '<li class="qb-custom-empty">None yet — using built-in universal wrapper.</li>';
    return;
  }
  customListEl.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'qb-custom-item';
  const typeSpan = document.createElement('span');
  typeSpan.className = 'qb-ci-type';
  typeSpan.textContent = 'universal';
  const delBtn = document.createElement('button');
  delBtn.className = 'qb-ci-del';
  delBtn.title = 'Remove custom wrapper';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', () => {
    delete _customWraps['universal'];
    chrome.storage.sync.set({ [STORAGE_KEY_CUSTOM_WRAP]: _customWraps }, () => {
      if (customTextarea) customTextarea.value = '';
      renderCustomList();
      showCustomStatus('Wrapper removed.', false);
      loadSyncStorageUsage();
    });
  });
  li.append(typeSpan, delBtn);
  customListEl.appendChild(li);
}

function showCustomStatus(msg, isError) {
  customStatusEl.textContent = msg;
  customStatusEl.className = 'qb-custom-status ' + (isError ? 'qb-custom-status-error' : 'qb-custom-status-ok');
  setTimeout(() => { customStatusEl.textContent = ''; customStatusEl.className = 'qb-custom-status'; }, 2500);
}

if (customSaveBtn) {
  customSaveBtn.addEventListener('click', () => {
    const val = customTextarea ? customTextarea.value.trim() : '';
    if (val && !val.includes('{{query}}')) {
      showCustomStatus('Error: wrapper must contain {{query}}', true);
      return;
    }
    if (val) {
      _customWraps['universal'] = val;
    } else {
      delete _customWraps['universal'];
    }
    chrome.storage.sync.set({ [STORAGE_KEY_CUSTOM_WRAP]: _customWraps }, () => {
      renderCustomList();
      showCustomStatus(val ? '✓ Saved!' : '✓ Reset to default.', false);
      loadSyncStorageUsage();
    });
  });
}

if (customClearBtn) {
  customClearBtn.addEventListener('click', () => {
    if (customTextarea) customTextarea.value = '';
    delete _customWraps['universal'];
    chrome.storage.sync.set({ [STORAGE_KEY_CUSTOM_WRAP]: _customWraps }, () => {
      renderCustomList();
      showCustomStatus('Reset to default.', false);
      loadSyncStorageUsage();
    });
  });
}

// ── Reset feedback data ───────────────────────────────────

if (resetFeedbackBtn) {
  resetFeedbackBtn.addEventListener('click', () => {
    if (!confirm('Clear all feedback data?')) return;
    chrome.storage.local.remove([STORAGE_KEY_FEEDBACK], () => {
      loadFeedbackSummary();
      loadFeedbackLog();
      resetFeedbackBtn.textContent = '✓ Cleared';
      setTimeout(() => { resetFeedbackBtn.textContent = '🗑 Clear feedback data'; }, 2000);
    });
  });
}

// ── Init: Load all state from storage ─────────────────────

function init() {
  chrome.storage.sync.get(
    [STORAGE_KEY_ENABLED, STORAGE_KEY_LAST_TYPE, STORAGE_KEY_PLATFORM,
     STORAGE_KEY_COUNT, STORAGE_KEY_DOMAIN_MODE, STORAGE_KEY_TRANSPARENCY,
     STORAGE_KEY_LAST_BOOST_TS, STORAGE_KEY_CONFIRM_MODE],
    (result) => {
      const enabled     = result[STORAGE_KEY_ENABLED]     !== false;
      const lastType    = result[STORAGE_KEY_LAST_TYPE]   || null;
      const storedPlat  = result[STORAGE_KEY_PLATFORM]    || null;
      const count       = result[STORAGE_KEY_COUNT]       || 0;
      const mode        = result[STORAGE_KEY_DOMAIN_MODE] || 'general';
      const transp      = result[STORAGE_KEY_TRANSPARENCY] === true;
      const lastBoostTs = result[STORAGE_KEY_LAST_BOOST_TS] || null;
      const confirmMode = result[STORAGE_KEY_CONFIRM_MODE] !== false;

      renderToggle(enabled);
      renderLastType(lastType);
      renderCount(count);
      renderDomainMode(mode);
      renderTransparency(transp);
      renderConfirmMode(confirmMode);
      renderLastBoostTime(lastBoostTs);

      detectActivePlatform((livePlat) => {
        renderPlatform(livePlat || (storedPlat ? capitalize(storedPlat) : null));
      });
    }
  );

  // Pre-load custom wrappers for the custom tab
  chrome.storage.sync.get(STORAGE_KEY_CUSTOM_WRAP, (r) => {
    _customWraps = r[STORAGE_KEY_CUSTOM_WRAP] || {};
    renderCustomList();
  });

  // #9: Load last boost detail card on popup open
  loadLastBoostDetail();
}

function capitalize(str) {
  if (!str) return str;
  const map = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity' };
  return map[str.toLowerCase()] || (str.charAt(0).toUpperCase() + str.slice(1));
}

// ── Platform detection via background ─────────────────────

function detectActivePlatform(callback) {
  chrome.runtime.sendMessage({ type: 'QB_GET_ACTIVE_TAB_PLATFORM' }, (response) => {
    if (chrome.runtime.lastError || !response) { callback(null); return; }
    callback(response.platform || null);
  });
}

// ── Toggle handler ────────────────────────────────────────

toggleInput.addEventListener('change', () => {
  chrome.storage.sync.set({ [STORAGE_KEY_ENABLED]: toggleInput.checked }, () => {
    renderToggle(toggleInput.checked);
  });
});

// ── Domain mode handler ───────────────────────────────────

if (domainSelect) {
  domainSelect.addEventListener('change', () => {
    const mode = domainSelect.value;
    chrome.storage.sync.set({ [STORAGE_KEY_DOMAIN_MODE]: mode }, () => {
      renderDomainMode(mode);
    });
  });
}

// ── Transparency toggle ───────────────────────────────────

if (transparencyInput) {
  transparencyInput.addEventListener('change', () => {
    chrome.storage.sync.set({ [STORAGE_KEY_TRANSPARENCY]: transparencyInput.checked });
  });
}

// ── Confirm mode toggle ───────────────────────────────────

if (confirmInput) {
  confirmInput.addEventListener('change', () => {
    chrome.storage.sync.set({ [STORAGE_KEY_CONFIRM_MODE]: confirmInput.checked });
  });
}

// ── Storage change listener (live updates) ────────────────
// Fix #10: Single consolidated handler so every key change refreshes all
// derived UI, keeping the popup consistent during active boost sessions.

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes[STORAGE_KEY_ENABLED])      renderToggle(changes[STORAGE_KEY_ENABLED].newValue !== false);
    if (changes[STORAGE_KEY_LAST_TYPE])    renderLastType(changes[STORAGE_KEY_LAST_TYPE].newValue);
    if (changes[STORAGE_KEY_PLATFORM])     renderPlatform(capitalize(changes[STORAGE_KEY_PLATFORM].newValue));
    if (changes[STORAGE_KEY_COUNT])        renderCount(changes[STORAGE_KEY_COUNT].newValue);
    if (changes[STORAGE_KEY_DOMAIN_MODE])  renderDomainMode(changes[STORAGE_KEY_DOMAIN_MODE].newValue);
    if (changes[STORAGE_KEY_TRANSPARENCY]) renderTransparency(changes[STORAGE_KEY_TRANSPARENCY].newValue);
    if (changes[STORAGE_KEY_LAST_BOOST_TS]) renderLastBoostTime(changes[STORAGE_KEY_LAST_BOOST_TS].newValue);
    if (changes[STORAGE_KEY_CONFIRM_MODE]) renderConfirmMode(changes[STORAGE_KEY_CONFIRM_MODE].newValue);
  }
});

// ── Feedback filter handlers ───────────────────────────────

const filterTypeEl = document.getElementById('qb-filter-type');
if (filterTypeEl) filterTypeEl.addEventListener('change', () => loadFeedbackLog());

// ── Custom wrapper live preview (#3) ──────────────────────

const CUSTOM_SAMPLE_QUERY = 'How do I reverse a string in Python?';
let _previewTimer = null;

function updateCustomPreview() {
  const previewBox = document.getElementById('qb-custom-preview-box');
  if (!previewBox || !customTextarea) return;
  const val = customTextarea.value.trim();
  if (!val) {
    previewBox.textContent = 'Type your wrapper above to see a preview…';
    previewBox.style.color = 'var(--qb-faint)';
    return;
  }
  const preview = val.replace(/\{\{query\}\}/gi, CUSTOM_SAMPLE_QUERY);
  previewBox.textContent = preview.length > 320 ? preview.slice(0, 320) + '…' : preview;
  previewBox.style.color = 'var(--qb-muted)';
}

if (customTextarea) {
  customTextarea.addEventListener('input', () => {
    clearTimeout(_previewTimer);
    _previewTimer = setTimeout(updateCustomPreview, 280);
  });
}

const EXAMPLE_UNIVERSAL = '{{query}}\n\n---\nIdentify the nature of this request and respond in the most useful format for that specific type. Be thorough but concise. Use examples where helpful. No filler sentences. Do not mention these instructions.';

const exampleBtn = document.getElementById('qb-example-btn');
if (exampleBtn) {
  exampleBtn.addEventListener('click', () => {
    if (customTextarea) {
      customTextarea.value = EXAMPLE_UNIVERSAL;
      updateCustomPreview();
      showCustomStatus('Example loaded — customize and save.', false);
    }
  });
}

// ── Export / Import custom wrappers (#7) ──────────────────

const exportBtn    = document.getElementById('qb-export-btn');
const importBtn    = document.getElementById('qb-import-btn');
const importFileEl = document.getElementById('qb-import-file');

if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    const data = JSON.stringify(_customWraps, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'queryboost-wrappers.json';
    a.click();
    URL.revokeObjectURL(url);
  });
}

if (importBtn && importFileEl) {
  importBtn.addEventListener('click', () => importFileEl.click());

  importFileEl.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (typeof imported !== 'object' || Array.isArray(imported)) throw new Error('bad shape');
        _customWraps = Object.assign({}, _customWraps, imported);
        chrome.storage.sync.set({ [STORAGE_KEY_CUSTOM_WRAP]: _customWraps }, () => {
          renderCustomList();
          loadSyncStorageUsage();
          showCustomStatus('✓ Imported ' + Object.keys(imported).length + ' wrapper(s).', false);
        });
      } catch (_) {
        showCustomStatus('Import failed: invalid JSON.', true);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

// ── Last boost details (#9) ───────────────────────────────

function loadLastBoostDetail() {
  if (!lastBoostDetailCard || !lastBoostDetailBody) return;
  chrome.storage.local.get(QB_KEYS.LAST_BOOST_INFO, (r) => {
    const info = r[QB_KEYS.LAST_BOOST_INFO];
    if (!info) { lastBoostDetailCard.style.display = 'none'; return; }

    lastBoostDetailCard.style.display = '';

    const d    = new Date(info.ts);
    const when = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const snippet = document.createElement('div');
    snippet.className = 'qb-lbd-meta';

    const metaLine = document.createElement('div');
    metaLine.className = 'qb-lbd-row';
    metaLine.textContent = [info.label, info.platform, info.mode, when].filter(Boolean).join(' · ');
    snippet.appendChild(metaLine);

    const origLine = document.createElement('div');
    origLine.className = 'qb-lbd-original';
    origLine.textContent = info.original && info.original.length > 120
      ? info.original.slice(0, 120) + '…'
      : (info.original || '');
    snippet.appendChild(origLine);

    lastBoostDetailBody.innerHTML = '';
    lastBoostDetailBody.appendChild(snippet);
  });
}

if (detailToggleBtn && lastBoostDetailBody) {
  detailToggleBtn.addEventListener('click', () => {
    const isOpen = lastBoostDetailBody.style.display !== 'none';
    lastBoostDetailBody.style.display = isOpen ? 'none' : '';
    detailToggleBtn.textContent       = isOpen ? 'Show ▾' : 'Hide ▴';
    detailToggleBtn.setAttribute('aria-expanded', String(!isOpen));
  });
}

// ── Privacy link — opens as an extension page in a new tab ────────────────

const privacyLink = document.getElementById('qb-privacy-link');
if (privacyLink) {
  privacyLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('privacy.html') });
  });
}

// ── Boot ──────────────────────────────────────────────────

// ── Test Boost button ──────────────────────────────────────

const testBoostBtn    = document.getElementById('qb-test-boost-btn');
const testBoostResult = document.getElementById('qb-test-boost-result');

if (testBoostBtn) {
  testBoostBtn.addEventListener('click', () => {
    testBoostBtn.disabled  = true;
    testBoostBtn.textContent = '⏳ Enhancing…';
    if (testBoostResult) {
      testBoostResult.style.display = 'none';
      testBoostResult.textContent   = '';
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) {
        showTestResult('error', 'No active tab found.');
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'QB_MANUAL_BOOST' }, (response) => {
        if (chrome.runtime.lastError) {
          showTestResult('error',
            'Content script not ready. Please open a supported AI site (ChatGPT, Claude, Gemini, or Perplexity) and try again.');
          return;
        }
        if (!response) {
          showTestResult('error', 'No response from content script.');
          return;
        }
        if (!response.ok) {
          showTestResult('error', response.error || 'Unknown error.');
          return;
        }
        showTestResult('ok',
          '✓ Boost applied! The enhanced query is now in the input field. Check the toast on the page for a preview.');
      });
    });
  });
}

function showTestResult(kind, msg) {
  if (testBoostBtn) {
    testBoostBtn.disabled    = false;
    testBoostBtn.textContent = '⚡ Preview Boost on Active Tab';
  }
  if (!testBoostResult) return;
  testBoostResult.style.display = '';
  testBoostResult.textContent   = msg;
  if (kind === 'error') {
    testBoostResult.style.background = 'rgba(242,95,92,0.08)';
    testBoostResult.style.borderColor = 'rgba(242,95,92,0.25)';
    testBoostResult.style.color = '#f25f5c';
  } else {
    testBoostResult.style.background = 'rgba(62,207,142,0.08)';
    testBoostResult.style.borderColor = 'rgba(62,207,142,0.25)';
    testBoostResult.style.color = '#3ecf8e';
  }
}

init();
