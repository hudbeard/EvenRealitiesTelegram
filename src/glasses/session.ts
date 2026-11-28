import type { Frame } from "./controller.js";

export const SESSION_KEY = "fieldline.glasses.session";

export type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function memoryStorage(initial: Record<string, string> = {}): WebStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** In-memory display token + pairing ids, persisted under SESSION_KEY. */
export class DisplaySession {
  token: string;
  pairId = "";
  pairCode = "";
  constructor(
    private storage: WebStorage,
    private key = SESSION_KEY,
  ) {
    this.token = storage.getItem(key) ?? "";
  }
  get paired() {
    return !!this.token;
  }
  remember(token: string) {
    this.token = token;
    this.storage.setItem(this.key, token);
  }
  /** Drop the token and any in-flight pairing ids. Caller still stops timers. */
  clear() {
    this.token = "";
    this.pairId = "";
    this.pairCode = "";
    this.storage.removeItem(this.key);
  }
}

export function welcomeFrame(): Frame {
  return {
    title: "TELEGRAM / FIELDLINE",
    body: "Your Telegram, on G2.\n\nChats · messages · replies\nReactions · Saved Messages\n\nTap to connect this display.",
    footer: "Tap: connect · Phone: setup only",
    icon: "telegram",
  };
}

/** Body for an unpaired error screen: never a second “Tap to pair” line. */
export function pairPromptBody(message: string) {
  return /tap to pair/i.test(message)
    ? message
    : message + "\n\nTap to pair this display.";
}

/** Wearer-facing “tap to connect/pair this display” sentences in the body. */
export function pairPromptCount(frame: Frame) {
  return (frame.body.match(/tap to (connect|pair) this display/gi) ?? []).length;
}

/**
 * After a voluntary disconnect (or any session drop): clear the stored token
 * and pairing ids, stop timers, and show Welcome so a Tap can start pairing
 * without a reload.
 */
export function endDisplaySession(
  session: DisplaySession,
  stopPairing: () => void,
  render: (frame: Frame) => void,
) {
  session.clear();
  stopPairing();
  render(welcomeFrame());
}

/** Start a new pairing code. Used by the unpaired Tap path once the token is gone. */
export async function startPairing(
  session: DisplaySession,
  api: (path: string, body?: unknown) => Promise<{ id: string; code: string; expiresAt: number }>,
) {
  if (session.paired) throw new Error("Already paired. Disconnect first.");
  const p = await api("/pair", {});
  session.pairId = p.id;
  session.pairCode = p.code;
  return p;
}
