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

// MUST 2 — swipe past the last message into the next unread chat

test("ux must2: swiping past the last message opens the next unread chat on its first unread", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Maya");
    await h.app.input("tap"); // Maya, first unread is the last message
    assert.equal(h.app.frame.title, "Maya");
    await h.app.input("down");
    assert.equal(h.app.frame.title, "Build night");
    assert.match(h.app.frame.body, /River Cafe/);
    assert.match(h.app.frame.badge ?? "", /^2 \/ 3$/);
    await h.app.settled();
    assert.equal(h.p.chats.find((c) => c.id === "demo:maya")!.unread, 0);
    await h.app.input("down");
    assert.match(h.app.frame.body, /spare charger/);
    // Nothing else unread: a short caught-up screen, not a dead end.
    await h.app.input("down");
    assert.equal(h.app.frame.title, "You’re caught up");
    assert.match(h.app.frame.footer, /Tap  Inbox/);
    await h.app.input("back"); // back to the same message
    assert.equal(h.app.frame.title, "Build night");
    assert.match(h.app.frame.body, /spare charger/);
    await h.app.input("down");
    await h.app.input("tap"); // Inbox, focused on this chat, no dots left
    assert.equal(h.app.frame.title, "Chats");
    assert.equal(h.app.menu!.rows[h.app.menu!.index].chatId, "demo:crew");
    assert.ok(h.app.menu!.rows.every((r) => !r.label.startsWith("●")));
    assert.equal(h.p.writes.length, 0);
  } finally {
    h.close();
  }
});

test("ux must2: Back from the chat reached by swipe returns to the full inbox on that chat", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Maya");
    await h.app.input("tap");
    await h.app.input("down");
    assert.equal(h.app.frame.title, "Build night");
    await h.app.input("back");
    assert.equal(h.app.frame.title, "Chats");
    assert.equal(h.app.menu!.rows[h.app.menu!.index].chatId, "demo:crew");
    assert.ok(h.app.menu!.rows.some((r) => r.label === "Design team"), "not the unread-only filter");
  } finally {
    h.close();
  }
});

test("ux must2: inside a search, swiping past the end keeps the search end slot", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Maya");
    await h.app.input("tap");
    await h.app.openChat(h.app.chat!, "prototype");
    await h.app.input("down");
    assert.equal(h.app.frame.title, "Maya");
    assert.match(h.app.frame.footer, /Clear search/);
  } finally {
    h.close();
  }
});
