import type { Request, RequestHandler, Response } from "express";

export type RateLimitRequest = {
  ip?: string;
  socket?: { remoteAddress?: string | null };
};

export type RateLimitResult = { ok: boolean; retryAfter: number };

export type RateLimiter = RequestHandler & {
  reset(): void;
  consume(req: RateLimitRequest): RateLimitResult;
  reject(res: Response, retryAfter: number): void;
};

/** Fixed-window, in-memory, per-client-IP limiter. Single-process only. */
export function rateLimit(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
  message?: string;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();
  const message = options.message ?? "Too many requests. Wait a minute.";
  const consume = (req: RateLimitRequest): RateLimitResult => {
    const t = now();
    const key = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    let entry = hits.get(key);
    if (!entry || t >= entry.resetAt) {
      entry = { count: 0, resetAt: t + options.windowMs };
      hits.set(key, entry);
    }
    if (hits.size > 1000)
      for (const [k, v] of hits) if (t >= v.resetAt) hits.delete(k);
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
    if (entry.count >= options.limit) return { ok: false, retryAfter };
    entry.count++;
    return { ok: true, retryAfter };
  };
  const reject = (res: Response, retryAfter: number) => {
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({ error: message });
  };
  const handler = ((req: Request, res: Response, next) => {
    const result = consume(req);
    if (!result.ok) return reject(res, result.retryAfter);
    next();
  }) as RateLimiter;
  handler.reset = () => hits.clear();
  handler.consume = consume;
  handler.reject = reject;
  return handler;
}
