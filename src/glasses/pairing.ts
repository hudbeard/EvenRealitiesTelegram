export interface PairingTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const browserTimers: PairingTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
export function formatRemaining(seconds: number) {
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}
/**
 * Pairing-code countdown with its own timer, independent of the approval
 * poll, so neither can cancel the other.
 */
export class PairingCountdown {
  private handle: unknown;
  private stopped = false;
  constructor(
    private expiresAt: number,
    private onTick: (secondsLeft: number) => void,
    private onExpire: () => void,
    private timers: PairingTimers = browserTimers,
  ) {}
  start() {
    this.stopped = false;
    this.tick();
    return this;
  }
  stop() {
    this.stopped = true;
    if (this.handle !== undefined) this.timers.clearTimeout(this.handle);
    this.handle = undefined;
  }
  get running() {
    return !this.stopped && this.handle !== undefined;
  }
  private tick() {
    if (this.stopped) return;
    const msLeft = this.expiresAt - this.timers.now();
    const left = Math.max(0, Math.ceil(msLeft / 1000));
    if (left <= 0) {
      this.handle = undefined;
      this.stopped = true;
      this.onExpire();
      return;
    }
    this.onTick(left);
    // Align the next tick to the next whole second.
    const delay = msLeft - (left - 1) * 1000;
    this.handle = this.timers.setTimeout(() => this.tick(), Math.max(50, delay));
  }
}
