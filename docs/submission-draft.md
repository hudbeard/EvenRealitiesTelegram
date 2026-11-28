# Submission draft — owner login and final entry still required

## Fieldline — Telegram on G2

Track: Messaging & News.

Fieldline makes G2 the main interface to your personal Telegram account. Browse conversations and unread counts, read message threads and reply context, swipe suggested replies or dictate, review exact text, and send as yourself. React, forward to Saved Messages, search history and manage catch-up chats entirely from G2. The phone hosts Even Hub and supports account setup; a separate backend owns the Telegram session and API.

The distinctive catch-up view answers “what changed while I was away?” using source-linked plan changes, replies, unread questions and your own stated commitments. It opens the underlying conversation before action. It does not invent commitments or automatically send decisions.

Not affiliated with Telegram or Even Realities.

Public source: https://github.com/hudbeard/EvenRealitiesTelegram

Glasses-first video (88 seconds; official simulator captures with captions; synthetic data; recorded Nov 24, **to be re-recorded** on this build): https://raw.githubusercontent.com/hudbeard/EvenRealitiesTelegram/main/docs/media/fieldline-glasses-demo.mp4

The README hero and stills (`docs/media/glasses-home.png`, `glasses-inbox.png`, `glasses-review.png`) are also from Nov 24 and are **to be re-recorded**: https://github.com/hudbeard/EvenRealitiesTelegram/tree/main/docs/media

The primary entrypoint is glasses.html (version 0.5.0). The previous bot and personal companion videos are historical prototypes. New glasses-first simulator captures document browsing, composition/cancellation, confirmed reply, model-backed quick replies and Saved Messages using glasses controls. All published demonstration data is synthetic.

## Verification and remaining work

- Source implementation and 82 automated tests cover the standalone controller, personal API and Telegram sign-in (mocked Telegram); frontend/server builds pass. Sign-in has not been verified against real Telegram or on hardware.
- Official simulator gestures and simulator framebuffers verify the glasses-only journey.
- A deployable server image recipe, production server build and package entrypoint are provided.
- Owner still needs to log into Telegram locally and verify a real message/reaction/save receipt.
- Hosted HTTPS backend, physical device test and live speech endpoint remain unverified.
- Final DoraHacks login, eligibility/team details, video URL acceptance and submission remain outstanding.

Keep the README pre-build disclosure. Submit before November 29, 2026, 19:59 UTC. Do not call the hackathon complete until the entry and required links have been verified.
