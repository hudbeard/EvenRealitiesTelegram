import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
test("ordinary old records expire while unresolved writes remain for reconciliation", () => {
  let now = 200000000;
  const s = new Store(":memory:", () => now);
  const task = {
    chatId: "-100",
    chatName: "Crew",
    messageId: 1,
    threadId: null,
    sender: "Maya",
    text: "Cover north gate?",
    createdAt: now,
    expiresAt: now + 1000,
  };
  s.add({ ...task, id: "ordinary" });
  s.add({ ...task, id: "unresolved" });
  s.claim("unresolved", "1234567890123456", "Crew: Done.");
  s.outcome("unresolved", "uncertain");
  now += 25 * 3600000;
  s.list();
  assert.throws(() => s.get("ordinary"), /no longer exists/);
  assert.equal(s.get("unresolved").status, "uncertain");
  s.close();
});
