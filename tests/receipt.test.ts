import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import { confirm, Telegram } from "../server/telegram.js";
test("an invalid receipt cannot be presented as a successful delivery", async () => {
  const s = new Store(":memory:");
  const now = Date.now();
  const task = {
    id: "request",
    chatId: "-100",
    chatName: "Crew",
    sender: "Maya",
    messageId: 1,
    threadId: null,
    text: "Cover north gate?",
    createdAt: now,
    expiresAt: now + 60000,
  };
  s.add(task);
  const tg = new Telegram(
    "test-token",
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 7, chat: { id: -999 } },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const result = await confirm(s, tg, "request", randomUUID(), 0, "Crew");
  assert.equal(result.status, "uncertain");
  assert.equal(result.receipt, null);
  s.close();
});
