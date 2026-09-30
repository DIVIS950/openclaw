# Put Orbit online

Orbit works as a personal shopper. A customer pays in Orbit (Apple Pay, Google
Pay or card), and the money is only **reserved**. You buy the item at the shop
with the customer's address, then press one button in the admin page: the
customer is charged and gets tracking updates. If you can't buy it, cancel and
the reservation is released.

You need four free accounts: **Vercel** (hosting), **Stripe** (payments),
**Anthropic** (AI) and **Upstash** (order storage, added inside Vercel).
Never paste secret keys into chats or code; only into Vercel's settings.

## 1. Anthropic (AI)
1. https://console.anthropic.com: sign up, then **Billing** (add about $5 credit).
2. **API Keys → Create Key**, and copy it (starts with `sk-ant-`).

## 2. Stripe (payments)
1. https://dashboard.stripe.com/register: sign up. Test mode works right away.
2. **Developers → API keys**: copy the **Publishable key** (`pk_test_…`) and the
   **Secret key** (`sk_test_…`).
3. To take real money later: **Activate account** (your details and a bank account),
   then use the live keys (`pk_live_…`, `sk_live_…`).

## 3. Vercel (hosting)
1. https://vercel.com/signup: **Continue with GitHub**.
2. **Add New → Project** → import **openclaw**.
3. **Root Directory**: `apps/shopping`.
4. **Environment Variables**: add
   - `ANTHROPIC_API_KEY`
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and `STRIPE_SECRET_KEY`
   - `AUTH_SECRET` (any long random text)
   - `ADMIN_PASSWORD` (your admin password)
5. **Deploy**. Vercel builds the default branch; to use the
   `claude/ai-shopping-app-hkstdh` branch, merge it or set it under
   **Settings → Git → Production Branch**.

## 4. Order storage (inside Vercel)
1. In your Vercel project: **Storage → Create → Upstash for Redis** (free plan),
   and connect it to the project. It adds the keys by itself.
2. **Deployments → … → Redeploy**, so the app picks up the new settings.

## 5. Stripe webhook and Apple Pay
1. Stripe: **Developers → Webhooks → Add endpoint**
   `https://YOUR-APP.vercel.app/api/stripe/webhook`, events
   `payment_intent.amount_capturable_updated` and `payment_intent.canceled`.
   Copy the signing secret (`whsec_…`) into Vercel as `STRIPE_WEBHOOK_SECRET`.
2. Stripe: **Settings → Payment methods → Payment method domains** → add
   `YOUR-APP.vercel.app`. That turns on Apple Pay (Google Pay works automatically).
3. Redeploy.

## 6. Try it
1. Open your app, search for something and buy it.
   - With test keys, pay with card `4242 4242 4242 4242`, any future date and any CVC.
   - Apple Pay test mode needs a real card in Apple Wallet; Stripe doesn't charge it.
2. Open `https://YOUR-APP.vercel.app/admin` and sign in with `ADMIN_PASSWORD`.
3. Under **Needs you**: open the product at the shop, buy it with the customer's
   address (**Copy address**), enter the shop's order number and the final price,
   then press **Placed at shop · charge customer**.
4. When the shop ships: add the carrier and tracking number.

Card reservations expire after about 7 days, so place or cancel orders quickly.
Customers can return online purchases within 14 days in the EU; refunds are made
in the Stripe dashboard.

## Optional: emails to customers
1. https://resend.com: sign up (free), verify your domain under **Domains**.
2. **API Keys → Create**, then in Vercel add `RESEND_API_KEY` and
   `ORBIT_EMAIL_FROM` (for example `Orbit <orders@your-domain.com>`), and redeploy.
   Customers then get an email when their order is reserved, placed, shipped,
   delivered or cancelled.

## Optional: Google sign-in + Gmail parcels
1. https://console.cloud.google.com: create a project, then **APIs & Services**.
2. **OAuth consent screen**: External, and add yourself as a test user. For Gmail,
   enable the **Gmail API** and add the `gmail.readonly` scope.
3. **Credentials → OAuth client ID** (Web). Redirect URI:
   `https://YOUR-APP.vercel.app/api/auth/callback/google`
4. In Vercel, add `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and `ORBIT_GMAIL=1`, then redeploy.
