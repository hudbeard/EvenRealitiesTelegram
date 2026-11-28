import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoPersonal } from "../server/personal/demo.js";
import { GlassesApp, type Request } from "../src/glasses/controller.js";
import { PairingCountdown } from "../src/glasses/pairing.js";
import { requestTimeout, offlineMessage } from "../src/glasses/net.js";
import {
  DisplaySession,
  SESSION_KEY,
  endDisplaySession,
  memoryStorage,
  startPairing,
  pairPromptBody,
  pairPromptCount,
  welcomeFrame,
} from "../src/glasses/session.js";
import { FakeTimers } from "./helpers/fake-timers.js";

async function demoApp(watched: string[]) {
  const p = new DemoPersonal();
  const calls: { path: string; body: unknown }[] = [];
  let current = [...watched];
  const api: Request = async (path, body?: unknown) => {
    calls.push({ path, body });
    if (path === "/health") return { synthetic: true, voiceEnabled: false };
    if (path === "/glasses/dialogs") return { chats: await p.dialogs(), watched: current };
    if (path === "/watch") {
      const ids = (body as { ids: unknown }).ids;
      if (!Array.isArray(ids)) throw Object.assign(new Error("Choose up to ten chats"), { status: 400 });
      current = ids as string[];
      return { watched: current };
    }
    if (path === "/logout") return { ok: true };
    throw Error(path);
  };
  let exits = 0,
    disconnects = 0;
  const app = new GlassesApp(api, () => {}, async () => {
    exits++;
  });
  app.disconnected = () => disconnects++;
  await app.start();
  return { app, calls, counts: () => ({ exits, disconnects }) };
}

test("watchlist: tapping a watched chat removes it (sends the filtered id list)", async () => {
  const { app, calls } = await demoApp(["demo:maya", "demo:crew"]);
  const first = app.chats[0].id;
  assert.ok(app.watched.includes(first));
  app.watchlist(0, () => app.connection());
  await app.input("tap");
  const sent = calls.filter((c) => c.path === "/watch").at(-1)!.body as { ids: string[] };
  assert.ok(Array.isArray(sent.ids));
  assert.deepEqual(sent.ids, ["demo:maya", "demo:crew"].filter((id) => id !== first));
  assert.equal(app.watched.includes(first), false);
  await app.input("tap"); // and back on again
  assert.equal(app.watched.includes(first), true);
  await app.input("back");
  assert.equal(app.frame.title, "Settings", "Back returns to the caller");
});

test("disconnect confirm: Double tap cancels back to Settings, only Tap disconnects", async () => {
  const { app, calls, counts } = await demoApp([]);
  app.connection();
  const row = app.menu!.rows.findIndex((r) => r.label === "Disconnect display");
  for (let i = 0; i < row; i++) await app.input("down");
  await app.input("tap");
  assert.equal(app.frame.title, "DISCONNECT?");
  assert.match(app.frame.footer, /Tap  Disconnect now\s+Double tap  Back/);
  await app.input("back");
  assert.equal(app.frame.title, "Settings");
  assert.equal(calls.some((c) => c.path === "/logout"), false);
  assert.equal(counts().disconnects, 0);
  for (let i = 0; i < row; i++) await app.input("down");
  await app.input("tap");
  await app.input("tap");
  assert.equal(calls.filter((c) => c.path === "/logout").length, 1);
  assert.equal(counts().disconnects, 1);
});

test("exit confirm: Double tap on Chats asks, Double tap again cancels, Tap exits", async () => {
  const { app, counts } = await demoApp([]);
  assert.equal(app.frame.title, "Chats");
  await app.input("back");
  assert.equal(app.frame.title, "EXIT FIELDLINE?");
  assert.match(app.frame.footer, /Tap  Exit now/);
  await app.input("back");
  assert.equal(app.frame.title, "Chats");
  assert.equal(counts().exits, 0);
  await app.input("back");
  await app.input("tap");
  assert.equal(counts().exits, 1);
});

test("notice: informational screens still continue on Tap or Double tap", async () => {
  const { app } = await demoApp([]);
  let continued = 0;
  app.notice("SERVER", "Info", () => {
    continued++;
  });
  await app.input("tap");
  app.notice("SERVER", "Info", () => {
    continued++;
  });
  await app.input("back");
  assert.equal(continued, 2);
});

test("pairing countdown ticks every second on its own timer and expires", async () => {
  const timers = new FakeTimers();
  const ticks: number[] = [];
  let expired = 0;
  const c = new PairingCountdown(timers.now() + 5_000, (s) => ticks.push(s), () => expired++, timers).start();
  assert.deepEqual(ticks, [5]);
  // An unrelated poll timer being cleared must not stop the countdown.
  const poll = timers.setTimeout(() => {}, 1500);
  timers.clearTimeout(poll);
  await timers.advance(3_000);
  assert.deepEqual(ticks, [5, 4, 3, 2]);
  await timers.advance(2_000);
  assert.deepEqual(ticks, [5, 4, 3, 2, 1]);
  assert.equal(expired, 1);
  assert.equal(c.running, false);
  assert.equal(timers.pending, 0);
});

test("pairing countdown stop() clears its timer and never fires again", async () => {
  const timers = new FakeTimers();
  const ticks: number[] = [];
  const c = new PairingCountdown(timers.now() + 300_000, (s) => ticks.push(s), () => assert.fail("expired"), timers).start();
  await timers.advance(2_000);
  c.stop();
  assert.equal(timers.pending, 0);
  await timers.advance(400_000);
  assert.deepEqual(ticks, [300, 299, 298]);
});

test("request timeouts: 3 s probes, longer for Telegram-backed reads and sends", () => {
  assert.equal(requestTimeout("/health", "GET"), 3_000);
  assert.equal(requestTimeout("/pair", "POST"), 3_000);
  assert.ok(requestTimeout("/glasses/chats/x/messages", "GET") >= 15_000);
  assert.ok(requestTimeout("/glasses/dialogs", "GET") >= 15_000);
  assert.ok(requestTimeout("/glasses/action", "POST") >= 20_000);
  assert.match(offlineMessage("GET"), /Nothing was sent/);
  assert.doesNotMatch(offlineMessage("POST"), /Nothing was sent/);
});

test("401 / pair error copy has a single Tap-to-pair line", () => {
  const expired = pairPromptBody("Display session expired. Tap to pair again.");
  assert.equal(expired, "Display session expired. Tap to pair again.");
  assert.equal((expired.match(/Tap to pair/gi) ?? []).length, 1);
  assert.match(pairPromptBody("Can't reach your server."), /Tap to pair this display/);
});

test("welcome frame has a single pair instruction", () => {
  const frame = welcomeFrame();
  assert.equal(frame.title, "TELEGRAM / FIELDLINE");
  assert.equal(pairPromptCount(frame), 1);
  assert.match(frame.body, /Tap to connect this display/);
  assert.doesNotMatch(frame.body, /Tap to pair this display/);
});

test("disconnect clears the stored token and lands on a Welcome that can start pairing", async () => {
  const storage = memoryStorage({ [SESSION_KEY]: "revoked-token" });
  const session = new DisplaySession(storage);
  assert.equal(session.token, "revoked-token");
  session.pairId = "old-pair";
  session.pairCode = "123456";
  let stopped = 0;
  const { app, calls, counts } = await demoApp([]);
  app.disconnected = () =>
    endDisplaySession(session, () => {
      stopped++;
      session.pairId = "";
      session.pairCode = "";
    }, (frame) => app.emit(frame));
  app.connection();
  const row = app.menu!.rows.findIndex((r) => r.label === "Disconnect display");
  for (let i = 0; i < row; i++) await app.input("down");
  await app.input("tap");
  assert.equal(app.frame.title, "DISCONNECT?");
  await app.input("tap");
  assert.equal(calls.filter((c) => c.path === "/logout").length, 1);
  assert.equal(counts().disconnects, 0); // hook replaced the counter
  assert.equal(session.token, "");
  assert.equal(session.paired, false);
  assert.equal(storage.getItem(SESSION_KEY), null);
  assert.equal(session.pairId, "");
  assert.equal(stopped, 1);
  assert.equal(app.frame.title, "TELEGRAM / FIELDLINE");
  assert.equal(pairPromptCount(app.frame), 1);
  assert.notEqual(app.frame.title, "DISCONNECT?");
  // Unpaired Tap uses startPairing (the same helper main.ts calls).
  const pairCalls: string[] = [];
  const p = await startPairing(session, async (path) => {
    pairCalls.push(path);
    return { id: "new-pair", code: "654321", expiresAt: Date.now() + 300000 };
  });
  assert.deepEqual(pairCalls, ["/pair"]);
  assert.equal(p.id, "new-pair");
  assert.equal(session.pairId, "new-pair");
  assert.equal(session.token, "");
  await assert.rejects(
    startPairing(
      new DisplaySession(memoryStorage({ [SESSION_KEY]: "still-here" })),
      async () => {
        throw new Error("must not start pairing while a token remains");
      },
    ),
    /Already paired/,
  );
});
