/**
 * QueryBoost — Popup Script
 * Handles toggle state, platform detection, and last-query-type display.
 */

'use strict';

const STORAGE_KEY_ENABLED = 'qb_enabled';
const STORAGE_KEY_LAST_TYPE = 'qb_last_type';
const STORAGE_KEY_PLATFORM = 'qb_platform';
const STORAGE_KEY_COUNT = 'qb_boost_count';

// ── Platform display config ───────────────────────────────

const PLATFORM_META = {
  Claude:      { className: 'platform-claude',      emoji: '🟠' },
  ChatGPT:     { className: 'platform-chatgpt',     emoji: '🟢' },
  Gemini:      { className: 'platform-gemini',      emoji: '🔵' },
  Perplexity:  { className: 'platform-perplexity',  emoji: '🟣' },
};

// ── DOM references ────────────────────────────────────────

const toggleInput      = document.getElementById('qb-toggle-input');
const toggleStatus     = document.getElementById('qb-toggle-status');
const platformCard     = document.getElementById('qb-platform-card');
const platformValue    = document.getElementById('qb-platform-value');
const platformNameEl   = document.getElementById('qb-platform-name');
const lastTypeEl       = document.getElementById('qb-last-type');
const boostCountEl     = document.getElementById('qb-boost-count');
const statusGrid       = document.getElementById('qb-status-grid');

// ── Render helpers ────────────────────────────────────────

function renderToggle(enabled) {
  toggleInput.checked = enabled;
  toggleStatus.textContent = enabled ? 'Active — queries are being boosted' : 'Paused — queries sent as-is';
  toggleStatus.style.color = enabled ? '#3ecf8e' : '#f25f5c';
}

function renderPlatform(platformName) {
  // Reset classes
  platformCard.className = 'qb-card';

  const dot = platformValue.querySelector('.dot');

  if (platformName && PLATFORM_META[platformName]) {
    const meta = PLATFORM_META[platformName];
    platformCard.classList.add(meta.className);
    dot.className = 'dot active';
    dot.style.background = '';
    dot.style.boxShadow = '';
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
  // Animate the number if it changed
  const current = parseInt(boostCountEl.textContent.replace(/,/g, ''), 10) || 0;
  if (n !== current) {
    boostCountEl.classList.remove('qb-count-bump');
    // Force reflow to restart the animation
    void boostCountEl.offsetWidth;
    boostCountEl.classList.add('qb-count-bump');
  }
  boostCountEl.textContent = n.toLocaleString();
}

// ── Init: Load state from storage ─────────────────────────

function init() {
  chrome.storage.sync.get(
    [STORAGE_KEY_ENABLED, STORAGE_KEY_LAST_TYPE, STORAGE_KEY_PLATFORM, STORAGE_KEY_COUNT],
    (result) => {
      const enabled = result[STORAGE_KEY_ENABLED] !== false; // default true
      const lastType = result[STORAGE_KEY_LAST_TYPE] || null;
      const storedPlatform = result[STORAGE_KEY_PLATFORM] || null;
      const count = result[STORAGE_KEY_COUNT] || 0;

      renderToggle(enabled);
      renderLastType(lastType);
      renderCount(count);

      // Try to get the platform from the active tab (live detection)
      detectActivePlatform((livePlatform) => {
        const platform = livePlatform || storedPlatform;
        renderPlatform(platform ? capitalize(platform) : null);
      });
    }
  );
}

function capitalize(str) {
  if (!str) return str;
  const map = {
    claude: 'Claude',
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    perplexity: 'Perplexity',
  };
  return map[str.toLowerCase()] || (str.charAt(0).toUpperCase() + str.slice(1));
}

// ── Platform detection via background ─────────────────────

function detectActivePlatform(callback) {
  chrome.runtime.sendMessage({ type: 'QB_GET_ACTIVE_TAB_PLATFORM' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      callback(null);
      return;
    }
    callback(response.platform || null);
  });
}

// ── Toggle handler ────────────────────────────────────────

toggleInput.addEventListener('change', () => {
  const enabled = toggleInput.checked;
  chrome.storage.sync.set({ [STORAGE_KEY_ENABLED]: enabled }, () => {
    renderToggle(enabled);
  });
});

// ── Storage change listener (live updates) ────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;

  if (changes[STORAGE_KEY_LAST_TYPE]) {
    renderLastType(changes[STORAGE_KEY_LAST_TYPE].newValue);
  }
  if (changes[STORAGE_KEY_PLATFORM]) {
    const raw = changes[STORAGE_KEY_PLATFORM].newValue;
    renderPlatform(raw ? capitalize(raw) : null);
  }
  if (changes[STORAGE_KEY_COUNT]) {
    renderCount(changes[STORAGE_KEY_COUNT].newValue);
  }
});

// ── Boot ──────────────────────────────────────────────────

init();
