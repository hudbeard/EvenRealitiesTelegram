import express, { type Request, type Response } from "express";
import { LoginInputError, type LoginManager } from "./login.js";
import { rateLimit } from "./rate-limit.js";

/**
 * HTTP surface for LoginManager, mounted under /api.
 * All responses are a LoginView or { error }.
 *
 * Rate limits (per IP, 60 s window):
 *   - Explicit new starts only: QR POST { explicit: true } ("Try again",
 *     switching back to the QR tab) and phone send-code. 6/min.
 *   - Auto QR starts (the /login page load, body without explicit) never
 *     consume that budget. They still reuse an in-flight QR attempt, or
 *     create a new one after the last attempt finishes, and they still
 *     obey the session cap (one active attempt).
 *   - Code and password submits: 20/min, same sign-in-attempts message.
 *   - Status GETs: 600/min safety cap (page HTML at /login is unmetered).
 */
export function loginRoutes(
  manager: LoginManager,
  options: {
    now?: () => number;
    /** Status GET /login/:id requests per minute per IP (default 600). */
    pollLimit?: number;
    /** Explicit new starts (Try again / phone send-code) per minute per IP (default 6). */
    startLimit?: number;
    /** Code and password submits per minute per IP (default 20). */
    submitLimit?: number;
    /** @deprecated Use pollLimit. Accepted as an alias so older tests keep working. */
    limit?: number;
  } = {},
) {
  const router = express.Router();
  const polls = rateLimit({
    limit: options.pollLimit ?? options.limit ?? 600,
    windowMs: 60_000,
    now: options.now,
  });
  const starts = rateLimit({
    limit: options.startLimit ?? 6,
    windowMs: 60_000,
    now: options.now,
    message: "Too many sign-in attempts. Wait a minute.",
  });
  const submits = rateLimit({
    limit: options.submitLimit ?? 20,
    windowMs: 60_000,
    now: options.now,
    message: "Too many sign-in attempts. Wait a minute.",
  });
  const send = (res: Response, err: unknown) => {
    if (err instanceof LoginInputError)
      return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: "Sign-in failed. Start again." });
  };
  const deny = (
    limiter: ReturnType<typeof rateLimit>,
    req: Request,
    res: Response,
  ) => {
    const result = limiter.consume(req);
    if (result.ok) return false;
    limiter.reject(res, result.retryAfter);
    return true;
  };
  const attempt = (req: Request) => {
    const a = manager.get(req.params.id);
    if (!a) throw new LoginInputError(404, "This sign-in expired. Start again.");
    return a;
  };
  router.post("/login/qr/start", (req, res) => {
    try {
      // Only an explicit user retry counts. A page-load auto-start must
      // never consume the start budget, even after the last attempt finished.
      const explicit = req.body?.explicit === true;
      if (
        explicit &&
        manager.wouldStart("qr") === "create" &&
        deny(starts, req, res)
      )
        return;
      const { attempt, existing } = manager.start("qr");
      res.status(existing ? 200 : 201).json(attempt.view());
    } catch (err) {
      send(res, err);
    }
  });
  router.post("/login/phone/start", (req, res) => {
    try {
      const phone = String(req.body?.phone ?? "").replace(/[\s()-]/g, "");
      if (!/^\+?[0-9]{6,16}$/.test(phone))
        throw new LoginInputError(400, "Enter your number with country code, like +15551234567.");
      if (manager.wouldStart("phone") === "create" && deny(starts, req, res)) return;
      const { attempt } = manager.start("phone", phone);
      res.status(201).json(attempt.view());
    } catch (err) {
      send(res, err);
    }
  });
  router.get("/login/:id", polls, (req, res) => {
    try {
      res.json(attempt(req).view());
    } catch (err) {
      send(res, err);
    }
  });
  router.post("/login/:id/code", submits, async (req, res) => {
    try {
      const a = attempt(req);
      const code = String(req.body?.code ?? "").replace(/\s/g, "");
      if (!/^[0-9A-Za-z]{3,10}$/.test(code))
        throw new LoginInputError(400, "Enter the code Telegram sent you.");
      await a.submitCode(code);
      res.json(a.view());
    } catch (err) {
      send(res, err);
    }
  });
  router.post("/login/:id/password", submits, async (req, res) => {
    try {
      const a = attempt(req);
      const password = req.body?.password;
      if (typeof password !== "string" || !password || password.length > 256)
        throw new LoginInputError(400, "Enter your two-step verification password.");
      await a.submitPassword(password);
      res.json(a.view());
    } catch (err) {
      send(res, err);
    }
  });
  router.post("/login/:id/cancel", async (req, res) => {
    try {
      const a = attempt(req);
      await a.cancel();
      res.json(a.view());
    } catch (err) {
      send(res, err);
    }
  });
  router.post("/login/:id/simulate-scan", (req, res) => {
    try {
      const a = attempt(req);
      a.simulateScan();
      res.json(a.view());
    } catch (err) {
      send(res, err);
    }
  });
  return router;
}
