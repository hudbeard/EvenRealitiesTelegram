# Standalone Telegram glasses app

The primary entrypoint is glasses.html. src/glasses/controller.ts owns navigation and composition; src/glasses/main.ts binds the controller to Even Hub events, microphone capture and display containers. The optional phone workspace is not involved in the glasses smoke test.

## Architecture

G2 / R1 gestures → Even App WebView → authenticated HTTPS API → personal Telegram MTProto session.

The server owns Telegram credentials, the saved account session, peer resolution, history/search, read acknowledgements and writes. The client stores only a revocable random bearer token. The phone provides Even Hub/Bluetooth hosting and initial account/pairing support. G2 has no independent network client in this SDK environment.

The account browser currently lists the most recent 100 account dialogs. Histories load 40 messages per page, with older-page navigation and server-side text search. Catch-up is optional and restricted to ten selected chats; this restriction does not limit the main chat browser. Read state advances after continuing from the full source message. Reading a newer Telegram message advances the account's read watermark normally.

Direct channel posting is not offered. Channel text histories request sponsored content and display supported sponsored text before proceeding; rich sponsored media causes an explicit Telegram fallback. Regular media is labelled rather than played. Secret chats, calls, media upload/playback, contact discovery, forum topics, editing and deletion are not implemented.

## Production server

For local production, configure .env with your own TELEGRAM_API_ID / TELEGRAM_API_HASH, run npm run personal:login yourself, then npm run build, npm run server:build, and npm start. Build output is dist-server; the production server does not require tsx. Default host is 127.0.0.1:3003.

Dockerfile uses Node 24, builds frontend/server, installs production dependencies only, and runs as node. .dockerignore excludes .env, account data, .git, tools and generated artifacts. The container has no Telegram login by default. Provision the owner session first, then mount .data and supply environment variables. Protect that volume as account access material.

Example for an operator who has already created .data/personal.session:

```sh
docker build -t fieldline .
docker run --rm -p 127.0.0.1:3003:3003 --env-file .env \
  -e PERSONAL_HOST=0.0.0.0 -e PERSONAL_ORIGIN=https://your-app.example \
  -v "$(pwd)/.data:/app/.data" fieldline
```

Put HTTPS in front of the container and persist /app/.data across restarts. PERSONAL_ORIGIN is the exact browser/WebView origin accepted by CORS. For a packaged WebView with an opaque/variable origin, PERSONAL_ORIGIN=* permits bearer-authenticated requests without cookies. Do not expose simulator automation port 9899. This container configuration has been supplied, but no Docker engine or public host deployment has been verified in this workspace.

On G2, generate a pairing code and approve it on the server with npm run personal:approve -- CODE. The production image includes the approval helper; use docker exec CONTAINER npm run personal:approve -- CODE so it reads the same .data/personal-approval.key. Pairing codes expire after five minutes; bearer sessions expire after four hours. A rejected session requires pairing again. Disconnect revokes only that display session, not the underlying Telegram account session.

## Authenticated glasses API

- GET /api/glasses/dialogs — recent account conversations and catch-up selection.
- GET /api/glasses/saved — resolve the owner's Saved Messages chat.
- GET /api/glasses/chats/:id/messages?search=&before= — history, revision digests, sponsored messages, older-page availability.
- POST /api/glasses/chats/:id/read — acknowledge a displayed message.
- POST /api/glasses/action — confirmed send/reply/react/save with operationId, action, source revision and confirmed:true.
- GET /api/brief; POST /api/watch and /api/checkpoint — optional source-linked catch-up.
- POST /api/transcribe — optional raw 16kHz mono signed16 PCM, at most 30 seconds, returned as a draft only.

Health and pairing start/poll are unauthenticated; live approval requires a local approval key. All account endpoints require Authorization: Bearer SESSION. Chat access is resolved against the owner's dialogs or own self-chat; arbitrary peer strings are rejected. New message sends use messageId:0 and account scope. Replies, reactions and saves bind to the reviewed source digest. The durable SQLite operation ledger binds an ID to its payload and claims it once before dispatch. Uncertain results cannot automatically dispatch again with that operation ID.

## Speech

Configure a Whisper-compatible multipart endpoint through STT_API_URL, STT_API_KEY and STT_MODEL. The server wraps G2 PCM in a WAV container; audio is not written to disk. Audio is transmitted to the configured provider. The returned transcript becomes a draft and still requires glasses review plus confirmation. Without speech configuration, use the complete ring keyboard. Live capture/transcription requires hardware/provider verification.

## Verified November 24

22 tests, frontend build and compiled server build pass. The official simulator renders the monochrome icon plus header/body/footer containers. Fourteen actual glasses captures cover a complete synthetic journey: pairing, chats, thread, compose, review, receipt, keyboard-created new message, Saved Messages, watchlist, controls. The app stops microphone capture and active handling on foreground exit and resumes on foreground entry. Hardware behavior remains unverified.

The source is ready for owner login and a hosted HTTPS endpoint. No real Telegram receipt, live speech receipt or DoraHacks submission is claimed.
