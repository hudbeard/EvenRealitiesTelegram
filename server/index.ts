import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import express from "express";
import { Store } from "./store.js";
import { Telegram } from "./telegram.js";
import { createApp, pollTelegram, type Config } from "./app.js";
const mode = process.env.FIELDLINE_MODE ?? "demo";
if (mode !== "demo" && mode !== "telegram")
  throw new Error("FIELDLINE_MODE must be demo or telegram.");
const config: Config = {
  mode,
  label: process.env.OPERATOR_LABEL ?? "Crew member",
  origin: process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3001",
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  operatorId: process.env.TELEGRAM_OPERATOR_ID,
  chatId: process.env.TELEGRAM_CHAT_ID,
};
if (!/^[\x20-\x7e]{1,24}$/.test(config.label))
  throw new Error("Use a printable English operator label of 1–24 characters.");
if (
  mode === "telegram" &&
  (!config.botToken ||
    !/^\d+$/.test(config.operatorId ?? "") ||
    !/^-[0-9]+$/.test(config.chatId ?? ""))
)
  throw new Error(
    "Telegram mode requires bot token, wearer user ID, and an approved group chat ID.",
  );
const db = resolve(
  `${process.env.DATABASE_PATH ?? ".data/fieldline"}-${mode}.sqlite`,
);
mkdirSync(dirname(db), { recursive: true });
const store = new Store(db);
let receipt = 0;
const tg = new Telegram(config.botToken ?? "");
const transport =
  mode === "telegram"
    ? tg
    : {
        async send() {
          return ++receipt;
        },
      };
let lastSync = 0,
  providerOk = mode === "demo";
const app = createApp(store, config, transport, () => ({
  connected: providerOk && (mode === "demo" || Date.now() - lastSync < 60000),
  checkedAt: lastSync,
}));
app.use(express.static(resolve("dist")));
const server = app.listen(
  Number(process.env.PORT ?? 3001),
  process.env.HOST ?? "127.0.0.1",
  () =>
    console.log(
      `Fieldline ${mode} server ready on ${process.env.PORT ?? 3001}`,
    ),
);
const abort = new AbortController();
if (mode === "telegram")
  void pollTelegram(store, tg, config, abort.signal, (ok) => {
    providerOk = ok;
    if (ok) lastSync = Date.now();
  });
const stop = () => {
  abort.abort();
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
