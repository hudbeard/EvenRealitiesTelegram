# Submission draft — not ready to submit

Working name: Fieldline (availability not checked).
Track: Messaging & News.

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
- [ ] Public repository URL and clean setup verified.
- [x] Actual official-simulator demo journey captured, with synthetic data clearly identified.
- [ ] Actual demo video hosted, accessible, duration <=180 seconds.
- [x] Description reflects implemented behavior and names the chosen track; live-test limitation disclosed.
- [x] Optional API feature feedback: none claimed; no unverified provider deficiencies invented.
- [ ] Optional .ehpk verified if provided.
- [ ] DoraHacks submission completed before November 29, 2026, 19:59 UTC.
- [ ] Published entry and all outbound links verified.

No public repository or DoraHacks entry has been verified. A local simulator-only .ehpk has been generated with the official CLI. A publicly hosted backend/device package and live Telegram delivery are still unverified. The public repository URL, hosted video URL, and final entry URL must be filled from actual successful publication results.
