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
async function shortcut(offset) {
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
  "Telegram",
  "Start a fresh simulator at Home.",
);
assert.equal((await frame()).badge, "DEMO");
await shot("01-home");
await choose("Unread");
assert.match((await frame()).split.detail, /prototype/);
await shot("02-chats");
await choose("Maya");
assert.match((await frame()).body, /prototype too/);
assert.match((await frame()).footer, /Tap  Reply/);
await shot("03-thread");

const original = await history("demo:maya");
await tap();
assert.equal((await frame()).title, "Reply · Maya");
assert.match((await frame()).split.detail, /get back to you/);
await shot("04-compose");
await choose("Check first");
const reply = (await frame()).body;
assert.equal((await frame()).title, "Send · Maya");
assert.match((await frame()).context, /prototype too/);
await shot("05-review");
await back();
assert.equal((await frame()).badge, "DRAFT");
assert.deepEqual(await history("demo:maya"), original);
await back();
await back();
assert.equal((await frame()).split.heading, "Maya");
await tap();
await tap();
await choose("Review draft");
await tap();
await shot("06-receipt");
const sent = (await history("demo:maya")).at(-1);
assert.equal(sent.text, reply);
assert.equal(sent.replyTo, 11);
await tap();
assert.equal((await frame()).body.split("\n")[0], reply);

await gesture("context_menu");
await shot("06a-shortcuts");
await gesture("down");
await tap();
assert.equal(
  (await frame()).title,
  health.voiceEnabled ? "New message · Maya" : "Keyboard",
);
if (health.voiceEnabled) await choose("Type a message");
await shot("07a-keyboard");
await choose("A B C D E F");
assert.equal((await frame()).native[0], "a");
await gesture("down");
await tap();
assert.match((await frame()).context, /b/);
await choose("Done typing");
await choose("Review draft");
assert.equal((await frame()).body, "b");
await shot("07-keyboard-message");
await tap();
await tap();
assert.equal((await history("demo:maya")).at(-1).replyTo, undefined);

await shortcut(0);
await choose("Save message");
await tap();
await tap();
await back();
await back();
await choose("Saved Messages");
assert.match((await frame()).body, /^b/);
await shot("08-saved");

await shortcut(0);
await choose("React");
assert.deepEqual((await frame()).native, ["Thumbs up", "Heart", "Check"]);
await shot("08a-native-picker");
await gesture("down");
await tap();
assert.match((await frame()).body, /^Heart/);
await tap();
await shot("08b-reaction");
await tap();

await back();
await choose("All chats");
await choose("Maya");
await shortcut(2);
assert.equal((await frame()).title, "Search keyboard");
await choose("Y Z 0 1 2 3");
await gesture("down");
await tap();
await choose("Search");
assert.match((await frame()).body, /No messages match/);
await shot("08c-search-empty");
await back();
assert.match((await frame()).body, /^b/);
await shortcut(3);
assert.equal((await frame()).title, "Build night");
assert.match((await frame()).body, /River Cafe/);
await tap();
assert.equal((await frame()).split.rows[0], "Acknowledge");
await gesture("down");
assert.match((await frame()).split.detail, /6:30/);
await shot("08e-plan-reply");
await back();
await back();
await back();
await choose("Catch-up");
await shot("08d-catchup");
await back();
await choose("Catch-up chats");
await shot("09-watchlist");
await back();
await choose("Settings");
await choose("Controls");
await shot("10-controls");

const errors = (await request(sim + "/api/console")).entries.filter(
  (entry) => entry.level === "error",
);
assert.deepEqual(errors, []);
console.log(
  "PASS: " +
    count +
    " framebuffers, native shortcuts, native focus, reply cancellation, exact send, keyboard, save, reaction and search.",
);
