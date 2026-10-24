# GZ AFL — Affiliate / Cashback Platform

An affiliate cashback web app (Shopee / TikTok Shop / Tiki / Lazada) made of two parts:

- **Frontend**: HTML + Tailwind CSS + plain JavaScript (`index.html`, `script.js`, `style.css`, `components/`). Tailwind is **pre-built into `tailwind.build.css`** — no CDN dependency, no Internet needed at runtime.
- **Backend**: Node.js + Express + SQLite (`backend/`) — handles accounts, orders, wallet, withdrawals and referral codes.

The backend also serves the frontend, so both run on **the same address** (`http://localhost:3000`). That lets the login session use an `httpOnly` cookie and removes the need to configure CORS.

---

## Requirements

- **Node.js >= 22.13** (the backend uses the built-in `node:sqlite` module, so no native module is needed).
  Node 22.5–22.12 also works but requires the `--experimental-sqlite` flag; **Node 24 LTS** is recommended.
- No separate database to install — SQLite is stored as a file.

Check the version:

```bash
node -v
```

---

## Running the app

```bash
cd backend
npm install
npm start
```

Then open: **http://localhost:3000**

> ⚠️ **Do not open `index.html` directly via `file://`** — the UI is loaded through `fetch()` and needs the backend; opening it that way gives you a blank page.

Run in auto-reload mode while editing code:

```bash
npm run dev
```

> Configuration (port, secret key, cashback provider...) is read from **`backend/.env`**.
> Copy `backend/.env.example` to `backend/.env` and edit it. That file is already git-ignored.

### UI (Tailwind CSS)

The CSS is already built into `tailwind.build.css` and committed to the repo, so **running the app needs no build step**.

You only need to rebuild when you **add/change Tailwind classes** in `index.html`, `script.js`, `admin.js` or `components/*.html`:

```bash
npm install        # first time only (installs Tailwind for the UI part)
npm run build:css  # rebuilds tailwind.build.css
```

While working on the UI you can let it rebuild on every save:

```bash
npm run watch:css
```

> If you forget to rebuild, the new classes will **have no effect** (the UI looks unstyled) — that is the trade-off for dropping the CDN.

### Language (VI / EN)

The language switch sits in the top-right of the home page navbar, and the choice is saved in `localStorage`, so it survives a page reload.

- Translated: home page, login / sign-up / forgot-password / reset-password modals, and the guide modal.
- Not translated yet: the in-app pages and the support assistant (chatbot) — they still use Vietnamese.
- Adding a new string: declare the key in **both** `vi` and `en` in `i18n.js`; use `data-i18n` in HTML and `tr('key')` in JS.

### Light / dark theme

- The theme toggle sits next to the language switch in the top bar (home page) and in the header of the logged-in area.
- The first time the site is opened, the theme follows the system setting (`prefers-color-scheme`). After the user clicks the toggle, the choice is stored in `localStorage` under the key `gzafl_theme` and survives a reload.
- `theme.js` is loaded right inside `<head>` so `class="dark"` is applied to `<html>` **before** CSS paints, which avoids a white flash when reopening in dark mode.
- Adding the toggle elsewhere: use the same markup `<button type="button" data-action="toggle-theme" data-theme-toggle>…</button>`; the label and `aria-pressed` state are updated by `theme.js` automatically.
- All dark-mode CSS lives at the end of `style.css`, keyed on `html.dark`. When you add new Tailwind colour classes, remember to add the matching rule (use `:where(html.dark)` so hover/focus states are not broken).
- The theme choice is synced across open tabs of the same browser.

### Environment variables (optional)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Set to `production` to enable strict security checks |
| `JWT_SECRET` | `gzafl-dev-secret-change-me` | Signing key for session tokens — **must be changed for a real deployment**. In `NODE_ENV=production` the server **refuses to start** if the key is empty, still the default, or shorter than 32 characters |
| `SSL_KEY_PATH`, `SSL_CERT_PATH` | – | Fill these in to have the server run HTTPS itself (not needed if you already use Nginx/Caddy) |
| `TRUST_PROXY` | – | Enable when running behind a reverse proxy (`1` / `true` / a list of IPs) — required so the `secure` cookie and cashback links use `https` correctly |
| `PUBLIC_BASE_URL` | – | Full public URL, e.g. `https://gzafl.example.com`. Used for cashback links and postback instructions. **Required when `NODE_ENV=production`** (the server will not start without it) so links are never built from the client-supplied Host header |
| `COOKIE_SECURE` | based on `NODE_ENV` | Overrides the `secure` flag of the session cookie |
| `DB_PATH` | `backend/data/gzafl.sqlite` | Database file path |
| `WITHDRAWAL_MIN` | `1000` | Minimum available balance required to send a withdrawal request (VND) |
| `AFFILIATE_PROVIDER` | `mock` | Link-conversion provider: `mock` / `accesstrade` / `shopee` |
| `AFFILIATE_LIVE_PLATFORMS` | all | Restrict which platforms use the real API, e.g. `TikTok Shop, Tiki`. The remaining platforms fall back to test links; every order stores `affiliate.isReal` so the UI clearly shows **real link** vs **no commission attached** |
| `AFFILIATE_SUB_ID_PREFIX` | `gzafl` | Prefix for the `sub_id` added to links, used to tell whose commission it is |
| `CASHBACK_RATE` | `1` | Cashback share for the user versus the **network-approved** commission (`0.7` = pay back 70%, keep 30%). Only applies to money reported automatically by the network; this number is printed at startup, so check it before going live |
| `ACCESSTRADE_API_KEY` | – | AccessTrade API token |
| `ACCESSTRADE_CAMPAIGN_SHOPEE` / `_TIKTOK` / `_TIKI` / `_LAZADA` | – | Per-platform campaign IDs (kept **as strings**) |
| `ACCESSTRADE_CAMPAIGN_ID` | – | Optional: fallback campaign if a platform has no dedicated variable |
| `ACCESSTRADE_SHORT_DOMAIN` | – | Optional: your own short domain registered with AccessTrade |
| `POSTBACK_SECRET` | – | Authentication key for conversion reports (postbacks). **If empty, every postback is rejected** (see [Receiving commissions](#receiving-commissions--postback-reconciliation)) |
| `POSTBACK_PARAM_*` | auto-detected | Force the network's parameter names: `_SECRET`, `_TRANSACTION`, `_PRODUCT`, `_CONVERSION`, `_REWARD`, `_STATUS`, `_SUB`, `_ORDER_CODE` |
| `POSTBACK_LOG_KEEP_DAYS` | `90` | How long to keep **rejected** postback logs (wrong key / processing error) before the startup cleanup deletes them. Logs that matched an order are financial records and are never deleted automatically |
| `EMAIL_OTP` | `auto` | Email verification step: `auto` (on when SMTP is configured, or when running `development`) / `on` / `off`. Applies to **sign-up**, **forgot password** and **email changes**. In production, email verification is **mandatory** (see `ALLOW_UNVERIFIED_EMAIL`) |
| `ALLOW_UNVERIFIED_EMAIL` | – | Only set to `1` when you truly have no SMTP: lets production start even though sign-up emails are **not verified** (accepting the risk that someone registers with someone else's email) |
| `LOGIN_OTP` | `auto` | Verification step at **login**: `auto` (on when `EMAIL_OTP` is on **and** mail can be sent) / `on` (always required) / `off` (password only). The "rescue" switch for when the mail server breaks |
| `DEV_OTP_CODE` | – | `1` = have the API return the OTP in a `devCode` field (only in test mode, without SMTP). Defaults to **off** so codes are not leaked if you forget `NODE_ENV=production` |
| `SECURITY_ALERT_THRESHOLD` | `10` | Number of failed logins within the window below before an alert is created for the admin. **Never auto-locks the account** |
| `SECURITY_ALERT_WINDOW_MINUTES` | `15` | Counting window for failed logins (minutes) |
| `SECURITY_AUTO_HOLD_HOURS` | `0` | `0` = alert only, admin decides (recommended). `24` = auto-hold the account for 24 hours after the alert threshold; the admin can still release it. Maximum `168` |
| `SECURITY_STEP_UP` | `on` | When an account has an unresolved alert, the next successful password login must also enter an OTP (if an email exists and mail can be sent). Set to `off` to disable |
| `SECURITY_STEP_UP_HOURS` | `24` | How long an alert stays effective for requiring the extra OTP |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | – | Mail server used for verification codes. If `SMTP_SECURE` is blank it is inferred (`true` for port `465`) |
| `SMTP_USER`, `SMTP_PASS` | – | Sending account (for Gmail use a 16-character *App Password*) |
| `MAIL_FROM`, `MAIL_FROM_NAME` | based on `SMTP_USER`, name `GZ AFL` | Sender address and name shown on emails |
| `SUPPORT_EMAIL`, `SUPPORT_ZALO` | – | Contact details shown on the Help page (if blank, defaults from `components/guide.html` are used) |
| `AI_API_KEY` | – | API key for the **support assistant (chatbot)**. If blank, the assistant answers from the built-in script in `backend/lib/supportKnowledge.js`. Fill it in to have the assistant answer with AI (see [Support assistant (chatbot)](#support-assistant-chatbot)) |
| `AI_BASE_URL`, `AI_MODEL` | guessed from the key | API endpoint and model name (OpenAI standard). Only needed when you want to pin a provider explicitly |
| `AI_ENABLED` | `true` | `off` to temporarily disable AI (keeping the key) without deleting the config |
| `AI_TIMEOUT_MS`, `AI_MAX_TOKENS`, `AI_TEMPERATURE` | `25000`, `4096`, `0.4` | Maximum wait time, answer length and "creativity". If the AI is still cut off by the token limit, the server automatically calls it again up to 2 times to finish the answer |
| `AI_DAILY_LIMIT` | `800` | Cap on the **total** number of AI calls per day (all IPs combined). Past the cap the assistant still answers, but from the built-in script. `0` = unlimited |

> **No email account yet?** Just leave it blank. When running `development`, the verification step is still on but **emails are only printed to the server console** (the code is also returned in the API) so you can try it immediately — see [Email verification (OTP)](#email-verification-otp).

Generate a random `JWT_SECRET`:

```bash
cd backend
npm run gen-secret              # prints only
npm run gen-secret -- --write   # writes straight into backend/.env
```

> Changing `JWT_SECRET` invalidates every current login session — people simply need to log in again.

---

## Structure

```
index.html                 # Page shell + withdrawal modal
style.css                  # Hand-written shared CSS
tailwind.build.css         # Built Tailwind CSS (do NOT edit by hand - see "UI")
package.json               # CSS build tooling (not the server runtime package)
tailwind.config.js         # Tailwind config: where it scans for class names
styles/tailwind.css        # Tailwind source file
styles/inter-variable.woff2 # Self-hosted Inter font (no Google Fonts dependency)
styles/Inter-LICENSE.txt   # SIL Open Font License for Inter
script.js                  # All frontend logic (API calls)
i18n.js                    # VI/EN translation set for home page + auth (saves choice in localStorage)
theme.js                   # Light/dark toggle (loaded in <head>, saved in localStorage)
lucide.min.js              # Self-hosted icon library (not loaded from unpkg/CDN)
admin.js                   # Logic specific to the admin page (loaded only there)
support.js                 # Support assistant (chatbot) widget logic, bottom-right
assets/flags/              # SVG flags (Vietnam, United Kingdom) for the language switch
components/                # UI fragments (landing, sidebar, header, pages...)
  admin.html               # Admin page UI
  support-widget.html      # Chat window + round button of the support assistant
  guide.html               # Help / Terms content (used both in-app and in the home page modal)
LOGO.png                   # Brand logo (left menu + home top bar + favicon)
CHATBOT.png                # Support assistant logo (round button + chat header)
README.md
docs/                      # Technical documentation
  affiliate-integration.md # Design of the cashback link conversion (details + options)
  deployment.md            # Production guide (HTTPS, JWT_SECRET, Nginx, PM2...)
deploy/                    # Ready-made deploy config: Nginx, systemd, PM2, Docker, Windows
  README.md                # Choosing a deploy method + pre-launch checklist
  scripts/install-app.sh   # First-time install on Ubuntu/Debian (Node, env, systemd)
  scripts/deploy.sh        # Update to a new release (pull, install, backup, restart, health check)

backend/
  server.js                # Express bootstrap: API + short links /r/<order code> + static frontend
  db.js                    # SQLite connection + table creation + automatic column upgrades + `db.transaction()`
  package.json
  .env.example             # Config template - copy to .env and fill in
  scripts/
    make-admin.js          # Grant / revoke admin rights from the CLI
    reset-password.js      # Reset a password when forgotten / locked out
    generate-secret.js     # Generate a random JWT_SECRET
    start-prod.js          # Start in production mode (works on Windows)
  lib/
    env.js                 # Loads backend/.env + shared config flags
    auth.js                # JWT, session cookie, requireAuth / requireAdmin middleware
    constants.js           # Order/withdrawal statuses, roles, minimum withdrawal
    validate.js            # Email/phone validation, order/referral code generation
    serialize.js           # DB data -> JSON for the frontend
    format.js              # Vietnamese-style date/money formatting
    rateLimit.js           # Request limiting for login APIs
    banks.js               # Bank / e-wallet list for the withdrawal dropdown
    affiliate.js           # Product link -> cashback link (mock / accesstrade / shopee)
    postback.js            # Receive & process conversion reports from affiliate networks (dedupe, accumulate per order)
    mailer.js              # Send email via SMTP (prints to console when unconfigured in dev)
    otp.js                 # Generate / verify email verification codes (OTP) for sign-up and password reset
    notify.js              # Write notifications for users
    supportKnowledge.js    # Knowledge base of the support assistant (used by both AI and scripted mode)
    ai.js                  # Calls an OpenAI-compatible AI API (Gemini / Groq / OpenRouter / OpenAI...)
  routes/
    auth.js                # Sign-up (2 steps with verification code) / login / logout / me / forgot password
    orders.js              # List + create orders (with link conversion)
    wallet.js              # Wallet stats + withdrawals
    referral.js            # Referral code + redeem
    profile.js             # Update profile, avatar, payout QR image + change password
    notifications.js       # Notification list + mark as read
    support.js             # Support assistant: receives questions, answers with AI or scripts
    admin.js               # Admin API (only role = 'admin')
  data/                    # SQLite file (auto-created, git-ignored)
  uploads/                 # Avatars + payout QR images uploaded by users
```

---

## Email verification (OTP)

On sign-up, the system sends a **6-digit code** to the email address the user entered; the account is only created once the correct code is entered. The same mechanism lets guests **reset their own password** when forgotten, and doubles as **two-factor authentication at login**.

- **Email is required at sign-up**, even when logging in with a phone number.
- **The email used as the login name must match the email that receives the verification code.** Otherwise someone else could "reserve" your email with a different address. Emails are also lowercased and **cannot be used by two accounts**.
- **Changing the email on the Profile page also requires verification**: the code is sent to the *new address* before it is saved, so the recovery email is always a real address. Changing only the name/phone number needs no code.
- **Two-step login** (when `LOGIN_OTP` is on): the server only sends a code after the password is correct, and only then issues a session. If a code is still valid, the **existing code is reused** — logging out and straight back in does not cost an extra email.
- Codes are valid for **10 minutes**, are **single-use**, and are stored as a **bcrypt hash** (the raw code is not stored). A code from one flow **cannot be used** for another flow.
- After **5** wrong entries you must request a new code; each new request must wait **60 seconds**, with a maximum of **5 codes/hour** per email.
- Each IP may request codes **10 times / 15 minutes** (sign-up & password reset) and **40 times / 15 minutes** (login).
- The request-code step **always returns the same message** whether or not the account exists — outsiders cannot probe the account list.
- If someone tries to **sign up again** with an existing email/account: the system does **not send a sign-up code** and **does not create a new account**, but sends an *"account already exists — please log in or use Forgot password"* email to **the account owner's registered email** (never to the stranger's newly entered address), at most **1 email / 30 minutes**. That way the owner knows, while the prober still learns nothing.

### No email account yet?

`EMAIL_OTP=auto` (the default) behaves like this:

| Situation | Result |
|---|---|
| `development`, no SMTP configured | The verification step is **still on**, but emails are only **printed to the server console**. To see the code in the yellow "test code" box in the UI, also set `DEV_OTP_CODE=1` (off by default to avoid leaking codes through the API) |
| `production`, no SMTP configured | The server **refuses to start** (see the explanation below) |
| `SMTP_*` + `MAIL_FROM` filled in | Real emails are sent |

If you want to decide yourself, set `EMAIL_OTP=on` (always on) or `EMAIL_OTP=off` (always off).

> **Why is email verification mandatory in production?** Sign-up always requires an email
> (to receive password-recovery codes). If nobody can verify that address, people could
> sign up with **someone else's email**, reserve it so the real owner cannot register,
> and that email would also count as the account's password-recovery channel.
>
> If you truly cannot set up SMTP and accept the risk, set
> `ALLOW_UNVERIFIED_EMAIL=1` so the server still starts (with a warning in the log).
> `npm run check:deploy` also reports this configuration as an **error**.

The **login** verification step has its own switch, `LOGIN_OTP`:

| `LOGIN_OTP` | Result |
|---|---|
| `auto` *(default)* | On when `EMAIL_OTP` is on **and** mail can be sent. Without SMTP, login still needs only the password — **this avoids locking every user out** |
| `on` | The code is always required. WARNING: without SMTP configured, **nobody can log in** |
| `off` | Login needs only the password. Use it when the mail server breaks |

> **Note on mail quotas**: every login costs one email. A personal Gmail account allows only ~**500 emails/day** (free Brevo ~300/day). If daily logins are high, switch to a dedicated mail service or set `LOGIN_OTP=off`.

### Security alerts on failed logins

The system **never permanently locks an account** after many failed logins. After `SECURITY_ALERT_THRESHOLD` failures within `SECURITY_ALERT_WINDOW_MINUTES` minutes:

- A **security alert** is created under **Admin → Security** (with a red badge). Alerts merge consecutive failures and record the login name, the most recent IP and the timestamp.
- If `SECURITY_STEP_UP=on` and the account has an email and mail can be sent, the next login with the **correct password** also requires an OTP. This is extra verification, not a lock.
- The admin can **Resolve**, **Hold for 24h**, or **Release**. A hold blocks both new logins and active sessions; it lifts automatically when it expires.
- The default is `SECURITY_AUTO_HOLD_HOURS=0`: alert only. To have the system hold automatically after the threshold, set `24`; admin accounts are exempt.

### Mail configuration

Fill in `backend/.env` — a template is available in `backend/.env.example`. For Gmail: turn on 2-step verification, create a 16-character **App Password** and use it as `SMTP_PASS`.

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-name@gmail.com
SMTP_PASS=abcd efgh ijkl mnop
MAIL_FROM=your-name@gmail.com
MAIL_FROM_NAME=GZ AFL
```

For better inbox placement than Gmail, use Brevo (`smtp-relay.brevo.com`, free 300 emails/day).

### Two ways to reset a forgotten password

1. **Self-service (default)**: the customer clicks **"Forgot password?"** → receives a code by email → enters the code plus a new password. Done immediately, no admin needed.
2. **Ask the admin (fallback)**: for accounts **without an email**, when the system cannot send mail yet, or when the customer does not receive the email. Requests land in the **Password resets** tab of the admin page.

A successful reset through either path also **closes** any pending request from the other path and invalidates **all old login sessions**.

---

## Support assistant (chatbot)

The bottom-right corner of **every page** (including the home page for guests) has a round button that opens a support chat window:

- Answers common questions: creating orders/getting cashback links, how long commissions take to be recorded, **orders awaiting admin approval**, **commission reversals/negative balances**, withdrawals (minimum amount, QR image), OTP codes, inviting friends, security...
- A **"Contact support"** button right in the chat window shows the phone/Zalo number and email (from `SUPPORT_ZALO`, `SUPPORT_EMAIL`) with a copy button.
- **Suggested questions** sit above the input box — click one to ask it.
- **Conversation memory**: chat history is stored in the browser (`localStorage`) and survives a reload. The server does **not** store chat content.
- To change the assistant image: replace `CHATBOT.png` in the project root (square image, dark background) — it is used both for the round button and the logo at the top of the chat window.

### Two modes

| Mode | When | How it answers |
|---|---|---|
| **Scripted** | `AI_API_KEY` not set | Matches keywords in the question (with or without Vietnamese diacritics) against the knowledge base in `backend/lib/supportKnowledge.js`. Free, no Internet needed |
| **AI** | `AI_API_KEY` set | Calls an OpenAI-compatible AI API with a `system prompt` containing that same knowledge base, so it does not invent extra policies |

If the AI fails (bad key, quota exhausted, network down), the assistant **falls back to scripted mode** so the customer still gets an answer.

### Enable the AI assistant (pick one provider)

Just fill in `AI_API_KEY` in `backend/.env` and **restart the server** — the system guesses the provider from the key prefix and prints it at startup. To be certain, also fill in `AI_BASE_URL` + `AI_MODEL`:

| Provider | `AI_BASE_URL` | Suggested `AI_MODEL` | Notes |
|---|---|---|---|
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.5-flash-lite` | Free tier available — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (keys of the form `AIza...` or `AQ....` both work). Use `gemini-3.5-flash` if you need higher quality |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | Free tier available — [console.groq.com/keys](https://console.groq.com/keys) |
| OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct:free` | Free models available — [openrouter.ai/keys](https://openrouter.ai/keys) |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | Paid |

Quick check after restarting:

```bash
curl http://localhost:3000/api/support/status
# {"ai":true,"dailyLimit":800,"usedToday":0,"remainingToday":800,"suggestions":8}
```

> The API only reports on/off status and quota, and does **not** expose the AI provider, model name or internal URL.

> The API key **stays on the server** and is never sent to the browser. Each IP may send at most **30 messages / 10 minutes** (anti-spam, and to avoid burning through the API key quota). To temporarily disable AI while keeping the key: set `AI_ENABLED=off`.

### Want better answers?

Edit the content of `backend/lib/supportKnowledge.js` — that file is the **single source** for both modes (AI mode reads it in the `system prompt`, scripted mode matches keywords against it). Adding a question to `SUGGESTIONS` adds another suggestion button to the chat window.

---

## API

All APIs live under `/api` and return JSON. APIs that require login use the session cookie.

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server liveness check |
| GET | `/api/config` | Public config for the UI (support contact details, whether email verification is on, assistant suggested questions) |
| POST | `/api/auth/register/otp` | Sign-up step 1: send a verification code `{ username, name, email }` (limit 10 / 15 minutes) |
| POST | `/api/auth/register` | Step 2: create the account `{ username, password, name, email, otp }` |
| POST | `/api/auth/login` | Log in. If login verification is on, returns `{ otpRequired: true, ticket, email, resendInSeconds, devCode }` instead of setting a cookie (`devCode` only when `DEV_OTP_CODE=1`) |
| POST | `/api/auth/login/otp` | Login step 2: `{ ticket, otp }` → sets the session cookie (limit 40 / 15 minutes) |
| POST | `/api/auth/login/otp/resend` | Resend the login code `{ ticket }` (no need to re-enter the password) |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/me` | Current user (`null` if not logged in; `423` with `code: 'security_hold'` if the account is on hold) |
| POST | `/api/auth/forgot-password/otp` | Forgot password step 1: send a verification code `{ username }` |
| POST | `/api/auth/forgot-password/confirm` | Forgot password step 2: `{ username, otp, newPassword }` |
| POST | `/api/auth/forgot-password` | Fallback path: send a request to the admin `{ username, note }` |
| GET | `/api/orders` | Your order list (with cashback link, `sub_id`, click count) |
| POST | `/api/orders` | Create an order `{ link }` → returns `{ order, affiliate }` with the cashback link |
| GET | `/api/wallet` | Wallet stats, dashboard `insights` (current month, 6-month series, commission per platform), withdrawal history, `minWithdraw`, `canWithdraw` |
| POST | `/api/wallet/withdrawals` | Request a withdrawal. Choose one of two: `{ mode: 'account', bank, accNum, accName }` or `{ mode: 'qr' }` (uses the uploaded QR image, no bank/account number needed) |
| DELETE | `/api/wallet/withdrawals/:code` | Cancel your own `Đang xử lý` withdrawal and return the amount to the available balance |
| GET | `/api/referral` | Referral code, points, redemption history |
| POST | `/api/referral/redeem` | Redeem a referral code `{ code }` |
| GET | `/api/notifications` | Notification list + unread count |
| POST | `/api/notifications/read-all` | Mark all notifications as read |
| POST | `/api/support/chat` | Ask the support assistant `{ messages: [{ role: 'user'\|'assistant', content }] }` → `{ reply, source: 'ai'\|'faq', notice? }`. No login needed, limit 30 / 10 minutes per IP |
| GET | `/api/support/status` | Check whether the assistant is in AI or scripted mode (used when configuring `AI_*` in `.env`) |
| PUT | `/api/profile` | Update the profile `{ name, email, phone }`. If you **change the email** while verification is on, you must include `emailOtp` |
| POST | `/api/profile/email/otp` | Send a verification code to the **new email** when changing it `{ email }` (limit 10 / 15 minutes) |
| POST | `/api/profile/avatar` | Update the avatar `{ dataUrl }` |
| POST | `/api/profile/bank-qr` | Save the **payout QR image** `{ dataUrl }` — only PNG/JPG, max 2MB (the server also checks the leading byte signature) |
| DELETE | `/api/profile/bank-qr` | Delete the saved payout QR image |
| PUT | `/api/profile/password` | Change the password `{ currentPassword, newPassword }` (max 10 / 15 minutes) |

Beyond `/api`, the server also exposes one public path:

| Method | Path | Description |
|---|---|---|
| GET | `/r/:code` | Short cashback link — counts the click, then redirects (302) to the target link |
| GET/POST | `/api/postback/:provider` | **Conversion report endpoint** from affiliate networks (AccessTrade calls it with GET). Does not use the session cookie; authenticated with `POSTBACK_SECRET`. Returns `403` on a wrong key, `503` when unconfigured, `200` once recorded (including duplicate calls) |

### Admin API (`/api/admin`)

Every API below **requires an account with `role = 'admin'`**. Anonymous callers get `401`, regular users get `403`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/overview` | System-wide stats (users, orders, withdrawals, money, pending password-reset requests) |
| GET | `/api/admin/users` | User list (`q`, `limit`, `offset`) |
| PATCH | `/api/admin/users/:id` | Change `{ role, points }` |
| DELETE | `/api/admin/users/:id` | Delete a user (also deletes their orders/withdrawals/referral history) |
| GET | `/api/admin/security-alerts` | Security alerts (`status` = `new`/`resolved`/`all`, `q`, `limit`, `offset`) |
| POST | `/api/admin/security-alerts/:id/resolve` | Mark an alert as resolved `{ note }` |
| POST | `/api/admin/security-alerts/:id/hold` | Hold the account linked to an alert `{ hours }` (default 24) |
| POST | `/api/admin/users/:id/security-hold` | Hold an account directly `{ hours }` |
| DELETE | `/api/admin/users/:id/security-hold` | Release an account |
| GET | `/api/admin/orders` | Order list (`status`, `q`, `limit`, `offset`) |
| PATCH | `/api/admin/orders/:code` | Change `{ status, commission }` |
| GET | `/api/admin/withdrawals` | Withdrawal list (`status`, `q`, `limit`, `offset`) |
| PATCH | `/api/admin/withdrawals/:code` | Change `{ status, amount }`. `Đã thanh toán` / `Đã huỷ` are final: further edits return `409` |
| GET | `/api/admin/referrals` | Referral redemption history (`limit`, `offset`) |
| GET | `/api/admin/postbacks` | **Reconciliation log**: every time a network called the postback endpoint (`q`, `status` = `pending`/`approved`/`rejected`, `only` = `matched`/`unmatched`/`refused`, `limit`, `offset`) + aggregate stats |
| POST | `/api/admin/postbacks/:id/reapply` | Reprocess an old log (e.g. a postback that arrived before the order was created) |
| GET | `/api/admin/password-resets` | Password-reset request queue (`status`, `limit`, `offset`) |
| POST | `/api/admin/password-resets/:id/reset` | Reset the password, returning `tempPassword` **exactly once** (not stored in the DB) |
| POST | `/api/admin/password-resets/:id/cancel` | Reject a reset request |

Valid statuses:

- Orders: `Đang xử lý` (processing) → `Chờ đối soát` (awaiting reconciliation) → `Chờ admin duyệt` (awaiting admin approval) → `Hoàn thành` (completed) → `Đã thanh toán` (paid), or `Đã huỷ` (cancelled).
- Withdrawals: `Đang xử lý` (processing) → `Đã thanh toán` (paid), or `Đã huỷ` (cancelled).

> `Chờ đối soát` = the affiliate network **has recorded** the conversion but has not approved it yet. `Chờ admin duyệt` = the network approved it and the system writes the **expected** commission into `commission` but **does not add it to the balance**; only when the admin approves the order (moving it to `Hoàn thành`/`Đã thanh toán`) does the money enter the wallet.

**How money is calculated:** a user's wallet balance = the sum of `commission` across **non-cancelled** orders − the sum of `amount` across **non-cancelled** withdrawals. So marking something `Đã huỷ` removes that order/withdrawal from the calculation, and when moving a withdrawal to `Đã thanh toán` you must enter the actual amount paid (it may not exceed the available balance).

**Withdrawals:** users do not type an amount — the system records the **entire available balance** at the time of the request. That amount is **reserved** right away, so it cannot be withdrawn twice. The server-side rules (`backend/routes/wallet.js`):

- Available balance = total commission from **admin-approved** orders − money already withdrawn. Orders in `Chờ đối soát` or `Chờ admin duyệt` are **not part of the balance**.
- The available balance must reach the `WITHDRAWAL_MIN` minimum (default **1,000 VND**) — otherwise `400` is returned with the shortfall.
- Each account may have only **one** `Đang xử lý` withdrawal; a second one returns `409`.
- The customer can **cancel their own** `Đang xử lý` withdrawal (`DELETE /api/wallet/withdrawals/:code`) — useful when they entered the wrong account. The reserved money returns to the available balance immediately.
- If the network reports a cancellation/refund after the customer has withdrawn, the system records a **reversal** and the balance may go negative. The negative amount is a **debt to be recovered**, automatically deducted from the next commission; the wallet and admin page both show it clearly.
- Bank/e-wallet is chosen from the list in `backend/lib/banks.js` (about 50 banks and e-wallets, shown in the dropdown and in `GET /api/config`). Users can also pick **"Other bank"** and type the name themselves (max 60 characters).
- Users **choose one of two** payout methods, not both:
  - **Enter an account number**: bank/e-wallet + `accNum` + `accName` are required.
  - **Payout QR image**: only the QR image is needed (**PNG/JPG** only, max 2MB) — no bank, account number or account holder name, because the QR already carries them. The admin scans the QR to transfer the money.
  - The QR image is **snapshotted** into the withdrawal at request time, so changing the image later does not alter old withdrawals; the image file is only deleted once **no withdrawal** references it anymore.
- Cancelling a withdrawal (`Đã huỷ`) **returns** the money to the available balance.
- `Đã thanh toán` and `Đã huỷ` are **final states**: neither the customer nor an admin can edit them (`409`). This keeps the payout history auditable — adjust with a new entry instead of rewriting the past.
- The admin can adjust the actual amount paid when marking `Đã thanh toán`, but it may not exceed the available balance.

### Affiliate link conversion

When a user creates an order, the server calls `backend/lib/affiliate.js` to turn the product link into a purchase link **carrying the user's `sub_id`** (the key to knowing whose commission it is), then stores both the original link and the cashback link on the order.

Choose the provider with `AFFILIATE_PROVIDER`:

| Value | Status | Notes |
|---|---|---|
| `mock` (default) | ✅ works right away | Returns an internal link `http://localhost:3000/r/<order code>`. Clicking it counts the click and redirects to the original link. **It does not generate real commission** — commission is still settled manually by the admin. |
| `accesstrade` | ✅ TikTok Shop and Tiki are live; Shopee/Lazada awaiting campaign approval | Requires `ACCESSTRADE_API_KEY` + a campaign ID per platform (`ACCESSTRADE_CAMPAIGN_SHOPEE` / `_TIKTOK` / `_TIKI` / `_LAZADA`). Written against the official docs (`POST /v1/product_link/create`), attaching `sub1 = gzafl-u<id>` (user) and `sub2 = <order code>` (order). |
| `shopee` | ⛔ not implemented | Requires `SHOPEE_AFFILIATE_APP_ID` + `SHOPEE_AFFILIATE_SECRET`, and the request-signing scheme must be checked against the official docs before use. |

> ⚠️ **Commission cannot be created just by appending parameters to a link.** For real tracking you need an approved affiliate account and to call the API they provide. See the full analysis in **[docs/affiliate-integration.md](docs/affiliate-integration.md)**.

If the provider call fails, the order **is still created** with the original link (users are not blocked) — it simply has no commission tracking.

### Receiving commissions — postback reconciliation

When an affiliate network reports a purchase, it calls:

```
GET /api/postback/accesstrade    ← register this URL in the network's dashboard
```

The flow (source: `backend/routes/postback.js` + `backend/lib/postback.js`):

1. **Authenticate** `POSTBACK_SECRET` (SHA-256 hash compared with `timingSafeEqual`). Wrong → `403`, and the call is **still logged** — but at most **10 rejected logs per IP per 15 minutes** (the rest are dropped) so a stranger cannot flood the SQLite file that holds the money data. Rejected logs older than `POSTBACK_LOG_KEEP_DAYS` (default 90) are deleted at startup. Secret unconfigured → `503` (no data of unknown origin is accepted).
   - Safest option: send the key in the `X-Postback-Secret` header (it never appears in the URL, so it does not leak into proxy/CDN access logs). If the header is present, only the header is considered.
   - Common option: add a `secret=<POSTBACK_SECRET>` parameter to the URL registered with the network (rename it with `POSTBACK_PARAM_SECRET`). In that case configure the proxy not to log query strings and rotate the key periodically.
2. **Record the received parameters** into the `postback_logs` table **before** processing — only with a log can disputes be reconciled later. `POSTBACK_SECRET` and sensitive parameters (`token`, `signature`...) are **masked** before being stored and before being shown on the admin page.
3. **Dedupe** by `payload_hash`: an identical retry only increases the receive count and **does not add the money twice**.
4. **Find the order**: `sub1 = gzafl-u<id>` → user; `sub2 = <GZ… order code>` → the exact order; if missing, look up by the stored transaction ID, and finally fall back to that user's most recent order.
5. **Accumulate per order** (each product takes its **latest** status), then update:
   - network reports **not approved** → order becomes **"Chờ đối soát"**, the money sits in `network_commission`, **not in the balance**;
   - network reports **approved** → order becomes **"Chờ admin duyệt"**, writing `commission = approved amount × CASHBACK_RATE` as the **expected** figure; only when the admin approves does that amount enter the wallet;
   - network reports **cancelled/refunded** → order becomes **"Đã huỷ"**, the commission goes to 0 and the **reversed** amount is written to `commission_reversed`.
6. **Always return `200` quickly** (networks only retry up to 3 times). For orders already **"Đã thanh toán"**, the order status is left unchanged, but if the network reports a cancellation/reduction the system still records the reversal and the negative balance (debt) — it never increases money on an extra network report.

> AccessTrade sends **one call per product** (a 3-item order = 3 postbacks with the same transaction ID), so total commission is accumulated per order.

Parameter names are set by the user in the network dashboard, so the system **auto-detects** them (`transaction_id`, `product_id`, `reward`, `status`, `sub1`...) and also **scans every value** for `gzafl-u<id>` / `GZ…` patterns. For anything unusual, force them with `POSTBACK_PARAM_*` in `.env`.

See every call (including wrong-key calls and calls that matched no order) and click **Reprocess** in **admin page → Reconciliation tab**. Rejected logs (wrong key) **cannot** be reprocessed, and an order's total commission only sums logs matching that order's **transaction ID** (when the order has no transaction ID yet, logs without a transaction ID are summed).

A prerequisite you should not skip: **ask the intermediary network whether their terms allow a cashback-to-buyer model** — many affiliate programs forbid it and may close the account and claw back money already paid.

### Database schema

| Table | Contents |
|---|---|
| `users` | Accounts: `username`, `password_hash` (bcrypt), personal info, referral code, points, `role` (`user`/`admin`), `token_version`, `security_hold_until` (admin hold), payout details |
| `orders` | Orders per user: `GZ...` code, `link`/`original_link`, `affiliate_link`, `sub_id`, `platform`, status, commission (expected while awaiting admin approval, final once approved), `commission_reversed` (reversed commission), `click_count`, `network_order_id` (transaction ID on the network), `network_commission` (network-reported amount, possibly unapproved), `network_status` |
| `withdrawals` | Withdrawals per user: `WD...` code, bank, account number, amount, status |
| `referrals` | Referral redemption history per user |
| `notifications` | Notifications per user: title, body, icon, read state |
| `password_resets` | Password-reset requests sent to the admin (fallback path): requester, contact-back details, status (`Chờ xử lý` / `Đã xử lý` / `Đã huỷ`), who handled it and when |
| `email_otps` | Email verification codes: purpose (`register` / `reset` / `change_email` / `login`), recipient email, **bcrypt hash of the code** (raw code not stored), wrong-entry count, sends within the hour, expiry. Codes expired for more than a day are deleted automatically at server startup |
| `postback_logs` | **Conversion report log** from affiliate networks: **raw parameters** stored before processing, transaction/product ID, network-reported commission, network status, `sub_id`, matched user/order, processing result, retry count (`dup_count`), IP. A unique constraint on `payload_hash` prevents double processing |
| `login_failures` | Individual failed logins (username, IP, device, timestamp) — used only for counting and alerting, **never to lock accounts**. Auto-deleted after 30 days |
| `security_alerts` | Merged security alerts for the admin: login name, user (if any), IP, failure count, `new`/`resolved` status, handling note, last successful login. No foreign keys, so alerts survive user deletion |

`db.js` automatically adds missing columns at startup, so **old databases upgrade without losing data**.

---

## Admin panel

Every newly registered account has `role = 'user'`. To access the admin page, grant a role with the CLI tool (run inside the `backend` directory):

```bash
npm run make-admin -- --list                  # list users
npm run make-admin -- admin@example.com       # grant admin rights
npm run make-admin -- admin@example.com --demote   # revoke them
```

Forgot the password (or locked out of the system):

```bash
npm run reset-password -- --list                       # list users
npm run reset-password -- admin@example.com            # generate a random password and print it
npm run reset-password -- admin@example.com NewPassword123   # set a specific password
```

Changing the password with this tool also invalidates **all old login sessions** and automatically closes any pending reset request for that account in the admin page.

If a customer **has no email on the account**, the email is wrong, or the system has no mail configured, they can click **"Didn't get a code?"** on the forgot-password screen to queue a request for the admin — see the **Password resets** tab below. This approach **does not reveal** whether an account exists.

`admin@example.com` is the **username used to log in** (email or phone number). After granting the role, reload the page — the **Admin** entry appears at the bottom of the left menu.

The admin page has 8 tabs:

| Tab | What you can do |
|---|---|
| **Orders** | Search by order code / link / platform / customer; approve orders and **settle commission** (money only enters the wallet once the admin approves); clearly see **awaiting admin approval** / **added to wallet** / **reversed**; cancelling an order records a reversal if it had already been added to the wallet |
| **Withdrawals** | View withdrawal requests with **available balance**, **debt** and the **payout QR image** (if the customer uploaded one — click the image to enlarge and scan it with a banking app); enter the actual amount paid then mark `Đã thanh toán`, or `Đã huỷ` |
| **Users** | View points, order count, commission, **pending**, withdrawn, balance/debt; edit role and reward points; delete users |
| **Security** | View failed-login alerts (merged counts, IP, timestamp); mark **Resolved**; **Hold 24h** or **Release**. The system never permanently locks accounts |
| **Referrals** | See who entered whose code and how many points they received |
| **Password resets** | Fallback queue: view forgot-password requests with contact-back details; click **Reset** (click twice to confirm) to issue a **temporary password**, or **Reject** |
| **Reconciliation** | Log of every affiliate network conversion report: filter by network status (`Chờ duyệt` / `Đã duyệt` / `Đã huỷ`) and by result (`matched an order` / `unmatched or only tentatively matched` / `rejected`); view the **raw parameters** the network sent (**Raw** button) and click **Reprocess** for logs that arrived before the order was created. The badge on the tab counts postbacks **needing a human look** (could not match an order, or only tentatively matched). Money from wrong-key calls is **not** counted in commission stats |

### Reissuing a customer password

Customers can normally **reset it themselves** using the verification code sent by email (see [Email verification (OTP)](#email-verification-otp)). The part below is the **fallback path**, for when the customer has no email on the account or does not receive the email:

1. The customer clicks **"Forgot password?"** on the login screen, enters the account, then clicks **"Didn't get a code?"** and fills in how to reach them.
2. Go to **Admin → Password resets** (the tab has a **red badge** counting pending requests).
3. Click **Reset** twice → the system shows a **temporary password**.
4. Copy the password and send it to the customer via Zalo/phone, and remind them to change it after logging in.

If the customer already reset it themselves, their request in this tab **automatically becomes `Đã xử lý`**, and nothing more is needed.

A temporary password is shown **exactly once** and is never stored in the database. After a reset, **all of the customer's old login sessions are invalidated** and the customer receives a notification.

You cannot reset the password of **the account you are currently logged in with** (it would immediately kick you out mid-task) — use **Profile → Change password** instead.

A few safety constraints are enforced on the server:

- Admins **cannot demote** or **delete** themselves.
- There must always be **at least one** admin in the system.
- It is not possible to pay out more than the user's available balance.

Every action that affects money **automatically notifies the customer**: creating an order, an admin settling/changing commission, changing order status, sending a withdrawal request, paying or cancelling a withdrawal, and redeeming a referral code.

---

## Testing and backups

**Run the automated tests** (uses a temporary database + image directory, never touching real data):

```bash
cd backend
npm test
```

The test suite covers: health, security headers, blocking internal file downloads, QR image access permissions, fake marketplace link blocking, admin authorisation, admin audit log, postbacks, awaiting-admin-approval/commission reversal, SQLite-backed rate limiting and the backup script.

**Hot backup** (no need to stop the server):

```bash
cd backend
npm run backup
```

Backups land in `backend/backups/<timestamp>/` and contain the database, the `uploads/` directory
and a `manifest.json`; backups older than `BACKUP_KEEP_DAYS` days (default 14) are deleted automatically.
For scheduling and restoring: see [docs/deployment.md](docs/deployment.md#5-vận-hành-thường-ngày).

---


## Security

- Passwords are stored as **bcrypt hashes**, never as plain text.
- Login sessions are **JWTs in an `httpOnly` cookie** (`sameSite=lax`), expiring after 7 days.
- Each account has a `token_version`; **changing the password or logging out increments it**, so old tokens (including stolen ones) stop working immediately instead of waiting out the 7 days. Changing the password issues a fresh cookie for the current session; logging out logs out **all devices**.
- The frontend **cannot modify** order/wallet/points data — all checks happen on the server.
- Every query by `user_id` uses the value from the token, so users only see their own data.
- The admin API checks `role` **on the server** and does not trust menu visibility in the frontend.
- Only a **known list of UI files** (index.html, script.js, admin.js, support.js, lucide.min.js, CSS, logo images, components/, styles/) is served over HTTP. Any other path returns `404`, even when obfuscated as `/%62ackend/data/...` — `backend/`, `data/`, `node_modules/` and `package.json` cannot be downloaded.
- Login/sign-up APIs are rate-limited to prevent password guessing.
- **Forgot-password** requests always return **the same message** whether or not the account exists, so outsiders cannot probe the account list. The same applies to the verification-code request step.
- **Email verification codes (OTP)** are valid for 10 minutes, single-use, and stored as **bcrypt hashes**; after 5 wrong entries a new code is required; each email may request again only after 60 seconds and at most 5 codes/hour. A code from one flow **cannot be used** for another (sign-up / password reset / email change / login are all separate).
- **Login verification**: the code is only sent **after the password is correct**, so someone who does not know the password cannot fill someone else's inbox. Step 2 uses a pre-signed **login ticket** (valid for 5 minutes) instead of resending the password, and the ticket is invalidated when the password changes.
- **Temporary passwords** issued by an admin are never stored as plain text — they are shown to the admin once and then gone.
- Every response carries **security headers**: `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; over HTTPS also `Strict-Transport-Security`. APIs return `Cache-Control: no-store` so wallet/order data is not cached.
- **Postbacks** from affiliate networks must include `POSTBACK_SECRET`; a missing or wrong key is rejected (503/403) and logged (with the per-IP cap described above).
- Payout **QR images** (`/uploads/qr_*`) are readable only by the owner or an admin and are served with `Cache-Control: private, no-store` (both by Node and by the Nginx config in `deploy/`), so bank account numbers are never cached by a shared proxy or CDN. Avatars remain public.
- The SPA reflects the current page in the URL (`#/wallet`, `#/orders`...), so refresh and Back/Forward work. `/robots.txt` and `/sitemap.xml` are generated from `PUBLIC_BASE_URL`, and `index.html` carries absolute Open Graph/Twitter tags plus a `<noscript>` summary, so link previews and crawlers get real content even though the dashboard itself renders client-side.

### Production notes

> 📘 Step-by-step guide (HTTPS, `.env`, Nginx/Caddy, PM2/systemd, troubleshooting): **[docs/deployment.md](docs/deployment.md)**.

- Change `JWT_SECRET` and enable HTTPS — cookies then automatically get `secure: true`. At `NODE_ENV=production` the server already **refuses to start** if the key is empty, still the default, or shorter than 32 characters.
- If running behind Nginx/Caddy/Cloudflare you **must** set `TRUST_PROXY` — without it the browser will reject the `secure` cookie (logging in looks like it did nothing) and cashback links will be built with `http://`.
- Commissions are not yet pulled automatically from the marketplaces — they are currently **settled manually** by the admin in the Orders tab, and payouts are also confirmed by the admin. Once you have an affiliate account, configuring `AFFILIATE_PROVIDER` + API key makes the marketplaces issue the cashback links.
- If running multiple processes/instances, set `RATE_LIMIT_STORE=sqlite` so the anti-spam counters and AI quota are shared through the database (running **a single process** is still recommended). Back up periodically with `npm run backup` — the script backs up both the database and images and cleans up old copies.
- To change the contact details shown on the Help page, set `SUPPORT_EMAIL` / `SUPPORT_ZALO` in `.env` — no HTML edits needed. The support assistant also uses these two values for the **"Contact support"** button in the chat window.
- **The support assistant works out of the box with no configuration** (scripted mode). If you set `AI_API_KEY`, every customer question is one API call charged against that key's quota/cost — so set a **spending limit** on the provider side, keep the 30 messages/10 minutes per IP limit, and tune the **`AI_DAILY_LIMIT`** cap (default 800 calls/day system-wide; past the cap the assistant answers from the built-in script).
- **Before enabling login verification** (`LOGIN_OTP=auto` turns on automatically once SMTP exists): make sure the admin account has **a real, readable email**, otherwise you will lock yourself out of the admin page. A safe approach: set `LOGIN_OTP=off`, log in, change the email on the **Profile** page, then remove that line. If the mail server breaks (quota exhausted/wrong app password), add `LOGIN_OTP=off` and restart — everyone can get in with their password right away.

> 📄 To turn the **"Create link & check commission"** button into real link conversion (returning purchase links with commission tracking), see the detailed design in **[docs/affiliate-integration.md](docs/affiliate-integration.md)**.

---

## Accounts

Sign up right on the home page with an **email** or a **Vietnamese phone number**, a password of at least 8 characters, plus **an email address to receive verification codes** — this email is required even if you log in with a phone number, because it is where password-recovery codes go. Each email can only be used for one account.

At login, if two-factor authentication is enabled, after entering the correct password you receive a **6-digit code** by email and enter it in the verification box to finish. If a valid code already exists, the system reuses it (no extra email sent).
