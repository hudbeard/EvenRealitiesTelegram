import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import sharp from "sharp";
const scenes = [
  [
    "01-home",
    "Telegram starts on the glasses.",
    "A personal-account client with a separate API server.",
  ],
  [
    "02-chats",
    "Your conversations, browsed with G2 or R1.",
    "Unread counts and account conversations; catch-up selection is optional.",
  ],
  [
    "03-thread",
    "Read messages and reply context.",
    "Swipe through the thread. Tap to read the full source.",
  ],
  [
    "04-compose",
    "Compose without a phone textbox.",
    "Quick replies, a ring-controlled keyboard, or configured dictation.",
  ],
  [
    "07a-keyboard",
    "A complete ring keyboard is available.",
    "Choose a letter group, then a letter. Case, punctuation, space and backspace.",
  ],
  [
    "05-review",
    "Review the destination and exact reply.",
    "A separate confirmation sends. Double tap cancels and keeps the draft.",
  ],
  [
    "06-receipt",
    "One confirmed action, one receipt.",
    "This demonstration uses synthetic data. No real messages are sent.",
  ],
  [
    "07-keyboard-message",
    "Write a new message, not just a preset reply.",
    "This single-letter test message was entered with glasses gestures.",
  ],
  [
    "08-saved",
    "Saved Messages is part of the glasses app.",
    "Forward a source, then open your own Telegram notebook.",
  ],
  [
    "08a-reaction",
    "A quick acknowledgement can be a reaction.",
    "Thumbs up, heart or check; the same explicit review flow.",
  ],
  [
    "08b-search-empty",
    "Search the conversation from G2.",
    "Honest empty results; refresh returns to the latest messages.",
  ],
  [
    "08c-catchup",
    "Catch up on what changed.",
    "Source-linked changes, replies, questions and your stated commitments.",
  ],
  [
    "09-watchlist",
    "Manage catch-up chats on the glasses.",
    "Ten selected conversations; the main chat browser remains independent.",
  ],
  [
    "10-controls",
    "Phone for setup. Glasses for the interaction.",
    "Even Hub hosts the bridge. Your backend owns the Telegram session.",
  ],
];
const escape = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
await mkdir("docs/media", { recursive: true });
const ff = spawn(
  process.env.FFMPEG_PATH ?? "C:/ffmpeg/bin/ffmpeg.exe",
  [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "-framerate",
    "1",
    "-i",
    "pipe:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "docs/media/fieldline-glasses-demo.mp4",
  ],
  { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
);
let error = "";
ff.stderr.on("data", (b) => (error += b));
for (const [i, [name, title, caption]] of scenes.entries()) {
  const bg = Buffer.from(
    '<svg width="1280" height="720"><rect width="1280" height="720" fill="#101711"/><text x="64" y="54" font-family="Arial" font-size="20" fill="#c4ee99" letter-spacing="4">FIELDLINE / TELEGRAM ON G2</text><text x="1216" y="54" text-anchor="end" font-family="Arial" font-size="12" fill="#a5b1a4">SYNTHETIC DEMO</text><text x="64" y="108" font-family="Arial" font-size="29" fill="#edf4e8">' +
      escape(title) +
      '</text><text x="640" y="643" text-anchor="middle" font-family="Arial" font-size="18" fill="#c4d0bf">' +
      escape(caption) +
      '</text><text x="64" y="692" font-family="Arial" font-size="12" fill="#a5b1a4">Actual official simulator frame captures · No live Telegram writes · Voice/hardware unverified</text><text x="1216" y="692" text-anchor="end" font-family="Arial" font-size="12" fill="#a5b1a4">' +
      (i + 1) +
      " / " +
      scenes.length +
      "</text></svg>",
  );
  const screen = await sharp(
    await readFile("artifacts/glasses/" + name + ".png"),
  )
    .resize(864, 432, { kernel: "nearest" })
    .toBuffer();
  const frame = await sharp(bg)
    .composite([{ input: screen, left: 208, top: 152 }])
    .png()
    .toBuffer();
  for (let j = 0; j < 8; j++)
    if (!ff.stdin.write(frame)) await once(ff.stdin, "drain");
}
ff.stdin.end();
const [code] = await once(ff, "exit");
if (code !== 0) throw Error(error);
await writeFile(
  "docs/evidence/glasses-demo.json",
  JSON.stringify(
    {
      source: "official Even Hub simulator framebuffer captures",
      synthetic: true,
      liveTelegram: false,
      durationSeconds: scenes.length * 8,
      scenes,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Rendered " + scenes.length * 8 + "-second glasses capture walkthrough.",
);
