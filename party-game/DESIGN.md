# Party Game App – Design Document

Working title: **Roomful** (alternatives: Partyroom, Crowdplay, Jolt). Pick one later; nothing below depends on the name.

One sentence: one phone starts a room, everyone else joins by code or QR in seconds, any TV or browser can become the big screen, and the app runs the night for you with games that fit the moment (lunch, dinner, pregame, full party, late night, couples).

See `GAMES.md` for the game catalog (80+ games), `UNLIMITED.md` for how the app generates endless new games and mega modes, and `LOOK.md` for the visual design system and the clickable mockup.

---

## 1. Core idea and what makes it better than existing apps

Existing apps each cover one slice: Jackbox needs a TV and a purchase per pack, Heads Up is one game, Psych/Evil Apples are phone-only, Spyfall sites are ugly and forget players. The gap:

1. **Works with or without a TV.** Every game has a "big screen" layout and a "phones only" layout. Nobody is blocked because the party is in a garden or at a restaurant table.
2. **Host runs the night, not the phone.** The host (party leader) picks a **Party Mode** (Dinner, Lunch, Pregame, Full Party, Late Night, Couples, Kids, Office) and the app proposes a playlist of games with the right energy curve. Host can override anything at any time.
3. **Join in 5 seconds, no account.** Room code + QR. Name + draw an avatar. Done. Accounts are optional and only add stats and saved packs.
4. **One room, one scoreboard, whole night.** Points carry across games; MVP, awards and a shareable recap at the end.
5. **Content levels you control.** Family / Party / Spicy (18+) / Drinking (opt-in, 18+). Host sets the level once; every game respects it.
6. **2-player and couples built in.** The same engine runs 2-player duels on a TV or two phones, so the app is useful on a Tuesday night too, not only at a party.

---

## 2. Roles and devices

| Role | Device | What it does |
|------|--------|--------------|
| **Host** (party leader) | Phone (app or browser) | Creates the room, sets content level and party mode, starts/skips/pauses games, kicks players, can also play. Host can hand over the crown. |
| **Player** | Phone (browser link, PWA, or store app) | Private controller: secret roles, answers, votes, buzzer, drawing, tilt/shake input. |
| **Screen** | TV browser, laptop, tablet, Chromecast, Android TV / Fire TV, Apple TV (later) | Shared public view: lobby QR, timers, prompts, votes, scoreboard, results. Zero input. Several screens can join the same room. |

Rules:

- A room always works with **zero screens**. If there is no screen, the host phone can be propped as the screen ("Table mode"), or results simply show on every phone.
- A screen never receives secret data. Secret roles, answers before reveal, and private cards only go to the owning player's socket.
- Any device can be host. Host disconnect for more than 60 seconds auto-promotes the longest-connected player.

### TV / console mode

The "install it on the TV and play like a console" goal, in order of effort:

1. **Any browser on the TV** (smart TV browser, laptop on HDMI, Chromecast "cast tab"): open `app.example/tv`, it shows a room code and QR. This is the MVP path and needs no store approval.
2. **Chromecast receiver**: host taps Cast in the phone app; the receiver loads the screen client. Cheap to add, big win because many people own one.
3. **Android TV / Fire TV app**: the screen client wrapped in a thin native shell, published to those stores. D-pad is only used to show the code or exit.
4. **Apple TV**: needs a native tvOS app. AirPlay mirroring of the host phone works today as a stopgap. Native tvOS is phase 3.
5. **Console feel**: the TV shows the lobby like a game console home: tiles for games, player avatars sliding in as they join, a sound when someone joins, controller-style vibration on the phone when it is your turn.

---

## 3. Game flow (room state machine)

```
Create room
   │
   ▼
LOBBY ──► SETUP (mode, content level, teams) ──► PLAYLIST
   ▲                                                 │
   │                                                 ▼
RECAP ◄──── RESULTS ◄──── GAME (phases) ◄────── NEXT GAME ◄──┐
   │                                                          │
   └───────────── (host picks "one more") ────────────────────┘
```

- **Lobby**: QR + code on screen, avatars appear as players join, host sees "Start" when at least the game minimum is present. Players can draw their avatar and pick a color while waiting.
- **Setup**: party mode, content level, team split (auto-balance or pick), round length (short 10 min / normal 25 / long 45).
- **Playlist**: proposed sequence of 4–8 games. Host can shuffle, remove, add, or just press play.
- **Game**: each game is a list of phases (intro, input, discuss, vote, reveal, score). Server owns the clock.
- **Results**: per-game podium with points added to the night scoreboard.
- **Recap**: end-of-night awards (MVP, Best Liar, Fastest Thumb, Most Voted "Most Likely To"), funniest answers, shareable image.

Everything is **server authoritative**: clients send intents (`vote`, `answer`, `buzz`), the server validates and broadcasts a role-filtered view. This is what makes reconnection and TV sync trivial.

---

## 4. Phone sync and networking

### Transport

- WebSocket per client, JSON messages, sequence numbers on every state broadcast.
- Server keeps one in-memory room object per room; clients receive `state.full` on join/reconnect and `state.patch` afterwards.
- Timers: server sends `deadlineAt` (server time) plus clients measure clock offset on connect (ping/pong), so all phones and the TV count down in sync without constant tick messages.
- Inputs that need speed (buzzer, tap race) are timestamped by the server on arrival; ties resolved by arrival order. Latency is small enough (<100 ms on normal WiFi/LTE) that nobody notices.

### Join and reconnect

- Room code: 4 letters, no ambiguous characters (no O/0, I/1). QR encodes a deep link `https://app.example/j/ABCD`.
- Each player gets a `playerToken` stored in localStorage/app storage. A reconnect within 15 minutes resumes the same seat, score and secret role. Screen refresh on the TV is harmless.
- Rooms live 6 hours after last activity, then expire.

### Hosting recommendation

- **One process per room** model: Cloudflare Durable Objects (PartyKit) or Colyseus on Node. Both give you a single-threaded authoritative room without having to build sticky sessions or Redis fan-out yourself. Recommendation: **Cloudflare Workers + Durable Objects** (cheap, global, zero ops, WebSockets built in).
- Static content and the packs (prompts, trivia) on a CDN; Postgres (Neon/Supabase) only for accounts, custom packs, and purchases.
- Offline/LAN mode (host phone runs the server on a hotspot) is a phase 3 idea, not MVP. In practice parties have WiFi or LTE.

### Message protocol (sketch)

```jsonc
// client -> server
{ "t": "room.join",  "code": "ABCD", "role": "player", "name": "Hana", "token": "…" }
{ "t": "game.action", "seq": 12, "action": { "type": "vote", "target": "p3" } }
{ "t": "host.cmd",   "cmd": "skip" | "pause" | "kick" | "start" | "next" }

// server -> client (view already filtered for this role/player)
{ "t": "state.full",  "seq": 40, "room": { … }, "view": { … } }
{ "t": "state.patch", "seq": 41, "patch": [ … json-patch … ] }
{ "t": "time.sync",   "serverNow": 1730000000000 }
```

---

## 5. Game engine (how a mini game is defined)

Every game is a plugin with the same shape, so adding game #40 costs a day, not a week.

```ts
interface GameDefinition<S, A> {
  id: string;                      // "imposter"
  meta: {
    title: string;
    players: { min: number; max: number };
    minutes: number;               // typical duration
    energy: 1 | 2 | 3 | 4 | 5;     // 1 = calm dinner, 5 = loud party
    needsScreen: "no" | "nice" | "required";
    teams: boolean;
    contentLevels: ("family" | "party" | "spicy" | "drinking")[];
    inputs: ("tap" | "text" | "draw" | "tilt" | "shake" | "buzzer" | "camera")[];
    tags: string[];                // "deduction", "trivia", "2p", "couples"
  };
  init(ctx: Ctx): S;                                   // deal roles, pick prompts
  phases: Phase<S, A>[];                               // ordered, each with timer + end condition
  reduce(state: S, action: A, from: PlayerId, ctx: Ctx): S;
  view(state: S, role: "host" | "player" | "screen", me?: PlayerId): ViewModel; // secrets filtered here
  score(state: S): Record<PlayerId, number>;
}
```

Shared building blocks (built once, used by every game): countdown timer, vote panel, text input with profanity filter, drawing canvas with replay, buzzer, secret card ("hold to reveal"), scoreboard, team splitter, prompt deck loader, tilt/shake detector, sound and vibration cues.

---

## 6. UX design

### Visual direction

- **Party theme** (default at night): near-black background, electric accents (magenta, cyan, lime), big rounded type, glow on the active element. Confetti and screen shake on reveals.
- **Daylight theme** (Dinner / Lunch / Kids): warm cream background, deep teal and coral accents, same layout, lower contrast and no flashing.
- Theme follows the party mode, host can override.
- Avatars: players draw their own face in the lobby (3 colors, 20 seconds) or pick an emoji. Hand-drawn avatars on the TV are a big part of the charm.

### Screen (TV) rules

- 10-foot UI: minimum 32 px text at 1080p, one message per screen, no scrolling ever.
- Always visible: room code in a corner, round counter, small avatars with scores at the bottom.
- Reveals are staged: suspense pause, drumroll, then result. The TV is the entertainer.
- Audio: short stingers for join, timer end, reveal, win. Mute toggle on host.

### Phone rules

- Thumb zone: primary action is a full-width button at the bottom.
- One job per screen: "Your word is…", "Vote", "Draw", "Buzz". Never two inputs at once.
- Haptics: vibrate on your turn, on timer last 3 seconds, on buzz.
- Secret cards are hidden by default and shown with "hold to see" so neighbors cannot peek.
- Works in the browser with no install; "Add to home screen" prompt after the first game. Store apps are the same web client wrapped with Capacitor plus push for "the party is starting".

### Phones-only layouts

Each game defines a fallback when there is no screen:

- Prompts and timers show on every phone.
- Reveals and votes show on every phone at once with a 3-second "everyone look now" countdown.
- Pass-the-phone games (Imposter reveal, Who Am I) also work on a single phone with no network at all ("Solo device mode").

### Accessibility

- Color-blind safe palette (never color alone to mark a team; add shape/icon).
- Font scaling honored; large-text mode on TV.
- Reduced motion switch disables confetti and shake.

---

## 7. Content system

- **Packs**: JSON decks per game (prompts, words, trivia questions, dares, "most likely to" lines). Each item tagged with content level and language.
- **Levels**: Family (kids safe), Party (adult humor, no sexual content), Spicy (18+), Drinking (18+, opt-in, shows "sip/drink" cues, always offers a non-alcohol alternative).
- **Custom packs**: host types or pastes their own prompts, inside jokes, names of the people present.
- **Generated packs (optional, later)**: "Make a trivia round about Hana's 30th birthday and our trip to Lisbon" generates a themed deck with an LLM, host reviews before play. This is a strong premium feature.
- **Localization**: the UI and packs are keyed by language from day one. Packs are not translated 1:1; each language gets culturally fitting items.
- **Moderation**: profanity filter on free text at Family level, host can hide any submitted answer with one tap on the host phone.

---

## 8. Party modes (the playlists)

| Mode | Energy curve | Example playlist (40 min) |
|------|--------------|---------------------------|
| **Lunch / Coffee** | calm | Table Topics → Emoji Movie Quiz → Guess the Year → Wavelength |
| **Dinner** | calm → medium | Two Truths and a Lie → Imposter (word) → Trivia (teams) → Most Likely To |
| **Pregame** | medium → high | Most Likely To → Quip Battle → Buzzer Trivia → Never Have I Ever → Bomb Pass |
| **Full Party** | high | Imposter → Draw Chain → Charades Relay → Quip Battle → Dance-off → Bomb Pass → Awards |
| **Late Night** | medium, spicy allowed | Truth or Dare → Hot Seat → Never Have I Ever (Spicy) → Who Said That |
| **Couples (2)** | medium | How Well Do You Know Me → Pong on TV → Would You Rather → Draw Duel → Truth or Dare (couples) |
| **Kids / Family** | medium | Who Am I (animals) → Pictionary → Animal Sounds → Simon Says (shake) → Memory Match |
| **Office / Team** | medium, Family level | People Bingo → Two Truths → Trivia (teams) → Codenames → Wavelength |

Auto-mode respects the player count (no 8-player game with 3 people) and the content level.

---

## 9. Tech stack recommendation

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript everywhere | one game definition runs on server and client (same reducer for prediction and validation) |
| Server | Cloudflare Workers + Durable Objects (PartyKit) | one object per room, WebSockets, global, nearly free at small scale |
| Web client | React (or Svelte) + Vite, PWA | one codebase for phone, host and TV screen (route per role) |
| Store apps | Capacitor wrappers (iOS, Android, Android TV) | same web client, adds push, haptics, Cast |
| Chromecast | Cast Web Receiver loading the screen client | low effort |
| Apple TV | native tvOS shell later | required by Apple; AirPlay mirror meanwhile |
| Data | Postgres (Neon/Supabase) for accounts, packs, purchases | rooms stay in memory, no DB on the hot path |
| Content | JSON packs on CDN, versioned | easy to add languages and custom packs |
| Audio/anim | Howler + Framer Motion / CSS | small, fast |

Monorepo layout:

```
apps/web        phone + host + screen (routes: /play, /host, /tv)
apps/server     room worker, game runtime
packages/games  one folder per game (definition + packs + tests)
packages/ui     shared components (timer, vote, canvas, scoreboard)
packages/proto  message types shared by server and client
apps/mobile     Capacitor shells (ios, android, android-tv)
```

---

## 10. Roadmap

**Phase 1 – MVP (6–8 weeks, one developer with AI help)**
- Room system: create, join by code/QR, reconnect, host controls, screen role.
- Web client for phone, host and TV; phones-only fallback.
- Night scoreboard and simple recap.
- 8 games: Imposter, Who Am I, Most Likely To, Buzzer Trivia, Quip Battle, Two Truths and a Lie, Truth or Dare, Never Have I Ever.
- Family + Party content levels, one language.

**Phase 2 (next 6–8 weeks)**
- Drawing games (Pictionary, Draw Chain), Charades, Taboo, Codenames, Wavelength, Bomb Pass, Hot Seat.
- 2-player pack (Pong, Draw Duel, Couple Quiz, Would You Rather, Quick Draw).
- Party modes and auto playlist, awards, shareable recap image.
- PWA install, Capacitor iOS/Android apps, push notification "party starting".
- Spicy and Drinking levels with age gate; second language.

**Phase 3**
- Chromecast receiver, Android TV / Fire TV app, Apple TV app.
- Custom packs, generated themed packs, accounts and stats.
- Team tournaments, Photo missions, Dance-off with motion scoring, Karaoke.
- Premium: pack store, host subscription, ad-free.

---

## 11. Risks and decisions to make early

- **Native vs web**: web-first is strongly recommended. Players will not install an app at a party; the QR must open a playable page. Store apps are for hosts and TV.
- **Content legality**: drinking content must be opt-in, 18+ gated, and hidden in countries where it is a store-review problem. Keep it in a separate pack so it can be switched off per region.
- **Latency games**: buzzer fairness depends on server timestamps, never on client clocks.
- **Moderation of free text**: host hide button plus filter at Family level is enough for MVP; report button later.
- **TV browser quality**: some smart TV browsers are old. Keep the screen client dependency-light and test on one LG and one Samsung TV early. Chromecast and a laptop on HDMI are the reliable paths.
- **Battery**: phones stay on screen for hours; dark theme, no constant animations on the phone, wake-lock only during active input.
