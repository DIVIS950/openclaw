# Deliberation — how the jury argues

Goal: scores that are calibrated, not averaged. Agents only change their mind for evidence.

## When
Full mode, after the foreman's `merge` lists disputes. Skip if there are none. Quick mode never deliberates (speed wins).

## What counts as a dispute
- Same area scored ≥ 3 apart by two agents
- One agent reports a Critical/Major issue; another tested the same thing and saw nothing
- A persona loved a flow an expert flagged (or the reverse)

## Protocol (orchestrator runs it)
For each dispute, launch BOTH agents again **in parallel**, with this prompt:

```
DELIBERATION — <dispute title>
Your earlier report said: <their claim + score + evidence>
<Other agent> says: <their claim + score + evidence>
Re-check ONLY this point in the live app / code (same test account, same scenario).
Answer in this shape:
  POSITION: KEEP / CHANGE
  NEW SCORE (if changed): <n>
  NEW EVIDENCE: <steps or file:line, or "none">
  WHY (max 3 sentences):
```

One round only. Then the foreman rules in `verdict` mode:
- new, reproducible evidence wins
- a reproduced failure beats "worked for me"
- if both keep and both have evidence, the stricter reading wins for security/data-loss, the persona's reading wins for usability
- the foreman writes one line per dispute in verdict.md: who won and why

## Limits
- Max 5 disputes per run (take the ones that move the total score most)
- Agents never see each other's full reports — only the dispute, so they don't just copy
- A score may move by at most 3 points in deliberation
