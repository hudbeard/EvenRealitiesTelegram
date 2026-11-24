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
import "./workspace.css";
import { shell } from "./shell.js";
import { icon, symbol, buttonLabel, type IconName } from "./icons.js";
type Source = Message & { revision: string };
type Stage =
  "brief" | "sponsored" | "source" | "actions" | "preview" | "outcome";
const root = document.getElementById("app")!;
root.innerHTML = shell();
const el = (id: string) => document.getElementById(id)!;
const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
let refreshFailed = false,
  refreshing = false;
let uiView: "catchup" | "chats" | "display" = "catchup",
  cardFilter = "all",
  managingChats = false;
const chatDrafts = new Map<string, string>();
let selectionDraft = new Set<string>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
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
function visibleIndices() {
  return cards.flatMap((c, i) =>
    cardFilter === "all" ||
    c.kind === cardFilter ||
    (cardFilter === "reply" && c.kind === "question")
      ? [i]
      : [],
  );
}
function setView(view: typeof uiView) {
  uiView = view;
  syncUI();
}
function drawChats() {
  const query = (el("chat-search") as HTMLInputElement).value.toLowerCase();
  el("chats").replaceChildren();
  const filtered = chats.filter((c) => c.title.toLowerCase().includes(query));
  for (const chat of filtered) {
    const row = document.createElement("div");
    row.className = "chat-row" + (activeChat?.id === chat.id ? " current" : "");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = chat.id;
    checkbox.checked = managingChats
      ? selectionDraft.has(chat.id)
      : watched.includes(chat.id);
    checkbox.hidden = !managingChats;
    checkbox.setAttribute("aria-label", `Include ${chat.title} in catch-up`);
    checkbox.onchange = () => {
      if (checkbox.checked) selectionDraft.add(chat.id);
      else selectionDraft.delete(chat.id);
      buttonLabel(
        el("watch"),
        "check",
        `Save selection (${selectionDraft.size}/10)`,
      );
    };
    const button = document.createElement("button");
    button.className = "chat-button";
    button.setAttribute(
      "aria-label",
      `Open ${chat.title}${chat.unread ? ", " + chat.unread + " unread messages" : ""}`,
    );
    const avatar = symbol(
      chat.kind === "dm" ? "user" : chat.kind === "group" ? "users" : "channel",
      "avatar " + (chat.kind === "dm" ? "" : "group"),
    );
    const copy = text("span", "", "chat-copy");
    copy.append(
      text("strong", chat.title),
      text(
        "small",
        watched.includes(chat.id)
          ? chat.kind === "dm"
            ? "Direct message"
            : "Group conversation"
          : "Not in catch-up",
      ),
    );
    button.append(avatar, copy);
    if (chat.unread > 0)
      button.append(text("span", String(chat.unread), "unread-count"));
    button.onclick = () =>
      safe(async () => {
        if (!watched.includes(chat.id)) {
          managingChats = true;
          selectionDraft = new Set(watched);
          setView("chats");
          drawChats();
          note(
            "Add this conversation to your selection, then save to open its messages.",
          );
          return;
        }
        await openChat(chat);
      });
    row.append(checkbox, button);
    el("chats").append(row);
  }
  if (!filtered.length)
    el("chats").append(
      text("p", "No conversations match your search.", "selection-hint"),
    );
  el("watch").hidden = !managingChats;
  el("selection-hint").hidden = !managingChats;
  buttonLabel(
    el("watch"),
    "check",
    `Save selection (${selectionDraft.size}/10)`,
  );
  el("manage-chats").innerHTML = icon(managingChats ? "x" : "plus");
  el("manage-chats").setAttribute(
    "aria-label",
    managingChats ? "Cancel chat selection" : "Choose chats",
  );
  syncUI();
}
function drawCards() {
  const visible = visibleIndices();
  el("cards").replaceChildren();
  const counts = {
    change: cards.filter((c) => c.kind === "change").length,
    reply: cards.filter((c) => c.kind === "reply" || c.kind === "question")
      .length,
    commitment: cards.filter((c) => c.kind === "commitment").length,
  };
  for (const key of ["change", "reply", "commitment"] as const)
    el(key + "-count").textContent = String(counts[key]);
  el("catchup-count").textContent = String(cards.length);
  el("brief-empty").textContent = cards.length
    ? `${cards.length} source-linked updates from ${watched.length} selected conversation${watched.length === 1 ? "" : "s"}.`
    : "Your selected conversations are ready. New source-linked updates will appear here.";
  el("catchup-empty").hidden = visible.length > 0;
  const emptyTitle = el("catchup-empty").querySelector("h2")!,
    emptyDescription = el("catchup-empty").querySelector("p")!;
  emptyTitle.textContent =
    cardFilter === "all"
      ? "You're up to date."
      : cardFilter === "change"
        ? "No plan changes in this window."
        : cardFilter === "reply"
          ? "No replies waiting in this view."
          : "No commitments in this window.";
  emptyDescription.textContent =
    cardFilter === "all"
      ? "New updates from your selected conversations will appear here."
      : cards.length
        ? "Your other updates are still available under All updates."
        : "New updates from your selected conversations will appear here.";
  el("clear-filter").hidden = cardFilter === "all";
  for (const i of visible) {
    const c = cards[i],
      kind = c.kind === "question" ? "reply" : c.kind;
    const symbols: Record<string, IconName> = {
      change: "change",
      reply: "reply",
      commitment: "clock",
    };
    const labels: Record<string, string> = {
      change: "PLAN UPDATE",
      reply: "WAITING ON YOU",
      commitment: "YOU SAID",
    };
    const b = document.createElement("button");
    b.className = "brief-card";
    b.dataset.cardIndex = String(i);
    b.setAttribute(
      "aria-label",
      `Read source: ${c.title}, ${c.evidence[0].chatTitle}`,
    );
    const head = text("span", "", "card-heading"),
      title = text("span", "", "card-title");
    title.append(
      text("strong", c.title),
      text("small", c.evidence[0].chatTitle + " · " + c.evidence[0].sender),
    );
    head.append(
      symbol(symbols[kind], "card-symbol tone-" + kind),
      title,
      text("span", labels[kind], "card-kind tone-" + kind),
    );
    b.append(head, text("span", c.evidence[0].quote, "card-quote"));
    if (c.evidence[1]) {
      const earlier = text("span", "", "earlier");
      earlier.append(
        text("span", "ORIGINAL CONTEXT"),
        document.createTextNode(c.evidence[1].quote),
      );
      b.append(earlier);
    }
    const footer = text("span", "", "card-footer"),
      link = text("span", "", "source-link");
    link.append(symbol("eye"), document.createTextNode("Read source"));
    footer.append(text("span", "Message #" + c.evidence[0].messageId), link);
    b.append(footer);
    b.onclick = () =>
      safe(async () => {
        selected = i;
        await openSource(c.evidence[0].chatId, c.evidence[0].messageId);
      });
    el("cards").append(b);
  }
  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((b) => {
    const on = b.dataset.filter === cardFilter;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}
function syncUI() {
  document.body.dataset.view = uiView;
  document.body.dataset.paired = String(!!token);
  document.body.dataset.chatOpen = String(!!activeChat && !managingChats);
  el("hero").hidden = !!token;
  el("workspace").hidden = !token;
  el("catchup-panel").hidden = uiView !== "catchup";
  el("conversation-panel").hidden = uiView !== "chats";
  el("conversation-empty").hidden = !!activeChat;
  el("conversation").hidden = !activeChat;
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
    const on = b.dataset.view === uiView;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
    b.disabled = !token;
  });
  document
    .querySelectorAll<HTMLElement>("[data-card-index]")
    .forEach((c) =>
      c.classList.toggle("selected", Number(c.dataset.cardIndex) === selected),
    );
  el("messages")
    .querySelectorAll<HTMLElement>("[data-message-id]")
    .forEach((b) => {
      const on =
        !!active &&
        Number(b.dataset.messageId) === active.id &&
        activeChat?.id === active.chatId;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-pressed", String(on));
    });
  const progress =
    stage === "brief"
      ? 0
      : stage === "source" || stage === "sponsored"
        ? 1
        : stage === "outcome"
          ? 3
          : 2;
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((s, i) => {
    s.classList.toggle("current", i === progress);
    s.classList.toggle("complete", i < progress);
    if (i === progress) s.setAttribute("aria-current", "step");
    else s.removeAttribute("aria-current");
  });
  const actions: Record<Stage, [IconName, string]> = {
    brief: ["eye", "Open source"],
    source: ["plus", "Choose action"],
    sponsored: ["right", "Continue"],
    actions: ["eye", "Review action"],
    preview: [
      pending?.kind === "reply"
        ? "send"
        : pending?.kind === "react"
          ? "thumb"
          : "bookmark",
      "Confirm " + (pending?.kind ?? "action"),
    ],
    outcome: ["check", "Back to catch-up"],
  };
  buttonLabel(el("tap"), ...actions[stage]);
  el("stage-hint").textContent = !token
    ? "Pair your display to begin."
    : stage === "brief"
      ? "Open an update to read the message behind it."
      : stage === "source"
        ? "Read the context, then choose how to respond."
        : stage === "actions"
          ? "Choose Reply, React, or Save. You will review it next."
          : stage === "preview"
            ? "Check the destination and content. Confirm only when ready."
            : stage === "outcome"
              ? "Your outcome is shown below. Return to catch-up when ready."
              : "Read the sponsored message to continue.";
  for (const id of [
    "up",
    "tap",
    "down",
    "back",
    "reply-focus",
    "react",
    "save-message",
  ])
    (el(id) as HTMLButtonElement).disabled = busy || captureState !== "idle";
  el("display-connection").textContent = ready
    ? "Even Hub connected"
    : "Phone preview";
  el("display-connection").classList.toggle("connected", ready);
  buttonLabel(
    el("refresh"),
    refreshing ? "loading" : "refresh",
    refreshing ? "Refreshing" : "Refresh",
  );
  el("refresh").querySelector(".icon")?.classList.toggle("spin", refreshing);
  (el("refresh") as HTMLButtonElement).disabled = refreshing;
  el("source-actions").hidden = !active;
  if (active) {
    el("source-sender").textContent =
      active.sender + " · " + (activeChat?.title ?? "");
    el("source-snippet").textContent = active.text;
  }
  const draftField = el("draft") as HTMLTextAreaElement;
  draftField.disabled = !active || busy;
  el("draft-count").textContent = `${draftField.value.length} / 4096`;
  el("reply-recipient").textContent = active
    ? "Replying to " + active.sender
    : "Choose a message to reply";
  el("reply-quote").textContent =
    active?.text ?? "Select a source above to start.";
  (el("review-reply") as HTMLButtonElement).disabled =
    !active || !draftField.value.trim() || busy;
  (el("voice-reply") as HTMLButtonElement).disabled =
    !active || !voiceEnabled || !ready || captureState === "transcribing";
  buttonLabel(
    el("voice-reply"),
    "mic",
    captureState === "recording"
      ? "Release to transcribe"
      : voiceEnabled
        ? "Hold to dictate"
        : "Voice not connected",
  );
  el("voice-hint").textContent = voiceEnabled
    ? "Dictate a reply for review"
    : "Type a reply on your phone";
  const dialog = el("review-dialog") as HTMLDialogElement;
  if (stage === "preview" && pending && active) {
    const name =
      pending.kind === "reply"
        ? "reply"
        : pending.kind === "react"
          ? "reaction"
          : "save";
    el("review-title").textContent =
      pending.kind === "save" ? "Save this message?" : "Review your " + name;
    el("review-destination").textContent =
      pending.kind === "save" ? "Your Saved Messages" : activeChat!.title;
    el("review-source").textContent =
      `${pending.kind === "reply" ? "Reply as you" : "Message action"} · source #${active.id}`;
    el("review-body").textContent =
      pending.kind === "reply"
        ? pending.text!
        : pending.kind === "react"
          ? "React with 👍"
          : "Forward this source message to your Saved Messages.";
    el("review-original").textContent = active.sender + ": " + active.text;
    el("review-mode").textContent = synthetic
      ? "Demo mode: this action uses synthetic data and makes no Telegram write."
      : "This action uses your Telegram account.";
    buttonLabel(
      el("review-confirm"),
      busy
        ? "loading"
        : pending.kind === "reply"
          ? "send"
          : pending.kind === "react"
            ? "thumb"
            : "bookmark",
      busy
        ? "Confirming…"
        : pending.kind === "reply"
          ? "Confirm reply"
          : pending.kind === "react"
            ? "Confirm reaction"
            : "Confirm save",
    );
    for (const id of ["review-confirm", "review-cancel", "review-close"])
      (el(id) as HTMLButtonElement).disabled = busy;
    if (!dialog.open) dialog.showModal();
  } else if (dialog.open) dialog.close();
  el("result").hidden = stage !== "outcome";
  if (stage === "outcome") {
    el("result").textContent = outcome;
    el("result").classList.toggle(
      "uncertain",
      outcome.toLowerCase().includes("uncertain"),
    );
  }
}
function note(s: string) {
  clearTimeout(toastTimer);
  el("notice").textContent = s;
  el("toast").hidden = !s;
  if (
    s &&
    !s.toLowerCase().includes("failed") &&
    !s.toLowerCase().includes("could not") &&
    !s.toLowerCase().includes("unavailable")
  )
    toastTimer = setTimeout(() => {
      el("toast").hidden = true;
    }, 7000);
  if ((el("review-dialog") as HTMLDialogElement).open && s) {
    el("review-error").textContent = s;
    el("review-error").hidden = false;
  }
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
    const visible = visibleIndices();
    const c = visible.length ? cards[selected] : undefined;
    return c
      ? {
          title:
            tag +
            `${c.kind.toUpperCase()} / ${visible.indexOf(selected) + 1} OF ${visible.length}`,
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
  syncUI();
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
  syncUI();
  try {
    const d = await api("/dialogs");
    chats = d.chats;
    watched = d.watched;
    el("pair-panel").hidden = true;
    el("workspace").hidden = false;
    el("status").textContent = synthetic ? "Demo account" : "Account paired";
    const brief = await api("/brief");
    cards = brief.cards;
    const indices = visibleIndices();
    if (!indices.includes(selected)) selected = indices[0] ?? 0;
    drawChats();
    drawCards();
    el("last-updated").textContent = "Updated just now";
    refreshFailed = false;
    render();
  } catch (e) {
    refreshFailed = true;
    render();
    throw e;
  } finally {
    refreshing = false;
    syncUI();
  }
}
async function openChat(chat: Chat, search = "") {
  const ownsBusy = !busy;
  if (ownsBusy) {
    busy = true;
    syncUI();
  }
  try {
    const switching = activeChat?.id !== chat.id;
    if (activeChat) chatDrafts.set(activeChat.id, draft());
    const h = await api(
      `/chats/${encodeURIComponent(chat.id)}/messages${search ? "?search=" + encodeURIComponent(search) : ""}`,
    );
    activeChat = chat;
    if (switching) {
      active = null;
      original = null;
      stage = "brief";
      page = 0;
      (el("draft") as HTMLTextAreaElement).value =
        chatDrafts.get(chat.id) ??
        (synthetic ? "Thanks, I saw the update." : "");
    }
    setView("chats");
    el("conversation").hidden = false;
    el("chat-title").textContent = chat.title;
    el("chat-subtitle").textContent =
      (chat.kind === "dm"
        ? "Direct message"
        : chat.kind === "group"
          ? "Group conversation"
          : "Channel") +
      " · " +
      chat.unread +
      " unread";
    el("conversation-avatar").innerHTML = icon(
      chat.kind === "dm" ? "user" : chat.kind === "group" ? "users" : "channel",
    );
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
    let lastDay = "";
    for (const m of h.messages as Source[]) {
      const date = new Date(m.date),
        valid = Number.isFinite(date.getTime());
      const day = valid
        ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "";
      if (day && day !== lastDay) {
        const today = new Date().toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
        el("messages").append(
          text("div", day === today ? "Today" : day, "date-label"),
        );
        lastDay = day;
      }
      const b = document.createElement("button");
      b.className = "message " + (m.outgoing ? "outgoing" : "");
      b.dataset.messageId = String(m.id);
      b.setAttribute(
        "aria-label",
        `Open message from ${m.sender}${valid ? " at " + date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : ""}`,
      );
      const sender = text("span", "", "sender-row");
      sender.append(
        text("strong", m.sender),
        text(
          "span",
          valid
            ? date.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })
            : "",
          "message-time",
        ),
      );
      const metadata = text("small", "");
      metadata.append(
        symbol(m.replyTo ? "reply" : m.outgoing ? "check" : "chats"),
        document.createTextNode(
          `${m.replyTo ? "Replies to #" + m.replyTo : "Message #" + m.id}${m.editedAt ? " · edited" : ""}`,
        ),
      );
      b.append(
        sender,
        text(
          "span",
          m.text || `[${m.media ?? "Attachment"} — open in Telegram]`,
          "message-text",
        ),
        metadata,
      );
      b.onclick = () => safe(() => openSource(chat.id, m.id));
      el("messages").append(b);
    }
    if (!h.messages.length) {
      const empty = text("div", "", "empty-state");
      empty.append(
        symbol("search"),
        text("h2", search ? "No matching messages" : "No recent messages"),
        text(
          "p",
          search
            ? "Try a different word, or clear your search to see the conversation."
            : "Messages will appear here when this conversation has activity.",
        ),
      );
      el("messages").append(empty);
    }
    drawChats();
    syncUI();
    return h;
  } finally {
    if (ownsBusy) {
      busy = false;
      syncUI();
    }
  }
}
async function openSource(chatId: string, id: number) {
  const ownsBusy = !busy;
  if (ownsBusy) {
    busy = true;
    syncUI();
  }
  try {
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
    el("messages")
      .querySelectorAll<HTMLElement>("[data-message-id]")
      .forEach((b) => {
        const on = Number(b.dataset.messageId) === active!.id;
        b.classList.toggle("selected", on);
        b.setAttribute("aria-pressed", String(on));
      });
    if (stage === "source" && wrap(sourceText()).length <= 6)
      await api(`/chats/${encodeURIComponent(chatId)}/read`, { messageId: id });
  } finally {
    if (ownsBusy) {
      busy = false;
      syncUI();
    }
  }
}
function draft() {
  return (el("draft") as HTMLTextAreaElement).value;
}
function previewText() {
  return `TO ${activeChat!.title}\nMessage #${active!.id}\n\n${pending!.kind === "reply" ? pending!.text : pending!.kind === "save" ? "Forward to your Saved Messages" : "React with thumbs up"}`;
}
async function action(
  input: "tap" | "up" | "down" | "back",
  reviewedOnPhone = false,
) {
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
      if (stage === "brief") {
        const indices = visibleIndices();
        const at = indices.indexOf(selected);
        selected =
          indices[(at + d + indices.length) % Math.max(1, indices.length)] ?? 0;
      }
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
      const c = visibleIndices().length ? cards[selected] : undefined;
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
      el("review-error").hidden = true;
      stage = "preview";
      page = 0;
    } else if (stage === "preview") {
      if (
        !reviewedOnPhone &&
        page < Math.ceil(wrap(previewText()).length / 6) - 1
      ) {
        note("Read the remaining preview pages before confirming.");
        return;
      }
      syncUI();
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
      note(
        r.status === "sent"
          ? synthetic
            ? "Demo " +
              (pending!.kind === "reply"
                ? "reply"
                : pending!.kind === "react"
                  ? "reaction"
                  : "save") +
              " confirmed. No Telegram message was sent."
            : pending!.kind === "reply"
              ? "Your reply was sent."
              : pending!.kind === "save"
                ? "Message saved to Saved Messages."
                : "Reaction confirmed."
          : "Delivery could not be verified. Check Telegram before taking another action.",
      );
      console.log("PERSONAL_OUTCOME", r.status, pending!.kind);
      if (r.status === "sent" && activeChat) {
        try {
          await openChat(activeChat);
        } catch {
          note(
            "Action confirmed. Refresh the conversation to see its latest messages.",
          );
        }
      }
    } else {
      stage = "brief";
      await refresh();
    }
    render();
  } finally {
    busy = false;
    syncUI();
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
    if (selectionDraft.size > 10) {
      note("Choose up to 10 conversations for catch-up.");
      return;
    }
    await api("/watch", {
      ids: [...selectionDraft],
    });
    managingChats = false;
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
    activeChat = null;
    outcome = "";
    chatDrafts.clear();
    setView("catchup");
    render();
  });
document.querySelectorAll<HTMLButtonElement>("[data-draft]").forEach(
  (b) =>
    (b.onclick = () => {
      (el("draft") as HTMLTextAreaElement).value = b.dataset.draft!;
      if (activeChat) chatDrafts.set(activeChat.id, draft());
      syncUI();
    }),
);
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      if (!token) return;
      const view = b.dataset.view as typeof uiView;
      if (view === "catchup") {
        stage = "brief";
        page = 0;
      }
      setView(view);
      render();
    }),
);
document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      cardFilter = b.dataset.filter!;
      selected = visibleIndices()[0] ?? 0;
      drawCards();
      render();
    }),
);
el("clear-filter").onclick = () => {
  cardFilter = "all";
  selected = visibleIndices()[0] ?? 0;
  drawCards();
  render();
};
function manageChats() {
  managingChats = !managingChats;
  selectionDraft = new Set(watched);
  setView("chats");
  drawChats();
}
el("manage-chats").onclick = manageChats;
el("choose-conversation").onclick = manageChats;
el("chat-search").oninput = drawChats;
el("back-catchup").onclick = () => {
  activeChat = null;
  active = null;
  stage = "brief";
  setView("chats");
  drawChats();
  render();
};
el("search").onkeydown = (e) => {
  if ((e as KeyboardEvent).key === "Enter") {
    e.preventDefault();
    el("find").click();
  }
};
el("clear-search").onclick = () => {
  (el("search") as HTMLInputElement).value = "";
  if (activeChat) safe(() => openChat(activeChat!));
};
el("draft").oninput = () => {
  if (activeChat) chatDrafts.set(activeChat.id, draft());
  syncUI();
};
el("reply-focus").onclick = () => {
  setView("chats");
  (el("draft") as HTMLTextAreaElement).focus();
};
async function reviewChosen(choiceIndex: number) {
  if (!active || busy) return;
  stage = "actions";
  choice = choiceIndex;
  await action("tap");
}
el("review-reply").onclick = () => safe(() => reviewChosen(0));
el("react").onclick = () => safe(() => reviewChosen(1));
el("save-message").onclick = () => safe(() => reviewChosen(2));
el("review-confirm").onclick = () => safe(() => action("tap", true));
for (const id of ["review-cancel", "review-close"])
  el(id).onclick = () => safe(() => action("back"));
(el("review-dialog") as HTMLDialogElement).oncancel = (e) => {
  e.preventDefault();
  safe(() => action("back"));
};
el("help").onclick = () => (el("help-dialog") as HTMLDialogElement).showModal();
for (const id of ["help-close", "help-done"])
  el(id).onclick = () => (el("help-dialog") as HTMLDialogElement).close();
el("dismiss-notice").onclick = () => note("");
el("voice-reply").onpointerdown = (e) => {
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  safe(startVoice);
};
el("voice-reply").onpointerup = () => safe(() => finishVoice());
el("voice-reply").onpointercancel = () => safe(() => finishVoice(true));
el("voice-reply").onkeydown = (e) => {
  const key = (e as KeyboardEvent).key;
  if ((key === " " || key === "Enter") && !(e as KeyboardEvent).repeat) {
    e.preventDefault();
    safe(startVoice);
  }
};
el("voice-reply").onkeyup = (e) => {
  if ([" ", "Enter"].includes((e as KeyboardEvent).key)) {
    e.preventDefault();
    safe(() => finishVoice());
  }
};
render();
try {
  const health = await api("/health");
  synthetic = health.synthetic;
  voiceEnabled = health.voiceEnabled;
  el("mode").textContent = synthetic
    ? "Demo · synthetic data"
    : "Personal Telegram account";
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
    el("bridge").textContent =
      "Phone preview · connect Even Hub to use your glasses";
    syncUI();
  }
})();
setInterval(() => {
  if (running && token && stage === "brief" && !busy) safe(refresh);
}, 20000);
