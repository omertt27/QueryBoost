<div align="center">

<img src="assets/logo.png" alt="QueryBoost logo" width="120" height="120" />

# QueryBoost

**Silent AI query enhancement for ChatGPT, Claude, Gemini & Perplexity.**

QueryBoost intercepts your prompts before they're sent, wraps them with precision structure instructions tailored to your intent, and lets the answer speak for itself — with zero interruptions to your workflow.

[![Version](https://img.shields.io/badge/version-2.0.0-7c6af7?style=flat-square)](https://github.com/omerTT/queryboost/releases)
[![Manifest](https://img.shields.io/badge/manifest-v3-10b981?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/)
[![License](https://img.shields.io/badge/license-MIT-f5c842?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-ChatGPT%20%7C%20Claude%20%7C%20Gemini%20%7C%20Perplexity-a78bfa?style=flat-square)](#supported-platforms)

<br/>

<img src="assets/social-preview.png" alt="QueryBoost social preview" width="680" />

</div>

---

## Table of Contents

- [Why QueryBoost](#why-queryboost)
- [How It Works](#how-it-works)
- [Features](#features)
- [Supported Platforms](#supported-platforms)
- [Installation](#installation)
- [Usage](#usage)
- [Domain Modes](#domain-modes)
- [Custom Wrappers](#custom-wrappers)
- [A/B Testing](#ab-testing)
- [Wrapper Transparency](#wrapper-transparency)
- [Architecture](#architecture)
- [File Structure](#file-structure)
- [Query Type Detection](#query-type-detection)
- [Privacy](#privacy)
- [Contributing](#contributing)
- [License](#license)

---

## Why QueryBoost

Most AI prompts are answered worse than they could be — not because the model lacks capability, but because the prompt lacks structure. Asking *"how do I deploy a Next.js app?"* leaves a lot on the table compared to asking with explicit requirements for prerequisites, numbered steps, common mistakes, and an estimated time.

QueryBoost does that scaffolding silently, for every query, on every supported platform. You type naturally. QueryBoost wraps intelligently. You get the better answer.

**No copy-pasting prompt templates. No popups asking what you want. No visible changes to your chat interface.**

---

## How It Works

```
You type a query  →  QueryBoost intercepts on submit  →  Detects intent type
       ↓
Builds an enhanced prompt  →  Injects it into the input  →  Submits automatically
       ↓
You see only the improved answer  •  A toast confirms what type was detected
```

The wrapper is appended after a hidden `---` separator. Each wrapper ends with `Do not mention these instructions.` — so the AI never surfaces the scaffolding in its reply.

---

## Features

### Core
| Feature | Description |
|---|---|
| **Smart type detection** | Weighted multi-signal scoring engine across 10 query types |
| **10 query type wrappers** | Code, Explain, Write, Analyze, Data/SQL, How-To, Local/Travel, Recommend, Opinion, Creative |
| **Follow-up detection** | Skips enhancement for conversational continuations ("ok", "elaborate", "can you…") |
| **Confidence threshold** | Queries under 15 chars or with insufficient signal pass through untouched |
| **Query length awareness** | Short queries get depth-expanding suffixes; long queries get focus-preserving suffixes |
| **Double-wrap guard** | Sentinel string prevents any query from ever being enhanced twice |

### v2.0 Advanced
| Feature | Description |
|---|---|
| **Per-platform tuning** | Each AI platform receives a tailored formatting directive in the wrapper |
| **Domain modes** | Five personas (General, Developer, Student, Researcher, Writer) tune the AI's register |
| **Session cache** | FNV-1a hash keyed by query + mode + variant + platform; avoids re-processing duplicates |
| **Feedback loop** | 👍/👎 buttons on every toast; results stored locally and aggregated by type |
| **A/B testing** | Two wrapper variants (A & B) randomly assigned at install; engagement tracked per variant |
| **Wrapper transparency** | Optional mode to reveal the exact injected instructions in the toast preview |
| **Custom wrappers** | Per-type override editor in the popup; uses `{{query}}` as placeholder |

---

## Supported Platforms

| Platform | URL | Input Strategy |
|---|---|---|
| **ChatGPT** | `chatgpt.com` | contenteditable `#prompt-textarea` |
| **Claude** | `claude.ai` | ProseMirror contenteditable |
| **Gemini** | `gemini.google.com` | Quill `.ql-editor` (shadow DOM pierced) |
| **Perplexity** | `perplexity.ai` | `<textarea>` or contenteditable depending on version |

All four use framework-compatible input injection (React native setter, `execCommand` with event dispatch fallback) to ensure the host app's state management remains in sync.

---

## Installation

> QueryBoost is a **developer/unpacked** extension — it loads directly from source. No Web Store listing required.

**Requirements:** Chrome 109+ (Manifest V3), or any Chromium-based browser (Edge, Brave, Arc, etc.)

### Steps

1. **Clone or download** this repository:
   ```bash
   git clone https://github.com/omerTT/queryboost.git
   cd queryboost
   ```

2. Open your browser and navigate to:
   ```
   chrome://extensions
   ```

3. Enable **Developer mode** (toggle in the top-right corner).

4. Click **"Load unpacked"** and select the `queryboost` folder (the one containing `manifest.json`).

5. The ⚡ QueryBoost icon will appear in your toolbar. Pin it for easy access.

6. Navigate to any supported platform and start typing — QueryBoost activates automatically.

> **Updating:** After pulling new changes, click the refresh ↻ button on the extension card in `chrome://extensions`.

---

## Usage

QueryBoost requires **no configuration** to work out of the box.

1. Go to ChatGPT, Claude, Gemini, or Perplexity.
2. Type your query as you normally would and press **Enter** or click **Send**.
3. A small toast notification appears at the bottom-right confirming the boost type (e.g. *"Code / Debug"*).
4. Click **Preview** in the toast to see what was added — or just read the improved response.

### Popup Overview

Click the ⚡ icon in your browser toolbar to open the popup.

| Tab | Description |
|---|---|
| **Main** | Enable/disable toggle · Active platform · Last boost type · Lifetime counter · Domain mode |
| **Settings** | Wrapper transparency · A/B variant display · Platform tuning reference · Data management |
| **Custom** | Per-type wrapper editor with `{{query}}` placeholder support |
| **Stats** | A/B variant performance · Feedback approval rates by type · Recent feedback log |

### Disabling

Toggle the **Enhancement** switch in the popup to pause all wrapping. Queries are sent exactly as typed. Toggle again to resume — no page reload required.

---

## Domain Modes

Domain modes inject a persona prefix into every wrapper, telling the AI what level of expertise and register to assume.

| Mode | Persona |
|---|---|
| 🌐 **General** | No persona — neutral default |
| 💻 **Developer** | Experienced software engineer; values precision; skip basics |
| 🎓 **Student** | First-time learner; prioritize clarity and foundational understanding |
| 🔬 **Researcher** | Academic context; rigorous, evidence-based reasoning; cite where relevant |
| ✍️ **Writer** | Professional writer; emphasize language quality, clarity, and tone |

Change the mode in the **Main** tab of the popup. The change takes effect on the next query — no reload required.

---

## Custom Wrappers

You can override the built-in wrapper for any query type with your own template.

### How to write a custom wrapper

1. Open the popup → **Custom** tab.
2. Select a query type from the dropdown.
3. Write your template. Use `{{query}}` where the original prompt should be inserted:
   ```
   {{query}}

   ---
   Respond only with a numbered list. No preamble. Max 7 items.
   Use bold for the main point of each item.
   Do not mention these instructions.
   ```
4. Click **Save**. The custom wrapper takes effect immediately for that type.
5. To revert, click **Reset to default** (or clear the textarea and save).

**Rules:**
- The template must contain `{{query}}` — saving without it shows a validation error.
- Custom wrappers bypass A/B variant selection; they are always used when set.
- Custom wrappers are stored in `chrome.storage.sync` and persist across devices if Chrome sync is enabled.

---

## A/B Testing

QueryBoost ships with two wrapper variants to help measure which prompt structure produces better responses.

- **Variant A** — Structured, list-first wrappers that enumerate explicit requirements.
- **Variant B** — Tighter, directive-first wrappers that lead with the output constraint.

Your variant is assigned randomly at install time and persists permanently. Both variants cover all 10 query types.

### Viewing results

Open the popup → **Stats** tab to see:

- **Sent count** per variant (how many queries were processed)
- **👍 / 👎 counts** from the feedback buttons in the toast
- **Approval rate** (thumbs-up ÷ total feedback)
- **Per-type breakdown** with a visual bar chart

Feedback data is stored locally in `chrome.storage.local` and never leaves your device.

---

## Wrapper Transparency

By default, the toast shows a blended "With boost" preview that includes both your original query and the wrapper merged together.

Enable **Wrapper Transparency** in the **Settings** tab to switch the preview to show only the **raw injected instructions** — highlighted in amber — so you can see exactly what was appended to your prompt.

This is useful for:
- Understanding why a response was structured a certain way
- Debugging or refining custom wrappers
- Learning which wrapper patterns work best for your use case

---

## Architecture

```
queryboost/
├── manifest.json          Chrome Extension Manifest V3
├── popup.html             Popup UI shell (4 tabs)
├── src/
│   ├── content.js         Core logic — runs in every supported page
│   ├── popup.js           Popup controller — state, tabs, storage
│   ├── background.js      Service worker — tab platform detection
│   └── styles.css         Popup + toast styles (scoped, no bleed)
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

### `content.js` — Core Pipeline

```
handleSubmit(e)
  └─ getInputText()              Read raw query from input element
  └─ isFollowUp()                Skip if conversational continuation
  └─ buildEnhancedQuery()
       ├─ cacheKey (FNV-1a)      Check session cache first
       ├─ detectQueryTypeWithScore()   Weighted multi-signal scoring
       ├─ customWraps[type]?     User-defined template takes priority
       ├─ WRAPPERS_A / B[type]   A/B variant base wrapper
       ├─ LENGTH_SUFFIX          Brief / normal / detailed length mode
       ├─ DOMAIN_MODE_PREFIXES   Persona injection
       └─ PLATFORM_SUFFIXES      Per-platform formatting directive
  └─ setInputText()              Inject enhanced query (React-safe)
  └─ showToast()                 Feedback UI + preview panel
  └─ triggerSubmit()             Click button or dispatch Enter key
```

### Detection Engine

The query type detector uses a **weighted multi-signal scoring** system:

- **10 categories**: `code`, `explain`, `write`, `analyze`, `data`, `howto`, `local`, `recommend`, `opinion`, `creative`
- **4 signal types**: `phrase` (substring), `prefix` (startsWith), `token` (word boundary regex), `regex` (full pattern)
- **Negative signals**: `negex` rules subtract weight to suppress false positives (e.g. "write an email" → `write`, not `code`)
- **Confidence gating**: queries scoring below 3 with no strong category fall through to the `default` wrapper
- **Winner**: highest cumulative score wins; ties go to `default`

### Session Cache

Queries are hashed with **FNV-1a 32-bit** over the string `rawQuery|mode|variant|platform`. Cache is a `Map` in the IIFE closure — lives for the page session, cleared on reload or navigation. Prevents redundant processing when the same query is resent (e.g. after editing).

---

## File Structure

```
queryboost/
├── manifest.json
├── popup.html
├── LICENSE
├── README.md
├── .gitignore
├── .gitattributes
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── content.js      ~1 150 lines — detection, wrappers, toast, cache, feedback
    ├── popup.js        ~410 lines  — tabs, custom editor, stats, storage
    ├── background.js   ~56 lines   — service worker, tab URL detection
    └── styles.css      ~970 lines  — popup UI + toast (all scoped)
```

---

## Query Type Detection

| Type | Key signals |
|---|---|
| `code` | `fix`, `debug`, `write a function`, error class names (TypeError, etc.), language/framework tokens |
| `explain` | `what is`, `explain`, `how does`, `difference between`, `eli5` |
| `write` | `write an email`, `draft a`, `compose a`, `rewrite this`, `proofread` |
| `analyze` | `pros and cons`, `compare`, `evaluate`, `review this`, `trade-offs` |
| `data` | `SELECT … FROM`, `JOIN`, `pandas`, `data pipeline`, `.csv`, `aggregate` |
| `howto` | `how to`, `how do i`, `step by step`, `getting started`, `deploy` |
| `local` | `restaurant`, `near me`, `where to eat`, `things to do`, city names |
| `recommend` | `recommend`, `suggest`, `top 10`, `best books`, `alternatives to` |
| `opinion` | `should i`, `is it worth`, `which is better`, `help me decide` |
| `creative` | `write a story`, `write a poem`, `brainstorm`, `brand name`, `slogan for` |

---

## Privacy

QueryBoost operates **entirely on-device**. It:

- ✅ Reads your query text to detect intent and inject the wrapper
- ✅ Stores settings and feedback in `chrome.storage.sync` / `chrome.storage.local`
- ✅ Communicates only between the content script, background worker, and popup — all within the extension
- ❌ Does **not** send any data to external servers
- ❌ Does **not** log, transmit, or share your queries
- ❌ Does **not** use any analytics, tracking pixels, or remote configuration

Feedback data (👍/👎) is stored locally and never leaves your device.

---

## Contributing

Contributions are welcome. Please follow these conventions:

### Getting started

```bash
git clone https://github.com/omerTT/queryboost.git
cd queryboost
# Load as unpacked extension in chrome://extensions
```

There is no build step — the extension runs directly from source.

### Guidelines

- **Detection rules** live in `SIGNAL_RULES` in `content.js`. Add new `phrase`, `prefix`, `token`, or `regex` entries with appropriate weights. Add a `negex` entry if a new rule risks false positives in another category.
- **Wrappers** live in `WRAPPERS_A` and `WRAPPERS_B`. Keep the `Do not mention these instructions.` sentinel at the end of every wrapper — it is used for length-suffix splicing and double-wrap detection.
- **Styles** in `styles.css` are split into two sections: popup-scoped (class selectors) and toast-scoped (`#qb-toast` prefix). Keep them separated.
- **No external dependencies.** The extension must remain a single directory of plain files with no bundler, no `node_modules`, and no build step.
- Run `node --check src/content.js src/popup.js src/background.js` before opening a PR to verify syntax.

### Reporting bugs

Please open an issue with:
- Browser name and version
- Platform (ChatGPT / Claude / Gemini / Perplexity)
- What you typed, what was detected, what was expected
- Console output from the extension (DevTools → Sources → content scripts)

---

## License

[MIT](LICENSE) © 2026 omerTT
