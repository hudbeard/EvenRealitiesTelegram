import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LoginAttempt,
  LoginManager,
  LoginInputError,
  writeFileAtomic,
  type LoginOptions,
} from "../server/personal/login.js";
import { SignedOutProvider, SwitchableProvider } from "../server/personal/switchable.js";
import { DemoPersonal } from "../server/personal/demo.js";
import { FakeTimers } from "./helpers/fake-timers.js";
import { FakeTelegram, rpc } from "./helpers/fake-telegram.js";

function setup(overrides: Partial<LoginOptions> = {}) {
  const timers = new FakeTimers();
  const clients: FakeTelegram[] = [];
  const persisted: string[] = [];
  const authorized: string[] = [];
  const options: LoginOptions = {
    apiId: 12345,
    apiHash: "test-hash",
    demo: false,
    timers,
    createClient: () => {
      const c = new FakeTelegram(timers.now);
      clients.push(c);
      return c;
    },
    persist: async (s) => {
      persisted.push(s);
    },
    onAuthorized: async (s) => {
      authorized.push(s);
    },
    ...overrides,
  };
  return { timers, clients, persisted, authorized, options };
}
/** Everything an attempt owns is released. */
function assertReleased(a: LoginAttempt, client: FakeTelegram, timers: FakeTimers) {
  assert.ok(a.terminal, "terminal state");
  assert.equal(a.connected, false, "client reference dropped");
  assert.equal(client.connected, false, "client disconnected");
  assert.equal(a.pendingTimers, 0, "attempt timers cleared");
  assert.equal(timers.pending, 0, "no scheduled timers left");
  assert.equal(client.listenerCount, 0, "update listener removed");
}

test("login: QR happy path connects first, saves, disconnects, hands off", async () => {
  const { timers, clients, persisted, authorized, options } = setup();
  const a = new LoginAttempt("qr", options);
  assert.equal(a.state, "idle");
  const started = a.start();
  assert.equal(a.state, "connecting");
  await started;
  const c = clients[0];
  assert.equal(c.connects, 1);
  assert.equal(c.calls[0], "auth.ExportLoginToken");
  assert.equal(a.state, "qr");
  const v = a.view();
  assert.match(v.qr ?? "", /^data:image\/png;base64,/);
  assert.equal(v.qrVersion, 1);
  assert.equal(v.expiresIn, 30);
  c.scan(); // Telegram pushes UpdateLoginToken
  await a.finished;
  assert.equal(a.state, "done");
  assert.deepEqual(a.view().user, { name: "Ada Lovelace" });
  assert.equal(a.view().pickedUp, true);
  assert.deepEqual(persisted, ["SESSION-1"]);
  assert.deepEqual(authorized, ["SESSION-1"]);
  assertReleased(a, c, timers);
});

test("login: QR refreshes in place on the same client with no leak", async () => {
  const { timers, clients, options } = setup();
  const a = new LoginAttempt("qr", options);
  await a.start();
  const first = a.view().qr;
  for (let i = 2; i <= 6; i++) {
    await timers.advance(27_000);
    // exportToken is started by the refresh timer; wait for the QR render
    // promise (pngjs/zlib I/O), not for a fixed number of event-loop turns.
    await a.idle();
    assert.equal(a.view().qrVersion, i);
  }
  assert.equal(clients.length, 1, "one client for all refreshes");
  assert.equal(clients[0].connects, 1);
  assert.equal(clients[0].calls.filter((n) => n === "auth.ExportLoginToken").length, 6);
  assert.equal(a.view().qrVersion, 6);
  assert.notEqual(a.view().qr, first);
  assert.equal(a.state, "qr");
  // attempt deadline + one refresh timer, never more
  assert.equal(a.pendingTimers, 2);
  assert.equal(clients[0].listenerCount, 1);
  await a.cancel();
  assertReleased(a, clients[0], timers);
});

test("login: QR with 2FA, wrong password re-prompts, then correct password signs in", async () => {
  const { timers, clients, persisted, options } = setup();
  const a = new LoginAttempt("qr", options);
  await a.start();
  const c = clients[0];
  c.twoFactor = true;
  c.scan();
  await a.idle();
  assert.equal(a.state, "awaiting_password");
  assert.equal(a.view().hint, "pet name");
  assert.equal(a.view().qr, undefined);
  await a.submitPassword("wrong");
  assert.equal(a.state, "awaiting_password");
  assert.equal(a.view().error?.code, "WRONG_PASSWORD");
  assert.equal(c.srpRequests, 2, "fresh SRP parameters for the retry");
  assert.equal(c.connected, true, "session kept alive for the retry");
  assert.deepEqual(persisted, []);
  await a.submitPassword("correct horse");
  assert.equal(a.state, "done");
  assert.equal(a.view().error, undefined);
  assert.deepEqual(persisted, ["SESSION-1"]);
  assertReleased(a, c, timers);
});

test("login: phone code path, wrong code then correct, then 2FA", async () => {
  const { timers, clients, persisted, options } = setup();
  const a = new LoginAttempt("phone", options);
  await a.start("+15555550100");
  const c = clients[0];
  assert.deepEqual(c.calls, ["auth.SendCode"]);
  assert.equal(a.state, "awaiting_code");
  await a.submitCode("00000");
  assert.equal(a.state, "awaiting_code");
  assert.equal(a.view().error?.code, "WRONG_CODE");
  c.twoFactor = true;
  await a.submitCode("12345");
  assert.equal(a.state, "awaiting_password");
  assert.equal(a.view().error, undefined);
  await a.submitPassword("correct horse");
  assert.equal(a.state, "done");
  assert.deepEqual(persisted, ["SESSION-1"]);
  assertReleased(a, c, timers);
});

test("login: input in the wrong state or while busy is rejected, not queued", async () => {
  const { clients, options } = setup();
  const a = new LoginAttempt("phone", options);
  await a.start("+15555550100");
  await assert.rejects(a.submitPassword("x"), (e: unknown) => e instanceof LoginInputError && e.status === 409);
  clients[0].hold("auth.SignIn");
  const first = a.submitCode("12345");
  await assert.rejects(a.submitCode("12345"), /Still checking/);
  await a.cancel();
  await first; // in-flight request settles once the client disconnects
  assert.equal(a.state, "cancelled");
});

test("login: too many wrong codes ends the attempt and releases everything", async () => {
  const { timers, clients, options } = setup({ maxInputAttempts: 3 });
  const a = new LoginAttempt("phone", options);
  await a.start("+15555550100");
  for (let i = 0; i < 3; i++) await a.submitCode("00000");
  await a.finished;
  assert.equal(a.state, "error");
  assert.equal(a.view().error?.code, "TOO_MANY_ATTEMPTS");
  assertReleased(a, clients[0], timers);
});

test("login: cancel works in every live state and releases everything", async () => {
  // connecting
  {
    const { timers, clients, options } = setup();
    const a = new LoginAttempt("qr", options);
    const c0 = new FakeTelegram(timers.now);
    c0.holdConnect();
    options.createClient = () => (clients.push(c0), c0);
    const started = a.start();
    assert.equal(a.state, "connecting");
    await a.cancel();
    c0.releaseConnect();
    await started;
    assert.equal(a.state, "cancelled");
    assert.deepEqual(c0.calls, [], "nothing sent after cancel");
    assertReleased(a, c0, timers);
  }
  // qr
  {
    const { timers, clients, options } = setup();
    const a = new LoginAttempt("qr", options);
    await a.start();
    await a.cancel();
    assert.equal(a.state, "cancelled");
    assertReleased(a, clients[0], timers);
  }
  // awaiting_code with a request in flight
  {
    const { timers, clients, options } = setup();
    const a = new LoginAttempt("phone", options);
    await a.start("+15555550100");
    clients[0].hold("auth.SignIn");
    const pending = a.submitCode("12345");
    await a.cancel();
    await pending;
    assert.equal(a.state, "cancelled");
    assertReleased(a, clients[0], timers);
  }
  // awaiting_password
  {
    const { timers, clients, persisted, options } = setup();
    const a = new LoginAttempt("qr", options);
    await a.start();
    clients[0].twoFactor = true;
    clients[0].scan();
    await a.idle();
    assert.equal(a.state, "awaiting_password");
    await a.cancel();
    assert.equal(a.state, "cancelled");
    assert.deepEqual(persisted, []);
    assertReleased(a, clients[0], timers);
  }
  // saving: too late to cancel, the attempt finishes
  {
    let release!: () => void;
    let entered!: () => void;
    const enteredSaving = new Promise<void>((r) => (entered = r));
    const { timers, clients, persisted, options } = setup();
    options.persist = async (s) => {
      entered();
      await new Promise<void>((r) => (release = r));
      persisted.push(s);
    };
    const a = new LoginAttempt("qr", options);
    await a.start();
    clients[0].scan();
    // idle() would wait for persist to finish; wait for it to start instead.
    await enteredSaving;
    assert.equal(a.state, "saving");
    await a.cancel();
    assert.equal(a.state, "saving");
    release();
    await a.finished;
    assert.equal(a.state, "done");
    assert.equal(persisted.length, 1);
    assertReleased(a, clients[0], timers);
  }
  // terminal: no-op
  {
    const { options } = setup();
    const a = new LoginAttempt("qr", options);
    await a.start();
    await a.cancel();
    await a.cancel();
    assert.equal(a.state, "cancelled");
  }
});

test("login: prompt timeout and attempt timeout end in error and release everything", async () => {
  {
    const { timers, clients, options } = setup({ promptTimeoutMs: 60_000 });
    const a = new LoginAttempt("phone", options);
    await a.start("+15555550100");
    await timers.advance(59_000);
    assert.equal(a.state, "awaiting_code");
    await timers.advance(2_000);
    assert.equal(a.state, "error");
    assert.equal(a.view().error?.code, "TIMEOUT");
    assertReleased(a, clients[0], timers);
  }
  {
    const { timers, clients, options } = setup({ attemptTimeoutMs: 10_000 });
    const c0 = new FakeTelegram(timers.now);
    c0.holdConnect(); // Telegram never answers
    options.createClient = () => (clients.push(c0), c0);
    const a = new LoginAttempt("qr", options);
    void a.start();
    await timers.advance(10_000);
    assert.equal(a.state, "error");
    assert.equal(a.view().error?.code, "TIMEOUT");
    assertReleased(a, c0, timers);
  }
});

test("login: flood wait and network loss become terminal errors without retries", async () => {
  {
    const { timers, clients, options } = setup();
    const c0 = new FakeTelegram(timers.now);
    c0.sendCodeError = rpc("FLOOD_WAIT_42", { seconds: 42 });
    options.createClient = () => (clients.push(c0), c0);
    const a = new LoginAttempt("phone", options);
    await a.start("+15555550100");
    assert.equal(a.state, "error");
    assert.deepEqual(a.view().error, {
      code: "FLOOD_WAIT",
      message: "Telegram asked us to wait 42 seconds before trying again.",
      retryAfter: 42,
    });
    assert.equal(c0.calls.length, 1, "no retry");
    assertReleased(a, c0, timers);
  }
  {
    const { timers, clients, options } = setup();
    const a = new LoginAttempt("phone", options);
    await a.start("+15555550100");
    await clients[0].disconnect(); // connection drops under us
    await a.submitCode("12345");
    assert.equal(a.state, "error");
    assert.equal(a.view().error?.code, "NETWORK");
    assertReleased(a, clients[0], timers);
  }
});

test("login: a second concurrent start returns the same QR attempt; others get 429", async () => {
  const { clients, options } = setup();
  const m = new LoginManager(options);
  const first = m.start("qr");
  const again = m.start("qr");
  assert.equal(again.attempt, first.attempt);
  assert.equal(again.existing, true);
  assert.throws(() => m.start("phone", "+15555550100"), (e: unknown) => e instanceof LoginInputError && e.status === 429);
  await first.attempt.idle();
  assert.equal(clients.length, 1, "only one client ever created");
  await first.attempt.cancel();
  const next = m.start("phone", "+15555550100");
  assert.equal(next.existing, false);
  await m.cancelAll();
});

test("login: manager refuses to start without API credentials (live)", () => {
  const { options } = setup({ apiId: 0, apiHash: "" });
  assert.throws(() => new LoginManager(options).start("qr"), (e: unknown) => e instanceof LoginInputError && e.status === 503);
});

test("login: session file is written atomically with 0600 and no temp files left", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fieldline-"));
  const file = join(dir, "nested", "personal.session");
  await writeFileAtomic(file, "first");
  await writeFileAtomic(file, "second");
  assert.equal(await readFile(file, "utf8"), "second");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(join(dir, "nested")), ["personal.session"]);
  // A failed rename leaves the target untouched and removes the temp file.
  const blocked = join(dir, "blocked.session");
  await mkdir(blocked);
  await writeFile(join(blocked, "keep"), "x");
  await assert.rejects(writeFileAtomic(blocked, "data"));
  assert.deepEqual((await readdir(dir)).sort(), ["blocked.session", "nested"]);
});

test("login: wrong password, cancel and errors never touch a good session; demo never writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fieldline-"));
  const file = join(dir, "personal.session");
  await writeFile(file, "GOOD");
  const live = setup({ persist: (s) => writeFileAtomic(file, s) });
  const a = new LoginAttempt("qr", live.options);
  await a.start();
  live.clients[0].twoFactor = true;
  live.clients[0].scan();
  await a.idle();
  await a.submitPassword("wrong");
  await a.cancel();
  assert.equal(await readFile(file, "utf8"), "GOOD");

  let persistCalls = 0,
    handoffs = 0;
  const demo = setup({
    demo: true,
    persist: async (s) => {
      persistCalls++;
      await writeFileAtomic(file, s);
    },
    onAuthorized: async () => {
      handoffs++;
    },
  });
  const d = new LoginAttempt("qr", demo.options);
  await d.start();
  demo.clients[0].scan();
  await d.finished;
  assert.equal(d.state, "done");
  assert.equal(persistCalls, 0);
  assert.equal(handoffs, 0);
  assert.equal(await readFile(file, "utf8"), "GOOD");
});

test("login: hot pick-up swaps the running server onto the new account", async () => {
  const provider = new SwitchableProvider(new SignedOutProvider());
  await assert.rejects(provider.dialogs(), /Sign in to Telegram/);
  assert.equal(provider.signedIn, false);
  const account = new DemoPersonal();
  const sessions: string[] = [];
  const { clients, options } = setup({
    onAuthorized: async (session) => {
      sessions.push(session);
      await provider.swap(account);
    },
  });
  const a = new LoginAttempt("qr", options);
  await a.start();
  clients[0].scan();
  await a.finished;
  assert.equal(a.view().pickedUp, true);
  assert.deepEqual(sessions, ["SESSION-1"]);
  assert.equal(provider.signedIn, true);
  assert.equal((await provider.dialogs()).length, (await account.dialogs()).length);
});

test("login: a failed hand-off still finishes, reports pickedUp false", async () => {
  const { clients, persisted, options } = setup({
    onAuthorized: async () => {
      throw new Error("Telegram refused the new session");
    },
  });
  const a = new LoginAttempt("qr", options);
  await a.start();
  clients[0].scan();
  await a.finished;
  assert.equal(a.state, "done");
  assert.equal(a.view().pickedUp, false);
  assert.equal(persisted.length, 1);
});
