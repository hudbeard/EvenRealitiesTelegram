import {
  waitForEvenAppBridge,
  OsEventTypeList,
  AudioInputSource,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import { GlassesApp, type Frame, type Input } from "./controller.js";
import { GlassesDisplay } from "./display.js";
import "./style.css";
const host = document.getElementById("app")!;
host.innerHTML =
  '<main><header><span class="brand">FIELDLINE</span><span>Telegram for your glasses</span></header><section class="intro"><p class="eyebrow">YOUR CONVERSATIONS. HEADS UP.</p><h1>Telegram lives here.</h1><p>Browse, read, write and respond using your G2 or R1 controls. This screen mirrors the glasses. Your phone is only needed for setup and to host Even Hub.</p></section><section class="display" aria-label="Glasses display mirror"><div class="display-head"><img id="screen-icon" alt="" width="26" height="26"><h2 id="title"></h2><span id="badge"></span></div><div class="screen-content"><p id="context" hidden></p><pre id="body"></pre><div id="split" hidden><div id="rows"></div><div class="screen-preview"><strong id="preview-title"></strong><pre id="preview-detail"></pre></div></div></div><p id="footer"></p></section><p id="status" role="status">Connecting…</p><nav aria-label="Simulator controls"><button data-input="up" aria-label="Swipe up">↑<small>Previous</small></button><button data-input="tap">●<small>Tap / open</small></button><button data-input="down" aria-label="Swipe down">↓<small>Next</small></button><button data-input="back">↩<small>Double / back</small></button></nav><p class="hint">Swipe to select · Tap to open · Double tap to go back<br>Hold to dictate while composing or searching</p><details><summary>Account setup & server</summary><p>The backend holds your personal Telegram session. Run <code>npm run personal:login</code> on your server, then approve the pairing code shown in your glasses with <code>npm run personal:approve -- CODE</code>. Never paste Telegram login codes into this page.</p><p>Voice needs a configured speech-to-text endpoint. The glasses keyboard works without it.</p><a href="personal.html">Open optional companion workspace</a></details></main>';
const el = (id: string) => document.getElementById(id)!;
const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
let token = localStorage.getItem("fieldline.glasses.session") ?? "",
  bridge: EvenAppBridge | undefined,
  display: GlassesDisplay | undefined,
  foregroundOverlay = false,
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
  if (!r.ok)
    throw Object.assign(new Error(data.error ?? "Server unavailable."), {
      status: r.status,
    });
  return data;
}
function render(frame: Frame) {
  current = frame;
  el("title").textContent = frame.title;
  el("badge").textContent = frame.badge ?? "";
  el("context").textContent = frame.context ?? "";
  el("context").hidden = !frame.context;
  el("body").hidden = !!frame.split;
  el("body").textContent = frame.body;
  el("split").hidden = !frame.split;
  if (frame.split) {
    const split = frame.split;
    el("rows").replaceChildren(
      ...split.rows.map((label, index) => {
        const row = document.createElement("div");
        row.classList.toggle("focused", index === split.index);
        row.textContent = (index === split.index ? "▶ " : "") + label;
        return row;
      }),
    );
    el("preview-title").textContent = split.heading;
    el("preview-detail").textContent = split.detail;
  }
  el("footer").textContent = frame.footer;
  (el("screen-icon") as HTMLImageElement).src =
    "./g2/icons/" + frame.icon + ".png";
  if (synthetic) console.log("GLASSES_FRAME", JSON.stringify(frame));
  if (display && running) {
    queue = queue
      .then(async () => {
        if (running && current === frame) await display!.render(frame);
      })
      .catch((err) => {
        console.error("Display update:", err.message);
        el("status").textContent = "Display update unavailable. Reopen app.";
      });
  }
}
const app = new GlassesApp(api, render, async () => {
  await bridge?.shutDownPageContainer(1);
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
      back = app.onReadBack,
      context = app.readContext,
      badge = app.readBadge,
      action = app.readAction;
    app.notice("COULD NOT COMPLETE", (e as Error).message, () => {
      app.mode = mode;
      app.menu = menu;
      app.page = page;
      app.reading = reading;
      app.readTitle = title;
      app.readIcon = icon;
      app.onRead = next;
      app.onReadBack = back;
      app.readContext = context;
      app.readBadge = badge;
      app.readAction = action;
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
async function input(event: Input, nativeIndex?: number) {
  if (recording || transcribing) {
    if (event === "back") await cancelVoice();
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
  await app.input(event, nativeIndex);
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
let transcript: AbortController | undefined;
async function cancelVoice() {
  transcript?.abort();
  await stopVoice(true);
}
async function startVoice() {
  if (!token || !app.active || recording || transcribing || app.busy) return;
  if (!bridge || !app.canDictate()) return;
  if (!app.voiceEnabled) {
    app.notice(
      "VOICE UNAVAILABLE",
      "Use the glasses keyboard.\nConfigure a speech-to-text endpoint on your server to enable dictation.",
      () => app.keyboard(),
    );
    return;
  }
  app.prepareDictation();
  recording = true;
  chunks = [];
  size = 0;
  try {
    if (!(await bridge.audioControl(true, AudioInputSource.Glasses)))
      throw new Error("Microphone unavailable");
    if (!recording) return;
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
  transcript = new AbortController();
  try {
    await bridge?.audioControl(false);
    if (discard || transcript.signal.aborted || !running || size < 3200) {
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
        signal: AbortSignal.any([
          transcript.signal,
          AbortSignal.timeout(22000),
        ]),
      }),
      d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Transcription unavailable.");
    if (running && !transcript.signal.aborted) app.voiceText(d.text);
  } catch (error) {
    if (!transcript?.signal.aborted) throw error;
    if (running) render(app.frame);
  } finally {
    transcript = undefined;
    transcribing = false;
    chunks = [];
    size = 0;
  }
}
function stop() {
  running = false;
  app.active = false;
  clearTimeout(pairTimer);
  safe(cancelVoice);
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
    const renderer = new GlassesDisplay(bridge);
    await renderer.start(current);
    display = renderer;
    el("status").textContent = "G2 connected · navigate from glasses";
    bridge.onEvenHubEvent((e) => {
      if (e.audioEvent && recording) {
        const chunk = new Uint8Array(e.audioEvent.audioPcm);
        if (size + chunk.length <= 960000) {
          chunks.push(chunk);
          size += chunk.length;
        } else safe(() => stopVoice());
      }
      const menuId = e.menuItemClickEvent?.itemID;
      if (menuId !== undefined) {
        if (
          running &&
          display?.visibleFrame === current &&
          !recording &&
          !transcribing
        )
          safe(() => app.selectShortcut(menuId));
        return;
      }
      const event = e.sysEvent ?? e.listEvent ?? e.textEvent;
      if (!event) return;
      const type = event.eventType ?? OsEventTypeList.CLICK_EVENT;
      if (
        type === OsEventTypeList.SYSTEM_EXIT_EVENT ||
        type === OsEventTypeList.ABNORMAL_EXIT_EVENT
      ) {
        stop();
        return;
      }
      if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
        foregroundOverlay = running;
        if (!running) {
          running = true;
          app.active = true;
          if (pairId) safe(pollPair);
          render(current);
        }
        return;
      }
      if (type === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
        if (foregroundOverlay) {
          foregroundOverlay = false;
          safe(cancelVoice);
        } else stop();
        return;
      }
      if (!running) return;
      if (type === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) {
        safe(() => stopVoice());
        return;
      }
      if (display?.visibleFrame !== current && !recording && !transcribing)
        return;
      if (type === OsEventTypeList.LONG_PRESS_EVENT) {
        safe(startVoice);
        return;
      }
      if (type === OsEventTypeList.DOUBLE_CLICK_EVENT)
        safe(() => input("back"));
      else if (current.native) {
        const list = e.listEvent;
        if (type !== OsEventTypeList.CLICK_EVENT || !list) return;
        const index =
          list.currentSelectItemIndex ??
          current.native.indexOf(list.currentSelectItemName ?? "");
        if (index >= 0 && index < current.native.length)
          safe(() => input("tap", index));
      } else if (type === OsEventTypeList.SCROLL_TOP_EVENT)
        safe(() => input("up"));
      else if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT)
        safe(() => input("down"));
      else if (type === OsEventTypeList.CLICK_EVENT) safe(() => input("tap"));
    });
    render(current);
    console.log("GLASSES_READY");
  } catch {
    el("status").textContent =
      "Preview · open in Even Hub for glasses controls";
  }
})();
