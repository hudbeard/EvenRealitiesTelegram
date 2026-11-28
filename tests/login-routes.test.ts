import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { JSDOM } from "jsdom";
import { DemoClient, LoginManager, realTimers, type LoginOptions } from "../server/personal/login.js";
import { loginRoutes } from "../server/personal/login-routes.js";
import { FakeTimers } from "./helpers/fake-timers.js";
import { FakeTelegram } from "./helpers/fake-telegram.js";

async function serve(manager: LoginManager, routeOptions: Parameters<typeof loginRoutes>[1] = {}) {
  const app = express();
  app.use(express.json());
  app.get("/login", (_req, res) => res.sendFile(resolve("public/login.html")));
  app.use("/api", loginRoutes(manager, routeOptions));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  return {
    base,
    call,
    close: async () => {
      await manager.cancelAll();
      await new Promise((r) => server.close(r));
    },
  };
}
function liveOptions(timers: FakeTimers): LoginOptions {
  return {
    apiId: 1,
    apiHash: "h",
    demo: false,
    timers,
    createClient: () => new FakeTelegram(timers.now),
    persist: async () => {},
    onAuthorized: async () => {},
  };
}

test("login routes: start requests are rate-limited per IP and the window resets", async () => {
  const timers = new FakeTimers();
  const s = await serve(new LoginManager(liveOptions(timers)), { now: timers.now, startLimit: 2 });
  try {
    const a = await s.call("POST", "/login/qr/start", {});
    assert.equal(a.status, 201);
    assert.equal((await s.call("POST", "/login/qr/start", {})).status, 200); // same attempt back
    const third = await s.call("POST", "/login/qr/start", {});
    assert.equal(third.status, 429);
    assert.match(third.body.error, /Too many sign-in attempts/);
    await timers.advance(60_000);
    assert.notEqual((await s.call("POST", "/login/qr/start", {})).status, 429);
  } finally {
    await s.close();
  }
});

test("login routes: overall limit applies to polling too", async () => {
  const timers = new FakeTimers();
  const s = await serve(new LoginManager(liveOptions(timers)), { now: timers.now, limit: 3 });
  try {
    const { body } = await s.call("POST", "/login/qr/start", {});
    assert.equal((await s.call("GET", "/login/" + body.id)).status, 200);
    assert.equal((await s.call("GET", "/login/" + body.id)).status, 200);
    assert.equal((await s.call("GET", "/login/" + body.id)).status, 429);
  } finally {
    await s.close();
  }
});

test("login routes: concurrent session cap rejects a second attempt until the first ends", async () => {
  const timers = new FakeTimers();
  const s = await serve(new LoginManager({ ...liveOptions(timers), maxActive: 1 }), { now: timers.now });
  try {
    const qr = await s.call("POST", "/login/qr/start", {});
    const phone = await s.call("POST", "/login/phone/start", { phone: "+15555550100" });
    assert.equal(phone.status, 429);
    assert.match(phone.body.error, /already in progress/);
    const cancelled = await s.call("POST", `/login/${qr.body.id}/cancel`, {});
    assert.equal(cancelled.body.state, "cancelled");
    const again = await s.call("POST", "/login/phone/start", { phone: "+15555550100" });
    assert.equal(again.status, 201);
  } finally {
    await s.close();
  }
});

test("login routes: validation, unknown attempts and demo-only scan", async () => {
  const timers = new FakeTimers();
  const s = await serve(new LoginManager(liveOptions(timers)), { now: timers.now });
  try {
    assert.equal((await s.call("POST", "/login/phone/start", { phone: "call me" })).status, 400);
    assert.equal((await s.call("GET", "/login/nope")).status, 404);
    const { body } = await s.call("POST", "/login/qr/start", {});
    assert.equal((await s.call("POST", `/login/${body.id}/simulate-scan`, {})).status, 404);
    assert.equal((await s.call("POST", `/login/${body.id}/password`, { password: "" })).status, 400);
  } finally {
    await s.close();
  }
});

test("login page (jsdom, demo server): QR is an <img> data URL and the flow reaches Signed in as Demo User", async () => {
  const manager = new LoginManager({
    apiId: 0,
    apiHash: "",
    demo: true,
    timers: realTimers,
    createClient: () => new DemoClient(realTimers, 60_000), // scan by button
    persist: async () => {
      throw new Error("demo must not persist");
    },
    onAuthorized: async () => {
      throw new Error("demo must not hand off");
    },
  });
  const s = await serve(manager);
  const dom = await JSDOM.fromURL(s.base + "/login", {
    runScripts: "dangerously",
    beforeParse(window) {
      const w = window as unknown as { fetch: typeof fetch; FIELDLINE_LOGIN_POLL_MS: number };
      w.fetch = (input, init) => fetch(new URL(String(input), s.base), init);
      w.FIELDLINE_LOGIN_POLL_MS = 50;
    },
  });
  const doc = dom.window.document;
  const waitFor = async (cond: () => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error("timed out; status: " + doc.getElementById("status")?.textContent);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  try {
    await waitFor(() => !!doc.querySelector("#qr-image img"));
    const img = doc.querySelector("#qr-image img") as HTMLImageElement;
    assert.equal(img.tagName, "IMG");
    assert.match(img.getAttribute("src") ?? "", /^data:image\/png;base64,[A-Za-z0-9+/=]{100,}$/);
    assert.equal(img.getAttribute("alt"), "Telegram sign-in QR code");
    assert.equal(doc.getElementById("qr-image")!.textContent, "", "no raw data URL text");
    assert.equal(doc.getElementById("qr-demo")!.classList.contains("hidden"), false);
    (doc.getElementById("simulate-scan") as HTMLButtonElement).click();
    await waitFor(() => /Signed in as Demo User/.test(doc.getElementById("status")!.textContent ?? ""));
    assert.equal(doc.getElementById("done-link")!.classList.contains("hidden"), false);
    assert.equal(manager.active().length, 0);
  } finally {
    dom.window.close();
    await s.close();
  }
});

test("login page (jsdom, demo server): phone path with a wrong code re-prompts, then signs in", async () => {
  const manager = new LoginManager({
    apiId: 0,
    apiHash: "",
    demo: true,
    createClient: () => new DemoClient(realTimers, 60_000),
    persist: async () => {},
    onAuthorized: async () => {},
  });
  const s = await serve(manager);
  const dom = await JSDOM.fromURL(s.base + "/login", {
    runScripts: "dangerously",
    beforeParse(window) {
      const w = window as unknown as { fetch: typeof fetch; FIELDLINE_LOGIN_POLL_MS: number };
      w.fetch = (input, init) => fetch(new URL(String(input), s.base), init);
      w.FIELDLINE_LOGIN_POLL_MS = 50;
    },
  });
  const doc = dom.window.document;
  const $ = (id: string) => doc.getElementById(id)!;
  const status = () => $("status").textContent ?? "";
  const waitFor = async (cond: () => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error("timed out; status: " + status());
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const submit = (id: string) =>
    $(id).dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  try {
    await waitFor(() => !!doc.querySelector("#qr-image img"));
    (doc.querySelector('[data-method="phone"]') as HTMLButtonElement).click();
    await waitFor(() => !$("phone-form").classList.contains("hidden"));
    await waitFor(() => manager.active().length === 0); // QR attempt cancelled by the switch
    ($("phone-number") as HTMLInputElement).value = "+15555550100";
    submit("phone-form");
    await waitFor(() => !$("code-form").classList.contains("hidden"));
    ($("phone-code") as HTMLInputElement).value = "00000";
    submit("code-form");
    await waitFor(() => /not right/.test(status()));
    assert.equal($("code-form").classList.contains("hidden"), false);
    ($("phone-code") as HTMLInputElement).value = "24680";
    submit("code-form");
    await waitFor(() => /Signed in as Demo User/.test(status()));
  } finally {
    dom.window.close();
    await s.close();
  }
});
