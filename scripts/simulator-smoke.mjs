import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import sharp from "sharp";
const sim = process.env.SIMULATOR_URL ?? "http://127.0.0.1:9898";
const base = process.env.FIELDLINE_URL ?? "http://127.0.0.1:3001";
const out = "artifacts/simulator";
await mkdir(out, { recursive: true });
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
  "This smoke test must never run against Telegram mode.",
);
const pair = await json(base + "/api/pair", {});
await json(base + "/api/demo/pair", { code: pair.code });
const { token } = await json(base + "/api/pair/" + pair.id);
const before = await json(base + "/api/tasks", undefined, token);
assert.equal(
  before.tasks.length,
  0,
  "Use a fresh demo database before this test.",
);
const previousSent = before.history.filter((t) => t.status === "sent").length;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function snap(name) {
  await delay(500);
  const bytes = Buffer.from(
    await (await fetch(sim + "/api/screenshot/glasses")).arrayBuffer(),
  );
  await writeFile(`${out}/${name}-raw.png`, bytes);
  const { data, info } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 576);
  assert.equal(info.height, 288);
  let lit = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]) lit++;
  if (name === "12-system-exit")
    assert.equal(lit, 0, "Root double-tap must shut down the display.");
  else assert.ok(lit > 100, `Blank screen at ${name}`);
  await sharp(bytes)
    .flatten({ background: "#07140c" })
    .png()
    .toFile(`${out}/${name}.png`);
  return { name, lit };
}
const frames = [];
frames.push(await snap("01-welcome"));
async function input(action, name) {
  await json(sim + "/api/input", { action });
  frames.push(await snap(name));
}
const initialLogs = await json(sim + "/api/console");
const view =
  initialLogs.entries
    .filter((e) => e.message.startsWith("FIELDLINE_VIEW"))
    .at(-1)?.message ?? "";
if (view.endsWith("unpaired")) {
  await input("click", "02-pair-code");
  await input("click", "03-paired");
}
await input("click", "04-request");
const testedTask = (await json(base + "/api/tasks", undefined, token)).tasks[0];
assert.ok(testedTask);
await input("click", "05-read");
await input("click", "06-replies");
await input("click", "07-preview");
await input("double_click", "08-cancelled");
assert.equal(
  (await json(base + "/api/tasks", undefined, token)).history.filter(
    (t) => t.status === "sent",
  ).length,
  previousSent,
  "Cancel must not send a reply.",
);
await input("click", "09-preview-again");
await input("click", "10-receipt");
const after = await json(base + "/api/tasks", undefined, token);
const delivered = after.history.find((t) => t.id === testedTask.id);
assert.equal(
  delivered?.status,
  "sent",
  "Confirmation must yield a receipt for this request.",
);
assert.equal(delivered.reply, "Crew member: On my way.");
await input("click", "11-caught-up");
await input("double_click", "12-system-exit");
const logs = await json(sim + "/api/console");
const errors = logs.entries.filter((e) => e.level === "error");
assert.deepEqual(
  errors,
  [],
  "Simulator contains errors. Start a fresh simulator session.",
);
assert.ok(logs.entries.some((e) => e.message === "FIELDLINE_READY"));
assert.ok(
  logs.entries.some((e) => e.message.includes("FIELDLINE_OUTCOME sent")),
);
await writeFile(
  `${out}/report.json`,
  JSON.stringify(
    {
      mode: "demo",
      telegramCalls: false,
      checks: [
        "official simulator boot",
        "576x288 framebuffer",
        "pairing",
        "request read",
        "reply preview",
        "cancel without send",
        "one confirmation receipt",
        "root exit gesture",
      ],
      frames,
      errors,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    passed: true,
    frames: frames.length,
    report: `${out}/report.json`,
  }),
);
