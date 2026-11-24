import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
const sim = process.env.SIMULATOR_URL ?? "http://127.0.0.1:9899";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir("artifacts/glasses", { recursive: true });
async function frame() {
  const c = await (await fetch(sim + "/api/console")).json();
  const entry = c.entries
    .filter((x) => x.message.startsWith("GLASSES_FRAME "))
    .at(-1);
  assert(entry, "Glasses frame missing");
  return JSON.parse(entry.message.slice(14));
}
async function gesture(action) {
  const r = await fetch(sim + "/api/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  assert(r.ok);
  await pause(350);
  return frame();
}
async function tap() {
  return gesture("click");
}
async function back() {
  return gesture("double_click");
}
async function choose(label) {
  for (let i = 0; i < 24; i++) {
    const f = await frame(),
      focused = f.body.split("\n").find((l) => l.startsWith("> "));
    if (focused?.includes(label)) {
      await tap();
      return;
    }
    await gesture("down");
  }
  throw Error(
    "Menu item missing: " + label + " " + JSON.stringify(await frame()),
  );
}
let count = 0;
async function shot(name) {
  await pause(200);
  const raw = Buffer.from(
    await (await fetch(sim + "/api/screenshot/glasses")).arrayBuffer(),
  );
  const { data, info } = await sharp(raw)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 576);
  assert.equal(info.height, 288);
  let lit = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]) lit++;
  assert(lit > 100, "Empty glasses framebuffer");
  await writeFile(
    "artifacts/glasses/" + name + ".png",
    await sharp(raw).flatten({ background: "#07140c" }).png().toBuffer(),
  );
  count++;
  console.log(name, JSON.stringify(await frame()));
}
let f = await frame();
for (
  let i = 0;
  i < 6 &&
  !f.title.includes("TELEGRAM / SYNTHETIC DEMO") &&
  !f.body.includes("Tap to connect");
  i++
)
  f = await back();
if (f.body.includes("Tap to connect")) {
  await tap();
  await tap();
  await pause(500);
}
assert(
  (await frame()).title.includes("SYNTHETIC DEMO"),
  "Use a fresh synthetic demo simulator",
);
await shot("01-home");
await choose("Chats");
await shot("02-chats");
await choose("Maya");
for (let i = 0; i < 40 && !(await frame()).body.includes("prototype too"); i++)
  await gesture("up");
assert((await frame()).body.includes("prototype too"));
await shot("03-thread");
await tap();
await tap();
await choose("Reply to this");
await shot("04-compose");
await choose("Quick replies");
await choose("On my way.");
await choose("Review & send");
await shot("05-review");
await tap();
assert((await frame()).title.includes("CONFIRM"));
await back();
await choose("Review & send");
assert((await frame()).body.includes("On my way."), "Cancel lost draft");
await tap();
await choose("Send confirmed");
await shot("06-receipt");
assert((await frame()).title.includes("SYNTHETIC DEMO RECEIPT"));
await tap();
// Compose a new message using only the ring keyboard, without any phone textbox.
for (
  let i = 0;
  i < 44 && !(await frame()).body.includes("Conversation options");
  i++
)
  await gesture("down");
assert((await frame()).body.includes("Conversation options"));
await tap();
await choose("Write a new");
await choose("Glasses keyboard");
await shot("07a-keyboard");
await choose("A B C D E F");
await choose("A");
await gesture("up");
await tap();
await choose("Review & send");
await shot("07-keyboard-message");
assert((await frame()).body.includes("New message\na"));
await tap();
await choose("Send confirmed");
assert((await frame()).title.includes("RECEIPT"));
await tap();
// Saving a message is independently reviewed, then visible in Telegram Saved Messages.
await tap();
await tap();
await choose("Save message");
await tap();
await choose("Send confirmed");
assert((await frame()).body.includes("Saved to Saved Messages"));
await tap();
await back();
await back();
await choose("Saved Messages");
await shot("08-saved");
assert((await frame()).body.includes("a"));
await tap();
await tap();
await choose("React");
await choose("Thumbs up");
await tap();
await choose("Send confirmed");
await shot("08a-reaction");
await tap();
await back();
await back();
await choose("Chats");
await choose("Maya");
await tap();
await tap();
await choose("Search this");
await choose("Y Z 0 1 2 3");
await choose("Z");
await gesture("up");
await tap();
await shot("08b-search-empty");
assert((await frame()).body.includes("No messages match"));
await back();
await back();
await choose("Chats");
await choose("Find a conversation");
await gesture("long_press");
assert((await frame()).title.includes("VOICE UNAVAILABLE"));
await tap();
assert((await frame()).title.includes("FIND:"));
await back();
await back();
await choose("Catch-up");
await shot("08c-catchup");
await back();
await choose("Catch-up chats");
await shot("09-watchlist");
await tap();
await tap();
await back();
await choose("Connection & controls");
await choose("Controls");
await shot("10-controls");
console.log(
  "PASS: " +
    count +
    " G2 framebuffer captures; glasses-only pairing, reading, reply, cancellation, new keyboard message, save, reactions, search, catch-up, watchlist, controls. Synthetic data only.",
);
