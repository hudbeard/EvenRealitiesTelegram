# Verified requirements

Originally verified November 18 through the rendered official page. Rechecked November 23, 2026 by retrieving the official DoraHacks HTML (HTTP 200); the local evidence copy is artifacts/official-event.html. Kickoff changes below supersede the preparation notes.

## Dates and eligibility

- Registration opens November 18. The browser session was logged out; registration has not been performed.
- Build starts November 23 at 08:00 UTC. Submission button was disabled on November 18.
- Submission deadline November 29 at 19:59 UTC.
- Judging November 30–December 1; Demo Day December 3, 14:00–18:00 Dubai time, with remote demos allowed.
- Teams contain 1–4 people. A person may join only one team. A team may submit up to two projects, though the organizers recommend focusing on one.
- Build during the hackathon. Disclose material existing before November 23 in the README.

## Required deliverables

- Public GitHub/GitLab repository with reproducible setup README.
- Demo video, at most three minutes, running in the official simulator or on G2.
- Description covering the problem, intended users, operation, and selected track.
- Optional: up to five API feature requests based on actual implementation experience. Do not invent deficiencies before testing.
- Optional packaged .ehpk build.
- Submit through DoraHacks before the deadline and verify the resulting entry.

## Track constraints

Chosen direction: Messaging & News. Its listed services are Telegram (accounts, bots, channels, Mini Apps), Discord, and Slack. The November 23 rules require the core integration to use a listed app and expressly allow additional supporting tools such as LLM reply drafting or speech-to-text. Entering another track is optional. The cross-track Telegram prize exists, but one project can receive only one cash prize.

Judging weights: usefulness on G2 30%; read and write 25%; technical execution 20%; display and voice UX 15%; business potential and safety 10%.

## Device and app constraints

- 576 by 288 pixels per eye, monochrome green. No glasses camera or speaker.
- Web app inside the Even Realities phone app WebView, using the Even Hub SDK.
- One app visible at a time. No background display or unsolicited overlay alerts.
- No access to notifications from other apps. Integrate directly with the service API.
- SDK provides raw microphone audio; transcription needs a backend.
- Server owns provider secrets. Declare outbound hosts in app.json and handle CORS.
- Google sign-in cannot run inside the WebView; external login or pairing is needed if used.

## Evidence sources

- Official rules: https://dorahacks.io/hackathon/even-realities/detail
- Hardware and architecture: https://hub.evenrealities.com/docs/get-started/overview
- Official starter templates: https://hub.evenrealities.com/docs/get-started/quickstart/templates
- Device input and audio: https://hub.evenrealities.com/docs/build/device-apis
- Simulator: https://hub.evenrealities.com/docs/test/simulator
- Telegram Bot API: https://core.telegram.org/bots/api

The official page differs from third-party mirrors: the allowed service lists, second-place awards, and feature-request deliverable have changed. Use the official page as authoritative.
