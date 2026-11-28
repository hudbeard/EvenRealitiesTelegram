import { test } from "node:test";
import assert from "node:assert/strict";
import { GlassesApp } from "../src/glasses/controller.js";
import { demoHarness, focusRow } from "./helpers/glasses-harness.js";

// MUST 1 — auto-mark-read when a message has been seen

test("ux must1: opening a chat on its first unread marks it read once; the inbox dot clears", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Maya");
    await h.app.input("tap");
    assert.equal(h.app.frame.title, "Maya");
    assert.match(h.app.frame.context ?? "", /UNREAD/); // painted before the ack
    await h.app.settled();
    assert.deepEqual(h.reads(), ["demo:maya#11"]);
    assert.equal(h.p.chats.find((c) => c.id === "demo:maya")!.unread, 0);
    assert.equal(h.app.chats.find((c) => c.id === "demo:maya")!.unread, 0);
    await h.app.input("up");
    await h.app.input("down"); // redraw: no UNREAD and no second /read
    await h.app.settled();
    assert.doesNotMatch(h.app.frame.context ?? "", /UNREAD/);
    assert.deepEqual(h.reads(), ["demo:maya#11"]);
    await h.app.input("back");
    assert.equal(h.app.frame.title, "Chats");
    const maya = h.app.menu!.rows.find((r) => r.chatId === "demo:maya")!;
    assert.doesNotMatch(maya.label, /●/);
  } finally {
    h.close();
  }
});

test("ux must1: swiping through unread messages acknowledges each, in order", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Build night");
    await h.app.input("tap");
    assert.match(h.app.frame.body, /River Cafe/);
    await h.app.input("up"); // older, already read: no ack
    await h.app.input("down");
    await h.app.input("down"); // the second unread
    assert.match(h.app.frame.body, /spare charger/);
    await h.app.settled();
    assert.deepEqual(h.reads(), ["demo:crew#21", "demo:crew#22"]);
    assert.equal(h.p.chats.find((c) => c.id === "demo:crew")!.unread, 0);
    assert.equal(h.app.chats.find((c) => c.id === "demo:crew")!.unread, 0);
  } finally {
    h.close();
  }
});

test("ux must1: search results and long messages are not marked read by a swipe", async () => {
  const reads: number[] = [];
  const chat = { id: "c", title: "Long", kind: "group" as const, unread: 2, readMaxId: 0 };
  const long = { id: 1, chatId: "c", sender: "Leo", text: "W ".repeat(400), outgoing: false, date: 0, revision: "r" };
  const short = { id: 2, chatId: "c", sender: "Leo", text: "Short", outgoing: false, date: 0, revision: "r" };
  const app = new GlassesApp(async (path, body?: any) => {
    if (path.endsWith("/read")) {
      reads.push(body.messageId);
      return {};
    }
    return { chat, messages: path.includes("search=Short") ? [short] : [long, short], hasOlder: false };
  }, () => {});
  app.chats = [chat];
  await app.openChat(chat); // lands on the long unread message
  await app.settled();
  assert.deepEqual(reads, [], "a long message needs Read before it counts as seen");
  await app.openChat(chat, "Short");
  await app.settled();
  assert.deepEqual(reads, [], "a search hit is not marked read by landing on it");
});

test("ux must1: a failed read ack is best-effort and never blocks swiping", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    h.failReads(true);
    await focusRow(h.app, "Build night");
    await h.app.input("tap");
    await h.app.input("down");
    await h.app.settled();
    assert.match(h.app.frame.body, /spare charger/);
    assert.equal(h.p.chats.find((c) => c.id === "demo:crew")!.unread, 2);
    assert.equal(h.app.chats.find((c) => c.id === "demo:crew")!.unread, 2);
  } finally {
    h.close();
  }
});
