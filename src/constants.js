/**
 * QueryBoost — Shared Constants
 * Single source of truth for all storage keys and shared config.
 * Loaded by both the content script and the popup via manifest.json.
 */

'use strict';

// ── Storage keys ──────────────────────────────────────────────────────────────
const QB_KEYS = Object.freeze({
  ENABLED:         'qb_enabled',
  LAST_TYPE:       'qb_last_type',
  COUNT:           'qb_boost_count',
  PLATFORM:        'qb_platform',
  DOMAIN_MODE:     'qb_domain_mode',
  TRANSPARENCY:    'qb_transparency',
  AB_VARIANT:      'qb_ab_variant',
  FEEDBACK:        'qb_feedback',
  AB_STATS:        'qb_ab_stats',
  CUSTOM_WRAP:     'qb_custom_wrappers',
  LAST_BOOST_TS:   'qb_last_boost_ts',
  LAST_BOOST_INFO: 'qb_last_boost_info',
  CONFIRM_MODE:    'qb_confirm_mode',   // show before/after modal before submitting
});

// ── Default values for fresh install ─────────────────────────────────────────
const QB_DEFAULTS = Object.freeze({
  [QB_KEYS.ENABLED]:       true,
  [QB_KEYS.LAST_TYPE]:     null,
  [QB_KEYS.COUNT]:         0,
  [QB_KEYS.PLATFORM]:      null,
  [QB_KEYS.DOMAIN_MODE]:   'general',
  [QB_KEYS.TRANSPARENCY]:  false,
  [QB_KEYS.AB_VARIANT]:    null,
  [QB_KEYS.CUSTOM_WRAP]:   {},
  [QB_KEYS.LAST_BOOST_TS]: null,
  [QB_KEYS.CONFIRM_MODE]:  true,   // ON by default — show before/after modal
});
