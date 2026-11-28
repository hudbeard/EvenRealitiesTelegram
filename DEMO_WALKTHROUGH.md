# Fieldline demo walkthrough

**Branch:** `main`
**Tests:** 82/82 passing (`npm test`)
**What was verified for this document:** build and tests; the demo server's `/api/login/*` flow with `curl`; the login page in jsdom against the demo server. Tester ran `npm run glasses:test` at `f494e57` on Even Hub simulator 0.9.5 (headed) and recorded a PASS: "11 framebuffers, blank gesture capture, two-tap exact reply, cancellation, inline receipt, native shortcuts, save and reaction." QA independently ran the same script at `f494e57` on a fresh clone and recorded the same PASS (frames now read `Send · Maya` / `Send · Build night`). The smoke script's expectations were updated in `3a11d25`, `a42e831` and `679005c`. This docs-only pass did not re-run the simulator. G2 hardware and real Telegram were not used.

## Setup

```bash
npm ci && npm ci --prefix .tooling
npm run build
npm run personal:demo        # terminal 1, http://127.0.0.1:3003
npm run glasses:simulate     # terminal 2
```

## Sign-in page (demo)

Open http://127.0.0.1:3003/login.

- **QR tab** (opens by default): a QR image, "New code in 0:29" countdown, and a demo box. After about 3 seconds, or when you click **Simulate the scan now**, the page shows **"Signed in as Demo User. Your server is using this account now."** and an "Open your glasses" link; the QR / Phone tabs hide.
- **Phone tab:** enter any number with a country code, then **Send code**. The page says "Demo mode: enter any 5-digit code." Code `00000` shows "That code is not right. Try again." and keeps the form; any other code signs in as Demo User. (Live sign-in still says "Telegram sent you a code.")
- **Cancel sign-in** works at any step; **Try again** restarts.
- Demo mode makes no Telegram calls and never writes `.data/personal.session`.

## Pairing the glasses

In demo mode the glasses page pairs itself on boot (and again after an expired display session) and opens the inbox, so there is nothing to do. If auto-pair fails, or after you Disconnect, the manual flow below applies. Live servers always use it.

1. The lens shows "Tap to connect this display."
2. Tap: a 6-digit code appears and the footer counts down from `Expires 5:00` every second. At 0:00 the lens shows PAIRING EXPIRED.
3. Double tap cancels and returns to the welcome screen.
4. In demo mode, Tap again to approve. The inbox opens (Maya, Build night, Design team).

## Glasses behaviour to show

- **Inbox density:** rows read `● Maya · 1`, `● Build night · 2`, `Design team`; the preview reads `DM · 1 unread · 10m`.
- **Read and move on:** open Maya; the message is marked read and the dot clears. Swipe past the last message to land in Build night on its first unread; swipe again for the second; past the end, "You’re caught up" (Tap Inbox, Double tap back).
- **Reply with review:** open Maya, tap the message: the review screen ("Send · Maya") shows a suggested reply; swipe for others, then **Tap Send now**. A tap within 1 second of opening review is ignored, so the tap that opened it cannot send. Double tap goes back without sending.
- **Catch-up:** rows read `Build night · change`, `Maya · reply`; a card is one page and Tap opens the source message.
- **Offline:** if the server stops answering, quick probes give up after 3 s and reads after 15 s with "Can't reach your server. Nothing was sent."; a send that times out shows "DELIVERY UNVERIFIED" instead of claiming nothing was sent.
- **Exit:** Double tap on Chats shows "EXIT FIELDLINE?". Tap exits; Double tap goes back to Chats.
- **Disconnect:** Settings → Disconnect display shows "DISCONNECT?". Tap disconnects; Double tap goes back to Settings.
- **Catch-up chats:** toggling a chat on and off works (footer `Tap  Toggle`), and Back returns to the screen you came from. Settings reopens on the row you left.

## Real Telegram (not verified against real Telegram)

1. Put your own `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` in `.env`.
2. `npm run personal:server`. With no session it starts signed out.
3. Open http://127.0.0.1:3003/login and scan the QR from Telegram (Settings → Devices → Link Desktop Device), or use the phone tab. Enter your 2FA password if asked; a wrong password asks again.
4. The session is saved atomically to `.data/personal.session` and the running server switches to it without a restart.
5. Pair the glasses and approve the code with `npm run personal:approve -- CODE`.

The sign-in state machine is covered by unit tests with a mocked Telegram client. Nobody has run it against real Telegram servers or on G2 hardware yet.

## Tests

```bash
npm test   # 82 tests
```

- 20 controller, service, adapter, voice and retention tests
- 15 sign-in state machine tests (`tests/login.test.ts`)
- 8 login route and login page tests (`tests/login-routes.test.ts`, jsdom)
- 13 glasses fix tests (`tests/glasses-fixes.test.ts`)
- 26 UX pass tests (`tests/ux-pass.test.ts`)

## URLs

- Sign-in: http://127.0.0.1:3003/login
- Companion: http://127.0.0.1:3003/personal.html
- Glasses mirror: http://127.0.0.1:3003/glasses.html
