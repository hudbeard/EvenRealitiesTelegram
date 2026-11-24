import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { icon } from "../src/personal/icons.ts";
await mkdir("public/g2/icons", { recursive: true });
const aliases = {
  telegram: "send",
  message: "chats",
  compose: "file",
  history: "clock",
  heart: "thumb",
};
for (const name of [
  "telegram",
  "glasses",
  "chats",
  "message",
  "user",
  "users",
  "channel",
  "compose",
  "history",
  "reply",
  "heart",
  "send",
  "spark",
  "check",
  "keyboard",
  "info",
  "mic",
]) {
  const svg = icon(aliases[name] ?? name)
    .replace('width="20" height="20"', 'width="24" height="24"')
    .replace("currentColor", "#ffffff");
  await writeFile(
    "public/g2/icons/" + name + ".png",
    await sharp(Buffer.from(svg))
      .flatten({ background: "#000000" })
      .grayscale()
      .threshold(100)
      .png({ palette: true, colours: 2 })
      .toBuffer(),
  );
}
