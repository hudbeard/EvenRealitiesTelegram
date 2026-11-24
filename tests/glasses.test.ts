import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import { DemoPersonal } from "../server/personal/demo.js";
import { PersonalService } from "../server/personal/service.js";
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
  const choose = async (text: string) => {
    const index = app.menu!.rows.findIndex((r) => r.label.includes(text));
    assert(index >= 0, text);
    app.menu!.index = index;
    await app.input("tap");
  };
  try {
    await app.start();
    await choose("Unread");
    await choose("Maya");
    await app.input("tap");
    assert.match(app.frame.title, /Reply · Maya/);
    await choose("Check first");
    assert.equal(app.frame.body, "I’ll check and get back to you.");
    assert.equal(p.writes.length, 0);
    await app.input("back");
    assert.equal(app.draft, "I’ll check and get back to you.");
    await app.input("back");
    await app.input("back");
    assert.equal(app.frame.split?.heading, "Maya");
    await app.input("tap");
    await app.input("tap");
    assert.equal(p.writes.length, 0);
    await choose("Review draft");
    await app.input("tap");
    assert.equal(p.writes.length, 1);
    assert.equal(p.writes[0].kind, "reply");
    assert.equal(p.writes[0].messageId, 11);
    assert.match(app.frame.title, /SYNTHETIC DEMO RECEIPT/);
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

test("back from the glasses keyboard retains typed text in the composer", async () => {
  const app = new GlassesApp(
    async () => ({}),
    () => {},
  );
  app.chat = { id: "x", title: "Test", kind: "dm", unread: 0, readMaxId: 0 };
  app.inputPurpose = "compose";
  app.inputText = "Typed with the ring.";
  app.keyboard();
  await app.input("back");
  assert.equal(app.draft, "Typed with the ring.");
  assert.match(app.frame.title, /New message/);
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
