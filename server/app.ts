import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomUUID } from "node:crypto";
import { Store, Problem, type Task } from "./store.js";
import {
  confirm,
  ingest,
  Telegram,
  type Transport,
  type Update,
} from "./telegram.js";
export type Config = {
  mode: "demo" | "telegram";
  label: string;
  origin: string;
  botToken?: string;
  operatorId?: string;
  chatId?: string;
};
export function createApp(
  store: Store,
  config: Config,
  transport: Transport,
  provider = () => ({ connected: true, checkedAt: Date.now() }),
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8kb" }));
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Same-origin only; Vite's local dev proxy preserves the 5173/5174 origin.
    const origin = req.headers.origin;
    const allowed =
      !origin ||
      config.origin === "*" ||
      origin === config.origin ||
      (config.mode === "demo" &&
        /^http:\/\/127\.0\.0\.1:517[34]$/.test(origin));
    if (!allowed)
      return res
        .status(403)
        .json({ error: "Use the configured Fieldline origin." });
    if (origin) {
      res.setHeader(
        "Access-Control-Allow-Origin",
        config.origin === "*" ? "*" : origin,
      );
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  const limits = new Map<string, { n: number; until: number }>();
  const rate = (req: Request, res: Response, next: NextFunction) => {
    const key = req.socket.remoteAddress ?? "local";
    const old = limits.get(key);
    const row =
      old && old.until > Date.now() ? old : { n: 0, until: Date.now() + 60000 };
    row.n++;
    limits.set(key, row);
    if (row.n > 20)
      return res
        .status(429)
        .json({ error: "Too many attempts. Wait one minute." });
    next();
  };
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, mode: config.mode, label: config.label }),
  );
  app.post("/api/pair", rate, (_req, res) => res.json(store.pair()));
  app.get("/api/pair/:id", (req, res) =>
    res.json(store.pairing(req.params.id)),
  );
  // Demo pairing is deliberately unavailable in Telegram mode.
  if (config.mode === "demo")
    app.post("/api/demo/pair", rate, (req, res) =>
      res.json({ approved: store.approve(String(req.body.code ?? "")) }),
    );
  app.use("/api", (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (!store.authorize(token))
      return res.status(401).json({ error: "Pair your glasses to continue." });
    res.locals.token = token;
    next();
  });
  app.get("/api/tasks", (_req, res) =>
    res.json({
      tasks: store.list(),
      history: store.history(),
      provider: provider(),
    }),
  );
  app.post("/api/tasks/:id/confirm", async (req, res) =>
    res.json(
      await confirm(
        store,
        transport,
        req.params.id,
        String(req.body.operationId ?? ""),
        req.body.choice,
        config.label,
      ),
    ),
  );
  app.post("/api/tasks/:id/dismiss", (req, res) =>
    res.json(store.dismiss(req.params.id)),
  );
  app.post("/api/logout", (_req, res) => {
    store.revoke(res.locals.token);
    res.json({ ok: true });
  });
  if (config.mode === "demo") {
    app.post("/api/demo/request", (_req, res) => {
      const now = Date.now(),
        id = `demo:${randomUUID()}`;
      store.add({
        id,
        chatId: "demo",
        chatName: "North entrance crew",
        messageId: 1,
        threadId: null,
        sender: "Maya",
        text: "Can you cover the north entrance for five minutes?",
        createdAt: now,
        expiresAt: now + 30 * 60000,
      });
      res.json({ id });
    });
  }
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof Problem)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: "Invalid request." });
      console.error("Fieldline request failed (details withheld)");
      res
        .status(500)
        .json({
          error: "Server error. Refresh status before taking another action.",
        });
    },
  );
  return app;
}
export async function pollTelegram(
  store: Store,
  tg: Telegram,
  config: Config,
  signal: AbortSignal,
  report: (ok: boolean) => void = () => {},
) {
  while (!signal.aborted) {
    try {
      const updates = await tg.updates(store.offset());
      report(true);
      for (const u of updates) {
        const m = u.message;
        if (
          m &&
          m.chat.type === "private" &&
          String(m.from?.id) === config.operatorId
        ) {
          const code = m.text?.match(
            /^\/pair(?:@[a-zA-Z0-9_]+)?\s+(\d{6})$/,
          )?.[1];
          // Approve only commands from the configured wearer. No unsolicited bot messages.
          if (code) store.approve(code);
        }
        ingest(store, u, config.chatId!);
        store.offsetTo(u.update_id + 1);
      }
    } catch {
      report(false);
      console.error(
        "Telegram polling unavailable; retrying read-only updates.",
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
