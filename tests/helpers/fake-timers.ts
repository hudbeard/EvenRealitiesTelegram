import type { Timers } from "../../server/personal/login.js";

/** Deterministic clock + timers. `advance()` fires due timers in order. */
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
/** Let pending promise chains (and QR rendering) settle. */
export async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}
/** Flush until `cond()` holds (real microtasks/IO only, no fake time). */
export async function until(cond: () => boolean, rounds = 500) {
  for (let i = 0; i < rounds && !cond(); i++) await new Promise((r) => setImmediate(r));
  if (!cond()) throw new Error("condition not reached");
}
