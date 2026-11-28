# Fieldline — Even Realities "Heads Up" Hackathon Submission

**Team:** Hudson Beard  
**Submission Deadline:** Sunday, November 29, 2026, 1:59 PM Central  
**Repository:** github.com/hudsonbeard/fieldline (or as configured)

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
- **QR Code Login:** Zero-typing sign-in (scan in Telegram app)
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
4. **Reply:** Tap a message → see reply suggestions → tap to send
5. **Voice:** Hold on a message → dictate → review text → tap to confirm
6. **Catch-up:** Menu → Catch-up → see unanswered questions and changes
7. **Saved:** Menu → Saved Messages → access personal notes

## Verification

```bash
# Run all 28 automated tests
npm test

# Start demo mode (no Telegram account required)
npm run personal:demo
npm run glasses:simulate

# Real account with QR login
npm run personal:qr-login  # Scan QR code
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

## What's Not Tested (Disclosed)

- Real Telegram writes with owner credentials (demo mode only so far)
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
│   │   ├── qr-login.ts    # QR code authentication (NEW)
│   │   ├── demo.ts        # Synthetic data provider
│   │   └── brief.ts       # Catch-up card generation
│   └── store.ts           # SQLite state management
├── tests/                 # 28 automated tests
├── scripts/               # Smoke tests, demo recording
├── docs/                  # Build plan, verification, submission draft
└── .tooling/              # Even Hub simulator + CLI (0.9.5, 0.2.0)
```

## Changes in This PR

### New Features
1. **QR Code Login** (`server/personal/qr-login.ts`, `scripts/qr-login.ts`)
   - Implements Telegram's `auth.exportLoginToken` / `auth.importLoginToken`
   - Zero-typing sign-in: scan QR in Telegram app
   - Fallback to phone/code/2FA for 2FA-enabled accounts

2. **Improved README**
   - Clear quickstart for demo mode
   - QR login instructions with both options
   - Security and privacy notes

### Bug Fixes & Polish
- Build system verified (TypeScript, Vite, server build all clean)
- All 28 tests passing
- Dependencies properly declared
- `.gitignore` covers all secrets

### Documentation
- `HACKATHON.md` — This file (submission overview)
- Updated README with quickstart and demo script
- Inline code comments for QR login flow

## Running for Reviewers

**Branch:** `cursor/hackathon-polish-9492`

**Demo Mode (Recommended):**
```bash
git checkout cursor/hackathon-polish-9492
npm ci
npm ci --prefix .tooling
npm run build
npm run personal:demo        # Terminal 1
npm run glasses:simulate     # Terminal 2
# Open http://127.0.0.1:3003/glasses.html
# Tap twice on simulator to pair
```

**Real Telegram (Optional):**
```bash
# 1. Get API credentials from https://my.telegram.org
# 2. Copy .env.example to .env
# 3. Set TELEGRAM_API_ID and TELEGRAM_API_HASH
npm run personal:qr-login    # Scan QR code
npm run personal:server      # Terminal 1
npm run glasses:simulate     # Terminal 2
npm run personal:approve -- CODE  # Approve pairing code shown on G2
```

## Known Limitations

- Simulator may need platform-specific binaries (macOS/Windows verified, Linux untested)
- Voice transcription requires STT_API_URL (Whisper-compatible)
- AI replies require REPLY_AI_URL (OpenAI-compatible)
- Backend is single-owner (no multi-tenant support)

## Acknowledgements

- Even Realities for SDK 0.0.16, simulator 0.9.5, CLI 0.2.0
- Teleproto for Telegram MTProto implementation
- Official Even Hub minimal template patterns

---

**Ready for Review:** Code builds clean, tests pass, demo mode runs, secrets excluded, README complete.
