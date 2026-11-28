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

// MUST 4 — inbox and thread density

import { getTextWidth } from "@evenrealities/pretext";
import { relativeTime } from "../src/glasses/text.js";
import { inboxHeading, inboxLabel, unreadBadge } from "../src/glasses/controller.js";
import { DemoPersonal } from "../server/personal/demo.js";
import { AccountTelegram } from "../server/personal/mtproto.js";
import type { TelegramClient } from "teleproto";
import { DEMO_NOW } from "./helpers/glasses-harness.js";

test("ux must4: relative time buckets", () => {
  const now = new Date(2026, 10, 28, 15, 0).getTime();
  assert.equal(relativeTime(now - 20_000, now), "just now");
  assert.equal(relativeTime(now + 5_000, now), "just now"); // clock skew
  assert.equal(relativeTime(now - 10 * 60_000, now), "10m");
  assert.equal(relativeTime(now - 3 * 3_600_000, now), "3h");
  assert.equal(relativeTime(new Date(2026, 10, 27, 23, 0).getTime(), now), "yesterday");
  assert.equal(relativeTime(new Date(2026, 10, 24, 9, 0).getTime(), now), "Nov 24");
  // 20 h ago but before midnight is "yesterday", not "20h".
  const morning = new Date(2026, 10, 28, 8, 0).getTime();
  assert.equal(relativeTime(new Date(2026, 10, 27, 12, 0).getTime(), morning), "yesterday");
});

test("ux must4: demo and mtproto dialogs carry lastDate (epoch ms)", async () => {
  const demo = await new DemoPersonal(DEMO_NOW).dialogs();
  assert.equal(demo.find((c) => c.id === "demo:maya")!.lastDate, DEMO_NOW - 10 * 60000);
  assert.equal(demo.find((c) => c.id === "demo:crew")!.lastDate, DEMO_NOW - 3 * 60000);
  const client = {
    async getDialogs() {
      return [
        { id: { toString: () => "1" }, isCommunity: false, title: "Maya", isUser: true, isGroup: false, unreadCount: 1, dialog: {}, message: { message: "hi", date: 1_700_000_000 } },
        { id: { toString: () => "2" }, isCommunity: false, title: "Empty", isUser: false, isGroup: true, unreadCount: 0, dialog: {} },
      ];
    },
  } as unknown as TelegramClient;
  const live = await new AccountTelegram(client).dialogs();
  assert.equal(live[0].lastDate, 1_700_000_000_000);
  assert.equal(live[1].lastDate, undefined);
});

test("ux must4: inbox rows show count, short kind and relative time within the lens budgets", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    const rows = h.app.frame.split!.rows;
    assert.deepEqual(rows, ["● Maya · 1", "● Build night · 2", "Design team"]);
    assert.equal(h.app.frame.split!.heading, "DM · 1 unread · 10m");
    assert.equal(h.app.frame.split!.detail, "Can you bring the prototype too?");
    await h.app.input("down");
    assert.equal(h.app.frame.split!.heading, "Group · 2 unread · 3m");
    await h.app.input("down");
    assert.equal(h.app.frame.split!.heading, "Group · up to date · 20m");
    assert.equal(h.app.frame.badge, "DEMO");
    for (const label of rows) assert.ok(getTextWidth(label) <= 188, label);
    assert.ok(getTextWidth(h.app.frame.footer) <= 548);
  } finally {
    h.close();
  }
});

test("ux must4: long titles are truncated but keep the unread count; headings fit 286 px", () => {
  const chat = { id: "x", title: "Weekend climbing crew and friends of friends", kind: "group" as const, unread: 12, readMaxId: 0, lastDate: 0 };
  const label = inboxLabel(chat);
  assert.match(label, /^● Weekend.*(\.\.\.|…) · 12$/);
  assert.ok(getTextWidth(label) <= 188);
  assert.equal(inboxLabel({ ...chat, unread: 250 }).endsWith(" · 99+"), true);
  const heading = inboxHeading({ ...chat, unread: 0, kind: "channel" }, 0);
  assert.ok(getTextWidth(heading) <= 286, heading);
  assert.equal(inboxHeading({ ...chat, unread: 3, lastDate: undefined }, 0), "Group · 3 unread");
});

test("ux must4: thread context uses relative time and keeps UNREAD until seen; live badge counts unread", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await h.app.input("tap");
    assert.equal(h.app.frame.context, "Maya · 10m · UNREAD");
    await h.app.settled();
    await h.app.input("up");
    assert.equal(h.app.frame.context, "You · 30m");
    // A live (non-synthetic) inbox shows total unread instead of DEMO.
    h.app.synthetic = false;
    await h.app.home();
    assert.equal(h.app.frame.badge, "2 UNREAD");
    const many = (n: number) => [{ id: "a", title: "A", kind: "dm" as const, unread: n, readMaxId: 0 }];
    assert.equal(unreadBadge(many(0)), undefined);
    assert.equal(unreadBadge(many(12)), "12 NEW");
    assert.equal(unreadBadge(many(500)), "99+ NEW");
    for (const n of [1, 9, 12, 99, 500]) assert.ok(getTextWidth(unreadBadge(many(n))!) <= 95);
  } finally {
    h.close();
  }
});

// MUST 5 — auto-pair the demo/simulator only

import { Store } from "../server/store.js";
import {
  AutoPair,
  DisplaySession,
  autoPairSynthetic,
  canAutoPair,
  memoryStorage,
} from "../src/glasses/session.js";

const DEMO_HEALTH = { ok: true, mode: "personal-demo", synthetic: true };
const LIVE_HEALTH = { ok: true, mode: "personal", synthetic: false };

/** Mirrors the /api/pair routes in server/personal/index.ts over a real Store. */
function pairServer(demo: boolean) {
  const store = new Store(":memory:", () => DEMO_NOW);
  const calls: string[] = [];
  const api = async (path: string, body?: any) => {
    calls.push(path);
    if (path === "/pair") return store.pair();
    if (path === "/pair/approve") {
      if (!demo) throw Object.assign(new Error("Approve pairing from your local terminal."), { status: 403 });
      return { approved: store.approve(String(body?.code ?? "")) };
    }
    if (path.startsWith("/pair/")) return store.pairing(path.slice(6));
    throw new Error("unexpected " + path);
  };
  return { store, calls, api };
}

test("ux must5: synthetic health auto-pairs without taps and stores a working token", async () => {
  const s = pairServer(true);
  const session = new DisplaySession(memoryStorage());
  assert.equal(await autoPairSynthetic(session, s.api, DEMO_HEALTH), true);
  assert.deepEqual(s.calls.map((c) => c.replace(/[0-9a-f]{64}/, ":id")), ["/pair", "/pair/approve", "/pair/:id"]);
  assert.ok(session.paired);
  assert.equal(s.store.authorize(session.token), true);
  assert.equal(session.pairId, "");
  assert.equal(session.pairCode, "");
});

test("ux must5: live or unknown health never auto-pairs and makes no request", async () => {
  for (const health of [LIVE_HEALTH, { mode: "personal", synthetic: true }, { mode: "personal-demo", synthetic: "true" }, undefined]) {
    const s = pairServer(false);
    const session = new DisplaySession(memoryStorage());
    assert.equal(canAutoPair(health), false);
    assert.equal(await autoPairSynthetic(session, s.api, health), false);
    assert.equal(await new AutoPair(session, s.api).run(health), false);
    assert.deepEqual(s.calls, []);
    assert.equal(session.paired, false);
  }
  // Even if a client were misled into trying, a live server refuses approval.
  const s = pairServer(false);
  await assert.rejects(autoPairSynthetic(new DisplaySession(memoryStorage()), s.api, DEMO_HEALTH), /local terminal/);
});

test("ux must5: a stale token (synthetic 401) is replaced by a fresh auto-pair", async () => {
  const s = pairServer(true);
  const session = new DisplaySession(memoryStorage());
  session.remember("leftover-token-from-yesterday");
  assert.equal(s.store.authorize(session.token), false);
  session.clear(); // what api() does on a 401 before calling error()
  const auto = new AutoPair(session, s.api);
  assert.equal(await auto.run(DEMO_HEALTH), true);
  assert.equal(s.store.authorize(session.token), true);
});

test("ux must5: auto-pair retries are bounded and refill after a successful start", async () => {
  let calls = 0;
  const failing = async () => {
    calls++;
    throw Object.assign(new Error("Server error"), { status: 500 });
  };
  const session = new DisplaySession(memoryStorage());
  const auto = new AutoPair(session, failing, 2);
  assert.equal(await auto.run(DEMO_HEALTH), false);
  assert.equal(await auto.run(DEMO_HEALTH), false);
  assert.equal(auto.remaining, 0);
  assert.equal(await auto.run(DEMO_HEALTH), false);
  assert.equal(calls, 2); // third run made no request: the caller falls back to CONNECT
  auto.succeeded();
  assert.equal(auto.remaining, 2);
  // An approval that does not return a token is a failure, not a loop.
  const noApprove = new AutoPair(session, async (p: string) => (p === "/pair" ? { id: "x", code: "1" } : { approved: false }));
  assert.equal(await noApprove.run(DEMO_HEALTH), false);
  assert.equal(session.paired, false);
});

// SHOULD 10 — Settings keeps its row; watchlist footer says Toggle

test("ux should10: Settings sub-screens return to their own row; watchlist footer is Tap  Toggle", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Settings");
    await h.app.input("tap");
    assert.equal(h.app.frame.title, "Settings");
    await h.app.input("down"); // Controls
    await h.app.input("tap");
    assert.equal(h.app.frame.title, "GLASSES CONTROLS");
    await h.app.input("back");
    assert.equal(h.app.menu!.title, "Settings");
    assert.equal(h.app.menu!.index, 1);
    await h.app.input("down"); // Catch-up chats
    await h.app.input("tap");
    assert.equal(h.app.menu!.title, "Catch-up chats");
    assert.match(h.app.frame.footer, /Tap  Toggle/);
    assert.ok(getTextWidth(h.app.frame.footer) <= 548);
    await h.app.input("back");
    assert.equal(h.app.menu!.index, 2);
    await h.app.input("down"); // Disconnect display
    await h.app.input("tap");
    assert.equal(h.app.frame.title, "DISCONNECT?");
    await h.app.input("back"); // cancel stays safe
    assert.equal(h.app.menu!.title, "Settings");
    assert.equal(h.app.menu!.index, 3);
    assert.ok(!h.calls.some((c) => c.path === "/logout"));
  } finally {
    h.close();
  }
});

// SHOULD 11 — muted from Telegram notify settings

import { Api } from "teleproto";
import { mutedNow } from "../server/personal/mtproto.js";

test("ux should11: mutedNow reads the dialog's muteUntil; heading shows Muted within 286 px", async () => {
  const now = 1_700_000_000_000;
  const dialog = (muteUntil?: number) =>
    new Api.Dialog({
      peer: new Api.PeerUser({ userId: 1 as never }),
      topMessage: 1,
      readInboxMaxId: 0,
      readOutboxMaxId: 0,
      unreadCount: 0,
      unreadMentionsCount: 0,
      unreadReactionsCount: 0,
      notifySettings: new Api.PeerNotifySettings({ muteUntil }),
    } as never);
  assert.equal(mutedNow(dialog(now / 1000 + 3600), now), true);
  assert.equal(mutedNow(dialog(2147483647), now), true); // "forever"
  assert.equal(mutedNow(dialog(now / 1000 - 1), now), false); // expired
  assert.equal(mutedNow(dialog(undefined), now), false);
  assert.equal(mutedNow({}, now), false);
  const chat = { id: "x", title: "Build night", kind: "group" as const, unread: 2, readMaxId: 0, lastDate: DEMO_NOW - 3 * 60000, muted: true };
  assert.equal(inboxHeading(chat, DEMO_NOW), "Group · 2 unread · 3m · Muted");
  const quiet = inboxHeading({ ...chat, unread: 0, kind: "channel", lastDate: DEMO_NOW - 9 * 86_400_000 }, DEMO_NOW);
  assert.ok(getTextWidth(quiet) <= 286, quiet);
  assert.match(quiet, /Muted$/);
  // Demo chats are never muted.
  assert.ok((await new DemoPersonal(DEMO_NOW).dialogs()).every((c) => !c.muted));
});

// SHOULD 6 — specific Catch-up labels, one-page cards

test("ux should6: Catch-up rows read `Chat · kind`; a card is one page and Tap opens the source", async () => {
  const h = demoHarness();
  try {
    await h.app.start();
    await focusRow(h.app, "Catch-up");
    await h.app.input("tap");
    assert.equal(h.app.menu!.title, "Catch-up");
    const cards = h.app.cards;
    assert.ok(cards.length > 0);
    const labels = h.app.menu!.rows.slice(0, cards.length).map((r) => r.label);
    labels.forEach((label, i) => {
      const kind = cards[i].kind === "commitment" ? "to-do" : cards[i].kind;
      assert.equal(label, cards[i].evidence[0].chatTitle + " · " + kind);
      assert.ok(getTextWidth(label) <= 188, label);
    });
    assert.ok(labels.includes("Build night · change"), labels.join(" | "));
    // Open the change card: one page, then Tap goes straight to the quoted message.
    h.app.menu!.index = labels.indexOf("Build night · change");
    await h.app.input("tap");
    assert.equal(h.app.mode, "read");
    assert.notEqual(h.app.frame.badge?.includes(" / "), true, "single page");
    assert.match(h.app.frame.footer, /^Tap  Open message/);
    assert.match(h.app.frame.context ?? "", /^Build night · /);
    const card = cards[labels.indexOf("Build night · change")];
    assert.match(h.app.frame.body, new RegExp(card.evidence[0].quote.slice(0, 12)));
    await h.app.input("tap");
    assert.equal(h.app.mode, "thread");
    assert.equal(h.app.chat!.id, card.evidence[0].chatId);
    assert.equal(h.app.messages[h.app.messageIndex].id, card.evidence[0].messageId);
    await h.app.input("back");
    assert.equal(h.app.menu!.title, "Catch-up");
  } finally {
    h.close();
  }
});

test("ux should6: clampLines keeps at most N lines and marks the cut", async () => {
  const { clampLines } = await import("../src/glasses/text.js");
  assert.equal(clampLines("short", 5), "short");
  const long = clampLines("word ".repeat(400), 5);
  assert.equal(long.split("\n").length, 5);
  assert.match(long, /(…|\.\.\.)$/);
  for (const line of long.split("\n")) assert.ok(getTextWidth(line) <= 520);
});
