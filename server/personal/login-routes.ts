import express, { type Request, type Response } from "express";
import { LoginInputError, type LoginManager } from "./login.js";
import { rateLimit } from "./rate-limit.js";

/**
 * HTTP surface for LoginManager, mounted under /api.
 * All responses are a LoginView or { error }.
 */
export function loginRoutes(
  manager: LoginManager,
  options: {
    now?: () => number;
    /** Requests per minute per IP across all login routes (default 120). */
    limit?: number;
    /** Start requests per minute per IP (default 6). */
    startLimit?: number;
  } = {},
) {
  const router = express.Router();
  const all = rateLimit({
    limit: options.limit ?? 120,
    windowMs: 60_000,
    now: options.now,
  });
  const starts = rateLimit({
    limit: options.startLimit ?? 6,
    windowMs: 60_000,
    now: options.now,
    message: "Too many sign-in attempts. Wait a minute.",
  });
  router.use("/login", all);
  const send = (res: Response, err: unknown) => {
    if (err instanceof LoginInputError)
      return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: "Sign-in failed. Start again." });
  };
  const attempt = (req: Request) => {
    const a = manager.get(req.params.id);
    if (!a) throw new LoginInputError(404, "This sign-in expired. Start again.");
    return a;
  };
  router.post("/login/qr/start", starts, (_req, res) => {
    try {
      const { attempt, existing } = manager.start("qr");
      res.status(existing ? 200 : 201).json(attempt.view());
    } catch (err) {
      send(res, err);
    }
  });
  router.post("/login/phone/start", starts, (req, res) => {
    try {
      const phone = String(req.body?.phone ?? "").replace(/[\s()-]/g, "");
      if (!/^\+?[0-9]{6,16}$/.test(phone))
        throw new LoginInputError(400, "Enter your number with country code, like +15551234567.");
      const { attempt } = manager.start("phone", phone);
      res.status(201).json(attempt.view());
    } catch (err) {
      send(res, err);
    }
  });
  router.get("/login/:id", (req, res) => {
    try {
      res.json(attempt(req).view());
    } catch (err) {
      send(res, err);
    }
  });
  router.post("/login/:id/code", async (req, res) => {
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
  router.post("/login/:id/password", async (req, res) => {
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
