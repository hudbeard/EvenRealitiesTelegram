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
    await choose("Chats");
    await choose("Maya");
    await app.input("tap");
    await app.input("tap");
    await choose("Reply");
    await choose("Quick replies");
    await choose("On my way.");
    await choose("Review & send");
    assert.equal(p.writes.length, 0);
    await app.input("tap");
    await app.input("back");
    assert.equal(app.draft, "On my way.");
    assert.equal(p.writes.length, 0);
    await choose("Review & send");
    await app.input("tap");
    await choose("Send confirmed");
    assert.equal(p.writes.length, 1);
    assert.equal(p.writes[0].kind, "reply");
    assert.equal(p.writes[0].messageId, 11);
    assert.match(app.frame.title, /SYNTHETIC DEMO RECEIPT/);
  } finally {
    db.close();
  }
});
test("long text wraps without dropping letters and review paginates before confirmation", async () => {
  const text = "x".repeat(300),
    lines = wrap(text);
  assert.equal(lines.join(""), text);
  const app = new GlassesApp((async () => ({})) as Request, () => {});
  app.chat = { id: "x", title: "Test", kind: "dm", unread: 0, readMaxId: 0 };
  app.review({ kind: "send", chatId: "x", messageId: 0, text }, "");
  assert.match(app.frame.title, /1\/2/);
  await app.input("tap");
  assert.equal(app.mode, "read");
  await app.input("tap");
  assert.match(app.frame.title, /CONFIRM/);
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
  assert.match(app.frame.title, /WRITE/);
});
