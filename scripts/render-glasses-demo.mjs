import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import sharp from "sharp";
const scenes = [
  [
    "01-inbox",
    "Open straight to chats.",
    "Unread conversations come first, with a preview beside the selected chat.",
  ],
  [
    "02-inbox-scrolled",
    "Swipe through chats without moving the top row.",
    "A blank layer captures swipes while the visible rows stay in place.",
  ],
  [
    "03-thread",
    "One tap opens the conversation.",
    "Tap the message for reply ideas or hold to dictate directly.",
  ],
  [
    "04-quick-reply",
    "The first tap opens a ready-to-send reply.",
    "Model suggestions are shown here using a local fixture and synthetic chats.",
  ],
  [
    "05-second-idea",
    "Swipe to read another reply.",
    "The same card shows the source and the exact outgoing text.",
  ],
  [
    "06-inline-receipt",
    "The second tap sends and returns to the thread.",
    "The reply appears with its receipt. Double tap before sending to keep a draft.",
  ],
  [
    "07-shortcuts",
    "Jump to actions from the native menu.",
    "Find in chat, dictate a new message, or skip directly to the next unread chat.",
  ],
  [
    "08-saved",
    "Open Saved Messages directly.",
    "The inbox shortcut opens your personal Telegram notebook.",
  ],
  [
    "09-reacted",
    "See actions confirmed in the conversation.",
    "The receipt appears inline after you review and confirm a reaction.",
  ],
  [
    "10-plan-idea",
    "Ask about the specific change.",
    "This reply uses the time mentioned in the original message.",
  ],
  [
    "11-controls",
    "Hold to speak, release to review.",
    "Voice search opens results directly. Dictated messages wait for a send tap.",
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
