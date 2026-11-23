import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import {
  confirm,
  ingest,
  Rejected,
  type Transport,
} from "../server/telegram.js";
import { createApp } from "../server/app.js";
const add = (s: Store, id = "group:1") =>
  s.add({
    id,
    chatId: "-100",
    chatName: "Crew",
    sender: "Maya",
    messageId: 1,
    threadId: 4,
    text: "Cover the north gate?",
    createdAt: s.now(),
    expiresAt: s.now() + 300000,
  });
test("concurrent confirmations produce one external send and preserve reviewed reply", async () => {
  const s = new Store(":memory:");
  add(s);
  let calls = 0,
    release!: (id: number) => void;
  const transport: Transport = {
    send: async (t, text) => {
      calls++;
      assert.equal(t.threadId, 4);
      assert.equal(text, "Crew member: On my way.");
      return new Promise((r) => (release = r));
    },
  };
  const id = randomUUID(),
    first = confirm(s, transport, "group:1", id, 0, "Crew member");
  const duplicate = await confirm(
    s,
    transport,
    "group:1",
    id,
    0,
    "Crew member",
  );
  assert.equal(duplicate.status, "sending");
  await assert.rejects(
    confirm(s, transport, "group:1", randomUUID(), 1, "Crew member"),
    /already been handled/,
  );
  await assert.rejects(
    confirm(s, transport, "group:1", id, 1, "Crew member"),
    /does not match/,
  );
  release(42);
  assert.equal((await first).receipt, 42);
  assert.equal(calls, 1);
  assert.equal(
    (await confirm(s, transport, "group:1", id, 0, "Crew member")).status,
    "sent",
  );
  assert.equal(calls, 1);
  s.close();
});
test("ambiguous delivery stays uncertain and cannot be resent", async () => {
  const s = new Store(":memory:");
  add(s);
  let calls = 0;
  const transport = {
    async send() {
      calls++;
      throw new Error("response lost");
    },
  };
  const result = await confirm(
    s,
    transport,
    "group:1",
    randomUUID(),
    0,
    "Crew member",
  );
  assert.equal(result.status, "uncertain");
  await assert.rejects(
    confirm(s, transport, "group:1", randomUUID(), 0, "Crew member"),
  );
  assert.equal(calls, 1);
  s.close();
});
test("explicit provider rejection is distinguished from missing receipt", async () => {
  const s = new Store(":memory:");
  add(s);
  assert.equal(
    (
      await confirm(
        s,
        {
          async send() {
            throw new Rejected();
          },
        },
        "group:1",
        randomUUID(),
        2,
        "Crew member",
      )
    ).status,
    "failed",
  );
  s.close();
});
test("stale request and unauthorized input cannot dispatch", async () => {
  let now = 1000000;
  const s = new Store(":memory:", () => now);
  add(s);
  now += 400000;
  const transport = {
    async send() {
      assert.fail("Expired request dispatched");
      return 0;
    },
  };
  await assert.rejects(
    confirm(s, transport, "group:1", randomUUID(), 0, "Crew"),
    /expired/,
  );
  assert.equal(s.list().length, 0);
  assert.equal(s.get("group:1").status, "expired");
  s.close();
});
test("ingestion accepts only explicit requests in approved group and deduplicates updates", () => {
  const s = new Store(":memory:");
  const now = Date.now();
  const message = {
    message_id: 8,
    message_thread_id: 3,
    date: Math.floor(now / 1000),
    chat: { id: -100, title: "Crew", type: "supergroup" },
    from: { id: 7, first_name: "Maya" },
    text: "/request Cover north entrance?",
  };
  ingest(s, { update_id: 1, message }, "-999", now);
  assert.equal(s.list().length, 0);
  ingest(s, { update_id: 1, message }, "-100", now);
  ingest(s, { update_id: 1, message }, "-100", now);
  assert.equal(s.list().length, 1);
  assert.equal(s.list()[0].threadId, 3);
  ingest(
    s,
    {
      update_id: 2,
      message: {
        ...message,
        message_id: 9,
        text: "Ordinary chat is not a task",
      },
    },
    "-100",
    now,
  );
  assert.equal(s.list().length, 1);
  s.close();
});
test("crash recovery never retries in-flight writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "fieldline-"));
  try {
    const path = join(dir, "db.sqlite");
    let s = new Store(path);
    add(s);
    s.claim("group:1", randomUUID(), "Crew: Done.");
    s.close();
    s = new Store(path);
    assert.equal(s.get("group:1").status, "uncertain");
    s.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test("HTTP pairing, auth boundary, logout, and live-mode demo isolation", async () => {
  const s = new Store(":memory:");
  const app = createApp(
    s,
    { mode: "telegram", origin: "http://example.test", label: "Crew" },
    {
      async send() {
        return 10;
      },
    },
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api`;
  const request = (p: string, body?: unknown, token?: string) =>
    fetch(base + p, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await request("/tasks")).status, 401);
    assert.equal(
      (
        await fetch(base + "/pair", {
          method: "POST",
          headers: { origin: "http://evil.test" },
        })
      ).status,
      403,
    );
    const preflight = await fetch(base + "/tasks", {
      method: "OPTIONS",
      headers: {
        origin: "http://example.test",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "http://example.test",
    );
    assert.match(
      preflight.headers.get("access-control-allow-headers") ?? "",
      /Authorization/,
    );
    const p = (await (await request("/pair", {})).json()) as {
      id: string;
      code: string;
    };
    assert.equal((await request("/demo/pair", { code: p.code })).status, 401);
    assert.equal(s.approve(p.code), true);
    assert.equal(s.approve(p.code), false);
    const { token } = (await (await request("/pair/" + p.id)).json()) as {
      token: string;
    };
    assert.equal((await request("/tasks", undefined, token)).status, 200);
    assert.equal((await request("/demo/request", {}, token)).status, 404);
    await request("/logout", {}, token);
    assert.equal((await request("/tasks", undefined, token)).status, 401);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    s.close();
  }
});
