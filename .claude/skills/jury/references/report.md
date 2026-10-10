# verdict.json — what build-report.mjs expects

```json
{
  "app": { "name": "Homework Hub", "url": "https://...", "purpose": "school organiser for students" },
  "date": "2026-10-10",
  "run_id": "2026-10-10T16:40",
  "mode": "full",
  "rounds": 2,
  "commit": "app-jury/fixes @ 3f2a1c9",
  "score": 7.8,
  "verdict": "GOOD",
  "main_reason": "Main job works on phone in under 30 s; data now survives refresh.",
  "areas": { "users": 8, "qa": 8.5, "bugs": 7, "security": 9, "ux": 7, "performance": 8, "business": 6.5 },
  "fixed": [ { "title": "Homework lost on refresh", "severity": "Critical", "detail": "Now saved; persists after reload.", "agent": "bug-hunter" } ],
  "open":  [ { "title": "Add button too small on phone (37px)", "severity": "Minor", "detail": "Target ≥ 44px.", "agent": "ux-designer" } ],
  "worked_well": [ "Clear first screen", "Czech characters and emoji handled" ],
  "agents": [ { "name": "persona-user", "persona": "impatient phone user", "score": 8, "opinion": "Fast enough, I'd use it before class." } ],
  "videos": [ { "label": "Impatient phone user — S3 add homework (failed at step 9)", "path": "browser/impatient-phone-user/run-mobile-2026-10-10T14-26-07.mp4" } ],
  "disputes": [ { "title": "Is the Add flow too slow?", "between": "persona-user vs ux-designer", "ruling": "ux-designer — 6 taps reproduced; persona changed 9→7" } ]
}
```

- Areas not tested in this mode → `null` (quick mode usually has only `users`, `bugs`, `qa`). The weighted total then uses only the areas present, re-normalised.
- `verdict` is exactly `GOOD` or `NOT READY`.
- `videos[].path` is relative to `app-jury-report/` so links work in report.html.
- `run_id` must be unique per run (date + time is fine); the script uses it to avoid double entries in history.
- Never put passwords, tokens or full secrets anywhere in this file.

Then: `node ".claude/skills/jury/scripts/build-report.mjs" app-jury-report`
→ writes `report.html`, appends to `history.json`, prints `{score, verdict, delta, history_runs}`.
