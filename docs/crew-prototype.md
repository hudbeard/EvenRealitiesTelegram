> Historical bot prototype documentation. The primary app is now the standalone glasses client documented in [README](../README.md).

# Fieldline

**November 24 upgrade:** [Fieldline Catch-up with personal Telegram accounts](docs/personal-account.md) now adds selected-chat context, changed-plan cards, custom replies as you, reactions, Saved Messages, search, and read state. Run `npm run personal:demo` after building, then open `/personal.html` on port 3003. The source below documents the original crew-bot prototype; its published video remains a v0 demonstration. Live personal-account verification is still pending owner login.

![Fieldline Catch-up source context](docs/media/personal-source.png)

[Personal-account simulator walkthrough](docs/media/fieldline-personal-demo.mp4) · [Setup and verified capabilities](docs/personal-account.md)

Telegram crew coordination for the Even Realities G2. One request, a short response, and an explicit confirmation on the glasses or R1 ring.

**Status: application implemented; nine backend tests and the official simulator demo journey pass. Live Telegram delivery and the DoraHacks submission are not yet verified.**

![Fieldline in the official simulator](docs/media/fieldline-preview.png)

[86-second simulator walkthrough](docs/media/fieldline-demo.mp4) · [Verification evidence](docs/verification.md)

## Objective

Event crews and small teams coordinate while carrying equipment and helping attendees. A Telegram group member posts `/request Can you cover the north entrance?`. The wearer opens it on G2, chooses “On my way”, “Done”, or “I cannot cover this”, reviews the chat ID and exact reply, and confirms. The bot replies in the original thread with the configured wearer's label. Cancel never sends. An ambiguous send is locked and marked uncertain, never automatically retried.

Track: **Messaging & News**. Telegram direction selected by the project owner on November 18, 2026. The integration is a bot in one approved group, not access to the wearer's personal Telegram inbox. Voice input is not implemented; the tap/ring path works without microphone permissions or an AI service.

## Run locally

Requires Node 24.18+ (uses built-in SQLite), npm, and Windows for the verified native simulator setup. Other platforms have not been tested here.

```powershell
npm ci
npm ci --prefix .tooling
Copy-Item .env.example .env  # only on first setup; preserve an existing .env
npm run build
npm run server
```

Open `http://127.0.0.1:3001` for the phone companion. In a second terminal, run `npm run simulate`. The simulator opens the same production build and exposes its control plane on port 9898. Keep that automation port local.

The default is **demo mode**: every request and receipt is synthetic, clearly labelled on the glasses. Tap once to generate a pairing code, again to approve demo pairing, then again to add a sample request. The companion also has buttons for these actions. Open → choose reply → review → confirm. Double tap cancels a preview; double tap at the root exits.

For frontend iteration use `npm run dev` with the backend running. Vite proxies `/api` to port 3001. In live mode set `PUBLIC_ORIGIN` to the frontend origin used for development; the documented production setup uses port 3001.

## Connect a real Telegram test group

1. Create a dedicated bot yourself with Telegram's official `@BotFather` and put its token in the ignored `.env` file as `TELEGRAM_BOT_TOKEN`. Do not place tokens in source, video, URLs shared with others, or chat.
2. Add it to a consenting test group. In your own private chat with the bot send `/start`. In the group send `/request@YourBotUsername Cover the north entrance?`. Addressing the bot explicitly works with Telegram's default group privacy mode.
3. With the backend stopped, run `npm run telegram:check`. This only calls `getMe` and `getUpdates`; it prints numeric chat/user IDs and omits message text and the token. Set your private-chat sender ID as `TELEGRAM_OPERATOR_ID` and the test group's negative ID as `TELEGRAM_CHAT_ID`.
4. Set `FIELDLINE_MODE=telegram`, choose a printable English `OPERATOR_LABEL` of 1–24 characters, then restart `npm run server`. Demo and real data use separate SQLite files. Confirm `/api/health` says `telegram` before claiming a live demo.
5. Start/restart the simulator. Start pairing, then privately send `/pair 123456` with the code displayed on the glasses to your bot. Only the configured wearer can approve pairing. The code expires in five minutes and the session in four hours.
6. Have a consenting test participant post a fresh `/request@YourBotUsername ...` in the approved group. Read and confirm a reply on G2. Verify the receipt and actual reply in the correct Telegram thread. This final live test has not yet been performed in this workspace.

Telegram group admin access is not required for ordinary `/request` commands when the bot is explicitly addressed and permitted to send replies. Only one `getUpdates` poller can use the bot token at a time. If a webhook or other bot service already owns it, use a fresh dedicated test bot; this app does not remove webhooks or change bot permissions.

## Verify

```powershell
npm test
npm run build
# With the demo backend and a fresh/root-level official simulator running:
npm run test:simulator
```

The nine backend tests cover concurrent duplicate confirmation, reply binding, ambiguous delivery, explicit Telegram rejection, invalid receipts, expiry, retention, scoped ingestion, restart recovery, and HTTP pairing/access boundaries. The simulator check drives real SDK input through the official automation API and writes raw/composited framebuffers plus a JSON report under `artifacts/simulator/`. It refuses to run against Telegram mode. If requests are pending, finish them before rerunning it. A root double tap shuts down the display; restart the simulator for another run.

Localhost integration tests require a runtime that permits loopback connections. This environment's restricted sandbox denies those connections, so that one test and simulator orchestration were run through the approved external execution path. The type check and production build pass locally.

## Package and deployment

`npm run pack` creates `artifacts/fieldline.ehpk` for the local backend. For a hosted backend, set `FIELDLINE_BACKEND_URL` to its HTTPS origin before packing. The pack script compiles the API base into the client and generates the exact network permission whitelist; no provider token enters the browser bundle. The backend must allow the installed WebView origin through `PUBLIC_ORIGIN` and return CORS/preflight headers. Setting `PUBLIC_ORIGIN=*` permits bearer-authenticated packaged WebViews without cookies; otherwise use the known exact origin.

The default localhost package is for the local simulator only. On a phone, localhost means the phone itself. A device-ready package requires a reachable HTTPS backend and actual device testing. No public backend or hardware deployment has been verified.

## Data and reliability

The server owns the Telegram token. Browser sessions hold a random bearer token, hashed in server storage; pairing tokens are recoverable only during the five-minute pairing window. The backend processes only explicit request commands in one configured group. Requests expire after 30 minutes. Ordinary records older than 24 hours are removed on queue access; uncertain sends remain for operator reconciliation. Storage is capped at 1,000 requests. SQLite files and logs are ignored by Git. Store the database on a protected local disk; application-level encryption at rest is not implemented.

Display text currently targets English. Long source text paginates; the phone companion is a preview, not a substitute for the official simulator. No background overlays, personal-account messaging, trading, automatic commitments, or microphone recording are implemented. A lost delivery receipt requires checking Telegram; there is no resend button for that request.

## Source and acknowledgements

SDK bootstrap and event-routing patterns are based on the official MIT-licensed `even-realities/evenhub-templates/minimal` template, consulted November 23. Dependencies include the Even Hub SDK, simulator, CLI, Vite, Express, dotenv, TypeScript, tsx, and sharp. Application implementation began November 23, 2026. The app is MIT licensed; dependency licenses remain their own.

## Build-period disclosure

The workspace was empty when inspected November 18, 2026. These preparation documents were written before November 23. No competition application code was created at this stage. On November 18, official simulator 0.9.5 and CLI 0.2.0 were installed under .tooling with a pinned lockfile, and .gitignore was added for tools, secrets, and generated output. The official rules require building during the hackathon and disclosing everything that existed before November 23. Keep this disclosure and enumerate any subsequent pre-build changes here.

Build opens: November 23, 2026, 08:00 UTC (02:00 America/Chicago).
Submission closes: November 29, 2026, 19:59 UTC (13:59 America/Chicago).

## Preparation documents

- [Verified requirements](docs/requirements.md)
- [Implementation and verification plan](docs/build-plan.md)
- [Verified development tools](docs/environment.md)
- [Draft submission and demo outline](docs/submission-draft.md)

Source: https://dorahacks.io/hackathon/even-realities/detail
