import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import { DemoPersonal } from "../server/personal/demo.js";
import { PersonalService } from "../server/personal/service.js";
import { page } from "../src/glasses/display.js";
import { GlassesApp, wrap, type Request } from "../src/glasses/controller.js";
test("glasses account scope browses unwatched own dialogs but rejects arbitrary peers", async () => {
  const db = new Store(":memory:"),
    p = new DemoPersonal(),
    s = new PersonalService(db, p);
  try {
    assert.equal(s.watched().length, 0);
    assert.equal((await s.accountHistory("demo:maya")).messages.length, 2);
    await assert.rejects(s.accountHistory("unknown"), /available/);
    await assert.rejects(s.history("demo:maya"), /Choose/);
  } finally {
    db.close();
  }
});
test("new messages need account scope, retain exact text, dispatch once, and Saved Messages is readable", async () => {
  const db = new Store(":memory:"),
    p = new DemoPersonal(),
    s = new PersonalService(db, p);
  try {
    const a = {
        kind: "send" as const,
        chatId: "demo:maya",
        messageId: 0,
        text: "Meet at 6:30? Yes!",
      },
      id = randomUUID();
    await assert.rejects(s.act(id, a, ""), /Invalid action/);
    await Promise.all([s.act(id, a, "", true), s.act(id, a, "", true)]);
    assert.equal(p.writes.length, 1);
    const m = (await s.accountHistory(a.chatId)).messages.at(-1)!;
    assert.equal(m.text, a.text);
    assert.equal(m.replyTo, undefined);
    await s.act(
      randomUUID(),
      { kind: "save", chatId: m.chatId, messageId: m.id },
      m.revision,
      true,
    );
    const saved = await p.saved();
    assert.equal((await s.accountHistory(saved.id)).messages[0].text, a.text);
  } finally {
    db.close();
  }
});
test("glasses composer never sends during selection/review/cancellation; only final confirmation dispatches", async () => {
  const db = new Store(":memory:"),
    p = new DemoPersonal(),
    s = new PersonalService(db, p);
  const api: Request = async (path, body: any) => {
    if (path === "/health") return { synthetic: true, voiceEnabled: false };
    if (path === "/glasses/dialogs")
      return { chats: await p.dialogs(), watched: [] };
    if (path.startsWith("/glasses/chats/")) {
      const id = decodeURIComponent(path.split("/")[3]);
      if (path.endsWith("/read")) return {};
      return s.accountHistory(id);
    }
    if (path === "/glasses/action")
      return s.act(body.operationId, body.action, body.revision, true);
    throw Error(path);
  };
  const app = new GlassesApp(api, () => {});
  try {
    await app.start();
    assert.equal(app.frame.title, "Chats");
    assert.equal(app.frame.split?.heading, "Maya");
    await app.input("tap");
    assert.equal(app.frame.title, "Maya");
    await app.input("tap");
    assert.equal(app.frame.title, "Reply · Maya");
    assert.equal(app.frame.body, "I’ll check and get back to you.");
    await app.input("down");
    assert.equal(app.frame.body, "Can you share a little more detail?");
    await app.input("back");
    assert.equal(p.writes.length, 0);
    await app.input("tap");
    assert.equal(app.frame.body, "Can you share a little more detail?");
    assert.equal(p.writes.length, 0);
    await app.input("tap");
    assert.equal(p.writes.length, 1);
    assert.equal(p.writes[0].kind, "reply");
    assert.equal(p.writes[0].messageId, 11);
    assert.equal(p.writes[0].text, "Can you share a little more detail?");
    assert.equal(app.frame.title, "Maya");
    assert.match(app.frame.context ?? "", /Demo Sent/);
  } finally {
    db.close();
  }
});
test("long text wraps without dropping letters and review paginates before confirmation", async () => {
  const text = "W".repeat(300),
    lines = wrap(text);
  assert.equal(lines.join(""), text);
  let writes = 0;
  const app = new GlassesApp(
    async (path) => {
      assert.equal(path, "/glasses/action");
      writes++;
      return { status: "sent" };
    },
    () => {},
  );
  app.chat = { id: "x", title: "Test", kind: "dm", unread: 0, readMaxId: 0 };
  app.review({ kind: "send", chatId: "x", messageId: 0, text }, "");
  assert.match(app.frame.badge ?? "", /^1 \/ /);
  assert.match(app.frame.footer, /Next page/);
  while (app.frame.footer.includes("Next page")) {
    await app.input("tap");
    assert.equal(writes, 0);
  }
  await app.input("tap");
  assert.equal(writes, 1);
});

test("dictation goes from a message to send review, and Back keeps the draft on that source", async () => {
  const chat = {
    id: "p",
    title: "Plans",
    kind: "group" as const,
    unread: 0,
    readMaxId: 1,
  };
  const source = {
    id: 1,
    chatId: chat.id,
    sender: "Maya",
    text: "Meet at 6?",
    date: 0,
    outgoing: false,
    revision: "r1",
  };
  let writes = 0;
  const app = new GlassesApp(
    async (path) => {
      if (path === "/glasses/action") writes++;
      return { chat, messages: [source], hasOlder: false };
    },
    () => {},
  );
  app.voiceEnabled = true;
  await app.openChat(chat);
  assert.equal(app.canDictate(), true);
  app.prepareDictation();
  await app.voiceText("I’ll be there at six.");
  assert.equal(app.frame.title, "Send · Plans");
  assert.equal(app.frame.body, "I’ll be there at six.");
  assert.equal(app.pending?.messageId, 1);
  assert.equal(writes, 0);
  await app.input("back");
  assert.equal(app.frame.title, "Plans");
  await app.input("tap");
  assert.equal(app.frame.body, "I’ll be there at six.");
  assert.equal(writes, 0);
});

test("a split list has a full-screen blank gesture layer and passive visible rows", () => {
  const layout = page({
    title: "Search",
    icon: "chats",
    badge: "DEMO",
    context: "1 result",
    body: "> Maya",
    footer: "Tap  Open",
    split: { rows: ["Maya"], index: 0, heading: "Maya", detail: "" },
  });
  assert(layout.textObject.length <= 8);
  const capture = layout.textObject.filter((box) => box.isEventCapture === 1);
  assert.equal(capture.length, 1);
  assert.equal(capture[0].containerName, "gestures");
  assert.equal(capture[0].content, " ");
  assert.equal(capture[0].height, 288);
});

test("older pages join the current conversation without losing the newer messages", async () => {
  const chat = {
    id: "p",
    title: "Plans",
    kind: "group" as const,
    unread: 0,
    readMaxId: 29,
  };
  const source = (id: number) => ({
    id,
    chatId: chat.id,
    sender: "Maya",
    text: "Message " + id,
    outgoing: false,
    date: 0,
    revision: "r",
  });
  const app = new GlassesApp(
    async (path) =>
      path.includes("before=30")
        ? { chat, messages: [source(28), source(29)], hasOlder: false }
        : { chat, messages: [source(30), source(31)], hasOlder: true },
    () => {},
  );
  await app.openChat(chat);
  await app.input("up");
  assert.match(app.frame.body, /Load older/);
  await app.input("tap");
  assert.match(app.frame.body, /Message 29/);
  await app.input("down");
  assert.match(app.frame.body, /Message 30/);
});

test("a late model response adds choices without changing the visible send target", async () => {
  const chat = {
    id: "p",
    title: "Plans",
    kind: "group" as const,
    unread: 0,
    readMaxId: 1,
  };
  const source = {
    id: 1,
    chatId: chat.id,
    sender: "Maya",
    text: "Meet at 6?",
    outgoing: false,
    date: 0,
    revision: "r",
  };
  let finish!: (reply: { replies: string[] }) => void;
  const model = new Promise<{ replies: string[] }>((resolve) => {
    finish = resolve;
  });
  const app = new GlassesApp(
    async (path) =>
      path.endsWith("reply-ideas") ? model : { chat, messages: [source] },
    () => {},
  );
  app.replyIdeasEnabled = true;
  await app.openChat(chat);
  await app.input("tap");
  const displayed = app.frame.body;
  finish({ replies: ["Does six still work?"] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.frame.body, displayed);
  await app.input("up");
  assert.equal(app.frame.body, "Does six still work?");
  assert.match(app.frame.badge ?? "", /^AI /);
});
