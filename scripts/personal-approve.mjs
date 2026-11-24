import "dotenv/config";
import { readFile } from "node:fs/promises";
const code = process.argv[2];
if (!/^\d{6}$/.test(code ?? ""))
  throw new Error("Usage: npm run personal:approve -- CODE_FROM_GLASSES");
const key = await readFile(".data/personal-approval.key", "utf8");
const r = await fetch(
  `http://127.0.0.1:${process.env.PERSONAL_PORT ?? 3003}/api/pair/approve`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fieldline-approval": key,
    },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(5000),
  },
);
if (!r.ok)
  throw new Error(
    "Pairing approval failed. Check the local server and expiry.",
  );
console.log(
  (await r.json()).approved
    ? "Display paired."
    : "Code expired or already approved.",
);
