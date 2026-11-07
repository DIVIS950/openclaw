# Look and Feel: visual design system

The app has to look like a night out, not like a form. Two moods ship at launch and the host can switch at any time.

## Moods

| Mood | When | Background | Accents | Feel |
|------|------|------------|---------|------|
| **Night** (default) | Party, Pregame, Late Night | bright indigo (#34267A) with coral, cyan and yellow glows | hot coral (#FF6B8A), electric cyan (#5CF0FF), sun yellow (#FFD93D) | arcade, club, confetti |
| **Daylight** | Lunch, Dinner, Kids, Office | warm linen (#FBF6EE) | deep teal (#0F766E), coral (#F0603F), mustard (#E0A51C) | board game on a wooden table |
| **Retro Arcade** (unlock) | any | black with scanlines | magenta, green, pixel font for numbers | 80s |
| **Elegant** (unlock) | weddings, dinners | charcoal | gold | invitation card |

Rule: Night is bright indigo, never near-black; no pure black, no mid-grey. Neutrals always carry a hint of the accent hue.

## Typography

- **Display**: Unbounded (Google Fonts), wide and loud, used for the room code, game titles, countdown numbers and reveals. Never for body text.
- **Body**: Nunito Sans, friendly rounded, high legibility on phones.
- **Numbers**: tabular figures everywhere digits line up (scores, timers).
- TV scale (1080p): display 96–180 px, headings 56 px, body 36 px minimum. Phone scale: display 40 px, headings 24 px, body 17 px.
- Uppercase labels get letter-spacing; everything else is sentence case.

## Shape and surface

- Corner radius 24 px on cards and buttons on phones, 32 px on TV. Pills for chips.
- Buttons are chunky with a 4 px darker bottom edge (press pushes it down). Haptic tick on press.
- Cards float with a colored glow, not a grey shadow.
- Team colors are always paired with an icon (circle, triangle, square, star) so color-blind players can tell teams apart.

## Avatars

- Drawn by the player in the lobby on a 3-color canvas in 20 seconds, or an emoji fallback.
- Shown on the TV with a sticker-style white outline, slight random rotation, and a bounce when the player acts.
- Unlockable frames and hats sit on top of the drawing.

## Motion

- Join: avatar drops in from the top with a squash and a pop sound.
- Timer: last 5 seconds pulse red and the phones vibrate at 3, 2, 1.
- Reveal: 1.5 s suspense (dim screen, drumroll), then the result slams in with confetti sized to the moment (small for a round win, full screen for the night MVP).
- Scoreboard: bars grow, avatars overtake each other with a short slide.
- Reduced motion setting turns all of this into simple fades.

## Sound

- One short stinger per event: join, your turn, timer end, correct, wrong, reveal, win.
- A low background loop in the lobby only; silence during discussion phases so people can talk.
- Mute on the host phone, volume on the TV client.

## Screens (TV)

- **Lobby**: room code huge top center, QR on the right, avatars in a row at the bottom, "Host presses start" hint. Game tiles slide behind as a carousel like a console home.
- **Prompt**: one sentence, maximum 12 words on screen at once, big; the rest goes to phones.
- **Vote**: avatars move to the option they chose after the reveal, bars show counts.
- **Scoreboard**: top 5 large, the rest small; the biggest climber gets an arrow.
- **Awards**: one award per screen with the winner's avatar big, 3 seconds each.

## Screens (phone)

- Top bar: your avatar, your score, your team color. Room code small on the right.
- Content area with one job.
- Bottom: one primary action button full width, within thumb reach.
- Secret cards: blurred until the player holds a finger on them; release and the blur returns.
- Waiting states are never blank: "Hana is drawing…" with a progress ring, or a tiny mini-game (tap the confetti) while waiting.

## Iconography and illustration

- Thick-line flat icons with a two-tone fill, matching the accent set.
- Game covers are simple geometric compositions (a mask for Imposter, a lightning bolt for Quick Draw), no stock art, no emoji as the only icon.

## Design tokens (starter)

```css
:root {
  --bg: #34267a; --bg-2: #41309a; --surface: #4e3db4; --fg: #ffffff; --muted: #dcd4ff;
  --coral: #ff6b8a; --cyan: #5cf0ff; --yellow: #ffd93d; --lime: #b4ff7a;
  --radius: 24px; --radius-tv: 32px;
  --font-display: "Unbounded", "Arial Black", sans-serif;
  --font-body: "Nunito Sans", system-ui, sans-serif;
}
[data-mood="daylight"] {
  --bg: #fbf6ee; --bg-2: #f3ebdd; --surface: #ffffff; --fg: #1f1a2e; --muted: #6f6885;
  --coral: #f0603f; --cyan: #0f766e; --yellow: #e0a51c; --lime: #4c9a2a;
}
```

Design canvas (Claude Design, 4 TV boards + 5 phone boards, versus-card direction): https://claude.ai/artifact/BgGc3CKEYdaqHRLkXM3kkj

Earlier clickable mockup of the TV and phone screens in both moods: https://claude.ai/artifact/AuP3ny4LSg7n1Wv5HUL986

## Versus direction (2-player inspiration)

Every two-player moment borrows from fighting game "VS" cards and couch split-screen:

- **Diagonal split**: Player 1 is coral on the left, Player 2 is cyan on the right, a white slash between them, a huge tilted VS in the middle. The same split is reused for team games (team A vs team B).
- **Fight-card typography**: player names in display caps at 120 px on the TV, round dots under each name, "best of 5" in a pill.
- **Phone takes the player's color**: in a duel the whole phone turns coral or cyan so you always know which side you are on, with one giant round button for the action.
- **Rivalry memory**: the result screen shows the lifetime score between the two players and offers a rematch first.
- **Pong field** as the model for all "arena" games: dark field inset on the bright ground, glowing paddles in player colors, yellow ball, score in huge tabular digits above.
