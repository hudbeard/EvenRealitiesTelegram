import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import "./style.css";
type Task = {
  id: string;
  chatId: string;
  chatName: string;
  sender: string;
  text: string;
  expiresAt: number;
  status: string;
  reply: string | null;
  receipt: number | null;
};
type Stage = "inbox" | "detail" | "replies" | "preview" | "sending" | "outcome";
const replies = ["On my way.", "Done.", "I cannot cover this."];
document.querySelector("#app")!.innerHTML =
  `<header><a class="brand" href="/">f <span>FIELDLINE</span></a><span id="connection">Connecting</span></header><main><section class="intro"><p class="eyebrow">FOR THE CREW IN MOTION</p><h1>Stay in the moment.<br>Keep the team moving.</h1><p class="lede">One request. A clear response.<br>Telegram coordination, right in your field of view.</p><span class="badge" id="mode"></span></section><section class="workspace"><div><div class="section-label"><span>YOUR FIELD OF VIEW</span><span>576 × 288 · EVEN G2</span></div><div class="lens"><div class="display" role="region" aria-label="Glasses preview"><div id="hud-title"></div><pre id="hud-body"></pre><div id="hud-footer"></div></div></div><div class="controls"><button id="up" aria-label="Previous">↑</button><button id="tap" class="primary">Tap</button><button id="down" aria-label="Next">↓</button><button id="back">Double tap / Back</button></div><p class="caption" id="hardware">Phone preview · waiting for the Even Hub bridge</p></div><aside><div class="section-label"><span>SESSION</span><button id="logout" class="text-button" hidden>Disconnect</button></div><h2 id="session-title">Pair your glasses.</h2><p id="pair-help">Connecting…</p><div id="pair-code"></div><button id="pair" class="wide">Start pairing</button><div id="demo-tools" hidden><hr><p class="eyebrow">LOCAL DEMONSTRATION</p><p>Synthetic requests. Replies stay on this computer.</p><button id="demo-pair" class="wide">Approve demo pairing</button><button id="demo-request" class="wide">Add a crew request</button></div><p id="notice" role="status" aria-live="polite"></p></aside></section><section class="activity"><div><p class="eyebrow">REPLY WITH CONFIDENCE</p><h2>A decision, not another feed.</h2><p>Choose a reply. Review the exact chat and message.<br>Send only when you confirm.</p></div><div><p class="eyebrow">RECENT OUTCOMES</p><div id="history">No replies in this session.</div></div></section></main><footer>Fieldline / Heads Up 2026<span>Built for Even G2 + Telegram</span></footer>`;
const el = (id: string) => document.getElementById(id)!;
const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
let mode = "demo",
  label = "Crew member",
  token = localStorage.getItem("fieldline.session") ?? "",
  pairId = "",
  pairCode = "",
  tasks: Task[] = [],
  selected = 0,
  active: Task | null = null,
  choice = 0,
  page = 0,
  stage: Stage = "inbox",
  outcome: Task | null = null,
  busy = false,
  running = true,
  paired = false,
  operationId = "";
let bridge: EvenAppBridge | undefined,
  ready = false,
  renderChain = Promise.resolve(),
  pairTimer: ReturnType<typeof setTimeout> | undefined,
  pollTimer: ReturnType<typeof setTimeout> | undefined;
let lastView = "";
let providerConnected = true;
function message(s: string) {
  el("notice").textContent = s;
}
async function api(path: string, body?: unknown) {
  const r = await fetch(apiBase + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 401) {
      token = "";
      localStorage.removeItem("fieldline.session");
      paired = false;
    }
    throw new Error(data.error ?? "Connection unavailable");
  }
  return data;
}
function clean(s: string) {
  return s
    .replace(/[^\x20-\x7e\n]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}
function wrap(s: string, width = 38) {
  const out: string[] = [];
  for (const raw of clean(s).split("\n")) {
    let line = "";
    for (const word of raw.split(/\s+/)) {
      for (const part of word.match(new RegExp(`.{1,${width}}`, "g")) ?? [""]) {
        if (line && line.length + part.length + 1 > width) {
          out.push(line);
          line = "";
        }
        line += (line ? " " : "") + part;
      }
    }
    out.push(line);
  }
  return out;
}
function short(s: string, n = 36) {
  s = clean(s).replace(/\n/g, " ");
  return s.length > n ? s.slice(0, n - 3) + "..." : s;
}
function screen() {
  const tag = mode === "demo" ? "DEMO / " : "";
  if (!paired)
    return {
      title: tag + "FIELDLINE",
      body: pairCode
        ? `PAIR YOUR GLASSES\n\nSend to your bot in Telegram:\n/pair ${pairCode}\n\nCode expires in five minutes.`
        : "YOUR CREW, A GLANCE AWAY\n\nStart pairing on your phone.\nReplies always wait for your tap.",
      footer:
        pairCode && mode === "demo"
          ? "Tap to approve DEMO pairing"
          : "Tap to start pairing",
    };
  if (stage === "inbox") {
    if (!providerConnected)
      return {
        title: "TELEGRAM OFFLINE",
        body: "Crew updates are unavailable.\n\nCheck your server connection.\nCached requests are kept safely.\nNothing is sent automatically.",
        footer: "Reconnect to receive new requests",
      };
    const t = tasks[selected];
    return t
      ? {
          title: tag + `CREW REQUESTS / ${selected + 1} OF ${tasks.length}`,
          body: `${short(t.chatName)}\n${short(t.sender)}\n\n${wrap(t.text).slice(0, 3).join("\n")}`,
          footer:
            t.status === "pending"
              ? "Tap to open / Swipe for next"
              : "Delivery uncertain / Tap for details",
        }
      : {
          title: tag + "FIELDLINE / CAUGHT UP",
          body: "YOU ARE ALL CLEAR\n\nNew /request messages from your\napproved Telegram crew appear here.\n\nKeep Fieldline open to receive.",
          footer:
            mode === "demo"
              ? "Tap for sample request / Double tap exit"
              : "Double tap to exit",
        };
  }
  const t = active!;
  if (stage === "detail") {
    const lines = wrap(t.text),
      pages = Math.max(1, Math.ceil(lines.length / 5));
    page = Math.min(page, pages - 1);
    return {
      title: tag + short(t.sender, 20) + ` / ${page + 1} OF ${pages}`,
      body: lines.slice(page * 5, page * 5 + 5).join("\n"),
      footer:
        pages > 1
          ? "Swipe to read / Tap to reply"
          : "Tap to reply / Double tap back",
    };
  }
  if (stage === "replies")
    return {
      title: tag + "CHOOSE A REPLY",
      body: replies
        .map((r, i) => (i === choice ? "> " : "  ") + r)
        .join("\n\n"),
      footer: "Swipe to choose / Tap to review",
    };
  if (stage === "preview")
    return {
      title: tag + "REVIEW BEFORE SENDING",
      body: `TO ${short(t.chatName, 32)}\nChat ${t.chatId}\nVia your crew bot\n\n${wrap(`${label}: ${replies[choice]}`).join("\n")}`,
      footer: "Tap to SEND / Double tap to cancel",
    };
  if (stage === "sending")
    return {
      title: tag + "SENDING YOUR REPLY",
      body: `${short(t.chatName)}\n\nWaiting for a delivery receipt.\nDo not confirm again.`,
      footer: "Request locked while sending",
    };
  if (outcome?.status === "sent")
    return {
      title:
        tag +
        (mode === "demo" ? "LOCAL DEMO RECEIPT" : "SENT / TELEGRAM RECEIPT"),
      body: `${short(outcome.chatName)}\n\n${wrap(outcome.reply ?? "").join("\n")}\n\n${mode === "demo" ? "Synthetic receipt" : "Message"} #${outcome.receipt}`,
      footer: "Tap for next request",
    };
  return {
    title:
      tag +
      "DELIVERY " +
      (outcome?.status === "failed" ? "REJECTED" : "UNCERTAIN"),
    body:
      outcome?.status === "failed"
        ? "Telegram rejected this reply.\nCheck chat permissions.\n\nNo automatic retry."
        : "A receipt could not be verified.\nCheck Telegram on your phone.\n\nDo not resend this request.",
    footer: "Tap for next request / No retry",
  };
}
function render() {
  const view = `${stage} ${paired ? "paired" : "unpaired"}`;
  if (view !== lastView) {
    console.log("FIELDLINE_VIEW", view);
    lastView = view;
  }
  const s = screen();
  el("hud-title").textContent = s.title;
  el("hud-body").textContent = s.body;
  el("hud-footer").textContent = s.footer;
  el("session-title").textContent = paired
    ? "You are connected."
    : "Pair your glasses.";
  el("pair-code").textContent = paired ? "" : pairCode;
  el("pair-help").textContent = paired
    ? "A four-hour private session. Only requests from your configured crew are shown."
    : pairCode
      ? "In a private chat with your test bot, send /pair followed by this code."
      : "Pairing ties this display to the wearer configured on your server.";
  el("pair").hidden = paired;
  el("logout").hidden = !paired;
  el("connection").textContent = paired ? "Session connected" : "Not paired";
  if (ready && running)
    renderChain = renderChain
      .then(async () => {
        for (const [id, name, content] of [
          [1, "header", s.title],
          [2, "body", s.body],
          [3, "footer", s.footer],
        ] as const)
          await bridge!.textContainerUpgrade(
            new TextContainerUpgrade({
              containerID: id,
              containerName: name,
              content,
            }),
          );
      })
      .catch(() => message("Display update failed. Check Even connection."));
}
async function load() {
  if (!token || !running) return;
  const data = await api("/tasks");
  tasks = data.tasks;
  paired = true;
  providerConnected = data.provider?.connected ?? true;
  selected = Math.min(selected, Math.max(0, tasks.length - 1));
  el("history").replaceChildren();
  for (const t of data.history as Task[]) {
    const p = document.createElement("p"),
      strong = document.createElement("strong");
    strong.textContent = t.status.toUpperCase() + " · ";
    p.append(strong, document.createTextNode(t.reply ?? t.text));
    el("history").append(p);
  }
  if (!data.history.length)
    el("history").textContent = "No replies in this session.";
  if (stage === "inbox") render();
}
async function poll() {
  clearTimeout(pollTimer);
  if (!running) return;
  try {
    await load();
  } catch (e) {
    message((e as Error).message);
    if (!token) render();
  }
  pollTimer = setTimeout(poll, 3000);
}
async function startPair() {
  const p = await api("/pair", {});
  pairId = p.id;
  pairCode = p.code;
  render();
  void checkPair();
}
async function checkPair() {
  clearTimeout(pairTimer);
  if (!pairId || !running) return;
  try {
    const result = await api("/pair/" + pairId);
    if (result.token) {
      token = result.token;
      localStorage.setItem("fieldline.session", token);
      pairCode = "";
      pairId = "";
      paired = true;
      message("Paired. Requests are private to this session.");
      await load();
      render();
      return;
    }
    pairTimer = setTimeout(checkPair, 1500);
  } catch (e) {
    pairId = "";
    pairCode = "";
    message((e as Error).message);
    render();
  }
}
async function action(kind: "tap" | "up" | "down" | "back") {
  if (busy || !running) return;
  try {
    if (!paired) {
      if (kind === "tap") {
        busy = true;
        if (pairCode && mode === "demo") {
          await api("/demo/pair", { code: pairCode });
          await checkPair();
        } else await startPair();
      }
      return;
    }
    if (kind === "back") {
      if (stage === "sending") return;
      if (stage === "inbox") {
        if (ready) await bridge!.shutDownPageContainer(1);
        return;
      }
      stage = stage === "preview" ? "replies" : "inbox";
      if (stage === "inbox") active = null;
      render();
      return;
    }
    if (kind === "up" || kind === "down") {
      const d = kind === "up" ? -1 : 1;
      if (stage === "inbox")
        selected = (selected + d + tasks.length) % Math.max(1, tasks.length);
      if (stage === "detail")
        page = Math.max(
          0,
          Math.min(Math.ceil(wrap(active!.text).length / 5) - 1, page + d),
        );
      if (stage === "replies")
        choice = (choice + d + replies.length) % replies.length;
      render();
      return;
    }
    switch (stage) {
      case "inbox":
        if (!providerConnected) return;
        active = tasks[selected] ? { ...tasks[selected] } : null;
        if (active) {
          if (active.status !== "pending") {
            outcome = active;
            stage = "outcome";
          } else {
            page = 0;
            stage = "detail";
          }
        } else if (mode === "demo") {
          busy = true;
          await api("/demo/request", {});
          await load();
        }
        break;
      case "detail":
        choice = 0;
        stage = "replies";
        break;
      case "replies":
        operationId = crypto.randomUUID();
        stage = "preview";
        break;
      case "preview":
        busy = true;
        stage = "sending";
        render();
        try {
          outcome = await api(
            `/tasks/${encodeURIComponent(active!.id)}/confirm`,
            { operationId, choice },
          );
        } catch (e) {
          message((e as Error).message);
          outcome = {
            ...active!,
            status: "uncertain",
            reply: `${label}: ${replies[choice]}`,
          };
        }
        stage = "outcome";
        console.log("FIELDLINE_OUTCOME", outcome?.status);
        await load();
        break;
      case "outcome":
        stage = "inbox";
        active = null;
        outcome = null;
        await load();
        break;
    }
    render();
  } catch (e) {
    message((e as Error).message);
    render();
  } finally {
    busy = false;
  }
}
function safely(fn: () => Promise<unknown>) {
  void fn().catch((e) => message((e as Error).message));
}
for (const kind of ["tap", "up", "down", "back"] as const)
  el(kind).onclick = () => safely(() => action(kind));
el("pair").onclick = () => safely(startPair);
el("demo-pair").onclick = () =>
  safely(async () => {
    if (!pairCode) await startPair();
    await api("/demo/pair", { code: pairCode });
    await checkPair();
  });
el("demo-request").onclick = () =>
  safely(async () => {
    await api("/demo/request", {});
    await load();
    message("Synthetic request added. No Telegram data was used.");
  });
el("logout").onclick = () =>
  safely(async () => {
    await api("/logout", {});
    token = "";
    localStorage.removeItem("fieldline.session");
    paired = false;
    tasks = [];
    active = null;
    stage = "inbox";
    el("history").textContent = "Disconnected.";
    render();
  });
function stop() {
  running = false;
  clearTimeout(pollTimer);
  clearTimeout(pairTimer);
}
window.addEventListener("pagehide", stop);
render();
try {
  const h = await api("/health");
  mode = h.mode;
  label = h.label;
  el("mode").textContent =
    mode === "demo"
      ? "DEMO MODE / SYNTHETIC DATA"
      : "TELEGRAM / LIVE CREW SESSION";
  el("demo-tools").hidden = mode !== "demo";
  await poll();
  render();
} catch {
  message("Backend unavailable. Start the Fieldline server.");
}
void (async () => {
  try {
    bridge = await waitForEvenAppBridge();
    const boxes = [
      {
        id: 1,
        name: "header",
        y: 0,
        h: 38,
        text: screen().title,
        capture: 0,
        color: 2,
      },
      {
        id: 2,
        name: "body",
        y: 42,
        h: 198,
        text: screen().body,
        capture: 1,
        color: 4,
      },
      {
        id: 3,
        name: "footer",
        y: 246,
        h: 42,
        text: screen().footer,
        capture: 0,
        color: 2,
      },
    ];
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 3,
        textObject: boxes.map(
          (b) =>
            new TextContainerProperty({
              containerID: b.id,
              containerName: b.name,
              xPosition: 8,
              yPosition: b.y,
              width: 560,
              height: b.h,
              paddingLength: 4,
              borderWidth: 0,
              content: b.text,
              isEventCapture: b.capture,
              textColor: b.color,
            }),
        ),
      }),
    );
    if (result !== 0) throw new Error("Display refused startup");
    ready = true;
    el("hardware").textContent =
      "Connected to Even Hub · touchpad and R1 input enabled";
    console.log("FIELDLINE_READY");
    bridge.onEvenHubEvent((event) => {
      const types = [event.sysEvent, event.textEvent, event.listEvent]
        .filter(Boolean)
        .map((e) => e!.eventType ?? OsEventTypeList.CLICK_EVENT);
      if (
        types.some(
          (t) =>
            t === OsEventTypeList.FOREGROUND_EXIT_EVENT ||
            t === OsEventTypeList.SYSTEM_EXIT_EVENT ||
            t === OsEventTypeList.ABNORMAL_EXIT_EVENT,
        )
      ) {
        stop();
        return;
      }
      if (types.includes(OsEventTypeList.FOREGROUND_ENTER_EVENT)) {
        running = true;
        void poll();
        if (pairId) void checkPair();
        render();
        return;
      }
      if (types.includes(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
        safely(() => action("back"));
        return;
      }
      if (types.includes(OsEventTypeList.SCROLL_TOP_EVENT)) {
        safely(() => action("up"));
        return;
      }
      if (types.includes(OsEventTypeList.SCROLL_BOTTOM_EVENT)) {
        safely(() => action("down"));
        return;
      }
      if (types.includes(OsEventTypeList.CLICK_EVENT))
        safely(() => action("tap"));
    });
    render();
  } catch {
    el("hardware").textContent =
      "Phone preview only · use Even Hub or the official simulator";
  }
})();
