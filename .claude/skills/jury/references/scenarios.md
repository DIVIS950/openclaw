# Writing real-life scenarios

A good scenario = a real person, a real moment, a real goal, a clear "did it work?".

## Template

```
### S<n>: <short name> [core]
Persona: <who> (tech skill: low/medium/high, device: phone/laptop)
Situation: <when/where, how much time, mood>
Goal: <what they want to get done>
Steps they would naturally try: <3–6 steps, written as the user thinks, not as the dev built it>
Success = <observable result, e.g. "task appears in list after refresh">
Time limit: <seconds a real user would accept>
```

Mark the 4 most important ones `[core]` in the title (used by quick mode). Scenarios are saved and reused across runs so scores stay comparable.

## Always include these scenario types

1. **First 60 seconds** — brand-new user opens the app. Do they understand what it is and what to do?
2. **Main job** — the #1 thing the app exists for, done start to finish.
3. **Phone in a hurry** — small screen, one thumb, slow network.
4. **Coming back** — returning user finds what they made last time (data saved?).
5. **Mistake** — user types something wrong / clicks the wrong thing. Can they recover?
6. **Edge** — empty state, very long text, 0 items, 500 items, special characters (ěščřžýáíé, emoji).
7. **Two users** (if accounts exist) — user A must NOT see user B's data.
8. **Stop moment** — "would I come back tomorrow / tell a friend?"

## Persona bank (pick what fits the app)

- First-time user, never seen the app, medium tech skill
- Everyday power user who wants speed and shortcuts
- Impatient phone user on mobile data
- Low-tech user (parent / grandparent)
- Student under time pressure
- Non-native English speaker
- User with accessibility needs (large text, keyboard only, colour-blind)
