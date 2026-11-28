/**
 * Telegram account sign-in as an explicit state machine.
 *
 * One LoginAttempt owns one MTProto client from start to finish. Every
 * transition goes through `transition()`, every timer is tracked, and every
 * terminal path runs `close()`, which clears timers and disconnects the client.
 * There are no retry loops: Telegram is called once per user action or per QR
 * refresh timer, so a dead connection can never spin.
 *
 * States: idle -> connecting -> (qr | awaiting_code) -> [awaiting_password]
 *         -> saving -> done.  Any non-terminal state -> error | cancelled.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import QRCode from "qrcode";
import { Api, TelegramClient, password as srp } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { Raw } from "teleproto/events";

export type LoginState =
  | "idle"
  | "connecting"
  | "qr"
  | "awaiting_password"
  | "awaiting_code"
  | "saving"
  | "done"
  | "error"
  | "cancelled";
export type LoginKind = "qr" | "phone";
export type LoginErrorCode =
  | "WRONG_PASSWORD"
  | "WRONG_CODE"
  | "CODE_EXPIRED"
  | "PHONE_INVALID"
  | "NOT_REGISTERED"
  | "FLOOD_WAIT"
  | "TIMEOUT"
  | "TOO_MANY_ATTEMPTS"
  | "NETWORK"
  | "SAVE_FAILED"
  | "UNEXPECTED";
export interface LoginError {
  code: LoginErrorCode;
  message: string;
  retryAfter?: number;
}
export interface LoginView {
  id: string;
  kind: LoginKind;
  state: LoginState;
  demo: boolean;
  qr?: string;
  qrVersion: number;
  expiresIn?: number;
  hint?: string;
  error?: LoginError;
  user?: { name: string };
  pickedUp?: boolean;
}

/** The slice of a Telegram client the login flow needs. Tests inject a fake. */
export interface LoginClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  invoke(request: Api.AnyRequest): Promise<unknown>;
  /** Session string after authorization. */
  saveSession(): string;
  /** Subscribe to UpdateLoginToken; returns an unsubscribe function. */
  onLoginTokenUpdate(listener: () => void): () => void;
  switchDC(dcId: number): Promise<void>;
  computePasswordCheck(
    request: Api.account.Password,
    password: string,
  ): Promise<Api.TypeInputCheckPasswordSRP>;
}
export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface LoginOptions {
  apiId: number;
  apiHash: string;
  demo: boolean;
  createClient: () => LoginClient;
  /** Persist an authorized session string. Never called in demo mode. */
  persist: (session: string) => Promise<void>;
  /** Hand the session to the running server. Never called in demo mode. */
  onAuthorized: (session: string) => Promise<void>;
  timers?: Timers;
  /** Whole attempt deadline (default 10 min). */
  attemptTimeoutMs?: number;
  /** Deadline for one code/password prompt (default 5 min). */
  promptTimeoutMs?: number;
  /** Wrong code/password attempts before giving up (default 5). */
  maxInputAttempts?: number;
}

const QR_MIN_REFRESH_MS = 5_000,
  QR_MAX_REFRESH_MS = 60_000,
  QR_REFRESH_EARLY_MS = 3_000;

function rpcMessage(err: unknown) {
  const e = err as { errorMessage?: string; message?: string };
  return String(e?.errorMessage ?? e?.message ?? err);
}
function floodSeconds(err: unknown): number | undefined {
  const e = err as { seconds?: number };
  if (typeof e?.seconds === "number") return e.seconds;
  const m = /FLOOD_WAIT_(\d+)/.exec(rpcMessage(err));
  return m ? Number(m[1]) : undefined;
}
function userName(user: Api.TypeUser | undefined) {
  if (!(user instanceof Api.User)) return "your account";
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    (user.username ? "@" + user.username : "your account")
  );
}
class Closed extends Error {}

export class LoginAttempt {
  readonly id = randomBytes(16).toString("hex");
  state: LoginState = "idle";
  private client?: LoginClient;
  private timers: Timers;
  private handles = new Set<unknown>();
  private refreshHandle?: unknown;
  private promptHandle?: unknown;
  private unsubscribe?: () => void;
  private qr?: string;
  private qrVersion = 0;
  private qrExpiresAt?: number;
  private hint?: string;
  private error?: LoginError;
  private user?: { name: string };
  private pickedUp?: boolean;
  private srpRequest?: Api.account.Password;
  private phone?: string;
  private phoneCodeHash?: string;
  private inputAttempts = 0;
  private busy = false;
  private exporting = false;
  private exportAgain = false;
  private settled!: () => void;
  /** Resolves once the attempt reaches done, error or cancelled. */
  readonly finished = new Promise<void>((resolve) => (this.settled = resolve));
  readonly createdAt: number;
  endedAt?: number;

  constructor(
    readonly kind: LoginKind,
    private options: LoginOptions,
  ) {
    this.timers = options.timers ?? realTimers;
    this.createdAt = this.timers.now();
  }

  get terminal() {
    return (
      this.state === "done" ||
      this.state === "error" ||
      this.state === "cancelled"
    );
  }
  /** True while a client connection exists (for leak checks). */
  get connected() {
    return this.client !== undefined;
  }

  view(): LoginView {
    return {
      id: this.id,
      kind: this.kind,
      state: this.state,
      demo: this.options.demo,
      qrVersion: this.qrVersion,
      ...(this.state === "qr" && this.qr
        ? {
            qr: this.qr,
            expiresIn: Math.max(
              0,
              Math.round(((this.qrExpiresAt ?? 0) - this.timers.now()) / 1000),
            ),
          }
        : {}),
      ...(this.state === "awaiting_password" && this.hint !== undefined
        ? { hint: this.hint }
        : {}),
      ...(this.error ? { error: this.error } : {}),
      ...(this.user ? { user: this.user } : {}),
      ...(this.pickedUp !== undefined ? { pickedUp: this.pickedUp } : {}),
    };
  }

  // ---- public actions -------------------------------------------------

  async start(phone?: string): Promise<void> {
    if (this.state !== "idle") return;
    if (this.kind === "phone") this.phone = phone;
    this.transition("connecting");
    this.schedule(
      () =>
        void this.fail({
          code: "TIMEOUT",
          message: "Sign-in timed out. Start again.",
        }),
      this.options.attemptTimeoutMs ?? 600_000,
    );
    const client = this.options.createClient();
    this.client = client;
    try {
      await client.connect();
      this.ensureOpen();
      if (this.kind === "qr") {
        this.unsubscribe = client.onLoginTokenUpdate(() => {
          if (this.state === "qr") void this.exportToken();
        });
        await this.exportToken();
      } else await this.sendCode();
    } catch (err) {
      await this.handleError(err);
    }
  }

  async submitCode(code: string): Promise<void> {
    this.beginInput("awaiting_code");
    try {
      const authorization = await this.invoke(
        new Api.auth.SignIn({
          phoneNumber: this.phone!,
          phoneCodeHash: this.phoneCodeHash!,
          phoneCode: code,
        }),
      );
      await this.authorized(authorization);
    } catch (err) {
      const msg = rpcMessage(err);
      if (!this.terminal && /PHONE_CODE_(INVALID|EMPTY)/.test(msg))
        this.wrongInput("WRONG_CODE", "That code is not right. Try again.");
      else await this.handleError(err);
    } finally {
      this.busy = false;
    }
  }

  async submitPassword(password: string): Promise<void> {
    this.beginInput("awaiting_password");
    try {
      const check = await this.client!.computePasswordCheck(
        this.srpRequest!,
        password,
      );
      this.ensureOpen();
      const authorization = await this.invoke(
        new Api.auth.CheckPassword({ password: check }),
      );
      await this.authorized(authorization);
    } catch (err) {
      const msg = rpcMessage(err);
      if (!this.terminal && /PASSWORD_HASH_INVALID|SRP_ID_INVALID/.test(msg)) {
        // SRP parameters are single-use: fetch fresh ones for the retry.
        try {
          await this.loadPasswordParams();
          this.wrongInput(
            "WRONG_PASSWORD",
            "That password is not right. Try again.",
          );
        } catch (inner) {
          await this.handleError(inner);
        }
      } else await this.handleError(err);
    } finally {
      this.busy = false;
    }
  }

  /** Demo only: pretend the phone scanned the QR. */
  simulateScan() {
    if (!this.options.demo) throw new LoginInputError(404, "Not available.");
    if (this.state !== "qr")
      throw new LoginInputError(409, "There is no QR waiting to be scanned.");
    (this.client as DemoClient).scan();
  }

  async cancel(): Promise<void> {
    // Saving means Telegram already authorized this device; finishing is safer
    // than abandoning a half-written session.
    if (this.terminal || this.state === "saving") return;
    this.error = undefined;
    this.transition("cancelled");
    await this.close();
  }

  // ---- flow -----------------------------------------------------------

  private async exportToken(): Promise<void> {
    if (this.exporting) {
      this.exportAgain = true;
      return;
    }
    this.exporting = true;
    try {
      do {
        this.exportAgain = false;
        this.clear(this.refreshHandle);
        const result = await this.invoke(
          new Api.auth.ExportLoginToken({
            apiId: this.options.apiId,
            apiHash: this.options.apiHash,
            exceptIds: [],
          }),
        );
        if (result instanceof Api.auth.LoginToken) {
          await this.showQr(result);
        } else if (result instanceof Api.auth.LoginTokenSuccess) {
          await this.authorized(result.authorization);
          return;
        } else if (result instanceof Api.auth.LoginTokenMigrateTo) {
          await this.client!.switchDC(result.dcId);
          this.ensureOpen();
          const imported = await this.invoke(
            new Api.auth.ImportLoginToken({ token: result.token }),
          );
          if (imported instanceof Api.auth.LoginTokenSuccess) {
            await this.authorized(imported.authorization);
            return;
          }
          throw new Error("Unexpected QR import result");
        } else throw new Error("Unexpected QR export result");
      } while (this.exportAgain && this.state === "qr");
    } catch (err) {
      await this.handleError(err);
    } finally {
      this.exporting = false;
    }
  }

  private async showQr(token: Api.auth.LoginToken) {
    const url = "tg://login?token=" + Buffer.from(token.token).toString("base64url");
    const image = await QRCode.toDataURL(url, { width: 280, margin: 2 });
    this.ensureOpen();
    this.qr = image;
    this.qrVersion++;
    this.qrExpiresAt = token.expires * 1000;
    if (this.state !== "qr") this.transition("qr");
    const delay = Math.min(
      QR_MAX_REFRESH_MS,
      Math.max(
        QR_MIN_REFRESH_MS,
        this.qrExpiresAt - this.timers.now() - QR_REFRESH_EARLY_MS,
      ),
    );
    this.refreshHandle = this.schedule(() => {
      if (this.state === "qr") void this.exportToken();
    }, delay);
  }

  private async sendCode() {
    const sent = await this.invoke(
      new Api.auth.SendCode({
        phoneNumber: this.phone!,
        apiId: this.options.apiId,
        apiHash: this.options.apiHash,
        settings: new Api.CodeSettings({}),
      }),
    );
    if (sent instanceof Api.auth.SentCodeSuccess)
      return this.authorized(sent.authorization);
    if (!(sent instanceof Api.auth.SentCode))
      throw new Error("Unexpected send-code result");
    this.phoneCodeHash = sent.phoneCodeHash;
    this.prompt("awaiting_code");
  }

  private async loadPasswordParams() {
    const params = await this.invoke(new Api.account.GetPassword());
    if (!(params instanceof Api.account.Password))
      throw new Error("Unexpected password parameters");
    this.srpRequest = params;
    this.hint = params.hint ?? "";
  }

  private async needPassword() {
    this.clear(this.refreshHandle);
    await this.loadPasswordParams();
    this.inputAttempts = 0;
    this.prompt("awaiting_password");
  }

  private async authorized(authorization: unknown) {
    this.ensureOpen();
    if (authorization instanceof Api.auth.AuthorizationSignUpRequired)
      return this.fail({
        code: "NOT_REGISTERED",
        message: "This phone number has no Telegram account. Sign up in Telegram first.",
      });
    if (!(authorization instanceof Api.auth.Authorization))
      throw new Error("Unexpected authorization result");
    this.clear(this.refreshHandle);
    this.clear(this.promptHandle);
    this.user = { name: userName(authorization.user) };
    this.transition("saving");
    const session = this.client!.saveSession();
    try {
      if (!this.options.demo) await this.options.persist(session);
    } catch {
      return this.fail(
        {
          code: "SAVE_FAILED",
          message: "Signed in, but the session could not be saved on the server.",
        },
        true,
      );
    }
    await this.close();
    if (!this.options.demo) {
      try {
        await this.options.onAuthorized(session);
        this.pickedUp = true;
      } catch {
        this.pickedUp = false;
      }
    } else this.pickedUp = true;
    this.transition("done");
  }

  // ---- helpers ----------------------------------------------------------

  private beginInput(expected: LoginState) {
    if (this.state !== expected)
      throw new LoginInputError(409, "This sign-in is not waiting for that.");
    if (this.busy)
      throw new LoginInputError(409, "Still checking the last entry.");
    this.busy = true;
    this.error = undefined;
  }

  private wrongInput(code: LoginErrorCode, message: string) {
    if (++this.inputAttempts >= (this.options.maxInputAttempts ?? 5)) {
      void this.fail({
        code: "TOO_MANY_ATTEMPTS",
        message: "Too many wrong attempts. Start again later.",
      });
      return;
    }
    this.error = { code, message };
    this.prompt(this.state); // re-prompt, fresh prompt deadline
  }

  private prompt(state: LoginState) {
    this.clear(this.promptHandle);
    if (this.state !== state) this.transition(state);
    this.promptHandle = this.schedule(
      () =>
        void this.fail({
          code: "TIMEOUT",
          message: "No answer in time. Start again.",
        }),
      this.options.promptTimeoutMs ?? 300_000,
    );
  }

  private async invoke(request: Api.AnyRequest) {
    this.ensureOpen();
    const result = await this.client!.invoke(request);
    this.ensureOpen();
    return result;
  }

  private async handleError(err: unknown) {
    if (err instanceof Closed || this.terminal) return;
    const msg = rpcMessage(err);
    if (msg.includes("SESSION_PASSWORD_NEEDED")) {
      try {
        await this.needPassword();
      } catch (inner) {
        await this.handleError(inner);
      }
      return;
    }
    const seconds = floodSeconds(err);
    if (seconds !== undefined || msg.includes("FLOOD"))
      return this.fail({
        code: "FLOOD_WAIT",
        message: `Telegram asked us to wait${seconds ? ` ${seconds} seconds` : ""} before trying again.`,
        ...(seconds ? { retryAfter: seconds } : {}),
      });
    if (/PHONE_CODE_EXPIRED/.test(msg))
      return this.fail({ code: "CODE_EXPIRED", message: "That code expired. Start again." });
    if (/PHONE_NUMBER_(INVALID|BANNED|FLOOD)/.test(msg))
      return this.fail({ code: "PHONE_INVALID", message: "Telegram did not accept that phone number." });
    if (/disconnect|ECONN|ETIMEDOUT|network|socket/i.test(msg))
      return this.fail({ code: "NETWORK", message: "Could not reach Telegram. Check the server's connection." });
    return this.fail({ code: "UNEXPECTED", message: "Sign-in failed. Start again." });
  }

  private async fail(error: LoginError, fromSaving = false) {
    if (this.terminal || (this.state === "saving" && !fromSaving)) return;
    this.error = error;
    this.transition("error");
    await this.close();
  }

  private transition(next: LoginState) {
    this.state = next;
    if (this.terminal) {
      this.endedAt = this.timers.now();
      this.settled();
    }
  }

  private ensureOpen() {
    if (this.terminal) throw new Closed();
  }

  /** setTimeout that is tracked until it fires or is cleared. */
  private schedule(fn: () => void, ms: number) {
    const handle: unknown = this.timers.setTimeout(() => {
      this.handles.delete(handle);
      fn();
    }, ms);
    this.handles.add(handle);
    return handle;
  }
  private clear(handle: unknown) {
    if (handle === undefined) return;
    this.timers.clearTimeout(handle);
    this.handles.delete(handle);
  }
  /** Timers still scheduled by this attempt (for leak checks). */
  get pendingTimers() {
    return this.handles.size;
  }

  private async close() {
    for (const handle of this.handles) this.timers.clearTimeout(handle);
    this.handles.clear();
    this.refreshHandle = this.promptHandle = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.srpRequest = undefined;
    const client = this.client;
    this.client = undefined;
    if (client) await client.disconnect().catch(() => {});
  }
}

export class LoginInputError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Owns login attempts: at most `maxActive` non-terminal attempts at once. */
export class LoginManager {
  private attempts = new Map<string, LoginAttempt>();
  private timers: Timers;
  constructor(
    private options: LoginOptions & {
      maxActive?: number;
      /** Keep finished attempts readable this long (default 2 min). */
      retainMs?: number;
    },
  ) {
    this.timers = options.timers ?? realTimers;
  }
  get available() {
    return (
      this.options.demo ||
      (Number.isInteger(this.options.apiId) &&
        this.options.apiId > 0 &&
        !!this.options.apiHash)
    );
  }
  active() {
    this.sweep();
    return [...this.attempts.values()].filter((a) => !a.terminal);
  }
  get(id: unknown) {
    this.sweep();
    return typeof id === "string" ? this.attempts.get(id) : undefined;
  }
  /**
   * Start an attempt. If the cap is reached, an active attempt of the same
   * kind is returned instead of creating a second one; otherwise 429.
   */
  start(kind: LoginKind, phone?: string): { attempt: LoginAttempt; existing: boolean } {
    if (!this.available)
      throw new LoginInputError(
        503,
        "Set TELEGRAM_API_ID and TELEGRAM_API_HASH on the server first.",
      );
    const active = this.active();
    if (active.length >= (this.options.maxActive ?? 1)) {
      const same = active.find((a) => a.kind === kind && kind === "qr");
      if (same) return { attempt: same, existing: true };
      throw new LoginInputError(
        429,
        "A sign-in is already in progress. Cancel it first.",
      );
    }
    const attempt = new LoginAttempt(kind, this.options);
    this.attempts.set(attempt.id, attempt);
    void attempt.start(phone);
    return { attempt, existing: false };
  }
  async cancelAll() {
    await Promise.all([...this.attempts.values()].map((a) => a.cancel()));
  }
  private sweep() {
    const cutoff = this.timers.now() - (this.options.retainMs ?? 120_000);
    for (const [id, a] of this.attempts)
      if (a.terminal && (a.endedAt ?? 0) < cutoff) this.attempts.delete(id);
  }
}

/** Write a file atomically: temp file in the same directory, fsync, rename. */
export async function writeFileAtomic(path: string, data: string) {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.${basename(path)}.tmp-${randomBytes(6).toString("hex")}`);
  const handle = await open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Real teleproto client behind the LoginClient interface. */
export function teleprotoLoginClient(apiId: number, apiHash: string): LoginClient {
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 2,
    requestRetries: 1,
    floodSleepThreshold: 0,
  });
  client.setLogLevel("none" as Parameters<TelegramClient["setLogLevel"]>[0]);
  const internal = client as unknown as { _switchDC(dc: number): Promise<void> };
  return {
    connect: () => client.connect().then(() => undefined),
    disconnect: () => client.disconnect(),
    invoke: (request) => client.invoke(request as Api.AnyRequest & { __response: unknown }) as Promise<unknown>,
    saveSession: () => String(client.session.save()),
    onLoginTokenUpdate(listener) {
      const event = new Raw({});
      const handler = (update: unknown) => {
        if (update instanceof Api.UpdateLoginToken) listener();
      };
      client.addEventHandler(handler, event);
      return () => client.removeEventHandler(handler, event);
    },
    switchDC: (dcId) => internal._switchDC(dcId),
    computePasswordCheck: (request, password) => srp.computeCheck(request, password),
  };
}

/**
 * Synthetic client for --demo: no network, no files. The QR "scans" itself
 * after `autoScanMs` (default 3 s) or when simulateScan() is called. Any code
 * other than 00000 is accepted; 2FA is not used.
 */
export class DemoClient implements LoginClient {
  private listener?: () => void;
  private scanned = false;
  private handle?: unknown;
  constructor(
    private timers: Timers = realTimers,
    private autoScanMs = 3000,
  ) {}
  async connect() {}
  async disconnect() {
    if (this.handle !== undefined) this.timers.clearTimeout(this.handle);
    this.handle = undefined;
    this.listener = undefined;
  }
  scan() {
    this.scanned = true;
    this.listener?.();
  }
  onLoginTokenUpdate(listener: () => void) {
    this.listener = listener;
    this.handle = this.timers.setTimeout(() => this.scan(), this.autoScanMs);
    return () => {
      this.listener = undefined;
    };
  }
  private authorization() {
    return new Api.auth.Authorization({
      user: new Api.User({
        id: 1 as never,
        firstName: "Demo",
        lastName: "User",
        username: "demo_user",
      } as ConstructorParameters<typeof Api.User>[0]),
    } as ConstructorParameters<typeof Api.auth.Authorization>[0]);
  }
  async invoke(request: Api.AnyRequest): Promise<unknown> {
    if (request instanceof Api.auth.ExportLoginToken)
      return this.scanned
        ? new Api.auth.LoginTokenSuccess({ authorization: this.authorization() })
        : new Api.auth.LoginToken({
            expires: Math.floor(this.timers.now() / 1000) + 30,
            token: Buffer.from("fieldline-demo-" + randomBytes(8).toString("hex")),
          });
    if (request instanceof Api.auth.SendCode)
      return new Api.auth.SentCode({
        type: new Api.auth.SentCodeTypeApp({ length: 5 }),
        phoneCodeHash: "demo",
      });
    if (request instanceof Api.auth.SignIn) {
      if (request.phoneCode === "00000")
        throw Object.assign(new Error("PHONE_CODE_INVALID"), {
          errorMessage: "PHONE_CODE_INVALID",
        });
      return this.authorization();
    }
    throw new Error("Demo client does not support " + request.className);
  }
  saveSession() {
    return "";
  }
  async switchDC() {}
  async computePasswordCheck(): Promise<Api.TypeInputCheckPasswordSRP> {
    return new Api.InputCheckPasswordEmpty();
  }
}
