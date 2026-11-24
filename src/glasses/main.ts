import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  ImageContainerProperty,
  ImageRawDataUpdate,
  OsEventTypeList,
  AudioInputSource,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import { GlassesApp, type Frame, type Input } from "./controller.js";
import "./style.css";
const host = document.getElementById("app")!;
host.innerHTML =
  '<main><header><span class="brand">FIELDLINE</span><span>Telegram for your glasses</span></header><section class="intro"><p class="eyebrow">YOUR CONVERSATIONS. HEADS UP.</p><h1>Telegram lives here.</h1><p>Browse, read, write and respond using your G2 or R1 controls. This screen mirrors the glasses. Your phone is only needed for setup and to host Even Hub.</p></section><section class="display" aria-label="Glasses display mirror"><div class="display-head"><img id="screen-icon" alt="" width="26" height="26"><h2 id="title"></h2></div><pre id="body"></pre><p id="footer"></p></section><p id="status" role="status">Connecting…</p><nav aria-label="Simulator controls"><button data-input="up" aria-label="Swipe up">↑<small>Previous</small></button><button data-input="tap">●<small>Tap / open</small></button><button data-input="down" aria-label="Swipe down">↓<small>Next</small></button><button data-input="back">↩<small>Double / back</small></button></nav><p class="hint">Swipe to select · Tap to open · Double tap to go back<br>Hold to dictate while composing or searching</p><details><summary>Account setup & server</summary><p>The backend holds your personal Telegram session. Run <code>npm run personal:login</code> on your server, then approve the pairing code shown in your glasses with <code>npm run personal:approve -- CODE</code>. Never paste Telegram login codes into this page.</p><p>Voice needs a configured speech-to-text endpoint. The glasses keyboard works without it.</p><a href="personal.html">Open optional companion workspace</a></details></main>';
const el = (id: string) => document.getElementById(id)!;
const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
let token = localStorage.getItem("fieldline.glasses.session") ?? "",
  bridge: EvenAppBridge | undefined,
  ready = false,
  running = true,
  queue = Promise.resolve(),
  pairId = "",
  pairCode = "",
  synthetic = false,
  pairTimer: ReturnType<typeof setTimeout> | undefined;
let current: Frame = {
  title: "FIELDLINE / TELEGRAM",
  body: "Connecting to your server…",
  footer: "",
  icon: "telegram",
};
async function api(path: string, body?: unknown) {
  const r = await fetch(apiBase + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json();
  if (r.status === 401) {
    token = "";
    localStorage.removeItem("fieldline.glasses.session");
  }
  if (!r.ok) throw new Error(data.error ?? "Server unavailable.");
  return data;
}
const icons = new Map<string, number[]>();
async function image(name: string) {
  if (!icons.has(name)) {
    const r = await fetch("./g2/icons/" + name + ".png");
    if (!r.ok) throw new Error("Icon unavailable");
    icons.set(name, Array.from(new Uint8Array(await r.arrayBuffer())));
  }
  return icons.get(name)!;
}
function render(frame: Frame) {
  current = frame;
  el("title").textContent = frame.title;
  el("body").textContent = frame.body;
  el("footer").textContent = frame.footer;
  (el("screen-icon") as HTMLImageElement).src =
    "./g2/icons/" + frame.icon + ".png";
  console.log("GLASSES_FRAME", JSON.stringify(frame));
  if (ready && running)
    queue = queue
      .then(async () => {
        if (!running) return;
        for (const [id, name, content] of [
          [1, "header", frame.title],
          [2, "body", frame.body],
          [3, "footer", frame.footer],
        ] as const)
          await bridge!.textContainerUpgrade(
            new TextContainerUpgrade({
              containerID: id,
              containerName: name,
              content,
            }),
          );
        try {
          await bridge!.updateImageRawData(
            new ImageRawDataUpdate({
              containerID: 4,
              containerName: "icon",
              imageData: await image(frame.icon),
            }),
          );
        } catch {
          el("status").textContent = "Connected · icon unavailable";
        }
      })
      .catch(() => {
        el("status").textContent = "Display update unavailable. Reopen app.";
      });
}
const app = new GlassesApp(api, render, async () => {
  await bridge?.shutDownPageContainer(0);
});
function error(e: unknown) {
  el("status").textContent = (e as Error).message;
  if (!token) {
    pairId = "";
    pairCode = "";
    render({
      title: "CONNECT TELEGRAM",
      body: (e as Error).message + "\n\nTap to pair this display.",
      footer: "Tap: connect",
      icon: "glasses",
    });
  } else {
    const previous = { ...app.frame },
      mode = app.mode,
      menu = app.menu,
      page = app.page,
      reading = app.reading,
      title = app.readTitle,
      icon = app.readIcon,
      next = app.onRead,
      back = app.onReadBack;
    app.notice("COULD NOT COMPLETE", (e as Error).message, () => {
      app.mode = mode;
      app.menu = menu;
      app.page = page;
      app.reading = reading;
      app.readTitle = title;
      app.readIcon = icon;
      app.onRead = next;
      app.onReadBack = back;
      app.emit(previous);
    });
  }
}
function safe(f: () => Promise<unknown>) {
  void f().catch(error);
}
async function pollPair() {
  clearTimeout(pairTimer);
  if (!pairId || !running) return;
  try {
    const r = await api("/pair/" + pairId);
    if (r.token) {
      token = r.token;
      localStorage.setItem("fieldline.glasses.session", token);
      pairId = "";
      pairCode = "";
      await app.start();
      el("status").textContent = synthetic
        ? "Synthetic demo · no real messages sent"
        : "Personal Telegram connected";
      return;
    }
    pairTimer = setTimeout(() => safe(pollPair), 1500);
  } catch (e) {
    pairId = "";
    pairCode = "";
    throw e;
  }
}
async function input(event: Input) {
  if (recording || transcribing) {
    if (event === "back") await stopVoice(true);
    return;
  }
  if (!token) {
    if (event !== "tap") return;
    if (!pairId) {
      const p = await api("/pair", {});
      pairId = p.id;
      pairCode = p.code;
      render({
        title: synthetic ? "CONNECT SYNTHETIC DEMO" : "PAIR THIS DISPLAY",
        body:
          "Pairing code: " +
          pairCode +
          "\n\n" +
          (synthetic
            ? "Tap again to enter the demo."
            : "Approve this code from your server.\nPhone is only needed for setup."),
        footer: synthetic ? "Tap: approve demo" : "Waiting for owner approval…",
        icon: "glasses",
      });
      safe(pollPair);
    } else if (synthetic) {
      await api("/pair/approve", { code: pairCode });
      await pollPair();
    }
    return;
  }
  await app.input(event);
}
document
  .querySelectorAll<HTMLButtonElement>("[data-input]")
  .forEach(
    (b) => (b.onclick = () => safe(() => input(b.dataset.input as Input))),
  );
let recording = false,
  transcribing = false,
  chunks: Uint8Array[] = [],
  size = 0,
  micTimer: ReturnType<typeof setTimeout> | undefined;
async function startVoice() {
  if (!token || !app.active || recording || transcribing || app.busy) return;
  const title = app.menu?.title ?? "";
  if (
    !/^(REPLY|WRITE|TYPE|FIND|LETTER|DICTATE)/.test(title) &&
    !(app.mode === "read" && app.readTitle.startsWith("DICTATE"))
  )
    return;
  if (!app.voiceEnabled) {
    app.notice(
      "VOICE UNAVAILABLE",
      "Use the glasses keyboard.\nConfigure a speech-to-text endpoint on your server to enable dictation.",
      () =>
        app.inputPurpose === "compose" ? app.composeMenu() : app.keyboard(),
    );
    return;
  }
  recording = true;
  chunks = [];
  size = 0;
  try {
    await bridge!.audioControl(true, AudioInputSource.Glasses);
    render({
      title: "LISTENING",
      body: "Speak your message.\n\nRelease to transcribe.\nDouble tap to discard.\nNothing sends automatically.",
      footer: "Hold: record · Release: transcribe",
      icon: "mic",
    });
    micTimer = setTimeout(() => safe(() => stopVoice()), 30000);
  } catch {
    recording = false;
    throw new Error("Could not start the glasses microphone.");
  }
}
async function stopVoice(discard = false) {
  if (!recording) return;
  clearTimeout(micTimer);
  recording = false;
  transcribing = true;
  try {
    await bridge?.audioControl(false);
    if (discard || !running || size < 3200) {
      if (running) render(app.frame);
      return;
    }
    render({
      title: "TRANSCRIBING",
      body: "Preparing your draft…\n\nReview it before sending.",
      footer: "Nothing sends automatically",
      icon: "mic",
    });
    const pcm = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    const r = await fetch(apiBase + "/api/transcribe", {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/octet-stream",
        },
        body: pcm,
        signal: AbortSignal.timeout(22000),
      }),
      d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Transcription unavailable.");
    if (running) app.voiceText(d.text);
  } finally {
    transcribing = false;
    chunks = [];
    size = 0;
  }
}
function stop() {
  running = false;
  app.active = false;
  clearTimeout(pairTimer);
  safe(() => stopVoice(true));
}
window.addEventListener("pagehide", stop);
safe(async () => {
  const health = await api("/health");
  synthetic = health.synthetic;
  if (token) await app.start();
  else
    render({
      title: "TELEGRAM / FIELDLINE",
      body: "Your Telegram, on G2.\n\nChats · messages · replies\nReactions · Saved Messages\n\nTap to connect this display.",
      footer: "Tap: connect · Phone: setup only",
      icon: "telegram",
    });
  el("status").textContent = synthetic
    ? "Synthetic demo server"
    : "Server ready";
});
void (async () => {
  try {
    bridge = await waitForEvenAppBridge();
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 4,
        textObject: [
          {
            id: 1,
            name: "header",
            x: 44,
            y: 0,
            w: 524,
            h: 38,
            t: current.title,
          },
          { id: 2, name: "body", x: 8, y: 42, w: 560, h: 198, t: current.body },
          {
            id: 3,
            name: "footer",
            x: 8,
            y: 246,
            w: 560,
            h: 42,
            t: current.footer,
          },
        ].map(
          (b) =>
            new TextContainerProperty({
              containerID: b.id,
              containerName: b.name,
              xPosition: b.x,
              yPosition: b.y,
              width: b.w,
              height: b.h,
              content: b.t,
              paddingLength: 4,
              borderWidth: 0,
              isEventCapture: b.id === 2 ? 1 : 0,
              textColor: b.id === 2 ? 4 : 2,
            }),
        ),
        imageObject: [
          new ImageContainerProperty({
            containerID: 4,
            containerName: "icon",
            xPosition: 8,
            yPosition: 7,
            width: 24,
            height: 24,
          }),
        ],
      }),
    );
    if (result !== 0) throw new Error("Display refused startup.");
    ready = true;
    el("status").textContent = "G2 connected · navigate from glasses";
    bridge.onEvenHubEvent((e) => {
      if (e.audioEvent && recording) {
        const chunk = new Uint8Array(e.audioEvent.audioPcm);
        if (size + chunk.length <= 960000) {
          chunks.push(chunk);
          size += chunk.length;
        } else safe(() => stopVoice());
      }
      const types = [e.sysEvent, e.textEvent, e.listEvent]
        .filter(Boolean)
        .map((v) => v!.eventType ?? OsEventTypeList.CLICK_EVENT);
      if (
        types.some((t) =>
          [
            OsEventTypeList.FOREGROUND_EXIT_EVENT,
            OsEventTypeList.SYSTEM_EXIT_EVENT,
            OsEventTypeList.ABNORMAL_EXIT_EVENT,
          ].includes(t),
        )
      ) {
        stop();
        return;
      }
      if (types.includes(OsEventTypeList.FOREGROUND_ENTER_EVENT)) {
        running = true;
        app.active = true;
        if (pairId) safe(pollPair);
        render(current);
        return;
      }
      if (!running) return;
      if (types.includes(OsEventTypeList.LONG_PRESS_EVENT)) {
        safe(startVoice);
        return;
      }
      if (types.includes(OsEventTypeList.LONG_PRESS_RELEASE_EVENT)) {
        safe(() => stopVoice());
        return;
      }
      if (types.includes(OsEventTypeList.DOUBLE_CLICK_EVENT))
        safe(() => input("back"));
      else if (types.includes(OsEventTypeList.SCROLL_TOP_EVENT))
        safe(() => input("up"));
      else if (types.includes(OsEventTypeList.SCROLL_BOTTOM_EVENT))
        safe(() => input("down"));
      else if (types.includes(OsEventTypeList.CLICK_EVENT))
        safe(() => input("tap"));
    });
    render(current);
    console.log("GLASSES_READY");
  } catch {
    el("status").textContent =
      "Preview · open in Even Hub for glasses controls";
  }
})();
