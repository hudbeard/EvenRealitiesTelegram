# Standalone Telegram glasses app

The primary entrypoint is glasses.html. src/glasses/controller.ts owns navigation and composition; src/glasses/main.ts binds the controller to Even Hub events, microphone capture and display containers. The optional phone workspace is not involved in the glasses smoke test.

## Architecture

G2 / R1 gestures → Even App WebView → authenticated HTTPS API → personal Telegram MTProto session.

The server owns Telegram credentials, the saved account session, peer resolution, history/search, read acknowledgements and writes. The client stores only a revocable random bearer token. The phone provides Even Hub/Bluetooth hosting and initial account/pairing support. G2 has no independent network client in this SDK environment.

The account browser currently lists the most recent 100 account dialogs. Histories load 40 messages per page, with older-page navigation and server-side text search. Catch-up is optional and restricted to ten selected chats; this restriction does not limit the main chat browser. Read state advances when a message is fully on screen in a thread (a long message when its last page is reached; search results are not marked), always forward-only and best-effort. Reading a newer Telegram message advances the account's read watermark normally.

Direct channel posting is not offered. Channel text histories request sponsored content and display supported sponsored text before proceeding; rich sponsored media causes an explicit Telegram fallback. Regular media is labelled rather than played. Secret chats, calls, media upload/playback, contact discovery, forum topics, editing and deletion are not implemented.

## Production server

For local production, configure .env with your own TELEGRAM_API_ID / TELEGRAM_API_HASH, then npm run build, npm run server:build, and npm start, and sign in at /login (or run npm run personal:login yourself first). Build output is dist-server; the production server does not require tsx. Default host is 127.0.0.1:3003.

**Warning:** `/login` has no owner authentication. Keep this server on localhost and never host it on a public network.

Dockerfile uses Node 24, builds frontend/server, installs production dependencies only, and runs as node. .dockerignore excludes .env, account data, .git, tools and generated artifacts. The container has no Telegram login by default. Either sign in at /login once it is running (the session is saved under /app/.data and picked up without a restart), or provision .data/personal.session first; mount .data and supply environment variables either way. Protect that volume as account access material.

Example for an operator who has already created .data/personal.session:

```sh
docker build -t fieldline .
docker run --rm -p 127.0.0.1:3003:3003 --env-file .env \
  -e PERSONAL_HOST=0.0.0.0 -e PERSONAL_ORIGIN=http://127.0.0.1:3003 \
  -v "$(pwd)/.data:/app/.data" fieldline
```

If you run the container, bind it to localhost, persist /app/.data across restarts, and do not put it on a public network: `/login` has no owner authentication. PERSONAL_ORIGIN is the exact browser/WebView origin accepted by CORS. For a packaged WebView with an opaque/variable origin, PERSONAL_ORIGIN=* permits bearer-authenticated requests without cookies. Do not expose simulator automation port 9899. This container configuration has been supplied, but it is not ready for a hosted HTTPS endpoint; no Docker engine or public host deployment has been verified in this workspace.

On G2, generate a pairing code and approve it on the server with npm run personal:approve -- CODE. The production image includes the approval helper; use docker exec CONTAINER npm run personal:approve -- CODE so it reads the same .data/personal-approval.key. The synthetic demo server (`/api/health` with `synthetic: true`, mode `personal-demo`) is paired automatically by the glasses page; live servers never are, and live approval still needs the local key. Pairing codes expire after five minutes; bearer sessions expire after four hours. A rejected session requires pairing again. Disconnect revokes only that display session, not the underlying Telegram account session.

## Authenticated glasses API

- GET /api/glasses/dialogs — recent account conversations and catch-up selection.
- GET /api/glasses/saved — resolve the owner's Saved Messages chat.
- GET /api/glasses/chats/:id/messages?search=&before= — history, revision digests, sponsored messages, older-page availability.
- POST /api/glasses/chats/:id/read — acknowledge a displayed message.
- POST /api/glasses/action — confirmed send/reply/react/save with operationId, action, source revision and confirmed:true.
- GET /api/brief; POST /api/watch and /api/checkpoint — optional source-linked catch-up.
- POST /api/transcribe — optional raw 16kHz mono signed16 PCM, at most 30 seconds, returned as a draft only.

Sign-in routes (POST /api/login/qr/start, POST /api/login/phone/start, GET /api/login/:id, POST /api/login/:id/code | password | cancel) need no display token but are origin-checked, rate-limited per IP and limited to one active attempt. Health and pairing start/poll are unauthenticated; live approval requires a local approval key. All account endpoints require Authorization: Bearer SESSION. Chat access is resolved against the owner's dialogs or own self-chat; arbitrary peer strings are rejected. New message sends use messageId:0 and account scope. Replies, reactions and saves bind to the reviewed source digest. The durable SQLite operation ledger binds an ID to its payload and claims it once before dispatch. Uncertain results cannot automatically dispatch again with that operation ID.

## Speech

Configure a Whisper-compatible multipart endpoint through STT_API_URL, STT_API_KEY and STT_MODEL. The server wraps G2 PCM in a WAV container; audio is not written to disk. Audio is transmitted to the configured provider. The returned transcript becomes a draft and still requires glasses review plus confirmation. Without speech configuration, use built-in or model-backed replies. Dictating a new message and voice search require speech setup. Live capture/transcription requires hardware/provider verification.

## Verified November 24

28 tests and both builds passed at that time (the current branch has 82 tests). The official simulator verifies direct inbox entry, blank gesture capture, two-tap reply confirmation, cancellation, inline receipts, local-model suggestions, Saved Messages, and reactions. Microphone and transcription logic are tested with synthetic PCM. The app stops microphone capture when leaving the foreground and resumes input on return. Closing a contextual menu leaves the conversation active. Hardware behavior remains unverified.

`/login` has no owner authentication: keep the server on localhost and never host it on a public network. The source is not ready for a hosted HTTPS endpoint. No real Telegram receipt, live speech receipt or DoraHacks submission is claimed.
