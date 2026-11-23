# Fieldline build plan

Prepared November 18, 2026. This is proposed behavior and verification work; none has been implemented or tested.

Historical pre-build plan. As of November 23, the tap-based application, backend, seven tests, official simulator journey, and local package are implemented. See README.md and the current verification artifacts for actual behavior. Voice remains unimplemented. The original plan below is retained as preparation disclosure, not a claim about current completion.

## Product wedge

Event staff and small operational crews already coordinate in Telegram, but a busy chat is a poor interface when carrying equipment or helping attendees. Fieldline presents requests as a small decision queue. Example: a coordinator asks whether someone can cover the north entrance. The wearer reads the source message, selects an acknowledgement or decline, reviews the exact reply, and confirms it. No automated commitments and no invented status.

Catalogue research found G2 Telegram Viewer, G2Telegram, Talks - Telegram, Elegram, G2gram, and Relay Sight. General Telegram read/write functionality already exists. The differentiation hypothesis is explicit request ownership, short responses, and clear pending/sent/uncertain states for coordination. Catalogue descriptions alone do not establish feature absence; review competitor detail pages before claiming novelty.

## Implementation sequence after kickoff

1. Re-read rules and disclose all pre-build material. Verify Node/npm, registry access, Git, and the supported Windows simulator. Initialize version control and select the actual repository destination.
2. Start from the official minimal Vite/TypeScript template: https://github.com/even-realities/evenhub-templates. Record exact dependency versions. Get one text container and one input working in the official simulator before adding application logic.
3. Implement a server-side Telegram bot integration and authenticated pairing. Keep bot token in an ignored local environment file. Permit only explicitly selected users and chats. Never expose provider tokens to the WebView.
4. Implement the decision queue, reply selection, preview, confirm, cancel, and delivery receipt. Replies sent by a bot must visibly identify their actual sender; do not imply personal-account access. Respect bot privacy and membership limits.
5. Handle lifecycle changes, stale messages, oversized text, disconnects, and lost responses. Persist intent before dispatch, prevent concurrent duplicate confirmation, and never blindly retry an ambiguous send. Display uncertain delivery and reconcile where possible.
6. Add optional voice reply capture only after tap-based read/write works. PCM is 16 kHz signed 16-bit little-endian mono. Stop capture on cancel, exit, background, and error. Confirm transcription before sending. Keep transcription within current allowed services or verify an infrastructure exception; do not assume cross-track AI services are allowed.
7. Build and package; run real simulator journeys; capture the actual demo. Document configuration, limitations, and a reproducible local start.
8. Publish source, complete description and API feedback, upload demo, and submit. Check the public entry and links. Registration/account setup or legal acceptance may need the owner; do not claim a successful submission without evidence.

## Core state journey

Unpaired -> paired -> request queue -> source message -> suggested reply -> preview with chat and recipient -> dispatching -> provider receipt -> next request.

Cancel always returns without sending. No suggestion sends on selection alone. Confirmation binds to a specific request and reviewed text. A newer request cannot silently replace the active preview. Empty queue is a truthful waiting state.

## Verification gates

- A second Telegram test participant creates a real request; it reaches the official simulator through the backend and SDK.
- Ring/touch input navigates and previews the reply. The first selection does not send; explicit confirmation sends once and the other participant sees the reply in the correct chat/thread.
- Repeated taps, duplicate updates, wrong pairing code, unauthorized chat, expired session, disconnect before send, and timeout after send have defined, verified outcomes.
- Source labels and preview remain readable within 576 by 288 without clipping. Long messages paginate or truncate with an explicit route to full context.
- Root double-tap has the expected system exit behavior. Microphone and polling stop with lifecycle transitions.
- Simulator boot logs contain no uncaught exceptions; screenshots show actual framebuffer content. No claim of hardware performance without hardware testing.
- Clean install/build succeeds using README instructions; secrets are excluded from Git and packaged browser assets.
- Final video duration <=180 seconds and shows the actual simulator or glasses plus Telegram receipt. Submission links resolve publicly.

## Official tooling research

Docs show minimal template boot uses waitForEvenAppBridge before SDK calls. Event type CLICK_EVENT is numeric zero and may normalize to undefined; use the SDK definitions and documented handling. Long press/release arrives on sysEvent; text/list input arrives on the capturing container. Only one container captures events.

Simulator documents an HTTP automation plane enabled by --automation-port: ping, screenshots, console, and input endpoints. Use the installed version's actual interface. For framebuffer assertions preserve RGBA; brightness is in alpha and RGB conversion can erase contrast. A simulator is not a hardware emulator and cannot prove BLE timing or real-device performance.

## External prerequisites still needed

DoraHacks registration and final entry; a public GitHub/GitLab destination; a dedicated Telegram test bot and consenting test chat; simulator graphical execution (official tools installed; see environment.md); video capture and hosting. No credentials have been requested or accessed. Keep secrets out of chat and source files.
