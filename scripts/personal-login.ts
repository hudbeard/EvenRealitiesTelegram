import "dotenv/config";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
const apiId = Number(process.env.TELEGRAM_API_ID),
  apiHash = process.env.TELEGRAM_API_HASH;
if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash)
  throw new Error(
    "Put your own TELEGRAM_API_ID and TELEGRAM_API_HASH from my.telegram.org in .env first.",
  );
if (!process.stdin.isTTY)
  throw new Error("Run this login yourself in an interactive terminal.");
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(
  "Fieldline uses the Telegram API. This signs in your own account and stores a private local session. Read https://core.telegram.org/api/terms before continuing.",
);
if (
  (
    await rl.question("Continue with your own Telegram account? [y/N] ")
  ).toLowerCase() !== "y"
) {
  rl.close();
  process.exit(0);
}
rl.close();
async function secret(prompt: string) {
  process.stdout.write(prompt);
  const silent = new Writable({
    write(_chunk, _enc, done) {
      done();
    },
  });
  const input = createInterface({
    input: process.stdin,
    output: silent,
    terminal: true,
  });
  try {
    return await input.question("");
  } finally {
    input.close();
    process.stdout.write("\n");
  }
}
const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 2,
});
client.setLogLevel("none" as Parameters<TelegramClient["setLogLevel"]>[0]);
try {
  await client.start({
    phoneNumber: () => secret("Phone number: "),
    phoneCode: () => secret("Telegram login code: "),
    password: () => secret("Telegram two-step password (if enabled): "),
    onError: async () => {
      console.error(
        "Login failed. Check your inputs in Telegram; details withheld.",
      );
      return true;
    },
  });
  if (!(await client.checkAuthorization()))
    throw new Error("Account was not authorized.");
  const file = process.env.TELEGRAM_SESSION_FILE ?? ".data/personal.session";
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, String(client.session.save()), { mode: 0o600 });
  console.log(
    "Private local session saved. No session credential was printed.",
  );
} finally {
  await client.disconnect();
}
