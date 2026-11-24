import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import { PersonalService } from "../server/personal/service.js";
import { DemoPersonal } from "../server/personal/demo.js";
import { catchup } from "../server/personal/brief.js";
test("edits to older already-read sources appear after the checkpoint without inventing a plan change", () => {
  const cards = catchup(
    [{ id: "one", title: "Chat", kind: "dm", unread: 0, readMaxId: 10 }],
    [
      {
        id: 5,
        chatId: "one",
        sender: "Maya",
        text: "Corrected the spelling.",
        outgoing: false,
        date: 10,
        editedAt: 60,
      },
    ],
    50,
  );
  assert.equal(cards[0]?.title, "A source message was edited");
  assert.equal(cards[0]?.evidence[0].messageId, 5);
});
test("catch-up cards cite the new plan and its linked original without inventing a decision", async () => {
  const p = new DemoPersonal(),
    s = new Store(":memory:"),
    service = new PersonalService(s, p);
  await service.select(["demo:crew", "demo:maya", "demo:design"]);
  const brief = await service.brief();
  assert.equal(brief.cards[0].kind, "change");
  assert.match(brief.cards[0].evidence[0].quote, /River Cafe/);
  assert.match(brief.cards[0].evidence[1].quote, /station/);
  assert.ok(brief.cards.some((c) => c.kind === "commitment"));
  assert.ok(brief.cards.some((c) => c.kind === "reply"));
  assert.ok(brief.cards.every((c) => c.evidence.length));
  s.close();
});
test("unselected chats cannot be read or acted on, and an edit invalidates the reviewed action", async () => {
  const p = new DemoPersonal(),
    s = new Store(":memory:"),
    service = new PersonalService(s, p);
  await assert.rejects(service.history("demo:maya"), /Choose this chat/);
  await service.select(["demo:maya"]);
  const m = (await service.history("demo:maya")).messages.at(-1)!;
  p.messages.find((x) => x.id === m.id && x.chatId === m.chatId)!.text =
    "Actually, no prototype needed.";
  await assert.rejects(
    service.act(
      randomUUID(),
      {
        kind: "reply",
        chatId: m.chatId,
        messageId: m.id,
        text: "I will bring it.",
      },
      m.revision,
    ),
    /Source changed/,
  );
  assert.equal(p.writes.length, 0);
  s.close();
});
test("personal replies are custom, sent once as the user, and bound to their reviewed operation", async () => {
  const p = new DemoPersonal(),
    s = new Store(":memory:"),
    service = new PersonalService(s, p);
  await service.select(["demo:maya"]);
  const m = (await service.history("demo:maya")).messages.at(-1)!;
  const id = randomUUID(),
    action = {
      kind: "reply" as const,
      chatId: m.chatId,
      messageId: m.id,
      text: "Yes, I have the prototype and the charger.",
    };
  const [a, b] = await Promise.all([
    service.act(id, action, m.revision),
    service.act(id, action, m.revision),
  ]);
  assert.ok([a.status, b.status].includes("sent"));
  assert.equal(p.writes.length, 1);
  assert.equal(p.writes[0].text, action.text);
  await assert.rejects(
    service.act(id, { ...action, text: "Something else" }, m.revision),
    /Confirmation changed/,
  );
  s.close();
});
test("opening source can advance normal Telegram read state and a checkpoint clears old catch-up cards", async () => {
  const p = new DemoPersonal(),
    s = new Store(":memory:"),
    service = new PersonalService(s, p);
  await service.select(["demo:maya"]);
  await p.read("demo:maya", 11);
  assert.equal((await p.dialogs())[0].unread, 0);
  service.checkpoint();
  assert.equal((await service.brief()).cards.length, 0);
  s.close();
});
