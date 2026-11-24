# Fieldline — Telegram on G2

A glasses-first personal Telegram client for Even Realities G2 and the R1 ring. Browse conversations, read message threads, compose, review, send, react, and save messages on the glasses. The phone hosts Even Hub and handles setup; your server maintains the Telegram session and serves the API.

![Actual G2 home framebuffer](docs/media/glasses-home.png)

[88-second glasses-first simulator walkthrough](docs/media/fieldline-glasses-demo.mp4) · [Inbox preview](docs/media/glasses-inbox.png) · [Reply review](docs/media/glasses-review.png) · [Server setup](docs/standalone.md)

**Status:** glasses-only synthetic simulator flows verified; personal Telegram adapter implemented. Real account delivery, live dictation, physical G2 testing, public server deployment, and DoraHacks submission remain unverified.

## What happens on the glasses

- **Inbox.** Launch directly into chats, with unread conversations first. Swipe to preview and tap to open. Hold in Chats to find a conversation by voice.
- **Threads:** swipe messages, paginate full text, inspect the original replied-to message, search history and load older messages. Media is identified; view rich media in Telegram.
- **Replies.** Tap an open message to see a ready-to-send reply and swipe for alternatives. Tap again to send the exact text shown and return to the conversation. Hold to dictate and release to review. Double tap keeps the draft attached to the source.
- **Actions:** reply as yourself, write a new message, react with thumbs up/heart/check, or forward to Saved Messages. Cancellation preserves a draft. Missing receipts stay uncertain; writes are not automatically retried.
- **Catch-up:** source-linked changes, unanswered questions, replies and your stated commitments. Read the evidence and open the underlying conversation. Manage its ten-chat selection entirely on G2.
- **Saved Messages:** a real Telegram self-chat, readable and writable from the glasses.

Swipe to select, tap to open, and double tap to go back. Tap then hold for Even Hub shortcuts such as New message, Find in chat, and Next unread chat. Hold on a message to dictate. Model-backed suggestions are optional and fall back to built-in replies. Double tap at the Telegram home screen to open the system exit confirmation. The G2 display uses separate context and preview areas, brightness for focus, and native pickers for reactions and characters.

## Run the standalone app

Node 24.18+ is required for built-in SQLite. Windows is the verified simulator platform.

```powershell
npm ci
npm ci --prefix .tooling
npm run build
npm run personal:demo
# In another terminal:
npm run glasses:simulate
```

The simulator loads **glasses.html** from port 3003. Tap twice on G2 to pair the synthetic demo. All chat browsing and composing can then be completed using glasses gestures. No phone text box is required. An optional display mirror is available at http://127.0.0.1:3003/glasses.html; /personal.html is the secondary companion workspace.

For real personal-account access, obtain your own Telegram API credentials, copy .env.example to .env if needed, set TELEGRAM_API_ID and TELEGRAM_API_HASH, then run:

```powershell
npm run personal:login    # owner enters phone/code/2FA locally
npm run personal:server
npm run glasses:simulate
# Approve the code shown on G2, once:
npm run personal:approve -- CODE
```

The account session stays in the ignored .data/personal.session. Do not share it or your credentials. A bot token is not used by this client. Login and real Telegram writes have not been tested with owner credentials yet.

## Dictation and reply ideas

Set `STT_API_URL` to a Whisper-compatible transcription URL. The optional `STT_API_KEY` and `STT_MODEL` live on the server.

For model-backed suggestions, set `REPLY_AI_URL` to an OpenAI-compatible Chat Completions endpoint that supports JSON Schema output and `max_tokens`. Set `REPLY_AI_MODEL` and, if required, `REPLY_AI_KEY`. The server shares an excerpt of the selected message with this provider when you open reply ideas. You can use a local provider such as [Ollama](https://docs.ollama.com/api/openai-compatibility). The model adds short follow-up questions. Built-in acknowledgements remain available, including when the model is slow or unavailable.

## Server and package

[Backend deployment and API](docs/standalone.md) explains local production execution, the Docker image, persistent storage, API endpoints and the device package. The server serves both the API and the app assets. It is a single-owner backend.

```powershell
npm run server:build
npm start
# Or build a deployable image:
docker build -t fieldline .
# Default package uses glasses.html:
npm run pack
```

Use a reachable HTTPS server for actual glasses. Set FIELDLINE_BACKEND_URL before packing and PERSONAL_ORIGIN on the backend. The packer generates the exact network whitelist. The package requests microphone permission by default. Set FIELDLINE_VOICE=false when packaging a setup without dictation. Localhost packages only work with the local simulator; the phone's localhost is not your computer.

G2 still requires the Even phone app as its SDK/Bluetooth host. “Standalone” here describes the complete glasses interaction flow, with a separate server for Telegram—not independent cellular hardware inside G2.

## Verification

```powershell
npm test
npm run build
npm run server:build
# Fresh synthetic demo + official simulator:
npm run glasses:test
```

28 automated tests cover source revision binding, single dispatch, ambiguous delivery, account-wide access boundaries, exact new-message text, Saved Messages, read state, speech formatting, review pagination and cancellation. The glasses smoke test drives official SDK gestures and captures actual 576×288 framebuffers. It verifies that the blank layer owns list swipes, the app opens directly to unread chats, and two taps produce one exact reply and an inline receipt. It also covers cancellation, plan-specific suggestions, Saved Messages, and native reaction selection. No real Telegram messages are sent by these tests.

[Glasses-first verification and setup](docs/standalone.md) · [Submission draft](docs/submission-draft.md) · [Earlier personal prototype](docs/personal-account.md) · [Original bot prototype](docs/crew-prototype.md)

## Source and acknowledgements

Based on the official Even Hub minimal template patterns, SDK 0.0.16, simulator 0.9.5 and CLI 0.2.0. Telegram transport uses Teleproto. Application implementation began November 23, 2026. MIT license; dependency licenses remain their own.

## Build-period disclosure

The workspace was empty when inspected November 18, 2026. These preparation documents were written before November 23. No competition application code was created at this stage. On November 18, official simulator 0.9.5 and CLI 0.2.0 were installed under .tooling with a pinned lockfile, and .gitignore was added for tools, secrets, and generated output. The official rules require building during the hackathon and disclosing everything that existed before November 23. Keep this disclosure and enumerate any subsequent pre-build changes here.

Build opens: November 23, 2026, 08:00 UTC (02:00 America/Chicago).
Submission closes: November 29, 2026, 19:59 UTC (13:59 America/Chicago).

