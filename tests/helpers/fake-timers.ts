import type { Timers } from "../../server/personal/login.js";

/**
 * Deterministic clock + timers. `advance()` fires due callbacks in order.
 * It only drains the microtask queue between callbacks; it does not wait on
 * I/O, zlib, or real wall-clock timers. Await the work those callbacks start
 * (for login tests, `attempt.idle()`).
 */
export class FakeTimers implements Timers {
  private t: number;
  private seq = 0;
  private queue = new Map<number, { at: number; fn: () => void }>();
  constructor(start = 1_800_000_000_000) {
    this.t = start;
  }
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.queue.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  };
  clearTimeout = (handle: unknown) => {
    this.queue.delete(handle as number);
  };
  get pending() {
    return this.queue.size;
  }
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      await flush();
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.queue)
        if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.queue.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
    await flush();
  }
}

/**
 * Drain the microtask queue (process.nextTick and Promise jobs) until quiet.
 *
 * Bounded by iteration count, never by wall-clock time, and never by a fixed
 * number of setImmediate turns — those can finish before I/O such as zlib
 * (used by QRCode.toDataURL) posts its callback. Do not use this to wait for
 * I/O; await the promise that I/O completes.
 */
export async function flush(bound = 1000) {
  for (let i = 0; i < bound; i++) {
    const probes = { nextTick: 0, micro: 0 };
    process.nextTick(() => probes.nextTick++);
    queueMicrotask(() => probes.micro++);
    await new Promise<void>((r) => process.nextTick(r));
    await Promise.resolve();
    // Only our two probes ran, and they each ran once: the queue is quiet.
    if (probes.nextTick === 1 && probes.micro === 1) return;
  }
  throw new Error("flush: microtask queue did not settle");
}
