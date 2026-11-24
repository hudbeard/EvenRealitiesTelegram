import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import sharp from "sharp";
const base = "http://127.0.0.1:3003",
  sim = "http://127.0.0.1:9899";
async function json(url, body) {
  const r = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(r.ok, `${url} ${r.status}`);
  return r.json();
}
assert.equal(
  (await json(base + "/api/health")).mode,
  "personal-demo",
  "Never record test writes against a real account.",
);
const initial = await json(sim + "/api/console");
assert.ok(
  initial.entries
    .filter((e) => e.message.startsWith("PERSONAL_VIEW"))
    .at(-1)
    ?.message.endsWith("brief paired"),
  "Start a paired fresh personal demo first.",
);
const scenes = [
  [null, 5, "What changed while you were away?"],
  ["click", 9, "The new plan stays linked to the original message."],
  ["click", 5, "Reply as yourself, react, or keep the message."],
  ["click", 7, "Review the exact recipient and reply before sending."],
  ["double_click", 5, "Cancel without sending anything."],
  ["click", 4, "Return to the reviewed reply."],
  ["click", 7, "One confirmation, one synthetic personal-account receipt."],
  ["click", 5, "Next: a conversation waiting on you."],
  ["click", 8, "Read the direct reply and what you originally said."],
  ["click", 4, "Choose an action on that source."],
  ["down", 4, "A quick acknowledgement can be a reaction."],
  ["click", 5, "The reaction also has an explicit review."],
  ["click", 6, "Synthetic demo reaction confirmed."],
  ["click", 5, "Your own commitments remain visible."],
  ["click", 7, "Quote what you said; do not invent completion."],
  ["click", 3, "Keep this source for later."],
  ["down", 2, "Choose an action."],
  ["down", 4, "Forward it to your own Saved Messages."],
  ["click", 6, "Review the save destination."],
  ["click", 6, "Synthetic Saved Messages receipt."],
  ["click", 5, "Selected chats. Source context. Actions with your approval."],
];
await mkdir("artifacts", { recursive: true });
const ff = spawn(
  "C:/ffmpeg/bin/ffmpeg.exe",
  [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "-framerate",
    "4",
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
    "artifacts/fieldline-personal-demo.mp4",
  ],
  { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
);
let error = "";
ff.stderr.on("data", (b) => (error += b));
let frames = 0;
for (const [index, [action, seconds, caption]] of scenes.entries()) {
  if (action) await json(sim + "/api/input", { action });
  const overlay = Buffer.from(
    `<svg width="1280" height="720"><rect width="1280" height="720" fill="#f2f3ec"/><text x="72" y="65" fill="#173b33" font-family="Arial" font-size="28" font-weight="bold" letter-spacing="3">FIELDLINE / CATCH-UP</text><text x="72" y="104" fill="#627b65" font-family="Arial" font-size="17">What changed while you were away?</text><text x="1208" y="63" text-anchor="end" fill="#627b65" font-family="Arial" font-size="13">SYNTHETIC PERSONAL-ACCOUNT DEMO</text><text x="640" y="643" text-anchor="middle" fill="#173b33" font-family="Arial" font-size="22">${caption}</text><text x="72" y="692" fill="#627b65" font-family="Arial" font-size="12">Actual official Even Hub simulator framebuffer / No live Telegram writes</text><text x="1208" y="692" text-anchor="end" fill="#627b65" font-family="Arial" font-size="12">${index + 1} / ${scenes.length}</text></svg>`,
  );
  for (let i = 0; i < seconds * 4; i++) {
    const started = Date.now();
    const raw = Buffer.from(
      await (await fetch(sim + "/api/screenshot/glasses")).arrayBuffer(),
    );
    const screen = await sharp(raw)
      .flatten({ background: "#07140c" })
      .resize(864, 432, { kernel: "nearest" })
      .png()
      .toBuffer();
    const frame = await sharp(overlay)
      .composite([{ input: screen, left: 208, top: 152 }])
      .png()
      .toBuffer();
    if (!ff.stdin.write(frame)) await once(ff.stdin, "drain");
    frames++;
    await new Promise((r) =>
      setTimeout(r, Math.max(0, 250 - (Date.now() - started))),
    );
  }
  console.log(`Personal scene ${index + 1}/${scenes.length}`);
}
ff.stdin.end();
const [code] = await once(ff, "exit");
assert.equal(code, 0, error);
const logs = await json(sim + "/api/console");
for (const kind of ["reply", "react", "save"])
  assert.ok(
    logs.entries.some((e) => e.message === `PERSONAL_OUTCOME sent ${kind}`),
  );
await writeFile(
  "artifacts/personal-recording.json",
  JSON.stringify(
    {
      source: "official Even Hub simulator framebuffer",
      synthetic: true,
      liveTelegram: false,
      durationSeconds: frames / 4,
      scenes,
    },
    null,
    2,
  ),
);
console.log(`Saved personal demo: ${frames / 4} seconds.`);
