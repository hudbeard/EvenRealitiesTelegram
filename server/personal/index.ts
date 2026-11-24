import "dotenv/config";
import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { Store, Problem } from "../store.js";
import { PersonalService } from "./service.js";
import { DemoPersonal } from "./demo.js";
import { AccountTelegram } from "./mtproto.js";
import { transcribe } from "./speech.js";
const demo = process.argv.includes("--demo"),
  port = Number(process.env.PERSONAL_PORT ?? 3003),
  origin = process.env.PERSONAL_ORIGIN ?? `http://127.0.0.1:${port}`;
await mkdir(".data", { recursive: true });
const store = new Store(`.data/personal-${demo ? "demo" : "account"}.sqlite`);
const provider = demo ? new DemoPersonal() : await AccountTelegram.connect();
const service = new PersonalService(store, provider);
if (demo && !service.watched().length)
  await service.select(["demo:maya", "demo:crew", "demo:design"]);
const keyPath = ".data/personal-approval.key";
try {
  await writeFile(keyPath, randomBytes(32).toString("hex"), {
    flag: "wx",
    mode: 0o600,
  });
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
}
const approval = await readFile(keyPath, "utf8");
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.headers.origin && origin !== "*" && req.headers.origin !== origin)
    return res
      .status(403)
      .json({ error: "Use this local Fieldline companion." });
  if (req.headers.origin) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      origin === "*" ? "*" : req.headers.origin,
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
let pairAttempts = 0,
  windowEnd = Date.now() + 60000;
app.post("/api/pair", (req, res) => {
  if (Date.now() > windowEnd) {
    windowEnd = Date.now() + 60000;
    pairAttempts = 0;
  }
  if (++pairAttempts > 20)
    throw new Problem(429, "Wait one minute before pairing again.");
  res.json(store.pair());
});
app.get("/api/pair/:id", (req, res) => res.json(store.pairing(req.params.id)));
app.post("/api/pair/approve", (req, res) => {
  const supplied = Buffer.from(req.get("x-fieldline-approval") ?? "");
  const expected = Buffer.from(approval);
  if (
    !demo &&
    (supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected))
  )
    throw new Problem(403, "Approve pairing from your local terminal.");
  res.json({ approved: store.approve(String(req.body.code ?? "")) });
});
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    mode: demo ? "personal-demo" : "personal",
    synthetic: demo,
    voiceEnabled: !!process.env.STT_API_URL,
  }),
);
app.use("/api", (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
  if (!store.authorize(token))
    return res.status(401).json({ error: "Pair the display first." });
  res.locals.token = token;
  next();
});
app.get("/api/dialogs", async (_req, res) =>
  res.json({ chats: await provider.dialogs(), watched: service.watched() }),
);
app.post(
  "/api/transcribe",
  express.raw({ type: "application/octet-stream", limit: "960kb" }),
  async (req, res) => {
    if (!process.env.STT_API_URL)
      throw new Problem(503, "Configure your speech-to-text service first.");
    if (!Buffer.isBuffer(req.body))
      throw new Problem(400, "Send raw 16 kHz mono PCM.");
    res.json({
      text: await transcribe(
        req.body,
        process.env.STT_API_URL,
        process.env.STT_API_KEY,
      ),
    });
  },
);
app.post("/api/watch", async (req, res) =>
  res.json({ watched: await service.select(req.body.ids) }),
);
app.get("/api/brief", async (_req, res) => res.json(await service.brief()));
app.get("/api/chats/:id/messages", async (req, res) =>
  res.json(
    await service.history(req.params.id, String(req.query.search ?? "")),
  ),
);
app.post("/api/chats/:id/read", async (req, res) => {
  const history = await service.history(req.params.id);
  const id = req.body.messageId;
  if (!history.messages.some((m) => m.id === id))
    throw new Problem(400, "Only displayed messages may be acknowledged.");
  await provider.read(req.params.id, id);
  res.json({ ok: true });
});
app.post("/api/chats/:id/sponsored/:ad/view", async (req, res) => {
  await service.chat(req.params.id);
  await provider.sponsoredView(req.params.id, req.params.ad);
  res.json({ ok: true });
});
app.post("/api/chats/:id/sponsored/:ad/click", async (req, res) => {
  await service.chat(req.params.id);
  await provider.sponsoredClick(req.params.id, req.params.ad);
  res.json({ ok: true });
});
app.post("/api/action", async (req, res) => {
  if (req.body.confirmed !== true)
    throw new Problem(400, "Review and confirm this action first.");
  res.json(
    await service.act(
      String(req.body.operationId ?? ""),
      req.body.action,
      String(req.body.revision ?? ""),
    ),
  );
});
app.post("/api/checkpoint", (_req, res) => {
  service.checkpoint();
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  store.revoke(res.locals.token);
  res.json({ ok: true });
});
app.use(express.static(resolve("dist")));
app.use(
  (
    e: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) =>
    res.status(e instanceof Problem ? e.status : 503).json({
      error:
        e instanceof Problem
          ? e.message
          : "Telegram is unavailable. No automatic write retry was made.",
    }),
);
const server = app.listen(port, "127.0.0.1", () =>
  console.log(
    `Fieldline Catch-up ${demo ? "SYNTHETIC DEMO" : "personal account"}: http://127.0.0.1:${port}/personal.html`,
  ),
);
const close = () =>
  server.close(() => {
    void provider.close().finally(() => {
      store.close();
      process.exit(0);
    });
  });
process.on("SIGINT", close);
process.on("SIGTERM", close);
