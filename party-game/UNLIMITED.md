# Unlimited Games: how the app never runs out

The 70 games in `GAMES.md` are the hand-built core. "Unlimited" comes from five systems layered on top of the same engine. None of them need a new game to be coded.

---

## 1. Game DNA: every game is a recipe of 5 parts

Every mini game in the engine is built from the same five slots. Change one slot and you get a new game.

| Slot | Options |
|------|---------|
| **Input** | tap a choice, pick a player, type text, draw, buzz, tilt/shake, hold-to-reveal secret, camera photo, act/say out loud |
| **Content** | word pairs, prompts with blanks, trivia, statements, images, emoji riddles, lyrics, dares, people in the room |
| **Secret** | none, one secret role, one secret target, everyone has a secret |
| **Reveal** | all at once, one by one with drumroll, countdown, chain replay, vote bars |
| **Scoring** | majority wins, minority wins, fool the others, speed, closest guess, crowd vote, survival (lives), team total |

Examples the recipe produces without new code:

- Most Likely To + secret target + minority wins = **"Odd One Out"**: one player secretly must vote for someone nobody else picks.
- Trivia + draw input = **"Draw the Answer"**: answer trivia by drawing the answer, crowd judges.
- Two Truths + camera = **"Photo Truths"**: two real photos from your phone and one from the internet; which is fake?
- Imposter + lyrics = **"Lyric Imposter"**: everyone sings one line of the same song, the imposter has a different song.

The engine ships with a **Remix** button on every game: the host taps it and the app swaps one slot and shows the new rules in one sentence. Players rate the remix after playing; good remixes get promoted to the catalog.

## 2. Game Studio: build a game on your phone in 3 minutes

A wizard, no coding:

1. Pick a template: Vote, Quiz, Type and Vote, Draw and Guess, Secret Role, Timer Challenge, Chain.
2. Write or paste content (or import a list, or dictate it).
3. Set the rules with sliders: round length, points, teams, content level.
4. Name it, pick a cover color and emoji, play it immediately in your room.
5. Optional: publish to the Workshop with a share code (e.g. `STUDIO-K4PX`).

Private games for birthdays, weddings and office parties are the killer use: "Trivia about Hana", "Bachelor party dares", "Our 2019 Lisbon trip quiz".

## 3. AI Game Master (premium)

The host types one sentence and gets a playable game, content included, in seconds:

- "8 friends, 30 years old, everyone knows each other, it is 1 am, make something ridiculous"
- "Family dinner with grandparents and two kids, calm, 20 minutes"
- "Make a quiz about Lisbon, 15 questions, medium difficulty"
- "Turn this group chat screenshot into a 'who said that' game"

Under the hood the model fills a Game Studio template (so it is always playable) and the host reviews content before it goes on the TV. It also writes themed packs for existing games ("Imposter words about football", "Most Likely To for coworkers, office-safe").

The AI Game Master also acts as a **live narrator**: it reads reveals, roasts the loser (politely at Family level), and announces awards with a generated voice on the TV.

## 4. Workshop: community games and packs

- Browse by mood, group size, language, rating. Weekly featured picks curated by the team.
- Everything is a pack or a Studio game, so it runs in the same engine and cannot break the app.
- Moderation: report button, automatic filter per content level, creators need an account, Family level only shows reviewed content.
- Creators get stats (plays, rating) and a profile. Top creators get a badge and revenue share on premium packs later.

## 5. Live content: the app changes every day

- **Daily drops**: a new Most Likely To set, a new trivia round and a new Quip prompt pack every day.
- **Seasonal packs**: Halloween, Christmas, New Year, Valentine, Eurovision, World Cup, Olympics, back to school.
- **Live events**: Friday 21:00 global quiz, all rooms play the same 20 questions, global leaderboard on the TV.
- **Cross-room tournaments**: two parties in two cities play Buzzer Trivia against each other.

---

## Mega modes (a whole evening, not one game)

| Mode | Length | What it is |
|------|--------|------------|
| **Party Olympics** | 60–90 min | Teams, 8 events across all game types, medal ceremony with the anthem of the winning team's chosen country. |
| **Battle Royale Night** | 45 min | Everyone starts with 3 lives, each round eliminates the losers, finale 1 vs 1 on the TV. |
| **Game Show Night** | 60 min | The host is the presenter. The TV becomes a game show set: Survey Says, The Big Board, The Wheel, Final Round with wagers. |
| **Murder Mystery Dinner** | 90 min | Scripted roles sent to phones before the dinner, clues revealed between courses on the TV, final accusation vote. Packs: 1920s mansion, space station, ski lodge. |
| **Escape Room Party** | 45 min | Puzzles appear on the TV, clue pieces are split across phones, the room must talk to solve them. Timer and hint system. |
| **Couples Night** | 40 min | A playlist for 2 to 6 people in pairs: pairs compete, "how well do you know each other" finale. |
| **Kids Birthday** | 30 min | Big colors, no reading needed on phones (icons only), parent phone is host, prizes on screen. |
| **Office Offsite** | 45 min | Family level forced, icebreakers first, team games, no dares. |

---

## Progression (why people come back)

- **XP and titles** per account: "Rookie", "Party Animal", "Legend". Titles show next to the avatar on the TV.
- **Unlockable avatar items** (hats, glasses, frames) earned by playing, not bought.
- **Night history**: every party is saved with the recap, the awards and the funniest answers. Share link.
- **Streaks**: "3 parties this month" badges.
- **Rivalries**: the app remembers that Jan beat Petr 4 times in Pong and announces the rematch.
