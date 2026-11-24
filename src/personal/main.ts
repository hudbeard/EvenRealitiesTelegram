import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
  AudioInputSource,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import type {
  Chat,
  Message,
  BriefCard,
  PersonalAction,
  Sponsored,
} from "../../server/personal/types.js";
import "./style.css";
type Source = Message & { revision: string };
type Stage =
  "brief" | "sponsored" | "source" | "actions" | "preview" | "outcome";
const root = document.getElementById("app")!;
root.innerHTML = `<header><a href="/personal.html" class="brand">f<span>FIELDLINE</span></a><span id="status">CONNECTING</span></header><main><section class="hero"><p class="eyebrow">YOUR TELEGRAM, IN PERSPECTIVE</p><h1>What changed<br>while you were away?</h1><p class="subhead">Find the new plan. Catch the question.<br>Remember what you said you would do.</p><span id="mode" class="pill"></span></section><section id="pair-panel" class="pair-panel"><h2>Pair this display</h2><p id="pair-instructions">Generate a code, then approve it from your local terminal.</p><strong id="pair-code"></strong><button id="pair">Get pairing code</button><button id="demo-approve" hidden>Approve synthetic demo</button></section><section class="layout" id="workspace" hidden><aside><p class="eyebrow">CHATS YOU CHOOSE</p><div id="chats"></div><button id="watch">Update selection</button><p class="small">Only selected chats enter catch-up. Channel posts remain in their channel view.</p><button id="disconnect" class="quiet">Disconnect display</button></aside><div class="main-column"><div class="heading-row"><h2>Your catch-up</h2><button id="refresh">Refresh</button></div><p id="brief-empty" class="small"></p><div id="cards"></div><button id="checkpoint" class="quiet">Caught up · start a new window</button><div id="conversation" hidden><div class="heading-row"><h2 id="chat-title"></h2><input id="search" placeholder="Search this chat" aria-label="Search this chat"><button id="find">Search</button></div><div id="ads"></div><div id="messages"></div></div></div><section class="glasses-column"><p class="eyebrow">EVEN G2 / LIVE DISPLAY</p><div class="lens"><div id="hud-title"></div><pre id="hud-body"></pre><div id="hud-footer"></div></div><div class="controls"><button id="up">↑</button><button id="tap">Tap</button><button id="down">↓</button><button id="back">Back</button></div><p class="small" id="bridge">Phone preview · open in the official simulator for G2 input</p><section class="compose"><p class="eyebrow">REPLY AS YOU</p><label for="draft">Write your reply or keep a quick response ready.</label><textarea id="draft" maxlength="4096" rows="3">Thanks, I saw the update.</textarea><div class="shortcuts"><button data-draft="I'll be there at the new time.">Confirm new plan</button><button data-draft="Yes, I'll bring it.">I'll bring it</button></div><p class="small">Your exact text appears for review on G2. Nothing sends until you confirm.</p></section><div id="result" role="status" aria-live="polite"></div></section></section><p id="notice" role="status"></p></main><footer>Fieldline uses the Telegram API. Personal session stays on your server. <span>Heads Up / 2026</span></footer>`;
const el = (id: string) => document.getElementById(id)!;
const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
let refreshFailed = false,
  refreshing = false;
let token = localStorage.getItem("fieldline.personal.session") ?? "",
  synthetic = false,
  pairId = "",
  pairCode = "",
  chats: Chat[] = [],
  watched: string[] = [],
  cards: BriefCard[] = [],
  selected = 0,
  active: Source | null = null,
  activeChat: Chat | null = null,
  stage: Stage = "brief",
  choice = 0,
  page = 0,
  pending: PersonalAction | null = null,
  operationId = "",
  outcome = "",
  busy = false,
  running = true;
let bridge: EvenAppBridge | undefined,
  ready = false,
  queue = Promise.resolve(),
  pairTimer: ReturnType<typeof setTimeout> | undefined,
  lastView = "";
const actionNames = [
  "Reply as you",
  "React with thumbs up",
  "Save to Saved Messages",
];
let original: Source | null = null,
  sourceAds: Sponsored[] = [],
  adIndex = 0,
  adStarted = 0;
let voiceEnabled = false,
  captureState: "idle" | "recording" | "transcribing" = "idle",
  audioChunks: Uint8Array[] = [],
  audioSize = 0,
  micTimer: ReturnType<typeof setTimeout> | undefined;
async function startVoice() {
  if (
    busy ||
    !running ||
    !active ||
    !bridge ||
    !["source", "actions", "preview"].includes(stage)
  )
    return;
  if (!voiceEnabled) {
    note(
      "Voice needs a configured speech-to-text service. You can still compose on your phone.",
    );
    return;
  }
  busy = true;
  captureState = "recording";
  audioChunks = [];
  audioSize = 0;
  try {
    await bridge.audioControl(true, AudioInputSource.Glasses);
    micTimer = setTimeout(() => safe(() => finishVoice()), 30000);
    render();
  } catch {
    captureState = "idle";
    busy = false;
    note("Could not start the glasses microphone.");
  }
}
async function finishVoice(discard = false) {
  if (captureState !== "recording") return;
  clearTimeout(micTimer);
  captureState = "transcribing";
  try {
    await bridge?.audioControl(false);
    if (discard || !running || audioSize < 3200) return;
    render();
    const pcm = new Uint8Array(audioSize);
    let offset = 0;
    for (const chunk of audioChunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    const r = await fetch(apiBase + "/api/transcribe", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
      body: pcm,
      signal: AbortSignal.timeout(22000),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Transcription unavailable.");
    if (!running) return;
    (el("draft") as HTMLTextAreaElement).value = d.text;
    pending = {
      kind: "reply",
      chatId: active!.chatId,
      messageId: active!.id,
      text: d.text,
    };
    operationId = crypto.randomUUID();
    stage = "preview";
    page = 0;
    note("Transcript ready. Review before confirming.");
  } finally {
    captureState = "idle";
    audioChunks = [];
    audioSize = 0;
    busy = false;
    render();
  }
}
window.addEventListener("pagehide", () => {
  running = false;
  safe(() => finishVoice(true));
  clearTimeout(pairTimer);
});
const adObservers: IntersectionObserver[] = [];
function sourceText() {
  return `${active!.sender}:\n${active!.text || `[${active!.media ?? "Media"}]`}${original ? "\n\nREPLIES TO #" + original.id + ":\n" + original.text : ""}`;
}
function adText() {
  const ad = sourceAds[adIndex];
  return `${ad.title}\n\n${ad.text}${ad.disclosure ? "\n" + ad.disclosure : ""}`;
}
function note(s: string) {
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
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json();
  if (!r.ok) {
    if (r.status === 401) {
      token = "";
      localStorage.removeItem("fieldline.personal.session");
      el("workspace").hidden = true;
      el("pair-panel").hidden = false;
      active = null;
      cards = [];
      render();
    }
    throw new Error(d.error ?? "Request failed");
  }
  return d;
}
function text(tag: string, value: string, className?: string) {
  const n = document.createElement(tag);
  n.textContent = value;
  if (className) n.className = className;
  return n;
}
const clean = (s: string) =>
  s
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, " ")
    .replace(/ +/g, " ")
    .trim();
function wrap(s: string, width = 38) {
  return clean(s)
    .split("\n")
    .flatMap((line) => {
      const out: string[] = [];
      let row = "";
      for (const w of line
        .split(/\s+/)
        .flatMap((w) => w.match(new RegExp(`.{1,${width}}`, "g")) ?? [""])) {
        if (row && row.length + w.length + 1 > width) {
          out.push(row);
          row = "";
        }
        row += (row ? " " : "") + w;
      }
      out.push(row);
      return out;
    });
}
function screen() {
  const tag = synthetic ? "DEMO / " : "";
  if (captureState !== "idle")
    return {
      title: captureState === "recording" ? "LISTENING" : "TRANSCRIBING",
      body:
        captureState === "recording"
          ? "Release to make a draft.\nUp to 30 seconds.\n\nYou review before anything sends."
          : "Turning your words into a draft.\n\nNothing sent to Telegram.",
      footer:
        captureState === "recording"
          ? "Release when finished"
          : "Your reply still needs confirmation",
    };
  if (!token)
    return {
      title: tag + "FIELDLINE / CONNECT",
      body: pairCode
        ? `PAIR YOUR DISPLAY\n\n${pairCode}\n\nApprove on your local terminal.\nCode expires in five minutes.`
        : "WHAT CHANGED?\n\nConnect your own Telegram account.\nChoose chats on your phone.\nReplies wait for your confirmation.",
      footer:
        synthetic && pairCode
          ? "Tap to approve DEMO pairing"
          : "Tap to create pairing code",
    };
  if (stage === "brief") {
    if (refreshFailed)
      return {
        title: "CONNECTION UNAVAILABLE",
        body: "Could not refresh your Telegram.\n\nTrying again shortly.\nNo messages sent.",
        footer: "Check your server connection",
      };
    const c = cards[selected];
    return c
      ? {
          title:
            tag +
            `${c.kind.toUpperCase()} / ${selected + 1} OF ${cards.length}`,
          body: wrap(c.title + "\n\n" + c.evidence[0].quote)
            .slice(0, 6)
            .join("\n"),
          footer: "Tap for source / Swipe for next",
        }
      : {
          title: tag + "FIELDLINE / CAUGHT UP",
          body: "No new catch-up cards.\n\nOpen a selected chat on your phone\nor refresh for new activity.",
          footer: "Double tap to exit",
        };
  }
  if (stage === "sponsored") {
    const lines = wrap(adText());
    return {
      title: tag + "SPONSORED",
      body: lines.slice(page * 6, page * 6 + 6).join("\n"),
      footer: "Swipe to read / Tap to continue",
    };
  }
  if (stage === "source") {
    const lines = wrap(sourceText()),
      pages = Math.max(1, Math.ceil(lines.length / 6));
    page = Math.min(page, pages - 1);
    return {
      title: tag + `SOURCE / ${page + 1} OF ${pages}`,
      body: lines.slice(page * 6, page * 6 + 6).join("\n"),
      footer: voiceEnabled
        ? "Hold to dictate / Tap for actions"
        : "Tap for actions / Swipe to read",
    };
  }
  if (stage === "actions")
    return {
      title: tag + "ACT ON THIS MESSAGE",
      body: actionNames
        .map((s, i) => (i === choice ? "> " : "  ") + s)
        .join("\n\n"),
      footer: "Swipe to choose / Tap to review",
    };
  if (stage === "preview")
    return {
      title: tag + "REVIEW / " + pending!.kind.toUpperCase(),
      body: wrap(
        `TO ${activeChat!.title}\nMessage #${active!.id}\n\n${pending!.kind === "reply" ? pending!.text : pending!.kind === "save" ? "Forward to your Saved Messages" : "React with thumbs up"}`,
      )
        .slice(page * 6, page * 6 + 6)
        .join("\n"),
      footer:
        page <
        Math.ceil(
          wrap(
            `TO ${activeChat!.title}\nMessage #${active!.id}\n\n${pending!.kind === "reply" ? pending!.text : pending!.kind === "save" ? "Forward to your Saved Messages" : "React with thumbs up"}`,
          ).length / 6,
        ) -
          1
          ? "Swipe to finish reading before send"
          : "Tap to CONFIRM / Double tap cancel",
    };
  return {
    title: tag + "ACTION RESULT",
    body: wrap(outcome).slice(0, 6).join("\n"),
    footer: "Tap to return to catch-up",
  };
}
function render() {
  const s = screen();
  el("hud-title").textContent = s.title;
  el("hud-body").textContent = s.body;
  el("hud-footer").textContent = s.footer;
  const view = `${stage} ${token ? "paired" : "unpaired"}`;
  if (view !== lastView) {
    console.log("PERSONAL_VIEW", view);
    lastView = view;
  }
  if (ready && running)
    queue = queue
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
      .catch(() => note("Display update unavailable."));
}
async function pair() {
  const p = await api("/pair", {});
  pairId = p.id;
  pairCode = p.code;
  el("pair-code").textContent = pairCode;
  el("pair-instructions").textContent = synthetic
    ? "Synthetic demo: approve here or tap on the glasses."
    : `In your local terminal run: npm run personal:approve -- ${pairCode}`;
  render();
  void pollPair();
}
async function pollPair() {
  clearTimeout(pairTimer);
  if (!pairId || !running) return;
  try {
    const r = await api("/pair/" + pairId);
    if (r.token) {
      token = r.token;
      pairId = "";
      pairCode = "";
      localStorage.setItem("fieldline.personal.session", token);
      await refresh();
      return;
    }
    pairTimer = setTimeout(pollPair, 1500);
  } catch (e) {
    note((e as Error).message);
    pairId = "";
  }
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const d = await api("/dialogs");
    chats = d.chats;
    watched = d.watched;
    el("pair-panel").hidden = true;
    el("workspace").hidden = false;
    el("status").textContent = synthetic
      ? "SYNTHETIC ACCOUNT DEMO"
      : "YOUR TELEGRAM ACCOUNT";
    el("chats").replaceChildren();
    for (const chat of chats) {
      const row = document.createElement("div");
      row.className = "chat-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = watched.includes(chat.id);
      checkbox.value = chat.id;
      checkbox.setAttribute("aria-label", `Include ${chat.title} in catch-up`);
      const button = document.createElement("button");
      button.className = "chat-button";
      button.textContent = `${chat.title} · ${chat.unread}`;
      button.onclick = () => safe(() => openChat(chat));
      row.append(checkbox, button);
      el("chats").append(row);
    }
    const brief = await api("/brief");
    cards = brief.cards;
    selected = Math.min(selected, Math.max(0, cards.length - 1));
    el("brief-empty").textContent = cards.length
      ? "Source-linked observations. Interpretations are labelled; open the message before acting."
      : "No new observations in your selected chats.";
    el("cards").replaceChildren();
    for (const [i, c] of cards.entries()) {
      const b = document.createElement("button");
      b.className = "brief-card";
      b.append(
        text("span", c.kind.toUpperCase(), "eyebrow"),
        text("h3", c.title),
        text("p", c.evidence[0].quote),
        text("small", c.evidence[0].chatTitle + " · " + c.evidence[0].sender),
      );
      if (c.evidence[1])
        b.append(
          text("small", "REPLIES TO: " + c.evidence[1].quote, "earlier"),
        );
      b.onclick = () =>
        safe(async () => {
          selected = i;
          stage = "brief";
          await openSource(c.evidence[0].chatId, c.evidence[0].messageId);
        });
      el("cards").append(b);
    }
    refreshFailed = false;
    render();
  } catch (e) {
    refreshFailed = true;
    render();
    throw e;
  } finally {
    refreshing = false;
  }
}
async function openChat(chat: Chat, search = "") {
  const h = await api(
    `/chats/${encodeURIComponent(chat.id)}/messages${search ? "?search=" + encodeURIComponent(search) : ""}`,
  );
  activeChat = chat;
  el("conversation").hidden = false;
  el("chat-title").textContent = chat.title;
  el("messages").replaceChildren();
  el("ads").replaceChildren();
  adObservers.splice(0).forEach((o) => o.disconnect());
  for (const ad of h.sponsored as Sponsored[]) {
    const box = document.createElement("section");
    box.className = "sponsored";
    box.append(
      text("small", "SPONSORED"),
      text("h3", ad.title),
      text("p", ad.text),
    );
    if (ad.disclosure) box.append(text("small", ad.disclosure));
    if (/^https:\/\//.test(ad.url)) {
      const a = document.createElement("a");
      a.textContent = ad.buttonText ?? "Open sponsor";
      a.href = ad.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.onclick = () =>
        safe(() =>
          api(
            `/chats/${encodeURIComponent(chat.id)}/sponsored/${encodeURIComponent(ad.id)}/click`,
            {},
          ),
        );
      box.append(a);
    }
    el("ads").append(box);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        clearTimeout(timer);
        if (entries.some((e) => e.intersectionRatio >= 0.7))
          timer = setTimeout(
            () => {
              if (box.isConnected && document.visibilityState === "visible")
                safe(() =>
                  api(
                    `/chats/${encodeURIComponent(chat.id)}/sponsored/${encodeURIComponent(ad.id)}/view`,
                    {},
                  ),
                );
            },
            Math.max(5, ad.minSeconds ?? 5) * 1000,
          );
      },
      { threshold: 0.7 },
    );
    observer.observe(box);
    adObservers.push(observer);
  }
  for (const m of h.messages as Source[]) {
    const b = document.createElement("button");
    b.className = "message " + (m.outgoing ? "outgoing" : "");
    b.append(
      text("strong", m.sender),
      text("p", m.text || `[${m.media ?? "Media"} — open in Telegram]`),
      text(
        "small",
        `#${m.id}${m.editedAt ? " · edited" : ""}${m.replyTo ? " · replies to #" + m.replyTo : ""}`,
      ),
    );
    b.onclick = () => safe(() => openSource(chat.id, m.id));
    el("messages").append(b);
  }
  return h;
}
async function openSource(chatId: string, id: number) {
  const chat = chats.find((c) => c.id === chatId)!;
  const h = await openChat(chat);
  const m = h.messages.find((m: Source) => m.id === id);
  if (!m) throw new Error("Source no longer available. Refresh catch-up.");
  active = m;
  original = h.messages.find((p: Source) => p.id === active!.replyTo) ?? null;
  activeChat = chat;
  sourceAds = chat.kind === "channel" ? h.sponsored : [];
  adIndex = 0;
  adStarted = Date.now();
  stage = sourceAds.length ? "sponsored" : "source";
  page = 0;
  render();
  if (stage === "source" && wrap(sourceText()).length <= 6)
    await api(`/chats/${encodeURIComponent(chatId)}/read`, { messageId: id });
}
function draft() {
  return (el("draft") as HTMLTextAreaElement).value;
}
function previewText() {
  return `TO ${activeChat!.title}\nMessage #${active!.id}\n\n${pending!.kind === "reply" ? pending!.text : pending!.kind === "save" ? "Forward to your Saved Messages" : "React with thumbs up"}`;
}
async function action(input: "tap" | "up" | "down" | "back") {
  if (busy || !running) return;
  busy = true;
  try {
    if (!token) {
      if (input === "tap") {
        if (synthetic && pairCode) {
          await api("/pair/approve", { code: pairCode });
          await pollPair();
        } else await pair();
      }
      return;
    }
    if (input === "back") {
      if (stage === "brief") {
        if (ready) await bridge!.shutDownPageContainer(1);
        return;
      }
      stage = stage === "preview" ? "actions" : "brief";
      page = 0;
      render();
      return;
    }
    if (input === "up" || input === "down") {
      const d = input === "up" ? -1 : 1;
      if (stage === "brief")
        selected = (selected + d + cards.length) % Math.max(1, cards.length);
      if (stage === "actions") choice = (choice + d + 3) % 3;
      if (stage === "sponsored")
        page = Math.max(
          0,
          Math.min(Math.ceil(wrap(adText()).length / 6) - 1, page + d),
        );
      if (stage === "source") {
        page = Math.max(
          0,
          Math.min(Math.ceil(wrap(sourceText()).length / 6) - 1, page + d),
        );
        if (page === Math.ceil(wrap(sourceText()).length / 6) - 1)
          await api(`/chats/${encodeURIComponent(active!.chatId)}/read`, {
            messageId: active!.id,
          });
      }
      if (stage === "preview")
        page = Math.max(
          0,
          Math.min(Math.ceil(wrap(previewText()).length / 6) - 1, page + d),
        );
      render();
      return;
    }
    if (stage === "brief") {
      if (refreshFailed) {
        await refresh();
        return;
      }
      const c = cards[selected];
      if (c) await openSource(c.evidence[0].chatId, c.evidence[0].messageId);
    } else if (stage === "sponsored") {
      const ad = sourceAds[adIndex];
      if (
        page < Math.ceil(wrap(adText()).length / 6) - 1 ||
        Date.now() - adStarted < Math.max(5, ad.minSeconds ?? 5) * 1000
      ) {
        note("Finish reading this sponsored message before continuing.");
        return;
      }
      await api(
        `/chats/${encodeURIComponent(active!.chatId)}/sponsored/${encodeURIComponent(ad.id)}/view`,
        {},
      );
      page = 0;
      if (++adIndex >= sourceAds.length) stage = "source";
      else adStarted = Date.now();
    } else if (stage === "source") {
      stage = "actions";
      choice = 0;
    } else if (stage === "actions") {
      if (choice === 0 && !draft().trim())
        throw new Error("Write your reply on the companion first.");
      pending = {
        kind: choice === 0 ? "reply" : choice === 1 ? "react" : "save",
        chatId: active!.chatId,
        messageId: active!.id,
        ...(choice === 0
          ? { text: draft() }
          : choice === 1
            ? { reaction: "👍" }
            : {}),
      };
      operationId = crypto.randomUUID();
      stage = "preview";
      page = 0;
    } else if (stage === "preview") {
      if (page < Math.ceil(wrap(previewText()).length / 6) - 1) {
        note("Read the remaining preview pages before confirming.");
        return;
      }
      const r = await api("/action", {
        operationId,
        action: pending,
        revision: active!.revision,
        confirmed: true,
      });
      outcome =
        r.status === "sent"
          ? `${synthetic ? "SYNTHETIC DEMO RECEIPT" : "TELEGRAM CONFIRMED"}\n\n${pending!.kind === "reply" ? "Reply sent as you." : pending!.kind === "save" ? "Forwarded to your Saved Messages." : "Reaction applied."}${r.result?.messageId ? "\nMessage #" + r.result.messageId : ""}`
          : "Delivery uncertain.\nCheck Telegram before taking another action.\nNo automatic retry.";
      stage = "outcome";
      el("result").textContent = outcome;
      console.log("PERSONAL_OUTCOME", r.status, pending!.kind);
    } else {
      stage = "brief";
      await refresh();
    }
    render();
  } finally {
    busy = false;
  }
}
function safe(f: () => Promise<unknown>) {
  void f().catch((e) => note((e as Error).message));
}
el("pair").onclick = () => safe(pair);
el("demo-approve").onclick = () =>
  safe(async () => {
    if (!pairCode) await pair();
    await api("/pair/approve", { code: pairCode });
    await pollPair();
  });
for (const i of ["up", "tap", "down", "back"] as const)
  el(i).onclick = () => safe(() => action(i));
el("refresh").onclick = () => safe(refresh);
el("watch").onclick = () =>
  safe(async () => {
    await api("/watch", {
      ids: [
        ...el("chats").querySelectorAll<HTMLInputElement>("input:checked"),
      ].map((c) => c.value),
    });
    stage = "brief";
    await refresh();
  });
el("checkpoint").onclick = () =>
  safe(async () => {
    await api("/checkpoint", {});
    stage = "brief";
    await refresh();
  });
el("find").onclick = () =>
  safe(() =>
    activeChat
      ? openChat(activeChat, (el("search") as HTMLInputElement).value)
      : Promise.resolve(),
  );
el("disconnect").onclick = () =>
  safe(async () => {
    await api("/logout", {});
    token = "";
    localStorage.removeItem("fieldline.personal.session");
    cards = [];
    active = null;
    el("workspace").hidden = true;
    el("pair-panel").hidden = false;
    render();
  });
document.querySelectorAll<HTMLButtonElement>("[data-draft]").forEach(
  (b) =>
    (b.onclick = () => {
      (el("draft") as HTMLTextAreaElement).value = b.dataset.draft!;
    }),
);
render();
try {
  const health = await api("/health");
  synthetic = health.synthetic;
  voiceEnabled = health.voiceEnabled;
  el("mode").textContent = synthetic
    ? "SYNTHETIC PERSONAL-ACCOUNT DEMO"
    : "CONNECTED THROUGH THE TELEGRAM API";
  el("demo-approve").hidden = !synthetic;
  if (token) await refresh();
  render();
} catch (e) {
  note((e as Error).message);
}
void (async () => {
  try {
    bridge = await waitForEvenAppBridge();
    const s = screen();
    const boxes = [
      { id: 1, name: "header", y: 0, h: 38, t: s.title, capture: 0 },
      { id: 2, name: "body", y: 42, h: 198, t: s.body, capture: 1 },
      { id: 3, name: "footer", y: 246, h: 42, t: s.footer, capture: 0 },
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
              content: b.t,
              paddingLength: 4,
              borderWidth: 0,
              isEventCapture: b.capture,
              textColor: b.id === 2 ? 4 : 2,
            }),
        ),
      }),
    );
    if (result !== 0) throw new Error("Startup refused");
    ready = true;
    el("bridge").textContent = "Even Hub connected · touchpad / R1 navigation";
    console.log("PERSONAL_READY");
    bridge.onEvenHubEvent((e) => {
      if (e.audioEvent && captureState === "recording") {
        const chunk = new Uint8Array(e.audioEvent.audioPcm);
        if (audioSize + chunk.length <= 960000) {
          audioChunks.push(chunk);
          audioSize += chunk.length;
        } else safe(() => finishVoice());
      }
      const t = [e.sysEvent, e.textEvent, e.listEvent]
        .filter(Boolean)
        .map((x) => x!.eventType ?? OsEventTypeList.CLICK_EVENT);
      if (
        t.some((t) =>
          [
            OsEventTypeList.FOREGROUND_EXIT_EVENT,
            OsEventTypeList.SYSTEM_EXIT_EVENT,
            OsEventTypeList.ABNORMAL_EXIT_EVENT,
          ].includes(t),
        )
      ) {
        running = false;
        safe(() => finishVoice(true));
        clearTimeout(pairTimer);
        return;
      }
      if (t.includes(OsEventTypeList.FOREGROUND_ENTER_EVENT)) {
        running = true;
        if (token) safe(refresh);
        render();
        return;
      }
      if (t.includes(OsEventTypeList.LONG_PRESS_EVENT)) {
        safe(startVoice);
        return;
      }
      if (t.includes(OsEventTypeList.LONG_PRESS_RELEASE_EVENT)) {
        safe(() => finishVoice());
        return;
      }
      if (t.includes(OsEventTypeList.DOUBLE_CLICK_EVENT))
        safe(() => action("back"));
      else if (t.includes(OsEventTypeList.SCROLL_TOP_EVENT))
        safe(() => action("up"));
      else if (t.includes(OsEventTypeList.SCROLL_BOTTOM_EVENT))
        safe(() => action("down"));
      else if (t.includes(OsEventTypeList.CLICK_EVENT))
        safe(() => action("tap"));
    });
    render();
  } catch {
    note("Use the official simulator or Even Hub to connect G2.");
  }
})();
setInterval(() => {
  if (running && token && stage === "brief" && !busy) safe(refresh);
}, 20000);
