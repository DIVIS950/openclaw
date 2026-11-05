# Proclaim Student Hub

One app for school: Google Classroom, Gmail, Drive, Calendar and Tasks in one place, plus links to Dr Frost, Desmos, ActiveLearn and Canva, and an AI study buddy (Claude).

- **Today**: an AI summary of your day, your next lessons from Google Calendar, and what's due soon.
- **Homework**: Classroom work plus homework you add for other apps (it's saved in Google Tasks). Tick it off and it's ticked off in Google too.
- **Do it here**: write your Classroom work in the app. It saves as a Google Doc in your Drive as you type. **Hand in** attaches the Doc and turns it in when Google allows it; otherwise it opens Classroom for the last tap.
- **Study buddy**: an AI tutor that explains step by step, checks your work, quizzes you or summarises a topic. You can send it photos.
- **Post your notes**: photograph your notes and get a summary, flashcards, a quiz and 3 games (Match up, Speed round, Fill the gap), with XP and a daily streak. The summary is saved to your Google Drive.
- **Inbox**: Gmail and Classroom posts with an AI one-liner on each. Reply to emails from the app; replies send from your Gmail.

There's a **demo mode** with sample data, so you can try it before setting anything up.

## How sign-in works

You tap **Sign in with Google** and sign in on Google's own page. The app never sees your password. Google gives the app a key that lasts one hour, and you can remove the app's access at any time: Google Account › Security › Third-party apps & services.

## What you need

1. **Node.js 22 or newer** ([nodejs.org](https://nodejs.org)).
2. **A Google Client ID** (free). See below.
3. **A Claude API key** from [console.anthropic.com](https://console.anthropic.com). Using the AI costs a little money each time. You must be 18 or over to have an API account, so **ask a parent or guardian to create the account and key**, and to set a monthly spending limit in the console.

### Get a Google Client ID

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project (for example "Student Hub").
2. Open **APIs & Services › Library** and enable: **Google Classroom API**, **Gmail API**, **Google Drive API**, **Google Calendar API**, **Google Tasks API**.
3. Open **Google Auth Platform** (called "OAuth consent screen" in older menus):
   - App name: Proclaim Student Hub. Audience: **External**.
   - While the app is in **Testing**, add your own Google address under **Test users**. Only test users can sign in.
4. Open **Credentials › Create credentials › OAuth client ID**, type **Web application**.
   - Under **Authorised JavaScript origins** add `http://localhost:5173` (for testing on your computer) and later your real web address.
   - Copy the **Client ID** (it ends in `.apps.googleusercontent.com`).

**School accounts:** your school's IT admin decides whether outside apps can use school Google accounts. If you see "blocked by your admin", ask them to allow this app, or test with a personal Gmail account first.

Gmail access counts as a "restricted" permission for Google. That's fine for you and up to 100 test users. Opening the app to everyone would need Google's app verification.

## Run it on your computer

```bash
cd proclaim-student-hub
npm install
cp .env.example .env     # then put your GOOGLE_CLIENT_ID and ANTHROPIC_API_KEY in .env
npm run dev
```

Open http://localhost:5173. (`npm run dev` is for Mac/Linux; on Windows run `node --env-file-if-exists=.env --import tsx server/index.ts` in one terminal and `npx vite` in another.)

## Put it online and on your phone

```bash
npm run build
npm start                # serves the app and the AI on PORT (default 8787)
```

Host it on any service that runs Node.js (for example Render, Railway or Fly.io):

- Build command: `npm install && npm run build`. Start command: `npm start`.
- Set the environment variables from `.env.example` in the host's settings (never upload `.env`).
- Set `ALLOWED_EMAILS` to your own email (or `@yourschool.org`) so nobody else can spend your AI credit.
- Add the web address (for example `https://student-hub.onrender.com`) to **Authorised JavaScript origins** in Google Cloud.

On your phone, open the web address, then **Add to Home Screen** (Safari share menu on iPhone, Chrome ⋮ menu on Android). It opens full screen like a normal app.

## What Google does and doesn't allow

| Works in the app | Notes |
| --- | --- |
| Read Classroom work, due dates and posts | Your own classes only |
| Write your work as a Google Doc | Saved in a "Proclaim Student Hub" folder in your Drive |
| Turn in Classroom work | Google only allows this for work created by this app. For teachers' assignments the app opens Classroom so you can tap **Turn in** yourself. |
| Tick homework off | Saved in Google Tasks |
| Read and reply to Gmail | Replies send from your Gmail |
| Dr Frost, Desmos, ActiveLearn, Canva | They don't let other apps read your homework, so you add it yourself (the + button) and open the app from a link |

## For developers

- `src/`: React app. `src/lib/googleData.ts` talks to Google's APIs from the browser using the signed-in user's token.
- `server/`: a small Node server that serves the app and calls Claude. The Claude key stays on the server. Every AI request must carry a Google token for this Client ID, which the server checks with Google, plus an optional allow-list and a per-user rate limit.
- `shared/`: types and the revision-pack clean-up used by both.
- `npm run typecheck`, `npm test`, `npm run build`.
- The AI model defaults to `claude-opus-5`; set `CLAUDE_MODEL` to change it. If Claude declines a request, the API's server-side fallback automatically retries it on Anthropic's recommended fallback model.
