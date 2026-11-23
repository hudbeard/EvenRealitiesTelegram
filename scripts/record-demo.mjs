import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import sharp from "sharp";
const sim = "http://127.0.0.1:9898",
  base = "http://127.0.0.1:3001";
async function json(url, body, token) {
  const r = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(r.ok, `${url}: ${r.status}`);
  return r.json();
}
assert.equal(
  (await json(base + "/api/health")).mode,
  "demo",
  "Recording script only supports synthetic demo mode.",
);
const logs = await json(sim + "/api/console");
assert.ok(
  logs.entries.some((e) => e.message === "FIELDLINE_READY"),
  "Start the official simulator first.",
);
assert.ok(
  logs.entries
    .filter((e) => e.message.startsWith("FIELDLINE_VIEW"))
    .at(-1)
    ?.message.endsWith("inbox paired"),
  "Pair the demo and return to its root before recording.",
);
const p = await json(base + "/api/pair", {});
await json(base + "/api/demo/pair", { code: p.code });
const { token } = await json(base + "/api/pair/" + p.id);
assert.equal(
  (await json(base + "/api/tasks", undefined, token)).tasks.length,
  0,
  "Finish pending demo requests first.",
);
await mkdir("artifacts", { recursive: true });
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
    "artifacts/fieldline-demo.mp4",
  ],
  { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
);
let ffError = "";
ff.stderr.on("data", (b) => (ffError += b));
ff.on("error", (e) => {
  throw e;
});
const stages = [
  [null, 6, "Your crew is waiting for you."],
  ["click", 10, "A coordinator asks for cover at the north entrance."],
  ["click", 10, "Read the request without taking out your phone."],
  ["click", 10, "Choose a short response with a touchpad or the R1 ring."],
  ["click", 12, "Review the chat, bot identity, and exact reply."],
  ["double_click", 10, "Double tap cancels. Nothing has been sent."],
  ["click", 8, "Return to review when you are ready."],
  ["click", 12, "Confirm once. The local demo transport returns a receipt."],
  ["click", 8, "Back to the moment. Ready for the next request."],
];
const ledger = [];
let count = 0;
for (let index = 0; index < stages.length; index++) {
  const [action, seconds, caption] = stages[index];
  if (action) await json(sim + "/api/input", { action });
  if (index === 5)
    assert.equal(
      (await json(base + "/api/tasks", undefined, token)).tasks[0]?.status,
      "pending",
      "Cancel changed the request.",
    );
  const overlay = Buffer.from(
    `<svg width="1280" height="720"><rect width="1280" height="720" fill="#f5f5f0"/><text x="72" y="66" fill="#203c32" font-family="Arial" font-size="28" font-weight="bold" letter-spacing="4">FIELDLINE</text><text x="72" y="104" fill="#6f7f6b" font-family="Arial" font-size="17">Telegram coordination for the crew in motion</text><text x="1208" y="63" text-anchor="end" fill="#6f7f6b" font-family="Arial" font-size="13" letter-spacing="1">LOCAL DEMO / SYNTHETIC DATA</text><text x="640" y="643" text-anchor="middle" fill="#203c32" font-family="Arial" font-size="24">${caption}</text><text x="72" y="692" fill="#6f7f6b" font-family="Arial" font-size="12">Actual 576 x 288 framebuffer captured from the official Even Hub simulator</text><text x="1208" y="692" text-anchor="end" fill="#6f7f6b" font-family="Arial" font-size="12">${index + 1} / ${stages.length}</text></svg>`,
  );
  for (let i = 0; i < seconds * 4; i++) {
    const start = Date.now();
    const raw = Buffer.from(
      await (
        await fetch(sim + "/api/screenshot/glasses", {
          signal: AbortSignal.timeout(5000),
        })
      ).arrayBuffer(),
    );
    const screen = await sharp(raw)
      .flatten({ background: "#07140c" })
      .resize(864, 432, { kernel: "nearest" })
      .png()
      .toBuffer();
    const png = await sharp(overlay)
      .composite([{ input: screen, left: 208, top: 152 }])
      .png()
      .toBuffer();
    if (!ff.stdin.write(png)) await once(ff.stdin, "drain");
    count++;
    await new Promise((r) =>
      setTimeout(r, Math.max(0, 250 - (Date.now() - start))),
    );
  }
  ledger.push({ action, seconds, caption });
  console.log(`Recorded scene ${index + 1}/${stages.length}`);
}
ff.stdin.end();
const [code] = await once(ff, "exit");
assert.equal(code, 0, ffError);
const after = await json(base + "/api/tasks", undefined, token);
assert.equal(after.tasks.length, 0);
assert.equal(after.history[0]?.status, "sent");
await writeFile(
  "artifacts/demo-recording.json",
  JSON.stringify(
    {
      source: "official Even Hub simulator HTTP framebuffer",
      mode: "demo",
      liveTelegram: false,
      frames: count,
      fps: 4,
      durationSeconds: count / 4,
      stages: ledger,
    },
    null,
    2,
  ),
);
console.log(
  `Saved artifacts/fieldline-demo.mp4 (${count / 4} seconds, synthetic data only)`,
);
