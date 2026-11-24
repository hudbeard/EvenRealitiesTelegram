import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import sharp from "sharp";
const scenes = [
  [
    "01-home",
    "Start with the unread inbox.",
    "Use the ring or glasses touchpad to choose where to go.",
  ],
  [
    "02-chats",
    "Preview a chat as you swipe.",
    "The right pane shows the chat type, unread count, and latest message.",
  ],
  [
    "03-thread",
    "Read the message and its context.",
    "A short message opens reply choices with one tap.",
  ],
  [
    "04-compose",
    "Choose the intent and see the exact phrase.",
    "Reply choices use the message context. You can also type or dictate.",
  ],
  [
    "08e-plan-reply",
    "Confirm the new time in a changed plan.",
    "A suggested question can reuse a time mentioned in the source.",
  ],
  [
    "05-review",
    "Review the destination, source, and reply.",
    "Tap to send. Double tap to return to the editable draft.",
  ],
  [
    "06-receipt",
    "See a receipt, then return to the sent reply.",
    "Synthetic demo. The simulator sends no real Telegram messages.",
  ],
  [
    "06a-shortcuts",
    "Open the system shortcut menu.",
    "Tap then hold to jump to message actions, search, or the next unread chat.",
  ],
  [
    "07a-keyboard",
    "Write with the ring keyboard.",
    "Select a letter group, choose a character, then finish or keep typing.",
  ],
  [
    "07-keyboard-message",
    "Review a typed message before sending.",
    "This test typed the lowercase letter b using the native character picker.",
  ],
  [
    "08-saved",
    "Open your Saved Messages.",
    "Send a copy of a message to your own Telegram notebook.",
  ],
  [
    "08a-native-picker",
    "Choose a reaction with native list focus.",
    "The firmware handles list scrolling and selection.",
  ],
  [
    "08c-search-empty",
    "Search and return to your place.",
    "Double tap from results to restore the message you were reading.",
  ],
  [
    "10-controls",
    "Gestures stay consistent across the app.",
    "Use the Even phone app to host the bridge. Your server maintains the Telegram session.",
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
