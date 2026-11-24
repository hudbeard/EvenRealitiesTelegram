# Submission draft — owner login and final entry still required

## Fieldline — Telegram on G2

Track: Messaging & News.

Fieldline makes G2 the main interface to your personal Telegram account. Browse conversations and unread counts, read message threads and reply context, type with a ring keyboard or dictate, review exact text, and send as yourself. React, forward to Saved Messages, search history and manage catch-up chats entirely from G2. The phone hosts Even Hub and supports account setup; a separate backend owns the Telegram session and API.

The distinctive catch-up view answers “what changed while I was away?” using source-linked plan changes, replies, unread questions and your own stated commitments. It opens the underlying conversation before action. It does not invent commitments or automatically send decisions.

Public source: https://github.com/hudbeard/EvenRealitiesTelegram

Glasses-first video (112 seconds; actual official simulator captures with captions; synthetic data): https://raw.githubusercontent.com/hudbeard/EvenRealitiesTelegram/main/docs/media/fieldline-glasses-demo.mp4

The primary entrypoint is glasses.html (version 0.3.0). The previous bot and personal companion videos are historical prototypes. New glasses-first simulator captures document browsing, composition/cancellation, confirmed reply, a custom ring-keyboard new message and Saved Messages without a phone textbox. All published demonstration data is synthetic.

## Verification and remaining work

- Source implementation and 22 automated tests cover the standalone controller and personal API; frontend/server builds pass.
- Official simulator gestures and actual G2 framebuffers verify the glasses-only journey.
- A deployable server image recipe, production server build and package entrypoint are provided.
- Owner still needs to log into Telegram locally and verify a real message/reaction/save receipt.
- Hosted HTTPS backend, physical device test and live speech endpoint remain unverified.
- Final DoraHacks login, eligibility/team details, video URL acceptance and submission remain outstanding.

Keep the README pre-build disclosure. Submit before November 29, 2026, 19:59 UTC. Do not call the hackathon complete until the entry and required links have been verified.
