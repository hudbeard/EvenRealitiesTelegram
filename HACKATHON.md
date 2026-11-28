# Fieldline — Even Realities "Heads Up" Hackathon Submission

**Team:** Hudson Beard  
**Submission Deadline:** Sunday, November 29, 2026, 1:59 PM Central  
**Repository:** github.com/hudbeard/EvenRealitiesTelegram

## What It Does

Fieldline is a **glasses-first personal Telegram client** for Even Realities G2 and R1 ring. Users can:

- Browse conversations with unread messages prioritized
- Read full message threads with pagination
- Reply using voice dictation or quick reply suggestions
- React with emojis (👍 ❤️ ✓)
- Forward messages to Saved Messages
- Access catch-up cards for unanswered questions and commitments
- Manage everything using only glasses gestures (swipe, tap, hold, double-tap)

**Key Innovation:** Voice-first replies with review-before-send. No blind automation—every action is explicitly confirmed on the glasses.

## Technical Implementation

### Architecture
- **Frontend:** Vite + TypeScript, Even Hub SDK 0.0.16
- **Backend:** Node.js + Express, Teleproto (MTProto) for Telegram
- **Storage:** SQLite (built-in Node 24+) for state and catch-up cards
- **Deployment:** Docker-ready, single-owner backend

### Core Features
- **Telegram sign-in page (`/login`):** QR scan, phone code fallback and 2FA, built as an explicit state machine; unit-tested with a mocked Telegram, not yet verified against real Telegram
- **Demo Mode:** Full synthetic data for testing without Telegram account
- **Voice Dictation:** PCM → WAV → Whisper-compatible transcription
- **Reply Suggestions:** Optional AI-powered quick replies (OpenAI-compatible)
- **Catch-up Cards:** Source-linked summaries of changes, questions, and commitments
- **Uncertain Delivery States:** Never claims success when network failed

### Glasses UX
- **Layout:** Split-view previews, native SDK list pickers, brightness hierarchy
- **Gestures:** Tap (open), Swipe (navigate), Hold (dictate), 2×Tap (back), Menu (shortcuts)
- **States:** Clear loading, empty, and error states; uncertain delivery never retried
- **Accessibility:** 576×288 monochrome display, readable text, explicit confirmations

## Demo Script (60 seconds)

1. **Launch:** App opens directly at inbox with unread conversations first
2. **Browse:** Swipe through chats, preview messages
3. **Open:** Tap a conversation to see full thread
4. **Reply:** Tap a message → review screen with a suggested reply (swipe for others) → Tap Send now
5. **Voice:** Hold on a message → dictate → review text → tap to confirm
6. **Catch-up:** Menu → Catch-up → see unanswered questions and changes
7. **Saved:** Menu → Saved Messages → access personal notes

## Verification

```bash
# Run all 82 automated tests
npm test

# Start demo mode (no Telegram account required)
npm run personal:demo
npm run glasses:simulate

# Real account: start the server, then sign in at http://127.0.0.1:3003/login
npm run personal:server
npm run glasses:simulate
```

## What's Tested

- ✅ Voice dictation flow (hold, release, transcribe, review, send)
- ✅ Exact text preservation (no invented content)
- ✅ Single dispatch (concurrent confirmations blocked)
- ✅ Uncertain delivery (never claims success on network fail)
- ✅ Account scope boundaries (only selected chats accessible)
- ✅ Pagination and text wrapping
- ✅ Cancellation preserves drafts
- ✅ Crash recovery (never retries in-flight writes)
- ✅ Pairing, auth boundaries, logout
- ✅ Sign-in state machine with a mocked Telegram: QR refresh on one client, 2FA and wrong password/code retries, cancel in every state, timeouts, flood wait, atomic session save, demo never writes, hot pick-up, rate limit and one-attempt cap
- ✅ Login page in jsdom against the demo server (QR is an `<img>`, reaches "Signed in as Demo User")
- ✅ Glasses: watchlist untoggle, confirm screens (Tap vs Double tap), pairing countdown, 1 s send guard

## What's Not Tested (Disclosed)

- Real Telegram sign-in and writes with owner credentials (sign-in tested only against a mocked Telegram)
- Physical G2 hardware (simulator verified)
- Voice transcription with live API key (mocked in tests)
- AI reply suggestions with live model (mocked in tests)

## Security & Privacy

- **No secrets in repo:** `.gitignore` covers `.env`, `.data/`, sessions, and keys
- **Local session only:** Telegram session stored in `.data/personal.session` (never committed)
- **Single owner:** Backend is single-user, not multi-tenant
- **No automatic retries:** Ambiguous sends stay uncertain, never blindly retried
- **Demo isolation:** Synthetic mode uses separate database, no real API calls

## Repository Structure

```
fieldline/
├── src/
│   ├── glasses/           # G2 UI: controller, display, voice
│   └── personal/          # Optional companion workspace
├── server/
│   ├── personal/          # Backend: Telegram, storage, brief
│   │   ├── mtproto.ts     # Real Telegram MTProto client
│   │   ├── login.ts       # Sign-in state machine (QR, code, 2FA)
│   │   ├── login-routes.ts # /api/login/* routes, rate limits
│   │   ├── switchable.ts  # Hot pick-up of a new session
│   │   ├── demo.ts        # Synthetic data provider
│   │   └── brief.ts       # Catch-up card generation
│   └── store.ts           # SQLite state management
├── public/login.html      # Sign-in page
├── tests/                 # 82 automated tests
├── scripts/               # Smoke tests, demo recording
├── docs/                  # Build plan, verification, submission draft
└── .tooling/              # Even Hub simulator + CLI (0.9.5, 0.2.0)
```

## Changes in This PR

- Telegram sign-in at `/login`: QR (refreshed in place), phone code, 2FA; cancel and timeouts; session saved atomically and picked up by the running server. Unit-tested with a mocked Telegram; not verified against real Telegram or hardware.
- Review before every send: Tap a message opens review with a suggested reply, Tap Send now sends (two taps). 1 s guard on Send now, Double tap cancels, server requires `confirmed: true`.
- Exit and Disconnect ask first (Tap confirms, Double tap goes back).
- Pairing code countdown with Double tap to cancel. The synthetic demo auto-pairs on boot and after a 401; live servers never do.
- UX pass: auto-mark-read, swipe past the last message into the next unread chat, inbox rows with unread count, chat type and relative time, Catch-up labels and one-page cards, Settings row restore, mute mapping.
- Friendlier offline errors with per-call timeouts.
- Crew/bot prototype moved to `docs/archive/crew-prototype/`; its two test files are archived with it. The suite is 82 tests.

## Running for Reviewers

**Branch:** `main`

**Demo Mode (Recommended):**
```bash
git checkout main
npm ci
npm ci --prefix .tooling
npm run build
npm run personal:demo        # Terminal 1
npm run glasses:simulate     # Terminal 2
# Open http://127.0.0.1:3003/glasses.html
# Demo auto-pairs and opens the inbox (falls back to: Tap twice to pair)
```

**Real Telegram (Optional):**
```bash
# 1. Get API credentials from https://my.telegram.org
# 2. Copy .env.example to .env
# 3. Set TELEGRAM_API_ID and TELEGRAM_API_HASH
npm run personal:server      # Terminal 1, then sign in at http://127.0.0.1:3003/login
npm run glasses:simulate     # Terminal 2
npm run personal:approve -- CODE  # Approve pairing code shown on G2
```

## Known Limitations

- Simulator may need a graphical display (Xvfb or similar on a headless box). Official 0.9.5 has been run on Linux, including headed under Xvfb
- Voice transcription requires STT_API_URL (Whisper-compatible)
- AI replies require REPLY_AI_URL (OpenAI-compatible)
- Backend is single-owner (no multi-tenant support)

## Acknowledgements

- Even Realities for SDK 0.0.16, simulator 0.9.5, CLI 0.2.0
- Teleproto for Telegram MTProto implementation
- Official Even Hub minimal template patterns

---

**Status:** builds clean and 82/82 tests pass at this commit; demo mode runs. Not verified: real Telegram sign-in/writes, G2 hardware.
