import { Problem } from "../store.js";
export function pcmWave(pcm: Buffer) {
  if (!pcm.length || pcm.length > 960000 || pcm.length % 2)
    throw new Problem(400, "Record up to 30 seconds of 16 kHz mono audio.");
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export async function transcribe(
  pcm: Buffer,
  endpoint: string,
  key?: string,
  apiFetch: typeof fetch = fetch,
) {
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname)
    )
  )
    throw new Problem(503, "Use HTTPS or a local transcription service.");
  const wav = pcmWave(pcm);
  const body = new FormData();
  body.set(
    "file",
    new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
    "reply.wav",
  );
  body.set("model", process.env.STT_MODEL ?? "whisper-1");
  body.set("response_format", "json");
  const response = await apiFetch(url, {
    method: "POST",
    headers: key ? { authorization: `Bearer ${key}` } : {},
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Problem(
      503,
      "Transcription failed. Nothing was sent to Telegram.",
    );
  const result = (await response.json()) as { text?: unknown };
  if (
    typeof result.text !== "string" ||
    !result.text.trim() ||
    result.text.length > 4096
  )
    throw new Problem(503, "No usable transcript. Try again.");
  return result.text.trim();
}
