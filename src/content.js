/**
 * QueryBoost — Content Script v2.1
 * Intercepts queries on AI platforms and wraps them with smart enhancement prompts.
 *
 * Platform notes:
 *  - ChatGPT:   #prompt-textarea is a contenteditable div (not a <textarea>)
 *  - Claude:    ProseMirror contenteditable div
 *  - Gemini:    Quill .ql-editor inside <rich-textarea> (sometimes shadow DOM)
 *  - Perplexity: migrated from <textarea> to contenteditable div in late 2024
 *
 * Features (v2.1):
 *  - Per-platform wrapper tuning (tone/structure adapted per AI)
 *  - Domain mode / persona (developer, student, researcher, writer, general)
 *  - Smart session cache with LRU cap (skip re-processing identical queries)
 *  - Feedback loop (👍/👎 on toast → stored in chrome.storage.local)
 *  - A/B testing (two wrapper variants randomly assigned, engagement tracked)
 *  - Wrapper transparency toggle (reveal injected wrapper text in toast)
 *  - Gemini shadow DOM re-attachment observer
 *  - Pre-compiled signal rule regexes
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
  const STORAGE_KEY_AB_VARIANT  = QB_KEYS.AB_VARIANT;
  const STORAGE_KEY_FEEDBACK    = QB_KEYS.FEEDBACK;
  const STORAGE_KEY_AB_STATS    = QB_KEYS.AB_STATS;
  const STORAGE_KEY_CUSTOM_WRAP = QB_KEYS.CUSTOM_WRAP;

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
  let abVariant    = null;           // 'A' | 'B'
  let customWraps  = {};             // { [type]: string } user-written templates

  chrome.storage.sync.get(
    [STORAGE_KEY_ENABLED, STORAGE_KEY_DOMAIN_MODE, STORAGE_KEY_TRANSPARENCY, STORAGE_KEY_AB_VARIANT, STORAGE_KEY_CUSTOM_WRAP],
    (r) => {
      isEnabled    = r[STORAGE_KEY_ENABLED]    !== false;
      domainMode   = r[STORAGE_KEY_DOMAIN_MODE]  || 'general';
      transparency = r[STORAGE_KEY_TRANSPARENCY] === true;
      customWraps  = r[STORAGE_KEY_CUSTOM_WRAP]  || {};
      // Assign A/B variant once per install, persist it
      if (r[STORAGE_KEY_AB_VARIANT]) {
        abVariant = r[STORAGE_KEY_AB_VARIANT];
      } else {
        abVariant = Math.random() < 0.5 ? 'A' : 'B';
        chrome.storage.sync.set({ [STORAGE_KEY_AB_VARIANT]: abVariant });
      }
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (STORAGE_KEY_ENABLED     in changes) isEnabled    = changes[STORAGE_KEY_ENABLED].newValue    !== false;
    if (STORAGE_KEY_DOMAIN_MODE in changes) domainMode   = changes[STORAGE_KEY_DOMAIN_MODE].newValue || 'general';
    if (STORAGE_KEY_TRANSPARENCY in changes) transparency = changes[STORAGE_KEY_TRANSPARENCY].newValue === true;
    if (STORAGE_KEY_CUSTOM_WRAP in changes) customWraps  = changes[STORAGE_KEY_CUSTOM_WRAP].newValue  || {};
  });

  // ─── Query Type Detection — Weighted Multi-Signal Scoring ────────────────

  const SIGNAL_RULES = {

    // ── DATA / SQL ───────────────────────────────────────────────────────────
    data: [
      { type: 'regex',  w: 4, r: /\bselect\b.{0,60}\bfrom\b/i },
      { type: 'regex',  w: 4, r: /\binsert\s+into\b/i },
      { type: 'regex',  w: 4, r: /\bupdate\b.{0,40}\bset\b/i },
      { type: 'regex',  w: 4, r: /\bdelete\s+from\b/i },
      { type: 'regex',  w: 4, r: /\bcreate\s+table\b/i },
      { type: 'regex',  w: 3, r: /\b(group\s+by|order\s+by|having\s+\w|where\s+\w)/i },
      { type: 'regex',  w: 3, r: /\b(inner\s+join|left\s+join|right\s+join|full\s+outer\s+join|cross\s+join)\b/i },
      { type: 'regex',  w: 3, r: /\b(window\s+function|over\s*\(|partition\s+by|row_number|rank\s*\(|dense_rank)\b/i },
      { type: 'regex',  w: 3, r: /\b(cte|with\s+\w+\s+as\s*\(|recursive\s+cte)\b/i },
      { type: 'phrase', w: 3, p: 'sql query' },
      { type: 'phrase', w: 3, p: 'sql statement' },
      { type: 'phrase', w: 3, p: 'stored procedure' },
      { type: 'phrase', w: 3, p: 'database schema' },
      { type: 'phrase', w: 3, p: 'data pipeline' },
      { type: 'phrase', w: 3, p: 'etl pipeline' },
      { type: 'phrase', w: 3, p: 'data warehouse' },
      { type: 'phrase', w: 2, p: 'pandas dataframe' },
      { type: 'phrase', w: 2, p: 'spark dataframe' },
      { type: 'phrase', w: 2, p: 'data analysis' },
      { type: 'phrase', w: 2, p: 'machine learning model' },
      { type: 'phrase', w: 2, p: 'train a model' },
      { type: 'phrase', w: 2, p: 'feature engineering' },
      { type: 'phrase', w: 2, p: 'data cleaning' },
      { type: 'phrase', w: 2, p: 'pivot table' },
      { type: 'regex',  w: 2, r: /\b(bar\s+chart|line\s+chart|pie\s+chart|scatter\s+plot|heat\s+?map|histogram|time\s+series)\b/i },
      { type: 'regex',  w: 2, r: /\bvisuali[sz](e|ation)\b/i },
      { type: 'regex',  w: 2, r: /\.(csv|parquet|xlsx?|json\s+data)\b/i },
      { type: 'token',  w: 2, p: 'pandas' },
      { type: 'token',  w: 2, p: 'numpy' },
      { type: 'token',  w: 2, p: 'matplotlib' },
      { type: 'token',  w: 1, p: 'dataset' },
      { type: 'token',  w: 1, p: 'aggregate' },
      { type: 'token',  w: 1, p: 'postgresql' },
      { type: 'token',  w: 1, p: 'mongodb' },
      { type: 'token',  w: 1, p: 'bigquery' },
      { type: 'token',  w: 1, p: 'elasticsearch' },
    ],

    // ── CODE / DEBUG ─────────────────────────────────────────────────────────
    code: [
      { type: 'prefix', w: 4, p: 'fix ' },
      { type: 'prefix', w: 4, p: 'debug ' },
      { type: 'prefix', w: 3, p: 'refactor ' },
      { type: 'phrase', w: 4, p: 'fix this code' },
      { type: 'phrase', w: 4, p: 'fix my code' },
      { type: 'phrase', w: 4, p: 'fix the bug' },
      { type: 'phrase', w: 4, p: 'debug this' },
      { type: 'phrase', w: 3, p: "there's an error" },
      { type: 'phrase', w: 3, p: 'getting an error' },
      { type: 'phrase', w: 3, p: 'not working' },
      { type: 'phrase', w: 3, p: 'broken code' },
      { type: 'phrase', w: 3, p: "doesn't work" },
      { type: 'phrase', w: 3, p: 'why is my code' },
      { type: 'regex',  w: 4, r: /\b(typeerror|valueerror|attributeerror|nameerror|indexerror|syntaxerror|referenceerror|nullpointerexception|segmentation\s+fault)\b/i },
      { type: 'regex',  w: 3, r: /\b(traceback|stack\s*trace|uncaught\s+exception|unhandled\s+rejection)\b/i },
      { type: 'regex',  w: 3, r: /\berror\s*:/i },
      { type: 'regex',  w: 3, r: /\bundefined\s+is\s+not\b/i },
      { type: 'regex',  w: 3, r: /\bcannot\s+read\s+propert/i },
      { type: 'phrase', w: 3, p: 'write a function' },
      { type: 'phrase', w: 3, p: 'write a class' },
      { type: 'phrase', w: 3, p: 'write a script' },
      { type: 'phrase', w: 3, p: 'write a program' },
      { type: 'phrase', w: 3, p: 'write a component' },
      { type: 'phrase', w: 3, p: 'write a method' },
      { type: 'phrase', w: 3, p: 'implement a' },
      { type: 'phrase', w: 3, p: 'implement this' },
      { type: 'phrase', w: 3, p: 'build an api' },
      { type: 'phrase', w: 3, p: 'build a backend' },
      { type: 'phrase', w: 3, p: 'create a function' },
      { type: 'phrase', w: 3, p: 'add an endpoint' },
      { type: 'phrase', w: 3, p: 'add a route' },
      { type: 'phrase', w: 3, p: 'add a feature' },
      { type: 'phrase', w: 2, p: 'refactor this' },
      { type: 'phrase', w: 2, p: 'optimize this code' },
      { type: 'phrase', w: 2, p: 'optimize my code' },
      { type: 'phrase', w: 2, p: 'code review' },
      { type: 'phrase', w: 2, p: 'unit test' },
      { type: 'phrase', w: 2, p: 'write tests' },
      { type: 'phrase', w: 2, p: 'how do i code' },
      { type: 'phrase', w: 2, p: 'how do i implement' },
      { type: 'phrase', w: 2, p: 'how do i build' },
      { type: 'regex',  w: 2, r: /\b(react|vue|angular|next\.js|nuxt|svelte|fastapi|django|flask|express|spring\s+boot|rails|laravel)\b/i },
      { type: 'regex',  w: 2, r: /\b(typescript|javascript|python|rust|golang|kotlin|swift|java|c\+\+|c#|php|ruby|bash|powershell)\b/i },
      { type: 'regex',  w: 2, r: /\b(function|class|method|component|module|interface|enum|struct|decorator|middleware|webhook|cron\s+job)\b/i },
      { type: 'token',  w: 1, p: 'async' },
      { type: 'token',  w: 1, p: 'await' },
      { type: 'token',  w: 1, p: 'algorithm' },
      { type: 'token',  w: 1, p: 'api' },
      { type: 'token',  w: 1, p: 'regex' },
      { type: 'token',  w: 1, p: 'recursion' },
      { type: 'negex',  w: 2, r: /\bwrite\s+(an?\s+)?(email|essay|letter|report|article|blog|post|message|memo|cover\s+letter)\b/i },
    ],

    // ── EXPLAIN / LEARN ──────────────────────────────────────────────────────
    explain: [
      { type: 'prefix', w: 4, p: 'what is ' },
      { type: 'prefix', w: 4, p: 'what are ' },
      { type: 'prefix', w: 4, p: 'explain ' },
      { type: 'prefix', w: 4, p: 'how does ' },
      { type: 'prefix', w: 4, p: 'why is ' },
      { type: 'prefix', w: 4, p: 'why does ' },
      { type: 'prefix', w: 4, p: 'why do ' },
      { type: 'prefix', w: 3, p: 'define ' },
      { type: 'prefix', w: 3, p: 'when should i use ' },
      { type: 'phrase', w: 4, p: 'what is the difference' },
      { type: 'phrase', w: 4, p: 'difference between' },
      { type: 'phrase', w: 3, p: 'how does it work' },
      { type: 'phrase', w: 3, p: 'explain me' },
      { type: 'phrase', w: 3, p: 'explain to me' },
      { type: 'phrase', w: 3, p: 'explain like' },
      { type: 'phrase', w: 3, p: 'eli5' },
      { type: 'phrase', w: 3, p: 'in simple terms' },
      { type: 'phrase', w: 3, p: 'in layman' },
      { type: 'phrase', w: 3, p: "i don't understand" },
      { type: 'phrase', w: 3, p: 'help me understand' },
      { type: 'phrase', w: 3, p: 'meaning of' },
      { type: 'phrase', w: 3, p: 'what does it mean' },
      { type: 'phrase', w: 3, p: 'when to use' },
      { type: 'phrase', w: 2, p: 'how is this different' },
      { type: 'regex',  w: 3, r: /\bwhat.?s\s+the\s+(difference|purpose|point|benefit|advantage|use\s+case)\b/i },
      { type: 'regex',  w: 3, r: /\bhow\s+do\s+(?!i\b).{0,40}work/i },
      { type: 'regex',  w: 2, r: /\b(concept|theory|principle|paradigm|pattern|architecture)\b/i },
    ],

    // ── ANALYZE / REVIEW ─────────────────────────────────────────────────────
    analyze: [
      { type: 'prefix', w: 4, p: 'analyze ' },
      { type: 'prefix', w: 4, p: 'analyse ' },
      { type: 'prefix', w: 4, p: 'review ' },
      { type: 'prefix', w: 4, p: 'compare ' },
      { type: 'prefix', w: 4, p: 'evaluate ' },
      { type: 'prefix', w: 4, p: 'assess ' },
      { type: 'phrase', w: 4, p: 'pros and cons' },
      { type: 'phrase', w: 4, p: 'pros & cons' },
      { type: 'phrase', w: 4, p: 'compare and contrast' },
      { type: 'phrase', w: 4, p: 'strengths and weaknesses' },
      { type: 'phrase', w: 3, p: 'is it worth' },
      { type: 'phrase', w: 3, p: 'should i use' },
      { type: 'phrase', w: 3, p: 'which is better' },
      { type: 'phrase', w: 3, p: 'which should i choose' },
      { type: 'phrase', w: 3, p: 'which is best' },
      { type: 'phrase', w: 3, p: 'review my' },
      { type: 'phrase', w: 3, p: 'review this' },
      { type: 'phrase', w: 3, p: 'trade-offs' },
      { type: 'phrase', w: 3, p: 'tradeoffs' },
      { type: 'phrase', w: 2, p: 'give me feedback' },
      { type: 'phrase', w: 2, p: 'what do you think' },
      { type: 'phrase', w: 2, p: 'is this a good' },
      { type: 'regex',  w: 3, r: /\b(benchmark|performance\s+comparison|cost.benefit|swot|risk\s+assessment)\b/i },
      { type: 'regex',  w: 2, r: /\b(better|worse|faster|slower|cheaper|scalable)\s+than\b/i },
      { type: 'token',  w: 2, p: 'critique' },
      { type: 'token',  w: 2, p: 'audit' },
      { type: 'token',  w: 1, p: 'rank' },
      { type: 'token',  w: 1, p: 'verdict' },
    ],

    // ── HOW-TO / STEPS ───────────────────────────────────────────────────────
    howto: [
      { type: 'prefix', w: 5, p: 'how to ' },
      { type: 'prefix', w: 5, p: 'how do i ' },
      { type: 'prefix', w: 4, p: 'steps to ' },
      { type: 'prefix', w: 4, p: 'guide to ' },
      { type: 'prefix', w: 4, p: 'tutorial on ' },
      { type: 'prefix', w: 4, p: 'walk me through ' },
      { type: 'phrase', w: 4, p: 'step by step' },
      { type: 'phrase', w: 4, p: 'step-by-step' },
      { type: 'phrase', w: 4, p: 'walk me through' },
      { type: 'phrase', w: 4, p: 'beginner guide' },
      { type: 'phrase', w: 3, p: 'how do i set up' },
      { type: 'phrase', w: 3, p: 'how do i install' },
      { type: 'phrase', w: 3, p: 'how do i configure' },
      { type: 'phrase', w: 3, p: 'how do i create' },
      { type: 'phrase', w: 3, p: 'how do i use' },
      { type: 'phrase', w: 3, p: 'getting started' },
      { type: 'phrase', w: 3, p: 'quick start' },
      { type: 'phrase', w: 2, p: 'set up' },
      { type: 'regex',  w: 3, r: /\bhow\s+(can|do)\s+i\s+\w+/i },
      { type: 'regex',  w: 3, r: /\b(install|configure|deploy|set\s?up|integrate)\s+(and|or|\w+)/i },
      { type: 'regex',  w: 2, r: /\b(process|procedure|workflow|checklist)\b/i },
      { type: 'negex',  w: 3, r: /\bhow\s+does\b/i },
    ],

    // ── LOCAL / TRAVEL ────────────────────────────────────────────────────────
    local: [
      { type: 'regex',  w: 5, r: /\b(restaurant|cafe|coffee\s+shop|bar|pub|club|hotel|hostel|airbnb|motel)\b/i },
      { type: 'regex',  w: 5, r: /\b(places?\s+to\s+(eat|drink|stay|visit|go)|things\s+to\s+do|what\s+to\s+do\s+in)\b/i },
      { type: 'regex',  w: 4, r: /\bnear\s+(me|here|downtown|the\s+\w+)\b/i },
      { type: 'regex',  w: 4, r: /\bin\s+[A-Z][a-z]{2,}(,\s*[A-Z][a-z]{2,})?\b/ },
      { type: 'regex',  w: 4, r: /\b(best|top|good|cheap|affordable|hidden\s+gem)\s+(restaurants?|cafes?|bars?|hotels?|spots?|places?)\b/i },
      { type: 'regex',  w: 5, r: /\blist\s+of\s+(restaurants?|cafes?|coffee\s+shops?|bars?|hotels?|places?\s+to\s+(eat|drink|stay))\b/i },
      { type: 'phrase', w: 4, p: 'where to eat' },
      { type: 'phrase', w: 4, p: 'where to stay' },
      { type: 'phrase', w: 4, p: 'where to go' },
      { type: 'phrase', w: 4, p: 'things to do' },
      { type: 'phrase', w: 3, p: 'local spots' },
      { type: 'phrase', w: 3, p: 'hidden gems' },
      { type: 'phrase', w: 3, p: 'tourist attractions' },
      { type: 'phrase', w: 3, p: 'travel guide' },
      { type: 'regex',  w: 3, r: /\b(tourist|locals|traveler|visitor|neighborhood|neighbourhood|district|area)\b/i },
      { type: 'regex',  w: 2, r: /\b(price\s+range|budget|expensive|affordable|mid.?range)\b/i },
    ],

    // ── RECOMMEND / LIST ──────────────────────────────────────────────────────
    recommend: [
      { type: 'prefix', w: 5, p: 'recommend ' },
      { type: 'prefix', w: 5, p: 'suggest ' },
      { type: 'prefix', w: 4, p: 'list of ' },
      { type: 'prefix', w: 4, p: 'what are some ' },
      { type: 'prefix', w: 4, p: 'what are the best ' },
      { type: 'phrase', w: 4, p: 'give me a list' },
      { type: 'phrase', w: 4, p: 'list of ' },
      { type: 'phrase', w: 4, p: 'can you recommend' },
      { type: 'phrase', w: 4, p: 'what should i read' },
      { type: 'phrase', w: 4, p: 'what should i watch' },
      { type: 'phrase', w: 4, p: 'what should i use' },
      { type: 'phrase', w: 4, p: 'what should i buy' },
      { type: 'phrase', w: 3, p: 'best tools' },
      { type: 'phrase', w: 3, p: 'best resources' },
      { type: 'phrase', w: 3, p: 'best books' },
      { type: 'phrase', w: 3, p: 'best apps' },
      { type: 'phrase', w: 3, p: 'alternatives to' },
      { type: 'phrase', w: 3, p: 'similar to' },
      { type: 'regex',  w: 4, r: /\btop\s+\d+\b/i },
      { type: 'regex',  w: 3, r: /\b(book|movie|series|show|podcast|tool|library|framework|plugin)\s+recommendations?\b/i },
      { type: 'regex',  w: 2, r: /\b(what\s+(are|were)\s+(some|the|good|great))\b/i },
      { type: 'negex',  w: 6, r: /\b(restaurants?|cafes?|coffee\s+shops?|bars?|pubs?|hotels?|hostels?|places?\s+to\s+(eat|drink|stay))\b/i },
    ],

    // ── OPINION / DECISION ────────────────────────────────────────────────────
    opinion: [
      { type: 'prefix', w: 5, p: 'should i ' },
      { type: 'prefix', w: 4, p: 'is it worth ' },
      { type: 'prefix', w: 4, p: 'is it good ' },
      { type: 'prefix', w: 4, p: 'do you think ' },
      { type: 'phrase', w: 5, p: 'should i buy' },
      { type: 'phrase', w: 5, p: 'should i use' },
      { type: 'phrase', w: 5, p: 'should i learn' },
      { type: 'phrase', w: 5, p: 'should i switch' },
      { type: 'phrase', w: 4, p: 'is it worth it' },
      { type: 'phrase', w: 4, p: 'worth buying' },
      { type: 'phrase', w: 4, p: 'worth learning' },
      { type: 'phrase', w: 4, p: 'what do you think' },
      { type: 'phrase', w: 4, p: 'your opinion' },
      { type: 'phrase', w: 4, p: 'your thoughts' },
      { type: 'phrase', w: 3, p: 'is it a good idea' },
      { type: 'phrase', w: 3, p: 'good or bad' },
      { type: 'phrase', w: 3, p: 'help me decide' },
      { type: 'phrase', w: 3, p: 'what would you' },
      { type: 'regex',  w: 3, r: /\bshould\s+i\s+(go|get|try|pick|start|stop|keep|quit|move|join|leave)\b/i },
      { type: 'regex',  w: 3, r: /\bis\s+(it|this|that|.+)\s+(good|bad|safe|reliable|legit|worth|overrated|underrated)\b/i },
      { type: 'regex',  w: 4, r: /\bis\s+\S+\s+better\s+than\b/i },
      { type: 'regex',  w: 4, r: /\bwhich\s+is\s+(better|worse|best)\b/i },
    ],

    // ── CREATIVE ─────────────────────────────────────────────────────────────
    creative: [
      { type: 'prefix', w: 5, p: 'write a story' },
      { type: 'prefix', w: 5, p: 'write a poem' },
      { type: 'prefix', w: 5, p: 'write a joke' },
      { type: 'phrase', w: 5, p: 'short story' },
      { type: 'phrase', w: 5, p: 'write a poem' },
      { type: 'phrase', w: 4, p: 'creative writing' },
      { type: 'phrase', w: 4, p: 'write a scene' },
      { type: 'phrase', w: 4, p: 'write a script' },
      { type: 'phrase', w: 4, p: 'fictional story' },
      { type: 'phrase', w: 4, p: 'brainstorm ideas' },
      { type: 'phrase', w: 4, p: 'come up with ideas' },
      { type: 'phrase', w: 4, p: 'name ideas' },
      { type: 'phrase', w: 4, p: 'brand name' },
      { type: 'phrase', w: 3, p: 'startup name' },
      { type: 'phrase', w: 3, p: 'product name' },
      { type: 'phrase', w: 3, p: 'slogan for' },
      { type: 'phrase', w: 3, p: 'tagline for' },
      { type: 'regex',  w: 4, r: /\bwrite\s+(a|an|the)?\s*(haiku|sonnet|limerick|rap|lyrics?|monologue|dialogue|plot)\b/i },
      { type: 'regex',  w: 3, r: /\b(imagine|invent|create|generate)\s+(a|an|the)?\s*(character|world|scenario|concept|idea|story)\b/i },
      { type: 'regex',  w: 3, r: /\b(fun|funny|humorous|witty|satirical|whimsical|dark\s+humor)\b/i },
      { type: 'token',  w: 2, p: 'brainstorm' },
      { type: 'token',  w: 1, p: 'fictional' },
      { type: 'negex',  w: 3, r: /\b(email|cover\s+letter|report|essay|article|blog|proposal)\b/i },
    ],

    // ── WRITE / DRAFT ────────────────────────────────────────────────────────
    write: [
      { type: 'prefix', w: 4, p: 'write an email' },
      { type: 'prefix', w: 4, p: 'write a email' },
      { type: 'prefix', w: 4, p: 'draft an email' },
      { type: 'prefix', w: 4, p: 'draft a ' },
      { type: 'prefix', w: 4, p: 'compose a ' },
      { type: 'prefix', w: 4, p: 'compose an ' },
      { type: 'phrase', w: 4, p: 'write an email' },
      { type: 'phrase', w: 4, p: 'write a cover letter' },
      { type: 'phrase', w: 4, p: 'write a blog post' },
      { type: 'phrase', w: 4, p: 'write an essay' },
      { type: 'phrase', w: 4, p: 'write a report' },
      { type: 'phrase', w: 4, p: 'write an article' },
      { type: 'phrase', w: 4, p: 'write a proposal' },
      { type: 'phrase', w: 4, p: 'write a summary' },
      { type: 'phrase', w: 4, p: 'write a bio' },
      { type: 'phrase', w: 4, p: 'write a press release' },
      { type: 'phrase', w: 4, p: 'write a linkedin' },
      { type: 'phrase', w: 3, p: 'help me write' },
      { type: 'phrase', w: 3, p: 'rewrite this' },
      { type: 'phrase', w: 3, p: 'rephrase this' },
      { type: 'phrase', w: 3, p: 'improve my writing' },
      { type: 'phrase', w: 3, p: 'edit this text' },
      { type: 'phrase', w: 3, p: 'edit my draft' },
      { type: 'phrase', w: 3, p: 'make this sound' },
      { type: 'phrase', w: 3, p: 'make it more' },
      { type: 'phrase', w: 3, p: 'more professional' },
      { type: 'phrase', w: 3, p: 'more formal' },
      { type: 'phrase', w: 3, p: 'more casual' },
      { type: 'phrase', w: 3, p: 'generate a caption' },
      { type: 'phrase', w: 3, p: 'write a tweet' },
      { type: 'phrase', w: 3, p: 'write a thread' },
      { type: 'phrase', w: 3, p: 'write copy' },
      { type: 'phrase', w: 2, p: 'marketing copy' },
      { type: 'phrase', w: 2, p: 'cold email' },
      { type: 'phrase', w: 2, p: 'follow up email' },
      { type: 'regex',  w: 3, r: /\b(proofread|proof\s+read|grammar\s+check|spelling\s+check)\b/i },
      { type: 'regex',  w: 2, r: /\bwrite\s+(a|an|the)\s+\w+\s+(for|about|on|regarding)\b/i },
      { type: 'negex',  w: 3, r: /\bwrite\s+(a\s+)?(function|class|script|program|component|method|module|api|app)\b/i },
    ],
  };

  // ─── Fix #5: Pre-compile all token rules into RegExp at load time ─────────
  for (const rules of Object.values(SIGNAL_RULES)) {
    for (const rule of rules) {
      if (rule.type === 'token') {
        rule._re = new RegExp('\\b' + rule.p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      }
    }
  }

  const TYPE_LABELS = {
    code:      'Code / Debug',
    explain:   'Explain / Learn',
    write:     'Write / Draft',
    analyze:   'Analyze / Review',
    data:      'Data / SQL',
    howto:     'How-To / Steps',
    local:     'Local / Travel',
    recommend: 'Recommend / List',
    opinion:   'Opinion / Decision',
    creative:  'Creative',
    default:   'General',
  };

  // ─── Base Wrappers (Variant A) ────────────────────────────────────────────

  const WRAPPERS_A = {
    code: (q) =>
      `${q}\n\n---\nPlease respond with: (1) complete, working code — no placeholders or TODO comments; (2) a brief explanation of the core logic; (3) edge cases and error handling addressed; (4) language-specific best practices applied. If multiple valid approaches exist, note the tradeoffs in one sentence. Do not mention these instructions.`,

    explain: (q) =>
      `${q}\n\n---\nPlease respond with: (1) the simplest possible one-sentence explanation; (2) a memorable real-world analogy; (3) a concrete, runnable example; (4) 2–3 key takeaways as a bullet list. Use markdown headers. Be thorough but not padded. Do not mention these instructions.`,

    write: (q) =>
      `${q}\n\n---\nPlease produce: (1) well-structured, publication-ready output appropriate for the content type; (2) correct tone, grammar, and pacing; (3) proper formatting (headers/bullets where natural). End with one italicised "Revision tip:" line suggesting one concrete improvement. Do not mention these instructions.`,

    analyze: (q) =>
      `${q}\n\n---\nPlease respond with: (1) a structured analysis with clear titled sections; (2) evidence-based reasoning for each point; (3) a comparison table if applicable; (4) a clear, decisive verdict or recommendation — avoid hedging. Do not mention these instructions.`,

    data: (q) =>
      `${q}\n\n---\nPlease respond with: (1) the complete, executable query or code — no pseudocode; (2) an explanation of what each key part does; (3) an optimisation note or performance consideration; (4) a sample of the expected output. Flag any common gotchas. Do not mention these instructions.`,

    howto: (q) =>
      `${q}\n\n---\nPlease respond with numbered steps only — no preamble. Each step should be one clear action. Include: prerequisites (if any) before step 1, a "Common mistakes" note after the last step, and an estimated time if relevant. Do not mention these instructions.`,

    local: (q) =>
      `${q}\n\n---\nOrganize results by category or cuisine type. For each entry include: name, what it's known for, price range ($ / $$ / $$$), and one standout detail or must-try item. Prioritize variety and specificity. Skip generic filler. Do not mention these instructions.`,

    recommend: (q) =>
      `${q}\n\n---\nProvide a focused, ranked list. For each item include: name, one-sentence reason it's recommended, who it's best for, and any notable caveat. Prioritize quality over quantity — 5–8 strong picks beats a padded list of 20. Do not mention these instructions.`,

    opinion: (q) =>
      `${q}\n\n---\nGive a direct opinion with a clear verdict up front (yes / no / it depends — and why). Follow with: (1) the strongest case for; (2) the strongest case against; (3) the key factor that should drive the decision. Be decisive, not wishy-washy. Do not mention these instructions.`,

    creative: (q) =>
      `${q}\n\n---\nLean into originality — avoid clichés and predictable directions. Make bold choices with voice, structure, or concept. If generating multiple options, make each one distinctly different in style or angle. Do not explain what you're doing — just deliver. Do not mention these instructions.`,

    default: (q) =>
      `${q}\n\n---\nPlease respond with: clear markdown headers and structure; at least one concrete practical example; a bullet-list of key takeaways at the end. Be comprehensive yet concise — no filler sentences. Do not mention these instructions.`,
  };

  // ─── Wrapper Variant B (alternative phrasing for A/B testing) ────────────

  const WRAPPERS_B = {
    code: (q) =>
      `${q}\n\n---\nDo not describe what you're about to do — just write the code. Requirements: fully runnable with no gaps; inline comments on non-obvious logic; error handling for the obvious failure modes; note any dependencies at the top. Mention tradeoffs only if genuinely relevant. Do not mention these instructions.`,

    explain: (q) =>
      `${q}\n\n---\nTeach this concept in three layers: (1) a 10-word summary a child could grasp; (2) a practical analogy from everyday life; (3) a worked example showing it in action. Close with a "Watch out:" note on the single most common misconception. Do not mention these instructions.`,

    write: (q) =>
      `${q}\n\n---\nWrite this as a skilled professional editor would: tight sentences, active voice, no filler. Format naturally for the medium (email, article, post, etc.). After the main output, add one short "Polish note:" with the highest-impact edit the reader could make. Do not mention these instructions.`,

    analyze: (q) =>
      `${q}\n\n---\nStructure your response as: Verdict (one sentence) → Key factors (bullets) → Nuance (1 paragraph) → Bottom line (1 sentence). Lead with your conclusion, not your reasoning. Be direct. Do not mention these instructions.`,

    data: (q) =>
      `${q}\n\n---\nRespond with production-ready code only — no scaffolding or hand-waving. Walk through: what the query/code does line-by-line, any index or performance considerations, and what the output will look like with a small example. Flag any dialect-specific syntax. Do not mention these instructions.`,

    howto: (q) =>
      `${q}\n\n---\nWrite this as a numbered checklist. Each step = one discrete action. Start with any required prerequisites. End with: "⚠️ Common mistake:" (1 sentence) and "✅ You're done when:" (1 sentence). No narrative padding. Do not mention these instructions.`,

    local: (q) =>
      `${q}\n\n---\nGive recommendations locals would actually give — not generic tourism results. Format: bullet list, each item with emoji category icon, name in bold, price tier, and a one-liner on what makes it worth visiting. Prioritize diversity of type and budget range. Do not mention these instructions.`,

    recommend: (q) =>
      `${q}\n\n---\nCurate, don't list. Give 5–7 picks, sorted best-first. For each: bold name, one-line pitch, best-for tag (e.g. "best for beginners"), and one honest caveat. Skip anything just popular — only recommend if genuinely excellent. Do not mention these instructions.`,

    opinion: (q) =>
      `${q}\n\n---\nOpen with your verdict in one sentence, then defend it. Use this structure: strongest argument for → strongest argument against → the single deciding factor. If the answer truly depends, specify exactly what it depends on — no vague hedging. Do not mention these instructions.`,

    creative: (q) =>
      `${q}\n\n---\nIgnore the obvious interpretation and take an unexpected angle. Prioritize voice, specificity, and surprise over completeness. If asked for multiple options, each must be stylistically distinct — not variations of the same idea. Do not preface or explain your choices. Do not mention these instructions.`,

    default: (q) =>
      `${q}\n\n---\nAnswer directly and confidently. Structure with headers. Ground every claim in a specific example. End with a "Key points" bullet list (3–5 items). Cut anything that doesn't add information. Do not mention these instructions.`,
  };

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

  const FOLLOW_UP_RE = /^(can you|could you|please|elaborate|more detail|tell me more|explain that|what do you mean|go on|continue|and\b|but why|ok so|so then|what about|how about|what if|why not|why did|why does that|and then|that makes sense|got it|ok|okay|thanks|thank you|great|cool|interesting|sure|yes|no|yep|nope|hmm|huh|wait|really|seriously|wow)\b/i;

  function isFollowUp(q) {
    const t = q.trim();
    if (t.length < 20 && FOLLOW_UP_RE.test(t)) return true;
    if (t.length < 60 && /^(and |but |so |ok |also |then |wait |right |plus )/i.test(t)) return true;
    return false;
  }

  // ─── Query Length Awareness ───────────────────────────────────────────────

  const LENGTH_SHORT  = 40;
  const LENGTH_LONG   = 280;

  function getLengthMode(q) {
    const len = q.trim().length;
    if (len < LENGTH_SHORT) return 'brief';
    if (len > LENGTH_LONG)  return 'detailed';
    return 'normal';
  }

  const LENGTH_SUFFIX = {
    brief:    ' Be thorough — the query is short so add relevant context, examples, and depth the user may not have known to ask for.',
    detailed: ' The query is already detailed — stay precisely focused on what was asked. Do not pad or over-structure.',
    normal:   '',
  };

  // ─── Confidence Threshold ─────────────────────────────────────────────────

  const MIN_SCORE  = 3;
  const MIN_LENGTH = 15;

  function detectQueryTypeWithScore(rawText) {
    const text    = rawText.toLowerCase().trim();
    const trimmed = text.replace(/\s+/g, ' ');

    const scores = { data: 0, code: 0, explain: 0, analyze: 0, write: 0, howto: 0, local: 0, recommend: 0, opinion: 0, creative: 0 };

    // #2: Collect top matched signals (phrases/tokens with weight ≥ 3)
    const matchedSignals = [];

    for (const [category, rules] of Object.entries(SIGNAL_RULES)) {
      for (const rule of rules) {
        let matched = false;
        switch (rule.type) {
          case 'phrase':  matched = trimmed.includes(rule.p); break;
          case 'prefix':  matched = trimmed.startsWith(rule.p); break;
          case 'token':   matched = rule._re.test(trimmed); break;
          case 'regex':   matched = rule.r.test(trimmed); break;
          case 'negex':   if (rule.r.test(trimmed)) scores[category] -= rule.w; continue;
        }
        if (matched) {
          scores[category] += rule.w;
          if (rule.w >= 3 && matchedSignals.length < 3) {
            const label = rule.p
              ? '"' + rule.p.slice(0, 22) + '"'
              : rule.r ? rule.r.source.replace(/\\b|\\s\+|\.\{.*?\}|\(\?:.*?\)|[()[\]]/g, '').replace(/\|/g, '/').slice(0, 22) : null;
            if (label && !matchedSignals.includes(label)) matchedSignals.push(label);
          }
        }
      }
    }

    let best = 'default', bestScore = 0;
    for (const [cat, score] of Object.entries(scores)) {
      if (score > bestScore) { bestScore = score; best = cat; }
    }
    return { type: best, score: bestScore, signals: matchedSignals };
  }

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
    return fnv32a(rawText + '|' + domainMode + '|' + (abVariant || 'A') + '|' + PLATFORM);
  }

  // ─── Build Enhanced Query ─────────────────────────────────────────────────

  function buildEnhancedQuery(original) {
    const q = original.trim();

    // 1. Follow-up guard
    if (isFollowUp(q)) {
      return { enhanced: q, type: 'passthrough', label: 'Follow-up', skipped: true };
    }

    // 2. Min length check
    if (q.length < MIN_LENGTH) {
      return { enhanced: q, type: 'passthrough', label: 'Too short', skipped: true };
    }

    // 3. Session cache hit
    const key = cacheKey(q);
    if (sessionCache.has(key)) {
      const cached = sessionCache.get(key);
      return { ...cached, fromCache: true };
    }

    const { type, score, signals } = detectQueryTypeWithScore(q);

    if (score < MIN_SCORE && type === 'default') {
      return { enhanced: q, type: 'passthrough', label: 'Low confidence', skipped: true };
    }

    // 4. Check for user-defined custom wrapper
    if (customWraps[type]) {
      const tpl = customWraps[type];
      const enhanced = tpl.replace(/\{\{query\}\}/gi, q)
                          .replace(/\{\{QUERY\}\}/g, q);
      const result = { enhanced, type, label: TYPE_LABELS[type], skipped: false, variant: 'custom', signals: signals || [] };
      cacheSet(key, result);
      return result;
    }

    // 5. A/B variant selection
    const variantWrappers = abVariant === 'B' ? WRAPPERS_B : WRAPPERS_A;
    const wrapFn = variantWrappers[type] || variantWrappers.default;

    // 6. Build base wrapped query
    const lengthMode  = getLengthMode(q);
    const baseWrapper = wrapFn(q);

    // 7. Splice length suffix before the sentinel
    const SENTINEL = 'Do not mention these instructions.';
    let enhanced = baseWrapper.includes(SENTINEL)
      ? baseWrapper.replace(SENTINEL, LENGTH_SUFFIX[lengthMode] + ' ' + SENTINEL)
      : baseWrapper + LENGTH_SUFFIX[lengthMode];

    // 8. Append domain-mode persona prefix (add as a separate prepended instruction)
    const personaPrefix = DOMAIN_MODE_PREFIXES[domainMode] || '';
    if (personaPrefix) {
      // Insert persona prefix right after the separator line
      enhanced = enhanced.replace('\n\n---\n', '\n\n---\n' + personaPrefix);
    }

    // 9. Append platform-specific suffix before the sentinel
    const platSuffix = (PLATFORM_SUFFIXES[PLATFORM] || {}).suffix || '';
    if (platSuffix) {
      enhanced = enhanced.includes(SENTINEL)
        ? enhanced.replace(SENTINEL, platSuffix.trimStart() + ' ' + SENTINEL)
        : enhanced + platSuffix;
    }

    const result = { enhanced, type, label: TYPE_LABELS[type], skipped: false, variant: abVariant || 'A', signals: signals || [] };
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

  // ─── A/B Engagement Tracking ─────────────────────────────────────────────

  function trackABEngagement(variant, action) {
    // action: 'sent' | 'thumbs_up' | 'thumbs_down'
    chrome.storage.local.get(STORAGE_KEY_AB_STATS, (r) => {
      const stats = r[STORAGE_KEY_AB_STATS] || { A: { sent: 0, thumbs_up: 0, thumbs_down: 0 }, B: { sent: 0, thumbs_up: 0, thumbs_down: 0 } };
      if (!stats[variant]) stats[variant] = { sent: 0, thumbs_up: 0, thumbs_down: 0 };
      stats[variant][action] = (stats[variant][action] || 0) + 1;
      chrome.storage.local.set({ [STORAGE_KEY_AB_STATS]: stats });
    });
  }

  // ─── Feedback Storage ─────────────────────────────────────────────────────

  function storeFeedback(signal, queryType, variant) {
    // signal: 'up' | 'down'
    chrome.storage.local.get(STORAGE_KEY_FEEDBACK, (r) => {
      const fb = r[STORAGE_KEY_FEEDBACK] || [];
      fb.push({
        ts:      Date.now(),
        signal,
        type:    queryType,
        variant,
        platform: PLATFORM,
        mode:    domainMode,
      });
      // Keep last 500 feedback entries
      if (fb.length > 500) fb.splice(0, fb.length - 500);
      chrome.storage.local.set({ [STORAGE_KEY_FEEDBACK]: fb });
    });
    trackABEngagement(variant, signal === 'up' ? 'thumbs_up' : 'thumbs_down');
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

  function showToast(typeLabel, original, enhanced, queryType, variant, fromCache, signals) {
    const existing = document.getElementById('qb-toast');
    if (existing) existing.remove();
    if (toastTimer) clearTimeout(toastTimer);

    function esc(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
              .replace(/\n/g,'<br>');
    }

    // Extract injected wrapper text (what was added after the separator)
    const sepIdx     = enhanced.indexOf('\n\n---\n');
    const wrapperText= sepIdx >= 0 ? enhanced.slice(sepIdx + 6) : '';

    const origSnippet   = original.length  > 130 ? original.slice(0, 130)  + '…' : original;
    const boostSnippet  = enhanced.length  > 220 ? enhanced.slice(0, 220)  + '…' : enhanced;
    const wrapperSnippet= wrapperText.length > 200 ? wrapperText.slice(0, 200) + '…' : wrapperText;

    const variantBadge  = '<span class="qb-ab-badge">v' + (variant || 'A') + '</span>';
    const cacheBadge    = fromCache ? '<span class="qb-cache-badge" title="Result from session cache">cached</span>' : '';
    const signalsHTML   = (signals && signals.length)
      ? '<span class="qb-toast-signals">Matched: ' + signals.slice(0, 2).join(', ') + '</span>'
      : '';

    const toast = document.createElement('div');
    toast.id = 'qb-toast';
    toast.setAttribute('role', 'status');

    toast.innerHTML =
      '<div class="qb-toast-main">' +
        '<span class="qb-toast-icon">⚡</span>' +
        '<div class="qb-toast-text">' +
          '<span class="qb-toast-title">Query boosted ' + variantBadge + cacheBadge + '</span>' +
          '<span class="qb-toast-type">' + typeLabel + signalsHTML + '</span>' +
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
        storeFeedback(signal, queryType, variant || 'A');
        // Visual confirmation
        toast.querySelector('.qb-toast-feedback').innerHTML =
          '<span class="qb-feedback-done">' + (signal === 'up' ? '👍 Thanks!' : '👎 Noted!') + '</span>';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(dismiss, 1800);
      });
    });

    toastTimer = setTimeout(dismiss, TOAST_DURATION_MS);
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

    if (rawText.indexOf('Do not mention these instructions') !== -1) return;

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
        'Follow-up':      'Follow-up detected — sent as-is',
        'Too short':      'Query too short — sent as-is',
        'Low confidence': 'Type unclear — sent as-is',
      };
      showSkipToast(skipReasons[result.label] || 'Sent as-is');
      return;
    }

    var enhanced = result.enhanced;
    var label    = result.label;
    var variant  = result.variant || abVariant || 'A';

    // Fix #4: Increment counter and track A/B *before* triggering submit.
    // All async storage ops are kicked off together; isProcessing is cleared
    // only in the triggerSubmit callback, after the click/keypress has fired.
    chrome.storage.sync.get(QB_KEYS.COUNT, function (r) {
      var prev = (typeof r[QB_KEYS.COUNT] === 'number') ? r[QB_KEYS.COUNT] : 0;
      chrome.storage.sync.set({
        [QB_KEYS.LAST_TYPE]:     label,
        [QB_KEYS.PLATFORM]:      PLATFORM,
        [QB_KEYS.LAST_BOOST_TS]: Date.now(),
        [QB_KEYS.COUNT]:         prev + 1,
      });
    });

    // #9: Store last boost info for popup re-display
    chrome.storage.local.set({
      [QB_KEYS.LAST_BOOST_INFO]: {
        label:    label,
        type:     result.type,
        original: rawText.slice(0, 300),
        variant:  variant,
        platform: PLATFORM,
        mode:     domainMode,
        ts:       Date.now(),
      },
    });

    if (variant !== 'custom') {
      trackABEngagement(variant, 'sent');
    }

    // Write the enhanced text, show the toast, then verify the write succeeded
    // before submitting. Retries up to 3× with 60 ms gaps for slow React renders.
    setInputText(inputEl, enhanced);
    showToast(label, rawText, enhanced, result.type, variant, result.fromCache, result.signals);

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
      showToast(result.label, rawText, result.enhanced, result.type, result.variant || abVariant || 'A', result.fromCache, result.signals);
      respond({ ok: true, label: result.label, type: result.type, variant: result.variant });
    }
  });

})();
