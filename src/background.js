/**
 * QueryBoost — Background Service Worker v2.2
 * Handles message passing and tab/platform detection for the popup.
 */

'use strict';

// ── Storage defaults (kept in sync with src/constants.js) ────────────────────
const QB_INSTALL_DEFAULTS = {
  qb_enabled:         true,
  qb_last_type:       null,
  qb_boost_count:     0,
  qb_platform:        null,
  qb_domain_mode:     'general',
  qb_transparency:    false,
  qb_ab_variant:      null,
  qb_custom_wrappers: {},
  qb_last_boost_ts:   null,
  qb_confirm_mode:    true,   // show before/after modal by default
  qb_prompt_mode:     'default', // use built-in universal wrapper by default
};

// Listen for messages from popup requesting active tab platform info
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'QB_GET_ACTIVE_TAB_PLATFORM') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) {
        sendResponse({ platform: null, error: 'No active tab' });
        return;
      }

      const tab = tabs[0];
      const url = tab.url || '';

      let platform = null;
      if (url.includes('claude.ai')) platform = 'Claude';
      else if (url.includes('chatgpt.com')) platform = 'ChatGPT';
      else if (url.includes('gemini.google.com')) platform = 'Gemini';
      else if (url.includes('perplexity.ai')) platform = 'Perplexity';

      // Try to ping the content script for confirmation
      if (platform) {
        chrome.tabs.sendMessage(tab.id, { type: 'QB_PING' }, (response) => {
          if (chrome.runtime.lastError) {
            // Content script not yet ready — return URL-based detection
            sendResponse({ platform, tabId: tab.id });
          } else {
            sendResponse({ platform, tabId: tab.id, confirmed: true });
          }
        });
      } else {
        sendResponse({ platform: null });
      }
    });

    return true; // Keep message channel open for async response
  }
});

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Write ALL keys so first-run reads in content.js and popup.js never get undefined
    chrome.storage.sync.set(QB_INSTALL_DEFAULTS);
    // Open onboarding page in a new tab
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});
