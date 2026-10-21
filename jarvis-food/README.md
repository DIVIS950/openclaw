# Jarvis Food

A private web app that orders food by phone for you. You type a restaurant, what you want and a
budget. You check a summary and tap **Yes, call**. An ElevenLabs voice agent then calls the
restaurant in Czech (and switches to English if the staff do). It orders delivery, paid on
delivery, and reports back the total price, the delivery time and the full transcript.

- **Single user.** One password, no sign-up page. The login locks after 5 wrong tries.
- **Safe by default.** Nothing calls without your tap. One call at a time, max 5 a day, Czech
  numbers (+420) only, and a hard budget limit (600 CZK by default). Payment is always on
  delivery. The app never asks for or stores card details.
- **iPhone first.** Add it to your home screen and it opens like a normal app.

---

## Setup using only an iPhone

Budget about 30–45 minutes. Do everything in **Safari**. Where a site has a mobile app, the
website still works fine.

### What you need

| Service | What for | Cost |
|---|---|---|
| GitHub | Holds the code (you already have this fork) | Free |
| [Vercel](https://vercel.com) | Hosts the app and the database | Free Hobby plan is enough |
| [ElevenLabs](https://elevenlabs.io) | The AI voice agent | Uses credits per call minute |
| [Twilio](https://twilio.com) | The phone line the agent calls from | Number rent + per-minute price |

### Step 1: Twilio phone number

1. Sign up at **twilio.com** and verify your email and phone.
2. **Upgrade the account** (add a payment method / credit). Trial accounts can only call numbers
   you verified yourself, so they can't call restaurants.
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
   access to **Agents** (read and write). Copy the key into Notes for a moment; you'll paste it into
   Vercel in step 4.
3. Import your Twilio number: **Agents** (Conversational AI) → **Phone Numbers** → **Import number**
   → **Twilio**. Enter a label (e.g. "Jarvis"), the phone number in +E.164 format, and your Twilio
   **Account SID** and **Auth Token**. Save.

You don't need to create the agent by hand. The app creates it for you in step 6.

### Step 3: Put the app on Vercel

1. Go to **vercel.com** → **Continue with GitHub**.
2. **Add New… → Project** → import your **openclaw** repository.
3. Before deploying, set **Root Directory** to `jarvis-food` (tap **Edit** next to it). The
   framework is detected as **Next.js**. Leave the build settings as they are.
4. Tap **Deploy**. The first deploy can fail because env vars are still missing. That's expected.

> **Which branch?** Vercel's production site follows the repo's default branch (`main`). The app is
> on the branch `claude/jarvis-food-app-9uzl1s`, so merge it into `main` in the GitHub app or website
> (open a pull request → **Merge**). Or, in Vercel, change the project's production branch to that
> branch. Other branches only get preview URLs, and those sit behind Vercel's own login.

### Step 4: Database (Neon, the new "Vercel Postgres")

1. In your Vercel project open **Storage** → **Create Database** → **Neon** (Postgres) → pick the
   free plan and the region closest to you (Frankfurt is good for Prague) → **Create**.
2. **Connect** it to the project for all environments. Vercel adds `DATABASE_URL` automatically.

You never run migrations. The app creates its tables the first time it starts.

### Step 5: Environment variables

In the Vercel project: **Settings → Environment Variables**. Add these for **Production** (and
Preview if you use it). Tick **Sensitive** for the secrets.

| Name | Value |
|---|---|
| `APP_PASSWORD` | Your login password, at least 10 characters. Use a long random one and save it in your iPhone Passwords app. |
| `ELEVENLABS_API_KEY` | The key from step 2 |

`DATABASE_URL` is already there from step 4. The full list of optional settings is in
[`.env.example`](.env.example).

Then redeploy: **Deployments** → newest deployment → **⋯** → **Redeploy**. Env var changes only
take effect after a redeploy.

### Step 6: First start (inside the app)

1. Open your app URL (shown in Vercel, like `https://your-project.vercel.app`) and log in.
2. **Settings → Your details:** enter your name, your phone (the courier calls it), your full
   delivery address (floor, door, name on the bell) and the payment method (cash, or card to the
   courier at the door). Check the max budget and tap **Save**.
3. **Settings → Voice agent:** tap **Create the voice agent**. Under **Caller number**, tap **Use**
   next to your Twilio number. All three rows should now show a ✓.

### Step 7: Add to the home screen

In Safari tap **Share → Add to Home Screen → Add**. Jarvis Food now opens full screen like an app.
You stay logged in for 30 days.

### Step 8: Test call to yourself

If your own phone has a Czech number, place a first order with **your number as the restaurant
phone**. Jarvis calls you and you can play the restaurant. Try saying a price over the budget and
check that it cancels.

### Optional: a native Czech voice

In ElevenLabs open **Voices → Voice Library**, filter by **Czech**, add a voice you like to **My
Voices** and copy its **Voice ID**. In Vercel add `ELEVENLABS_VOICE_ID` with that value and redeploy.
Then in the app tap **Settings → Update agent to the latest prompt**.

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

### The voice agent

Defined in [`lib/agent-config.ts`](lib/agent-config.ts) and created through the ElevenLabs API, either
by the in-app button or by [`scripts/create-agent.ts`](scripts/create-agent.ts):

- **Language:** Czech, multilingual TTS (`eleven_flash_v2_5`), with an English language preset and
  the `language_detection` tool so it can switch to English.
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
Update agent to the latest prompt**.

### Safety limits

All of these are enforced on the server, not only in the UI:

| Limit | How |
|---|---|
| Only after "Yes, call" | The call action only accepts a fresh `draft` order, and the claim is a single atomic database update. A double tap can't start two calls. |
| One call at a time | A unique database index allows only one order in `dialing`/`calling`. |
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
  fast redirect.
- API keys and the database URL live only in server env vars and never reach the browser. Pages
  send a strict Content-Security-Policy, `X-Frame-Options: DENY` and `noindex`.

**Locked out?** Wait for the lock to end. To unlock right away, open Neon (Vercel → Storage → your
database → **Open in Neon** → SQL Editor) and run:
`UPDATE auth_state SET failed_count = 0, locked_until = NULL;`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "ELEVENLABS_API_KEY is not set" | Add it in Vercel and **redeploy**. |
| "ElevenLabs 401" | The API key is wrong or lacks Agents access. Create a new key. |
| Caller number list is empty | Import the Twilio number in ElevenLabs (step 2.3), then reload Settings. |
| Call fails right away / "permission" | Twilio **Geo permissions** for Czech Republic (step 1.4), or the account is still a trial. |
| "Not confirmed" with "Nobody talked on the line" | No answer, busy line, or voicemail. Try later or tap **Call the restaurant yourself**. |
| App error page | Usually `DATABASE_URL` is missing. Connect the Neon database (step 4) and redeploy. |
| Agent speaks with an accent | Pick a native Czech voice (see "Optional: a native Czech voice"). |

---

## Development (on a computer)

```bash
cd jarvis-food
npm install
cp .env.example .env.local   # fill in values; DATABASE_URL can point at a local Postgres
npm run dev                  # http://localhost:3000
npm test                     # unit tests (phone rules, call result parsing, SQL params)
npm run typecheck
npm run build
npm run create-agent         # create the agent from the terminal (or: -- --update)
```

A `DATABASE_URL` on `localhost` uses the standard `pg` driver. Anything else (Neon) uses Neon's
serverless HTTP driver.

### Project layout

```
app/                 Next.js App Router pages
  (app)/             Logged-in screens: new order, orders/[id] (summary, live call, result),
                     history, settings
  login/             Password screen
  actions/           Server actions (auth, orders, settings). Each one checks the session.
  api/orders/[id]/   Polling endpoint for the live call screen
lib/
  agent-config.ts    The voice agent: prompt, variables, tools, data collection
  elevenlabs.ts      ElevenLabs API client (agents, phone numbers, outbound call, conversations)
  calls.ts           Starting calls (all safety checks) and syncing call status
  auth.ts            Password check, lockout, sessions
  db.ts, schema.ts   Postgres access and auto-created tables
  phone.ts           Czech number validation
scripts/create-agent.ts
proxy.ts             Redirects visitors without a session cookie to /login
```
