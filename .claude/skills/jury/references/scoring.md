# Scoring and agent output format

## Every agent returns exactly this

```
AGENT: <name> (<persona if any>)
SCORE: <0-10>
TESTED HOW: live / code / both   (say "NOT RUN" for anything skipped)

ISSUES:
- [Critical|Major|Minor] <title>
  Where: <page / file:line>
  Steps to reproduce: <short>
  Expected vs actual: <short>
  Suggested fix: <short>

WORKED WELL:
- <1-3 things>

ONE-LINE OPINION: <what a real person would say>
```

Rules: every issue needs proof (steps or file:line). No proof → don't report it. Never invent results for checks that were not run.

## Score guide (per area)

| Score | Meaning |
|---|---|
| 9–10 | Great, would recommend, nothing important to fix |
| 7–8 | Good, small problems only |
| 5–6 | Works but annoying or confusing in places |
| 3–4 | Main scenarios often fail |
| 0–2 | Broken or unsafe |

Any open Critical issue caps that area at 4.

## Weights for the total

| Area | Weight |
|---|---|
| Real users (average of personas) | 25% |
| QA (features work) | 15% |
| Bug hunter | 15% |
| Security | 15% |
| UX | 15% |
| Performance | 8% |
| Business | 7% |

Total = weighted average, one decimal. Areas not tested (quick mode, or NOT RUN) are left out and the remaining weights are re-normalised — never scored as 0 and never guessed.
**GOOD** = total ≥ 7.5 AND no open Critical. Otherwise **NOT READY**.
