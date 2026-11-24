import { test } from "node:test";
import assert from "node:assert/strict";
import { GlassesMicrophone } from "../src/glasses/voice.js";

test("hold/release sends joined PCM to the transcript service after mic shutdown", async () => {
  const events: string[] = [];
  const mic = new GlassesMicrophone({
    control: async (enabled) => {
      events.push(enabled ? "on" : "off");
      return true;
    },
    listening: (mode) => {
      events.push(mode);
    },
    processing: () => {
      events.push("processing");
    },
    transcribe: async (pcm) => {
      assert.equal(pcm.length, 3200);
      assert.equal(pcm[0], 4);
      assert.equal(pcm[1600], 7);
      events.push("transcribe");
      return "I’ll bring the prototype.";
    },
    draft: async (text) => {
      events.push(text);
    },
    restore: () => {
      events.push("restore");
    },
    error: (error) => {
      throw error;
    },
  });
  await mic.start("hold");
  mic.accept(new Uint8Array(1600).fill(4));
  mic.accept(new Uint8Array(1600).fill(7));
  await mic.stop();
  assert.deepEqual(events, [
    "on",
    "hold",
    "off",
    "processing",
    "transcribe",
    "I’ll bring the prototype.",
  ]);
  assert.equal(mic.busy, false);
});

test("cancelling during microphone startup disables it without sending audio for transcription", async () => {
  let enabled!: (result: boolean) => void;
  const ready = new Promise<boolean>((resolve) => {
    enabled = resolve;
  });
  const events: string[] = [];
  const mic = new GlassesMicrophone({
    control: async (on) => {
      events.push(on ? "on" : "off");
      return on ? ready : true;
    },
    listening: () => {
      assert.fail("Cancelled recording started listening");
    },
    processing: () => {
      assert.fail("Cancelled recording started processing");
    },
    transcribe: async () => assert.fail("Cancelled recording sent audio"),
    draft: async () => {
      assert.fail("Cancelled recording made a draft");
    },
    restore: () => {
      events.push("restore");
    },
    error: (error) => {
      throw error;
    },
  });
  const start = mic.start("hold");
  mic.accept(new Uint8Array(3200));
  const cancel = mic.cancel();
  enabled(true);
  await Promise.all([start, cancel]);
  assert.deepEqual(events, ["on", "off", "restore"]);
  assert.equal(mic.busy, false);
});
