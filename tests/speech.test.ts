import { test } from "node:test";
import assert from "node:assert/strict";
import { pcmWave, transcribe } from "../server/personal/speech.js";
test("G2 PCM is wrapped as 16kHz mono signed 16-bit WAV without changing samples", () => {
  const pcm = Buffer.from([1, 0, 255, 127]);
  const wav = pcmWave(pcm);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.throws(() => pcmWave(Buffer.alloc(960002)));
});
test("voice produces a draft only and rejects missing transcription instead of inventing text", async () => {
  const mock: typeof fetch = async (_url, options) => {
    assert.ok(options?.body instanceof FormData);
    return new Response(JSON.stringify({ text: "I will bring the glasses." }), {
      headers: { "content-type": "application/json" },
    });
  };
  assert.equal(
    await transcribe(
      Buffer.from([0, 0]),
      "https://transcription.example/v1/audio/transcriptions",
      "test-key",
      mock,
    ),
    "I will bring the glasses.",
  );
  await assert.rejects(
    transcribe(
      Buffer.from([0, 0]),
      "https://transcription.example",
      undefined,
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    ),
    /No usable transcript/,
  );
});
