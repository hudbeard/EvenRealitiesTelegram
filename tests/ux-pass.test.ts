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

// MUST 3 — suggested replies on the review screen; send is two taps

test("ux must3: Tap Reply → review with ideas → Tap Send now (two taps), guarded and confirmed", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Maya");
    await h.app.input("tap"); // tap 1: open the chat on its unread message
    await h.app.input("tap"); // reply: review screen with the first idea
    assert.equal(h.app.frame.title, "Send · Maya");
    assert.equal(h.app.frame.badge, "1 / 2");
    assert.equal(h.app.frame.context, "Re Maya: Can you bring the prototype too?");
    assert.equal(h.app.frame.body, "I’ll check and get back to you.");
    assert.equal(h.app.frame.footer, "Swipe  Ideas     Tap  Send now     Double tap  Back");
    await h.app.input("tap"); // same instant: the entry guard holds
    h.tick(999);
    await h.app.input("tap"); // still inside 1 s
    assert.equal(h.p.writes.length, 0);
    h.tick(1);
    await h.app.input("tap"); // send
    assert.equal(h.p.writes.length, 1);
    assert.deepEqual(h.p.writes[0], {
      kind: "reply",
      chatId: "demo:maya",
      messageId: 11,
      text: "I’ll check and get back to you.",
    });
    const action = h.calls.find((c) => c.path === "/glasses/action")!;
    assert.equal(action.body.confirmed, true);
    assert.match(h.app.frame.context ?? "", /Demo Sent/);
  } finally {
    h.close();
  }
});

test("ux must3: swiping ideas never re-arms or skips the guard and sends the idea shown", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Maya");
    await h.app.input("tap");
    await h.app.input("tap");
    await h.app.input("down"); // swipe right away
    await h.app.input("tap"); // still the opening guard
    assert.equal(h.p.writes.length, 0);
    h.tick(1500);
    await h.app.input("up");
    await h.app.input("down"); // swipes after the guard do not re-arm it
    assert.equal(h.app.frame.body, "Can you share a little more detail?");
    await h.app.input("tap");
    assert.equal(h.p.writes.length, 1);
    assert.equal(h.p.writes[0].text, "Can you share a little more detail?");
  } finally {
    h.close();
  }
});

test("ux must3: Double tap on review sends nothing; the server rejects unconfirmed actions", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Maya");
    await h.app.input("tap");
    await h.app.input("tap");
    h.tick(5000);
    await h.app.input("back");
    assert.equal(h.app.frame.title, "Maya");
    assert.equal(h.p.writes.length, 0);
    assert.equal(h.calls.filter((c) => c.path === "/glasses/action").length, 0);
    // The harness mirrors index.ts: without confirmed:true nothing is written.
    await assert.rejects(
      h.app.api("/glasses/action", { operationId: "x", action: h.app.pending, revision: "" }),
      /Review and confirm first/,
    );
    assert.equal(h.p.writes.length, 0);
  } finally {
    h.close();
  }
});

test("ux must3: Message actions → Reply lands on the same review screen", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Maya");
    await h.app.input("tap");
    await h.app.selectShortcut(5); // Message actions
    assert.equal(h.app.frame.title, "Message actions");
    await h.app.input("tap"); // Reply
    assert.equal(h.app.frame.title, "Send · Maya");
    assert.match(h.app.frame.footer, /Tap  Send now/);
    await h.app.input("tap");
    assert.equal(h.p.writes.length, 0, "the tap that chose Reply cannot send");
  } finally {
    h.close();
  }
});

test("ux must3: an idea too long for one screen goes to paginated review before Send now", async () => {
  const long = "Sure — " + "I can bring it along with the spare cables and charger. ".repeat(8);
  const h = demoHarness({ ideas: async () => [long] });
  try {
    await h.app.start();
    await focusRow(h.app, "Maya");
    await h.app.input("tap");
    await h.app.input("tap"); // AI idea first (arrives within 750 ms)
    assert.match(h.app.frame.badge ?? "", /^AI 1 \//);
    assert.match(h.app.frame.footer, /Tap  Review/);
    h.tick(1000);
    await h.app.input("tap"); // to the full, paginated review
    assert.equal(h.app.frame.title, "Send · Maya");
    assert.match(h.app.frame.footer, /Next page/);
    while (h.app.frame.footer.includes("Next page")) await h.app.input("tap");
    assert.match(h.app.frame.footer, /Tap  Send now/);
    assert.equal(h.p.writes.length, 0);
    h.tick(1000);
    await h.app.input("tap");
    assert.equal(h.p.writes.length, 1);
    assert.equal(h.p.writes[0].text, long);
  } finally {
    h.close();
  }
});

test("ux must3: ideas come from the reply rules or the configured model, labeled as ideas", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Build night");
    await h.app.input("tap"); // "Update: meet at River Cafe at 6:30 instead…"
    await h.app.input("tap");
    assert.equal(h.app.frame.body, "Got it, thanks for the update.");
    await h.app.input("down");
    assert.equal(h.app.frame.body, "Is 6:30 the new time?");
    assert.doesNotMatch(h.app.frame.badge ?? "", /^AI/);
    // Nothing is added to the conversation until Send now.
    assert.equal(h.p.messages.filter((m) => m.chatId === "demo:crew").length, 3);
  } finally {
    h.close();
  }
});
