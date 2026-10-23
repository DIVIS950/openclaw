# Pineapple 🍍

A private web app that orders food by phone for you. You type a restaurant, what you want and a
budget. You check a summary and tap **Yes, call**. A voice agent then calls the restaurant in
Czech (and switches to English if the staff do). It orders delivery, paid on delivery, and reports
back the total price, the delivery time and the full transcript.

- **Claude is the brain.** The agent thinks with Claude using **your own Anthropic API key**.
  ElevenLabs provides the voice and the phone connection.
- **Single user.** One password, no sign-up page. The login locks after 5 wrong tries.
- **Safe by default.** Nothing calls without your tap. One call at a time, max 5 a day, Czech
  numbers (+420) only, and a hard budget limit (600 CZK by default). Payment is always on
  delivery. The app never asks for or stores card details.
- **iPhone first.** Add it to your home screen and it opens like a normal app.

---

## What's free and what isn't

| Service | What for | Cost |
|---|---|---|
| GitHub | Holds the code (you already have this fork) | Free |
| [Vercel](https://vercel.com) Hobby | Hosts the app | Free |
| [Neon](https://neon.tech) via Vercel | Database | Free plan is plenty |
| [ElevenLabs](https://elevenlabs.io) | The voice and the phone connection | Free plan includes a small number of agent minutes each month. Check the current plans; more minutes need a paid plan |
| [Anthropic](https://console.anthropic.com) | Claude, the agent's brain | Pay as you go on your key. A short ordering call uses little; `claude-haiku-5-5` is the cheapest option |
| [Twilio](https://twilio.com) | The phone number the agent calls from | **Not free.** Number rent plus per-minute call price. A trial account can only call numbers you verified yourself, so it can't call restaurants |

A real phone call always costs a little (Twilio). Everything else can stay on free plans or
pay-per-use.

---

## Setup using only an iPhone

Budget about 45 minutes. Do everything in **Safari**.

### Step 1: Twilio phone number

1. Sign up at **twilio.com** and verify your email and phone.
2. **Upgrade the account** (add a payment method / credit). Trial accounts can't call restaurants.
3. Buy a number: **Phone Numbers → Manage → Buy a number**. It must support **Voice**.
   - A Czech (+420) number is best, because restaurants pick up local numbers more often. Twilio
     asks for a regulatory bundle (your name and address) before it sells Czech numbers. That can
     take a day or two.
   - Any other Voice number also works for calling Czech restaurants.
4. Allow calls to Czechia: **Voice → Settings → Geo permissions** → tick **Czech Republic** → Save.
   Without this, every call fails.
5. Open the Twilio **Account dashboard** and keep the **Account SID** and **Auth Token** handy.

### Step 2: ElevenLabs API key and number import

1. Sign up at **elevenlabs.io**.
2. Create an API key: profile menu → **Developers** (or **API Keys**) → **Create API key**. Give it
   access to **Agents** (read and write). Copy the key into Notes for a moment.
3. Import your Twilio number: **Agents** → **Phone Numbers** → **Import number** → **Twilio**.
   Enter a label (e.g. "Pineapple"), the phone number in +E.164 format, and your Twilio
   **Account SID** and **Auth Token**. Save.

You don't need to create the agent by hand. The app does it for you in step 7.

### Step 3: Claude API key

1. Go to **console.anthropic.com** and sign up.
2. **Billing:** add a small amount of credit (pay as you go).
3. **API Keys → Create Key.** Copy it into Notes for a moment.

### Step 4: Put the app on Vercel

1. Go to **vercel.com** → **Continue with GitHub**.
2. **Add New… → Project** → import your **openclaw** repository.
3. Before deploying, set **Root Directory** to `pineapple` (tap **Edit** next to it). The framework
   is detected as **Next.js**. Leave the build settings as they are.
4. Tap **Deploy**. The first deploy can fail because env vars are still missing. That's expected.

> **Which branch?** Vercel's production site follows the repo's default branch (`main`). The app is
> on the branch `claude/jarvis-food-app-9uzl1s`, so merge it into `main` in the GitHub app or website
> (open a pull request → **Merge**). Or, in Vercel, change the project's production branch to that
> branch. Use the **production** address for calls: preview addresses sit behind Vercel's login, so
> ElevenLabs can't reach Claude through them.

### Step 5: Database (Neon, the new "Vercel Postgres")

1. In your Vercel project open **Storage** → **Create Database** → **Neon** (Postgres) → pick the
   free plan. For the region, pick **US East (N. Virginia)**: it sits next to Vercel's default
   server region, so Claude's replies on the phone aren't slowed down → **Create**.
2. **Connect** it to the project for all environments. Vercel adds `DATABASE_URL` automatically.

You never run migrations. The app creates its tables the first time it starts.

### Step 6: Environment variables

In the Vercel project: **Settings → Environment Variables**. Add these for **Production**. Tick
**Sensitive** for each one.

| Name | Value |
|---|---|
| `APP_PASSWORD` | Your login password, at least 10 characters. Use a long random one and save it in your iPhone Passwords app. |
| `ANTHROPIC_API_KEY` | Your Claude key from step 3 |
| `ELEVENLABS_API_KEY` | Your ElevenLabs key from step 2 |

`DATABASE_URL` is already there from step 5. Optional settings (Claude model, voice, and so on)
are listed in [`.env.example`](.env.example).

Then redeploy: **Deployments** → newest deployment → **⋯** → **Redeploy**. Env var changes only
take effect after a redeploy.

### Step 7: First start (inside the app)

1. Open your app's production address (shown in Vercel, like `https://pineapple-yourname.vercel.app`)
   and log in.
2. **Settings → Your details:** enter your name, your phone (the courier calls it), your full
   delivery address (floor, door, name on the bell) and the payment method (cash, or card to the
   courier at the door). Check the max budget and tap **Save**.
3. **Settings → Voice agent:** tap **Set up voice agent**. Under **Caller number**, tap **Use** next
   to your Twilio number. Every row should now show a ✓.

### Step 8: Add to the home screen

In Safari tap **Share → Add to Home Screen → Add**. Pineapple now opens full screen like an app.
You stay logged in for 30 days.

### Step 9: Test call to yourself

If your own phone has a Czech number, place a first order with **your number as the restaurant
phone**. Pineapple calls you and you can play the restaurant. Try saying a price over the budget
and check that it cancels.

### Optional: a native Czech voice

In ElevenLabs open **Voices → Voice Library**, filter by **Czech**, add a voice you like to **My
Voices** and copy its **Voice ID**. In Vercel add `ELEVENLABS_VOICE_ID` with that value and redeploy.
Then tap **Settings → Update voice agent** in the app.

### Optional: faster or cheaper Claude

The default is `claude-opus-5-5`, the smartest model, thinking at `low` effort to keep replies
quick. To make replies faster and calls much cheaper, set `PINEAPPLE_CLAUDE_MODEL` to `claude-haiku-5-5` in
Vercel, redeploy, and tap **Settings → Update voice agent**.

---

## How it works

1. **New order:** restaurant name and phone, what you want, and a budget. Saved restaurants show
   as chips, so you only type them once.
2. **Summary:** shows everything, including how the agent will behave. Nothing happens until you
   tap **Yes, call**. A summary expires after 30 minutes.
3. **Live call:** the app starts the call through ElevenLabs' Twilio outbound-call API. It then
   polls the conversation every 2 seconds and shows ringing, on the call, wrapping up, a timer and
   the live transcript. You can close the app; the call carries on.
4. **Result:** confirmed or not, total in CZK, delivery time (with the expected arrival clock time),
   notes such as substitutions, the call summary and the full transcript.
5. **History:** every past call. **Re-order** copies an order into a new summary in one tap. You
   still confirm it with **Yes, call**.

### Claude as the brain (the bridge)

ElevenLabs runs the voice and the phone call. For each thing the agent says, ElevenLabs asks a
"Custom LLM", and that is this app: `POST /api/llm/chat/completions`
([`app/api/llm/chat/completions/route.ts`](app/api/llm/chat/completions/route.ts)). The bridge
turns the request into a Claude Messages API call with the official Anthropic SDK and streams
Claude's reply back word by word, so the agent starts speaking quickly.

- **Your Anthropic key never leaves Vercel.** ElevenLabs only gets a random bridge token (stored as
  an ElevenLabs workspace secret). The app keeps just a hash of it, and issues a new one every time
  you tap **Set up / Update voice agent**.
- **It only works during your calls.** Requests are refused unless one of your orders is on the
  phone right now, so a leaked token can't run up your Claude bill. (This also means the "Test
  agent" button inside the ElevenLabs dashboard won't get answers. Test with a real call to
  yourself.)
- The model is fixed on the server (`PINEAPPLE_CLAUDE_MODEL`), whatever the request asks for. Output is capped
  per reply, and the system prompt and tools are prompt-cached between turns.
- If Claude's safety filters ever decline a reply mid-call, the request is automatically retried on
  another Claude model (`fallbacks: "default"`), so the agent doesn't fall silent.

### The voice agent

Defined in [`lib/agent-config.ts`](lib/agent-config.ts) and created through the ElevenLabs API, either
by the in-app button or by [`scripts/create-agent.ts`](scripts/create-agent.ts):

- **Language:** Czech, multilingual TTS (`eleven_flash_v2_5`), with an English language preset and
  the `language_detection` tool so it can switch to English.
- **Brain:** `custom-llm` pointing at this app's Claude bridge.
- **Dynamic variables:** `restaurant_name`, `order_items`, `delivery_address`, `customer_name`,
  `customer_phone`, `payment_method`, `max_budget`.
- **Built-in tools:** `end_call`, `language_detection` and `voicemail_detection` (hangs up on
  answering machines).
- **Data collection:** `order_confirmed` (boolean), `total_czk` (number), `eta_minutes` (number),
  `notes` (string). The app reads these after the call.
- **Prompt rules:** always admits it's an AI, never gives or asks for card or bank details, never
  adds items or upsells, accepts only a very close substitute within budget, and cancels politely
  if the total is over budget, the restaurant is closed, or it doesn't deliver to you.
- **ElevenLabs-side limits:** max 7 minutes per call, 1 concurrent call and 5 calls per day,
  matching the app's limits as a second safety net.

To change the prompt, edit `lib/agent-config.ts`, push, wait for the deploy, then tap **Settings →
Update voice agent**.

### Safety limits

All of these are enforced on the server, not only in the UI:

| Limit | How |
|---|---|
| Only after "Yes, call" | The call action only accepts a fresh `draft` order, and the claim is a single atomic database update. A double tap can't start two calls. |
| One call at a time | A unique database index allows only one order that is dialing, on the phone, or waiting for its result. |
| Max 5 calls per day | Counted per Prague calendar day in the same atomic update. A call ElevenLabs refuses outright (4xx) doesn't count. |
| Czech numbers only | `+420` plus 9 digits, normalized from any common format. 8xx shared-cost and 9xx premium-rate numbers are blocked (except 910 VoIP). Checked again right before dialing. |
| Hard max budget | Setting with default 600 CZK and a ceiling of 5000 CZK. Every order must be at or below it, and it's checked again at call time. |
| Pay on delivery | The agent is told cash or card to the courier, and to never give or ask for card details. The app has no card fields at all. |

### Login and security

- `APP_PASSWORD` is compared as SHA-256 hashes in constant time.
- After 5 wrong tries the login locks for 15 minutes. Each further lock doubles, up to 24 hours.
  While locked, the password isn't checked at all.
- Session: a random 256-bit token in a `__Host-` cookie (httpOnly, Secure, SameSite=Lax) that lasts
  30 days. Only its hash is stored in the database. **Sign out everywhere** deletes all sessions.
- Every page, server action and API route checks the session on the server. `proxy.ts` is only a
  fast redirect. The Claude bridge checks its own token instead.
- API keys and the database URL live only in server env vars and never reach the browser. Pages
  send a strict Content-Security-Policy, `X-Frame-Options: DENY` and `noindex`.

**Locked out?** Wait for the lock to end. To unlock right away, open Neon (Vercel → Storage → your
database → **Open in Neon** → SQL Editor) and run:
`UPDATE auth_state SET failed_count = 0, locked_until = NULL;`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "ANTHROPIC_API_KEY is not set" / "ELEVENLABS_API_KEY is not set" | Add it in Vercel and **redeploy**. |
| "Claude isn't connected yet" | Tap **Settings → Set up voice agent**. |
| The call connects, says the greeting, then goes quiet | Claude can't answer. Check your Anthropic credit, that `ANTHROPIC_API_KEY` is right, and that you use the **production** address (step 4). Then tap **Update voice agent**. |
| "ElevenLabs 401" | The ElevenLabs key is wrong or lacks Agents access. Create a new key. |
| Caller number list is empty | Import the Twilio number in ElevenLabs (step 2.3), then reload Settings. |
| Call fails right away / "permission" | Twilio **Geo permissions** for Czech Republic (step 1.4), or the account is still a trial. |
| "Not confirmed" with "Nobody talked on the line" | No answer, busy line, or voicemail. Try later or tap **Call the restaurant yourself**. |
| App error page | Usually `DATABASE_URL` is missing. Connect the Neon database (step 5) and redeploy. |
| Agent speaks with an accent | Pick a native Czech voice (see "Optional: a native Czech voice"). |

---

## Development (on a computer)

```bash
cd pineapple
npm install
cp .env.example .env.local   # fill in values; DATABASE_URL can point at a local Postgres
npm run dev                  # http://localhost:3000
npm test                     # unit tests (bridge translation, phone rules, call results, SQL params)
npm run typecheck
npm run build
npm run create-agent         # create the agent from the terminal (or: -- --update)
```

A `DATABASE_URL` on `localhost` uses the standard `pg` driver. Anything else (Neon) uses Neon's
serverless HTTP driver.

### Project layout

```
app/                     Next.js App Router pages
  (app)/                 Logged-in screens: new order, orders/[id] (summary, live call, result),
                         history, settings
  login/                 Password screen
  actions/               Server actions (auth, orders, settings). Each one checks the session.
  api/orders/[id]/       Polling endpoint for the live call screen
  api/llm/               The Claude bridge ElevenLabs calls (Chat Completions in, Claude out)
lib/
  agent-config.ts        The voice agent: prompt, variables, tools, data collection
  agent-setup.ts         "Set up voice agent": bridge token, ElevenLabs secret, agent
  claude-bridge.ts       Request/stream translation for the bridge (unit tested)
  elevenlabs.ts          ElevenLabs API client (agents, secrets, phone numbers, calls, conversations)
  calls.ts               Starting calls (all safety checks) and syncing call status
  auth.ts                Password check, lockout, sessions
  db.ts, schema.ts       Postgres access and auto-created tables
  phone.ts               Czech number validation
components/PineappleMark.tsx   The logo
scripts/create-agent.ts
proxy.ts                 Redirects visitors without a session cookie to /login
```
