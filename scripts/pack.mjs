import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const backend = new URL(
  process.env.FIELDLINE_BACKEND_URL ?? "http://127.0.0.1:3001",
);
if (
  !["http:", "https:"].includes(backend.protocol) ||
  backend.username ||
  backend.password ||
  backend.pathname !== "/" ||
  backend.search ||
  backend.hash
)
  throw new Error(
    "FIELDLINE_BACKEND_URL must be a plain HTTP(S) origin with no credentials or path.",
  );
if (
  backend.protocol !== "https:" &&
  !["127.0.0.1", "localhost"].includes(backend.hostname)
)
  throw new Error("Use HTTPS for a hosted backend.");
const run = (args, env = process.env) => {
  const p = spawnSync(process.execPath, args, { stdio: "inherit", env });
  if (p.status !== 0) process.exit(p.status ?? 1);
};
run(["node_modules/typescript/bin/tsc", "--noEmit"]);
run(["node_modules/vite/bin/vite.js", "build"], {
  ...process.env,
  VITE_API_BASE: backend.origin,
});
const manifest = JSON.parse(await readFile("app.json", "utf8"));
manifest.permissions = [
  {
    name: "network",
    desc: "Read crew requests and send explicitly confirmed replies through the Fieldline backend.",
    whitelist: [backend.origin],
  },
];
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/app.packaged.json",
  JSON.stringify(manifest, null, 2),
);
run([
  ".tooling/node_modules/@evenrealities/evenhub-cli/main.js",
  "pack",
  "artifacts/app.packaged.json",
  "dist",
  "--sdk-ver",
  "0.0.16",
  "-o",
  "artifacts/fieldline.ehpk",
]);
console.log(
  `Package backend: ${backend.origin}${backend.protocol === "http:" ? " (LOCAL DEVELOPMENT ONLY)" : ""}`,
);
