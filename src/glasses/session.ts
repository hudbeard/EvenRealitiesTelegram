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

export type Health = { synthetic?: unknown; mode?: unknown };
type PairApi = (path: string, body?: unknown) => Promise<any>;

/**
 * Only the synthetic demo server is ever auto-paired. A live server needs
 * the wearer's six-digit code approved from the server terminal (and its
 * /api/pair/approve rejects requests without the local approval key).
 */
export function canAutoPair(health: Health | undefined) {
  return health?.synthetic === true && health?.mode === "personal-demo";
}

/**
 * Demo/simulator only: request a pairing code, approve it and store the
 * display token without asking for taps. Returns false (and makes no
 * request) unless `health` is the synthetic demo server.
 */
export async function autoPairSynthetic(
  session: DisplaySession,
  api: PairApi,
  health: Health | undefined,
) {
  if (!canAutoPair(health)) return false;
  if (session.paired) return true;
  const p = await api("/pair", {});
  const approved = await api("/pair/approve", { code: p.code });
  if (approved?.approved !== true) return false;
  const r = await api("/pair/" + p.id);
  if (typeof r?.token !== "string" || !r.token) return false;
  session.pairId = "";
  session.pairCode = "";
  session.remember(r.token);
  return true;
}

/**
 * Bounded auto-pair for boot and for a synthetic 401: at most `budget`
 * tries until a start succeeds, so a server that keeps rejecting the new
 * token cannot loop. `succeeded()` refills the budget.
 */
export class AutoPair {
  private left: number;
  constructor(
    private session: DisplaySession,
    private api: PairApi,
    private budget = 2,
  ) {
    this.left = budget;
  }
  async run(health: Health | undefined) {
    if (!canAutoPair(health) || this.left <= 0) return false;
    this.left--;
    try {
      return await autoPairSynthetic(this.session, this.api, health);
    } catch {
      return false;
    }
  }
  succeeded() {
    this.left = this.budget;
  }
  get remaining() {
    return this.left;
  }
}
