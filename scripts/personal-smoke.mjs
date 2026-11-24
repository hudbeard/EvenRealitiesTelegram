import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
const base = "http://127.0.0.1:3003",
  sim = "http://127.0.0.1:9899",
  out = "artifacts/personal";
await mkdir(out, { recursive: true });
async function json(url, body, token) {
  const r = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  assert.ok(r.ok, `${url} ${r.status}`);
  return r.json();
}
assert.equal(
  (await json(base + "/api/health")).synthetic,
  true,
  "Refuse to test-write against a real account.",
);
const p = await json(base + "/api/pair", {});
await json(base + "/api/pair/approve", { code: p.code });
const { token } = await json(base + "/api/pair/" + p.id);
const brief = await json(base + "/api/brief", undefined, token);
assert.equal(brief.cards[0].kind, "change");
assert.match(brief.cards[0].evidence[1].quote, /station/);
const frames = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function snap(name) {
  await delay(600);
  const bytes = Buffer.from(
    await (await fetch(sim + "/api/screenshot/glasses")).arrayBuffer(),
  );
  const { data, info } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 576);
  assert.equal(info.height, 288);
  let lit = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]) lit++;
  assert.ok(lit > 100, `Blank ${name}`);
  await writeFile(`${out}/${name}-raw.png`, bytes);
  await sharp(bytes)
    .flatten({ background: "#07140c" })
    .png()
    .toFile(`${out}/${name}.png`);
  frames.push({ name, lit });
}
async function input(action, name) {
  await json(sim + "/api/input", { action });
  if (name) await snap(name);
  else await delay(200);
}
const logs = await json(sim + "/api/console");
const view =
  logs.entries.filter((e) => e.message.startsWith("PERSONAL_VIEW")).at(-1)
    ?.message ?? "";
if (view.endsWith("unpaired")) {
  await input("click", "01-pairing");
  await input("click", "02-catch-up");
} else await snap("02-catch-up");
await input("click", "03-new-plan-source");
await input("down", "04-original-plan-context");
await input("click", "05-actions");
await input("click", "06-reply-preview");
await input("double_click", "07-cancelled");
await input("click", "08-reply-preview");
await input("click", "09-reply-receipt");
await input("click", "10-next-card");
await input("click");
await input("down");
await input("click");
await input("down");
await input("click", "11-reaction-preview");
await input("click", "12-reaction-receipt");
await input("click");
await input("click");
await input("down");
await input("click");
await input("down");
await input("down");
await input("click", "13-save-preview");
await input("click", "14-save-receipt");
await input("click", "15-commitment");
const finalLogs = await json(sim + "/api/console");
for (const kind of ["reply", "react", "save"])
  assert.ok(
    finalLogs.entries.some(
      (e) => e.message === `PERSONAL_OUTCOME sent ${kind}`,
    ),
    `Missing ${kind} outcome`,
  );
assert.equal(finalLogs.entries.filter((e) => e.level === "error").length, 0);
const h = await json(
  base + "/api/chats/" + encodeURIComponent("demo:crew") + "/messages",
  undefined,
  token,
);
assert.ok(
  h.messages.some((m) => m.outgoing && m.text === "Thanks, I saw the update."),
);
const report = {
  passed: true,
  synthetic: true,
  liveTelegram: false,
  capabilities: [
    "source-linked change detection",
    "original context",
    "personal reply preview",
    "cancel without send",
    "reply as user",
    "reaction",
    "Saved Messages",
    "read state",
  ],
  frames,
};
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    passed: true,
    frames: frames.length,
    report: `${out}/report.json`,
  }),
);
