import { Api } from "teleproto";
import type { LoginClient } from "../../server/personal/login.js";

const rpc = (errorMessage: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(errorMessage), { errorMessage, ...extra });

export function authorization(firstName = "Ada", lastName = "Lovelace") {
  return new Api.auth.Authorization({
    user: new Api.User({ id: 7 as never, firstName, lastName } as ConstructorParameters<typeof Api.User>[0]),
  } as ConstructorParameters<typeof Api.auth.Authorization>[0]);
}

type Deferred = { resolve(v: unknown): void; reject(e: unknown): void };

/**
 * Scriptable stand-in for Telegram. Behaves like teleproto in the ways that
 * matter: requests fail once disconnected, and disconnect rejects in-flight
 * requests.
 */
export class FakeTelegram implements LoginClient {
  connected = false;
  connects = 0;
  disconnects = 0;
  calls: string[] = [];
  scanned = false;
  twoFactor = false;
  password = "correct horse";
  code = "12345";
  srpRequests = 0;
  /** Exact Telegram error to throw from SendCode (e.g. FLOOD_WAIT). */
  sendCodeError?: Error;
  private listeners = new Set<() => void>();
  private inflight = new Set<Deferred>();
  private holds = new Set<string>();
  private connectGate?: Promise<void>;
  private openGate?: () => void;
  tokenSeq = 0;
  constructor(private now: () => number) {}

  /** Make connect() wait until releaseConnect(). */
  holdConnect() {
    this.connectGate = new Promise((r) => (this.openGate = r));
  }
  releaseConnect() {
    this.openGate?.();
  }
  /** Make the next request of this class hang until disconnect. */
  hold(className: string) {
    this.holds.add(className);
  }
  get listenerCount() {
    return this.listeners.size;
  }
  scan() {
    this.scanned = true;
    for (const l of this.listeners) l();
  }

  async connect() {
    this.connects++;
    if (this.connectGate) await this.connectGate;
    this.connected = true;
  }
  async disconnect() {
    this.disconnects++;
    this.connected = false;
    for (const d of this.inflight) d.reject(new Error("Disconnected"));
    this.inflight.clear();
  }
  onLoginTokenUpdate(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  saveSession() {
    return "SESSION-" + this.connects;
  }
  async switchDC() {}
  async computePasswordCheck(_req: Api.account.Password, password: string) {
    return { fakePassword: password } as unknown as Api.TypeInputCheckPasswordSRP;
  }
  async invoke(request: Api.AnyRequest): Promise<unknown> {
    if (!this.connected)
      throw new Error("Cannot send requests while disconnected. Please connect first.");
    const name = request.className;
    this.calls.push(name);
    if (this.holds.delete(name))
      return new Promise((resolve, reject) => this.inflight.add({ resolve, reject }));
    if (request instanceof Api.auth.ExportLoginToken) {
      if (!this.scanned)
        return new Api.auth.LoginToken({
          expires: Math.floor(this.now() / 1000) + 30,
          token: Buffer.from("token-" + ++this.tokenSeq),
        });
      if (this.twoFactor) throw rpc("SESSION_PASSWORD_NEEDED");
      return new Api.auth.LoginTokenSuccess({ authorization: authorization() });
    }
    if (request instanceof Api.account.GetPassword) {
      this.srpRequests++;
      return Object.assign(Object.create(Api.account.Password.prototype), {
        hint: "pet name",
        srpId: this.srpRequests,
      });
    }
    if (request instanceof Api.auth.CheckPassword) {
      const given = (request.password as unknown as { fakePassword: string }).fakePassword;
      if (given !== this.password) throw rpc("PASSWORD_HASH_INVALID");
      return authorization();
    }
    if (request instanceof Api.auth.SendCode) {
      if (this.sendCodeError) throw this.sendCodeError;
      return new Api.auth.SentCode({
        type: new Api.auth.SentCodeTypeApp({ length: 5 }),
        phoneCodeHash: "hash",
      } as ConstructorParameters<typeof Api.auth.SentCode>[0]);
    }
    if (request instanceof Api.auth.SignIn) {
      if (request.phoneCode !== this.code) throw rpc("PHONE_CODE_INVALID");
      if (this.twoFactor) throw rpc("SESSION_PASSWORD_NEEDED");
      return authorization();
    }
    throw new Error("Unexpected request " + name);
  }
}
export { rpc };
