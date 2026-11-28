/** Default interval for the idle-display server health poll. */
export const IDLE_HEALTH_MS = 5_000;

export type HealthPollTimers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

/**
 * While the display is idle, poke /health at a low frequency so a dead
 * personal server surfaces without waiting for the next Tap. The timer
 * keeps running when the user is busy, but the check itself is skipped
 * until they return to an idle screen.
 */
export class IdleHealthPoll {
  private handle: unknown;
  private running = false;
  private readonly intervalMs: number;
  private readonly timers: HealthPollTimers;

  constructor(
    private readonly opts: {
      intervalMs?: number;
      timers?: HealthPollTimers;
      isIdle: () => boolean;
      check: () => Promise<void>;
      onDown: () => void;
    },
  ) {
    this.intervalMs = opts.intervalMs ?? IDLE_HEALTH_MS;
    this.timers = opts.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    };
  }

  start() {
    this.stop();
    this.running = true;
    this.arm();
  }

  stop() {
    this.running = false;
    if (this.handle !== undefined) {
      this.timers.clearTimeout(this.handle);
      this.handle = undefined;
    }
  }

  private arm() {
    if (!this.running) return;
    this.handle = this.timers.setTimeout(() => {
      void this.tick();
    }, this.intervalMs);
  }

  private async tick() {
    this.handle = undefined;
    if (!this.running) return;
    if (this.opts.isIdle()) {
      try {
        await this.opts.check();
      } catch {
        if (this.running && this.opts.isIdle()) this.opts.onDown();
      }
    }
    this.arm();
  }
}
