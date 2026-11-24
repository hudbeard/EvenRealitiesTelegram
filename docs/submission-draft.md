# Submission draft — not ready to submit

## November 24 direction: Fieldline Catch-up

Updated pitch: **What changed while I was away?** Fieldline connects selected personal Telegram conversations to a source-linked G2 catch-up. It highlights explicit plan changes, replies to your messages, unread questions, and commitments quoted from what you said. Open the original context, compose or dictate a reply, review it on G2, and confirm as yourself; reactions and Saved Messages follow the same review flow. Message edits invalidate a stale confirmation. No AI-generated decisions or automatic commitments are claimed.

The personal-account adapter, companion UI, tap/ring flow, history/search, read acknowledgements, reactions, and Saved Messages are implemented. Hold-to-dictate has implementation and audio-format tests; live transcription still needs a configured service. Seventeen automated tests pass and the official simulator personal-demo journey is verified. Real account login and real Telegram receipts remain required before a fully connected submission claim.

New synthetic simulator video: https://raw.githubusercontent.com/hudbeard/EvenRealitiesTelegram/main/docs/media/fieldline-personal-demo.mp4

The original bot prototype and its draft below are retained as build history, not the final product positioning.

Working name: Fieldline (availability not checked).
Track: Messaging & News.

Public source: https://github.com/hudbeard/EvenRealitiesTelegram

Public demo file: https://raw.githubusercontent.com/hudbeard/EvenRealitiesTelegram/main/docs/media/fieldline-demo.mp4

The public MP4 returned HTTP 200, but its acceptance by the final DoraHacks form has not been verified. It is an 86-second synthetic-data simulator walkthrough, not a live Telegram delivery demonstration.

## Description for final review

Fieldline helps event crews and small teams respond to Telegram coordination requests while keeping their hands available. A coordinator posts an explicit /request in an approved group. The wearer reads one request on Even G2, chooses a short response, reviews the chat ID and exact message, and confirms with a tap or R1 ring. The server pairs only the configured wearer and sends through a dedicated Telegram bot in the original message thread. A missing delivery receipt stays uncertain and is never automatically retried.

The implementation includes both a Telegram transport and an isolated synthetic demo transport. Backend tests and the official simulator journey have passed. The current video shows synthetic requests and receipts, explicitly labelled throughout. Do not claim a live Telegram integration has been demonstrated until a real group request and reply have been verified. Voice is not implemented.

## Demo outline, target 150–175 seconds

- 0–20 s: show the coordination problem and identify the intended user.
- 20–45 s: create a real request in the Telegram test chat; show it arriving in the official G2 simulator.
- 45–90 s: use simulator touch/ring input to read, choose a response, preview, and confirm. Show the Telegram receipt in the correct chat.
- 90–120 s: demonstrate cancel without a send, then duplicate-tap protection or an honest disconnected state.
- 120–145 s: optional voice path only if implemented and verified; otherwise show a second distinct coordination request.
- 145–175 s: explain the focused workflow, data boundary, current limits, and show repository/setup links.

## Final submission checklist

- [x] Official rules rechecked after kickoff (November 23 official HTML).
- [ ] Account registered and eligibility/team details verified.
- [x] Working source built during build week, with pre-build disclosure retained.
- [x] Public repository URL and clean setup verified.
- [x] Actual official-simulator demo journey captured, with synthetic data clearly identified.
- [x] Actual simulator demo video hosted, accessible, duration 86 seconds. Final form acceptance remains to be checked.
- [x] Description reflects implemented behavior and names the chosen track; live-test limitation disclosed.
- [x] Optional API feature feedback: none claimed; no unverified provider deficiencies invented.
- [ ] Optional .ehpk verified if provided.
- [ ] DoraHacks submission completed before November 29, 2026, 19:59 UTC.
- [ ] Published entry and all outbound links verified.

The public repository and demo file have been verified. A local simulator-only .ehpk has been generated with the official CLI. Live Telegram delivery, a publicly hosted backend/device package, and the DoraHacks entry remain unverified. Do not mark the hackathon complete until the required remaining evidence exists.
