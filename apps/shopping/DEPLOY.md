# Put Orbit online (Vercel, free plan)

## 1. Get a Claude API key (for live prices)

1. Go to https://console.anthropic.com and sign up.
2. **Billing**: add a payment method and buy credits ($5 is plenty to start;
   one search costs roughly 1–5 cents).
3. **API Keys**: click **Create Key**, name it `orbit`, and copy it.
   It starts with `sk-ant-`. Keep it secret: don't paste it in chats or code.

## 2. Deploy

1. Go to https://vercel.com/signup and **Continue with GitHub**.
2. Click **Add New… → Project** and import **openclaw** (allow Vercel access to
   the repo if asked).
3. Configure:
   - **Root Directory**: `apps/shopping` (click *Edit* next to it)
   - **Framework**: Next.js (detected automatically)
   - **Environment Variables**:
     - `ANTHROPIC_API_KEY` = your key from step 1
     - `AUTH_SECRET` = any long random text (e.g. from https://generate-secret.vercel.app/32)
4. Click **Deploy**. After about 2 minutes you get a link like
   `https://orbit-xxxx.vercel.app`. That's your app, with live prices.

Vercel builds from the repo's default branch. To deploy the
`claude/ai-shopping-app-hkstdh` branch, either merge it first, or open
**Settings → Git** and set the Production Branch to that branch.

## 3. Optional: Google sign-in + Gmail parcels

1. https://console.cloud.google.com → create a project → **APIs & Services**.
2. **OAuth consent screen**: External, add your email as a test user.
   For Gmail, add the scope `gmail.readonly` and enable the **Gmail API**.
3. **Credentials → Create credentials → OAuth client ID** (Web application).
   Authorized redirect URI: `https://YOUR-APP.vercel.app/api/auth/callback/google`
4. In Vercel, add the environment variables `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
   and `ORBIT_GMAIL=1`, then **Redeploy**.
