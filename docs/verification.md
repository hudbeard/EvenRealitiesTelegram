# Verification record — November 23, 2026

These are observed local results, not a claim of a completed hackathon submission.

## Clean source setup

An isolated copy of the source, package manifest, and lockfile was installed into `.verification` without copying credentials, databases, or existing dependencies. `npm ci --ignore-scripts --no-audit --no-fund`, `npm run build`, and `npm test` completed successfully there using Node 24.18.0. All nine tests passed. This verifies the source can build and execute its backend tests from a clean dependency install.

The tests cover conflicting/concurrent confirmations, reply binding, lost receipts, explicit provider rejection, invalid receipt destinations, request expiry, group/request scope and deduplication, crash recovery, retention, HTTP authentication, live/demo isolation, and CORS preflight handling. Provider transport tests use controlled responses; they do not prove that a real Telegram account received a message.

## Official simulator

Even Hub simulator 0.9.5 was started against the production build at `http://127.0.0.1:3001`, with automation on loopback port 9898. Its console reported `FIELDLINE_READY`. The automation journey exercised a request read, reply selection, explicit review, double-tap cancellation without a send, a subsequent confirmed send producing exactly one synthetic receipt, returning to an empty queue, and root double-tap shutdown. The framebuffer became blank only after the explicit shutdown command.

The first run also captured demo pairing by tap. Subsequent runs preserved the paired session and tested the remaining journey. The recorded repeat-run report is [evidence/simulator-report.json](evidence/simulator-report.json). No error entries were present in that run's simulator console. The 576 × 288 raw PNGs were kept as RGBA; presentation copies flatten alpha onto a dark background. These are real framebuffer captures rather than recreated app mockups.

## Video

[media/fieldline-demo.mp4](media/fieldline-demo.mp4) is an H.264 MP4 at 1280 × 720. ffprobe reported exactly **86.000 seconds**, below the 180-second limit. It captures the running official simulator framebuffer at four frames per second with explanatory captions. Every scene is labelled local demo / synthetic data. The source recording ledger is [evidence/demo-recording.json](evidence/demo-recording.json).

This video verifies the demonstrated simulator flow. It does not verify live Telegram delivery. A final connected demo should show an actual consenting group request and the real bot reply in that same thread.

## Package

The official Even Hub CLI 0.2.0 created a 39,680-byte local `.ehpk` at the time of the first package check, using SDK 0.0.16 and minimum Even App 2.2.10. The pack script supplies an explicit backend origin and matching network permission whitelist. The generated default package points to this computer's localhost and is for simulator development; it is not a verified phone/device deployment.

## Still required

- Live Telegram configuration, wearer pairing, and verified request/reply receipt in the consenting group.
- Verification of the published GitHub tree and public demo link after upload.
- DoraHacks registration/account details, final form completion, and verified successful submission.
- Hosted HTTPS backend and hardware tests if a deployable device package is provided.

The goal remains incomplete until the required live integration and submission evidence exist.
