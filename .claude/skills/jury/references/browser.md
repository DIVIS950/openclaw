# How agents use the live app

Use the first option that works. Never report live results for checks you did not run — write `NOT RUN`.

## Option 1 — connected browser tools (best: you see the real thing)
If browser tools exist in the session (Claude in Chrome, the built-in browser, or a Playwright MCP), use them: open the URL, take screenshots, click, type. Load them with ToolSearch if they are deferred (search "browser", "navigate", "screenshot").

## Option 2 — the jury browser script (always available, headless Chromium)

```
node ".claude/skills/jury/scripts/jury-browser.mjs" scan <url> [--mobile] [--slow] [--crawl 10] [--out app-jury-report/browser/<agent>]
node ".claude/skills/jury/scripts/jury-browser.mjs" run  <steps.json> [--mobile] [--slow] [--out ...] [--state login.json] [--save-state login.json]
node ".claude/skills/jury/scripts/jury-browser.mjs" setup     # first time on a new computer (installs Chromium, ~1 min)
```

First run installs Playwright into `~/.app-jury` automatically if it's missing.

**scan** gives you: load time (LCP, transfer KB), console errors, failed requests (404/500), title/h1, every visible button/link/input (with tap-target size and missing labels), images without alt, horizontal scroll on mobile, a full-page screenshot, and with `--crawl N` the status of up to N same-origin pages (finds broken links).

**run** executes a scenario. Write `steps.json`:

```json
[
  {"goto": "https://app.example.com"},
  {"fill": "Email", "value": "jury@test.com"},
  {"fill": "Password", "value": "<test password>"},
  {"click": "Log in"},
  {"expect_url": "/dashboard"},
  {"fill": "New task", "value": "[JURY] Maths p.42 ěščř 🚀"},
  {"click": "Add"},
  {"expect_text": "[JURY] Maths p.42"},
  {"reload": true},
  {"expect_text": "[JURY] Maths p.42", "note": "survives refresh?"},
  {"offline": true}, {"click": "Add"}, {"screenshot": "offline-add"}, {"offline": false},
  {"dblclick": "Save"}, {"eval": "document.querySelectorAll('.task').length"},
  {"back": true}, {"expect_no_text": "Error"},
  {"viewport": {"width": 390, "height": 844}}
]
```

Step words: `goto, click, dblclick, fill+value, select+value, press, wait (ms), reload, back, offline (true/false), viewport, screenshot, eval, expect_text, expect_no_text, expect_url, note`. Plain words match what the user sees (button text, label, placeholder); CSS selectors (`#id`, `.class`, `text=`) also work. A failed step stops the run (add `"required": false` to continue) and saves a screenshot. Add `--save-state login.json` once after logging in and `--state login.json` later to skip logging in again.

Flags: `--mobile` = iPhone 14 size + touch; `--slow` = slow mobile data (400 ms latency, 400 kbps).

Read `result.json` and look at the screenshots (Read tool) — the screenshots are your eyes.

## Option 3 — nothing works
Say so: `TESTED HOW: code only — live checks NOT RUN (no browser)`. Score only what you could verify.

## Rules
- Only the URL and test account you were given. Prefix everything you create with `[JURY]` and delete it at the end.
- Passwords never go into reports, history or screenshots' file names.
