/**
 * QueryBoost — Popup Script v2.0
 * Handles: toggle, platform detection, domain mode, transparency,
 * custom wrappers, A/B variant display, A/B stats, feedback log.
 */

'use strict';

// ── Storage keys (must match content.js) ─────────────────

const STORAGE_KEY_ENABLED      = 'qb_enabled';
const STORAGE_KEY_LAST_TYPE    = 'qb_last_type';
const STORAGE_KEY_PLATFORM     = 'qb_platform';
const STORAGE_KEY_COUNT        = 'qb_boost_count';
const STORAGE_KEY_DOMAIN_MODE  = 'qb_domain_mode';
const STORAGE_KEY_TRANSPARENCY = 'qb_transparency';
const STORAGE_KEY_AB_VARIANT   = 'qb_ab_variant';
const STORAGE_KEY_FEEDBACK     = 'qb_feedback';
const STORAGE_KEY_AB_STATS     = 'qb_ab_stats';
const STORAGE_KEY_CUSTOM_WRAP  = 'qb_custom_wrappers';
const STORAGE_KEY_LAST_BOOST_TS= 'qb_last_boost_ts';

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
const abVariantPill       = document.getElementById('qb-ab-variant-pill');
const resetFeedbackBtn    = document.getElementById('qb-reset-feedback');
const customTypeSelect    = document.getElementById('qb-custom-type-select');
const customTextarea      = document.getElementById('qb-custom-textarea');
const customSaveBtn       = document.getElementById('qb-custom-save');
const customClearBtn      = document.getElementById('qb-custom-clear');
const customStatusEl      = document.getElementById('qb-custom-status');
const customListEl        = document.getElementById('qb-custom-list');
const abASent             = document.getElementById('qb-ab-a-sent');
const abaUp               = document.getElementById('qb-ab-a-up');
const abaDown             = document.getElementById('qb-ab-a-down');
const abaRate             = document.getElementById('qb-ab-a-rate');
const abbSent             = document.getElementById('qb-ab-b-sent');
const abbUp               = document.getElementById('qb-ab-b-up');
const abbDown             = document.getElementById('qb-ab-b-down');
const abbRate             = document.getElementById('qb-ab-b-rate');
const typeStatsEl         = document.getElementById('qb-type-stats');
const feedbackLogEl       = document.getElementById('qb-feedback-log');
const lastBoostTimeEl     = document.getElementById('qb-last-boost-time');
const storageValEl        = document.getElementById('qb-storage-val');
const storageBarEl        = document.getElementById('qb-storage-bar');

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
    if (target === 'stats')  { loadABStats(); loadFeedbackLog(); }
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
}

function renderTransparency(val) {
  if (transparencyInput) transparencyInput.checked = !!val;
}

function renderABVariant(variant) {
  if (!abVariantPill) return;
  abVariantPill.textContent = 'Variant ' + (variant || '?');
  abVariantPill.className = 'qb-ab-pill qb-ab-pill-' + (variant || 'A').toLowerCase();
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

// ── A/B Stats ─────────────────────────────────────────────

function loadABStats() {
  chrome.storage.local.get([STORAGE_KEY_AB_STATS], (r) => {
    const stats = r[STORAGE_KEY_AB_STATS] || {};
    const A = stats['A'] || { sent: 0, thumbs_up: 0, thumbs_down: 0 };
    const B = stats['B'] || { sent: 0, thumbs_up: 0, thumbs_down: 0 };

    abASent.textContent  = A.sent;
    abaUp.textContent    = A.thumbs_up;
    abaDown.textContent  = A.thumbs_down;
    const aFb = A.thumbs_up + A.thumbs_down;
    abaRate.textContent  = aFb > 0 ? Math.round((A.thumbs_up / aFb) * 100) + '%' : '–';

    abbSent.textContent  = B.sent;
    abbUp.textContent    = B.thumbs_up;
    abbDown.textContent  = B.thumbs_down;
    const bFb = B.thumbs_up + B.thumbs_down;
    abbRate.textContent  = bFb > 0 ? Math.round((B.thumbs_up / bFb) * 100) + '%' : '–';
  });
}

// ── Feedback log & type breakdown ─────────────────────────

function loadFeedbackLog() {
  chrome.storage.local.get([STORAGE_KEY_FEEDBACK], (r) => {
    const fb = r[STORAGE_KEY_FEEDBACK] || [];

    // By query type
    const byType = {};
    fb.forEach((entry) => {
      const t = entry.type || 'unknown';
      if (!byType[t]) byType[t] = { up: 0, down: 0 };
      if (entry.signal === 'up') byType[t].up++;
      else byType[t].down++;
    });

    if (Object.keys(byType).length === 0) {
      typeStatsEl.innerHTML = '<span style="color:#55556a;font-size:11px;">No feedback yet.</span>';
    } else {
      typeStatsEl.innerHTML = Object.entries(byType).map(([type, counts]) => {
        const total = counts.up + counts.down;
        const rate  = total > 0 ? Math.round((counts.up / total) * 100) : 0;
        const bar   = `<div class="qb-ts-bar" style="width:${rate}%"></div>`;
        return `<div class="qb-ts-row">
          <span class="qb-ts-type">${type}</span>
          <div class="qb-ts-bar-track">${bar}</div>
          <span class="qb-ts-rate">${rate}%</span>
          <span class="qb-ts-counts">👍${counts.up} 👎${counts.down}</span>
        </div>`;
      }).join('');
    }

    // Recent entries (last 15)
    const recent = fb.slice(-15).reverse();
    if (recent.length === 0) {
      feedbackLogEl.innerHTML = '<li class="qb-feedback-empty">No feedback recorded yet.</li>';
    } else {
      feedbackLogEl.innerHTML = recent.map((entry) => {
        const d    = new Date(entry.ts);
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const icon = entry.signal === 'up' ? '👍' : '👎';
        return `<li class="qb-feedback-item">
          <span class="qb-fi-icon">${icon}</span>
          <span class="qb-fi-type">${entry.type || '?'}</span>
          <span class="qb-fi-meta">${entry.platform || ''} · v${entry.variant || '?'} · ${entry.mode || ''}</span>
          <span class="qb-fi-time">${time}</span>
        </li>`;
      }).join('');
    }
  });
}

// ── Custom Wrappers ───────────────────────────────────────

let _customWraps = {};

function loadCustomWrappers() {
  chrome.storage.sync.get(STORAGE_KEY_CUSTOM_WRAP, (r) => {
    _customWraps = r[STORAGE_KEY_CUSTOM_WRAP] || {};
    // Load current type into textarea
    const type = customTypeSelect ? customTypeSelect.value : 'code';
    customTextarea.value = _customWraps[type] || '';
    renderCustomList();
  });
}

function renderCustomList() {
  const keys = Object.keys(_customWraps).filter((k) => _customWraps[k]);
  if (keys.length === 0) {
    customListEl.innerHTML = '<li class="qb-custom-empty">None yet.</li>';
    return;
  }
  customListEl.innerHTML = keys.map((k) => `
    <li class="qb-custom-item">
      <span class="qb-ci-type">${k}</span>
      <button class="qb-ci-del" data-key="${k}" title="Remove custom wrapper">✕</button>
    </li>
  `).join('');
  customListEl.querySelectorAll('.qb-ci-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      delete _customWraps[btn.dataset.key];
      chrome.storage.sync.set({ [STORAGE_KEY_CUSTOM_WRAP]: _customWraps }, () => {
        if (customTypeSelect.value === btn.dataset.key) customTextarea.value = '';
        renderCustomList();
        showCustomStatus('Wrapper removed.', false);
        loadSyncStorageUsage();
      });
    });
  });
}

function showCustomStatus(msg, isError) {
  customStatusEl.textContent = msg;
  customStatusEl.className = 'qb-custom-status ' + (isError ? 'qb-custom-status-error' : 'qb-custom-status-ok');
  setTimeout(() => { customStatusEl.textContent = ''; customStatusEl.className = 'qb-custom-status'; }, 2500);
}

if (customTypeSelect) {
  customTypeSelect.addEventListener('change', () => {
    const type = customTypeSelect.value;
    customTextarea.value = _customWraps[type] || '';
    customStatusEl.textContent = '';
  });
}

if (customSaveBtn) {
  customSaveBtn.addEventListener('click', () => {
    const type = customTypeSelect.value;
    const val  = customTextarea.value.trim();
    if (val && !val.includes('{{query}}')) {
      showCustomStatus('Error: wrapper must contain {{query}}', true);
      return;
    }
    if (val) {
      _customWraps[type] = val;
    } else {
      delete _customWraps[type];
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
    const type = customTypeSelect.value;
    customTextarea.value = '';
    delete _customWraps[type];
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
    if (!confirm('Clear all feedback and A/B stats?')) return;
    chrome.storage.local.remove([STORAGE_KEY_FEEDBACK, STORAGE_KEY_AB_STATS], () => {
      loadABStats();
      loadFeedbackLog();
      resetFeedbackBtn.textContent = '✓ Cleared';
      setTimeout(() => { resetFeedbackBtn.textContent = '🗑 Clear feedback & A/B data'; }, 2000);
    });
  });
}

// ── Init: Load all state from storage ─────────────────────

function init() {
  chrome.storage.sync.get(
    [STORAGE_KEY_ENABLED, STORAGE_KEY_LAST_TYPE, STORAGE_KEY_PLATFORM,
     STORAGE_KEY_COUNT, STORAGE_KEY_DOMAIN_MODE, STORAGE_KEY_TRANSPARENCY,
     STORAGE_KEY_AB_VARIANT, STORAGE_KEY_LAST_BOOST_TS],
    (result) => {
      const enabled     = result[STORAGE_KEY_ENABLED]     !== false;
      const lastType    = result[STORAGE_KEY_LAST_TYPE]   || null;
      const storedPlat  = result[STORAGE_KEY_PLATFORM]    || null;
      const count       = result[STORAGE_KEY_COUNT]       || 0;
      const mode        = result[STORAGE_KEY_DOMAIN_MODE] || 'general';
      const transp      = result[STORAGE_KEY_TRANSPARENCY] === true;
      const abVariant   = result[STORAGE_KEY_AB_VARIANT]  || null;
      const lastBoostTs = result[STORAGE_KEY_LAST_BOOST_TS] || null;

      renderToggle(enabled);
      renderLastType(lastType);
      renderCount(count);
      renderDomainMode(mode);
      renderTransparency(transp);
      renderABVariant(abVariant);
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

// ── Storage change listener (live updates) ────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes[STORAGE_KEY_LAST_TYPE])    renderLastType(changes[STORAGE_KEY_LAST_TYPE].newValue);
    if (changes[STORAGE_KEY_PLATFORM])     renderPlatform(capitalize(changes[STORAGE_KEY_PLATFORM].newValue));
    if (changes[STORAGE_KEY_COUNT])        renderCount(changes[STORAGE_KEY_COUNT].newValue);
    if (changes[STORAGE_KEY_DOMAIN_MODE])  renderDomainMode(changes[STORAGE_KEY_DOMAIN_MODE].newValue);
    if (changes[STORAGE_KEY_AB_VARIANT])   renderABVariant(changes[STORAGE_KEY_AB_VARIANT].newValue);
    if (changes[STORAGE_KEY_LAST_BOOST_TS]) renderLastBoostTime(changes[STORAGE_KEY_LAST_BOOST_TS].newValue);
  }
});

// ── Boot ──────────────────────────────────────────────────

init();
