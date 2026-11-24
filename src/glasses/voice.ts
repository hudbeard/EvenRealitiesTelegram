export type VoiceMode = "hold" | "toggle";

type VoiceHooks = {
  control: (enabled: boolean) => Promise<boolean>;
  transcribe: (
    pcm: Uint8Array<ArrayBuffer>,
    signal: AbortSignal,
  ) => Promise<string>;
  listening: (mode: VoiceMode) => void;
  processing: () => void;
  draft: (text: string) => Promise<void>;
  restore: () => void;
  error: (error: unknown) => void;
};

type Recording = {
  mode: VoiceMode;
  started: Promise<boolean>;
  abort: AbortController;
  chunks: Uint8Array[];
  size: number;
  timer?: ReturnType<typeof setTimeout>;
  stopping?: Promise<void>;
};

export class GlassesMicrophone {
  private current?: Recording;
  constructor(private hooks: VoiceHooks) {}

  get busy() {
    return this.current !== undefined;
  }
  get mode() {
    return this.current?.mode;
  }
  get recording() {
    return !!this.current && !this.current.stopping;
  }

  async start(mode: VoiceMode) {
    if (this.current) return;
    const recording: Recording = {
      mode,
      abort: new AbortController(),
      chunks: [],
      size: 0,
      started: Promise.resolve().then(() => this.hooks.control(true)),
    };
    this.current = recording;
    try {
      if (!(await recording.started))
        throw new Error("Could not start the glasses microphone.");
      if (recording.stopping) return;
      this.hooks.listening(mode);
      recording.timer = setTimeout(() => {
        void this.stop().catch(this.hooks.error);
      }, 30000);
    } catch (error) {
      if (recording.stopping) return;
      this.current = undefined;
      throw error;
    }
  }

  accept(pcm: ArrayLike<number>) {
    const recording = this.current;
    if (!recording || recording.stopping) return false;
    if (recording.size + pcm.length > 960000) return true;
    recording.chunks.push(new Uint8Array(pcm));
    recording.size += pcm.length;
    return recording.size === 960000;
  }

  stop() {
    const recording = this.current;
    if (!recording) return Promise.resolve();
    clearTimeout(recording.timer);
    recording.stopping ??= this.finish(recording);
    return recording.stopping;
  }

  cancel() {
    this.current?.abort.abort();
    return this.stop();
  }

  private async finish(recording: Recording) {
    let presented = false;
    try {
      // If Back or release arrives during startup, wait for the enable to finish before disabling.
      if (!(await recording.started)) return;
      await this.hooks.control(false);
      if (recording.abort.signal.aborted || recording.size < 3200) return;
      this.hooks.processing();
      const pcm = new Uint8Array(recording.size);
      let offset = 0;
      for (const chunk of recording.chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      const text = await this.hooks.transcribe(pcm, recording.abort.signal);
      if (recording.abort.signal.aborted) return;
      await this.hooks.draft(text);
      presented = true;
    } catch (error) {
      if (!recording.abort.signal.aborted) throw error;
    } finally {
      this.current = undefined;
      if (!presented) this.hooks.restore();
    }
  }
}
