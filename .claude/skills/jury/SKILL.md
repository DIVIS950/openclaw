---
name: jury
description: One command for the App Jury. `/jury <url>` = quick check (3 agents, ~5–10 min, no fixing); `/jury full <url>` = full jury (9 agents + fixer, deliberation, re-test); `/jury history` = past scores and what is still open. Also triggers on "test my app", "run the jury", "is my app good/ready", "judge this app", or an app URL with a request to test it.
---

# App Jury — test, fix, re-test, verdict

## Arguments
`/jury <url>` → quick · `/jury full <url>` → full · `/jury quick <url>` → quick · `/jury history` → see **History** at the end.
A URL with no mode means **quick**. No URL → use `app-jury-report/app.json` if it exists, else ask.

Agents test one app like real people. Every issue needs proof. Nothing is guessed. The verdict is short.

## 0. Resolve paths
Plugin root = two folders above this SKILL.md. Scripts live in `.claude/skills/jury/scripts/`. Give every agent the full path to `jury-browser.mjs`, because agents can't see this skill. All run files go in `app-jury-report/` inside the app's folder (or the working directory).

## 1. Intake — ask only what's missing, in ONE question round

If `app-jury-report/app.json` exists and matches the URL (or no URL was given), don't ask anything — say "Testing <name> (<url>), <mode> mode" and go. Otherwise ask only what's missing (AskUserQuestion when available, max 3 questions):

- **Mode** — only if neither a mode nor a URL was typed (a bare URL = quick).
- **Live app** URL (or how to run it locally) + **code** location (folder, GitHub repo, Base44/Lovable project). No code → live-only, say so.
- **Purpose + users** (one line) and a **test login** if needed. Never ask for a real personal password; no test account → test logged-out parts only and note it.

Fix permission in full mode is implied by choosing full: fixes go on branch `app-jury/fixes`, never main, never deploy, never delete data. Say this in one line; don't ask again.

Save `app-jury-report/app.json`: `{name, url, code, purpose, users, test_account_user, default_mode}` — **never the password**.

| | quick | full |
|---|---|---|
| Agents | persona-user (impatient phone user), bug-hunter, qa-tester + foreman | all 9 (3 personas + 6 specialists) + foreman |
| Deliberation | no | yes — agents argue disputes before scoring |
| Fixing | no — report only | yes, then re-test, max 3 rounds |
| Time | ~5–10 min | 20–60 min |
| Use it when | "did I break something?", daily check | before launch / sharing, or after big changes |

## 2. Scenarios — reuse them

If `app-jury-report/scenarios.md` exists, reuse it unchanged (comparable scores across runs). Only add scenarios when the user says the app has new features, or they ask for new ones (`/jury new-scenarios <url>`). Otherwise write 6–10 scenarios for THIS app using `references/scenarios.md` and save them there. Quick mode uses the 4 marked `[core]`; mark them when writing.

## 3. Run the panel (Round 1)

Launch all agents of the chosen mode **in parallel, in one message** with the Agent tool. Each prompt includes: app name/URL/purpose, code location, test account (user only — pass the password only if an agent must log in, and tell it never to write it anywhere), its scenarios, the full `jury-browser.mjs` path, the output format from `references/scoring.md`, the `[JURY]` test-data rule, and where to save its report: `app-jury-report/agents/round1/<agent>[-persona].md`. Personas record their runs (`--video`) so the user can watch where they got stuck.

| Agent | Tests |
|---|---|
| `persona-user` ×3 (first-time user · everyday power user · impatient phone user `--mobile --slow`) | Scenarios end-to-end in the live app, in character, on video |
| `ux-designer` | Clarity, hierarchy, mobile layout, accessibility |
| `security-tester` | Leaked keys, auth holes, other users' data, unsafe input |
| `performance-checker` | Measured load/response times, heavy code |
| `business-judge` | Would people use/pay? vs. real alternatives |
| `bug-hunter` | Breaks it on purpose; exact repro steps |
| `qa-tester` | Every feature/button works; build + tests pass |
| `jury-foreman` (after the round, both modes) | Merges, drops unproven claims, lists disputes, scores, writes the verdict |

**No Agent tool (plain chat)?** Play each role yourself one after another, clearly labelled, same format, same browser script.
**No browser at all?** Agents test code only and mark live checks `NOT RUN`. Never invent results.

## 4. Merge — the foreman, not you

Launch `jury-foreman` in `merge` mode on `app-jury-report/agents/round1/`. It drops claims without proof, merges duplicates, ranks **Critical** → **Major** → **Minor**, writes `findings-round1.md`, and lists **disputes**. If it dropped something for "no proof", re-ask that agent once for the proof.

## 4b. Deliberation (full mode only)

If the foreman listed disputes, run the protocol in `references/deliberation.md`: both agents in each dispute re-check that one point in parallel, one round, max 5 disputes. Save answers to `app-jury-report/agents/deliberation/`.

## 5. Fix (full mode only)

Send Critical + Major (Minor too if quick and safe) to `fixer`:
- Code available → branch `app-jury/fixes`, one commit per fix, build/tests must pass.
- Base44 / Lovable without code → one paste-ready fix prompt per issue (or send via the Lovable connector if it's connected and the user agreed).
- Never deploy, push to main, touch payments/production settings, or delete data. A leaked secret is moved to an env var and the user is told to rotate it.

## 6. Re-test (full mode only)

Re-run only the agents whose issues were fixed, same scenarios. Max 3 fix→re-test rounds; after that, an issue is listed as "still open".

## 7. Verdict, history, report

1. Launch `jury-foreman` in `verdict` mode with: all agent reports, deliberation answers, fixer output, and the scripts folder `.claude/skills/jury/scripts`. It scores (`references/scoring.md`), rules on disputes, writes `verdict.json` (shape in `references/report.md`, including `videos`), `verdict.md`, and runs `build-report.mjs` → `history.json` + `report.html` + score delta.
2. Make sure all `[JURY]` test data was deleted.
3. Reply in exactly this shape:

```
VERDICT: GOOD ✅ / NOT READY ❌   — Score 8.1/10  (▲ +1.6 vs last run)   [mode]
Main reason: <one sentence>

Fixed (N): <one line each>            ← full mode
Still open (N): <one line each, severity first>
Scores: Users 8 · QA 9 · Bugs 8 · Security 9 · UX 7 · Speed 8 · Business 7
Report: app-jury-report/report.html · Videos: app-jury-report/browser/<persona>/*.mp4
```

Hand over `report.html` and the video of the worst-failing persona run (SendUserFile when available; in the Claude app the report can also be published as an artifact if the user wants to share it). Then one line: the single most valuable next fix.

## History (`/jury history`)
Read `app-jury-report/history.json` and `verdict.json`. If missing, say no jury has run here yet and suggest `/jury <url>`. Otherwise reply only:
```
<app name> — <N> runs
6.2 (10-03, quick) → 7.8 (10-10, full) → …     verdict now: GOOD ✅ / NOT READY ❌
Fixed so far: <total>
Still open (<n>): <one line each, severity first>
```
If they want the report, regenerate it with `build-report.mjs` and hand over `report.html`. If they ask what to fix next: the single highest-severity open issue and its suggested fix, one line. Never edit history.json by hand.
