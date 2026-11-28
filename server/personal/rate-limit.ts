import type { RequestHandler } from "express";

/** Fixed-window, in-memory, per-client-IP limiter. Single-process only. */
export function rateLimit(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
  message?: string;
}): RequestHandler & { reset(): void } {
  const now = options.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();
  const handler = ((req, res, next) => {
    const t = now();
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    let entry = hits.get(key);
    if (!entry || t >= entry.resetAt) {
      entry = { count: 0, resetAt: t + options.windowMs };
      hits.set(key, entry);
    }
    if (hits.size > 1000)
      for (const [k, v] of hits) if (t >= v.resetAt) hits.delete(k);
    if (++entry.count > options.limit) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - t) / 1000));
      return res
        .status(429)
        .json({ error: options.message ?? "Too many requests. Wait a minute." });
    }
    next();
  }) as RequestHandler & { reset(): void };
  handler.reset = () => hits.clear();
  return handler;
}
