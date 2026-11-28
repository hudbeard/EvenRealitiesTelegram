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
import { suggestReplies } from "./reply-suggestions.js";
import {
  DemoClient,
  LoginManager,
  teleprotoLoginClient,
  writeFileAtomic,
} from "./login.js";
import { loginRoutes } from "./login-routes.js";
import { SignedOutProvider, SwitchableProvider } from "./switchable.js";
const demo = process.argv.includes("--demo"),
  port = Number(process.env.PERSONAL_PORT ?? 3003),
  origin = process.env.PERSONAL_ORIGIN ?? `http://127.0.0.1:${port}`;
await mkdir(".data", { recursive: true });
const store = new Store(`.data/personal-${demo ? "demo" : "account"}.sqlite`);
async function initialProvider() {
  if (demo) return new DemoPersonal();
  const session = await AccountTelegram.readSession();
  if (!session) {
    console.log("No Telegram session yet. Sign in at /login.");
    return new SignedOutProvider();
  }
  try {
    return await AccountTelegram.fromSession(session);
  } catch (e) {
    console.log(`Telegram session not usable (${(e as Error).message}). Sign in at /login.`);
    return new SignedOutProvider();
  }
}
const provider = new SwitchableProvider(await initialProvider());
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
// Telegram sign-in page (QR, phone code, 2FA).
app.get("/login", (_req, res) => {
  res.sendFile(resolve("public/login.html"));
});
const credentials = AccountTelegram.credentials();
const sessionFile = AccountTelegram.sessionFile();
const logins = new LoginManager({
  apiId: credentials.apiId,
  apiHash: credentials.apiHash,
  demo,
  createClient: () =>
    demo
      ? new DemoClient()
      : teleprotoLoginClient(credentials.apiId, credentials.apiHash),
  // Demo never writes a session file (LoginAttempt skips persist in demo).
  persist: demo
    ? async () => {
        throw new Error("Demo mode never writes a session file.");
      }
    : (session) => writeFileAtomic(sessionFile, session),
  // Hot pick-up: the running server switches to the new account at once.
  onAuthorized: async (session) =>
    provider.swap(await AccountTelegram.fromSession(session)),
});
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
// Login endpoints: origin-checked and rate-limited, no display token needed.
app.use("/api", loginRoutes(logins));
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
    replyIdeasEnabled: !!(
      process.env.REPLY_AI_URL && process.env.REPLY_AI_MODEL
    ),
    qrLoginAvailable: logins.available,
    telegramSignedIn: demo || provider.signedIn,
  }),
);

// Protected API endpoints (require display token)
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
app.get("/api/glasses/dialogs", async (_req, res) =>
  res.json({ chats: await provider.dialogs(), watched: service.watched() }),
);
app.get("/api/glasses/saved", async (_req, res) =>
  res.json(await provider.saved()),
);
app.get("/api/glasses/chats/:id/messages", async (req, res) =>
  res.json(
    await service.accountHistory(
      req.params.id,
      String(req.query.search ?? ""),
      req.query.before ? Number(req.query.before) : undefined,
    ),
  ),
);
app.post("/api/glasses/chats/:id/reply-ideas", async (req, res) => {
  const url = process.env.REPLY_AI_URL,
    model = process.env.REPLY_AI_MODEL;
  if (!url || !model) return res.json({ replies: [] });
  const { messageId, revision } = req.body ?? {};
  if (
    !Number.isSafeInteger(messageId) ||
    messageId < 1 ||
    typeof revision !== "string"
  )
    throw new Problem(400, "Open a message to get reply ideas.");
  const history = await service.accountHistory(
    req.params.id,
    "",
    messageId + 1,
  );
  const source = history.messages.find((message) => message.id === messageId);
  if (!source || source.revision !== revision)
    throw new Problem(409, "The message changed. Reopen it for reply ideas.");
  if (history.chat.kind === "channel" || source.outgoing || !source.text.trim())
    return res.json({ replies: [] });
  try {
    res.json({
      replies: await suggestReplies(source.text, {
        url,
        model,
        key: process.env.REPLY_AI_KEY,
      }),
    });
  } catch {
    res.json({ replies: [] });
  }
});
app.post("/api/glasses/chats/:id/read", async (req, res) => {
  const id = req.body.messageId;
  const h = await service.accountHistory(req.params.id, "", Number(id) + 1);
  if (!h.messages.some((m) => m.id === id))
    throw new Problem(400, "Message unavailable.");
  await provider.read(req.params.id, id);
  res.json({ ok: true });
});
app.post("/api/glasses/chats/:id/sponsored/:ad/view", async (req, res) => {
  await service.chat(req.params.id, true);
  await provider.sponsoredView(req.params.id, req.params.ad);
  res.json({ ok: true });
});
app.post("/api/glasses/action", async (req, res) => {
  if (req.body.confirmed !== true)
    throw new Problem(400, "Review and confirm first.");
  res.json(
    await service.act(
      String(req.body.operationId ?? ""),
      req.body.action,
      String(req.body.revision ?? ""),
      true,
    ),
  );
});
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
app.get("/", (_req, res) => res.redirect("/glasses.html"));
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
const server = app.listen(port, process.env.PERSONAL_HOST ?? "127.0.0.1", () =>
  console.log(
    `Fieldline Catch-up ${demo ? "SYNTHETIC DEMO" : "personal account"}: http://127.0.0.1:${port}/glasses.html`,
  ),
);
const close = () =>
  server.close(async () => {
    await logins.cancelAll();
    void provider.close().finally(() => {
      store.close();
      process.exit(0);
    });
  });
process.on("SIGINT", close);
process.on("SIGTERM", close);
