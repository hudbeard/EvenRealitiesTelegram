import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";

const sim = process.env.SIMULATOR_URL ?? "http://127.0.0.1:9899";
const server = process.env.GLASSES_SERVER_URL ?? "http://127.0.0.1:3003";
await mkdir("artifacts/glasses", { recursive: true });

async function request(url, body, token) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  assert(response.ok, url + " returned " + response.status);
  return response.json();
}
const health = await request(server + "/api/health");
assert.equal(
  health.mode,
  "personal-demo",
  "Only the synthetic backend can be used.",
);
const pairing = await request(server + "/api/pair", {});
await request(server + "/api/pair/approve", { code: pairing.code });
const { token } = await request(server + "/api/pair/" + pairing.id);
assert(token);
if (process.env.EXPECT_STT_FIXTURE === "1") {
  assert.equal(health.voiceEnabled, true);
  const transcribed = await fetch(server + "/api/transcribe", {
    method: "POST",
    body: new Uint8Array(3200),
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/octet-stream",
    },
  });
  assert.equal(transcribed.status, 200);
  assert.equal((await transcribed.json()).text, "I’ll bring the prototype.");
}
const history = async (id) =>
  (
    await request(
      server + "/api/glasses/chats/" + encodeURIComponent(id) + "/messages",
      undefined,
      token,
    )
  ).messages;

async function frame() {
  const logs = await request(sim + "/api/console");
  const last = logs.entries
    .filter((entry) => entry.message.startsWith("GLASSES_FRAME "))
    .at(-1);
  assert(
    last,
    "No synthetic glasses frames. Start a fresh simulator on the demo URL.",
  );
  return JSON.parse(last.message.slice("GLASSES_FRAME ".length));
}
async function gesture(action) {
  await request(sim + "/api/input", { action });
  await delay(380);
  return frame();
}
const tap = () => gesture("click");
const back = () => gesture("double_click");
async function choose(label) {
  for (let i = 0; i < 130; i++) {
    const current = await frame();
    assert(
      current.split,
      "Expected a split menu at " + current.title + " when choosing " + label,
    );
    if (current.split.rows[current.split.index]?.replace(/^● /, "") === label) {
      await tap();
      return;
    }
    const next = await gesture("down");
    if (next.badge === current.badge && next.body === current.body) break;
  }
  throw Error(
    "Could not focus “" + label + "” in " + JSON.stringify(await frame()),
  );
}
async function shortcut(label) {
  const offset =
    (await frame()).shortcuts?.findIndex((action) => action.label === label) ??
    -1;
  assert(offset >= 0, "Shortcut missing: " + label);
  await gesture("context_menu");
  for (let i = 0; i < offset; i++) await gesture("down");
  await tap();
}
let count = 0;
async function shot(name) {
  const response = await fetch(sim + "/api/screenshot/glasses");
  assert(response.ok);
  const png = await sharp(Buffer.from(await response.arrayBuffer()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(png.info.width, 576);
  assert.equal(png.info.height, 288);
  const lit = png.data.filter((byte, i) => i % 4 === 3 && byte).length;
  assert(lit > 100, "Blank screen: " + name);
  await sharp(png.data, { raw: png.info })
    .flatten({ background: "#07140c" })
    .png()
    .toFile("artifacts/glasses/" + name + ".png");
  count++;
  console.log(name, (await frame()).title);
}

if ((await frame()).body.includes("Tap to connect")) {
  await tap();
  await tap();
}
assert.equal(
  (await frame()).title,
  "Chats",
  "Start a fresh simulator at Chats.",
);
assert.equal((await frame()).badge, "DEMO");
assert.equal((await frame()).split.heading, "Maya");
await shot("01-inbox");
await gesture("down");
assert.equal((await frame()).split.heading, "Build night");
await shot("02-inbox-scrolled");
await gesture("up");
assert.equal((await frame()).split.heading, "Maya");
const scrolls = (await request(sim + "/api/console")).entries.filter(
  (entry) =>
    entry.message.includes("EvenHub event:") &&
    (entry.message.includes('"eventType":1') ||
      entry.message.includes('"eventType":2')),
);
assert(scrolls.length >= 2);
assert(
  scrolls.every((entry) =>
    entry.message.includes('"containerName":"gestures"'),
  ),
  "A visible row captured scrolling.",
);

await tap();
assert.equal((await frame()).title, "Maya");
assert.match((await frame()).body, /prototype too/);
await shot("03-thread");
const original = await history("demo:maya");

await tap();
assert.equal((await frame()).title, "Reply · Maya");
assert.match((await frame()).context, /prototype too/);
assert.match((await frame()).footer, /Tap  Send/);
const first = (await frame()).body;
if (process.env.EXPECT_REPLY_IDEAS === "1") {
  assert.match((await frame()).badge, /^AI /);
  assert.equal(first, "Which prototype should I bring?");
}
await shot("04-quick-reply");
await gesture("down");
const chosen = (await frame()).body;
assert.notEqual(chosen, first);
await shot("05-second-idea");
await back();
assert.equal((await frame()).title, "Maya");
assert.deepEqual(await history("demo:maya"), original);
await tap();
assert.equal((await frame()).body, chosen);
await tap();
assert.equal((await frame()).title, "Maya");
assert.match((await frame()).context, /Demo Sent/);
assert.equal((await frame()).body.split("\n")[0], chosen);
const sent = (await history("demo:maya")).at(-1);
assert.equal(sent.text, chosen);
assert.equal(sent.replyTo, 11);
await shot("06-inline-receipt");

await gesture("context_menu");
await shot("07-shortcuts");
await gesture("context_menu");
await shortcut("Message actions");
await choose("Save message");
await tap();
assert.match((await frame()).context, /Demo Saved/);
await back();
assert.equal((await frame()).split.heading, "Maya");
await shortcut("Saved Messages");
assert.equal((await frame()).title, "Saved Messages");
assert.match((await frame()).body, new RegExp(chosen.slice(0, 12)));
await shot("08-saved");

await shortcut("Message actions");
await choose("React");
assert.deepEqual((await frame()).native, ["Thumbs up", "Heart", "Check"]);
await gesture("down");
await tap();
assert.match((await frame()).body, /^Heart/);
await tap();
assert.match((await frame()).context, /Demo Reacted/);
await shot("09-reacted");

await shortcut("Next unread chat");
assert.equal((await frame()).title, "Build night");
await tap();
assert.equal((await frame()).title, "Reply · Build night");
if (process.env.EXPECT_REPLY_IDEAS === "1")
  assert.equal((await frame()).body, "Is River Cafe the final spot?");
await gesture("down");
assert.match((await frame()).body, /6:30/);
await shot("10-plan-idea");
await back();
await back();
await shortcut("Settings");
await choose("Controls");
await shot("11-controls");

const errors = (await request(sim + "/api/console")).entries.filter(
  (entry) => entry.level === "error",
);
assert.deepEqual(errors, []);
console.log(
  "PASS: " +
    count +
    " framebuffers, blank gesture capture, two-tap exact reply, cancellation, inline receipt, native shortcuts, save and reaction.",
);
